import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
import {timingSafeEqual} from 'node:crypto'
function route(file,{enabled='true',captureOk=true,deliveryThrows=false}={}) {
 const calls=[];const exports={};const secret='synthetic-scheduler-secret-at-least-32-bytes'
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Response,URL,Buffer,setTimeout,clearTimeout,process:{env:{HOMEVALUE_DURABLE_INTAKE_ENABLED:enabled,CRON_SECRET:secret}},
  require:name=>{
   if(name==='node:crypto')return {timingSafeEqual}
   if(name==='@/lib/homevalueOutboxServer')return {outboxRPC:()=>{calls.push('rpc');return ()=>{}}}
   if(name==='@/lib/homevalueOutbox')return {parseCapture:()=>({id:'original-id'}),capture:async()=>{calls.push('capture');return {ok:captureOk,state:'pending'}},deliverDue:async()=>{calls.push('deliver');if(deliveryThrows)throw Error('PRIVATE');return {processed:1,unavailable:false}}}
   throw Error(name)
  }
 });return {exports,calls,secret}
}
const req=(body='{}',origin='https://homevalue.example.invalid')=>new Request('https://homevalue.example.invalid/api/send-lead',{method:'POST',headers:{origin,'content-type':'application/json'},body})
test('capture commits before delivery; delivery failure still acknowledges durable capture',async()=>{
 const h=route('src/app/api/send-lead/route.ts',{deliveryThrows:true});const r=await h.exports.POST(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{success:true,captured:true});assert.deepEqual(h.calls,['rpc','capture','deliver'])
})
test('failed transaction cannot claim success or attempt Office delivery',async()=>{const h=route('src/app/api/send-lead/route.ts',{captureOk:false});assert.equal((await h.exports.POST(req())).status,503);assert.deepEqual(h.calls,['rpc','capture'])})
test('origin, input size, malformed JSON and disabled rollout fail before persistence',async()=>{
 const h=route('src/app/api/send-lead/route.ts');assert.equal((await h.exports.POST(req('{}','https://other.example.invalid'))).status,403)
 assert.equal((await h.exports.POST(req('x'.repeat(32001)))).status,400);assert.equal((await h.exports.POST(req('{'))).status,400);assert.equal(h.calls.length,0)
 const off=route('src/app/api/send-lead/route.ts',{enabled:'false'});assert.equal((await off.exports.POST(req())).status,503);assert.equal(off.calls.length,0)
})
test('scheduler rejects absent/wrong credentials and returns only aggregate counts',async()=>{
 const h=route('src/app/api/cron/homevalue-office-recovery/route.ts');for(const auth of ['', 'Bearer wrong'])assert.equal((await h.exports.GET(new Request('https://test.invalid',{headers:{authorization:auth}}))).status,401)
 assert.equal(h.calls.length,0);const r=await h.exports.GET(new Request('https://test.invalid',{headers:{authorization:'Bearer '+h.secret}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,processed:1})
})
