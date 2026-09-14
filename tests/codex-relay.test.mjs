import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createRelay} from '../relay/server.mjs';
import {validateRefinement,compactCodexContext,waitForStableContext,parseConnectionFile,checkLocalConnection} from '../extension/core/ai.js';
const context={contextKey:'sample',choices:[{playerKey:'a',name:'A',rationale:'Supplied evidence',reason:'Original reason',byeWeek:7}],roster:[],warnings:[],teamNeeds:{byeCoverage:{unknown:0}},profile:{},research:{source:'test'}};
test('unverifiable model prose never enters displayed advice',()=>{const local={...context,computedAt:1000};const state={contextKey:'sample',readAt:1000,coverage:'visible-only',errors:[],availableKeys:['a'],picks:[],rosters:{}};const result=validateRefinement({contextKey:'sample',choices:[{playerKey:'a',reason:'INVENTED INJURY'}]},state,local,1100);assert.equal(result.choices[0].reason,'Original reason');assert.equal(JSON.stringify(result).includes('INVENTED'),false);});
test('compact context retains source rationale, roster and bye needs; superseded debounce does no work',async()=>{const c=compactCodexContext(context);assert.equal(c.choices[0].rationale,'Supplied evidence');assert.equal(c.choices[0].byeWeek,7);assert.deepEqual(c.teamNeeds,context.teamNeeds);const controller=new AbortController();const pending=waitForStableContext(controller.signal,50);controller.abort();await assert.rejects(pending,/superseded/);});
test('authenticated relay routes exact Codex model, caches repeated context, and refuses other origins/tokens',async()=>{
 let calls=0;const codexClient={refine:async r=>{calls++;assert.equal(r.model,'explicit');assert.equal(r.effort,'low');return {model:r.model,result:{contextKey:'sample',choices:[{playerKey:'a',reason:'Supplied evidence'}]}};},close(){}};
 const token='synthetic-token-123456',origin='chrome-extension://'+'a'.repeat(32),server=createRelay({token,extensionId:'a'.repeat(32),codexClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(changes={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/refine',method:'POST',headers:{Host:'127.0.0.1:8765',Origin:origin,Authorization:`Bearer ${token}`,...changes}},res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}));});req.on('error',reject);req.end(JSON.stringify({provider:'codex',model:'explicit',effort:'low',context}));});
 try{assert.equal((await request({Origin:'https://unrelated.test'})).status,403);assert.equal((await request({Authorization:'Bearer wrong'})).status,403);assert.equal((await request()).status,200);assert.equal((await request()).status,200);assert.equal(calls,1);}finally{await new Promise(r=>server.close(r));}
});

test('connection files are extension-scoped and invalid files never echo token contents',()=>{
 const c={extensionId:'a'.repeat(32),provider:'codex',model:'explicit',effort:'low',token:'synthetic-private-token'};
 assert.equal(parseConnectionFile(JSON.stringify(c),c.extensionId).model,'explicit');
 assert.throws(()=>parseConnectionFile(JSON.stringify(c),'b'.repeat(32)),/different extension/);
 assert.throws(()=>parseConnectionFile('bad-json',c.extensionId),/not valid JSON/);
});
test('helper check distinguishes authenticated configuration from inference and bounds unreachable transports',async()=>{
 const c={provider:'codex',model:'explicit',effort:'low',token:'synthetic-private-token'};
 await assert.rejects(checkLocalConnection(c,async()=>({ok:false,status:403})),/token was rejected/);
 await assert.rejects(checkLocalConnection(c,async()=>({ok:true,json:async()=>({provider:'codex',model:'explicit',helperReady:true,codexSignedIn:false})})),/did not verify/);
 await assert.rejects(checkLocalConnection(c,()=>new Promise(()=>{}),20),/timed out/);
});
test('real status endpoint verifies account and selected model without making an inference request',async()=>{
 let inferenceCalls=0;const codexClient={start:async()=>{},rpc:async method=>{assert.equal(method,'account/read');return {account:{type:'chatgpt',email:'never-expose@example.test'}};},models:[{model:'explicit',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],refine:async()=>inferenceCalls++,close(){}};
 const token='synthetic-token-123456',extensionId='a'.repeat(32),server=createRelay({token,extensionId,codexClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/status',method:'POST',headers:{Host:'127.0.0.1:8765',Origin:`chrome-extension://${extensionId}`,Authorization:`Bearer ${token}`}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(JSON.stringify({provider:'codex',model:'explicit',effort:'low'}));});assert.equal(response.status,200);const text=response.text;assert.equal(text.includes('never-expose'),false);const result=JSON.parse(text);assert.equal(result.codexSignedIn,true);assert.equal(result.inferenceVerified,false);assert.equal(inferenceCalls,0);}finally{await new Promise(r=>server.close(r));}
});
