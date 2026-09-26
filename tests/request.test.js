import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../public/lib/request.js',import.meta.url),'utf8')).replace(/^export /gm,'');
function requester(fetch,timeoutMs=100){
 const context=vm.createContext({fetch,AbortController,AbortSignal:{},setTimeout,clearTimeout,timeoutMs});
 vm.runInContext(source,context);
 return vm.runInContext("requestJSON('/api/catalog',{timeoutMs})",context);
}
test('the request timer also cancels a stalled JSON response body',async()=>{
 let aborted=false;
 await assert.rejects(requester(async(_url,{signal})=>({ok:true,headers:{get:()=> 'application/json'},json:()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Abort'));}))}),10),error=>error.code==='timeout');
 assert.equal(aborted,true);
});
test('HTTP status remains available for a diagnostic even when a proxy returns HTML',async()=>{
 await assert.rejects(requester(async()=>new Response('Bad gateway',{status:502})),error=>error.code==='http'&&error.status===502&&/502/.test(error.message));
});
test('admin API validation errors are preserved, and successful requests clear their timer',async()=>{
 await assert.rejects(requester(async()=>new Response(JSON.stringify({error:'词库版本已更新'}),{status:409,headers:{'Content-Type':'application/json'}})),error=>error.status===409&&error.message==='词库版本已更新');
 let signal;
 const result=await requester(async(_url,options)=>{signal=options.signal;return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});},10);
 assert.equal(result.ok,true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);
});
