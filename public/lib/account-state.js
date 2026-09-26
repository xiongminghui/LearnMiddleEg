export const LEGACY_STORAGE_KEY='word-island-project-v1';
export const profileKey=account=>account?`word-island-account-v1:${account.user.id}:${account.course.id}`:LEGACY_STORAGE_KEY;
export function writeSyncState(account,state){
 try{localStorage.setItem(profileKey(account)+':sync',JSON.stringify(state));return true;}catch{return false;}
}
export function selectAccountState(account,storage){
 let local,meta;
 try{local=JSON.parse(storage.getItem(profileKey(account))||'null');meta=JSON.parse(storage.getItem(profileKey(account)+':sync')||'null');}catch{}
 const pending=!!local&&meta?.dirty===true&&Number.isInteger(meta.revision)&&meta.revision>=0;
 return {profile:pending?local:account.remote.profile,revision:pending?meta.revision:account.remote.revision,dirty:pending,conflict:pending&&meta.revision!==account.remote.revision};
}
