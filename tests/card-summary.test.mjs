import test from 'node:test';import assert from 'node:assert/strict';
import {cardSummary} from '../extension/core/card-summary.js';
test('card labels sourced actual receiving stats and explains the open roster spot without changing advice',()=>{
 const choice={name:'Example',positions:['WR'],rationale:'Receiving volume supports the price. A second source sentence.',researchRank:9,
  projectionPoints:285,priceLabel:'8-20',historicalDiagnostic:{receptions:'117',yards:'1194',td:'3',source_url:'https://www.fantasypros.com/nfl/stats/wr.php?year=2025'}};
 const before=structuredClone(choice),card=cardSummary(choice,{unfilled:['WR','RB']});
 assert.equal(card.actualStats,'2025 actual receiving: 117 catches · 1,194 yards · 3 TDs');
 assert.equal(card.explanation,'Receiving volume supports the price. You still need a starting WR, so this pick helps fill that spot; the research price is 8-20.');
 assert.deepEqual(choice,before);assert.ok(!card.actualStats.includes('285'));
});
test('missing rookie/history coverage and partial projections never become previous-season actuals',()=>{
 for(const choice of [{positions:['WR'],rationale:'Rookie role remains uncertain.',projectionPoints:140},{positions:['TE'],projectionPartial:true,projectionPoints:99},
  {positions:['WR'],historicalDiagnostic:{receptions:'',yards:'0',td:'0',source_url:'https://example.test/?year=2025'}}])assert.equal(cardSummary(choice,{unfilled:[]}).actualStats,null);
});
test('card distinguishes flex, depth and current injury context and retains actual zero values',()=>{
 const choice={positions:['WR'],rationale:'Useful receiving depth.',injury:'Questionable',historicalDiagnostic:{receptions:'0',yards:'0',td:'0',source_url:'https://example.test/?year=2025'}};
 assert.match(cardSummary(choice,{unfilled:['FLEX (RB/WR/TE)']}).explanation,/open flex spot/);
 assert.match(cardSummary(choice,{unfilled:['K','DST']}).explanation,/covered.*depth; check the questionable status/);
 assert.match(cardSummary(choice,{unfilled:[]}).actualStats,/0 catches · 0 yards · 0 TDs/);
});
