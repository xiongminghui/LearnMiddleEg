import test from 'node:test';
import assert from 'node:assert/strict';
import {WORDS} from '../public/data/words.js';
import {createProfile,normalizeProfile} from '../public/lib/store.js';
import {createSession,recordAnswer,advanceSession,currentTask,initialProgress,planLesson,choicesFor,DAY,MAX_STEPS} from '../public/lib/engine.js';
const now=new Date('2026-09-26T10:00:00Z').getTime();
function begin(progress={},id=null){const p=createProfile();p.progress=progress;p.session=createSession(WORDS,progress,now,id);return p;}
function allCorrect(p){let n=0;while(!p.session.finishedAt){assert.ok(n++<60);const t=currentTask(p.session);recordAnswer(p,t.wordId,{now:now+n*100});advanceSession(p,now+n*100);}return p;}

test('first lesson is three words with introduction, recognition, spelling and listening',()=>{
 const p=begin();assert.equal(p.session.queue.length,12);assert.deepEqual(p.session.freshIds,['explore','challenge','protect']);
 assert.deepEqual(p.session.queue.map(t=>t.kind),['intro','intro','intro','recognize','recognize','recognize','spell','spell','spell','listen','listen','listen']);
 allCorrect(p);for(const id of p.session.freshIds){assert.equal(p.progress[id].stage,1);assert.equal(p.progress[id].dueAt,p.session.finishedAt+DAY);}
 assert.equal(p.history[0].correct,9);assert.equal(p.history[0].total,9);assert.equal(p.history.length,1);
 assert.equal(p.pendingEvents.filter(e=>e.eventType==='completed').length,1);
});
test('daily new-word allowance persists and successful early practice does not advance intervals',()=>{
 const p=allCorrect(begin());assert.equal(planLesson(WORDS,p.progress,now+10000).fresh.length,0);
 const before=structuredClone(p.progress.explore);p.session=createSession(WORDS,p.progress,now+10000,'explore');allCorrect(p);
 assert.equal(p.progress.explore.dueAt,before.dueAt);assert.equal(p.progress.explore.stage,before.stage);
});
test('due words precede new learning; due successful retrieval extends interval',()=>{
 const progress=initialProgress(now-DAY*2);progress.skills={recognize:1,spell:1,listen:1};progress.stage=1;progress.dueAt=now-1;
 const p=begin({explore:progress});assert.equal(p.session.queue[0].wordId,'explore');assert.equal(p.session.queue[0].kind,'spell');
 allCorrect(p);assert.equal(p.progress.explore.stage,2);assert.equal(p.progress.explore.dueAt,p.session.finishedAt+DAY*3);
});
test('wrong answers are separated by at least two intervening tasks',()=>{
 const p=begin();for(let i=0;i<3;i++){recordAnswer(p,'seen',{now});advanceSession(p,now);}
 const original=currentTask(p.session);recordAnswer(p,'wrong',{now});
 assert.equal(p.session.feedback.retryQueued,true);const retry=p.session.queue.findIndex(t=>t.wordId===original.wordId&&t.kind===original.kind&&t.attempt===1);
 assert.equal(retry-p.session.index,3);assert.equal(p.progress[original.wordId].dueAt,now+600000);
});
test('hint-assisted correct answers never count as independent mastery',()=>{
 const p=begin();for(let i=0;i<3;i++){recordAnswer(p,'seen',{now});advanceSession(p,now);}
 const t=currentTask(p.session);recordAnswer(p,t.wordId,{assisted:true,now});assert.equal(p.session.feedback.correct,true);assert.equal(p.session.feedback.independent,false);assert.equal(p.progress[t.wordId].skills.recognize,0);
 advanceSession(p,now);allCorrect(p);assert.equal(p.progress[t.wordId].stage,0);assert.equal(p.progress[t.wordId].dueAt,p.session.finishedAt+600000);assert.ok(p.history[0].weakIds.includes(t.wordId));
});
test('session resumes from saved feedback and duplicate submits/advances are harmless',()=>{
 const p=begin();recordAnswer(p,'seen',{now});const restored=normalizeProfile(JSON.parse(JSON.stringify(p)));
 assert.equal(restored.session.feedback.taskId,currentTask(restored.session).id);assert.equal(recordAnswer(restored,'seen',{now}),null);
 assert.equal(advanceSession(restored,now),true);assert.equal(advanceSession(restored,now),false);assert.equal(restored.session.index,1);
});
test('continual errors terminate within the bounded step budget',()=>{
 const p=begin();let n=0;while(!p.session.finishedAt){assert.ok(n++<MAX_STEPS+1);recordAnswer(p,'incorrect',{now});advanceSession(p,now);}
 assert.ok(p.session.queue.length<=MAX_STEPS);assert.equal(p.history[0].correct,0);
});
test('single-word practice without other words defers an immediate repeat',()=>{
 const p=begin({},'explore');for(let i=0;i<3;i++){const t=currentTask(p.session);recordAnswer(p,t.wordId,{now});advanceSession(p,now);}
 recordAnswer(p,'incorrect',{now});assert.equal(p.session.feedback.retryQueued,false);advanceSession(p,now);assert.ok(p.session.finishedAt);assert.equal(p.progress.explore.dueAt,now+600000);
});
test('choices are stable, varied, and contain exactly one correct option',()=>{
 const positions=new Set();for(let i=0;i<12;i++){const t=createSession(WORDS,{},now).queue.find(t=>t.kind==='recognize');const options=choicesFor(t,WORDS);assert.deepEqual(options,choicesFor(t,WORDS));assert.equal(options.length,4);assert.equal(new Set(options.map(w=>w.id)).size,4);positions.add(options.findIndex(w=>w.id===t.wordId));}assert.ok(positions.size>1);
});
test('corrupt saved items are excluded rather than reaching the learning engine',()=>{
 const raw=createProfile();raw.progress.explore={stage:999};raw.progress.unknown=initialProgress(now);raw.session={index:-1};raw.pendingEvents=[{id:'unsafe'}];
 const clean=normalizeProfile(raw);assert.deepEqual(clean.progress,{});assert.equal(clean.session,null);assert.deepEqual(clean.pendingEvents,[]);assert.throws(()=>normalizeProfile({version:99}));
});
