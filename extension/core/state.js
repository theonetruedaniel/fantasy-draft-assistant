import { profileKey, validateProfile,normalizeName,normalizeTeam } from './contracts.js';

export function nextPicks(profile, fromOverall = 1, count = 4) {
  const { teams, slot } = profile;
  if (!Number.isInteger(teams) || teams < 2 || !Number.isInteger(slot) || slot < 1 || slot > teams || !Number.isInteger(count) || count < 0 || count > 100) return [];
  const result = []; let round = Math.max(1, Math.floor((Math.max(1, fromOverall)-1)/teams)+1);
  while (result.length < count) {
    const pick = (round-1)*teams + (round % 2 ? slot : teams+1-slot);
    if (pick >= fromOverall) result.push(pick);
    round++;
  }
  return result;
}
function sameDraft(a,b) { return a && a.site === b.site && a.draftId === b.draftId && a.tabId === b.tabId && a.readerVersion===b.readerVersion; }
function complete(picks, current) {
  if (!Number.isInteger(current) || current < 1) return false;
  const numbers = new Set(picks.map(p => p.overall));
  return numbers.size === current-1 && Array.from({ length: current-1 }, (_,i) => i+1).every(n => numbers.has(n));
}
function fingerprint(s) {
  return JSON.stringify({ current: s.currentOverall, currentTeam: s.currentTeamId, ownTeam: s.ownTeamId,
    available: [...s.availableKeys].sort(), picks: s.picks, rosters: s.rosters, players: s.players,
    coverage: s.coverage, errors: s.errors, history: s.historyComplete, filters: s.filters, status: s.status,season:s.season });
}
function promoteObservedIds(prior,snapshot) {
  const all=[...(prior?.players||[]),...(snapshot.players||[])],groups=new Map(),aliases=new Map();
  for(const p of all){
    const group=JSON.stringify([p.site||p.key.split(':')[0],normalizeName(p.name),normalizeTeam(p.team),[...(p.positions||[])].sort()]);
    if(!groups.has(group))groups.set(group,[]);groups.get(group).push(p);
  }
  for(const group of groups.values()){
    const ids=[...new Map(group.filter(p=>p.siteId&&!p.key.includes(':name:')).map(p=>[p.key,p])).values()];
    // Only a unique observed ID can replace a temporary name key. Two actual
    // site IDs remain separate and ambiguous; never infer identity from rank.
    if(ids.length===1)for(const p of group)if(p.key.includes(':name:'))aliases.set(p.key,ids[0]);
  }
  if(!aliases.size)return [prior,snapshot];
  const key=k=>aliases.get(k)?.key||k;
  const remap=s=>s?{...s,players:(s.players||[]).map(p=>aliases.has(p.key)?{...p,key:aliases.get(p.key).key,siteId:aliases.get(p.key).siteId}:p),
    availableKeys:(s.availableKeys||[]).map(key),picks:(s.picks||[]).map(p=>({...p,playerKey:key(p.playerKey)})),
    rosters:Object.fromEntries(Object.entries(s.rosters||{}).map(([id,keys])=>[id,[...new Set(keys.map(key))]]))}:s;
  return [remap(prior),remap(snapshot)];
}
export function reconcile(previous, snapshot, profile, importRevision = 0) {
  let prior = sameDraft(previous, snapshot) ? previous : null;
  if (prior && snapshot.readAt < prior.readAt) return prior;
  [prior,snapshot]=promoteObservedIds(prior,snapshot);
  const errors = [...(snapshot.errors || []), ...validateProfile(profile).errors];
  if (!snapshot.draftId || !['yahoo','espn'].includes(snapshot.site)) errors.push('Draft identity is unknown');
  if (!Number.isFinite(snapshot.readAt)) errors.push('Reader timestamp missing');
  if (snapshot.status!=='complete'&&(!Number.isInteger(snapshot.currentOverall) || snapshot.currentOverall < 1 || snapshot.currentOverall > 2000)) errors.push('Current overall pick is unknown');
  const incoming = snapshot.picks || [];
  const authoritative = snapshot.authoritativeHistory === true && complete(incoming, snapshot.currentOverall);
  // A transient unreadable/backward turn must not permanently poison numbered
  // history. Keep the last coherent board and suspend until the next valid read.
  if(prior&&snapshot.status!=='complete'&&!authoritative&&(snapshot.errors?.length||snapshot.currentOverall<prior.currentOverall))return {...prior,readAt:snapshot.readAt,coverage:'unsafe',errors:errors.length?errors:['Draft turn moved backward; waiting for a consistent read']};
  const pickMap = new Map(authoritative ? [] : (prior?.picks || []).map(p => [p.overall,p]));
  let conflict = authoritative ? false : !!prior?.conflict;
  for (const p of incoming) {
    if (!Number.isInteger(p.overall) || p.overall < 1 || (snapshot.status!=='complete'&&p.overall >= snapshot.currentOverall) || !p.playerKey || !p.teamId) { errors.push('Invalid or incomplete pick event'); continue; }
    const old = pickMap.get(p.overall);
    if (old && (old.playerKey !== p.playerKey || old.teamId !== p.teamId)) conflict = true;
    else pickMap.set(p.overall, { overall: p.overall, playerKey: p.playerKey, teamId: String(p.teamId) });
  }
  const picks = [...pickMap.values()].sort((a,b) => a.overall-b.overall);
  if (new Set(picks.map(p => p.playerKey)).size !== picks.length) conflict = true;
  if (conflict) errors.push('Conflicting history; reopen complete history to reconcile');
  const historyComplete = !conflict && complete(picks, snapshot.currentOverall);
  const players = [...new Map([...(prior?.players || []), ...(snapshot.players || [])].map(p => [p.key,p])).values()];
  const known = new Set(players.map(p => p.key));
  const taken = new Set(picks.map(p => p.playerKey));
  const rosters = Object.fromEntries(Object.entries(authoritative ? {} : prior?.rosters || {}).map(([k,v]) => [k,[...v]]));
  for (const [team, roster] of Object.entries(snapshot.rosters || {})) {
    if (Array.isArray(roster)) rosters[team] = [...new Set(roster)];
  }
  if (historyComplete) {
    for (const p of picks) (rosters[p.teamId] ||= []).push(p.playerKey);
    if (snapshot.ownTeamId && !rosters[snapshot.ownTeamId]) rosters[snapshot.ownTeamId] = [];
  } else {
    for (const p of picks) if (rosters[p.teamId]) rosters[p.teamId].push(p.playerKey);
  }
  for (const team of Object.keys(rosters)) { rosters[team] = [...new Set(rosters[team])]; rosters[team].forEach(key => taken.add(key)); }
  let coverage = 'visible-only';
  if (snapshot.catalogComplete && (snapshot.availabilityComplete || historyComplete)) coverage = snapshot.coverage === 'research-pool' ? 'research-pool' : 'site-pool';
  const available = coverage !== 'visible-only' && !snapshot.availabilityComplete ? players.map(p => p.key) : snapshot.availableKeys || [];
  const availableKeys = [...new Set(available)].filter(key => known.has(key) && !taken.has(key));
  if (errors.length || snapshot.coverage === 'unsafe' || snapshot.status === 'complete' || snapshot.disconnected) coverage = 'unsafe';
  const state = { ...snapshot, players, picks, rosters, availableKeys, coverage, historyComplete, conflict,
    errors: [...new Set(errors)], filters: snapshot.filters || [], importRevision,
    lastPickAt: picks.length !== (prior?.picks.length || 0) ? snapshot.readAt : prior?.lastPickAt || null };
  const changed = !prior || fingerprint(state) !== fingerprint(prior);
  state.boardRevision = (prior?.boardRevision || 0) + (changed ? 1 : 0);
  state.contextKey = JSON.stringify([state.site,state.draftId,state.tabId,state.boardRevision,profileKey(profile),importRevision]);
  return state;
}
export function freshness(state, now = Date.now()) {
  if (!state) return { usable: false, reason: 'Connect a draft' };
  if(state.status==='complete')return {usable:false,reason:'Draft complete'};
  if (state.coverage === 'unsafe' || state.errors?.length) return { usable: false, reason: state.errors?.[0] || 'Draft is not actionable' };
  const age = now-state.readAt;
  if (!Number.isFinite(age) || age < 0 || age >= 5000) return { usable: false, reason: 'Page read is stale; check the draft connection' };
  return { usable: true, reason: 'Recent page read; server connectivity is not independently verified', age };
}
