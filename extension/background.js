import { defaultProfile,validateProfile } from './core/contracts.js';
import { reconcile } from './core/state.js';
import { recommend } from './core/recommend.js';
import { parseResearch } from './core/import.js';
import { requestRefinement,validateRefinement,compactCodexContext,waitForStableContext,checkLocalConnection } from './core/ai.js';
import {researchForAi,boundedAiChoices} from './core/research-context.js';

let entries={},settings={},research=[],researchContext=null,importRevision=0,aiConfig={enabled:false};
const pendingAi=new Map();
const ready=Promise.all([chrome.storage.local.get(['settings','research','researchContext','researchSeedId','importRevision','aiPreferences']),chrome.storage.session.get(['entries','aiConfig'])]).then(async([local,session])=>{
  settings=local.settings||{};research=local.research||[];importRevision=local.importRevision||0;entries=session.entries||{};aiConfig=session.aiConfig||{...local.aiPreferences,enabled:false};
  researchContext=local.researchContext||null;
  // Optional user-local bootstrap. Public distributions do not contain this file.
  // A seed is applied once; clearing or manually changing research is respected.
  try{
    const response=await fetch(chrome.runtime.getURL('private/research.json'));
    if(response.ok){const text=await response.text(),seed=JSON.parse(text);
      if(seed.seedId&&seed.seedId!==local.researchSeedId&&!research.length){
        const result=parseResearch(text,'json');
        if(!result.errors.length){research=result.players;researchContext=result.context;importRevision++;
          await chrome.storage.local.set({research,researchContext,importRevision,researchSeedId:seed.seedId});}
      }
    }
  }catch{/* Generic public build or no local seed. Import UI remains available. */}
});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
function draftSettings(snapshot,previous) {
  const saved=settings[snapshot.draftId];
  if(saved)return saved;
  const profile=previous?.state.draftId===snapshot.draftId&&previous?.state.site===snapshot.site?{...previous.profile}:defaultProfile();
  if(snapshot.observedTeams>=2)profile.teams=snapshot.observedTeams;
  if(snapshot.observedSlot>=1&&snapshot.observedSlot<=profile.teams)profile.slot=snapshot.observedSlot;
  return {profile,ownTeamId:null};
}
function updateEntry(tabId,snapshot) {
  const previous=entries[tabId];
  const config=draftSettings(snapshot,previous),profile=config.profile;
  if(config.ownTeamId)snapshot={...snapshot,ownTeamId:config.ownTeamId};
  const started=performance.now();
  const state=reconcile(previous?.state,{...snapshot,tabId},profile,importRevision);
  const advice=recommend(state,research,profile,Date.now());
  const unchanged=previous?.state.contextKey===state.contextKey;
  entries[tabId]={state,advice,profile,computeMs:performance.now()-started,ai:unchanged?previous.ai:{status:'disconnected',message:'Local engine Â· AI disconnected'},refinedAdvice:unchanged?previous.refinedAdvice:null};
  if(!unchanged)pendingAi.get(tabId)?.abort();
  if(aiConfig.enabled&&advice.choices.length&&(!unchanged||!previous?.ai?.requested))startAi(tabId);
  return entries[tabId];
}
function startAi(tabId) {
  const entry=entries[tabId],controller=new AbortController(),contextKey=entry.state.contextKey;
  pendingAi.set(tabId,controller);entry.ai={status:'pending',requested:true,message:`Local engine Â· ${aiConfig.model} refining (24s deadline)`};
  const context={contextKey,choices:boundedAiChoices(entry.advice.choices),research:researchForAi(researchContext,entry.advice.choices),teamNeeds:entry.advice.teamNeeds,profile:entry.profile,
    roster:(entry.state.rosters[entry.state.ownTeamId]||[]).map(k=>entry.state.players.find(p=>p.key===k)).filter(Boolean),warnings:entry.advice.warnings};
  waitForStableContext(controller.signal).then(()=>requestRefinement(aiConfig.provider==='codex'?compactCodexContext(context):context,aiConfig,controller.signal)).then(raw=>{
    const latest=entries[tabId];if(latest?.state.contextKey!==contextKey||pendingAi.get(tabId)!==controller)return;
    const refined=validateRefinement(raw,latest.state,entry.advice,Date.now());
    latest.refinedAdvice=refined;latest.ai={requested:true,status:refined?'connected':'invalid',message:refined?`AI refinement Â· ${aiConfig.model}`:'Invalid or stale AI response Â· local advice retained'};publish();
  }).catch(error=>{
    const latest=entries[tabId];if(latest?.state.contextKey!==contextKey||pendingAi.get(tabId)!==controller)return;
    latest.ai={requested:true,status:'error',message:error.message};publish();
  }).finally(()=>{if(pendingAi.get(tabId)===controller)pendingAi.delete(tabId);});
}
function refreshAll() {for(const [id,e] of Object.entries(entries))updateEntry(Number(id),e.state);}
async function publish() {
  await chrome.storage.session.set({entries});
  chrome.runtime.sendMessage({type:'UPDATED'}).catch(()=>{});
}
function trustedPanel(sender) {return sender.url?.startsWith(chrome.runtime.getURL('panel.html'));}
let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type==='UPDATED')return false;
  queue=queue.then(async()=>{
    await ready;
    if(message.type==='DRAFT_SNAPSHOT') {
      if(!sender.tab?.id||!/^https:\/\/(football\.fantasysports\.yahoo\.com\/draftclient\/|fantasy\.espn\.com\/football\/draft)/.test(sender.url||''))throw Error('Unexpected draft sender');
      const s=message.snapshot;
      if(!s||!Array.isArray(s.players)||s.players.length>5000||!Array.isArray(s.picks)||s.picks.length>2000)throw Error('Invalid draft snapshot');
      updateEntry(sender.tab.id,s);await publish();return {ok:true};
    }
    if(message.type==='READER_ERROR'&&sender.tab?.id) {
      const entry=entries[sender.tab.id];
      if(entry){entry.state.errors=[message.message||'Draft reader error'];entry.state.coverage='unsafe';entry.advice=recommend(entry.state,research,entry.profile);await publish();}
      return {ok:true};
    }
    if(!trustedPanel(sender))throw Error('Open the companion panel');
    if(message.type==='GET_STATE')return {entries,researchCount:research.length,researchActualStats:{count:research.filter(p=>p.actualStats?.seasonType==='REG').length,seasons:[...new Set(research.filter(p=>p.actualStats?.seasonType==='REG').map(p=>p.actualStats.season))]},researchSummary:researchContext?{source:researchContext.source,date:researchContext.sourceDate,coverage:researchContext.coverage,guideCharacters:researchContext.narrative.length}:null,importRevision,aiConfig:{enabled:aiConfig.enabled,provider:aiConfig.provider||'codex',model:aiConfig.model||'',effort:aiConfig.effort??'low',hasToken:!!aiConfig.token}};
    if(message.type==='SAVE_AI') {
      const next=message.enabled?{provider:message.provider||aiConfig.provider||'codex',enabled:true,model:message.model?.trim()||aiConfig.model||'',effort:message.effort??aiConfig.effort??'low',token:message.token?.trim()||aiConfig.token||''}:{...aiConfig,enabled:false};
      if(!['api','codex'].includes(next.provider||'codex'))throw Error('Choose API or Codex');
      if(next.enabled&&!next.model)throw Error('Choose an explicit model');
      if(next.enabled&&next.token.length<16)throw Error('Enter the local connection token for this browser session (16+ characters), not a provider API key');
      if(next.enabled&&next.provider==='codex'&&!['low','medium'].includes(next.effort))throw Error('Choose low or medium Codex effort');
      if(next.enabled)await checkLocalConnection(next);
      for(const controller of pendingAi.values())controller.abort();
      pendingAi.clear();aiConfig=next;
      await chrome.storage.session.set({aiConfig});
      await chrome.storage.local.set({aiPreferences:{provider:aiConfig.provider||'codex',model:aiConfig.model||'',effort:aiConfig.effort??'low'}});
      for(const entry of Object.values(entries)){entry.ai={status:'disconnected',message:'Local engine Â· AI disconnected'};entry.refinedAdvice=null;}
      refreshAll();await publish();return {ok:true};
    }
    if(message.type==='SAVE_PROFILE') {
      const entry=entries[message.tabId];if(!entry)throw Error('Choose a connected draft first');
      const errors=validateProfile(message.profile).errors;if(errors.length)throw Error(errors.join('; '));
      settings[entry.state.draftId]={profile:message.profile,ownTeamId:message.ownTeamId||null};
      await chrome.storage.local.set({settings});updateEntry(Number(message.tabId),entry.state);await publish();return {ok:true};
    }
    if(message.type==='IMPORT_RESEARCH') {
      const result=parseResearch(message.text,message.format,message.metadata);
      if(!message.apply)return {...result,ok:true};
      if(result.errors.length)throw Error('Resolve import errors before applying research');
      research=result.players;researchContext=result.context;importRevision++;
      await chrome.storage.local.set({research,researchContext,importRevision});refreshAll();await publish();return {ok:true,count:research.length};
    }
    if(message.type==='CLEAR_RESEARCH') {
      research=[];researchContext=null;importRevision++;await chrome.storage.local.set({research,researchContext,importRevision});refreshAll();await publish();return {ok:true};
    }
    throw Error('Unknown companion request');
  }).then(result=>respond(result),error=>respond({ok:false,error:error.message}));
  return true;
});
