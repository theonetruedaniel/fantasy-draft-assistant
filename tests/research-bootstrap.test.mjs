import test from 'node:test';import assert from 'node:assert/strict';
const base=`chrome-extension://${'a'.repeat(32)}/`;
let moduleId=0;
async function boot(local,seed){
 let listener;const session={};const area=data=>({get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(data[k])])),set:async values=>Object.assign(data,structuredClone(values))});
 globalThis.chrome={storage:{local:area(local),session:area(session)},sidePanel:{setPanelBehavior:async()=>{}},runtime:{getURL:p=>base+p,sendMessage:async()=>{},onMessage:{addListener:fn=>listener=fn}}};
 globalThis.fetch=async url=>{assert.equal(url,base+'private/research.json');return{ok:true,text:async()=>JSON.stringify(seed)}};
 await import(`../extension/background.js?bootstrap-test=${moduleId++}`);
 return message=>new Promise(resolve=>listener(message,{url:base+'panel.html'},resolve));
}
const seed={seedId:'synthetic-seed',source:'Synthetic research',sourceDate:'2026-09-06',narrative:'Full original guide text',players:[{name:'Synthetic player',position:'WR',rank:3}]};
test('local seed persists complete research once and respects clear plus existing custom settings',async()=>{
 const originalFetch=globalThis.fetch;
 try{
  const local={settings:{saved:{profile:{custom:true}}}};let send=await boot(local,seed);
  assert.equal((await send({type:'GET_STATE'})).researchCount,1);assert.equal(local.researchContext.narrative,seed.narrative);
  assert.deepEqual(local.settings,{saved:{profile:{custom:true}}});assert.equal(local.researchSeedId,seed.seedId);
  const persisted=structuredClone(local.research);send=await boot(local,seed);assert.equal((await send({type:'GET_STATE'})).researchCount,1);assert.deepEqual(local.research,persisted);
  await send({type:'CLEAR_RESEARCH'});send=await boot(local,seed);assert.equal((await send({type:'GET_STATE'})).researchCount,0);
  const custom={research:[{name:'Existing custom research'}]};send=await boot(custom,seed);
  await send({type:'GET_STATE'});assert.equal(custom.research[0].name,'Existing custom research');assert.equal(custom.researchSeedId,undefined);
 }finally{globalThis.fetch=originalFetch;}
});
