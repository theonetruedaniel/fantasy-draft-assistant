import baseTest from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{parseResearch,matchResearch}from'../extension/core/import.js';import{scorePlayer}from'../extension/core/scoring.js';import{defaultProfile}from'../extension/core/contracts.js';import{recommend}from'../extension/core/recommend.js';import{researchForAi,boundedAiChoices}from'../extension/core/research-context.js';
const exists=fs.existsSync('outputs/2026-original-research-profile.json');
const test=(name,fn)=>baseTest(name,{skip:!exists},fn);
const raw=exists?JSON.parse(fs.readFileSync('outputs/2026-original-research-profile.json','utf8')):null;
const imported=raw?parseResearch(JSON.stringify(raw),'json'):null;
test('original package preserves all rankings, full guide and limited numerical evidence',()=>{
 assert.deepEqual(imported.errors,[]);assert.equal(imported.players.length,209);assert.equal(imported.context.sources.length,42);
 assert.equal(imported.context.narrative,raw.narrative);assert.equal(imported.context.datasets.regression.length,50);
 const original=raw.players.filter(p=>p.rank);assert.equal(original.length,185);
 for(const p of imported.players.filter(p=>p.rank))assert.deepEqual(p.tags,[p.researchFlag.toLowerCase()],'Tags must reproduce source flags, not infer player career stage from nearby words');
 assert.deepEqual(imported.players.filter(p=>p.rank).map(p=>[p.name,p.rank,p.tierLabel,p.researchFlag,p.rationale]),original.map(p=>[p.name,p.rank,p.tierLabel,p.researchFlag,p.rationale]));
 const projected=imported.players.filter(p=>p.projections);assert.equal(projected.length,40);
 for(const p of projected){const scored=scorePlayer(p,defaultProfile());if(p.projectionPartial)assert.equal(scored.points,null);else assert.ok(Math.abs(scored.points-p.referenceComponentPoints)<1e-8,p.name);}
 const r=imported.context.datasets.regression;assert.equal(r.reduce((s,p)=>s+Number(p.targets),0),5360);assert.equal(r.reduce((s,p)=>s+Number(p.td),0),299);
 const rate=299/5360;for(const p of r)assert.ok(Math.abs((Number(p.td)+100*rate)/(Number(p.targets)+100)*Number(p.targets)-Number(p.shrunk_td_k100))<1e-8);
});
function scenario(site,names,rosterNames=[],overall=10){
 const players=[...new Set([...names,...rosterNames])].map((name,i)=>{const r=imported.players.find(p=>p.name===name);assert.ok(r,name);return {key:`${site}:synthetic-${i}`,site,siteId:`synthetic-${i}`,name:r.name,positions:r.positions,team:r.team,rank:i+1};});
 return {site,draftId:'synthetic-comparison',tabId:1,readAt:1000,currentOverall:overall,ownTeamId:'10',players,availableKeys:players.filter(p=>names.includes(p.name)).map(p=>p.key),rosters:{'10':players.filter(p=>rosterNames.includes(p.name)).map(p=>p.key)},picks:[],coverage:'visible-only',errors:[],warnings:[],contextKey:'synthetic'};
}
for(const site of ['yahoo','espn']){
 test(`original research changes ${site} opening order and does not chase an early one-QB site rank`,()=>{
  const s=scenario(site,['Josh Allen','James Cook III','Chase Brown','CeeDee Lamb','Justin Jefferson',"De'Von Achane"]);
  const before=recommend(s,[],defaultProfile(),1000),after=recommend(s,imported.players,defaultProfile(),1000);
  assert.notDeepEqual(after.choices.map(p=>p.name),before.choices.map(p=>p.name));assert.equal(after.choices[0].name,'CeeDee Lamb');
  assert.ok(after.choices.every(p=>!p.positions.includes('QB')));assert.ok(after.choices.every(p=>p.researchRank!=null));
  const brown=after.choices.find(p=>p.name==='Chase Brown'),cook=after.choices.find(p=>p.name==='James Cook III');
  assert.ok(brown.projectionPoints>cook.projectionPoints);assert.ok(after.choices.indexOf(brown)<after.choices.indexOf(cook));
 });
 test(`original ${site} upside price context changes late bench order but cannot cause an early reach`,()=>{
  const own=['Josh Allen','Jahmyr Gibbs','Bijan Robinson','CeeDee Lamb','Justin Jefferson','Trey McBride',"Ja'Marr Chase"];
  const names=['Deebo Samuel','Emmett Johnson','Woody Marks','Zachariah Branch'];
  const late=recommend(scenario(site,names,own,130),imported.players,defaultProfile(),1000);
  assert.equal(late.choices[0].name,'Emmett Johnson');assert.match(late.choices[0].reason,/research upside at this price/);
  const early=recommend(scenario(site,names,own,70),imported.players,defaultProfile(),1000);
  assert.equal(early.choices[0].name,'Deebo Samuel');
 });
}
test('original risk and late-unit instructions affect eligibility and retain uncertainty',()=>{
 const s=scenario('yahoo',['Jayden Higgins','Josh Jacobs','Keenan Allen','Brandon Aiyuk','Emmett Johnson','Rams']);
 const advice=recommend(s,imported.players,defaultProfile(),1000);
 assert.deepEqual(advice.choices.map(p=>p.name),['Emmett Johnson']);assert.match(advice.warnings.join(' '),/HOLD\/VERIFY\/OUT/);
});
test('abbreviated compound given names match uniquely and ambiguous names still refuse',()=>{
 const names=[['A. St. Brown','Amon-Ra St. Brown'],['A. Brown','A.J. Brown'],['J. Dobbins','J.K. Dobbins']];
 for(const [short,full]of names){const r=imported.players.find(p=>p.name===full);assert.ok(r,full);assert.equal(matchResearch([r],[{key:'yahoo:synthetic',site:'yahoo',name:short,team:r.team,positions:r.positions}]).matched.length,1);}
});
test('AI context includes original research evidence and source limits with bounded request size',()=>{
 const advice=recommend(scenario('espn',['CeeDee Lamb','Justin Jefferson','Josh Allen','Chase Brown','James Cook III']),imported.players,defaultProfile(),1000);
 const context={choices:boundedAiChoices(advice.choices),research:researchForAi(imported.context,advice.choices)};
 assert.ok(context.research.sources.length);assert.match(context.research.limits,/not a 2026 forecast/);
 assert.ok(context.choices.some(p=>p.historicalDiagnostic));assert.ok(JSON.stringify(context).length<85000);
 assert.equal(imported.context.narrative,raw.narrative);
});
