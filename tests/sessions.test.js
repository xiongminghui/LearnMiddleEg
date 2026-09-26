import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfile,normalizeProfile} from '../public/lib/store.js';
import {DEFAULT_MODULE_BANKS as banks} from '../public/data/words.js';
import {createModuleSession,recordAnswer,advanceSession,currentTask} from '../public/lib/engine.js';
import {enterModule,canAutoAdvance} from '../public/lib/sessions.js';

test('switching modules preserves independent rounds, feedback and positions',()=>{
 const profile=createProfile();
 const spell=enterModule(profile,banks,'spell');recordAnswer(profile,currentTask(spell).wordId);advanceSession(profile);
 const index=spell.index;
 const listen=enterModule(profile,banks,'listen');recordAnswer(profile,'wrong');
 const feedback=listen.feedback;
 for(const kind of ['intro','recognize'])enterModule(profile,banks,kind);
 assert.equal(Object.keys(profile.sessions).length,4);
 assert.equal(enterModule(profile,banks,'spell'),spell);assert.equal(profile.session.index,index);
 assert.equal(enterModule(profile,banks,'listen'),listen);assert.equal(profile.session.feedback,feedback);
});

test('four paused rounds survive backup/reload, including the active session link',()=>{
 let profile=createProfile();
 for(const kind of Object.keys(banks)){enterModule(profile,banks,kind);recordAnswer(profile,currentTask(profile.session).wordId);}
 const snapshot=JSON.parse(JSON.stringify(profile));profile=normalizeProfile(snapshot);
 assert.equal(profile.session,profile.sessions.listen);
 for(const kind of Object.keys(banks)){
  const session=enterModule(profile,banks,kind);
  assert.equal(session.id,snapshot.sessions[kind].id);assert.deepEqual(session.feedback,snapshot.sessions[kind].feedback);
 }
 advanceSession(profile);assert.equal(profile.sessions.listen.index,1);
});

test('the legacy single round is migrated into its module without losing answers',()=>{
 const profile=createProfile();delete profile.sessions;profile.session=createModuleSession(banks,{},'spell');recordAnswer(profile,currentTask(profile.session).wordId);
 const restored=normalizeProfile(JSON.parse(JSON.stringify(profile)));
 assert.equal(restored.sessions.spell.id,profile.session.id);assert.equal(restored.sessions.spell,restored.session);
 assert.deepEqual(restored.session.feedback,profile.session.feedback);
});

test('a completed module starts a new round while other paused modules remain intact',()=>{
 const profile=createProfile();const listening=enterModule(profile,banks,'listen');
 enterModule(profile,banks,'intro');const old=profile.session.id;
 while(!profile.session.finishedAt){recordAnswer(profile,'seen');advanceSession(profile);}
 assert.notEqual(enterModule(profile,banks,'intro').id,old);assert.equal(enterModule(profile,banks,'listen'),listening);
});

test('corrupt or mismatched saved modules are discarded independently',()=>{
 const profile=createProfile();for(const kind of Object.keys(banks))enterModule(profile,banks,kind);
 const raw=JSON.parse(JSON.stringify(profile));raw.sessions.spell.queue[0].kind='listen';raw.sessions.intro.index=-1;
 const restored=normalizeProfile(raw);
 assert.equal(restored.sessions.spell,undefined);assert.equal(restored.sessions.intro,undefined);
 assert.equal(restored.sessions.recognize.id,profile.sessions.recognize.id);assert.equal(restored.sessions.listen.id,profile.sessions.listen.id);
});

test('spelling always waits for Next even with automatic advancement enabled',()=>{
 const profile=createProfile();profile.preferences.autoAdvance=true;
 for(const kind of Object.keys(banks)){
  enterModule(profile,banks,kind);recordAnswer(profile,currentTask(profile.session).wordId);
  assert.equal(canAutoAdvance(profile),['recognize','listen'].includes(kind));
 }
 profile.preferences.autoAdvance=false;assert.equal(canAutoAdvance(profile),false);
});

test('a replaced bank starts a new round rather than resuming words removed by the administrator',()=>{
 const profile=createProfile();const old=enterModule(profile,banks,'spell');
 recordAnswer(profile,currentTask(old).wordId);
 const progress=JSON.parse(JSON.stringify(profile.progress));
 const updated={...banks,spell:[banks.intro[0]]};
 const current=enterModule(profile,updated,'spell');
 assert.notEqual(current.id,old.id);assert.deepEqual(current.queue.map(task=>task.wordId),[banks.intro[0].id]);assert.deepEqual(profile.progress,progress);
});
