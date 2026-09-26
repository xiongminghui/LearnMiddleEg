import {validWordId} from './catalog.js';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId=value=>typeof value==='string'&&ID.test(value);
export function validEvent(e) {
  if(!e||typeof e!=='object'||!validId(e.id)||!validId(e.sessionId)||!Number.isFinite(e.occurredAt)||e.occurredAt<0||e.occurredAt>8640000000000000||!Number.isInteger(e.latencyMs)||e.latencyMs<0||e.latencyMs>3600000||typeof e.assisted!=='boolean')return false;
  if(e.eventType==='completed')return e.wordId===null&&e.exerciseType===null&&e.result===null;
  if(!validWordId(e.wordId))return false;
  if(e.eventType==='introduced')return e.exerciseType==='intro'&&e.result==='seen';
  return e.eventType==='answered'&&['recognize','spell','listen','cloze'].includes(e.exerciseType)&&['correct','incorrect','assisted','skipped'].includes(e.result);
}
