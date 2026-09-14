import test from 'node:test';import assert from 'node:assert/strict';
const id='a'.repeat(32),base=`chrome-extension://${id}/`;let listener;
const local={},session={};
const area=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),set:async values=>Object.assign(data,structuredClone(values))});
globalThis.chrome={storage:{local:area(local),session:area(session)},sidePanel:{setPanelBehavior:async()=>{}},
 runtime:{getURL:path=>base+path,sendMessage:async()=>{},onMessage:{addListener:fn=>{listener=fn;}}}};
const originalFetch=globalThis.fetch;
const helperResponse=async options=>{const c=JSON.parse(options.body);return {ok:true,json:async()=>({provider:c.provider,model:c.model,helperReady:true,codexSignedIn:true,modelAvailable:true})};};
globalThis.fetch=(url,options)=>String(url).endsWith('/status')?helperResponse(options):originalFetch(url,options);
await import('../extension/background.js');
const panel={url:base+'panel.html'};
const send=(message,sender=panel)=>new Promise(resolve=>listener(message,sender,resolve));
const snapshot=()=>({site:'yahoo',draftId:'synthetic',readAt:Date.now(),currentOverall:1,currentTeamId:'1',ownTeamId:'2',
 observedTeams:2,observedSlot:2,players:[{key:'yahoo:a',name:'Synthetic A',positions:['WR'],team:'BUF',rank:1}],
 availableKeys:['yahoo:a'],picks:[],rosters:{'2':[]},coverage:'visible-only',filters:[],errors:[]});

test('real background handlers accept only draft readers and keep local advice available',async()=>{
 const refused=await send({type:'DRAFT_SNAPSHOT',snapshot:snapshot()},{url:'https://unrelated.test/',tab:{id:1}});
 assert.equal(refused.ok,false);
 const accepted=await send({type:'DRAFT_SNAPSHOT',snapshot:snapshot()},{url:'https://football.fantasysports.yahoo.com/draftclient/f1/1/2',tab:{id:1}});
 assert.equal(accepted.ok,true);
 const result=await send({type:'GET_STATE'});
 assert.equal(result.entries[1].advice.choices[0].playerKey,'yahoo:a');
 assert.equal(result.entries[1].profile.teams,2);
 assert.equal(result.entries[1].profile.confirmed,false);
 assert.equal(result.entries[1].ai.status,'disconnected');
 assert.equal((await send({type:'GET_STATE'},{url:'https://unrelated.test/'})).ok,false);
});
test('disabling AI preserves local mode when the cancelled request settles late',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>String(url).endsWith('/status')?helperResponse(options):new Promise(()=>{});
 try{
   await send({type:'SAVE_AI',enabled:true,model:'explicit-test-model',token:'synthetic-local-token'});
   assert.equal((await send({type:'GET_STATE'})).entries[1].ai.status,'pending');
   await send({type:'SAVE_AI',enabled:false});
   await new Promise(resolve=>setTimeout(resolve,10));
   const result=await send({type:'GET_STATE'});
   assert.equal(result.entries[1].ai.status,'disconnected');
   assert.equal(result.entries[1].advice.choices[0].playerKey,'yahoo:a');
 }finally{globalThis.fetch=oldFetch;}
});

test('draft completion preserves observed slot and has a terminal state instead of a read error',async()=>{
 await send({type:'DRAFT_SNAPSHOT',snapshot:{...snapshot(),status:'complete',currentOverall:null,observedTeams:0,observedSlot:null}},{url:'https://football.fantasysports.yahoo.com/draftclient/f1/1/2',tab:{id:1}});
 const entry=(await send({type:'GET_STATE'})).entries[1];assert.equal(entry.profile.slot,2);assert.equal(entry.profile.teams,2);
 assert.equal(entry.state.status,'complete');assert.equal(entry.advice.choices.length,0);assert.deepEqual(entry.state.errors,[]);
});

test('AI session token is reusable without exposing it, and disabling preserves connection settings',async()=>{
 const first=await send({type:'SAVE_AI',enabled:true,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',token:'synthetic-session-token'});assert.equal(first.ok,true);
 const again=await send({type:'SAVE_AI',enabled:true,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',token:''});assert.equal(again.ok,true);
 const visible=(await send({type:'GET_STATE'})).aiConfig;assert.equal(visible.hasToken,true);assert.equal('token' in visible,false);
 await send({type:'SAVE_AI',enabled:false});const disabled=(await send({type:'GET_STATE'})).aiConfig;assert.equal(disabled.enabled,false);assert.equal(disabled.model,'gpt-5.3-codex-spark');assert.equal(disabled.provider,'codex');assert.equal(disabled.hasToken,true);
});
test('nonsecret AI choices survive a browser session reset without persisting the token',async()=>{
 assert.equal(local.aiPreferences.model,'gpt-5.3-codex-spark');assert.equal('token' in local.aiPreferences,false);
 delete session.aiConfig;await import('../extension/background.js?session-reset');
 const visible=(await send({type:'GET_STATE'})).aiConfig;assert.equal(visible.provider,'codex');assert.equal(visible.model,'gpt-5.3-codex-spark');assert.equal(visible.enabled,false);assert.equal(visible.hasToken,false);
});

test('failed helper authentication cannot produce an enabled receipt or discard existing settings',async()=>{
 const before=(await send({type:'GET_STATE'})).aiConfig,oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:false,status:403});
 try{const result=await send({type:'SAVE_AI',enabled:true,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',token:'synthetic-rejected-token'});assert.equal(result.ok,false);assert.match(result.error,/token was rejected/);assert.deepEqual((await send({type:'GET_STATE'})).aiConfig,before);}finally{globalThis.fetch=oldFetch;}
});
