export const MODULES={intro:'单词认知',recognize:'英译中选择',spell:'中译英拼写',listen:'听音拼写'};
export const CATALOG_KEY='word-island-module-banks-v1';
const FIELDS=['id','ipa','meaning','definition','sentence','translation','pos','theme','family','note','memory'];
export function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else throw Error('CSV 引号格式不正确');}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV 引号未闭合');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(rows.length<2)throw Error('CSV 需要表头和至少一行单词');
 const headers=rows.shift().map(v=>v.trim().replace(/^\uFEFF/,''));if(new Set(headers).size!==headers.length)throw Error('CSV 表头重复');
 return rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`第 ${i+2} 行列数不正确`);return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
}
export function validateWords(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('每个模块请导入 1–1000 个单词');
 const ids=new Set();return rows.map((r,i)=>{
  if(!r||typeof r!=='object')throw Error(`第 ${i+1} 条不是单词对象`);
  const w=Object.fromEntries(FIELDS.map(k=>[k,typeof r[k]==='string'?r[k].trim():'']));w.id=(w.id||String(r.word||'')).toLowerCase();
  if(!/^[a-z]+(?:[-'][a-z]+)*$/.test(w.id)||w.id.length>60)throw Error(`第 ${i+1} 条：word / id 必须是英文单词`);
  if(ids.has(w.id))throw Error(`单词 ${w.id} 重复`);ids.add(w.id);
  for(const k of ['ipa','meaning','definition','sentence','translation'])if(!w[k])throw Error(`${w.id} 缺少 ${k}`);
  if(FIELDS.some(k=>w[k].length>1200))throw Error(`${w.id} 的字段过长`);
  if(!new RegExp(`\\b${w.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(w.sentence))throw Error(`${w.id} 的英文例句需要包含该单词`);
  w.pos||='';w.theme=['explore','challenge','protect'].includes(w.theme)?w.theme:'explore';return w;
 });
}
export function parseImport(text,name){const raw=name.toLowerCase().endsWith('.csv')?parseCSV(text):JSON.parse(text.replace(/^\uFEFF/,''));return validateWords(Array.isArray(raw)?raw:raw.words);}
export function loadBanks(storage){try{const raw=JSON.parse(storage.getItem(CATALOG_KEY)||'{}');return {banks:Object.fromEntries(Object.keys(MODULES).filter(k=>raw[k]).map(k=>[k,validateWords(raw[k])])),error:null};}catch(e){return {banks:{},error:'导入词库无法读取：'+e.message+'。原始数据未覆盖。'};}}
