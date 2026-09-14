import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseResearch} from '../extension/core/import.js';import {cardSummary} from '../extension/core/card-summary.js';
let original,enriched;try{original=JSON.parse(await readFile('outputs/2026-original-research-profile.json','utf8'));enriched=JSON.parse(await readFile('outputs/2026-research-with-2025-stats.json','utf8'));}catch{}
test('actual-stat enrichment preserves every original field and regression record',{skip:!original},()=>{
 assert.equal(enriched.players.length,209);for(let i=0;i<209;i++){const {actualStats,...rest}=enriched.players[i];assert.deepEqual(rest,original.players[i]);}
 const imported=parseResearch(JSON.stringify(enriched),'json');assert.deepEqual(imported.errors,[]);
 const counts={};for(const p of imported.players.filter(p=>p.actualStats)){counts[p.positions[0]]=(counts[p.positions[0]]||0)+1;assert.equal(p.actualStats.season,2025);assert.equal(p.actualStats.seasonType,'REG');}
 assert.deepEqual(counts,{RB:53,WR:66,TE:21,QB:25});
 const seen=new Set(imported.players.filter(p=>p.actualStats).map(p=>p.actualStats.playerId));assert.equal(seen.size,165);
 for(const position of ['QB','RB','WR','TE']){const p=imported.players.find(p=>p.positions.includes(position)&&p.actualStats);const line=cardSummary(p,null).actualStats;assert.match(line,/2025 actual regular season/);if(position==='QB')assert.match(line,/pass yd/);if(position==='RB')assert.match(line,/rush yd.*catches/);if(position==='TE')assert.match(line,/rec yd/);}
 assert.equal(imported.players.find(p=>p.name==='Jeremiyah Love').actualStats,null);
 assert.equal(imported.players.find(p=>p.name==='Travis Hunter').actualStats.playerId,'00-0040718');
});
test('legitimate negative rushing yards are actuals, not missing or projected',()=>{
 const p={positions:['QB'],actualStats:{season:2025,seasonType:'REG',sourceUrl:'https://example.test/source',stats:{passing_yards:544,passing_tds:4,passing_interceptions:3,rushing_yards:-1,rushing_tds:0}}};assert.match(cardSummary(p,null).actualStats,/-1 rush yd/);
});
