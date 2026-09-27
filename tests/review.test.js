import test from 'node:test';
import assert from 'node:assert/strict';
import {WORDS} from '../public/data/words.js';
import {createProfile,normalizeProfile} from '../public/lib/store.js';
import {createModuleSession,currentTask,recordAnswer,advanceSession,initialProgress,dueWords} from '../public/lib/engine.js';
import {enterModule} from '../public/lib/sessions.js';
import {MINUTE,DAY,REVIEW_INTERVALS,moduleProgress,moduleStats,stageLabel} from '../public/lib/review.js';
const now=Date.parse('2026-09-27T09:00:00Z');
const word=WORDS[0],id=word.id;
const banks={intro:[word],recognize:[word,WORDS[1]],spell:[word],listen:[word]};
function round(p,kind,time,response=id,options={}){
 p.session=createModuleSession({[kind]:[word]},p.progress,kind,time);
 recordAnswer(p,response,{now:time,...options});advanceSession(p,time);
 assert.ok(p.session.finishedAt);return p.progress[id].reviews[kind];
}

test('a listening-only word completes all nine intervals without spelling or recognition',()=>{
 const p=createProfile();let time=now;
 for(const [i,interval] of REVIEW_INTERVALS.entries()){
  const review=round(p,'listen',time);
  assert.equal(review.stage,i+1);assert.equal(review.dueAt,time+interval);
  assert.equal(moduleStats([word],p.progress,'listen',time).due,0);
  assert.equal(moduleStats([word],p.progress,'listen',review.dueAt).due,1);
  time=review.dueAt;
 }
 const review=round(p,'listen',time);
 assert.equal(review.stage,9);assert.equal(review.dueAt,time+30*DAY);
 assert.equal(p.progress[id].skills.spell,0);assert.equal(moduleProgress(p.progress[id],'spell'),null);
 assert.equal(moduleProgress(p.progress[id],'recognize'),null);
 assert.equal(stageLabel(p.progress[id],'listen'),'长期巩固');
 assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).progress,p.progress);
});

test('each ability first schedules 20 minutes; seeing a word does not establish recall',()=>{
 const p=createProfile();round(p,'intro',now);
 assert.deepEqual(p.progress[id].reviews,{});assert.equal(stageLabel(p.progress[id],'intro'),'已浏览');
 assert.equal(moduleStats([word],p.progress,'spell',now).fresh,1);
 for(const kind of ['recognize','spell','listen']){
  const review=round(p,kind,now+MINUTE);assert.equal(review.stage,1);assert.equal(review.dueAt,now+21*MINUTE);
  assert.equal(p.history[0].newCount,1);assert.equal(p.history[0].moduleKind,kind);
 }
});

test('early successes preserve the due date; overdue recall advances just one interval',()=>{
 const p=createProfile();const first={...round(p,'spell',now)};
 for(let i=1;i<=3;i++){
  const review=round(p,'spell',now+i*MINUTE);assert.equal(review.stage,1);assert.equal(review.dueAt,first.dueAt);
 }
 const late=round(p,'spell',now+14*DAY);
 assert.equal(late.stage,2);assert.equal(late.dueAt,now+14*DAY+60*MINUTE);
});

test('wrong, skipped and hinted answers relearn only the tested skill after ten minutes',()=>{
 for(const options of [{response:'wrong'},{skip:true},{assisted:true}]){
  const p=createProfile();round(p,'listen',now);round(p,'spell',now);
  const listening={...p.progress[id].reviews.listen};
  const spell=round(p,'spell',now+MINUTE,options.response||id,options);
  assert.equal(spell.stage,0);assert.equal(spell.dueAt,now+11*MINUTE);assert.equal(spell.lapses,1);
  assert.deepEqual(p.progress[id].reviews.listen,listening);assert.equal(p.history[0].correct,0);
  const retried=round(p,'spell',now+2*MINUTE);assert.equal(retried.stage,0);assert.equal(retried.dueAt,now+11*MINUTE);
  const recovered=round(p,'spell',now+11*MINUTE);assert.equal(recovered.stage,1);assert.equal(recovered.dueAt,now+31*MINUTE);
 }
});

test('a same-round retry cannot turn a missed word into a passed interval',()=>{
 const p=createProfile();p.session=createModuleSession({spell:WORDS.slice(0,3)},p.progress,'spell',now);
 recordAnswer(p,'wrong',{now});assert.equal(p.session.feedback.retryQueued,true);advanceSession(p,now);
 let count=0;while(!p.session.finishedAt){assert.ok(count++<48);recordAnswer(p,currentTask(p.session).wordId,{now:now+MINUTE});advanceSession(p,now+MINUTE);}
 assert.equal(p.progress[id].reviews.spell.stage,0);assert.equal(p.progress[id].reviews.spell.dueAt,now+11*MINUTE);
 assert.equal(p.history[0].correct,2);assert.equal(p.history[0].total,3);
 assert.equal(p.progress[WORDS[1].id].reviews.spell.stage,1);
});

test('queues prioritize this module’s due words then new words, without padding future reviews',()=>{
 const p=createProfile();round(p,'spell',now);round(p,'listen',now+5*MINUTE);
 const future=WORDS[1],futureP=initialProgress(now);futureP.reviews.spell={stage:4,dueAt:now+DAY,lastReviewedAt:now,lapses:0};p.progress[future.id]=futureP;
 const words=[future,WORDS[2],word];
 const queue=createModuleSession({spell:words},p.progress,'spell',now+21*MINUTE);
 assert.deepEqual(queue.queue.map(t=>t.wordId),[id,WORDS[2].id]);assert.deepEqual(queue.freshIds,[WORDS[2].id]);
 assert.equal(dueWords([word],p.progress,now+21*MINUTE,'listen').length,0);
 assert.equal(dueWords([word],p.progress,now+21*MINUTE,'spell').length,1);
 const other=createModuleSession({recognize:[word]},p.progress,'recognize',now+21*MINUTE);assert.deepEqual(other.freshIds,[id]);
 const early=createModuleSession({spell:[future]},p.progress,'spell',now);assert.deepEqual(early.reviewIds,[future.id]);
});

test('interleaved and reloaded modules retain independent baselines and schedules',()=>{
 let p=createProfile();round(p,'spell',now);round(p,'listen',now);
 enterModule(p,banks,'spell',now+20*MINUTE);recordAnswer(p,id,{now:now+20*MINUTE});
 enterModule(p,banks,'listen',now+20*MINUTE);recordAnswer(p,'wrong',{now:now+20*MINUTE});advanceSession(p,now+20*MINUTE);
 p=normalizeProfile(JSON.parse(JSON.stringify(p)));
 enterModule(p,banks,'spell',now+21*MINUTE);advanceSession(p,now+21*MINUTE);
 assert.equal(p.progress[id].reviews.spell.stage,2);assert.equal(p.progress[id].reviews.spell.dueAt,now+81*MINUTE);
 assert.equal(p.progress[id].reviews.listen.stage,0);assert.equal(p.progress[id].reviews.listen.dueAt,now+30*MINUTE);
});

test('legacy migration preserves due dates, histories and paused rounds without inventing untested skill mastery',()=>{
 let p=createProfile();round(p,'listen',now);
 const old={introducedAt:now-DAY,dueAt:now+3*DAY,stage:2,lapses:2,skills:{recognize:1,spell:0,listen:2},lastReviewedAt:now};
 p.progress[id]=old;enterModule(p,banks,'listen',now+MINUTE);
 const before=JSON.parse(JSON.stringify(p)),restored=normalizeProfile(before);
 assert.equal(restored.progress[id].reviews.listen.dueAt,old.dueAt);assert.equal(restored.progress[id].reviews.listen.stage,5);
 assert.equal(restored.progress[id].reviews.recognize.dueAt,old.dueAt);assert.equal(restored.progress[id].reviews.spell,undefined);
 assert.equal(restored.progress[id].lapses,2);assert.deepEqual(restored.history,p.history);
 assert.equal(restored.session.id,p.session.id);assert.equal(restored.session,restored.sessions.listen);
 assert.equal(restored.session.baseline[id].reviews.listen.dueAt,old.dueAt);
 assert.equal(before.progress[id].reviews,undefined);assert.deepEqual(normalizeProfile(restored),restored);
 recordAnswer(restored,id,{now:now+MINUTE});advanceSession(restored,now+MINUTE);
 assert.equal(restored.progress[id].reviews.listen.dueAt,old.dueAt);
});

test('invalid module review fields cannot enter restored progress',()=>{
 for(const bad of [{stage:10},{dueAt:-1},{lastReviewedAt:'yesterday'},{lapses:-1}]){
  const p=createProfile();round(p,'spell',now);Object.assign(p.progress[id].reviews.spell,bad);
  assert.equal(normalizeProfile(p).progress[id],undefined);
 }
 const p=createProfile();round(p,'spell',now);p.progress[id].reviews.untrusted={...p.progress[id].reviews.spell};
 assert.equal(normalizeProfile(p).progress[id],undefined);
});
