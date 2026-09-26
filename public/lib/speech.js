let serial=0;
export function stopSpeech(){serial++;if('speechSynthesis' in window)window.speechSynthesis.cancel();}
export function speak(text,onError=()=>{}){
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){onError('此浏览器不支持朗读，听音题可选择“暂时想不起来”查看答案，或换用支持英语朗读的浏览器。');return;}
  stopSpeech();const current=serial;
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-GB';utterance.rate=.88;
  const voices=window.speechSynthesis.getVoices();
  utterance.voice=voices.find(v=>v.lang.replace('_','-').toLowerCase()==='en-gb')||voices.find(v=>/^en[-_]/i.test(v.lang))||null;
  utterance.onerror=e=>{if(current===serial&&!['interrupted','canceled'].includes(e.error))onError('设备英语语音暂不可用，请重试；若仍无声音，可选择“暂时想不起来”查看答案。');};
  try{window.speechSynthesis.speak(utterance);}catch{onError('朗读暂不可用，请稍后再试。');}
}
