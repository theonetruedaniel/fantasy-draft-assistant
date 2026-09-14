import test from 'node:test';import assert from 'node:assert/strict';
import { validateRefinement, requestRefinement } from '../extension/core/ai.js';
const local={contextKey:'r2',computedAt:1000,choices:[{playerKey:'a',name:'A'},{playerKey:'b',name:'B'}],warnings:[]};
const state={contextKey:'r2',readAt:1000,coverage:'visible-only',errors:[],availableKeys:['a','b'],picks:[],rosters:{}};
test('AI cannot reorder another revision or revive drafted/unlisted/duplicate choices',()=>{
 for(const raw of [
   {contextKey:'r1',choices:[{playerKey:'a',reason:'x'},{playerKey:'b',reason:'y'}]},
   {contextKey:'r2',choices:[{playerKey:'missing',reason:'x'},{playerKey:'b',reason:'y'}]},
   {contextKey:'r2',choices:[{playerKey:'a',reason:'x'},{playerKey:'a',reason:'y'}]},
 ])assert.equal(validateRefinement(raw,state,local,1100),null);
 const valid={contextKey:'r2',choices:[{playerKey:'b',reason:'Prefer available B'},{playerKey:'a',reason:'Alternative A'}]};
 assert.equal(validateRefinement(valid,{...state,picks:[{playerKey:'b'}]},local,1100),null);
 assert.equal(validateRefinement(valid,state,local,27000),null);
 assert.deepEqual(validateRefinement(valid,state,local,1100).choices.map(p=>p.playerKey),['b','a']);
});
test('AI network timeout is bounded even when external transport ignores abort',async()=>{
 const started=performance.now();
 await assert.rejects(requestRefinement({}, {model:'explicit-test',token:'test'},new AbortController().signal,()=>new Promise(()=>{}),30),/deadline/i);
 assert.ok(performance.now()-started<500);
});
test('AI reports provider/model mismatch without silently switching models',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>({model:'different-model',result:{}})});
 await assert.rejects(requestRefinement({}, {model:'explicit-test',token:'test'},new AbortController().signal,fetcher),/model/i);
});
