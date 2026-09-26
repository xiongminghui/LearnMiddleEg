import {MODULES} from './catalog.js';
import {hasOwn} from './compat.js';
import {createModuleSession,currentTask} from './engine.js';

export function rememberSession(profile){
  profile.sessions ||= {};
  const session=profile.session;
  if(session&&hasOwn(MODULES,session.moduleKind))profile.sessions[session.moduleKind]=session;
}

export function enterModule(profile,banks,kind,now=Date.now()){
  if(!hasOwn(MODULES,kind))throw new Error('Unknown learning module');
  rememberSession(profile);
  const saved=profile.sessions[kind];
  const stillInBank=saved?.queue.every(task=>banks[kind].some(word=>word.id===task.wordId));
  profile.session=saved&&!saved.finishedAt&&stillInBank?saved:createModuleSession(banks,profile.progress,kind,now);
  rememberSession(profile);
  return profile.session;
}

export function canAutoAdvance(profile){
  return !!profile.preferences.autoAdvance&&!!profile.session?.feedback?.independent&&['recognize','listen'].includes(currentTask(profile.session)?.kind);
}
