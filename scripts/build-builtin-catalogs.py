"""Build complete ECDICT-tag reference lists. No network is used at application startup.
Usage: python3 scripts/build-builtin-catalogs.py /path/ecdict.csv /path/cmn-eng.zip
Input dictionary: skywind3000/ECDICT commit bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b.
"""
import csv,hashlib,json,re,sys,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source,pairs=map(Path,sys.argv[1:3]);data=source.read_bytes()
assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()=='c4ade63ea08cf39d9c3475e96929036d64d94c94','Incomplete or unexpected dictionary'
groups={'high-school':('高中英语 · 高考词汇',{'gk'}),'cet4':('大学英语四级',{'cet4'}),'cet6':('大学英语六级 · 含四级基础',{'cet4','cet6'}),'ielts':('雅思英语',{'ielts'}),'toefl':('托福英语',{'toefl'})}
rows={};members={key:set() for key in groups}
for row in csv.DictReader(data.decode('utf-8-sig').splitlines()):
 word=row['word'].strip().lower();tags=set(row['tag'].split())
 matched=[key for key,(_,wanted) in groups.items() if tags&wanted]
 if not matched:continue
 assert re.fullmatch(r"[a-z]+(?:[ .'-][a-z]+)*\.?",word),word
 assert row['translation'],word
 rows[word]=row
 for key in matched:members[key].add(word)
assert len(rows)>11000
examples={};phrases=[w for w in rows if ' ' in w or '.' in w]
with zipfile.ZipFile(pairs) as archive:
 assert archive.testzip() is None
 for line in archive.read('cmn.txt').decode('utf-8').splitlines():
  en,zh,credit=line.split('\t',2);tokens=re.findall(r"[a-z]+(?:[-'][a-z]+)*",en.lower())
  if not 3<=len(tokens)<=22 or len(en)>220 or len(zh)>220:continue
  found=set(tokens)&rows.keys()
  found.update(word for word in phrases if re.search(r'(?<![a-z])'+re.escape(word)+r'(?![a-z])',en,re.I))
  score=abs(len(tokens)-9)+en.count('Tom')+en.count('Mary')
  for word in found:
   if word not in examples or score<examples[word][0]:examples[word]=(score,en,zh,credit)
 (root/'public/licenses/Tatoeba-ABOUT.txt').write_bytes(archive.read('_about.txt'))
def concise(text):
 lines=text.replace('\\n','\n').splitlines();out=[]
 for line in lines:
  line=line.strip()
  if line and len('\n'.join(out+[line]))<=1200:out.append(line)
  if len(out)>=2:break
 return '\n'.join(out)
lexicon=[]
for word,row in sorted(rows.items()):
 ex=examples.get(word);ipa=row['phonetic'].strip();meaning=concise(row['translation']);pos=re.match(r'^([a-z]+\.)',meaning)
 entry={'id':word,'ipa':'/'+ipa.strip('/')+'/' if ipa else '', 'meaning':meaning,'definition':concise(row['definition']),'sentence':ex[1] if ex else '', 'translation':ex[2] if ex else '', 'attribution':ex[3] if ex else '', 'source':'ECDICT','pos':pos[1] if pos else '', 'theme':'explore','family':'','memory':'','note':'','audioUrl':''}
 lexicon.append(entry)
by={w['id']:w for w in lexicon}
manifest={'version':'2026-09-26.1','dictionaryCommit':'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b','dictionarySHA256':hashlib.sha256(data).hexdigest(),'examplesSHA256':hashlib.sha256(pairs.read_bytes()).hexdigest(),'courses':[]}
for key,(title,tags) in groups.items():
 ids=sorted(members[key],key=lambda word:(int(rows[word]['frq'] or 0) or int(rows[word]['bnc'] or 0) or 999999,word));words=[by[word] for word in ids]
 course={'id':key,'title':title,'tags':sorted(tags),'wordCount':len(ids),'ids':ids,'coverage':{field:sum(bool(w[field]) for w in words) for field in ['ipa','meaning','definition','sentence']},'scope':'按 ECDICT 标签全量收录的开源备考参考词表，非考试机构官方完整考纲。'+('高中为通用高考词汇，尚未按北师大教材册次核对。' if key=='high-school' else ''),'sourceUrl':'https://github.com/skywind3000/ECDICT','exampleSourceUrl':'https://www.manythings.org/anki/'}
 manifest['courses'].append(course)
for filename,value in [('lexicon.json',lexicon),('manifest.json',manifest)]:
 text='[\n'+',\n'.join(json.dumps(word,ensure_ascii=False,separators=(',',':')) for word in value)+'\n]\n' if filename=='lexicon.json' else json.dumps(value,ensure_ascii=False,indent=2)+'\n'
 (root/'data/builtin'/filename).write_text(text)
print(json.dumps([{k:v for k,v in c.items() if k in ['id','wordCount','coverage']} for c in manifest['courses']],ensure_ascii=False,indent=2))
