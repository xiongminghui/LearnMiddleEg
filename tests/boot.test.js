import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MODULES,validateWords} from '../public/lib/catalog.js';
import {DEFAULT_MODULE_BANKS} from '../public/data/words.js';

const read=name=>readFile(new URL('../public/'+name,import.meta.url),'utf8');
const helpers=(await Promise.all(['lib/compat.js','lib/request.js'].map(read))).join('\n').replace(/^export /gm,'');
const boot=(await read('boot.js')).replace(/^import .*;\n/gm,'').replaceAll("await import('./app.js')",'appStarted=true');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function runBoot(fetchCatalog,{signedIn=true,preview=false}={}){
 const main={textContent:'',append(){}},elements=new Map([['main',main]]),waits=[];
 const identity={user:{id:'test-user',displayName:'Test'},courses:[{id:'high-school',title:'高中',wordCount:18}]};
 const context={MODULES,validateWords,window:{},URL,AbortSignal:{},AbortController,clearTimeout,appStarted:false,
  fetch:async(path,options)=>path==='/api/auth/me'?preview?new Response('Missing',{status:404}):signedIn?json(identity):json({error:'请登录'},401):path.endsWith('/progress')?json({revision:0,profile:null}):fetchCatalog(path,options),
  setTimeout(fn,ms){waits.push(ms);return setTimeout(fn,ms===1000?0:ms);},
  document:{body:{classList:{add(){},remove(){}}},getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);},createElement:()=>({})},location:{href:'https://example.com/?course=high-school',reload(){}}};
 await vm.runInNewContext('Object.hasOwn=undefined;\n'+helpers+'\n'+boot,context);
 return {context,main,waits};
}

test('old iOS without AbortSignal.timeout or Object.hasOwn loads a published bank and starts learning',async()=>{
 let calls=0;
 const {context,waits}=await runBoot(async()=>{calls++;return json({banks:{intro:DEFAULT_MODULE_BANKS.intro},revision:1});});
 assert.equal(calls,1,'the phone must actually send /api/catalog');
 assert.equal(context.appStarted,true);
 assert.equal(context.window.wordIslandPublished.intro.length,5);
 assert.ok(waits[0]>8000,'allow more time for slow connections');
});

test('one temporary service error is retried automatically before starting',async()=>{
 let calls=0;
 const {context,waits}=await runBoot(async()=>++calls===1?new Response('Starting…',{status:503}):json({banks:{},revision:0}));
 assert.equal(calls,2);assert.equal(context.appStarted,true);assert.ok(waits.includes(1000));
});

test('persistent network errors stop after two attempts and never start with an empty fallback bank',async()=>{
 let calls=0;
 const {context,main}=await runBoot(async()=>{calls++;throw new TypeError('Failed to fetch');});
 assert.equal(calls,2);assert.equal(context.appStarted,false);assert.equal(context.window.wordIslandPublished,undefined);
 assert.match(main.textContent,/无法连接网站服务/);assert.match(main.textContent,/本机记录保持不变/);
});

test('invalid catalog responses do not start the app or erase custom-word progress',async()=>{
 for(const payload of [{banks:null},{banks:[]},{banks:{unknown:DEFAULT_MODULE_BANKS.intro}}]){
  let calls=0;
  const {context,main}=await runBoot(async()=>{calls++;return json(payload);});
  assert.equal(calls,1);assert.equal(context.appStarted,false);assert.equal(context.window.wordIslandPublished,undefined);
  assert.match(main.textContent,/共享词库/);
 }
 const {context}=await runBoot(async()=>new Response('<html>Proxy error</html>',{headers:{'Content-Type':'text/html'}}));
 assert.equal(context.appStarted,false);
});

test('a static preview without an API can still start',async()=>{
 const {context}=await runBoot(async()=>new Response('Not found',{status:404}),{preview:true});
 assert.equal(context.appStarted,true);
});

test('signed-out learners see the assigned-account login without requesting a private catalog',async()=>{
 let called=false;const {context,main}=await runBoot(async()=>{called=true;return json({banks:{}});},{signedIn:false});
 assert.equal(called,false);assert.equal(context.appStarted,false);assert.match(main.innerHTML,/账号由管理员分配/);
});


test('a compact built-in catalog populates all four modules on old browser APIs',async()=>{
 const {context}=await runBoot(async()=>json({allModules:true,words:DEFAULT_MODULE_BANKS.intro,revision:1}));
 assert.equal(context.appStarted,true);assert.deepEqual(Object.keys(context.window.wordIslandPublished),['intro','recognize','spell','listen']);
 for(const words of Object.values(context.window.wordIslandPublished))assert.equal(words.length,5);
});
