/** Pure learning/session state transitions. No DOM, network, or browser storage. */
export const INTERVAL_DAYS = [1,3,7,14,30];
export const DAY = 86400000;
export const MAX_STEPS = 48;
export const uuid = () => crypto.randomUUID();
export function dayKey(time=Date.now()) {
  const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function shuffle(values,random=Math.random) {
  const copy=[...values];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;
}
export function initialProgress(now) {
  return {introducedAt:now,dueAt:now,stage:0,lapses:0,skills:{recognize:0,spell:0,listen:0},lastReviewedAt:null};
}
export function dueWords(words,progress,now=Date.now()) {
  return words.filter(w=>progress[w.id]&&progress[w.id].dueAt<=now).sort((a,b)=>progress[a.id].dueAt-progress[b.id].dueAt||progress[b.id].lapses-progress[a.id].lapses);
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
    baseline:Object.fromEntries(ids.map(id=>[id,progress[id]?structuredClone(progress[id]):null]))};
}
export function createModuleSession(banks,progress,kind=null,now=Date.now()) {
  const queue=[];
  for(const [module,words] of Object.entries(banks))if(!kind||kind===module){
    const ordered=[...dueWords(words,progress,now),...words.filter(w=>!progress[w.id]),...words.filter(w=>progress[w.id]&&progress[w.id].dueAt>now)];
    for(const w of ordered.slice(0,kind?10:3))queue.push(task(w.id,module));
  }
  const ids=[...new Set(queue.map(t=>t.wordId))];
  return {id:uuid(),mode:'practice',moduleKind:kind||'all',createdAt:now,index:0,queue,answers:[],feedback:null,finishedAt:null,freshIds:ids.filter(id=>!progress[id]),reviewIds:ids.filter(id=>progress[id]),baseline:Object.fromEntries(ids.map(id=>[id,progress[id]?structuredClone(progress[id]):null]))};
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
  if(!isIntro) {
    progress.lastReviewedAt=now;
    if(independent)progress.skills[t.kind]=Math.min(20,(progress.skills[t.kind]||0)+1);
    else {progress.skills[t.kind]=0;progress.lapses++;progress.stage=0;progress.dueAt=now+600000;}
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
        if(!(id in s.baseline))s.baseline[id]=structuredClone(profile.progress[id]);
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
    const p=profile.progress[id],answers=graded.filter(a=>a.wordId===id),baseline=s.baseline[id];
    const clean=answers.every(a=>a.independent);
    if(!clean || !p.skills.spell || !p.skills.listen) {p.stage=0;p.dueAt=now+600000;}
    else if(!baseline || baseline.dueAt<=s.createdAt) {
      p.stage=Math.min(5,(baseline?.stage||0)+1);p.dueAt=now+INTERVAL_DAYS[p.stage-1]*DAY;
    }
    // Early successful practice preserves the existing interval and due date.
  }
  s.finishedAt=now;
  const first=graded.filter(a=>a.attempt===0);
  const summary={id:s.id,at:now,mode:s.mode,newCount:s.freshIds.length,reviewCount:s.reviewIds.length,
    correct:first.filter(a=>a.independent).length,total:first.length,retries:graded.length-first.length,
    weakIds:[...new Set(graded.filter(a=>!a.independent).map(a=>a.wordId))],wordIds:[...new Set(graded.map(a=>a.wordId))]};
  profile.history.unshift(summary);profile.history=profile.history.slice(0,120);
  profile.pendingEvents.push({id:uuid(),sessionId:s.id,wordId:null,eventType:'completed',exerciseType:null,result:null,assisted:false,occurredAt:now,latencyMs:0});
}
export function stageLabel(p){return !p?'未学习':p.stage===0?'学习中':p.stage===1?'初步记住':p.stage<4?'逐渐稳固':'长期巩固';}
