import {MODULES,validateWords} from '../public/lib/catalog.js';
import { validEvent } from '../public/lib/protocol.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function learnerKey(request){
  const token=request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if(!token)return null;
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function limitedJSON(request,limit=32768){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('type');
  if(Number(request.headers.get('content-length')||0)>limit)throw new Error('size');
  const reader=request.body?.getReader();if(!reader)throw new Error('body');
  const decoder=new TextDecoder();let count=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>limit){await reader.cancel();throw new Error('size');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{reader.releaseLock();}
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(url.pathname==='/api/catalog'&&request.method==='GET'){
      if(!env.DB)return json({banks:{},revision:0});
      try{const row=await env.DB.prepare('SELECT revision, banks_json FROM shared_catalog WHERE id = 1').first();return json({banks:row?JSON.parse(row.banks_json):{},revision:row?.revision||0});}catch{return json({error:'词库数据库尚未初始化或暂不可用'},503);}
    }
    if(url.pathname==='/api/admin/catalog'){
      if(!env.DB||!env.ADMIN_PASSWORD)return json({error:'请先配置 DATABASE_URL 和 ADMIN_PASSWORD'},503);
      const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
      const digest=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
      const a=await digest(token),b=await digest(env.ADMIN_PASSWORD);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
      if(!token||diff)return json({error:'管理员密码不正确'},401);
      if(request.method==='GET'){
        try{const row=await env.DB.prepare('SELECT revision, banks_json FROM shared_catalog WHERE id = 1').first();return json({banks:row?JSON.parse(row.banks_json):{},revision:row?.revision||0});}catch{return json({error:'请先运行数据库迁移'},503);}
      }
      if(request.method!=='PUT')return json({error:'method_not_allowed'},405);
      const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'origin_not_allowed'},403);
      let body,banks;try{body=await limitedJSON(request,1048576);if(!Number.isInteger(body.revision)||body.revision<0||!body.banks||Object.keys(body.banks).some(k=>!Object.hasOwn(MODULES,k)))throw Error('词库格式不正确');banks=Object.fromEntries(Object.entries(body.banks).map(([k,v])=>[k,validateWords(v)]));}catch(e){return json({error:e.message||'导入格式不正确'},400);}
      try{const result=await env.DB.prepare("UPDATE shared_catalog SET banks_json = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1 AND revision = ?").bind(JSON.stringify(banks),body.revision).run();if(!result.meta?.changes)return json({error:'词库已被其他管理员更新，请重新登录后再导入'},409);return json({revision:body.revision+1,banks});}catch{return json({error:'发布失败，原词库保持不变'},503);}
    }
    if(url.pathname==='/api/status'&&request.method==='GET')return json({storage:env.DB?'postgres':'local',version:1});
    if(!['/api/events','/api/summary'].includes(url.pathname))return json({error:'not_found'},404);
    if(!env.DB)return json({error:'database_not_configured'},503);
    const key=await learnerKey(request);if(!key)return json({error:'unauthorized'},401);
    if(url.pathname==='/api/summary'&&request.method==='GET'){
      try{const row=await env.DB.prepare('SELECT COUNT(*) AS events, SUM(CASE WHEN event_type = \'answered\' THEN 1 ELSE 0 END) AS answers FROM learning_events WHERE learner_key = ?').bind(key).first();return json({events:Number(row?.events||0),answers:Number(row?.answers||0)});}catch{return json({error:'storage_unavailable'},503);}
    }
    if(url.pathname!=='/api/events'||request.method!=='POST')return json({error:'method_not_allowed'},405);
    const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'origin_not_allowed'},403);
    let body;try{body=await limitedJSON(request);}catch{return json({error:'invalid_payload'},400);}
    if(!body||!Array.isArray(body.events)||!body.events.length||body.events.length>40||!body.events.every(validEvent)||new Set(body.events.map(e=>e.id)).size!==body.events.length)return json({error:'invalid_events'},400);
    try{
      await env.DB.batch(body.events.map(e=>env.DB.prepare('INSERT INTO learning_events (learner_key, id, session_id, word_id, event_type, exercise_type, result, assisted, occurred_at, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (learner_key,id) DO NOTHING').bind(key,e.id,e.sessionId,e.wordId,e.eventType,e.exerciseType,e.result,e.assisted?1:0,e.occurredAt,e.latencyMs)));
      return json({acknowledged:body.events.map(e=>e.id)});
    }catch{return json({error:'storage_unavailable'},503);}
  }
};
