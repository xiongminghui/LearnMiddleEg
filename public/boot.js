import {MODULES,validateWords} from './lib/catalog.js';
import {hasOwn} from './lib/compat.js';
import {requestJSON,canRetry} from './lib/request.js';
// Fetch before restoring progress: never discard custom-word progress because
// a temporary API failure made the shared catalog appear empty.
async function loadCatalog(){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const payload=await requestJSON('/api/catalog',{cache:'no-store',timeoutMs:30000});
   if(!payload||!payload.banks||typeof payload.banks!=='object'||Array.isArray(payload.banks))throw Error('共享词库格式不正确。');
   window.wordIslandPublished=Object.fromEntries(Object.entries(payload.banks).map(([k,v])=>{if(!hasOwn(MODULES,k))throw Error('共享词库包含未知模块。');return [k,validateWords(v)];}));
   return;
  }catch(error){
   if(error.status===404)return; // Standalone static preview has no API.
   if(attempt||!canRetry(error))throw error;
   document.getElementById('main').textContent='连接稍慢，正在重新读取共享词库，请再等一会儿…';
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }
}
function showFailure(message){
 const main=document.getElementById('main');main.textContent=message;
 const retry=document.createElement('button');retry.className='primary';retry.textContent='重新加载';retry.onclick=()=>location.reload();main.append(document.createElement('br'),retry);
}
async function start(){
 document.getElementById('main').textContent='正在读取共享词库，首次连接可能需要稍等…';
 try{await loadCatalog();}
 catch(error){showFailure('共享词库暂时无法读取。'+error.message+' 本机学习记录保持不变。');return;}
 try{await import('./app.js');}
 catch{showFailure('学习页面未能启动，请重新加载，或在 Safari 浏览器中打开后重试。');}
}
start();
