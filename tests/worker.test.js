import test from 'node:test';import assert from 'node:assert/strict';
import worker,{learnerKey} from '../worker/index.js';
const token='a'.repeat(64),other='b'.repeat(64);
const event=()=>({id:crypto.randomUUID(),sessionId:crypto.randomUUID(),wordId:'explore',eventType:'answered',exerciseType:'spell',result:'correct',assisted:false,occurredAt:Date.now(),latencyMs:1234});
const req=(body,auth=token)=>new Request('https://example.com/api/events',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+auth},body:JSON.stringify(body)});
test('static route and database-free status work without a D1 binding',async()=>{
 const env={ASSETS:{fetch:()=>new Response('asset')}};
 assert.equal(await (await worker.fetch(new Request('https://example.com/'),env)).text(),'asset');
 assert.deepEqual(await (await worker.fetch(new Request('https://example.com/api/status'),env)).json(),{storage:'local',version:1});
 assert.equal((await worker.fetch(req({events:[event()]}),env)).status,503);
});
test('device identity is a one-way digest and different tokens are isolated',async()=>{
 const a=await learnerKey(req({},token)),b=await learnerKey(req({},other));assert.equal(a.length,64);assert.notEqual(a,token);assert.notEqual(a,b);assert.equal(await learnerKey(req({},'')),null);
});
test('authentication, origin, schema and size validation reject malformed writes',async()=>{
 const env={DB:{batch:()=>{throw Error('must not write');}}};
 assert.equal((await worker.fetch(req({events:[event()]},''),env)).status,401);
 assert.equal((await worker.fetch(req({events:[{...event(),wordId:'<invalid>'}]}),env)).status,400);
 assert.equal((await worker.fetch(req({events:Array.from({length:41},event)}),env)).status,400);
 assert.equal((await worker.fetch(req({text:'x'.repeat(40000)}),env)).status,400);
 const r=req({events:[event()]});r.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(r,env)).status,403);
 const e=event();assert.equal((await worker.fetch(req({events:[e,e]}),env)).status,400);
});
test('writes are parameterized, scoped, and acknowledged only after the batch succeeds',async()=>{
 const calls=[],e=event();const env={DB:{prepare(sql){return {bind(...params){calls.push({sql,params});return {sql,params};}}},async batch(){return [];}}};
 const response=await worker.fetch(req({events:[e]}),env);assert.equal(response.status,200);assert.deepEqual(await response.json(),{acknowledged:[e.id]});assert.match(calls[0].sql,/ON CONFLICT/);assert.equal(calls[0].params[0],await learnerKey(req({})));assert.equal(calls[0].params[1],e.id);
 env.DB.batch=async()=>{throw Error('unavailable');};assert.equal((await worker.fetch(req({events:[e]}),env)).status,503);
});
