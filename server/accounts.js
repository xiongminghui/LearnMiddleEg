import {randomBytes,randomUUID} from 'node:crypto';
import {digest,sameSecret,hashPassword,verifyPassword} from './passwords.js';
import {MODULES,validateWords} from '../public/lib/catalog.js';
import {DEFAULT_MODULE_BANKS} from '../public/data/words.js';
import {normalizeProfile} from '../public/lib/store.js';

const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const COOKIE='word_island_session',SESSION_MS=7*24*60*60*1000;
const safeMethods=['GET','HEAD'];
const publicAccount=row=>({id:row.id,username:row.username,displayName:row.display_name,active:row.active});
const tokenFrom=request=>request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
const cookie=(request,value,seconds)=>`${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function bodyOf(request,limit=1048576){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('请提交 JSON 数据。');
 const text=await request.text();if(Buffer.byteLength(text)>limit)throw Error('提交的数据过大。');return JSON.parse(text);
}
function effectiveBanks(course){
 const stored=JSON.parse(course.banks_json);
 return Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,stored[kind]||(course.id==='high-school'?DEFAULT_MODULE_BANKS[kind]:[])]));
}
function courseInfo(course){
 const banks=effectiveBanks(course);
 return {id:course.id,title:course.title,wordCount:new Set(Object.values(banks).flat().map(word=>word.id)).size,revision:course.revision};
}
function parseBanks(banks){
 if(!banks||typeof banks!=='object'||Array.isArray(banks)||Object.keys(banks).some(key=>!Object.hasOwn(MODULES,key)))throw Error('词库格式不正确。');
 const result=Object.fromEntries(Object.entries(banks).map(([kind,words])=>[kind,Array.isArray(words)&&!words.length?[]:validateWords(words)]));
 if(result.recognize?.length&&new Set(result.recognize.map(word=>word.meaning)).size<2)throw Error('英译中选择至少需要两个中文释义不同的单词。');
 return result;
}
export function createAccountAPI({db,password}){
 const attempts=new Map();let hashing=0;
 const takeAttempt=(key,limit=12)=>{
  const now=Date.now();for(const [id,value] of attempts)if(value.until<=now)attempts.delete(id);
  const entry=attempts.get(key)||{count:0,until:now+300000};entry.count++;attempts.set(key,entry);
  if(attempts.size>5000)attempts.delete(attempts.keys().next().value);
  return entry.count<=limit;
 };
 // A valid-shaped dummy hash makes unknown usernames pay the same KDF cost.
 const dummyHash='scrypt:'+'0'.repeat(32)+':'+'0'.repeat(128);
 const accountFor=async request=>{
  const token=tokenFrom(request);if(!/^[0-9a-f]{64}$/.test(token))return null;
  return db.prepare('SELECT a.id,a.username,a.display_name,a.active FROM student_accounts a JOIN student_sessions s ON a.id=s.student_id WHERE s.token_hash=? AND s.expires_at>? AND s.auth_version=a.auth_version AND a.active=TRUE').bind(digest(token),Date.now()).first();
 };
 const assignedCourses=account=>db.prepare('SELECT c.id,c.title,c.banks_json,c.revision FROM study_courses c JOIN student_courses sc ON sc.course_id=c.id WHERE sc.student_id=? ORDER BY c.id').bind(account.id).all();
 const authorizedCourse=async(account,id)=>db.prepare('SELECT c.id,c.title,c.banks_json,c.revision FROM study_courses c JOIN student_courses sc ON sc.course_id=c.id WHERE sc.student_id=? AND c.id=?').bind(account.id,id).first();
 const courseList=()=>db.prepare('SELECT id,title,banks_json,revision FROM study_courses ORDER BY id').all();
 async function handle(request,clientAddress='local'){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const isAdmin=path.startsWith('/api/admin/');
  const handled=isAdmin||path.startsWith('/api/auth/')||path.startsWith('/api/courses/')||['/api/catalog','/api/events','/api/summary','/api/status'].includes(path);
  if(!handled)return null;
  if(!db)return json({error:'数据库尚未配置。'},503);
  if(!safeMethods.includes(method)){
   const origin=request.headers.get('origin');
   if((origin&&origin!==url.origin)||(!isAdmin&&!origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请求来源不正确，请在本站页面操作。'},403);
  }
  if(isAdmin){
   const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
   if(!token||!password||!sameSecret(token,password)){
    const allowed=takeAttempt('admin:'+clientAddress,20);
    return json({error:allowed?'管理员密码不正确。':'尝试过于频繁，请五分钟后重试。'},allowed?401:429);
   }
   if(path==='/api/admin/courses'&&method==='GET')return json({courses:(await courseList()).map(courseInfo)});
   if(path==='/api/admin/catalog'){
    const course=await db.prepare('SELECT id,title,banks_json,revision FROM study_courses WHERE id=?').bind(url.searchParams.get('course')||'high-school').first();
    if(!course)return json({error:'学习方向不存在。'},404);
    if(method==='GET')return json({course:courseInfo(course),banks:effectiveBanks(course),revision:course.revision});
    if(method!=='PUT')return json({error:'不支持此操作。'},405);
    let body,banks;try{body=await bodyOf(request);if(!Number.isInteger(body.revision)||body.revision<0)throw Error('词库版本不正确。');banks=parseBanks(body.banks);}catch(error){return json({error:error.message},400);}
    const updated=await db.prepare('UPDATE study_courses SET banks_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? RETURNING revision').bind(JSON.stringify(banks),course.id,body.revision).first();
    if(!updated)return json({error:'词库已被更新，请重新选择学习方向后再导入。'},409);
    return json({banks,revision:updated.revision});
   }
   if(path==='/api/admin/accounts'&&method==='GET'){
    const accounts=await db.prepare('SELECT id,username,display_name,active FROM student_accounts ORDER BY username').all();
    const grants=await db.prepare('SELECT student_id,course_id FROM student_courses').all();
    return json({accounts:accounts.map(account=>({...publicAccount(account),courses:grants.filter(grant=>grant.student_id===account.id).map(grant=>grant.course_id)}))});
   }
   const accountId=path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})$/)?.[1];
   if((path==='/api/admin/accounts'&&method==='POST')||(accountId&&method==='PATCH')){
    let body,courses,displayName,username;
    try{
     body=await bodyOf(request,16384);username=String(body.username||'').trim().toLowerCase();displayName=String(body.displayName||username).trim();
     if(!accountId&&!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username))throw Error('账号需为 3–40 位英文、数字、点、下划线或短横线。');
     if(!displayName||displayName.length>60)throw Error('姓名或昵称需为 1–60 个字符。');
     courses=body.courses;if(!Array.isArray(courses)||courses.length>5||new Set(courses).size!==courses.length||courses.some(id=>typeof id!=='string'||!(id.length<30)))throw Error('分配的学习方向不正确。');
     const available=new Set((await courseList()).map(course=>course.id));if(courses.some(id=>!available.has(id)))throw Error('学习方向不存在。');
     if(typeof body.active!=='boolean')throw Error('账号状态不正确。');
     if(!accountId||body.password){if(typeof body.password!=='string'||body.password.length<8||body.password.length>128)throw Error('密码需为 8–128 个字符。');}
    }catch(error){return json({error:error.message},400);}
    const existing=accountId?await db.prepare('SELECT id FROM student_accounts WHERE id=?').bind(accountId).first():null;
    if(accountId&&!existing)return json({error:'账号不存在。'},404);
    if(!accountId&&await db.prepare('SELECT id FROM student_accounts WHERE username=?').bind(username).first())return json({error:'此账号已存在，请换一个账号名。'},409);
    let passwordHash;
    if(body.password){if(hashing>=2)return json({error:'正在处理其他登录或密码请求，请稍后重试。'},429);hashing++;try{passwordHash=await hashPassword(body.password);}finally{hashing--;}}
    const id=accountId||randomUUID(),statements=[];
    if(!accountId)statements.push(db.prepare('INSERT INTO student_accounts(id,username,display_name,password_hash,active) VALUES(?,?,?,?,?)').bind(id,username,displayName,passwordHash,body.active));
    else if(passwordHash)statements.push(db.prepare('UPDATE student_accounts SET display_name=?,password_hash=?,active=?,auth_version=auth_version+1 WHERE id=?').bind(displayName,passwordHash,body.active,id));
    else statements.push(db.prepare('UPDATE student_accounts SET display_name=?,active=?,auth_version=auth_version+? WHERE id=?').bind(displayName,body.active,body.active?0:1,id));
    statements.push(db.prepare('DELETE FROM student_courses WHERE student_id=?').bind(id));
    for(const course of courses)statements.push(db.prepare('INSERT INTO student_courses(student_id,course_id) VALUES(?,?)').bind(id,course));
    if(passwordHash||!body.active)statements.push(db.prepare('DELETE FROM student_sessions WHERE student_id=?').bind(id));
    try{await db.batch(statements);}catch(error){if(error.code==='23505')return json({error:'账号已存在，请刷新后重试。'},409);throw error;}
    return json({id},accountId?200:201);
   }
   return json({error:'管理接口不存在。'},404);
  }
  if(path==='/api/auth/login'&&method==='POST'){
   let body;try{body=await bodyOf(request,2048);}catch{return json({error:'请输入账号和密码。'},400);}
   const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
   if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||typeof body.password!=='string'||body.password.length>128)return json({error:'账号或密码不正确。'},401);
   if(!takeAttempt('login:'+username)||!takeAttempt('address:'+clientAddress,60)||hashing>=2)return json({error:'尝试过于频繁，请稍后重试。'},429);
   const row=await db.prepare('SELECT id,username,display_name,password_hash,active,auth_version FROM student_accounts WHERE username=?').bind(username).first();
   if(hashing>=2)return json({error:'正在处理其他登录或密码请求，请稍后重试。'},429);
   hashing++;let verified;try{verified=await verifyPassword(body.password,row?.password_hash||dummyHash);}finally{hashing--;}
   if(!row?.active||!verified)return json({error:'账号或密码不正确，或账号已停用。'},401);
   const token=randomBytes(32).toString('hex');
   await db.batch([
    db.prepare('DELETE FROM student_sessions WHERE expires_at<=? OR token_hash=?').bind(Date.now(),digest(tokenFrom(request))),
    db.prepare('INSERT INTO student_sessions(token_hash,student_id,auth_version,expires_at) VALUES(?,?,?,?)').bind(digest(token),row.id,row.auth_version,Date.now()+SESSION_MS)
   ]);
   attempts.delete('login:'+username);
   return json({user:publicAccount(row)},200,{'Set-Cookie':cookie(request,token,SESSION_MS/1000)});
  }
  if(path==='/api/auth/logout'&&method==='POST'){
   await db.prepare('DELETE FROM student_sessions WHERE token_hash=?').bind(digest(tokenFrom(request))).run();
   return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  if(path==='/api/status'&&method==='GET')return json({storage:'postgres',version:2,accounts:true});
  const account=await accountFor(request);if(!account)return json({error:'请使用管理员分配的账号登录。'},401);
  if(path==='/api/auth/me'&&method==='GET')return json({user:publicAccount(account),courses:(await assignedCourses(account)).map(courseInfo)});
  const match=path.match(/^\/api\/courses\/([a-z0-9-]+)\/(catalog|progress)$/);
  if(!match)return json({error:'请使用账号对应的学习方向接口。'},404);
  if(request.headers.get('x-learner-id')!==account.id)return json({error:'当前登录账号已变化，请刷新后继续。'},401);
  const course=await authorizedCourse(account,match[1]);if(!course)return json({error:'该学习方向尚未分配给此账号。'},403);
  if(match[2]==='catalog'&&method==='GET')return json({course:courseInfo(course),banks:effectiveBanks(course),revision:course.revision});
  if(match[2]==='progress'){
   if(method==='GET'){
    await db.prepare('INSERT INTO student_profiles(student_id,course_id) VALUES(?,?) ON CONFLICT(student_id,course_id) DO NOTHING').bind(account.id,course.id).run();
    const row=await db.prepare('SELECT revision,profile_json FROM student_profiles WHERE student_id=? AND course_id=?').bind(account.id,course.id).first();
    return json({revision:row.revision,profile:JSON.parse(row.profile_json)});
   }
   if(method==='PUT'){
    let body,profile;
    try{
     body=await bodyOf(request);if(!Number.isInteger(body.revision)||body.revision<0)throw Error('进度版本不正确。');
     const wordMap=Object.fromEntries(Object.values(effectiveBanks(course)).flat().map(word=>[word.id,word]));
     profile=normalizeProfile(body.profile,wordMap);profile.pendingEvents=[];
    }catch{return json({error:'学习进度格式不正确。'},400);}
    const updated=await db.prepare('UPDATE student_profiles SET profile_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE student_id=? AND course_id=? AND revision=? RETURNING revision').bind(JSON.stringify(profile),account.id,course.id,body.revision).first();
    if(!updated)return json({error:'另一设备已更新进度。本机记录已保留，请选择要继续使用的进度。'},409);
    return json({revision:updated.revision});
   }
  }
  return json({error:'不支持此操作。'},405);
 }
 return async(request,address)=>{try{return await handle(request,address);}catch{return json({error:'服务暂时不可用，请稍后重试。'},503);}};
}
