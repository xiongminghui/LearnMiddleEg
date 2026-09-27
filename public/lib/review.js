// An application schedule inspired by early, then increasingly spaced review.
// These are intervals AFTER a successful review, not Ebbinghaus' measured
// savings percentages or a fitted prediction of an individual's memory.
export const MINUTE=60000;
export const DAY=86400000;
export const REVIEW_INTERVALS=[20*MINUTE,60*MINUTE,8*60*MINUTE,DAY,2*DAY,4*DAY,7*DAY,15*DAY,30*DAY];
export const REVIEW_LABELS=['20 分钟','1 小时','8 小时','1 天','2 天','4 天','7 天','15 天','30 天'];
export const RELEARN_INTERVAL=10*MINUTE;
export const REVIEW_KINDS=['recognize','spell','listen'];
const LEGACY_INTERVALS=[1,3,7,14,30].map(days=>days*DAY);

export function initialReview(now){return {stage:0,dueAt:now,lastReviewedAt:null,lapses:0};}
function legacyReview(p,kind){
  if(!p?.skills?.[kind])return null;
  // Preserve the old due date; map only skills with evidence of independent
  // recall. A global stage never proves mastery of an untested skill.
  const interval=LEGACY_INTERVALS[p.stage-1];
  const stage=p.stage?Math.max(1,REVIEW_INTERVALS.filter(value=>value<=interval).length):0;
  return {stage,dueAt:p.dueAt,lastReviewedAt:p.lastReviewedAt??p.introducedAt,lapses:0};
}
export function moduleProgress(p,kind){
  if(!p)return null;
  if(kind==='intro'){
    const at=p.introAt===undefined?p.introducedAt:p.introAt;
    return at===null?null:{lastReviewedAt:at};
  }
  return p.reviews===undefined?legacyReview(p,kind):p.reviews[kind]||null;
}
export function upgradeProgress(p){
  if(p.reviews===undefined)p.reviews=Object.fromEntries(REVIEW_KINDS.map(kind=>[kind,legacyReview(p,kind)]).filter(([,value])=>value));
  if(p.introAt===undefined)p.introAt=p.introducedAt;
  return p;
}
export function summarizeProgress(p){
  const reviews=Object.values(p.reviews);
  // Retain aggregate fields for old backups/consumers. Module scheduling never
  // reads them, so errors in one skill cannot reset another skill's interval.
  p.stage=reviews.length?Math.min(...reviews.map(r=>r.stage)):0;
  p.dueAt=reviews.length?Math.min(...reviews.map(r=>r.dueAt)):p.introducedAt;
}
export function finishReview(p,kind,baseline,clean,startedAt,now){
  upgradeProgress(p);
  const review=p.reviews[kind] ||= initialReview(now);
  if(!clean){review.stage=0;review.dueAt=now+RELEARN_INTERVAL;}
  else if(!baseline||baseline.dueAt<=startedAt){
    review.stage=Math.min(REVIEW_INTERVALS.length,(baseline?.stage||0)+1);
    review.dueAt=now+REVIEW_INTERVALS[review.stage-1];
  }
  review.lastReviewedAt=now;
  summarizeProgress(p);
}
export function moduleStats(words,progress,kind,now=Date.now()){
  let fresh=0,due=0,next=null;
  for(const word of words){
    const review=moduleProgress(progress[word.id],kind);
    if(!review)fresh++;
    else if(kind!=='intro'){
      if(review.dueAt<=now)due++;
      else next=next===null?review.dueAt:Math.min(next,review.dueAt);
    }
  }
  return {fresh,due,next};
}
export function stageLabel(p,kind){
  if(kind==='intro')return moduleProgress(p,kind)?'已浏览':'未浏览';
  const review=kind?moduleProgress(p,kind):p;
  return !review?'未练习':review.lastReviewedAt===null?'待完成本轮':review.stage===0?'待巩固':review.stage<4?'短期复习':review.stage<7?'间隔复习':'长期巩固';
}
