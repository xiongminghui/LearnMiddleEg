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
