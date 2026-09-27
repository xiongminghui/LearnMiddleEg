import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newDb} from 'pg-mem';
import {createDatabase,migrate} from '../server/database.js';
import {createAccountAPI} from '../server/accounts.js';
import {createProfile} from '../public/lib/store.js';
import {DEFAULT_MODULE_BANKS} from '../public/data/words.js';
import {initialProgress,createModuleSession,recordAnswer,advanceSession} from '../public/lib/engine.js';
const origin='https://example.com',admin='local-admin-testing-only',password='student-test-password';
async function setup(legacy=false){
 const memory=newDb({noAstCoverageCheck:true});memory.public.registerFunction({name:'length',args:['text'],returns:'integer',implementation:s=>s.length});
 const {Pool}=memory.adapters.createPg(),pool=new Pool();
 if(legacy){await pool.query(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));await pool.query('UPDATE shared_catalog SET banks_json=$1,revision=3 WHERE id=1',[JSON.stringify({intro:DEFAULT_MODULE_BANKS.intro.slice(0,2)})]);}
 await migrate(pool);const db=createDatabase(pool),api=createAccountAPI({db,password:admin});
 const cookieIds=new Map();
 const call=(path,{method='GET',body,cookie,learnerId,asAdmin=false,requestOrigin=origin}={})=>api(new Request(origin+path,{method,headers:{...(asAdmin?{Authorization:'Bearer '+admin}:{}),...(cookie?{Cookie:cookie,'X-Learner-Id':learnerId??cookieIds.get(cookie)??''}:{}),...(body?{'Content-Type':'application/json'}:{}),...(requestOrigin?{Origin:requestOrigin}:{})},body:body?JSON.stringify(body):undefined}));
 const create=async(username,courses)=>{const response=await call('/api/admin/accounts',{method:'POST',asAdmin:true,body:{username,displayName:username,password,courses,active:true}});assert.equal(response.status,201,await response.clone().text());return (await response.json()).id;};
 const login=async(username,pass=password)=>{const response=await call('/api/auth/login',{method:'POST',body:{username,password:pass}});assert.equal(response.status,200,await response.clone().text());const cookie=response.headers.get('set-cookie').split(';')[0];cookieIds.set(cookie,(await response.json()).user.id);return cookie;};
 return {pool,db,call,create,login};
}

test('migration installs protected defaults and archives prior imports without overwriting them on restart',async()=>{
 const s=await setup(true);try{
  const current=await (await s.call('/api/admin/catalog?course=high-school',{asAdmin:true})).json();
  assert.equal(current.course.kind,'builtin');assert.equal(current.words.length,3677);assert.equal(current.allModules,true);
  const legacy='custom-legacy-high-school';const migrated=await (await s.call('/api/admin/catalog?course='+legacy,{asAdmin:true})).json();
  assert.equal(migrated.revision,3);assert.equal(migrated.banks.intro.length,2);
  await s.db.prepare('UPDATE study_courses SET banks_json=?,revision=4 WHERE id=?').bind(JSON.stringify({intro:DEFAULT_MODULE_BANKS.intro}),legacy).run();
  await migrate(s.pool);
  const data=await (await s.call('/api/admin/catalog?course='+legacy,{asAdmin:true})).json();assert.equal(data.revision,4);assert.equal(data.banks.intro.length,5);
  const courses=await (await s.call('/api/admin/courses',{asAdmin:true})).json();assert.equal(courses.courses.filter(c=>c.kind==='builtin').length,5);assert.equal(courses.courses.find(c=>c.id==='ielts').wordCount,5040);
 }finally{await s.pool.end();}
});

test('only administrators allocate accounts; password hashes and secure sessions stay private',async()=>{
 const s=await setup();try{
  assert.equal((await s.call('/api/admin/accounts')).status,401);
  const id=await s.create('alice',['high-school','cet4']);
  const row=await s.db.prepare('SELECT password_hash FROM student_accounts WHERE id=?').bind(id).first();assert.notEqual(row.password_hash,password);assert.match(row.password_hash,/^scrypt:/);
  const list=await (await s.call('/api/admin/accounts',{asAdmin:true})).json();assert.equal(list.accounts[0].password_hash,undefined);
  const response=await s.call('/api/auth/login',{method:'POST',body:{username:'ALICE',password}});assert.equal(response.status,200);
  const setCookie=response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Secure/);
  const cookie=setCookie.split(';')[0],me=await (await s.call('/api/auth/me',{cookie})).json();assert.equal(me.user.id,id);assert.deepEqual(me.courses.map(c=>c.id).sort(),['cet4','high-school']);
  assert.equal((await s.call('/api/auth/login',{method:'POST',body:{username:'alice',password:'incorrect'}})).status,401);
  assert.equal((await s.call('/api/auth/register',{method:'POST',body:{username:'public-user',password}})).status,401);
 }finally{await s.pool.end();}
});

test('course catalogs and progress are isolated by account and grant, with revision conflict protection',async()=>{
 const s=await setup();try{
  const aliceId=await s.create('alice',['high-school','cet4']);await s.create('bob',['high-school']);const alice=await s.login('alice'),bob=await s.login('bob');
  assert.equal((await s.call('/api/courses/ielts/catalog',{cookie:alice})).status,403);
  assert.equal((await s.call('/api/courses/cet4/catalog',{cookie:bob})).status,403);
  assert.equal((await s.call('/api/catalog')).status,401);
  const preset=await (await s.call('/api/courses/cet4/catalog',{cookie:alice})).json();assert.equal(preset.words.length,3849);
  const path='/api/courses/high-school/progress';
  for(const cookie of [alice,bob])assert.equal((await (await s.call(path,{cookie})).json()).revision,0);
  const profile=createProfile();profile.progress.explore=initialProgress(Date.now());
  const saved=await s.call(path,{method:'PUT',cookie:alice,body:{revision:0,profile,studentId:'someone-else'}});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
  const other=await (await s.call(path+'?studentId='+aliceId,{cookie:bob})).json();assert.equal(other.profile,null);
  assert.equal((await s.call(path,{method:'PUT',cookie:alice,body:{revision:0,profile}})).status,409);
  const anotherDevice=await s.login('alice'),restored=await (await s.call(path,{cookie:anotherDevice})).json();assert.deepEqual(restored.profile.progress,profile.progress);
  assert.equal((await (await s.call('/api/courses/cet4/progress',{cookie:alice})).json()).profile,null);
  assert.equal((await s.call(path,{method:'PUT',cookie:alice,requestOrigin:'https://attacker.example',body:{revision:1,profile}})).status,403);
  assert.equal((await s.call(path,{method:'PUT',cookie:alice,requestOrigin:null,body:{revision:1,profile}})).status,403);
  // A stale Alice tab must not write into Bob's account after a shared cookie changes.
  assert.equal((await s.call(path,{method:'PUT',cookie:bob,learnerId:aliceId,body:{revision:0,profile}})).status,401);
  assert.equal((await (await s.call(path,{cookie:bob})).json()).profile,null);
  const blocked=await s.call('/api/admin/catalog?course=cet4',{asAdmin:true,method:'PUT',body:{revision:1,module:'intro',words:DEFAULT_MODULE_BANKS.intro}});assert.equal(blocked.status,403);
  const created=await s.call('/api/admin/courses',{asAdmin:true,method:'POST',body:{title:'自定义四级'}});assert.equal(created.status,201);const custom=(await created.json()).course.id;
  const published=await s.call('/api/admin/catalog?course='+custom,{asAdmin:true,method:'PUT',body:{revision:0,module:'intro',words:DEFAULT_MODULE_BANKS.intro}});assert.equal(published.status,200);
  const customBank=await (await s.call('/api/admin/catalog?course='+custom,{asAdmin:true})).json();assert.equal(customBank.banks.intro.length,5);assert.equal(customBank.banks.spell.length,0);
  assert.equal((await (await s.call('/api/courses/cet4/catalog',{cookie:alice})).json()).words.length,3849);
  assert.equal((await s.call('/api/courses/'+custom+'/catalog',{cookie:alice})).status,403);
  assert.equal((await s.call('/api/admin/catalog?course='+custom,{asAdmin:true,method:'PUT',body:{revision:0,module:'spell',words:DEFAULT_MODULE_BANKS.spell}})).status,409);

 }finally{await s.pool.end();}
});

test('account sync round-trips separate review schedules, including stage nine and legacy migration',async()=>{
 const s=await setup();try{
  await s.create('schedule-user',['high-school']);const cookie=await s.login('schedule-user'),path='/api/courses/high-school/progress';
  const status=await (await s.call('/api/status')).json();assert.equal(status.reviewSchedule,'ebbinghaus-inspired-v1');
  await s.call(path,{cookie});const profile=createProfile(),word=DEFAULT_MODULE_BANKS.intro[0];let time=Date.now();
  for(let i=0;i<9;i++){
   profile.session=createModuleSession({listen:[word]},profile.progress,'listen',time);
   recordAnswer(profile,word.id,{now:time});advanceSession(profile,time);time=profile.progress[word.id].reviews.listen.dueAt;
  }
  profile.session=createModuleSession({spell:[word]},profile.progress,'spell',time);
  recordAnswer(profile,'wrong',{now:time});advanceSession(profile,time);
  assert.equal((await s.call(path,{cookie,method:'PUT',body:{revision:0,profile}})).status,200);
  const other=await s.login('schedule-user'),loaded=await (await s.call(path,{cookie:other})).json();
  assert.deepEqual(loaded.profile.progress,profile.progress);assert.equal(loaded.profile.progress[word.id].reviews.listen.stage,9);assert.equal(loaded.profile.progress[word.id].reviews.spell.stage,0);
  const old=createProfile();old.progress[word.id]={introducedAt:time,dueAt:time+86400000,stage:1,lapses:0,skills:{recognize:1,spell:0,listen:1},lastReviewedAt:time};
  assert.equal((await s.call(path,{cookie:other,method:'PUT',body:{revision:1,profile:old}})).status,200);
  const migrated=(await (await s.call(path,{cookie})).json()).profile.progress[word.id];
  assert.equal(migrated.reviews.listen.dueAt,old.progress[word.id].dueAt);assert.equal(migrated.reviews.listen.stage,4);assert.equal(migrated.reviews.spell,undefined);
 }finally{await s.pool.end();}
});

test('password reset and disabling revoke sessions while retaining saved learning progress',async()=>{
 const s=await setup();try{
  const id=await s.create('alice',['high-school']);let cookie=await s.login('alice');
  const profile=createProfile();profile.progress.explore=initialProgress(Date.now());await s.call('/api/courses/high-school/progress',{cookie});
  await s.call('/api/courses/high-school/progress',{method:'PUT',cookie,body:{revision:0,profile}});
  const change=body=>s.call('/api/admin/accounts/'+id,{method:'PATCH',asAdmin:true,body:{displayName:'Alice',courses:['high-school'],active:true,...body}});
  assert.equal((await change({password:'new-password-123'})).status,200);assert.equal((await s.call('/api/auth/me',{cookie})).status,401);
  cookie=await s.login('alice','new-password-123');assert.ok((await (await s.call('/api/courses/high-school/progress',{cookie})).json()).profile.progress.explore);
  assert.equal((await change({active:false})).status,200);assert.equal((await s.call('/api/auth/me',{cookie})).status,401);
  assert.equal((await s.call('/api/auth/login',{method:'POST',body:{username:'alice',password:'new-password-123'}})).status,401);
  assert.equal((await change({active:true,courses:[]})).status,200);cookie=await s.login('alice','new-password-123');assert.equal((await s.call('/api/courses/high-school/progress',{cookie})).status,403);
  assert.equal((await s.call('/api/auth/logout',{method:'POST',cookie})).status,200);assert.equal((await s.call('/api/auth/me',{cookie})).status,401);
 }finally{await s.pool.end();}
});

test('cloning a default creates independently editable modules and can be assigned alongside all five defaults',async()=>{
 const s=await setup();try{
  assert.equal((await s.call('/api/admin/courses',{method:'POST',body:{title:'not admin'}})).status,401);
  const response=await s.call('/api/admin/courses',{method:'POST',asAdmin:true,body:{title:'我的雅思听力',copyFrom:'ielts'}});assert.equal(response.status,201);const id=(await response.json()).course.id;
  let catalog=await (await s.call('/api/admin/catalog?course='+id,{asAdmin:true})).json();assert.ok(Object.values(catalog.banks).every(words=>words.length===5040));
  const edit=await s.call('/api/admin/catalog?course='+id,{method:'PUT',asAdmin:true,body:{revision:0,module:'listen',words:DEFAULT_MODULE_BANKS.listen}});assert.equal(edit.status,200);
  catalog=await (await s.call('/api/admin/catalog?course='+id,{asAdmin:true})).json();assert.equal(catalog.banks.listen.length,4);assert.equal(catalog.banks.intro.length,5040);
  assert.equal((await (await s.call('/api/admin/catalog?course=ielts',{asAdmin:true})).json()).words.length,5040);
  await s.create('alice',['high-school','cet4','cet6','ielts','toefl',id]);const cookie=await s.login('alice');assert.equal((await s.call('/api/courses/'+id+'/catalog',{cookie})).status,200);
  await migrate(s.pool);assert.equal((await (await s.call('/api/admin/catalog?course='+id,{asAdmin:true})).json()).banks.listen.length,4);
 }finally{await s.pool.end();}
});
