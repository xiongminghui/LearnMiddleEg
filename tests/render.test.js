import test from 'node:test';import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import {createDatabase,migrate} from '../server/database.js';
import {createApp} from '../server/app.js';
import worker from '../worker/index.js';
import {WORDS} from '../public/data/words.js';
const setup=async()=>{const mem=newDb({noAstCoverageCheck:true});mem.public.registerFunction({name:'length',args:['text'],returns:'integer',implementation:s=>s.length});const {Pool}=mem.adapters.createPg();const pool=new Pool();await migrate(pool);return {pool,db:createDatabase(pool)};};
test('PostgreSQL migration, publish, revision guard and duplicate event persistence',async()=>{
 const {pool,db}=await setup();try{await migrate(pool);const env={DB:db,ADMIN_PASSWORD:'testing-secret'};
 const req=(path,method='GET',body,token='testing-secret')=>new Request('https://example.com'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const publish=await worker.fetch(req('/api/admin/catalog','PUT',{revision:0,banks:{spell:[{...WORDS[0],audioUrl:'/audio/explore.mp3'}]}}),env);assert.equal(publish.status,200);
 const catalog=await (await worker.fetch(req('/api/catalog'),env)).json();assert.equal(catalog.banks.spell[0].id,'explore');assert.equal(catalog.revision,1);
 assert.equal(catalog.banks.spell[0].audioUrl,'/audio/explore.mp3');
 assert.equal((await worker.fetch(req('/api/admin/catalog','PUT',{revision:0,banks:{}}),env)).status,409);
 const e={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),wordId:'explore',eventType:'answered',exerciseType:'listen',result:'correct',assisted:false,occurredAt:Date.now(),latencyMs:1200};
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(req('/api/events','POST',{events:[e]},'a'.repeat(64)),env)).status,200);
 const result=await (await worker.fetch(req('/api/summary','GET',null,'a'.repeat(64)),env)).json();assert.equal(Number(result.events),1);
 assert.equal(Number((await (await worker.fetch(req('/api/summary','GET',null,'b'.repeat(64)),env)).json()).events),0);
 }finally{await pool.end();}
});
test('Node server serves assets, health and authenticated API behind HTTPS proxy',async()=>{
 const {pool,db}=await setup();const app=createApp({db,password:'secret',publicOrigin:'https://example.com'});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.address().port;
 try{assert.equal((await fetch(origin+'/healthz')).status,200);assert.match(await (await fetch(origin+'/')).text(),/boot.js/);assert.match((await fetch(origin+'/app.js')).headers.get('content-type'),/javascript/);assert.equal((await fetch(origin+'/package.json')).status,404);assert.equal((await fetch(origin+'/%2e%2e%2fpackage.json')).status,403);
 const response=await fetch(origin+'/api/admin/catalog',{method:'PUT',headers:{Origin:'https://example.com',Authorization:'Bearer secret','Content-Type':'application/json'},body:JSON.stringify({revision:0,banks:{intro:[WORDS[0]]}})});assert.equal(response.status,403);
 const defaults=await fetch(origin+'/api/admin/catalog?course=toefl&module=intro',{headers:{Authorization:'Bearer secret'}});assert.equal(defaults.headers.get('content-encoding'),'gzip');assert.equal((await defaults.json()).banks.intro.length,6974);
 assert.equal((await fetch(origin+'/api/admin/catalog')).status,401);
 }finally{await new Promise(resolve=>app.close(resolve));await pool.end();}
});
