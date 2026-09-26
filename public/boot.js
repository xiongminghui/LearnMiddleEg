import {MODULES,validateWords} from './lib/catalog.js';
// Fetch before restoring progress: never discard custom-word progress because
// a temporary API failure made the shared catalog appear empty.
let failed=false;
try {
 const response=await fetch('/api/catalog',{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
  const payload=await response.json();
  window.wordIslandPublished=Object.fromEntries(Object.entries(payload.banks).map(([k,v])=>{if(!Object.hasOwn(MODULES,k))throw Error('Invalid module');return [k,validateWords(v)];}));
 }else if(!response.ok&&response.status!==404)failed=true;
} catch {failed=true;}
if(failed){
 const main=document.getElementById('main');main.textContent='共享词库暂时无法读取。本机学习记录保持不变，请联网后重试。';
 const retry=document.createElement('button');retry.className='primary';retry.textContent='重新加载';retry.onclick=()=>location.reload();main.append(document.createElement('br'),retry);
}else await import('./app.js');
