import { freshness } from './state.js';
export function validateRefinement(raw,state,localAdvice,now=Date.now()) {
  if(!raw||raw.contextKey!==state.contextKey||localAdvice.contextKey!==state.contextKey||!freshness(state,now).usable||now-localAdvice.computedAt>=25000)return null;
  if(!Array.isArray(raw.choices)||raw.choices.length!==localAdvice.choices.length)return null;
  const allowed=new Map(localAdvice.choices.map(p=>[p.playerKey,p])),available=new Set(state.availableKeys);
  const taken=new Set([...(state.picks||[]).map(p=>p.playerKey),...Object.values(state.rosters||{}).flat()]);
  const keys=raw.choices.map(p=>p?.playerKey);
  if(new Set(keys).size!==keys.length||raw.choices.some(p=>!allowed.has(p.playerKey)||!available.has(p.playerKey)||taken.has(p.playerKey)||typeof p.reason!=='string'||p.reason.length<1||p.reason.length>400))return null;
  return {...localAdvice,choices:raw.choices.map(p=>({...allowed.get(p.playerKey),reason:allowed.get(p.playerKey).reason,localReason:allowed.get(p.playerKey).reason,aiReordered:true})),refinedAt:now};
}
export async function requestRefinement(context,config,signal,fetcher=fetch,timeoutMs=24000) {
  if(!config.model||!config.token)throw Error('Choose an explicit model and relay token');
  if(signal?.aborted)throw Error('AI request superseded');
  const controller=new AbortController();let timer,abort;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(Error('AI deadline exceeded; local advice retained'));},Math.min(24000,timeoutMs));
    abort=()=>{controller.abort();reject(Error('AI request superseded'));};signal?.addEventListener('abort',abort,{once:true});
  });
  const network=(async()=>{
    const response=await fetcher('http://127.0.0.1:8765/refine',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${config.token}`},body:JSON.stringify({provider:config.provider||'api',model:config.model,effort:config.effort||null,context}),signal:controller.signal});
    if(!response.ok)throw Error(`AI relay error ${response.status}; local advice retained`);
    const body=await response.json();
    if(body.model!==config.model)throw Error('Returned model differs from explicit selection');
    return body.result;
  })();
  try{return await Promise.race([network,deadline]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function compactCodexContext(context){
 return {...context,choices:context.choices.map(p=>({playerKey:p.playerKey,name:p.name,positions:p.positions,researchRank:p.researchRank,rationale:p.rationale?.slice(0,400),uncertainty:p.uncertainty?.slice(0,200),priceLabel:p.priceLabel,byeWeek:p.byeWeek,byeFit:p.byeFit,injury:p.injury})),research:{source:context.research?.source,sourceDate:context.research?.sourceDate},roster:context.roster.map(p=>({name:p.name,positions:p.positions,byeWeek:p.byeWeek??null})),warnings:context.warnings.slice(0,5)};
}
export function waitForStableContext(signal,ms=600){return new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('AI request superseded'));const abort=()=>{clearTimeout(timer);reject(Error('AI request superseded'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}

export function parseConnectionFile(text,extensionId){
 if(typeof text!=='string'||text.length>8192)throw Error('Connection file must be under 8 KB');
 let config;try{config=JSON.parse(text);}catch{throw Error('Connection file is not valid JSON');}
 if(!config||Array.isArray(config)||config.extensionId!==extensionId)throw Error('Connection file belongs to a different extension');
 if(!['codex','api'].includes(config.provider)||typeof config.model!=='string'||!config.model.trim()||config.model.length>150||typeof config.token!=='string'||config.token.trim().length<16||config.token.length>1024)throw Error('Connection file has invalid settings');
 if(config.provider==='codex'&&!['low','medium'].includes(config.effort))throw Error('Choose low or medium Codex effort');
 return {provider:config.provider,model:config.model.trim(),effort:config.effort||'',token:config.token.trim()};
}
export async function checkLocalConnection(config,fetcher=fetch,timeoutMs=12000){
 const controller=new AbortController();let timer;
 try{return await Promise.race([(async()=>{const r=await fetcher('http://127.0.0.1:8765/status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},body:JSON.stringify({provider:config.provider,model:config.model,effort:config.effort}),signal:controller.signal});
 if(!r.ok)throw Error(r.status===403?'Local connection token was rejected':r.status===404?'Restart the updated local helper before enabling':`Local connection check failed (${r.status})`);
 const result=await r.json();if(result.provider!==config.provider||result.model!==config.model||!result.helperReady||(config.provider==='codex'&&(!result.codexSignedIn||!result.modelAvailable)))throw Error('Local helper did not verify the selected connection');return result;})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Local helper check timed out; research remains available'));},timeoutMs);})]);}catch(e){if(e instanceof TypeError)throw Error('Local helper is not reachable; start or restart it and try again');throw e;}finally{clearTimeout(timer);}
}
