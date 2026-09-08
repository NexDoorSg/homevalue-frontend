import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path, modules={}) {
 const exports={};new Function('exports','require',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,name=>{if(modules[name])return modules[name];throw Error('Unexpected '+name)});return exports
}
const identity=load('src/lib/propertyIdentity.ts'),consent=load('src/lib/whatsappConsent.ts')
const {parseCapture,capture,deliverDue}=load('src/lib/homevalueOutbox.ts',{'./propertyIdentity':identity,'./whatsappConsent':consent})
const grant={granted:true,evidenceId:'22222222-2222-4222-8222-222222222222',grantedAt:'2026-09-07T00:00:00.000Z',noticeVersion:'homevalue-whatsapp-v1'}
const envelope={version:1,kind:'lead',submission:{submissionId:'11111111-1111-4111-8111-111111111111',submittedAt:'2026-09-08T00:00:00.000Z',name:'Synthetic',phone:'+12025550123',email:null,project_name:'Synthetic property',postal_code:'123456',whatsappConsent:grant}}
const config={officeUrl:'https://office.example.invalid',token:'synthetic'}
test('capture retains identity, property and consent, rejects source/routing policy and numeric Lead IDs',()=>{
 const p=parseCapture(envelope);assert.deepEqual(p.payload.whatsappConsent,grant);assert.equal(p.id,envelope.submission.submissionId)
 assert.equal(p.payload.project_name,'Synthetic property');assert.equal(p.payload.source,'HomeValue')
 for(const patch of [{isPaid:true},{assignedTo:'invented'},{provider:'meta'},{phone:'bad'},{submittedAt:'2100-01-01T00:00:00.000Z'},{whatsappConsent:{...grant,grantedAt:'2026-09-08T01:00:00.000Z'}}]) assert.throws(()=>parseCapture({...envelope,submission:{...envelope.submission,...patch}}))
 assert.throws(()=>parseCapture({...envelope,leadId:42}));assert.throws(()=>parseCapture({...envelope,kind:'intent',parentSubmissionId:42}))
})
for(const status of [200,400,409,422,429,500,503]) test(`Office ${status} settles safely using only stored payload`,async()=>{
 const calls=[];const stored=parseCapture(envelope).payload
 const rpc=async(name,args)=>{calls.push({name,args});return name==='homevalue_claim_handoffs'?{data:[{submission_id:stored.submissionId,lease_id:'lease',office_payload:stored}],error:null}:{data:true,error:null}}
 const sent=[];await deliverDue(rpc,config,null,async(url,options)=>{sent.push(options.body);return {status,ok:status===200,json:()=>{throw Error('No body reads')}}})
 assert.equal(sent[0],JSON.stringify(stored));assert.equal(calls[1].args.p_state,status===200?'delivered':[400,409,422].includes(status)?'review':'pending')
 assert.deepEqual(Object.keys(calls[1].args).sort(),['p_code','p_id','p_lease','p_state','p_status']);assert.equal(calls[0].args.p_limit,10)
})
test('timeout and lost settlement stay recoverable; configuration failure does not claim',async()=>{
 const calls=[];const rpc=async(name,args)=>{calls.push({name,args});return name.includes('claim')?{data:[{submission_id:'id',lease_id:'lease',office_payload:parseCapture(envelope).payload}],error:null}:{data:null,error:{code:'timeout'}}}
 const r=await deliverDue(rpc,config,null,async()=>{throw Error('PRIVATE transport')});assert.equal(r.unavailable,true);assert.equal(calls[1].args.p_state,'pending');assert.equal(calls[1].args.p_code,'transport')
 const n=calls.length;await deliverDue(rpc,{});assert.equal(calls.length,n)
})
test('browser loss and lost Office response replay one canonical receipt, routing turn, email and acknowledgement',async()=>{
 // Coordinated Office mock: its canonical-payload receipt lock/dedup boundary.
 // Actual PostgreSQL HomeValue claim/capture concurrency is tested separately.
 const durable=new Map();const receipts=new Set();let routes=0,emails=0,acks=0,first=true;const bodies=[]
 const rpc=async(name,a)=>{
  if(name==='homevalue_capture_handoff') {if(!durable.has(a.p_id))durable.set(a.p_id,{submission_id:a.p_id,office_payload:structuredClone(a.p_payload),state:'pending'});return {data:{state:durable.get(a.p_id).state},error:null}}
  if(name==='homevalue_claim_handoffs')return {data:[...durable.values()].filter(r=>r.state==='pending').map(r=>({...r,lease_id:'lease'})),error:null}
  durable.get(a.p_id).state=a.p_state;return {data:true,error:null}
 }
 const office=async(url,options)=>{bodies.push(options.body);const p=JSON.parse(options.body);delete p.whatsappConsent;const key=JSON.stringify(p)
  if(!receipts.has(key)){receipts.add(key);routes++;emails++;acks++}
  if(first){first=false;throw Error('Response lost after commit')};return {status:200,ok:true}
 }
 await capture(rpc,parseCapture(envelope));await deliverDue(rpc,config,null,office)
 // No browser object/session survives; a separate scheduled invocation recovers.
 await deliverDue(rpc,config,null,office)
 assert.equal(durable.size,1);assert.equal(receipts.size,1);assert.equal(routes,1);assert.equal(emails,1);assert.equal(acks,1);assert.equal(bodies[0],bodies[1]);assert.equal([...durable.values()][0].state,'delivered')
})

test('submission and consent accept up to 60 seconds clock skew without relaxing chronology or ISO format',()=>{
 const now=Date.parse('2026-09-08T00:00:00.000Z')
 const withTimes=(submittedAt,grantedAt)=>({...envelope,submission:{...envelope.submission,submittedAt,whatsappConsent:{...grant,grantedAt}}})
 for(const ms of [1,30000,60000]) {
  const at=new Date(now+ms).toISOString()
  const parsed=parseCapture(withTimes(at,at),now)
  assert.equal(parsed.at,at);assert.equal(parsed.payload.whatsappConsent.grantedAt,at)
 }
 const beyond=new Date(now+60001).toISOString(),limit=new Date(now+60000).toISOString()
 assert.throws(()=>parseCapture(withTimes(beyond,limit),now))
 assert.throws(()=>parseCapture(withTimes(limit,beyond),now))
 assert.throws(()=>consent.parseHomeValueWhatsAppConsent({...grant,grantedAt:beyond},new Date(now)))
 assert.throws(()=>parseCapture(withTimes(new Date(now+30000).toISOString(),limit),now))
 for(const at of ['2026-09-08T00:00:30Z','2026-09-08T00:00:30.000+00:00']) {
  assert.throws(()=>parseCapture(withTimes(at,grant.grantedAt),now))
  assert.throws(()=>parseCapture(withTimes(limit,at),now))
 }
})
