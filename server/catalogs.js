import {readFileSync} from 'node:fs';
import {MODULES,validateWords} from '../public/lib/catalog.js';
import {DEFAULT_MODULE_BANKS} from '../public/data/words.js';

export const manifest=JSON.parse(readFileSync(new URL('../data/builtin/manifest.json',import.meta.url),'utf8'));
const lexicon=validateWords(JSON.parse(readFileSync(new URL('../data/builtin/lexicon.json',import.meta.url),'utf8')));
const wordMap=new Map(lexicon.map(word=>[word.id,word]));
export const builtins=new Map(manifest.courses.map(course=>[course.id,{...course,words:course.ids.map(id=>{const word=wordMap.get(id);if(!word)throw Error('Missing built-in word: '+id);return word;})}]));
const order=new Map([...builtins.keys()].map((id,index)=>[id,index]));
export const courseOrder=(a,b)=>(order.get(a.id)??1000)-(order.get(b.id)??1000)||a.title.localeCompare(b.title,'zh-CN');
export const emptyBanks=()=>Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,[]]));
export function effectiveBanks(course){
 if(course.kind==='builtin'){
  const catalog=builtins.get(course.id);if(!catalog)throw Error('Unknown built-in catalog');
  return Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,catalog.words]));
 }
 const stored=JSON.parse(course.banks_json);
 return Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,stored[kind]||[]]));
}
export function courseInfo(course){
 const catalog=course.kind==='builtin'?builtins.get(course.id):null;
 return {id:course.id,title:course.title,kind:course.kind||'custom',readOnly:!!catalog,revision:course.revision,
  wordCount:catalog?catalog.wordCount:new Set(Object.values(effectiveBanks(course)).flat().map(word=>word.id)).size,
  ...(catalog?{version:manifest.version,coverage:catalog.coverage,scope:catalog.scope,sourceUrl:catalog.sourceUrl}:{})};
}
export function catalogResponse(course,module){
 const result={course:courseInfo(course),revision:course.revision};
 if(module)return {...result,banks:{[module]:effectiveBanks(course)[module]}};
 if(course.kind==='builtin')return {...result,words:builtins.get(course.id).words,allModules:true};
 return {...result,banks:effectiveBanks(course)};
}
// Runs in the migration transaction. Existing content, grants and progress are
// copied before the original fixed IDs become protected built-in directions.
export async function installBuiltinCatalogs(client){
 for(const catalog of builtins.values()){
  const row=(await client.query('SELECT * FROM study_courses WHERE id=$1',[catalog.id])).rows[0];
  if(row?.kind!=='builtin'){
   const stored=JSON.parse(row?.banks_json||'{}');
   const profiles=(await client.query("SELECT student_id FROM student_profiles WHERE course_id=$1 AND profile_json<>'null'",[catalog.id])).rows;
   if(Object.values(stored).some(words=>Array.isArray(words)&&words.length)||profiles.length){
    const legacyId='custom-legacy-'+catalog.id;
    const banks=Object.fromEntries(Object.keys(MODULES).map(kind=>[kind,stored[kind]||(catalog.id==='high-school'?DEFAULT_MODULE_BANKS[kind]:[])]));
    await client.query("INSERT INTO study_courses(id,title,banks_json,revision,kind) VALUES($1,$2,$3,$4,'custom') ON CONFLICT(id) DO NOTHING",[legacyId,'原有词库 · '+row.title,JSON.stringify(banks),row.revision]);
    await client.query('INSERT INTO student_courses(student_id,course_id) SELECT student_id,$1 FROM student_courses WHERE course_id=$2 ON CONFLICT(student_id,course_id) DO NOTHING',[legacyId,catalog.id]);
    await client.query('INSERT INTO student_profiles(student_id,course_id,revision,profile_json,updated_at) SELECT student_id,$1,revision,profile_json,updated_at FROM student_profiles WHERE course_id=$2 ON CONFLICT(student_id,course_id) DO NOTHING',[legacyId,catalog.id]);
   }
  }
  if(!row)await client.query("INSERT INTO study_courses(id,title,kind,builtin_version) VALUES($1,$2,'builtin',$3)",[catalog.id,catalog.title,manifest.version]);
  else if(row.kind!=='builtin'||row.builtin_version!==manifest.version)await client.query("UPDATE study_courses SET title=$1,kind='builtin',builtin_version=$2,banks_json='{}',revision=revision+1 WHERE id=$3",[catalog.title,manifest.version,catalog.id]);
 }
 await client.query("INSERT INTO study_courses(id,title,banks_json,kind) VALUES('custom-bnu','北师大版高中 · 教材词库（待导入）','{}','custom') ON CONFLICT(id) DO NOTHING");
}
