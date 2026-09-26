import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSync} from '../public/lib/account-sync.js';
import {selectAccountState,profileKey} from '../public/lib/account-state.js';
import {createProfile} from '../public/lib/store.js';

const makeAccount=overrides=>({user:{id:'alice'},course:{id:'high-school'},revision:0,remote:{revision:0,profile:null},...overrides});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};

test('account caches separate learners and courses, and only pending local work overrides the server',()=>{
 const local=storage(),alice=makeAccount(),key=profileKey(alice),profile=createProfile();profile.favorites=['explore'];
 local.setItem(key,JSON.stringify(profile));local.setItem(key+':sync',JSON.stringify({revision:0,dirty:false}));
 assert.equal(selectAccountState(alice,local).profile,null);
 local.setItem(key+':sync',JSON.stringify({revision:0,dirty:true}));
 assert.deepEqual(selectAccountState(alice,local).profile,profile);
 assert.equal(selectAccountState(makeAccount({remote:{revision:1,profile:createProfile()}}),local).conflict,true);
 assert.equal(selectAccountState(makeAccount({user:{id:'bob'}}),local).profile,null);
 assert.equal(selectAccountState(makeAccount({course:{id:'cet4'}}),local).profile,null);
 assert.equal(local.getItem('word-island-project-v1'),null);
});

async function withSync(t,fetcher,options={}){
 const local=storage(),statuses=[];let profile=createProfile(),writes=0;
 const account=makeAccount(options);
 t.mock.method(globalThis,'fetch',fetcher);
 const previous={window:globalThis.window,localStorage:globalThis.localStorage};
 globalThis.localStorage=local;globalThis.window={addEventListener(){},removeEventListener(){}};
 const sync=createAccountSync(()=>profile,()=>{writes++;return true;},(kind,text)=>statuses.push({kind,text}),account,next=>{profile=next;});
 t.after(()=>{sync.stop();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 return {sync,local,statuses,account,get profile(){return profile;},get writes(){return writes;}};
}

test('offline progress remains pending and retries under the same learner identity',async t=>{
 const requests=[];let available=false;
 const s=await withSync(t,async(path,options)=>{requests.push({path,options});if(!available)throw Error('offline');return Response.json({revision:1});});
 s.profile.favorites.push('explore');s.sync.changed();assert.equal(await s.sync.flush(),false);
 assert.equal(s.statuses.at(-1).kind,'offline');
 assert.equal(JSON.parse(s.local.getItem(profileKey(s.account)+':sync')).dirty,true);
 assert.deepEqual(s.profile.favorites,['explore']);
 available=true;assert.equal(await s.sync.flush(),true);
 assert.equal(requests[1].options.headers['X-Learner-Id'],'alice');
 assert.equal(JSON.parse(requests[1].options.body).revision,0);
 assert.equal(s.statuses.at(-1).kind,'cloud');
 assert.equal(JSON.parse(s.local.getItem(profileKey(s.account)+':sync')).dirty,false);
});

test('edits made while a request is in flight are saved in a second version',async t=>{
 const bodies=[];let finishFirst;
 const s=await withSync(t,async(path,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1)return new Promise(resolve=>{finishFirst=()=>resolve(Response.json({revision:1}));});return Response.json({revision:2});});
 s.sync.changed();const first=s.sync.flush();
 s.profile.favorites.push('explore');s.sync.changed();finishFirst();
 assert.equal(await first,false);assert.equal(await s.sync.flush(),true);
 assert.equal(bodies[0].profile.favorites.length,0);assert.deepEqual(bodies[1].profile.favorites,['explore']);assert.equal(bodies[1].revision,1);
});

test('a revision conflict stops writes until the learner explicitly chooses a version',async t=>{
 const requests=[],remote=createProfile();remote.favorites=['protect'];
 const s=await withSync(t,async(path,options)=>{requests.push(options);return options.method==='PUT'?Response.json({error:'conflict'},{status:409}):Response.json({revision:2,profile:remote});});
 s.profile.favorites=['explore'];s.sync.changed();assert.equal(await s.sync.flush(),false);
 assert.equal(s.statuses.at(-1).kind,'conflict');
 assert.equal(await s.sync.flush(),false);assert.equal(requests.length,1);
 assert.equal(await s.sync.resolveConflict('cloud'),true);assert.deepEqual(s.profile.favorites,['protect']);
 assert.deepEqual(JSON.parse(s.local.getItem(profileKey(s.account)+':before-conflict')).favorites,['explore']);
 assert.deepEqual(JSON.parse(s.local.getItem(profileKey(s.account)+':sync')),{revision:2,dirty:false});
});

test('choosing local conflict data rechecks the server revision before saving',async t=>{
 const requests=[];
 const s=await withSync(t,async(path,options)=>{requests.push(options);return options.method==='PUT'?Response.json({revision:4}):Response.json({revision:3,profile:createProfile()});},{dirty:true,conflict:true});
 s.profile.favorites=['explore'];assert.equal(await s.sync.resolveConflict('local'),true);
 assert.equal(JSON.parse(requests[1].body).revision,3);assert.deepEqual(JSON.parse(requests[1].body).profile.favorites,['explore']);
});

test('a revoked session never reports subsequent local edits as synchronized',async t=>{
 let calls=0;const s=await withSync(t,async()=>{calls++;return Response.json({error:'expired'},{status:401});});
 s.sync.changed();await s.sync.flush();s.sync.changed();
 assert.equal(s.statuses.at(-1).kind,'auth');assert.match(s.statuses.at(-1).text,/重新登录/);
 assert.equal(await s.sync.flush(),false);assert.equal(calls,1);
});
