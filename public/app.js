import {MODULES} from './lib/catalog.js';
import {enterModule,rememberSession,canAutoAdvance} from './lib/sessions.js';
import {openDialog,closeDialog} from './lib/dialog.js';
import {WORDS,WORD_MAP,THEMES,DEFAULT_WORDS,DEFAULT_MODULE_BANKS,MODULE_BANKS,catalogState} from './data/words.js';
import {planLesson,createSession,createModuleSession,currentTask,recordAnswer,advanceSession,dueWords,dayKey,stageLabel} from './lib/engine.js';
import {loadProfile,saveProfile,normalizeProfile,STORAGE_KEY} from './lib/store.js';
import {speak,stopSpeech} from './lib/speech.js';
import {createSync} from './lib/sync.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={arrow:'M4 12h16m-6-6 6 6-6 6',back:'M20 12H4m6-6-6 6 6 6',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',sound:'m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',book:'M3 5c3-1 6 0 9 2 3-2 6-3 9-2v14c-3-1-6 0-9 2-3-2-6-3-9-2ZM12 7v14',clock:'M12 7v5l3 2',leaf:'M20 3C8 2 2 9 6 16s16 2 14-13zM4 21 15 10',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',retry:'M3 9a9 9 0 1 1 0 6M3 4v5h5',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${name==='clock'?'<circle cx="12" cy="12" r="9"/>':''}<path d="${paths[name]||paths.leaf}"/></svg>`;
const loaded=loadProfile();let profile=loaded.profile,readOnly=!!loaded.readFailed,persistent=!readOnly;
let route='home',filter='all',query='',draft='',selected='',assisted=false,activeTaskId='',taskStarted=performance.now(),autoTimer,toastTimer,cloudKind='local',cloudText='学习记录保存在本机';
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);$('announcer').textContent=message;}
function updateStorage(){
  $('save-status').textContent=persistent?(cloudKind==='cloud'?'云端已连接':'本机记录'):'临时记录';
  $('save-status').title=persistent?cloudText:'无法保存到浏览器，请导出备份。';
}
function persist(){persistent=!readOnly&&saveProfile(profile);if(!persistent){$('storage-warning').hidden=false;$('storage-warning').textContent='当前无法保存本机记录，请在“设置与备份”中导出。学习仍可继续。';}updateStorage();return persistent;}
const sync=createSync(()=>profile,persist,(kind,text)=>{cloudKind=kind;cloudText=text;updateStorage();});
function clearAuto(){clearTimeout(autoTimer);autoTimer=null;}
function when(time){if(!time)return '未安排';const delta=time-Date.now();if(delta<=0)return '现在可复习';if(delta<3600000)return `${Math.max(1,Math.ceil(delta/60000))} 分钟后`;if(dayKey(time)===dayKey())return '今天 '+new Date(time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});return new Date(time).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function streak(){const days=new Set(profile.history.map(h=>dayKey(h.at)));let d=new Date(),count=0;if(!days.has(dayKey(d.getTime())))d.setDate(d.getDate()-1);while(days.has(dayKey(d.getTime()))&&count<366){count++;d.setDate(d.getDate()-1);}return count;}
function navigate(next){clearAuto();stopSpeech();route=next;render();window.scrollTo({top:0,behavior:'auto'});$('main').focus({preventScroll:true});}
function render(){
  for(const button of document.querySelectorAll('[data-nav]')){const active=button.dataset.nav===(['session','summary'].includes(route)?'home':route);button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');}
  if(route==='session')renderSession();else if(route==='summary')renderSummary();else if(route==='library')renderLibrary();else if(route==='history')renderHistory();else renderHome();
  updateStorage();
}
const moduleBanks=Object.fromEntries(Object.keys(MODULES).map(k=>[k,MODULE_BANKS[k]||DEFAULT_MODULE_BANKS[k]]));
const taskWord=task=>moduleBanks[task.kind]?.find(w=>w.id===task.wordId)||WORD_MAP[task.wordId];
let libraryModule='intro';
function renderHome(){
 const descriptions={intro:'听发音，自由选择查看英文释义或中文与例句。',recognize:'看英文，从本模块的中文释义中选出答案。',spell:'看中文，独立拼出英文，答错后查看完整讲解。',listen:'只听发音，写下英文，可以重复播放。'};
 const visuals={intro:'book',recognize:'check',spell:'spark',listen:'sound'};
 $('main').innerHTML=`<section class="welcome"><div><div class="eyebrow">FOUR WAYS TO LEARN</div><h1>选择一个模块，开始学习。</h1><p>四个独立入口，四份独立词库。每次只练当前模块。</p></div><span class="streak">${icon('leaf')}已连续学习 <b>${streak()}</b> 天</span></section>
 <section class="module-grid" aria-label="四个学习模块">${Object.entries(MODULES).map(([kind,name],i)=>`<article class="module-card"><div class="module-card-top"><span class="module-icon">${icon(visuals[kind])}</span><span class="muted">MODULE 0${i+1}</span></div><h2>${name}</h2><p>${descriptions[kind]}</p><div class="module-count"><strong>${moduleBanks[kind].length}</strong> 个单词 <span>· 独立词库</span></div><div class="module-card-actions"><button class="primary" data-module="${kind}">${profile.sessions[kind]&&!profile.sessions[kind].finishedAt?'继续本模块':'进入模块'} ${icon('arrow')}</button><button class="text-button" data-module-library="${kind}">查看本模块单词</button></div></article>`).join('')}</section>
 <section class="panel module-explanation"><h2>练习与词库一一对应</h2><p>进入哪个模块，就练哪个模块的单词。每个模块分别保留未完成进度，切换后可随时回来继续。</p><a class="text-button" href="admin.html">管理四个模块的词库 ${icon('arrow')}</a></section>`;
}
function startLesson(practiceId=null){
  clearAuto();stopSpeech();rememberSession(profile);
  const saved=profile.sessions[libraryModule];
  if(practiceId&&saved&&!saved.finishedAt&&!confirm('单词专项练习会重新开始本模块的轮次，其他模块进度保持不变。继续吗？'))return;
  if(practiceId){profile.session=createModuleSession({[libraryModule]:moduleBanks[libraryModule].filter(w=>w.id===practiceId)},profile.progress,libraryModule);rememberSession(profile);}
  else enterModule(profile,moduleBanks,libraryModule);
  if(!profile.session.queue.length){toast('暂时没有可练习的单词。');return;}
  activeTaskId='';persist();navigate('session');
}
const reveals=new Map();
function taskHint(word,task){return task.kind==='recognize'?word.memory:`${word.id.slice(0,2)}…，共 ${word.id.length} 个字母。${word.note}`;}
function highlighted(word){const at=word.sentence.toLowerCase().indexOf(word.id);return `${esc(word.sentence.slice(0,at))}<mark>${word.id}</mark>${esc(word.sentence.slice(at+word.id.length))}`;}
const audioSource=word=>word.audioUrl?'词库录音':'设备合成语音 · 优先英式英语';
function wordInfo(word,progressive=false){
  const shown=progressive?(reveals.get(activeTaskId)||{}):{english:true,chinese:true};
  return `<span class="small-label">${THEMES[word.theme].name} · 高中核心词</span><h2 class="word-title" lang="en">${word.id}</h2><div class="pronounce"><span>英 ${esc(word.ipa)}</span><button class="audio-button" data-speak="${word.id}" data-audio="${esc(word.audioUrl||'')}" aria-label="朗读 ${word.id}">${icon('sound')}朗读</button></div><p class="audio-source">${audioSource(word)}</p>
  ${progressive?`<div class="definition-actions"><button class="secondary" data-action="reveal-english" aria-expanded="${!!shown.english}" aria-controls="english-definition">英译英</button><button class="secondary" data-action="reveal-chinese" aria-expanded="${!!shown.chinese}" aria-controls="chinese-definition">中文翻译</button></div>`:''}
  ${shown.english?`<section class="definition-block" ${progressive?'id="english-definition"':''}><h3>英文释义</h3><p lang="en">${esc(word.definition)}</p></section>`:''}
  ${shown.chinese?`<section ${progressive?'id="chinese-definition"':''}><div class="meaning-line"><i>${esc(word.pos)}</i>${esc(word.meaning)}</div><div class="example-block"><h3>英文造句</h3><p lang="en">${highlighted(word)}</p><p class="translation">${esc(word.translation)}</p></div><div class="memory-box">${esc(word.memory)}</div><details class="word-family"><summary>词族与用法，一起记</summary><p>${esc(word.family)}</p><p>${esc(word.note)}</p></details></section>`:''}`;
}
function renderSession(){
  const session=profile.session;if(!session){route='home';renderHome();return;}if(session.finishedAt){route='summary';renderSummary();return;}
  const task=currentTask(session),word=taskWord(task);
  if(activeTaskId!==task.id){activeTaskId=task.id;draft='';selected='';assisted=false;taskStarted=performance.now();}
  const feedback=session.feedback;
  const labels={intro:['模块 1 · 单词认知','英译英和中文翻译可分别点击，按自己的顺序查看。'],recognize:['模块 2 · 英译中选择','从辨认开始，下一步再练主动回忆。'],spell:['模块 3 · 中译英拼写','根据中文意思填写英文；检查后，手动点击下一步。'],listen:['模块 4 · 听音拼写','点击播放，听清单词后填写英文；可以重复播放。']};
  let body='';
  if(task.kind==='intro')body=`<div class="intro-card"><div class="intro-art"><img src="${THEMES[word.theme].image}" alt="${esc(word.memory)}"><p>${THEMES[word.theme].caption}</p></div><div class="intro-content">${wordInfo(word,true)}</div></div>`;
  else if(task.kind==='recognize'){
    body=`<div class="task-body"><div class="recall-label">识义 · RECOGNIZE</div><div class="recognition-head"><h2 class="word-title" lang="en">${word.id}</h2><button class="audio-button" data-speak="${word.id}" data-audio="${esc(word.audioUrl||'')}" aria-label="朗读单词">${icon('sound')}</button></div><p class="audio-source">${audioSource(word)}</p><div class="choices">${choicesForTask(task).map((option,i)=>`<button class="choice ${feedback?(option.id===word.id?'correct':option.id===selected?'wrong':''):''}" data-choice="${option.id}" ${feedback?'disabled':''}><span class="choice-key">${i+1}</span><span>${esc(option.meaning)}</span>${feedback&&option.id===word.id?icon('check'):''}</button>`).join('')}</div>${assisted&&!feedback?`<div class="hint-box">${esc(taskHint(word,task))}<br>用了提示的题会继续安排巩固。</div>`:''}</div>`;
  } else {
    body=`<div class="task-body"><div class="recall-label">${task.kind==='spell'?'主动回忆 · RECALL':'听音拼写 · LISTEN'}</div>${task.kind==='spell'?`<h2 class="recall-prompt">${esc(word.meaning)}</h2><p class="recall-help">${esc(word.pos)} · 先独立回忆，想不起来时再看提示。</p>`:`<div class="listening-prompt"><button class="primary" data-action="listen-word" aria-label="播放单词发音">${icon('sound')}播放单词发音</button><p class="recall-help">听一听，再写下你听到的英文单词。可以重复播放。</p><p class="audio-source">${audioSource(word)}</p></div>`}<form id="answer-form"><label class="sr-only" for="answer-input">输入英文单词</label><input class="answer-input" id="answer-input" type="text" value="${esc(draft)}" placeholder="输入你想到的单词…" lang="en" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="80" ${feedback?'disabled':''}><p class="input-note">按 Enter 检查答案 · 不区分大小写</p></form>${assisted&&!feedback?`<div class="hint-box">${esc(taskHint(word,task))}<br>用了提示的题会继续安排巩固。</div>`:''}</div>`;
  }
  const message=feedback?(feedback.independent?'独立回忆成功。':feedback.correct?'借助提示答对了，再巩固一次。':feedback.skip?'暂时想不起来也没关系。':'差一点，看看哪里需要调整。'):'';
  const feedbackHTML=feedback&&task.kind!=='intro'?`<div class="feedback ${feedback.independent?'':'bad'}" role="status"><div class="feedback-title">${icon(feedback.independent?'check':'retry')}${message}</div><p><b lang="en">${word.id}</b> · ${esc(word.meaning)} ${draft&&!feedback.correct?`<br>你写的是：${esc(draft)}`:''}<br>${esc(word.note)}${!feedback.independent?`<br>${feedback.retryQueued?'这个词会隔两道题再出现，先练其他内容。':'本轮已达到重试上限或没有其他词可穿插，完成后会安排短间隔复习。'}`:''}</p>${!feedback.correct?`<div class="correction-detail"><div class="pronounce"><span>英 ${esc(word.ipa)}</span><button class="audio-button" data-speak="${word.id}" data-audio="${esc(word.audioUrl||'')}" aria-label="朗读正确答案 ${word.id}">${icon('sound')}朗读正确答案</button></div><p class="audio-source">${audioSource(word)}</p><h3>英文释义</h3><p lang="en">${esc(word.definition)}</p><h3>英文造句</h3><p lang="en">${highlighted(word)}</p><p>${esc(word.translation)}</p></div>`:''}</div>`:'';
  $('main').innerHTML=`<div class="session-top"><button class="text-button" data-nav="home">${icon('back')}暂停并返回</button><div class="session-meta"><b>${MODULES[session.moduleKind]||'单词练习'}</b><span class="muted">${session.index+1} / ${session.queue.length} 步</span></div></div><div class="session-progress" role="progressbar" aria-label="本轮进度" aria-valuenow="${session.index}" aria-valuemin="0" aria-valuemax="${session.queue.length}"><span style="width:${session.index/session.queue.length*100}%"></span></div><div class="session-layout"><div class="task-heading"><div><h1 id="task-title" tabindex="-1">${labels[task.kind][0]}</h1><p>${task.attempt?'隔题再练 · ':''}${labels[task.kind][1]}</p></div>${['recognize','listen'].includes(task.kind)?`<label class="auto-pref"><input type="checkbox" data-pref="autoAdvance" ${profile.preferences.autoAdvance?'checked':''}>答对后自动继续</label>`:task.kind==='spell'?'<span class="auto-pref">本模块手动进入下一步</span>':''}</div><article class="lesson-card">${body}${feedbackHTML}</article><div class="task-actions">${task.kind==='intro'?`<span class="auto-note">按自己的节奏看完，再继续。</span><button class="primary" data-action="intro-next">认识了，继续 ${icon('arrow')}</button>`:feedback?`<span class="auto-note" id="auto-note">${feedback.independent?'准备好后，点击继续。':'看懂解释后，再继续'}</span><button class="primary" data-action="next">下一步 ${icon('arrow')}</button>`:`<div><button class="text-button" data-action="hint" ${assisted?'disabled':''}>给我提示</button><button class="text-button" data-action="skip">暂时想不起来</button></div>${task.kind==='recognize'?'<span class="auto-note">选择一个答案</span>':'<button class="primary" type="submit" form="answer-form">检查答案 '+icon('arrow')+'</button>'}`}</div><p class="session-foot">学习进度自动保留 · 答错会追加少量复习题 · 使用提示不计为独立答对</p></div>`;
  requestAnimationFrame(()=>{if(['spell','listen'].includes(task.kind)&&!feedback)$('answer-input')?.focus({preventScroll:true});});
  $('announcer').textContent=`第 ${session.index+1} 步，${labels[task.kind][0]}`;
}
import {choicesFor as choicesForTaskBase} from './lib/engine.js';
const choicesForTask=task=>choicesForTaskBase(task,[taskWord(task),...moduleBanks.recognize].filter((w,i,all)=>all.findIndex(x=>x.id===w.id||x.meaning===w.meaning)===i));
function scheduleAuto(){clearAuto();if(!canAutoAdvance(profile)||document.hidden)return;const taskId=currentTask(profile.session)?.id;if($('auto-note'))$('auto-note').textContent='约 1.5 秒后自动继续，也可以直接点击。';autoTimer=setTimeout(()=>{if(route==='session'&&currentTask(profile.session)?.id===taskId&&!document.hidden)nextStep();},1450);}
function submitAnswer(value,skip=false){
  const task=currentTask(profile.session);if(!task||profile.session.feedback)return;
  if(!skip&&task.kind!=='intro'&&!String(value).trim()){toast('先写下你想到的单词，或选择“暂时想不起来”。');$('answer-input')?.focus();return;}
  const feedback=recordAnswer(profile,value,{assisted,skip,latencyMs:performance.now()-taskStarted});
  if(!feedback)return;persist();sync.flush();
  if(task.kind==='intro'){nextStep();return;}
  renderSession();scheduleAuto();
}
function nextStep(){clearAuto();stopSpeech();if(!advanceSession(profile))return;activeTaskId='';persist();sync.flush();renderSession();window.scrollTo({top:0,behavior:'auto'});}
function renderSummary(){
  const summary=profile.history.find(h=>h.id===profile.session?.id)||profile.history[0];if(!summary){route='home';renderHome();return;}
  const next=Object.values(profile.progress).map(p=>p.dueAt).sort((a,b)=>a-b)[0];
  $('main').innerHTML=`<section class="summary"><div class="summary-icon">${icon('check')}</div><div class="eyebrow">A LITTLE PROGRESS, EVERY DAY</div><h1>这一小轮，走完了。</h1><p>把今天的一点点，交给之后的几次相遇。</p><div class="history-stats"><div class="history-stat"><strong>${summary.newCount}</strong><span>本轮认识新词</span></div><div class="history-stat"><strong>${summary.correct} / ${summary.total}</strong><span>首次独立答对</span></div><div class="history-stat"><strong>${summary.retries}</strong><span>追加巩固题</span></div></div><section class="panel"><div class="section-heading"><h2>${summary.weakIds.length?'这些词，下次再照顾一下':'今天的独立回忆做得不错'}</h2><span>不是一次答对就毕业</span></div>${summary.weakIds.length?summary.weakIds.map(id=>`<div class="review-row"><div class="word-mini"><strong lang="en">${id}</strong><small>${esc(WORD_MAP[id].meaning)}</small></div><span class="tag amber">${when(profile.progress[id]?.dueAt)}</span></div>`).join(''):`<p class="empty-copy">下次复习：${when(next)}。按时回来，不用今天一次全部刷完。</p>`}<p class="settings-note">答错、跳过或借助提示的词会短间隔复习；完整独立完成后，再逐步延长间隔。</p></section><div class="summary-actions"><button class="primary" data-nav="home">回到今日学习 ${icon('arrow')}</button><button class="secondary" data-nav="history">看看学习记录</button></div><p class="quote">Little by little, a little becomes a lot.</p></section>`;
}
function filteredWords(){return moduleBanks[libraryModule].filter(w=>(filter==='all'||filter===w.theme||(filter==='weak'&&profile.progress[w.id]?.stage===0)||(filter==='saved'&&profile.favorites.includes(w.id)))&&(!query||`${w.id} ${w.meaning}`.toLowerCase().includes(query.toLowerCase())));}
function libraryCards(){const list=filteredWords();return list.length?list.map(w=>`<button class="library-word" data-word="${w.id}"><img src="${THEMES[w.theme].image}" alt="" width="66" height="84"><span><strong lang="en">${w.id}</strong><small>${esc(w.meaning)}</small><span class="tag ${profile.progress[w.id]?.stage===0?'amber':''}">${stageLabel(profile.progress[w.id])}${profile.favorites.includes(w.id)?' · 已收藏':''}</span></span></button>`).join(''):'<p class="no-results">这里暂时没有单词。可以换个筛选条件。</p>';}
function renderLibrary(){
  $('main').innerHTML=`<header class="page-heading"><div class="eyebrow">YOUR WORD COLLECTION</div><h1>${MODULES[libraryModule]} · 独立词库</h1><p>这里仅显示本模块的 ${moduleBanks[libraryModule].length} 个单词。</p></header><div class="filter-group module-library-tabs">${Object.entries(MODULES).map(([k,name])=>`<button class="filter-button ${libraryModule===k?'active':''}" data-module-library="${k}">${name}</button>`).join('')}</div><div class="library-controls"><div class="filter-group">${[['all','全部'],['explore','探索世界'],['challenge','挑战成长'],['protect','自然生活'],['weak','待巩固'],['saved','已收藏']].map(([id,name])=>`<button class="filter-button ${filter===id?'active':''}" data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join('')}</div><input id="word-search" class="search-input" type="search" placeholder="搜索单词或中文意思" aria-label="搜索词库" value="${esc(query)}"></div><div class="library-grid" id="library-grid">${libraryCards()}</div>`;
}
function renderHistory(){
  const history=profile.history,days=new Set(history.map(h=>dayKey(h.at))).size,correct=history.reduce((n,h)=>n+h.correct,0),total=history.reduce((n,h)=>n+h.total,0);
  $('main').innerHTML=`<header class="page-heading"><div class="eyebrow">SMALL STEPS, REAL PROGRESS</div><h1>进步，藏在每一次回忆里。</h1><p>这里保留最近 120 轮记录。首次独立答对率不包含看提示和重试答对。</p></header><div class="history-stats"><div class="history-stat"><strong>${history.length}</strong><span>完成轮次</span></div><div class="history-stat"><strong>${days}</strong><span>记录中的学习天数</span></div><div class="history-stat"><strong>${total?Math.round(correct/total*100)+'%':'—'}</strong><span>首次独立答对率</span></div></div>${history.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>时间</th><th>新词 / 复习</th><th>首次独立答对</th><th>追加巩固</th></tr></thead><tbody>${history.map(h=>`<tr><td>${new Date(h.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td><td>${h.newCount} / ${h.reviewCount}</td><td>${h.correct} / ${h.total}</td><td>${h.retries} 题</td></tr>`).join('')}</tbody></table></div>`:'<section class="panel"><p class="empty-copy">还没有完成的学习轮次。从今天的第一小轮开始吧。</p><button class="primary" data-action="start">开始学习 '+icon('arrow')+'</button></section>'}<p class="settings-note">记录属于当前浏览器。你可以在“设置与备份”中导出，换设备后手动导入。</p>`;
}
function openWord(id){const w=moduleBanks[libraryModule].find(w=>w.id===id);if(!w)return;clearAuto();$('detail-dialog').innerHTML=`<button class="dialog-close" data-close="detail-dialog" aria-label="关闭单词详情">${icon('close')}</button><h2 id="detail-title" class="sr-only">${id} 单词详情</h2><img class="detail-image" src="${THEMES[w.theme].image}" alt="${esc(w.memory)}">${wordInfo(w)}<div class="dialog-actions"><button class="primary" data-practice-word="${id}">在本模块练习此词</button><button class="secondary" data-favorite="${id}">${icon('star')}${profile.favorites.includes(id)?'取消收藏':'收藏单词'}</button></div>`;if(!$('detail-dialog').hasAttribute('open'))openDialog($('detail-dialog'));}
function openSettings(){clearAuto();$('settings-dialog').innerHTML=`<button class="dialog-close" data-close="settings-dialog" aria-label="关闭设置">${icon('close')}</button><h2 class="dialog-heading" id="settings-title">按自己的节奏，慢慢记牢。</h2><div class="settings-row"><div><p>答对后自动继续</p><small>仅适用于英译中选择和听音拼写。中译英拼写、答错和单词认知始终手动继续。</small></div><input type="checkbox" data-pref="autoAdvance" aria-label="答对后自动继续" ${profile.preferences.autoAdvance?'checked':''}></div><div class="settings-row"><div><p>单词发音来源</p><small>优先播放词库配置的录音。没有录音时使用设备合成语音，优先英式英语；音色可能因设备不同而变化。设备语音不等同于北师大版教材录音。</small></div></div><div class="settings-row"><div><p>学习记录</p><small>${esc(persistent?cloudText:'当前为临时记录，请及时导出')}<br>云端可备份交互事件，不会自动跨设备同步学习进度。</small></div></div><div class="settings-row"><div><p>保存一份自己的进度</p><small>导出词汇状态、轮次记录和未完成的练习。不包含设备访问密钥。</small></div><button class="secondary small" data-action="export">导出备份</button></div><div class="settings-row"><div><p>从备份继续</p><small>导入会替换当前浏览器的学习进度。</small></div><button class="secondary small" data-action="import">导入备份</button></div><p class="settings-note">复习采用固定间隔演示规则：完整独立回忆后逐步延长至 1、3、7、14、30 天；出现困难则 10 分钟后再见。它不预测真实遗忘概率。关闭页面后不会发送提醒。</p>`;openDialog($('settings-dialog'));}
function exportBackup(){const blob=new Blob([JSON.stringify(profile,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`词屿学习备份-${dayKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('学习备份已准备下载。');}
function speechError(message){toast(message);const dialog=document.querySelector('dialog[open]');if(dialog){let p=dialog.querySelector('.speech-error');if(!p){p=document.createElement('p');p.className='settings-note speech-error';p.setAttribute('role','status');dialog.append(p);}p.textContent=message;}}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.moduleLibrary){libraryModule=button.dataset.moduleLibrary;filter='all';query='';navigate('library');return;}
  if(button.dataset.module){const kind=button.dataset.module;if(kind==='recognize'&&new Set(moduleBanks[kind].map(w=>w.meaning)).size<2){toast('本模块至少需要 2 个中文释义不同的单词，请先在后台补充。');return;}libraryModule=kind;enterModule(profile,moduleBanks,kind);activeTaskId='';persist();navigate('session');return;}
  if(button.dataset.nav){navigate(button.dataset.nav);return;}
  if(button.dataset.theme){filter=button.dataset.theme;query='';navigate('library');return;}
  if(button.dataset.filter){filter=button.dataset.filter;renderLibrary();return;}
  if(button.dataset.word){openWord(button.dataset.word);return;}
  if(button.dataset.close){closeDialog($(button.dataset.close));stopSpeech();return;}
  if(button.dataset.speak){speak(button.dataset.speak,speechError,button.dataset.audio);return;}
  if(button.dataset.choice){selected=button.dataset.choice;submitAnswer(selected);return;}
  if(button.dataset.practiceWord){closeDialog($('detail-dialog'));startLesson(button.dataset.practiceWord);return;}
  if(button.dataset.favorite){const id=button.dataset.favorite;profile.favorites=profile.favorites.includes(id)?profile.favorites.filter(v=>v!==id):[...profile.favorites,id];persist();openWord(id);if(route==='library')renderLibrary();return;}
  switch(button.dataset.action){
    case 'listen-word':{const task=currentTask(profile.session);if(task?.kind==='listen')speak(task.wordId,speechError,taskWord(task).audioUrl);break;}
    case 'start':startLesson();break;
    case 'reveal-english':
    case 'reveal-chinese':{const field=button.dataset.action==='reveal-english'?'english':'chinese';const shown=reveals.get(activeTaskId)||{};reveals.set(activeTaskId,{...shown,[field]:!shown[field]});renderSession();$('main').querySelector('[data-action="'+button.dataset.action+'"]')?.focus({preventScroll:true});break;}
    case 'intro-next':submitAnswer('seen');break;
    case 'next':nextStep();break;
    case 'skip':submitAnswer('',true);break;
    case 'hint':assisted=true;renderSession();break;
    case 'settings':openSettings();break;
    case 'export':exportBackup();break;
    case 'import':$('import-file').click();break;
  }
});
document.addEventListener('input',event=>{if(event.target.id==='answer-input')draft=event.target.value;if(event.target.id==='word-search'){query=event.target.value;$('library-grid').innerHTML=libraryCards();}});
document.addEventListener('change',event=>{if(event.target.dataset.pref==='autoAdvance'){profile.preferences.autoAdvance=event.target.checked;persist();if(route==='session')renderSession();if(!$('settings-dialog').hasAttribute('open'))scheduleAuto();}});
document.addEventListener('submit',event=>{if(event.target.id==='answer-form'){event.preventDefault();submitAnswer(draft);}});
document.addEventListener('keydown',event=>{
  if(route!=='session'||document.querySelector('dialog[open]')||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.target.closest('input,textarea,select'))return;
  const task=currentTask(profile.session);if(!task)return;
  if(task.kind==='recognize'&&!profile.session.feedback&&['1','2','3','4'].includes(event.key)){event.preventDefault();selected=choicesForTask(task)[Number(event.key)-1].id;submitAnswer(selected);}
});
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  if(file.size>5*1024*1024){toast('备份文件过大，请选择 5 MB 以内的词屿备份。');return;}
  try{const restored=normalizeProfile(JSON.parse(await file.text()));if(!confirm('导入会替换当前学习进度。建议先导出一份备份。确定导入吗？'))return;clearAuto();stopSpeech();profile=restored;readOnly=false;activeTaskId='';persist();closeDialog($('settings-dialog'));navigate('home');toast('已恢复学习进度。');sync.flush();}catch{toast('无法识别这份备份，请检查是否为词屿导出的 JSON 文件。');}
});
window.addEventListener('hashchange',()=>{if(location.hash==='#home')navigate('home');});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearAuto();stopSpeech();}else if(route==='home')renderHome();else if(route==='session'&&$('auto-note'))$('auto-note').textContent='准备好后，点击继续。';});
window.addEventListener('pagehide',()=>{clearAuto();stopSpeech();});
window.addEventListener('storage',event=>{if(event.key!==STORAGE_KEY||!event.newValue)return;try{clearAuto();profile=normalizeProfile(JSON.parse(event.newValue));activeTaskId='';render();toast('另一标签页更新了学习记录，已同步。');}catch{}});
if(loaded.warning){$('storage-warning').textContent=loaded.warning;$('storage-warning').hidden=false;}
if(!readOnly)persist();render();sync.init();

if(catalogState.error){$('storage-warning').hidden=false;$('storage-warning').textContent=catalogState.error;}

document.querySelector('.site-footer .muted').textContent=`/ ${WORDS.length} 个可学习词`;
