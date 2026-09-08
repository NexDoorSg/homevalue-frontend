import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync('src/app/api/send-lead/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function handler({status=200,crash=false,configured=true}={}) {
 const logs=[],calls=[],exports={};
 vm.runInNewContext(compiled,{exports,AbortSignal,process:{env:configured?{NEXDOOR_OFFICE_URL:'https://office.example.invalid',HOMEVALUE_OFFICE_SYNC_TOKEN:'synthetic-credential'}:{}},console:{warn:(...args)=>logs.push(args)},fetch:async(url,options)=>{
  calls.push({url,options});if(crash)throw new Error('PRIVATE exception');
  return {ok:status===200,status,json:async()=>{throw new Error('Provider body must not be read')},text:async()=>{throw new Error('Provider body must not be read')}};
 },require:name=>{
  if(name==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options?.status??200})}};
  if(name==='@/lib/propertyIdentity')return {buildLeadSyncPayload:b=>b};
  if(name==='@/lib/whatsappConsent')return {parseHomeValueWhatsAppConsent:c=>c??null};
  throw new Error('Unexpected import '+name);
 }});
 return {post:exports.POST,logs,calls};
}
const payload={name:'PRIVATE CUSTOMER',phone:'PRIVATE PHONE',submissionId:'11111111-1111-4111-8111-111111111111',submittedAt:'2026-09-08T00:00:00.000Z'};
for(const status of [200,400,401,409,422,429,500,503])test(`Office status ${status}: safe response and bounded diagnostics`,async()=>{
 const h=handler({status});const result=await h.post({json:async()=>payload});
 assert.equal(result.status,status===200?200:[400,409,422].includes(status)?409:502);
 assert.equal(result.body.success,status===200);assert.doesNotMatch(JSON.stringify([result,h.logs]),/PRIVATE|synthetic-credential|assignedTo/);
 const sent=JSON.parse(h.calls[0].options.body);assert.equal(sent.submissionId,payload.submissionId);assert.equal(sent.submittedAt,payload.submittedAt);
 assert.equal(h.calls[0].options.redirect,'error');assert.ok(h.calls[0].options.signal);
});
test('transport failure does not expose raw exception',async()=>{
 const h=handler({crash:true});const r=await h.post({json:async()=>payload});assert.equal(r.status,502);assert.doesNotMatch(JSON.stringify([r,h.logs]),/PRIVATE/);
});
test('missing config and malformed input fail without an Office request',async()=>{
 const h=handler({configured:false});assert.equal((await h.post({json:async()=>payload})).status,503);
 for(const input of [null,[],false])assert.equal((await h.post({json:async()=>input})).status,400);
 assert.equal((await h.post({json:async()=>{throw new Error('PRIVATE')}})).status,400);assert.equal(h.calls.length,0);
});
