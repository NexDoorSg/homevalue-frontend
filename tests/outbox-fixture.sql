-- Disposable database only. Never run against a linked Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.leads (
 id bigint generated always as identity primary key, created_at timestamptz default now(),
 name text, phone text, email text, address text, unit_number text, unit_type text,
 floor_area_sqm numeric, tenure text, plan text, estimated_price numeric,
 estimated_low numeric, estimated_high numeric, num_of_comps integer, radius_used_m integer
);
