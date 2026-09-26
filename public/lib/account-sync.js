import {requestJSON} from './request.js';
import {cloneState} from './compat.js';
import {profileKey,writeSyncState} from './account-state.js';
import {normalizeProfile,createProfile} from './store.js';
export function createAccountSync(getProfile,persist,onStatus,account,replaceProfile){
 let revision=account.revision,dirty=!!account.dirty,blocked=account.conflict?'conflict':null,busy=null,timer,sequence=0,stopped=false;
 const endpoint='/api/courses/'+encodeURIComponent(account.course.id)+'/progress';
 const remember=()=>writeSyncState(account,{revision,dirty});
 const report=()=>onStatus(blocked||(dirty?'syncing':'cloud'),blocked==='conflict'?'另一设备已更新进度，请选择继续使用哪份记录。':blocked==='auth'?'登录已失效或学习方向已调整，请重新登录。':dirty?'本机已保存 · 正在同步':'账号进度已同步');
 function changed(){dirty=true;sequence++;remember();report();clearTimeout(timer);if(!blocked&&!stopped)timer=setTimeout(flush,700);}
 function flush(){
  clearTimeout(timer);if(busy)return busy;
  if(stopped||blocked)return Promise.resolve(false);
  if(!dirty){report();return Promise.resolve(true);}
  const sentSequence=sequence,snapshot=cloneState(getProfile()),submitted=new Set(snapshot.pendingEvents.map(event=>event.id));
  busy=(async()=>{
   try{
    const result=await requestJSON(endpoint,{method:'PUT',headers:{'Content-Type':'application/json','X-Learner-Id':account.user.id},body:JSON.stringify({revision,profile:snapshot})});
    revision=result.revision;dirty=sequence!==sentSequence;
    getProfile().pendingEvents=getProfile().pendingEvents.filter(event=>!submitted.has(event.id));persist(true);remember();report();
    return !dirty;
   }catch(error){
    if(error.status===409)blocked='conflict';else if([401,403].includes(error.status))blocked='auth';
    remember();onStatus(blocked||'offline',blocked==='conflict'?'另一设备已更新进度。本机记录已保留，请选择继续使用哪份记录。':blocked==='auth'?'登录已失效或学习方向已调整，请重新登录。':'本机已保存 · 网络恢复后继续同步');return false;
   }finally{busy=null;if(dirty&&!blocked&&!stopped&&sequence!==sentSequence)timer=setTimeout(flush,700);}
  })();return busy;
 }
 async function resolveConflict(choice){
  if(busy)await busy;
  const remote=await requestJSON(endpoint,{headers:{'X-Learner-Id':account.user.id}});
  // Keep a recovery copy before the learner explicitly resolves a conflict.
  try{localStorage.setItem(profileKey(account)+':before-conflict',JSON.stringify(getProfile()));}catch{}
  revision=remote.revision;blocked=null;
  if(choice==='cloud'){replaceProfile(normalizeProfile(remote.profile||createProfile()));dirty=false;persist(true);remember();report();return true;}
  dirty=true;remember();return flush();
 }
 const online=()=>flush();const interval=setInterval(()=>{if(dirty)flush();},15000);
 window.addEventListener('online',online);
 return {changed,flush,resolveConflict,init(){report();if(dirty&&!blocked)flush();},stop(){stopped=true;clearTimeout(timer);clearInterval(interval);window.removeEventListener('online',online);}};
}
