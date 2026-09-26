import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateWords} from '../public/lib/catalog.js';
import {DEFAULT_WORDS} from '../public/data/words.js';
import {assetResponse} from '../server/app.js';
const code=(await readFile(new URL('../public/lib/speech.js',import.meta.url),'utf8')).replace(/^export /gm,'');
function setup(){
 const recordings=[],utterances=[],errors=[];
 class Audio{constructor(url){this.url=url;recordings.push(this);}play(){this.played=true;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}load(){}}
 class SpeechSynthesisUtterance{constructor(text){this.text=text;}}
 const window={SpeechSynthesisUtterance,speechSynthesis:{cancel(){},getVoices:()=>[{lang:'en-GB',name:'British'}],speak:u=>utterances.push(u)}};
 const context=vm.createContext({Audio,SpeechSynthesisUtterance,window,onError:message=>errors.push(message)});vm.runInContext(code,context);
 return {recordings,utterances,errors,run:source=>vm.runInContext(source,context)};
}
test('a configured word recording is played in preference to synthesized speech and stops on navigation',()=>{
 const s=setup();s.run("speak('explore',onError,'/audio/explore.mp3')");
 assert.equal(s.recordings[0].url,'/audio/explore.mp3');assert.equal(s.recordings[0].played,true);assert.equal(s.utterances.length,0);
 s.run('stopSpeech()');assert.equal(s.recordings[0].paused,true);
});
test('unconfigured words retain device speech, and failed recordings report errors without silently changing voices',()=>{
 const s=setup();s.run("speak('explore',onError)");assert.equal(s.utterances[0].lang,'en-GB');assert.equal(s.utterances[0].voice.name,'British');
 s.run("speak('explore',onError,'/audio/explore.mp3')");s.recordings[0].onerror();s.recordings[0].onerror();
 assert.equal(s.errors.length,1);assert.match(s.errors[0],/录音/);assert.equal(s.utterances.length,1);
});
test('audio metadata survives imports and disallows unsafe or misleading URL schemes',()=>{
 for(const audioUrl of ['', '/audio/explore.mp3','https://example.com/explore.mp3'])assert.equal(validateWords([{...DEFAULT_WORDS[0],audioUrl}])[0].audioUrl,audioUrl);
 for(const audioUrl of ['javascript:alert(1)','http://example.com/a.mp3','//example.com/a.mp3','/audio/../../admin.html','https://user:password@example.com/a.mp3','/audio/\\example.com/a.mp3'])assert.throws(()=>validateWords([{...DEFAULT_WORDS[0],audioUrl}]),/audioUrl/);
});
test('local recordings support byte ranges used by mobile audio playback',async()=>{
 const bytes=Buffer.from('0123456789');
 const request=(range,method='GET')=>new Request('https://example.com/audio/test.mp3',{method,headers:range?{Range:range}:{}});
 let r=assetResponse(request('bytes=0-1'),bytes,'audio/mpeg');assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 0-1/10');assert.equal(await r.text(),'01');
 r=assetResponse(request('bytes=-3'),bytes,'audio/mpeg');assert.equal(await r.text(),'789');
 r=assetResponse(request('bytes=5-'),bytes,'audio/mpeg');assert.equal(await r.text(),'56789');
 assert.equal(assetResponse(request('bytes=10-'),bytes,'audio/mpeg').status,416);
 assert.equal(assetResponse(request('bytes=0-1,5-6'),bytes,'audio/mpeg').status,416);
 r=assetResponse(request(null,'HEAD'),bytes,'audio/mpeg');assert.equal(r.headers.get('Content-Length'),'10');assert.equal(await r.text(),'');
});
