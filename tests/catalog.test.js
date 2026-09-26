import test from 'node:test';import assert from 'node:assert/strict';
import {parseImport,validateWords} from '../public/lib/catalog.js';
import {WORDS} from '../public/data/words.js';
import {createModuleSession,recordAnswer,initialProgress} from '../public/lib/engine.js';
import {normalizeProfile,createProfile} from '../public/lib/store.js';
import worker from '../worker/index.js';
test('CSV handles BOM, commas, escaped quotes and multiline fields',()=>{
 const rows=parseImport('\uFEFFword,ipa,meaning,definition,sentence,translation\r\napple,/apple/,苹果,"A fruit, often red.","An apple is a ""fruit"".\nI like it.",一个苹果。','words.csv');assert.equal(rows[0].id,'apple');assert.match(rows[0].sentence,/"fruit"/);assert.match(rows[0].sentence,/\n/);
 assert.throws(()=>validateWords([WORDS[0],WORDS[0]]),/重复/);assert.throws(()=>validateWords([{...WORDS[0],definition:''}]),/definition/);assert.throws(()=>validateWords([{...WORDS[0],id:'<script>'}]),/英文单词/);
});
test('module queues and retries stay within their own bank and exercise type',()=>{
 const p=createProfile();p.session=createModuleSession({spell:[WORDS[0],WORDS[1]],listen:[WORDS[2]]},p.progress,'spell');assert.ok(p.session.queue.every(t=>t.kind==='spell'&&['explore','challenge'].includes(t.wordId)));p.progress.protect=initialProgress(Date.now());recordAnswer(p,'wrong');assert.ok(p.session.queue.every(t=>t.kind==='spell'&&['explore','challenge'].includes(t.wordId)));
});
test('legacy cloze skill does not become listening mastery',()=>{
 const p=createProfile();p.progress.explore=initialProgress(Date.now());delete p.progress.explore.skills.listen;p.progress.explore.skills.cloze=5;assert.equal(normalizeProfile(p).progress.explore.skills.listen,0);
});
test('admin API enforces password, validation and revision conflict',async()=>{
 const request=(method,body,token='test-password')=>new Request('https://example.com/api/admin/catalog',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 let changed=0;const env={ADMIN_PASSWORD:'test-password',DB:{prepare(){return {bind(){return {run:async()=>({meta:{changes:changed}})}}}}}};
 assert.equal((await worker.fetch(request('GET',null,'bad'),env)).status,401);
 assert.equal((await worker.fetch(request('PUT',{revision:0,banks:{oops:[]}}),env)).status,400);
 assert.equal((await worker.fetch(request('PUT',{revision:0,banks:{spell:[WORDS[0]]}}),env)).status,409);
 changed=1;assert.equal((await worker.fetch(request('PUT',{revision:0,banks:{spell:[WORDS[0]]}}),env)).status,200);
});

test('demo module banks are separate and each lesson uses only its own words',async()=>{
 const {DEFAULT_MODULE_BANKS}=await import('../public/data/words.js');
 const all=Object.values(DEFAULT_MODULE_BANKS).flat().map(w=>w.id);
 assert.equal(new Set(all).size,all.length);
 assert.deepEqual(Object.values(DEFAULT_MODULE_BANKS).map(words=>words.length),[5,5,4,4]);
 for(const [kind,words] of Object.entries(DEFAULT_MODULE_BANKS)){
  const session=createModuleSession(DEFAULT_MODULE_BANKS,{},kind);
  assert.equal(session.queue.length,words.length);
  assert.ok(session.queue.every(t=>t.kind===kind&&words.some(w=>w.id===t.wordId)));
 }
});

test('recognition bank requires distinct meanings so its choices stay meaningful',async()=>{
 let wrote=false;
 const env={ADMIN_PASSWORD:'test-password',DB:{prepare(){wrote=true;throw Error('must not write');}}};
 const request=new Request('https://example.com/api/admin/catalog',{method:'PUT',headers:{Authorization:'Bearer test-password','Content-Type':'application/json'},body:JSON.stringify({revision:0,banks:{recognize:[WORDS[0]]}})});
 assert.equal((await worker.fetch(request,env)).status,400);
 assert.equal(wrote,false);
});
