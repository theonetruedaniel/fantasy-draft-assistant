import test from 'node:test';
import assert from 'node:assert/strict';
import { assignStarters, recommend, teamNeeds, choosePair } from '../extension/core/recommend.js';
import { scoringKey } from '../extension/core/contracts.js';
const profile = (slots, extra = {}) => ({ teams: 2, slot: 2, bench: 2, revision: 0, confirmed: true,
  starterSlots: slots, pointsPer: { receptions: 1 }, ...extra });
const p = (key, pos, points, rank = 1) => ({ key: `test:${key}`, name: `Synthetic ${key}`, team: 'TEST', positions: [pos], rank,
  projections: { receptions: points }, projectedPoints: null, source: 'Synthetic decision fixture', sourceDate: '2026-09-06', notes: [] });
const state = (players, own = [], extra = {}) => ({ site: 'yahoo', draftId: 'synthetic', tabId: 1, contextKey: 'test:1',
  readAt: 1000, currentOverall: 1, ownTeamId: '2', currentTeamId: '1', players,
  availableKeys: players.filter(x => !own.includes(x.key)).map(x => x.key), rosters: { '2': own },
  picks: [], historyComplete: true, coverage: 'site-pool', catalogComplete: true, errors: [], ...extra });

test('one multi-eligible player cannot occupy two starter/flex slots', () => {
  const result = assignStarters([
    { key: 'a', positions: ['RB','WR'], projectedPoints: 200 },
    { key: 'b', positions: ['WR'], projectedPoints: 150 }
  ], [['RB'], ['RB','WR','TE']]);
  assert.equal(result.points, 350);
  assert.deepEqual(new Set(result.assignedKeys), new Set(['a','b']));
});
test('negative-scoring player still fills an otherwise empty required slot', () => {
  const assigned = assignStarters([{ key: 'dst', positions: ['DST'], projectedPoints: -5 }], [['DST']]);
  assert.equal(assigned.assignedKeys.length, 1);
});
test('team needs identifies unique starter holes including TE-eligible flex', () => {
  const prof = profile([['QB'], ['WR'], ['RB','WR','TE']]);
  const players = [p('qb','QB',300),p('te','TE',150)];
  const needs = teamNeeds(players, prof);
  assert.deepEqual(needs.unfilled, ['WR']);
  assert.deepEqual(needs.priorities, ['WR']);
});
test('position replacement value beats misleading raw quarterback points', () => {
  const players = [p('QB1','QB',400,1),p('QB2','QB',398,2),p('QB3','QB',395,3),p('QB4','QB',394,4),
    p('RB1','RB',250,5),p('RB2','RB',200,6),p('RB3','RB',100,7),p('RB4','RB',90,8)];
  const advice = recommend(state(players), [], profile([['QB'],['RB']]), 1001);
  assert.equal(advice.mode, 'projection');
  assert.equal(advice.choices[0].playerKey, 'test:RB1');
});
test('full vs half PPR changes relative receiving value using supplied components', () => {
  const prof = profile([['WR']], { pointsPer: { receptions: 1, receivingYards: 0.1 } });
  const players = [p('catch','WR',0,1),p('yards','WR',0,2),p('depth','WR',0,3),p('reserve','WR',0,4)];
  players[0].projections = { receptions: 100, receivingYards: 600 };
  players[1].projections = { receptions: 40, receivingYards: 1000 };
  players[2].projections = { receptions: 20, receivingYards: 300 };
  players[3].projections = { receptions: 10, receivingYards: 200 };
  assert.equal(recommend(state(players), [], prof, 1001).choices[0].playerKey, 'test:catch');
  assert.equal(recommend(state(players), [], { ...prof, pointsPer: { receptions: 0.5, receivingYards: 0.1 } }, 1001).choices[0].playerKey, 'test:yards');
});
test('filled QB reduces backup value and top recommendations address own starter holes', () => {
  const players = [p('own','QB',400,1),p('backup','QB',390,2),p('q3','QB',380,3),p('q4','QB',370,4),
    p('wr1','WR',210,5),p('wr2','WR',190,6),p('wr3','WR',100,7),p('wr4','WR',90,8)];
  const advice = recommend(state(players,['test:own']), [], profile([['QB'],['WR']]), 1001);
  assert.equal(advice.choices[0].playerKey, 'test:wr1');
  assert.deepEqual(advice.teamNeeds.unfilled, ['WR']);
});
test('final pick cannot use bench capacity while leaving a mandatory starter empty', () => {
  const players = [p('own','QB',400,1),p('backup','QB',399,2),p('k','K',70,50)];
  const advice = recommend(state(players,['test:own']), [], profile([['QB'],['K']], { bench: 0 }), 1001);
  assert.deepEqual(advice.choices.map(c => c.playerKey), ['test:k']);
});
test('visible-only mode never pads choices with imported or disappeared players', () => {
  const players = Array.from({ length: 8 }, (_,i) => p(`w${i}`,'WR',200-i,i+1));
  const advice = recommend(state(players,[], { coverage: 'visible-only', catalogComplete: false, availableKeys: ['test:w5','test:w6'] }), [], profile([['WR']]), 1001);
  assert.equal(advice.mode, 'research-ranking');
  assert.deepEqual(advice.choices.map(c => c.playerKey), ['test:w5','test:w6']);
  assert.ok(advice.warnings.some(x => /visible/i.test(x)));
});
test('missing own roster or stale read cannot pretend to give personalized live advice', () => {
  const players = [p('a','WR',200)];
  assert.equal(recommend(state(players,[],{ rosters: {} }), [], profile([['WR']]), 1001).mode, 'unavailable');
  assert.equal(recommend(state(players), [], profile([['WR']]), 6000).mode, 'unavailable');
});
test('paired choices contain distinct players and jointly fill complementary needs', () => {
  const prof = profile([['RB'],['WR']], { bench: 0 });
  const players = [p('rb1','RB',250),p('rb2','RB',245),p('wr','WR',200)];
  assert.deepEqual(new Set(choosePair(players, [], prof)), new Set(['test:rb1','test:wr']));
});
test('taken player never reaches advice even if stale availability includes it', () => {
  const players = [p('taken','WR',300),p('free','WR',200,2)];
  const advice = recommend(state(players,[], { picks: [{ overall: 1, playerKey: 'test:taken', teamId: '1' }] }), [], profile([['WR']]), 1001);
  assert.deepEqual(advice.choices.map(c => c.playerKey), ['test:free']);
});
test('matching total permits profile scoring; unknown totals fall back to documented rank', () => {
  const prof = profile([['WR']]);
  const players = [p('one','WR',200),p('two','WR',190,2),p('three','WR',180,3)];
  for (const player of players) { player.projectedPoints = player.projections.receptions; player.projections = null; player.scoringBasis = scoringKey(prof); }
  assert.equal(recommend(state(players), [], prof, 1001).mode, 'projection');
  players[0].scoringBasis = null;
  assert.equal(recommend(state(players), [], prof, 1001).mode, 'research-ranking');
});

test('single-QB opening does not simply repeat a visible site rank led by a QB', () => {
  const prof=profile([['QB'],['RB'],['RB'],['WR'],['WR'],['TE'],['RB','WR','TE']],{teams:10,slot:10,bench:6});
  const players=[p('qb','QB',450,12),p('rb','RB',250,15),p('wr','WR',245,16),p('wr2','WR',240,19),p('rb2','RB',235,21),p('te','TE',210,22)];
  const s=state(players,[],{currentOverall:8,coverage:'visible-only',catalogComplete:false});
  const advice=recommend(s,[],prof,1001);
  assert.equal(advice.choices[0].playerKey,'test:rb');
  assert.match(advice.sourceStatus,/Site fallback.*research not loaded/);
  assert.match(advice.choices[0].reason,/opening/i);
  assert.ok(advice.warnings.some(x=>/one.QB/i.test(x)));
});
test('opening QB caution is not applied to two-QB or superflex formats', () => {
  const players=[p('qb','QB',450,12),p('rb','RB',250,15),p('wr','WR',245,16)];
  for(const slots of [[['QB'],['QB'],['RB'],['WR']],[['QB'],['QB','RB','WR','TE'],['RB'],['WR']]]){
    const advice=recommend(state(players,[],{currentOverall:8,coverage:'visible-only',catalogComplete:false}),[],profile(slots,{teams:10,slot:10,bench:6}),1001);
    assert.equal(advice.choices[0].playerKey,'test:qb');
  }
});
test('a late missing QB need and a QB-only visible list remain usable without invented alternatives', () => {
  const prof=profile([['QB'],['RB'],['WR']],{teams:10,slot:10,bench:6});
  const players=[p('qb','QB',450,12),p('rb','RB',250,15),p('wr','WR',245,16)];
  assert.equal(recommend(state(players,[],{currentOverall:70,coverage:'visible-only'}),[],prof,1001).choices[0].playerKey,'test:qb');
  const only=recommend(state(players,[],{currentOverall:8,coverage:'visible-only',availableKeys:['test:qb']}),[],prof,1001);
  assert.deepEqual(only.choices.map(p=>p.playerKey),['test:qb']);
  assert.ok(only.warnings.some(x=>/RB\/WR.*visible/i.test(x)));
});
test('a sleeper label cannot leapfrog a much earlier player or ignore draft price',()=>{
 const prof=profile([['WR']],{teams:10,slot:10,bench:6});
 const players=[p('normal','WR',200,12),{...p('sleeper','WR',150,145),researchMatched:true,tags:['rookie','sleeper','upside'],rationale:'Synthetic bench upside',targetRoundMin:10,targetRoundMax:13}];
 const advice=recommend(state(players,[],{currentOverall:8,coverage:'visible-only'}),[],prof,1001);
 assert.equal(advice.choices[0].playerKey,'test:normal');
 assert.ok(!advice.choices[0].reason.includes('upside'));
});
test('late useful bench upside can break a near-rank tie with its research explanation',()=>{
 const prof=profile([['WR']],{teams:10,slot:10,bench:12});
 const players=[p('own','WR',200,10),p('normal','WR',150,121),{...p('sleeper','WR',150,122),researchMatched:true,tags:['breakout','upside'],
  rationale:'Synthetic expanded role evidence',uncertainty:'Role not guaranteed',targetRoundMin:10,targetRoundMax:13,source:'Synthetic imported research',sourceDate:'2026-09-06'}];
 const advice=recommend(state(players,['test:own'],{currentOverall:109,coverage:'visible-only'}),[],prof,1001);
 assert.equal(advice.choices[0].playerKey,'test:sleeper');
 assert.match(advice.choices[0].reason,/expanded role evidence/);
 assert.equal(advice.choices[0].uncertainty,'Role not guaranteed');
});
