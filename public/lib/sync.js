import { deviceToken } from './store.js';
export function createSync(getProfile,persist,onStatus){
  let available=false,busy=false;
  async function request(path,options={}){
    const response=await fetch(path,{...options,signal:AbortSignal.timeout(8000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Unavailable');
    return response.json();
  }
  async function flush(){
    if(!available||busy)return;const events=getProfile().pendingEvents.slice(0,40);
    if(!events.length){onStatus('cloud','本机已保存 · 云端已备份');return;}
    busy=true;
    try{
      const data=await request('/api/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+deviceToken()},body:JSON.stringify({events})});
      const submitted=new Set(events.map(e=>e.id));const acknowledged=new Set(Array.isArray(data.acknowledged)?data.acknowledged.filter(id=>submitted.has(id)):[]);
      if(!acknowledged.size)throw new Error('No events acknowledged');
      getProfile().pendingEvents=getProfile().pendingEvents.filter(e=>!acknowledged.has(e.id));persist();
      onStatus('cloud',getProfile().pendingEvents.length?'本机已保存 · 正在备份':'本机已保存 · 云端已备份');
    }catch{onStatus('offline','本机已保存 · 云端稍后重试');}
    finally{busy=false;}
  }
  async function init(){
    try{const data=await request('/api/status');available=data.storage==='postgres';onStatus(available?'cloud':'local',available?'本机已保存 · 云端已连接':'学习记录保存在本机');if(available)await flush();}
    catch{onStatus('local','学习记录保存在本机');}
  }
  const timer=setInterval(flush,30000);window.addEventListener('online',init);
  return {init,flush,stop:()=>{clearInterval(timer);window.removeEventListener('online',init);}};
}
