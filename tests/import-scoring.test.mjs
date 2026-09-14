import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResearch, matchResearch } from '../extension/core/import.js';
import { defaultProfile, validateProfile, scoringKey } from '../extension/core/contracts.js';
import { scorePlayer } from '../extension/core/scoring.js';

const meta = { source: 'Synthetic test research', sourceDate: '2026-09-06' };
test('synthetic CSV preserves quoted notes, zero values and missing ADP', () => {
  const result = parseResearch('name,position,team,rank,adp,receptions,notes\n"Example, Player",WR,BUF,1,,0,"Line one, with comma\nLine two"', 'csv', meta);
  assert.deepEqual(result.errors, []);
  assert.equal(result.players[0].name, 'Example, Player');
  assert.equal(result.players[0].projections.receptions, 0);
  assert.equal(result.players[0].adp, null);
  assert.match(result.players[0].notes[0], /Line two/);
});
test('import rejects duplicate IDs, invalid dates and nonfinite data', () => {
  const result = parseResearch(JSON.stringify({ ...meta, players: [
    { name: 'Alpha', position: 'WR', yahooId: '4', rank: 1 },
    { name: 'Beta', position: 'RB', yahooId: '4', rank: 2 },
    { name: 'Bad date', position: 'WR', rank: 3, sourceDate: '2026-02-30' },
    { name: 'Bad value', position: 'WR', rank: 'Infinity' }
  ] }), 'json');
  assert.equal(result.players.length, 1);
  assert.equal(result.errors.length, 3);
});
test('missing research provenance or unsupported position cannot silently import', () => {
  assert.equal(parseResearch('name,position,rank\nExample,WR,1', 'csv').players.length, 0);
  assert.equal(parseResearch('name,position,rank\nExample,CB,1', 'csv', meta).players.length, 0);
  assert.ok(parseResearch('name,name,position\nA,B,WR', 'csv', meta).errors.length);
});
test('ambiguous initials are unresolved, while unique verified team and position match', () => {
  const site = [
    { key: 'espn:1', site: 'espn', siteId: '1', name: 'J. Example', team: 'BUF', positions: ['WR'] },
    { key: 'espn:2', site: 'espn', siteId: '2', name: 'Unique Player', team: 'NYJ', positions: ['RB'] }
  ];
  const research = parseResearch(JSON.stringify({ ...meta, players: [
    { name: 'John Example', team: 'BUF', position: 'WR', rank: 1 },
    { name: 'James Example', team: 'BUF', position: 'WR', rank: 2 },
    { name: 'Unique Player', team: 'NYJ', position: 'RB', rank: 3 }
  ] }), 'json').players;
  const result = matchResearch(research, site);
  assert.deepEqual(result.matched.map(p => p.key), ['espn:2']);
  assert.equal(result.unresolved.length, 2);
});
test('site IDs are namespaced and disagreeing identity is not automatically merged', () => {
  const research = parseResearch(JSON.stringify({ ...meta, players: [
    { name: 'First Player', team: 'BUF', position: 'RB', yahooId: '7', rank: 1 }
  ] }), 'json').players;
  const result = matchResearch(research, [{ key: 'espn:7', site: 'espn', siteId: '7', name: 'Other Player', team: 'NYJ', positions: ['WR'] }]);
  assert.equal(result.matched.length, 0);
});
test('full PPR adds exactly one point per reception; blank stats do not become zero', () => {
  const p = { projections: { receptions: 80 }, projectedPoints: null };
  assert.equal(scorePlayer(p, { pointsPer: { receptions: 0.5 } }).points, 40);
  assert.equal(scorePlayer(p, { pointsPer: { receptions: 1 } }).points, 80);
  assert.equal(scorePlayer({ projections: {} }, { pointsPer: { receptions: 1 } }).points, null);
});
test('interceptions are counted with the configured negative coefficient', () => {
  assert.equal(scorePlayer({ projections: { passingTD: 30, interceptions: 10 } }, { pointsPer: { passingTD: 4, interceptions: -2 } }).points, 100);
});
test('a site points total cannot silently change scoring profile', () => {
  const full = defaultProfile();
  const half = { ...full, pointsPer: { ...full.pointsPer, receptions: 0.5 } };
  const p = { projectedPoints: 250, scoringBasis: scoringKey(full), projections: null };
  assert.equal(scorePlayer(p, full).points, 250);
  assert.equal(scorePlayer(p, half).points, null);
  assert.equal(scorePlayer({ projectedPoints: 250 }, full).points, null);
});
test('unsupported scoring is explicit, and invalid league slots cannot enter engine', () => {
  assert.equal(scorePlayer({ projections: { mysteryBonus: 4 } }, { pointsPer: { mysteryBonus: 2 } }).points, null);
  assert.ok(validateProfile({ ...defaultProfile(), slot: 11 }).errors.length);
  assert.ok(validateProfile({ ...defaultProfile(), teams: 0 }).errors.length);
  assert.equal(defaultProfile('8-team').slot, 5);
});
test('research import preserves upside tags, full evidence, price context and uncertainty', () => {
  const evidence='Long-form original evidence. '.repeat(160);
  const result=parseResearch(JSON.stringify({...meta,players:[{name:'Synthetic Rookie',team:'BUF',position:'WR',rank:145,
    tags:['rookie','sleeper','upside'],evidence,rationale:'Development and opportunity, subject to role risk.',
    uncertainty:'Unproven target share',targetRoundMin:10,targetRoundMax:13,researchFlag:'VERIFY',notes:['Dated source note']}]}),'json');
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.players[0].tags,['rookie','sleeper','upside']);
  assert.equal(result.players[0].evidence,evidence);
  assert.equal(result.players[0].targetRoundMin,10);
  assert.equal(result.players[0].uncertainty,'Unproven target share');
});
test('qualitative chat profile retains narrative and site rank without inventing a research rank',()=>{
 const result=parseResearch(JSON.stringify({...meta,coverage:'partial-chat',narrative:'Original written finding. Not the unreceived guide.',players:[
   {name:'Example Player',position:'WR',tags:['expert-target'],rationale:'Named positive target; do not reach.'}
 ]}),'json',{source:'',sourceDate:''});
 assert.deepEqual(result.errors,[]);
 assert.equal(result.context.coverage,'partial-chat');
 assert.match(result.context.narrative,/Original written/);
 const matched=matchResearch(result.players,[{key:'espn:4',site:'espn',siteId:'4',name:'Example Player',team:'BUF',positions:['WR'],rank:37,source:'ESPN'}]).matched;
 assert.equal(matched.length,1);
 assert.equal(matched[0].rank,37);
 assert.equal(matched[0].researchRank,null);
 assert.equal(matched[0].rationale,'Named positive target; do not reach.');
});
