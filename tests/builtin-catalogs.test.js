import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newDb} from 'pg-mem';
import {builtins,manifest,effectiveBanks} from '../server/catalogs.js';
import {migrate} from '../server/database.js';
import {parseImport} from '../public/lib/catalog.js';
import {validEvent} from '../public/lib/protocol.js';
import {createModuleSession,recordAnswer,advanceSession,currentTask} from '../public/lib/engine.js';
import {createProfile} from '../public/lib/store.js';

test('five complete tagged reference lists contain no duplicate IDs and retain real coverage metadata',()=>{
 const counts={'high-school':3677,cet4:3849,cet6:5805,ielts:5040,toefl:6974};
 assert.equal(builtins.size,5);
 for(const [id,count] of Object.entries(counts)){
  const c=builtins.get(id);assert.equal(c.words.length,count);assert.equal(new Set(c.words.map(w=>w.id)).size,count);
  for(const field of ['ipa','meaning','definition','sentence'])assert.equal(c.coverage[field],c.words.filter(w=>w[field]).length);
  assert.ok(c.words.every(w=>w.meaning));assert.ok(c.words.filter(w=>w.sentence).every(w=>w.attribution.includes('tatoeba.org')));
  assert.ok(Object.values(effectiveBanks({id,kind:'builtin'})).every(words=>words.length===count));
 }
 const cet6=new Set(builtins.get('cet6').ids);assert.ok(builtins.get('cet4').ids.every(id=>cet6.has(id)));
 assert.equal(manifest.dictionaryCommit,'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b');
});

test('abbreviations, phrases and incomplete optional fields remain usable and retain attribution on export/import',()=>{
 for(const id of ['account for','in spite of','p.m.','mr.']){
  const word=[...builtins.values()].flatMap(c=>c.words).find(w=>w.id===id);assert.ok(word,id);
  const imported=parseImport(JSON.stringify([word]),'words.json')[0];assert.equal(imported.id,id);assert.equal(imported.attribution,word.attribution);
  const profile=createProfile();profile.session=createModuleSession({spell:[word]},profile.progress,'spell');recordAnswer(profile,id);assert.equal(profile.session.feedback.correct,true);assert.equal(validEvent(profile.pendingEvents[0]),true);
 }
 assert.equal(parseImport('word,meaning\nexample,例子','words.csv')[0].sentence,'');
 assert.throws(()=>parseImport('word,meaning\nexample,','words.csv'),/meaning/);
});

test('large introduction banks advance to unseen words after a completed round',()=>{
 const banks={intro:builtins.get('high-school').words},profile=createProfile();profile.session=createModuleSession(banks,profile.progress,'intro');
 const original=new Set(profile.session.queue.map(t=>t.wordId));
 while(currentTask(profile.session)){recordAnswer(profile,'seen');advanceSession(profile);}
 const next=createModuleSession(banks,profile.progress,'intro');assert.equal(next.queue.length,10);assert.ok(next.queue.every(t=>!original.has(t.wordId)));
});

test('upgrade preserves imported content, account grants and cloud progress in an editable archive',async()=>{
 const memory=newDb({noAstCoverageCheck:true});memory.public.registerFunction({name:'length',args:['text'],returns:'integer',implementation:s=>s.length});const {Pool}=memory.adapters.createPg(),pool=new Pool();
 try{
  for(const file of ['001_initial.sql','002_accounts.sql'])await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await pool.query("INSERT INTO student_accounts(id,username,display_name,password_hash) VALUES('test-user','alice','Alice','test-only')");
  await pool.query("INSERT INTO student_courses(student_id,course_id) VALUES('test-user','high-school')");
  const profile=JSON.stringify(createProfile());await pool.query("INSERT INTO student_profiles(student_id,course_id,revision,profile_json) VALUES('test-user','high-school',7,$1)",[profile]);
  await migrate(pool);await migrate(pool);
  const archived=(await pool.query("SELECT kind,banks_json FROM study_courses WHERE id='custom-legacy-high-school'")).rows[0];assert.equal(archived.kind,'custom');assert.equal(JSON.parse(archived.banks_json).intro.length,5);
  const saved=(await pool.query("SELECT revision,profile_json FROM student_profiles WHERE student_id='test-user' AND course_id='custom-legacy-high-school'")).rows[0];assert.equal(saved.revision,7);assert.equal(saved.profile_json,profile);
  const grants=(await pool.query("SELECT course_id FROM student_courses WHERE student_id='test-user'")).rows;assert.deepEqual(grants.map(g=>g.course_id).sort(),['custom-legacy-high-school','high-school']);
 }finally{await pool.end();}
});
