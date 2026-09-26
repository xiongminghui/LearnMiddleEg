import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {cloneState,hasOwn} from '../public/lib/compat.js';

const source=(await readFile(new URL('../public/lib/compat.js',import.meta.url),'utf8')).replace(/^export /gm,'');
test('older crypto APIs produce valid unique UUID v4 identifiers for learning events',()=>{
 const context=vm.createContext({crypto:{getRandomValues:crypto.getRandomValues.bind(crypto)}});
 vm.runInContext(source,context);
 const ids=vm.runInContext('Array.from({length:100},()=>uuid())',context);
 assert.equal(new Set(ids).size,100);
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('JSON progress copies preserve nested values and do not alias the original state',()=>{
 const original={progress:{explore:{stage:1,skills:{listen:0}}},session:null,history:[]};
 const copy=cloneState(original);assert.deepEqual(copy,original);copy.progress.explore.skills.listen++;
 assert.equal(original.progress.explore.skills.listen,0);assert.equal(cloneState(undefined),undefined);
 assert.equal(hasOwn({intro:[]},'intro'),true);assert.equal(hasOwn({},'toString'),false);
});
