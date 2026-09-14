import { defaultProfile } from './core/contracts.js';
import { freshness } from './core/state.js';
import {parseConnectionFile} from './core/ai.js';
import {cardSummary} from './core/card-summary.js';
const $=id=>document.getElementById(id);
let data={entries:{}},selected='',formDraft='',preview=null,aiFormDirty=false,aiFormKey=null;
const api=async message=>{const result=await chrome.runtime.sendMessage(message);if(result?.ok===false)throw Error(result.error);return result;};
function fillForm(profile) {
  $('teams').value=profile.teams;$('slot').value=profile.slot;$('bench').value=profile.bench;
  $('slots').value=profile.starterSlots.map(s=>s.join('/')).join(',');
  $('scoring').value=JSON.stringify(profile.pointsPer,null,2);$('unsupported').value=(profile.unsupportedRules||[]).join('\n');$('confirmed').checked=!!profile.confirmed;
}
function render() {
  if(data.aiConfig){
    const config=data.aiConfig,key=JSON.stringify([config.provider,config.model,config.effort,config.enabled,config.hasToken]);
    if(!aiFormDirty&&key!==aiFormKey){$('ai-provider').value=config.provider||'codex';$('ai-model').value=config.model||'';$('ai-effort').value=config.effort??'low';aiFormKey=key;}
    $('ai-session-state').textContent=config.enabled?`Configured: ${config.provider==='codex'?'Local Codex':'OpenAI API'} · ${config.model} · ${config.effort||'default effort'}. Session token is saved; leave its field blank to reuse it.`:config.hasToken?'Research only. Connection choices and session token are saved; enable when ready.':'Research only. Connection choices are saved; enter the local connection token to enable for this browser session.';
    $('ai-token').placeholder=config.hasToken?'Saved for this session; leave blank to reuse':'Enter the local connection token';
  }
  const loaded=data.researchCount||0,stats=data.researchActualStats;
  $('research-loaded').textContent=loaded?`${loaded} research entries loaded · ${data.researchSummary?.source||'see imported sources'} · ${data.researchSummary?.date||'date not supplied'}${stats?.count?` · Actual season stats: ${stats.count} players (${stats.seasons.join(', ')})`:''}. Saved on this computer.`:'No research entries loaded. Choose a file below to import.';
  const entries=Object.entries(data.entries).sort((a,b)=>b[1].state.readAt-a[1].state.readAt);
  if(!entries.some(([id])=>id===selected))selected=entries[0]?.[0]||'';
  const old=$('draft').value;$('draft').replaceChildren();
  for(const [id,e] of entries) {const option=document.createElement('option');option.value=id;option.textContent=`${e.state.site.toUpperCase()} Â· ${e.state.draftId}`;$('draft').append(option);}
  if(!entries.length){const option=document.createElement('option');option.textContent='Waiting for a draft room';$('draft').append(option);}
  $('draft').value=selected;
  const entry=data.entries[selected];if(!entry){$('source-status').textContent=data.researchCount?`${data.researchCount} research entries loaded Â· ${data.researchSummary?.date||'see import source'}`:'Site fallback â€” research not loaded';return;}
  const {state,profile}=entry,live=freshness(state,Date.now());
  const advice=entry.refinedAdvice&&Date.now()-entry.refinedAdvice.computedAt<25000?entry.refinedAdvice:entry.advice;
  $('connection').textContent=state.status==='complete'?'Draft complete':live.usable?`${state.site.toUpperCase()} Â· page read ${((Date.now()-state.readAt)/1000).toFixed(1)}s ago`:`Paused Â· ${live.reason}`;
  $('mode').textContent=entry.ai?.message||'Local engine Â· AI disconnected';
  $('turn').textContent=state.status==='complete'?'Draft complete':advice.picksUntilTurn===0?'Your turn':advice.picksUntilTurn!=null?`${advice.picksUntilTurn} picks until your turn Â· overall ${advice.nextPicks?.[0]}`:'Turn unknown';
  $('profile-summary').textContent=`${profile.teams} teams Â· slot ${profile.slot} Â· ${profile.pointsPer.receptions??'?'} reception points Â· ${profile.confirmed?'confirmed':'assumed'} settings`;
  $('source-status').textContent=state.status==='complete'?`${data.researchCount||0} research entries loaded`:advice.sourceStatus||'Site fallback â€” research not loaded';
  $('warning').textContent=state.status==='complete'?'':[...new Set([...(live.usable?[]:[live.reason]),...(advice.warnings||[])])].join('\n');
  $('choices').replaceChildren();
  const choices=live.usable?advice.choices:[];
  for(const choice of choices) {const li=document.createElement('li'),body=document.createElement('div'),name=document.createElement('strong'),why=document.createElement('p'),source=document.createElement('small');
    const card=cardSummary(choice,advice.teamNeeds);
    name.textContent=`${choice.name} Â· ${choice.positions.join('/')} ${choice.team||''}`;why.textContent=card.explanation;source.textContent=`${choice.basis} Â· ${choice.nextTurnRisk}`;body.append(name);
    if(card.actualStats){const stats=document.createElement('p');stats.className='actual-stats';stats.textContent=card.actualStats;body.append(stats);}
    body.append(why,source);
    if(choice.evidence||choice.notes?.length||choice.projectionPoints!=null){const details=document.createElement('details'),summary=document.createElement('summary'),evidence=document.createElement('p');summary.textContent='Research and numbers';
      evidence.style.whiteSpace='pre-wrap';evidence.textContent=[choice.reason,choice.actualStats?`Actual statistics: ${choice.actualStats.source} · ${choice.actualStats.sourceUrl} · ${choice.actualStats.license}`:'',choice.priceLabel?`Research price: ${choice.priceLabel}`:'',choice.projectionPoints!=null?`Research projection components (estimate, not actual results) at current scoring: ${choice.projectionPoints.toFixed(1)} points`:'',choice.projectionScope,choice.uncertainty,choice.evidence,...(choice.notes||[]),choice.historicalDiagnostic?`Historical TD sensitivity, not a forecast: ${JSON.stringify(choice.historicalDiagnostic)}`:''].filter(Boolean).join('\n\n');details.append(summary,evidence);body.append(details);}
    li.append(body);$('choices').append(li);}
  if(!choices.length){const p=document.createElement('p');p.textContent=state.status==='complete'?'No more draft recommendations.':live.usable?'No safe ranked choices yet. Check settings, availability and research.':'Recommendations suspended until a fresh valid read.';$('choices').append(p);}
  const names=new Map(state.players.map(p=>[p.key,p.name]));
  $('pair').textContent=live.usable&&advice.pair?`Consecutive picks: ${advice.pair.map(k=>names.get(k)||k).join(' + ')}`:'';
  $('needs').textContent=state.status==='complete'?'Draft finished. Review your final roster on the draft site.':advice.teamNeeds?.summary||'Own roster unknown. Confirm My team ID if needed.';
  $('priorities').textContent=advice.teamNeeds?.priorities?.length?`Next-position priorities: ${advice.teamNeeds.priorities.join(', ')}`:'';
  $('diagnostics').textContent=`Coverage: ${state.coverage}\nHistory: ${state.historyComplete?'complete through current pick':'incomplete'}\nObserved picks: ${state.picks.length}\nVisible available: ${state.availableKeys.length}\nResearch: ${data.researchCount||0} imported players\nOwn team ID: ${state.ownTeamId||'unknown'}\nReader: ${(state.timing?.scanMs||0).toFixed(1)} ms; local processing: ${entry.computeMs.toFixed(1)} ms\nBoard revision: ${state.boardRevision}\nFilters: ${state.filters.join('; ')}`;
  if(formDraft!==state.draftId){formDraft=state.draftId;fillForm(profile);$('own-team').value='';}
}
async function refresh(){try{data=await api({type:'GET_STATE'});render();}catch(e){$('connection').textContent=e.message;}}
$('draft').addEventListener('change',()=>{selected=$('draft').value;formDraft='';render();});
$('use-preset').addEventListener('click',()=>fillForm(defaultProfile($('preset').value)));
$('profile-form').addEventListener('submit',async e=>{e.preventDefault();try{
  const profile={teams:Number($('teams').value),slot:Number($('slot').value),bench:Number($('bench').value),
    starterSlots:$('slots').value.split(',').map(s=>s.trim().toUpperCase().split('/')),pointsPer:JSON.parse($('scoring').value),
    unsupportedRules:$('unsupported').value.split('\n').map(s=>s.trim()).filter(Boolean),confirmed:$('confirmed').checked,revision:Date.now()};
  await api({type:'SAVE_PROFILE',tabId:selected,profile,ownTeamId:$('own-team').value.trim()});$('settings-result').textContent='Saved for this draft.';await refresh();
}catch(error){$('settings-result').textContent=error.message;}});
$('preview-import').addEventListener('click',async()=>{try{
  const file=$('research-file').files[0];if(!file)throw Error('Choose a CSV or JSON file');
  if(file.size>5_000_000)throw Error('File must be under 5 MB');
  preview={text:await file.text(),format:file.name.toLowerCase().endsWith('.json')?'json':'csv',metadata:{source:$('research-source').value.trim(),sourceDate:$('research-date').value}};
  const result=await api({type:'IMPORT_RESEARCH',...preview});$('import-result').textContent=`${result.players.length} valid players. ${result.errors.join(' ')||'Ready to apply.'}`;$('apply-import').disabled=!!result.errors.length||!result.players.length;
}catch(error){$('import-result').textContent=error.message;$('apply-import').disabled=true;}});
$('apply-import').addEventListener('click',async()=>{try{const result=await api({type:'IMPORT_RESEARCH',...preview,apply:true});$('import-result').textContent=`Imported ${result.count} players.`;$('apply-import').disabled=true;await refresh();}catch(e){$('import-result').textContent=e.message;}});
$('clear-import').addEventListener('click',async()=>{await api({type:'CLEAR_RESEARCH'});$('import-result').textContent='Imported research cleared.';await refresh();});
chrome.runtime.onMessage.addListener(message=>{if(message.type==='UPDATED')refresh();});
let aiSaving=false;
async function saveAi(enabled,imported=null){
 if(aiSaving)return;aiSaving=true;
 for(const id of ['enable-ai','disable-ai','import-ai-config'])$(id).disabled=true;
 $('ai-result').textContent=enabled?'Checking the local helper and selected connection…':'Saving research-only mode…';
 try{await api({type:'SAVE_AI',enabled,...(imported||{provider:$('ai-provider').value,model:$('ai-model').value,effort:$('ai-effort').value,token:$('ai-token').value})});
 $('ai-token').value='';$('ai-config-file').value='';aiFormDirty=false;aiFormKey=null;
 $('ai-result').textContent=enabled?'Connection checked and settings saved. Refinement is enabled; a live AI result will be labeled after a usable draft request.':'Research-only mode; connection settings retained.';await refresh();
 }catch(e){$('ai-result').textContent=e.message;}finally{aiSaving=false;for(const id of ['enable-ai','disable-ai','import-ai-config'])$(id).disabled=false;}
}
$('import-ai-config').addEventListener('click',async()=>{
 try{const file=$('ai-config-file').files[0];if(!file)throw Error('Choose the private connection JSON file');if(file.size>8192)throw Error('Connection file must be under 8 KB');const config=parseConnectionFile(await file.text(),chrome.runtime.id);await saveAi(true,config);}catch(e){$('ai-result').textContent=e.message;}
});
for(const id of ['ai-provider','ai-model','ai-effort','ai-token'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{aiFormDirty=true;});
$('enable-ai').addEventListener('click',()=>saveAi(true));$('disable-ai').addEventListener('click',()=>saveAi(false));
setInterval(render,1000);refresh();
