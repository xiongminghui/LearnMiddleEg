import {scrypt,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const options={N:32768,r:8,p:3,maxmem:64*1024*1024};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sameSecret=(a,b)=>timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
export async function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 const key=await derive(password,salt,64,options);
 return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password,encoded){
 const [,salt,key]=encoded.split(':');
 if(!/^[0-9a-f]{32}$/.test(salt||'')||!/^[0-9a-f]{128}$/.test(key||''))return false;
 return timingSafeEqual(await derive(password,salt,64,options),Buffer.from(key,'hex'));
}
