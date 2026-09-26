import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import worker from '../worker/index.js';
import {createAccountAPI} from './accounts.js';
const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg'};
export function assetResponse(request,bytes,type){
 const headers={'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)};
 if(type.startsWith('audio/')){
  headers['Accept-Ranges']='bytes';
  const range=request.headers.get('range');
  if(range&&request.method==='GET'){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   let start=match?.[1]?Number(match[1]):0,end=match?.[2]?Number(match[2]):bytes.length-1;
   if(match&&!match[1]&&match[2]){start=Math.max(0,bytes.length-end);end=bytes.length-1;}
   if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=bytes.length||start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
   end=Math.min(end,bytes.length-1);headers['Content-Range']=`bytes ${start}-${end}/${bytes.length}`;headers['Content-Length']=String(end-start+1);
   return new Response(bytes.subarray(start,end+1),{status:206,headers});
  }
 }
 return new Response(request.method==='HEAD'?null:bytes,{headers});
}
async function assets(request){if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});let path;try{path=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Bad path',{status:400});}const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep))return new Response('Forbidden',{status:403});try{return assetResponse(request,await readFile(file),mime[extname(file)]||'application/octet-stream');}catch{return new Response('Not found',{status:404});}}
export function createApp({db,password,publicOrigin}){
 const accountAPI=createAccountAPI({db,password});
 return createServer(async(req,res)=>{
  try{
   const origin=publicOrigin||`http://${req.headers.host}`;
   if(req.url==='/healthz'){await db.prepare('SELECT 1 AS ok').first();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
   const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const response=await accountAPI(request,req.socket.remoteAddress)||await worker.fetch(request,{DB:db,ADMIN_PASSWORD:password,ASSETS:{fetch:assets}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"服务暂时不可用，请稍后重试"}');}
 });
}
