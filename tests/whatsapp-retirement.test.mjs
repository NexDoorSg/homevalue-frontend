import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const consentSource = readFileSync(new URL('../src/lib/whatsappConsent.ts', import.meta.url), 'utf8');
const consentModule = { exports: {} };
new Function('exports', ts.transpileModule(consentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(consentModule.exports);
const parse = consentModule.exports.parseHomeValueWhatsAppConsent;
const grant = { granted: true, grantedAt: '2026-09-07T00:00:00.000Z', noticeVersion: 'homevalue-whatsapp-v1', evidenceId: '11111111-1111-4111-8111-111111111111' };
test('consent contract rejects malformed evidence and preserves original evidence on retry', () => {
  assert.equal(parse(undefined), null); assert.deepEqual(parse(grant), grant);
  for (const value of [true, {}, {...grant, granted: 'true'}, {...grant, noticeVersion: 'invented'}, {...grant, grantedAt: '2100-01-01T00:00:00.000Z'}]) assert.throws(() => parse(value));
});

const route = readFileSync(new URL('../src/app/api/send-lead/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

for (const syncOk of [true, false]) {
  test(`retired sender makes no Meta request with legacy credentials present; Office sync ${syncOk}`, async () => {
    const calls = [];
    const emails = [];
    const exports = {};
    const context = {
      exports,
      process: { env: {
        RESEND_API_KEY: 'synthetic', NEXDOOR_OFFICE_URL: 'https://office.example.invalid',
        HOMEVALUE_OFFICE_SYNC_TOKEN: 'synthetic', WHATSAPP_ACCESS_TOKEN: 'synthetic',
        WHATSAPP_PHONE_NUMBER_ID: 'synthetic', WHATSAPP_CONSULTANT_PHONE: 'synthetic',
      } },
      console: { warn() {}, error() {}, info() {} },
      fetch: async (url, options) => {
        calls.push({ url, options });
        assert.equal(url, 'https://office.example.invalid/api/leads');
        return { ok: syncOk, json: async () => ({ assignedTo: 'consultant@example.invalid' }), text: async () => 'synthetic failure' };
      },
      require: (name) => {
        if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
        if (name === 'resend') return { Resend: class { emails = { send: async (message) => { emails.push(message); return { data: { id: 'synthetic' }, error: null }; } }; } };
        if (name === '@/lib/emailHtml') return { displayEmailHtmlValue: (value) => String(value ?? '-') };
        if (name === '@/lib/whatsappConsent') return { parseHomeValueWhatsAppConsent: parse };
        if (name === '@/lib/propertyIdentity') return { buildLeadSyncPayload: (body) => body };
        throw new Error(`Unexpected module ${name}`);
      },
    };
    vm.runInNewContext(compiled, context);
    const body = { name: 'Synthetic test', phone: '00000000', plan: 'selling', project_name: 'Synthetic property', whatsappConsent: grant };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await exports.POST({ json: async () => body });
      assert.equal(result.status, syncOk ? 200 : 502);
      assert.equal(result.body.officeSync.ok, syncOk);
    }
    assert.deepEqual(JSON.parse(calls[0].options.body).whatsappConsent, grant);
    assert.deepEqual(JSON.parse(calls[1].options.body).whatsappConsent, grant);
    const rejected = await exports.POST({ json: async () => ({ ...body, whatsappConsent: { ...grant, noticeVersion: 'unknown' } }) });
    assert.equal(rejected.status, 400);
    assert.equal(calls.length, 2);
    assert.equal(emails.length, 2);
    assert.equal(JSON.parse(calls[0].options.body).source, 'HomeValue');
  });
}
