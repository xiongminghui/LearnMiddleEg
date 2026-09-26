import {MODULES,validateWords} from './lib/catalog.js';
import {hasOwn} from './lib/compat.js';
import {requestJSON,canRetry} from './lib/request.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function getWithRetry(path,options={}){
 for(let attempt=0;attempt<2;attempt++){
  try{return await requestJSON(path,{cache:'no-store',timeoutMs:30000,...options});}
  catch(error){if(attempt||!canRetry(error))throw error;$('main').textContent='连接稍慢，正在重试，请再等一会儿…';await new Promise(resolve=>setTimeout(resolve,1000));}
 }
}
function publishedBanks(payload){
 if(payload?.allModules===true){const words=validateWords(payload.words);return Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,words]));}
 if(!payload?.banks||typeof payload.banks!=='object'||Array.isArray(payload.banks))throw Error('共享词库格式不正确。');
 return Object.fromEntries(Object.entries(payload.banks).map(([kind,words])=>{if(!hasOwn(MODULES,kind))throw Error('共享词库包含未知模块。');return [kind,Array.isArray(words)&&!words.length?[]:validateWords(words)];}));
}
function showFailure(message){
 $('main').textContent=message;
 const retry=document.createElement('button');retry.className='primary';retry.textContent='重新加载';retry.onclick=()=>location.reload();$('main').append(document.createElement('br'),retry);
}
function showLogin(){
 document.body.classList.add('account-gate');
 $('main').innerHTML=`<section class="panel account-login"><div class="eyebrow">WELCOME TO WORD ISLAND</div><h1>登录，继续你的学习。</h1><p class="muted">账号由管理员分配。忘记密码时，请联系管理员重置。</p><form id="student-login"><label for="student-username">学习账号</label><input class="search-input" id="student-username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required maxlength="40"><label for="student-password">密码</label><input class="search-input" id="student-password" name="password" type="password" autocomplete="current-password" required maxlength="128"><button class="primary" type="submit">登录</button></form><p id="login-message" role="status" aria-live="polite"></p><a class="text-button" href="admin.html">管理员入口</a></section>`;
 $('student-login').onsubmit=async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;$('login-message').textContent='正在登录…';
  try{await requestJSON('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('student-username').value,password:$('student-password').value})});location.replace('/');}
  catch(error){$('login-message').textContent=error.message;$('student-password').value='';button.disabled=false;}
 };
}
function showCourses(identity){
 document.body.classList.add('account-gate');
 $('main').innerHTML=`<section class="welcome"><div><div class="eyebrow">YOUR LEARNING PATHS</div><h1>${esc(identity.user.displayName)}，选择学习方向。</h1><p>这里显示管理员分配给你的词库，每个方向分别保存学习进度。</p></div><button class="secondary" id="picker-logout">退出登录</button></section><section class="module-grid">${identity.courses.map(course=>`<article class="module-card"><span class="tag">${course.kind==='builtin'?'内置默认':'自定义方向'}</span><h2>${esc(course.title)}</h2><p>${course.wordCount?course.wordCount+' 个词条 · 四个独立学习模块':'管理员尚未导入词库，请稍后再来。'}</p>${course.kind==='builtin'?`<small class="muted">${course.id==='high-school'?'通用高考词表，北师大教材另设方向。':'开源备考参考词表。'} <a href="/data-sources.html">词库范围与来源</a></small>`:''}${course.wordCount?`<a class="primary course-link" href="/?course=${encodeURIComponent(course.id)}">进入学习</a>`:'<span class="muted">等待词库发布</span>'}</article>`).join('')||'<section class="panel"><p>尚未分配学习方向，请联系管理员。</p></section>'}</section>`;
 $('picker-logout').onclick=async()=>{try{await requestJSON('/api/auth/logout',{method:'POST'});location.replace('/');}catch(error){showFailure(error.message);}};
}
async function start(){
 $('main').textContent='正在读取账号与词库，首次连接可能需要稍等…';
 try{
  let identity;
  try{identity=await getWithRetry('/api/auth/me');}
  catch(error){
   if(error.status===401){showLogin();return;}
   if(error.status!==404)throw error;
   // Retain the standalone static preview without giving deployed APIs a bypass.
   try{window.wordIslandPublished=publishedBanks(await getWithRetry('/api/catalog'));}catch(previewError){if(previewError.status!==404)throw previewError;}
   await import('./app.js');return;
  }
  const selected=new URL(location.href).searchParams.get('course'),course=identity.courses.find(item=>item.id===selected);
  if(!course){showCourses(identity);return;}
  const options={headers:{'X-Learner-Id':identity.user.id}};
  const catalog=await getWithRetry('/api/courses/'+course.id+'/catalog',options);
  const remote=await getWithRetry('/api/courses/'+course.id+'/progress',options);
  window.wordIslandPublished=publishedBanks(catalog);window.wordIslandAccount={user:identity.user,course,remote};
  document.body.classList.remove('account-gate');
  await import('./app.js');
 }catch(error){showFailure('学习页面暂时无法读取。'+error.message+' 本机记录保持不变。');}
}
start();
