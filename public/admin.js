import {MODULES,parseImport} from './lib/catalog.js';
import {requestJSON} from './lib/request.js';
import {DEFAULT_MODULE_BANKS} from './data/words.js';
const $=id=>document.getElementById(id);
let token='',banks={},revision=0,draft=null,busy=false,courses=[],accounts=[],editingId=null,course='high-school';
const current=()=>$('module-select').value;
const title=()=>courses.find(item=>item.id===course)?.title||course;
const status=(text,error=false)=>{$('admin-status').textContent=text;$('admin-status').style.color=error?'#9a542c':'#176753';};
async function api(path,method='GET',body){return requestJSON('/api/admin/'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,timeoutMs:30000});}
const bankAPI=(method='GET',body)=>api('catalog?course='+encodeURIComponent(course),method,body);
function render(){
 const words=draft||banks[current()]||[];$('bank-heading').textContent=title()+' / '+MODULES[current()]+' · '+words.length+' 词';
 $('preview-note').textContent=draft?'待发布预览（尚未修改线上词库）':words.length?'已发布词库 · 版本 '+revision:'尚未发布此模块的词库';
 $('preview-rows').replaceChildren();for(const word of words){const row=document.createElement('tr');for(const value of [word.id+' '+word.ipa,word.meaning,word.definition,word.sentence,word.audioUrl||'设备合成语音']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('preview-rows').append(row);}
 $('publish').disabled=!draft||busy;$('discard').disabled=!draft||busy;
}
async function loadCourse(){const data=await bankAPI();banks=data.banks;revision=data.revision;draft=null;$('bank-file').value='';render();}
function fillCourses(){
 $('course-select').replaceChildren();$('account-courses').replaceChildren();
 for(const item of courses){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;$('course-select').append(option);const label=document.createElement('label');label.className='checkbox-row';const input=document.createElement('input');input.type='checkbox';input.value=item.id;input.name='assigned-course';label.append(input,document.createTextNode(item.title));$('account-courses').append(label);}
 $('course-select').value=course;
}
function resetAccount(){editingId=null;$('account-form').reset();$('account-username').disabled=false;$('account-password').required=true;$('account-heading').textContent='创建学习账号';$('account-save').textContent='创建账号';$('password-note').textContent='设置至少 8 位密码，再将账号与密码交给使用者。';$('account-cancel').hidden=true;$('account-message').textContent='';}
function editAccount(account){
 editingId=account.id;$('account-username').value=account.username;$('account-username').disabled=true;$('account-name').value=account.displayName;$('account-password').value='';$('account-password').required=false;$('account-active').checked=account.active;
 for(const input of document.querySelectorAll('[name="assigned-course"]'))input.checked=account.courses.includes(input.value);
 $('account-heading').textContent='编辑账号 · '+account.username;$('account-save').textContent='保存账号';$('password-note').textContent='留空保留原密码。输入新密码即可重置，原登录状态随即失效。';$('account-cancel').hidden=false;$('account-message').textContent='';$('account-form').scrollIntoView({block:'start'});$('account-name').focus();
}
function renderAccounts(){
 const query=$('account-search').value.trim().toLowerCase();$('account-list').replaceChildren();
 for(const account of accounts.filter(item=>(item.username+' '+item.displayName).toLowerCase().includes(query))){
  const row=document.createElement('article');row.className='account-item';const detail=document.createElement('div'),heading=document.createElement('strong'),login=document.createElement('p'),assigned=document.createElement('small'),button=document.createElement('button');
  heading.textContent=account.displayName+(account.active?'':' · 已停用');login.textContent=account.username;assigned.textContent=account.courses.map(id=>courses.find(course=>course.id===id)?.title||id).join('、')||'尚未分配学习方向';button.type='button';button.className='secondary small';button.textContent='编辑 / 重置密码';button.onclick=()=>{if(!busy)editAccount(account);};detail.append(heading,login,assigned);row.append(detail,button);$('account-list').append(row);
 }
 if(!$('account-list').children.length)$('account-list').textContent=query?'没有匹配的账号。':'尚未创建学习账号。';
}
async function loadAccounts(){accounts=(await api('accounts')).accounts;renderAccounts();}
function lock(value){busy=value;for(const id of ['course-select','module-select','bank-file','logout','account-save','account-cancel','accounts-refresh'])$(id).disabled=value;render();}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;token=$('admin-password').value;status('正在登录…');
 try{courses=(await api('courses')).courses;fillCourses();await loadCourse();await loadAccounts();$('admin-password').value='';$('login-panel').hidden=true;$('editor').hidden=false;resetAccount();status('已登录。可以创建账号、分配方向和发布词库。');}
 catch(error){token='';status(error.message,true);}finally{busy=false;render();}
});
$('logout').onclick=()=>{token='';draft=null;banks={};accounts=[];courses=[];$('account-list').replaceChildren();resetAccount();$('editor').hidden=true;$('login-panel').hidden=false;status('已退出管理员。');};
for(const button of document.querySelectorAll('[data-admin-tab]'))button.onclick=()=>{for(const tab of document.querySelectorAll('[data-admin-tab]')){const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));}$('accounts-panel').hidden=button.dataset.adminTab!=='accounts';$('catalog-panel').hidden=button.dataset.adminTab!=='catalog';};
$('course-select').onchange=async()=>{const previous=course;course=$('course-select').value;lock(true);try{await loadCourse();status('已切换到 '+title());}catch(error){course=previous;$('course-select').value=course;status(error.message,true);}finally{lock(false);}};
$('module-select').onchange=()=>{draft=null;$('bank-file').value='';render();status('已切换模块，未发布的预览已清除。');};
$('bank-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;const module=current(),selectedCourse=course;try{if(file.size>1048576)throw Error('文件不能超过 1 MB');const words=parseImport(await file.text(),file.name);if(module!==current()||selectedCourse!==course)return;if(module==='recognize'&&new Set(words.map(word=>word.meaning)).size<2)throw Error('英译中选择需要至少两个中文释义不同的单词。');draft=words;render();status('校验通过，请检查预览后发布。');}catch(error){draft=null;render();status(error.message,true);}finally{$('bank-file').value='';}};
$('discard').onclick=()=>{draft=null;render();status('已取消本次导入。');};
$('publish').onclick=async()=>{if(!draft||busy)return;const module=current();if(!confirm(`将 ${title()} / ${MODULES[module]} 替换为预览中的 ${draft.length} 个单词？`))return;lock(true);try{const data=await bankAPI('PUT',{revision,banks:{...banks,[module]:draft}});banks=data.banks;revision=data.revision;draft=null;status('发布成功，获准学习此方向的账号刷新后可见。');}catch(error){status(error.message,true);}finally{lock(false);}};
$('template-json').onclick=()=>download('word-island-template.json',JSON.stringify(DEFAULT_MODULE_BANKS[current()].slice(0,4).map(word=>({...word,audioUrl:''})),null,2),'application/json');
$('template-csv').onclick=()=>{const fields=['word','ipa','meaning','definition','sentence','translation','pos','theme','audioUrl'];const csv=[fields,...DEFAULT_MODULE_BANKS[current()].slice(0,4).map(word=>fields.map(key=>word[key==='word'?'id':key]))].map(row=>row.map(value=>'"'+String(value||'').replaceAll('"','""')+'"').join(',')).join('\r\n');download('word-island-template.csv','\uFEFF'+csv,'text/csv;charset=utf-8');};
$('export-bank').onclick=()=>download(course+'-'+current()+'-words.json',JSON.stringify(banks[current()]||[],null,2),'application/json');
$('account-search').oninput=renderAccounts;
$('accounts-refresh').onclick=async()=>{if(busy)return;lock(true);try{await loadAccounts();}catch(error){status(error.message,true);}finally{lock(false);}};
$('account-cancel').onclick=resetAccount;
$('account-form').onsubmit=async event=>{
 event.preventDefault();if(busy)return;
 const body={username:$('account-username').value,displayName:$('account-name').value,active:$('account-active').checked,courses:Array.from(document.querySelectorAll('[name="assigned-course"]:checked'),input=>input.value)};
 if($('account-password').value)body.password=$('account-password').value;
 const editing=editingId;lock(true);$('account-message').textContent='正在保存…';
 try{await api(editing?'accounts/'+editing:'accounts',editing?'PATCH':'POST',body);await loadAccounts();resetAccount();$('account-message').textContent=editing?'账号已更新。':'账号已创建，请将账号和设置的密码交给使用者。';status(editing?'账号信息已保存。':'新学习账号已创建。');}
 catch(error){$('account-message').textContent=error.message;}finally{lock(false);}
};
