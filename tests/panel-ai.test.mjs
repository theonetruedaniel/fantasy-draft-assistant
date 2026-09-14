import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
test('an open pristine panel follows saved settings from another panel, while edits are preserved',async()=>{
 const dom=new JSDOM(await readFile('extension/panel.html','utf8'));globalThis.document=dom.window.document;
 let update;let config={enabled:false,provider:'api',model:'',effort:'',hasToken:false};
 globalThis.chrome={runtime:{sendMessage:async()=>({entries:{},aiConfig:config,researchCount:209,researchSummary:{source:'Original research',date:'2026-09-06'},researchActualStats:{count:165,seasons:[2025]}}),onMessage:{addListener:f=>update=f}}};
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{await import('../extension/panel.js?rehydration-test');await new Promise(r=>setImmediate(r));
 config={enabled:true,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',hasToken:true};update({type:'UPDATED'});await new Promise(r=>setImmediate(r));
 assert.equal(document.getElementById('ai-provider').value,'codex');assert.equal(document.getElementById('ai-model').value,config.model);assert.equal(document.getElementById('ai-token').value,'');assert.match(document.getElementById('research-loaded').textContent,/209 research entries loaded.*Original research.*2026-09-06.*165.*2025/);assert.equal(document.getElementById('research-file').value,'');
 const field=document.getElementById('ai-model');field.value='unsaved-choice';field.dispatchEvent(new dom.window.Event('input'));config={...config,model:'saved-elsewhere'};update({type:'UPDATED'});await new Promise(r=>setImmediate(r));assert.equal(field.value,'unsaved-choice');
 }finally{globalThis.setInterval=interval;dom.window.close();}
});

test('typed password survives timer and state refreshes while Enable is pending',async()=>{
 const dom=new JSDOM(await readFile('extension/panel.html','utf8'));globalThis.document=dom.window.document;
 let update,tick,release,submitted;let config={enabled:false,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',hasToken:false};
 globalThis.chrome={runtime:{sendMessage:async m=>{if(m.type==='SAVE_AI'){submitted=m;await new Promise(r=>release=r);config={...config,enabled:true,hasToken:true};return {ok:true};}return {entries:{},aiConfig:structuredClone(config)};},onMessage:{addListener:f=>update=f}}};
 const interval=globalThis.setInterval;globalThis.setInterval=f=>(tick=f,0);
 const settle=()=>new Promise(r=>setImmediate(r));
 try{await import('../extension/panel.js?password-interleaving');await settle();const field=document.getElementById('ai-token');field.value='synthetic-private-test-token';field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 tick();update({type:'UPDATED'});await settle();assert.equal(field.value,'synthetic-private-test-token');document.getElementById('enable-ai').click();await settle();assert.equal(submitted.token,'synthetic-private-test-token');tick();update({type:'UPDATED'});await settle();assert.equal(field.value,'synthetic-private-test-token');
 release();await settle();await settle();assert.equal(field.value,'');assert.match(document.getElementById('ai-result').textContent,/saved|enabled/i);assert.match(document.getElementById('ai-session-state').textContent,/Spark|spark/);
 }finally{globalThis.setInterval=interval;dom.window.close();}
});

test('private connection import enables directly without placing its token in any form field',async()=>{
 const dom=new JSDOM(await readFile('extension/panel.html','utf8'));globalThis.document=dom.window.document;
 const extensionId='a'.repeat(32);let submitted;let config={enabled:false,provider:'codex',model:'',effort:'low',hasToken:false};
 globalThis.chrome={runtime:{id:extensionId,sendMessage:async m=>{if(m.type==='SAVE_AI'){submitted=m;config={enabled:true,provider:m.provider,model:m.model,effort:m.effort,hasToken:true};return {ok:true};}return {entries:{},aiConfig:config};},onMessage:{addListener(){}}}};
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{await import('../extension/panel.js?file-import');await new Promise(r=>setImmediate(r));const input=document.getElementById('ai-config-file');assert.ok(input,'Private connection import is present');
 const file={size:300,text:async()=>JSON.stringify({extensionId,provider:'codex',model:'gpt-5.3-codex-spark',effort:'low',token:'synthetic-file-token'})};Object.defineProperty(input,'files',{value:[file],configurable:true});document.getElementById('import-ai-config').click();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(submitted.token,'synthetic-file-token');assert.equal(submitted.enabled,true);assert.equal(document.getElementById('ai-token').value,'');assert.equal(document.body.textContent.includes('synthetic-file-token'),false);assert.match(document.getElementById('ai-result').textContent,/saved|enabled/i);
 }finally{globalThis.setInterval=interval;dom.window.close();}
});
