import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync('src/lib/leadRecovery.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
const { createLeadRecovery } = exports;
const grant = { granted:true, evidenceId:'11111111-1111-4111-8111-111111111111', grantedAt:'2026-09-08T00:00:00.000Z', noticeVersion:'homevalue-whatsapp-v1' };
const draft = {kind:'lead',local:{name:'Synthetic',phone:'00000000'},office:{name:'Synthetic',phone:'00000000',whatsappConsent:grant}};
function harness() {
 const data = new Map(); const sent=[]; let local=0; let accept=false; let uuid=0;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const deps={storage,now:()=>Date.parse('2026-09-08T01:00:00.000Z'),uuid:()=>`11111111-1111-4111-8111-${String(++uuid).padStart(12,'0')}`,saveLocal:async()=>{local++;return 17},send:async p=>{sent.push(JSON.stringify(p));return accept}};
 return {deps,sent,data,accept:()=>{accept=true},local:()=>local};
}
test('failed Office handoff survives restoration, preserves identity/consent and skips another local insert',async()=>{
 const h=harness(); const first=createLeadRecovery(h.deps);
 assert.equal((await first.submit(draft)).ok,false); assert.equal(h.local(),1);
 const original=h.sent[0]; const restored=createLeadRecovery(h.deps); h.accept();
 assert.equal((await restored.retry('lead')).ok,true); assert.equal(h.local(),1); assert.equal(h.sent[1],original);
 const payload=JSON.parse(original); assert.deepEqual(payload.whatsappConsent,grant); assert.ok(payload.submissionId); assert.equal(payload.submittedAt,'2026-09-08T01:00:00.000Z');
 assert.equal((await restored.submit(draft)).ok,true); assert.equal(h.sent.length,2); assert.equal(h.local(),1);
});
test('editing recipient or consent cannot replace a pending submission',async()=>{
 const h=harness(); const m=createLeadRecovery(h.deps); await m.submit(draft);
 const changed=structuredClone(draft); changed.office.phone='11111111'; changed.office.whatsappConsent=null;
 assert.equal((await m.submit(changed)).ok,false); assert.equal(h.sent.length,1);
 assert.deepEqual(m.pending()[0].office.whatsappConsent,grant); assert.equal(m.pending()[0].office.phone,'00000000');
});
test('concurrent clicks cannot duplicate a local write or handoff',async()=>{
 const h=harness(); let release; h.deps.saveLocal=()=>new Promise(r=>{release=r});
 const m=createLeadRecovery(h.deps); const running=m.submit(draft);
 assert.equal((await m.submit(draft)).ok,false); release(17); await running; assert.equal(h.sent.length,1);
});
test('uncertain local save is recoverable but never automatically inserted again',async()=>{
 const h=harness();let writes=0;h.deps.saveLocal=async()=>{writes++;throw new Error('private provider failure')};
 const m=createLeadRecovery(h.deps); assert.equal((await m.submit(draft)).ok,false);
 const restored=createLeadRecovery(h.deps); assert.equal((await restored.retry('lead')).ok,false);
 assert.equal(writes,1);assert.equal(h.sent.length,0);assert.equal(restored.pending()[0].phase,'saving');
});
test('storage unavailable fails before any local or Office write',async()=>{
 const h=harness();h.deps.storage.setItem=()=>{throw new Error('blocked')};
 const m=createLeadRecovery(h.deps);assert.equal((await m.submit(draft)).ok,false);assert.equal(h.local(),0);assert.equal(h.sent.length,0);
});
test('intent failure is not success, retry preserves original plan and does not update local row twice',async()=>{
 const h=harness();const m=createLeadRecovery(h.deps);const intent={kind:'intent',local:{plan:'selling'},office:{...draft.office,plan:'selling'},updateId:17};
 assert.equal((await m.submit(intent)).ok,false);h.accept();assert.equal((await m.retry('intent')).ok,true);
 assert.equal(h.local(),1);assert.equal(h.sent[0],h.sent[1]);
});
test('consent-free enquiry stays consent-free on retries',async()=>{
 const h=harness();const m=createLeadRecovery(h.deps);await m.submit({...draft,office:{...draft.office,whatsappConsent:null}});await m.retry('lead');
 assert.equal(JSON.parse(h.sent[0]).whatsappConsent,null);assert.equal(h.sent[0],h.sent[1]);
});
test('expired recovery is purged and requests cannot grow without bound',async()=>{
 const h=harness();const m=createLeadRecovery(h.deps);await m.submit(draft);
 const restored=createLeadRecovery({...h.deps,now:()=>h.deps.now()+86400001});assert.equal(restored.pending().length,0);
});
test('identity/input review stops retries while retaining original details',async()=>{
 const h=harness();let sends=0;h.deps.send=async()=>{sends++;return 'review'};
 const m=createLeadRecovery(h.deps);assert.equal((await m.submit(draft)).ok,false);
 const restored=createLeadRecovery(h.deps);assert.equal((await restored.retry('lead')).ok,false);
 assert.equal(sends,1);assert.equal(restored.pending()[0].phase,'review');
});
