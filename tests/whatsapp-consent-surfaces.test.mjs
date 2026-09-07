import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir,e.name)) : [join(dir,e.name)]); }
const callers = files('src').filter(f => /\.tsx?$/.test(f) && readFileSync(f,'utf8').includes("fetch('/api/send-lead'"));
test('all current send-lead surfaces offer the shared optional consent and preserve evidence', () => {
  assert.deepEqual(callers.sort(), ['src/app/free-property-valuation-singapore/page.tsx', 'src/app/page.tsx']);
  for (const file of callers) {
    const source = readFileSync(file,'utf8');
    assert.match(source, /from '@\/lib\/whatsappConsent'/, file);
    for (const owner of ['lead','consult']) {
      assert.match(source, new RegExp(`\\[${owner}Consent,.*useState<HomeValueWhatsAppConsent \\| null>\\(null\\)`), file);
      assert.match(source, new RegExp(`type="checkbox" checked=\\{${owner}Consent !== null\\}`), file);
      assert.match(source, new RegExp(`set${owner === 'lead' ? 'Lead' : 'Consult'}Phone\\(e.target.value\\); set${owner === 'lead' ? 'Lead' : 'Consult'}Consent\\(null\\)`), file);
    }
    assert.match(source, /source: 'consultation',\s+whatsappConsent: consultConsent/, file);
    assert.match(source, /source: 'plan_popup',\s+whatsappConsent: leadConsent/, file);
    assert.match(source, /sendLeadEmail\(\{ \.\.\.leadPayload, whatsappConsent: leadConsent \}\)/, file);
    assert.match(source, /setLeadId\(null\)\s+setLeadConsent\(null\)/, file);
    const sender = source.slice(source.indexOf('const sendLeadEmail ='), source.indexOf('const handleConsultationSubmit ='));
    assert.doesNotMatch(sender, /randomUUID|new Date/, file);
  }
});
