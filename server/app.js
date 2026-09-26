import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import worker from '../worker/index.js';
const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
async function assets(request){if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});let path;try{path=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Bad path',{status:400});}const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep))return new Response('Forbidden',{status:403});try{const bytes=await readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});}catch{return new Response('Not found',{status:404});}}
export function createApp({db,password,publicOrigin}){
 return createServer(async(req,res)=>{
  try{
   const origin=publicOrigin||`http://${req.headers.host}`;
   if(req.url==='/healthz'){await db.prepare('SELECT 1 AS ok').first();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
   const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const response=await worker.fetch(request,{DB:db,ADMIN_PASSWORD:password,ASSETS:{fetch:assets}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"服务暂时不可用，请稍后重试"}');}
 });
}
