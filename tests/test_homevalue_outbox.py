"""Disposable PostgreSQL tests. Fixed loopback host and test database; never production."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PSQL = os.environ.get('HOMEVALUE_TEST_PSQL', 'psql')
PORT = os.environ.get('HOMEVALUE_TEST_PG_PORT')
DB = 'homevalue_outbox_test'
def command(sql, database=DB, check=True):
    r = subprocess.run([PSQL, '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', database, '-XAt', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
    if check and r.returncode: raise AssertionError(r.stderr)
    return r

def quote(value): return "'" + str(value).replace("'", "''") + "'"
def payload(i=1, **extra):
    return dict(name='Synthetic test', phone='+12025550123', email=None, source='HomeValue', pageSource='HomeValue',
        submissionId=f'11111111-1111-4111-8111-{i:012}', submittedAt='2026-09-08T00:00:00.000Z',
        whatsappConsent=dict(granted=True,evidenceId='22222222-2222-4222-8222-222222222222',grantedAt='2026-09-07T00:00:00.000Z',noticeVersion='homevalue-whatsapp-v1'), **extra)
def capture(p, kind='lead', parent=None):
    return f"select public.homevalue_capture_handoff({quote(p['submissionId'])},{quote(p['submittedAt'])},{quote(kind)},{quote(json.dumps(p))}::jsonb,{quote(parent) if parent else 'null'});"

@unittest.skipUnless(PORT, 'Set HOMEVALUE_TEST_PG_PORT for a disposable local PostgreSQL instance')
class Outbox(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Deliberately fail rather than reset an existing database.
        command('create database '+DB, database='postgres')
        fixture=(ROOT/'tests/outbox-fixture.sql').read_text()
        fixture=fixture[fixture.index('create table'):]
        roles="do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;"
        command(roles+fixture+(ROOT/'supabase/migrations/20260908081054_homevalue_office_handoff.sql').read_text())
    def setUp(self): command('truncate homevalue_private.office_handoffs, public.leads restart identity cascade;')
    def scalar(self,sql): return command(sql).stdout.strip()
    def test_atomic_and_exact_replay(self):
        p=payload();command('set role service_role;'+capture(p));command(capture(p))
        self.assertEqual(self.scalar('select count(*) from public.leads'), '1')
        self.assertEqual(self.scalar('select count(*) from homevalue_private.office_handoffs'), '1')
        self.assertEqual(json.loads(self.scalar('select office_payload from homevalue_private.office_handoffs')),p)
        changed={**p,'name':'Changed'}
        self.assertNotEqual(command(capture(changed),check=False).returncode,0)
        self.assertEqual(self.scalar('select count(*) from public.leads'), '1')
    def test_insert_failure_rolls_back_both_halves(self):
        p=payload(padding='x'*33000)
        self.assertNotEqual(command(capture(p),check=False).returncode,0)
        self.assertEqual(self.scalar('select count(*) from public.leads'), '0')
        self.assertEqual(self.scalar('select count(*) from homevalue_private.office_handoffs'), '0')
    def test_intent_atomic_and_immutable(self):
        p=payload(plan=None);command(capture(p));q=payload(2,plan='selling')
        command(capture(q,'intent',p['submissionId']));command(capture(q,'intent',p['submissionId']))
        self.assertEqual(self.scalar('select count(*) from public.leads'),'1')
        self.assertEqual(self.scalar('select count(*) from homevalue_private.office_handoffs'),'2')
        self.assertEqual(self.scalar('select plan from public.leads'),'selling')
        self.assertEqual(json.loads(self.scalar("select office_payload from homevalue_private.office_handoffs where event_kind='lead'")),p)
        bad=payload(3,plan='buying',padding='x'*33000)
        self.assertNotEqual(command(capture(bad,'intent',p['submissionId']),check=False).returncode,0)
        self.assertEqual(self.scalar('select plan from public.leads'),'selling')
        bad=payload(4,plan='buying');bad['phone']='+12025550124'
        self.assertNotEqual(command(capture(bad,'intent',p['submissionId']),check=False).returncode,0)
    def test_permissions_rls_and_immutability(self):
        self.assertEqual(self.scalar("select relrowsecurity from pg_class where oid='homevalue_private.office_handoffs'::regclass"),'t')
        for role in ['anon','authenticated']:
            for sql in ['select * from homevalue_private.office_handoffs', "insert into homevalue_private.office_handoffs default values",capture(payload()),'select public.homevalue_claim_handoffs()']:
                self.assertNotEqual(command('set role '+role+';'+sql,check=False).returncode,0)
            self.assertEqual(self.scalar("select has_function_privilege("+quote(role)+",'public.homevalue_finish_handoff(uuid,uuid,text,text,integer)','execute')"),'f')
        command(capture(payload()))
        self.assertNotEqual(command("update homevalue_private.office_handoffs set office_payload='{}'::jsonb",check=False).returncode,0)
        self.assertNotEqual(command('set role service_role;select * from homevalue_private.office_handoffs',check=False).returncode,0)
    def test_concurrent_capture_and_claims(self):
        with concurrent.futures.ThreadPoolExecutor(2) as ex: list(ex.map(lambda _:command(capture(payload())),range(2)))
        self.assertEqual(self.scalar('select count(*) from public.leads'),'1')
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            results=list(ex.map(lambda _:command('begin;select public.homevalue_claim_handoffs(null,2);select pg_sleep(0.3);commit;').stdout,range(2)))
        claims=[json.loads(next(line for line in r.splitlines() if line.startswith('['))) for r in results]
        self.assertEqual(sum(len(c) for c in claims),1)
        self.assertEqual(self.scalar('select attempt_count from homevalue_private.office_handoffs'),'1')
    def test_backoff_lease_expiry_and_stale_worker(self):
        command(capture(payload()))
        first=json.loads(self.scalar('select public.homevalue_claim_handoffs()'))[0]
        command("update homevalue_private.office_handoffs set lease_until=now()-interval '1 second'")
        second=json.loads(self.scalar('select public.homevalue_claim_handoffs()'))[0]
        def finish(row,state): return f"select public.homevalue_finish_handoff({quote(row['submission_id'])},{quote(row['lease_id'])},{quote(state)},'transport',null)"
        self.assertEqual(self.scalar(finish(first,'delivered')),'f')
        self.assertEqual(self.scalar(finish(second,'pending')),'t')
        self.assertEqual(self.scalar('select next_attempt_at > now() from homevalue_private.office_handoffs'),'t')
        self.assertEqual(self.scalar('select public.homevalue_claim_handoffs()'),'[]')
        self.assertEqual(first['office_payload'],second['office_payload'])
    def test_success_review_and_parent_order(self):
        p=payload();command(capture(p));command(capture(payload(2,plan='selling'),'intent',p['submissionId']))
        claim=json.loads(self.scalar('select public.homevalue_claim_handoffs()'));self.assertEqual(len(claim),1)
        row=claim[0];self.scalar(f"select public.homevalue_finish_handoff({quote(row['submission_id'])},{quote(row['lease_id'])},'delivered',null,200)")
        self.assertEqual(self.scalar("select delivered_at is not null from homevalue_private.office_handoffs where event_kind='lead'"),'t')
        intent=json.loads(self.scalar('select public.homevalue_claim_handoffs()'))[0]
        self.scalar(f"select public.homevalue_finish_handoff({quote(intent['submission_id'])},{quote(intent['lease_id'])},'review','office_response',409)")
        self.assertEqual(self.scalar('select public.homevalue_claim_handoffs()'),'[]')
    def test_bounded_claim_and_intent_order(self):
        for i in range(1,13): command(capture(payload(i)))
        self.assertEqual(len(json.loads(self.scalar('select public.homevalue_claim_handoffs(null,10000)'))),10)
        self.setUp()
        p=payload();command(capture(p));command(capture(payload(2,plan='selling'),'intent',p['submissionId']));command(capture(payload(3,plan='buying'),'intent',p['submissionId']))
        for expected in [1,2,3]:
            rows=json.loads(self.scalar('select public.homevalue_claim_handoffs()'));self.assertEqual(len(rows),1)
            r=rows[0];self.assertEqual(r['submission_id'],payload(expected)['submissionId'])
            command(f"select public.homevalue_finish_handoff({quote(r['submission_id'])},{quote(r['lease_id'])},'delivered',null,200)")

    def assert_final_intent(self, expected):
        delivered=[]
        while True:
            rows=json.loads(self.scalar('select public.homevalue_claim_handoffs()'))
            if not rows: break
            self.assertEqual(len(rows),1)
            row=rows[0];delivered.append(row['office_payload'])
            command(f"select public.homevalue_finish_handoff({quote(row['submission_id'])},{quote(row['lease_id'])},'delivered',null,200)")
        self.assertEqual(delivered[-1],expected)
        return delivered
    def test_late_stale_intent_rejected_without_local_or_delivery_effect(self):
        parent=payload(plan=None);command(capture(parent))
        newer={**payload(2,plan='selling'),'submittedAt':'2026-09-08T00:02:00.000Z'}
        older={**payload(3,plan='buying'),'submittedAt':'2026-09-08T00:01:00.000Z'}
        command(capture(newer,'intent',parent['submissionId']))
        for _ in range(2):
            rejected=command(capture(older,'intent',parent['submissionId']),check=False)
            self.assertNotEqual(rejected.returncode,0)
            self.assertIn('Submission conflict',rejected.stderr)
        self.assertEqual(self.scalar('select plan from public.leads'),'selling')
        self.assertEqual(self.scalar('select count(*) from homevalue_private.office_handoffs'),'2')
        self.assertEqual(self.scalar(f"select public.homevalue_claim_handoffs({quote(older['submissionId'])})"),'[]')
        command(capture(newer,'intent',parent['submissionId']))
        self.assertEqual(self.assert_final_intent(newer),[parent,newer])
        command(capture(newer,'intent',parent['submissionId']))
        self.assertEqual(self.scalar('select public.homevalue_claim_handoffs()'),'[]')
    def test_concurrent_intent_capture_keeps_newest_authoritative_and_accepted_replay_safe(self):
        parent=payload();command(capture(parent))
        older={**payload(2,plan='buying'),'submittedAt':'2026-09-08T00:01:00.000Z'}
        newer={**payload(3,plan='selling'),'submittedAt':'2026-09-08T00:02:00.000Z'}
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            results=list(ex.map(lambda p:command('begin;'+capture(p,'intent',parent['submissionId'])+'select pg_sleep(0.2);commit;',check=False),[older,newer]))
        self.assertEqual(results[1].returncode,0)
        self.assertEqual(self.scalar('select plan from public.leads'),'selling')
        # If the older UUID was accepted first, exact replay is still valid but
        # cannot reapply its plan after the newer intent has committed.
        replay=command(capture(older,'intent',parent['submissionId']),check=False)
        self.assertEqual(replay.returncode==0,results[0].returncode==0)
        self.assertEqual(self.scalar('select plan from public.leads'),'selling')
        delivered=self.assert_final_intent(newer)
        self.assertEqual(delivered,[parent,older,newer] if results[0].returncode==0 else [parent,newer])
