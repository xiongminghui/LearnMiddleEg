export const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

// Learning state is JSON data (also persisted as JSON). This is deliberately
// limited to that state rather than pretending to polyfill structuredClone.
export const cloneState=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

export function uuid(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
