import { WORD_MAP } from '../data/words.js';
import {hasOwn,cloneState} from './compat.js';
import { validEvent,validId } from './protocol.js';
import { initialProgress } from './engine.js';
import {MODULES} from './catalog.js';
import {rememberSession} from './sessions.js';
import {profileKey,selectAccountState,writeSyncState} from './account-state.js';
const account=typeof window!=='undefined'?window.wordIslandAccount:null;
export const STORAGE_KEY=profileKey(account);
export function createProfile(){return {version:1,progress:{},session:null,sessions:{},history:[],pendingEvents:[],preferences:{autoAdvance:true},favorites:[]};}
const finiteTime=n=>Number.isFinite(n)&&n>=0&&n<=8640000000000000;
function validProgress(p){return p&&finiteTime(p.introducedAt)&&finiteTime(p.dueAt)&&Number.isInteger(p.stage)&&p.stage>=0&&p.stage<=5&&Number.isInteger(p.lapses)&&p.lapses>=0&&p.skills&&['recognize','spell','listen'].every(k=>Number.isInteger(p.skills[k])&&p.skills[k]>=0&&p.skills[k]<=20);}
const known=id=>typeof id==='string'&&hasOwn(WORD_MAP,id);
function validSession(s,knownWord=known){
  return s&&validId(s.id)&&['guided','practice','reinforce'].includes(s.mode)&&finiteTime(s.createdAt)&&Array.isArray(s.queue)&&s.queue.length>0&&s.queue.length<=48&&s.queue.every(t=>validId(t.id)&&knownWord(t.wordId)&&['intro','recognize','spell','listen'].includes(t.kind)&&Number.isInteger(t.attempt)&&t.attempt>=0&&t.attempt<=2)&&(s.moduleKind===undefined||s.moduleKind==='all'||(hasOwn(MODULES,s.moduleKind)&&s.queue.every(t=>t.kind===s.moduleKind)))&&Number.isInteger(s.index)&&s.index>=0&&s.index<=s.queue.length&&Array.isArray(s.answers)&&s.answers.length<=48&&s.answers.every(a=>validId(a.taskId)&&knownWord(a.wordId)&&['intro','recognize','spell','listen'].includes(a.kind)&&typeof a.independent==='boolean'&&typeof a.correct==='boolean'&&finiteTime(a.at))&&Array.isArray(s.freshIds)&&s.freshIds.every(knownWord)&&Array.isArray(s.reviewIds)&&s.reviewIds.every(knownWord)&&s.baseline&&Object.entries(s.baseline).every(([id,p])=>knownWord(id)&&(p===null||validProgress(p)))&&(s.finishedAt===null||finiteTime(s.finishedAt))&&(s.feedback===null||(s.index<s.queue.length&&s.feedback.taskId===s.queue[s.index].id&&typeof s.feedback.correct==='boolean'));
}
export function normalizeProfile(raw,wordMap=WORD_MAP){
  const known=id=>typeof id==='string'&&hasOwn(wordMap,id);
  if(!raw||raw.version!==1||!raw.progress||typeof raw.progress!=='object')throw new Error('不是可识别的词屿备份文件。');
  // Old cloze performance is not evidence of listening skill. Keep progress and
  // events, but restart an unfinished legacy round under the new curriculum.
  raw=cloneState(raw);
  for(const p of Object.values(raw.progress))if(p?.skills&&p.skills.listen===undefined&&Number.isInteger(p.skills.cloze))p.skills.listen=0;
  if(raw.session?.queue?.some(t=>t.kind==='cloze'))raw.session=null;
  const profile=createProfile();
  for(const [id,p] of Object.entries(raw.progress))if(known(id)&&validProgress(p))profile.progress[id]=cloneState(p);
  profile.session=validSession(raw.session,known)?cloneState(raw.session):null;
  for(const kind of Object.keys(MODULES)){
    const session=raw.sessions?.[kind];
    if(validSession(session,known)&&session.moduleKind===kind&&session.queue.every(task=>task.kind===kind))profile.sessions[kind]=cloneState(session);
  }
  // Migrate the former single active round and keep it linked to its module.
  rememberSession(profile);
  profile.history=Array.isArray(raw.history)?raw.history.filter(h=>h&&validId(h.id)&&finiteTime(h.at)&&['newCount','reviewCount','correct','total','retries'].every(k=>Number.isInteger(h[k])&&h[k]>=0)&&Array.isArray(h.weakIds)&&h.weakIds.every(known)&&Array.isArray(h.wordIds)&&h.wordIds.every(known)).slice(0,120):[];
  profile.pendingEvents=Array.isArray(raw.pendingEvents)?raw.pendingEvents.filter(validEvent):[];
  profile.favorites=Array.isArray(raw.favorites)?[...new Set(raw.favorites.filter(known))]:[];
  profile.preferences.autoAdvance=raw.preferences?.autoAdvance!==false;
  return profile;
}
export function loadProfile(){
  if(account){
    let chosen;
    try{chosen=selectAccountState(account,localStorage);}catch{chosen={profile:account.remote.profile,revision:account.remote.revision,dirty:false,conflict:false};}
    Object.assign(account,{revision:chosen.revision,dirty:chosen.dirty,conflict:chosen.conflict});
    try{const profile=normalizeProfile(chosen.profile||createProfile());saveProfile(profile);writeSyncState(account,{revision:chosen.revision,dirty:chosen.dirty});return {profile,warning:null};}
    catch{return {profile:createProfile(),warning:'账号进度暂时无法读取，原始记录未覆盖。请导出备份后联系管理员。',readFailed:true};}
  }
  try {
    const text=localStorage.getItem(STORAGE_KEY);
    if(text)return {profile:normalizeProfile(JSON.parse(text)),warning:null};
    const profile=createProfile();
    // Import old self-assessment conservatively: no inferred spelling/application mastery.
    const old=JSON.parse(localStorage.getItem('word-island-demo-v1')||'null');
    if(old&&typeof old.statuses==='object'){
      for(const [id,status] of Object.entries(old.statuses))if(known(id)&&['known','again'].includes(status))profile.progress[id]=initialProgress(Date.now());
      profile.favorites=Array.isArray(old.favorites)?old.favorites.filter(known):[];
    }
    return {profile,warning:null};
  } catch {return {profile:createProfile(),warning:'本机记录暂时无法读取。原始记录未删除，你仍可学习并导出备份。',readFailed:true};}
}
export function saveProfile(profile){
  try{rememberSession(profile);localStorage.setItem(STORAGE_KEY,JSON.stringify(profile));return true;}catch{return false;}
}
let ephemeralToken;
export function deviceToken(){
  if(ephemeralToken)return ephemeralToken;
  try {const existing=localStorage.getItem('word-island-device-key');if(/^[0-9a-f]{64}$/.test(existing||''))return ephemeralToken=existing;}catch{}
  const bytes=crypto.getRandomValues(new Uint8Array(32));ephemeralToken=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  try{localStorage.setItem('word-island-device-key',ephemeralToken);}catch{}
  return ephemeralToken;
}
