-- Additive; no historical backfill and no changes to existing Lead rows/policies.
begin;
create schema if not exists homevalue_private;
revoke all on schema homevalue_private from public, anon, authenticated, service_role;
create table homevalue_private.office_handoffs (
  submission_id uuid primary key,
  capture_order bigint generated always as identity unique,
  submitted_at timestamptz not null,
  event_kind text not null check (event_kind in ('lead','consultation','intent')),
  lead_id bigint not null references public.leads(id),
  parent_submission_id uuid references homevalue_private.office_handoffs(submission_id),
  office_payload jsonb not null check (jsonb_typeof(office_payload) = 'object' and octet_length(office_payload::text) <= 32000),
  state text not null default 'pending' check (state in ('pending','delivered','review')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  failure_code text check (failure_code in ('transport','office_response','configuration')),
  http_status integer check (http_status between 100 and 599),
  check ((event_kind = 'intent') = (parent_submission_id is not null))
);
alter table homevalue_private.office_handoffs enable row level security;
revoke all on homevalue_private.office_handoffs from public, anon, authenticated, service_role;
create index office_handoffs_lead_order on homevalue_private.office_handoffs(lead_id,capture_order);
create index office_handoffs_due on homevalue_private.office_handoffs(next_attempt_at) where state = 'pending';

create function homevalue_private.protect_handoff() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.capture_order,new.submission_id,new.submitted_at,new.event_kind,new.lead_id,new.parent_submission_id,new.office_payload)
     is distinct from (old.capture_order,old.submission_id,old.submitted_at,old.event_kind,old.lead_id,old.parent_submission_id,old.office_payload) then
    raise exception using message = 'Immutable handoff', errcode = '22023';
  end if;
  return new;
end $$;
create trigger immutable_handoff before update on homevalue_private.office_handoffs
for each row execute function homevalue_private.protect_handoff();
revoke all on function homevalue_private.protect_handoff() from public, anon, authenticated, service_role;

-- Callable only by the trusted server. UUID possession binds an intent to a
-- captured parent; a caller-supplied numeric Lead ID is never accepted.
create function public.homevalue_capture_handoff(p_id uuid, p_at timestamptz, p_kind text, p_payload jsonb, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing homevalue_private.office_handoffs; parent homevalue_private.office_handoffs; target bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('homevalue-capture:' || p_id::text, 0));
  select * into existing from homevalue_private.office_handoffs where submission_id = p_id;
  if found then
    if (existing.submitted_at,existing.event_kind,existing.office_payload,existing.parent_submission_id)
       is distinct from (p_at,p_kind,p_payload,p_parent) then
      raise exception using message = 'Submission conflict', errcode = '22023';
    end if;
    return jsonb_build_object('state',existing.state);
  end if;
  if p_kind not in ('lead','consultation','intent') or p_id is null or p_at is null
     or p_at > now() + interval '1 minute' or p_at < '2026-01-01'::timestamptz
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload->>'submissionId' is distinct from p_id::text
     or (p_payload->>'submittedAt')::timestamptz is distinct from p_at
     or p_payload->>'source' is distinct from 'HomeValue'
     or coalesce(length(p_payload->>'name'),0) = 0 or coalesce(length(p_payload->>'phone'),0) = 0 then
    raise exception using message = 'Invalid capture', errcode = '22023';
  end if;
  if p_kind = 'intent' then
    select * into parent from homevalue_private.office_handoffs where submission_id = p_parent and event_kind in ('lead','consultation') for update;
    if not found or parent.office_payload->>'phone' is distinct from p_payload->>'phone'
       or parent.office_payload->>'name' is distinct from p_payload->>'name'
       or parent.office_payload->>'email' is distinct from p_payload->>'email'
       or parent.office_payload->'whatsappConsent' is distinct from p_payload->'whatsappConsent' then
      raise exception using message = 'Invalid parent capture', errcode = '22023';
    end if;
    -- Parent lock serializes this check with every intent capture. Arrival order
    -- alone cannot establish chronology; reject stale first-time identities.
    -- Accepted UUID replays have already returned above without updating the Lead.
    if exists (select 1 from homevalue_private.office_handoffs h
      where h.parent_submission_id = p_parent and h.event_kind = 'intent' and h.submitted_at > p_at) then
      raise exception using message = 'Submission conflict', errcode = '22023';
    end if;
    target := parent.lead_id;
    update public.leads set plan = p_payload->>'plan' where id = target;
  else
    if p_parent is not null then raise exception using message = 'Invalid parent capture', errcode = '22023'; end if;
    insert into public.leads(name,phone,email,address,unit_number,unit_type,floor_area_sqm,tenure,plan,
      estimated_price,estimated_low,estimated_high,num_of_comps,radius_used_m)
    values (p_payload->>'name',p_payload->>'phone',p_payload->>'email',p_payload->>'address',p_payload->>'unit_number',p_payload->>'unit_type',
      (p_payload->>'floor_area_sqm')::numeric,p_payload->>'tenure',p_payload->>'plan',
      (p_payload->>'estimated_price')::numeric,(p_payload->>'estimated_low')::numeric,(p_payload->>'estimated_high')::numeric,
      (p_payload->>'num_of_comps')::integer,(p_payload->>'radius_used_m')::integer) returning id into target;
  end if;
  insert into homevalue_private.office_handoffs(submission_id,submitted_at,event_kind,lead_id,parent_submission_id,office_payload)
  values(p_id,p_at,p_kind,target,p_parent,p_payload);
  return jsonb_build_object('state','pending');
end $$;
revoke all on function public.homevalue_capture_handoff(uuid,timestamptz,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.homevalue_capture_handoff(uuid,timestamptz,text,jsonb,uuid) to service_role;

create function public.homevalue_claim_handoffs(p_id uuid default null, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  with due as (
    select h.submission_id from homevalue_private.office_handoffs h
    where h.state = 'pending' and h.next_attempt_at <= now()
      and (h.lease_until is null or h.lease_until < now()) and (p_id is null or h.submission_id = p_id)
      and (h.parent_submission_id is null or exists (
        select 1 from homevalue_private.office_handoffs p where p.submission_id = h.parent_submission_id and p.state = 'delivered'))
      and not exists (select 1 from homevalue_private.office_handoffs earlier
        where earlier.lead_id = h.lead_id and earlier.capture_order < h.capture_order and earlier.state <> 'delivered')
    order by h.capture_order for update of h skip locked limit least(greatest(coalesce(p_limit,10),1),10)
  ), claimed as (
    update homevalue_private.office_handoffs h set lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes',
      last_attempt_at = now(), attempt_count = attempt_count + 1
    from due where h.submission_id = due.submission_id returning h.submission_id,h.lease_id,h.office_payload
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into result from claimed;
  return result;
end $$;
revoke all on function public.homevalue_claim_handoffs(uuid,integer) from public, anon, authenticated;
grant execute on function public.homevalue_claim_handoffs(uuid,integer) to service_role;

create function public.homevalue_finish_handoff(p_id uuid,p_lease uuid,p_state text,p_code text default null,p_status integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('pending','delivered','review') then raise exception 'Invalid delivery state'; end if;
  update homevalue_private.office_handoffs set state = p_state, lease_id = null, lease_until = null,
    delivered_at = case when p_state = 'delivered' then now() else null end,
    next_attempt_at = now() + make_interval(secs => least(86400,60 * power(2,least(attempt_count,10)))),
    failure_code = p_code, http_status = p_status
  where submission_id = p_id and lease_id = p_lease and state = 'pending' and lease_until > now();
  return found;
end $$;
revoke all on function public.homevalue_finish_handoff(uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.homevalue_finish_handoff(uuid,uuid,text,text,integer) to service_role;
commit;
