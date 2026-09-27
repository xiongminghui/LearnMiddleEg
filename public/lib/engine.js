/** Pure learning/session state transitions. No DOM, network, or browser storage. */
import {cloneState,uuid} from './compat.js';
import {DAY,RELEARN_INTERVAL,initialReview,moduleProgress,upgradeProgress,summarizeProgress,finishReview} from './review.js';
export {uuid};
export {DAY,stageLabel} from './review.js';
export const MAX_STEPS = 48;
export function dayKey(time=Date.now()) {
  const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function shuffle(values,random=Math.random) {
  const copy=[...values];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;
}
export function initialProgress(now) {
  return {introducedAt:now,dueAt:now,stage:0,lapses:0,skills:{recognize:0,spell:0,listen:0},lastReviewedAt:null,introAt:null,reviews:{}};
}
export function dueWords(words,progress,now=Date.now(),kind=null) {
  const state=id=>kind?moduleProgress(progress[id],kind):progress[id];
  return words.filter(w=>state(w.id)&&Number.isFinite(state(w.id).dueAt)&&state(w.id).dueAt<=now).sort((a,b)=>state(a.id).dueAt-state(b.id).dueAt||state(b.id).lapses-state(a.id).lapses);
}
export function planLesson(words,progress,now=Date.now(),practiceId=null) {
  if(practiceId) return {fresh:[words.find(w=>w.id===practiceId)].filter(Boolean),reviews:[],mode:'practice',newToday:0};
  const newToday=words.filter(w=>progress[w.id]&&dayKey(progress[w.id].introducedAt)===dayKey(now)).length;
  const fresh=words.filter(w=>!progress[w.id]).slice(0,Math.max(0,3-newToday));
  const reviews=dueWords(words,progress,now).slice(0,6);
  if(!fresh.length&&!reviews.length) {
    const reinforce=words.filter(w=>progress[w.id]).sort((a,b)=>progress[a.id].stage-progress[b.id].stage||progress[b.id].lapses-progress[a.id].lapses).slice(0,3);
    return {fresh:[],reviews:reinforce,mode:'reinforce',newToday};
  }
  return {fresh,reviews,mode:'guided',newToday};
}
function task(wordId,kind,attempt=0){return {id:uuid(),wordId,kind,attempt};}
export function createSession(words,progress,now=Date.now(),practiceId=null) {
  const plan=planLesson(words,progress,now,practiceId);
  const queue=plan.reviews.map(w=>task(w.id,!progress[w.id].skills.spell?'spell':!progress[w.id].skills.listen?'listen':progress[w.id].skills.spell<=progress[w.id].skills.listen?'spell':'listen'));
  for(const kind of ['intro','recognize','spell','listen'])for(const word of plan.fresh)queue.push(task(word.id,kind));
  const ids=[...new Set(queue.map(t=>t.wordId))];
  return {id:uuid(),mode:plan.mode,createdAt:now,index:0,queue,answers:[],feedback:null,finishedAt:null,
    freshIds:plan.fresh.filter(w=>!progress[w.id]).map(w=>w.id),reviewIds:plan.reviews.map(w=>w.id),
    baseline:Object.fromEntries(ids.map(id=>[id,progress[id]?cloneState(progress[id]):null]))};
}
export function createModuleSession(banks,progress,kind=null,now=Date.now()) {
  const queue=[];
  for(const [module,words] of Object.entries(banks))if(!kind||kind===module){
    const fresh=words.filter(w=>!moduleProgress(progress[w.id],module)),due=dueWords(words,progress,now,module);
    const ready=module==='intro'?fresh:[...due,...fresh];
    // Future words are only offered as explicitly labelled early practice when
    // no new/due items remain. They never fill or displace a scheduled round.
    const ordered=ready.length?ready:[...words].sort((a,b)=>{
      const left=moduleProgress(progress[a.id],module),right=moduleProgress(progress[b.id],module);
      return module==='intro'?left.lastReviewedAt-right.lastReviewedAt:left.dueAt-right.dueAt;
    });
    for(const w of ordered.slice(0,kind?10:3))queue.push(task(w.id,module));
  }
  const ids=[...new Set(queue.map(t=>t.wordId))];
  const freshIds=ids.filter(id=>queue.some(t=>t.wordId===id&&!moduleProgress(progress[id],t.kind)));
  return {id:uuid(),mode:'practice',moduleKind:kind||'all',createdAt:now,index:0,queue,answers:[],feedback:null,finishedAt:null,freshIds,reviewIds:ids.filter(id=>!freshIds.includes(id)),baseline:Object.fromEntries(ids.map(id=>[id,progress[id]?cloneState(progress[id]):null]))};
}
export const currentTask = session => session?.queue[session.index] || null;
export function choicesFor(task,words) {
  // Stable per task, including after a reload. No answer-position bias.
  let seed=[...task.id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  return shuffle([words.find(w=>w.id===task.wordId),...shuffle(words.filter(w=>w.id!==task.wordId),random).slice(0,3)],random);
}
export function recordAnswer(profile,response,{assisted=false,skip=false,now=Date.now(),latencyMs=0}={}) {
  const s=profile.session,t=currentTask(s);
  if(!t||s.feedback||s.finishedAt) return null;
  const isIntro=t.kind==='intro';
  const correct=isIntro||(!skip&&String(response).trim().toLowerCase()===t.wordId);
  const independent=!isIntro&&correct&&!assisted;
  const progress=profile.progress[t.wordId] ||= initialProgress(now);
  upgradeProgress(progress);
  if(isIntro)progress.introAt=now;
  else {
    const review=progress.reviews[t.kind] ||= initialReview(now);
    progress.lastReviewedAt=now;
    if(independent)progress.skills[t.kind]=Math.min(20,(progress.skills[t.kind]||0)+1);
    else {progress.skills[t.kind]=0;progress.lapses++;review.lapses++;review.stage=0;review.dueAt=now+RELEARN_INTERVAL;review.lastReviewedAt=now;}
    summarizeProgress(progress);
  }
  const answer={taskId:t.id,wordId:t.wordId,kind:t.kind,attempt:t.attempt,correct,independent,assisted,skip,at:now};
  s.answers.push(answer);
  let retryQueued=false;
  if(!isIntro&&!independent&&t.attempt<2&&s.queue.length<MAX_STEPS) {
    const remaining=s.queue.length-s.index-1;
    const gap=[];
    if(remaining<2) {
      const other=s.moduleKind?s.queue.filter(q=>q.kind===t.kind&&q.wordId!==t.wordId).map(q=>q.wordId):Object.keys(profile.progress).filter(id=>id!==t.wordId);
      for(let i=0;i<2-remaining&&other.length;i++) {
        const id=other[i%other.length];gap.push(task(id,s.moduleKind?t.kind:i%2?'listen':'recognize',2));
        if(!(id in s.baseline))s.baseline[id]=cloneState(profile.progress[id]);
      }
    }
    if(remaining+gap.length>=2&&s.queue.length+gap.length+1<=MAX_STEPS) {
      s.queue.push(...gap);
      s.queue.splice(s.index+3,0,task(t.wordId,t.kind,t.attempt+1));retryQueued=true;
    }
  }
  const event={id:uuid(),sessionId:s.id,wordId:t.wordId,eventType:isIntro?'introduced':'answered',exerciseType:t.kind,
    result:isIntro?'seen':independent?'correct':correct?'assisted':skip?'skipped':'incorrect',assisted,occurredAt:now,latencyMs:Math.min(3600000,Math.max(0,Math.round(latencyMs)))};
  profile.pendingEvents.push(event);
  s.feedback={...answer,retryQueued};
  return s.feedback;
}
export function advanceSession(profile,now=Date.now()) {
  const s=profile.session;if(!s||!s.feedback||s.finishedAt)return false;
  s.index++;s.feedback=null;
  if(s.index<s.queue.length)return true;
  finalizeSession(profile,now);return true;
}
export function finalizeSession(profile,now=Date.now()) {
  const s=profile.session;if(!s||s.finishedAt||s.index<s.queue.length)return;
  const graded=s.answers.filter(a=>a.kind!=='intro');
  for(const id of new Set(graded.map(a=>a.wordId))) {
    for(const kind of new Set(graded.filter(a=>a.wordId===id).map(a=>a.kind))){
      const answers=graded.filter(a=>a.wordId===id&&a.kind===kind);
      finishReview(profile.progress[id],kind,moduleProgress(s.baseline[id],kind),answers.every(a=>a.independent),s.createdAt,now);
    }
  }
  s.finishedAt=now;
  const first=graded.filter(a=>a.attempt===0);
  const summary={id:s.id,at:now,mode:s.mode,moduleKind:s.moduleKind||'all',newCount:s.freshIds.length,reviewCount:s.reviewIds.length,
    correct:first.filter(a=>a.independent).length,total:first.length,retries:graded.length-first.length,
    weakIds:[...new Set(graded.filter(a=>!a.independent).map(a=>a.wordId))],wordIds:[...new Set(graded.map(a=>a.wordId))]};
  profile.history.unshift(summary);profile.history=profile.history.slice(0,120);
  profile.pendingEvents.push({id:uuid(),sessionId:s.id,wordId:null,eventType:'completed',exerciseType:null,result:null,assisted:false,occurredAt:now,latencyMs:0});
}
