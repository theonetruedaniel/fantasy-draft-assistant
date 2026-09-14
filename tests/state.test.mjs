import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, freshness, nextPicks } from '../extension/core/state.js';
import { defaultProfile } from '../extension/core/contracts.js';
const profile = defaultProfile();
const player = key => ({ key, name: key, positions: ['WR'], rank: 1 });
const snapshot = (overrides = {}) => ({ site: 'yahoo', draftId: 'test-room', tabId: 1, readAt: 1000,
  currentOverall: 1, currentTeamId: '1', ownTeamId: '10', players: [player('yahoo:a'), player('yahoo:b')],
  availableKeys: ['yahoo:a', 'yahoo:b'], picks: [], rosters: { '10': [] }, coverage: 'visible-only',
  filters: [], errors: [], ...overrides });
test('snake schedule uses slot and respects overall start', () => {
  assert.deepEqual(nextPicks({ teams: 10, slot: 10 }, 1, 4), [10,11,30,31]);
  assert.deepEqual(nextPicks({ teams: 8, slot: 5 }, 1, 4), [5,12,21,28]);
  assert.deepEqual(nextPicks({ teams: 10, slot: 10 }, 11, 2), [11,30]);
});
test('explicit pick wins over stale available row and is retained when feed truncates', () => {
  const first = reconcile(null, snapshot(), profile, 0);
  const picked = reconcile(first, snapshot({ readAt: 2000, currentOverall: 2,
    picks: [{ overall: 1, playerKey: 'yahoo:a', teamId: '1' }] }), profile, 0);
  assert.deepEqual(picked.availableKeys, ['yahoo:b']);
  assert.equal(picked.historyComplete, true);
  const truncated = reconcile(picked, snapshot({ readAt: 3000, currentOverall: 2 }), profile, 0);
  assert.deepEqual(truncated.availableKeys, ['yahoo:b']);
  assert.equal(truncated.picks.length, 1);
});
test('a disappearing row is not added to picks; unknown gap is exposed', () => {
  const state = reconcile(null, snapshot({ currentOverall: 20, availableKeys: ['yahoo:b'] }), profile, 0);
  assert.equal(state.picks.length, 0);
  assert.equal(state.historyComplete, false);
  assert.equal(state.coverage, 'visible-only');
});
test('conflicting pick is unsafe until an authoritative complete history reconciles undo', () => {
  const state = reconcile(null, snapshot({ currentOverall: 2, picks: [{ overall: 1, playerKey: 'yahoo:a', teamId: '1' }] }), profile, 0);
  const conflict = reconcile(state, snapshot({ readAt: 2000, currentOverall: 2, picks: [{ overall: 1, playerKey: 'yahoo:b', teamId: '1' }] }), profile, 0);
  assert.equal(conflict.coverage, 'unsafe');
  const corrected = reconcile(conflict, snapshot({ readAt: 3000, currentOverall: 2, authoritativeHistory: true,
    picks: [{ overall: 1, playerKey: 'yahoo:b', teamId: '1' }] }), profile, 0);
  assert.deepEqual(corrected.availableKeys, ['yahoo:a']);
  assert.notEqual(corrected.coverage, 'unsafe');
});
test('new room or tab does not inherit old picks; out-of-order snapshots do not rewind', () => {
  const old = reconcile(null, snapshot({ currentOverall: 2, picks: [{ overall: 1, playerKey: 'yahoo:a', teamId: '1' }] }), profile, 0);
  const fresh = reconcile(old, snapshot({ draftId: 'other-room' }), profile, 0);
  assert.deepEqual(fresh.availableKeys, ['yahoo:a', 'yahoo:b']);
  const late = reconcile(old, snapshot({ readAt: 500 }), profile, 0);
  assert.equal(late.currentOverall, 2);
});
test('timer heartbeat preserves revision, while meaningful context changes invalidate advice', () => {
  const first = reconcile(null, snapshot(), profile, 0);
  const beat = reconcile(first, snapshot({ readAt: 2000, clock: '00:24' }), profile, 0);
  assert.equal(beat.contextKey, first.contextKey);
  const changed = reconcile(beat, snapshot({ readAt: 3000 }), { ...profile, pointsPer: { ...profile.pointsPer, receptions: 0.5 } }, 0);
  assert.notEqual(changed.contextKey, first.contextKey);
  assert.notEqual(reconcile(changed, snapshot({ readAt: 4000 }), profile, 1).contextKey, changed.contextKey);
});
test('fresh heartbeat cannot erase a reader error; stale advice suspends at five seconds', () => {
  const state = reconcile(null, snapshot(), profile, 0);
  assert.equal(freshness(state, 5999).usable, true);
  assert.equal(freshness(state, 6000).usable, false);
  assert.equal(freshness(reconcile(state, snapshot({ readAt: 2000, errors: ['Disconnected'] }), profile, 0), 2001).usable, false);
});
test('unproven full pool is downgraded and unknown roster is not an empty roster', () => {
  const state = reconcile(null, snapshot({ coverage: 'site-pool', currentOverall: 10, rosters: {} }), profile, 0);
  assert.equal(state.coverage, 'visible-only');
  assert.equal(state.rosters['10'], undefined);
});

test('Yahoo reader-version migration discards legacy inferred events, but current real conflicts stay unsafe',()=>{
 const legacy=reconcile(null,snapshot({currentOverall:2,picks:[{overall:1,playerKey:'yahoo:a',teamId:'1'}]}),profile);
 legacy.conflict=true;legacy.coverage='unsafe';legacy.errors=['Conflicting history'];
 const repaired=reconcile(legacy,snapshot({readAt:2000,readerVersion:2,currentOverall:2}),profile);
 assert.equal(repaired.conflict,false);assert.equal(repaired.historyComplete,false);assert.deepEqual(repaired.picks,[]);
 const numbered=reconcile(repaired,snapshot({readerVersion:2,readAt:3000,currentOverall:2,picks:[{overall:1,playerKey:'yahoo:a',teamId:'1'}]}),profile);
 const conflict=reconcile(numbered,snapshot({readerVersion:2,readAt:4000,currentOverall:2,picks:[{overall:1,playerKey:'yahoo:b',teamId:'1'}]}),profile);
 assert.equal(conflict.conflict,true);assert.equal(conflict.coverage,'unsafe');
});

test('transient backward or inconsistent turn suspends without permanently poisoning history',()=>{
 const state=reconcile(null,snapshot({currentOverall:2,picks:[{overall:1,playerKey:'yahoo:a',teamId:'1'}]}),profile);
 const transient=reconcile(state,snapshot({readAt:2000,currentOverall:1}),profile);
 assert.equal(transient.coverage,'unsafe');assert.equal(transient.currentOverall,2);assert.equal(transient.conflict,false);
 const recovered=reconcile(transient,snapshot({readAt:3000,currentOverall:2}),profile);
 assert.equal(recovered.coverage,'visible-only');assert.equal(recovered.conflict,false);assert.equal(recovered.picks.length,1);
});

test('an observed unique site ID promotes a temporary name key across picks and rosters',()=>{
 const tmp={...player('espn:name:example'),site:'espn',name:'Example Player',team:'BUF',siteId:null};
 const id={...tmp,key:'espn:123',siteId:'123'};
 const first=reconcile(null,snapshot({site:'espn',currentOverall:2,players:[tmp],availableKeys:[],picks:[{overall:1,playerKey:tmp.key,teamId:'10'}],rosters:{'10':[tmp.key]}}),profile);
 const next=reconcile(first,snapshot({site:'espn',readAt:2000,currentOverall:2,players:[id],availableKeys:[],picks:[{overall:1,playerKey:id.key,teamId:'10'}],rosters:{'10':[id.key]}}),profile);
 assert.equal(next.conflict,false);assert.equal(next.players.length,1);assert.deepEqual(next.rosters['10'],[id.key]);assert.equal(next.picks[0].playerKey,id.key);
 const ambiguous=reconcile(first,snapshot({site:'espn',readAt:2000,currentOverall:2,players:[id,{...id,key:'espn:456',siteId:'456'}],picks:[]}),profile);
 assert.equal(ambiguous.players.length,3,'Two actual site IDs must not be collapsed');
});
