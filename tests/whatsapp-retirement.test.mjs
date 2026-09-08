import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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

test('HomeValue delivery has no direct email or WhatsApp provider implementation', () => {
  const route = readFileSync('src/lib/homevalueOutbox.ts','utf8');
  assert.doesNotMatch(route, /resend|emails\.send|graph\.facebook|whatsapp.*messages/);
  assert.match(route, /x-nexdoor-source/);
});
