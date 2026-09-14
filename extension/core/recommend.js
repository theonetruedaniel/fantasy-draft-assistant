import { validateProfile, POSITIONS } from './contracts.js';
import { scorePlayer } from './scoring.js';
import { matchResearch } from './import.js';
import { freshness, nextPicks } from './state.js';
import { POLICY } from './policy.js';

const unique = players => [...new Map(players.map(p => [p.key,p])).values()];
const eligible = (player, slot) => player.positions?.some(pos => slot.includes(pos));
function slotValue(player, slot) {
  if (player.slotValues) return Math.max(...player.positions.filter(p => slot.includes(p)).map(p => player.slotValues[p] || 0));
  return Number.isFinite(player.projectedPoints) ? player.projectedPoints : 0;
}
export function assignStarters(players, starterSlots) {
  if (!Array.isArray(starterSlots) || starterSlots.length > 16) throw new Error('At most 16 starter slots are supported');
  const states = new Map([[0,{ mask: 0, points: 0, slots: Array(starterSlots.length).fill(null), count: 0 }]]);
  for (const player of unique(players)) {
    for (const entry of [...states.values()]) {
      starterSlots.forEach((slot,i) => {
        if (entry.mask & (1 << i) || !eligible(player,slot)) return;
        const mask = entry.mask | (1 << i), points = entry.points + slotValue(player,slot);
        if (!states.has(mask) || points > states.get(mask).points) {
          const slots = [...entry.slots]; slots[i] = player.key;
          states.set(mask, { mask, points, slots, count: entry.count+1 });
        }
      });
    }
  }
  const best = [...states.values()].sort((a,b) => b.count-a.count || b.points-a.points)[0];
  return { ...best, assignedKeys: best.slots.filter(Boolean) };
}
export function teamNeeds(roster, profile) {
  const assignment = assignStarters(roster, profile.starterSlots);
  const slots = profile.starterSlots.filter((_,i) => !assignment.slots[i]);
  const unfilled = slots.map(s => s.length === 1 ? s[0] : `FLEX (${s.join('/')})`);
  const priorities = [...new Set(slots.flat())];
  return { unfilled, priorities, filled: assignment.count, totalStarters: profile.starterSlots.length,
    remainingRosterSpots: Math.max(0, profile.starterSlots.length + profile.bench - unique(roster).length),
    summary: unfilled.length ? `Unfilled: ${unfilled.join(', ')}` : 'Starters filled; consider useful depth' };
}
export const validBye = value => value !== null && value !== '' && Number.isInteger(Number(value)) && Number(value)>=1 && Number(value)<=18 ? Number(value) : null;
export function byeCoverage(roster,profile) {
  const base=assignStarters(roster,profile.starterSlots),weeks=[...new Set(roster.map(p=>validBye(p.byeWeek)).filter(x=>x!==null))].sort((a,b)=>a-b);
  return {unknown:roster.filter(p=>validBye(p.byeWeek)===null).length,weeks:weeks.map(week=>{
    const active=roster.filter(p=>validBye(p.byeWeek)!==week),assigned=assignStarters(active,profile.starterSlots);
    return {week,missing:base.count-assigned.count,slots:profile.starterSlots.filter((_,i)=>!assigned.slots[i]).map(s=>s.join('/')),startersOut:base.assignedKeys.filter(k=>roster.some(p=>p.key===k&&validBye(p.byeWeek)===week)).length};
  })};
}
export function byeFit(player,roster,profile) {
  if(validBye(player.byeWeek)===null)return {gain:0,message:'Bye week unknown; coverage cannot be checked'};
  const baseline=byeCoverage(roster,profile),weeks=baseline.weeks.filter(w=>w.missing>0&&w.week!==validBye(player.byeWeek));
  const covered=weeks.filter(w=>assignStarters([...roster.filter(p=>validBye(p.byeWeek)!==w.week),player],profile.starterSlots).count>assignStarters(roster.filter(p=>validBye(p.byeWeek)!==w.week),profile.starterSlots).count);
  const shared=roster.some(p=>validBye(p.byeWeek)===validBye(player.byeWeek)&&p.positions.some(pos=>player.positions.includes(pos)));
  return {gain:covered.length,message:covered.length?`Can help cover week ${covered.map(w=>w.week).join('/')} starter gaps${baseline.unknown?' if unknown roster byes permit':''}`:shared?`Shares week ${player.byeWeek} with same-position depth; still offers injury or upside value`:`Bye week ${player.byeWeek}; no verified starter gap covered`};
}
function adjustByeDepth(ranked,roster,profile,needs) {
 const groups=new Map(),result=[...ranked];
 ranked.forEach((p,index)=>{if(validBye(p.byeWeek)===null||!p.researchMatched||p.tier==null||p.rank==null||p.positions.some(pos=>needs.priorities.includes(pos)))return;
 const key=JSON.stringify([p.source,p.sourceDate,p.tier,Math.floor((p.rank-1)/POLICY.nearRankBand),p.positions]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({p,index,gain:byeFit(p,roster,profile).gain});});
 for(const items of groups.values()){const ordered=[...items].sort((a,b)=>b.gain-a.gain||a.index-b.index);items.forEach((item,i)=>result[item.index]=ordered[i].p);}return result;
}
function legalAddition(roster, additions, profile) {
  const combined = unique([...roster,...additions]);
  if (combined.length !== unique(roster).length+additions.length) return false;
  const remaining = profile.starterSlots.length+profile.bench-combined.length;
  if (remaining < 0) return false;
  const holes = profile.starterSlots.length-assignStarters(combined,profile.starterSlots).count;
  return holes <= remaining;
}
function depthValue(players, assignment) {
  const assigned = new Set(assignment.assignedKeys), usedPositions = new Set();
  let sum = 0;
  for (const p of players.filter(p => !assigned.has(p.key)).sort((a,b) => b.projectedPoints-a.projectedPoints)) {
    const pos = p.positions.find(pos => !['K','DST'].includes(pos) && !usedPositions.has(pos));
    if (pos) { usedPositions.add(pos); sum += Math.max(0, p.slotValues?.[pos] ?? p.projectedPoints ?? 0); }
  }
  return sum * POLICY.backupWeight;
}
function rosterValue(roster, profile) {
  const assigned = assignStarters(roster, profile.starterSlots);
  return assigned.points + depthValue(roster, assigned);
}
export function choosePair(candidates, roster, profile) {
  let best = null, bestValue = -Infinity;
  const pool = unique(candidates).slice(0,POLICY.pairShortlist);
  for (let i = 0; i < pool.length; i++) for (let j = i+1; j < pool.length; j++) {
    const pair = [pool[i],pool[j]];
    if (!legalAddition(roster,pair,profile)) continue;
    const score = rosterValue([...roster,...pair],profile);
    if (score > bestValue) { best = pair.map(p => p.key); bestValue = score; }
  }
  return best;
}

// Approximate remaining league starter demand, then select an available replacement
// per position. Unknown teams retain the profile's starter demand, explicitly labeled.
function replacementBaseline(pool, state, profile, scoredByKey) {
  const remainingSlots = [];
  const knownRosters = Object.values(state.rosters || {}).slice(0,profile.teams);
  for (let team = 0; team < profile.teams; team++) {
    const roster = (knownRosters[team] || []).map(k => scoredByKey.get(k)).filter(Boolean);
    const assignment = assignStarters(roster,profile.starterSlots);
    profile.starterSlots.forEach((slot,i) => { if (!assignment.slots[i]) remainingSlots.push(slot); });
  }
  const used = new Set();
  // Fill constrained positions first; flex uses the remaining highest scoring eligible
  // player. This is a disclosed scarcity heuristic, not a forecast of opponent picks.
  for (const slot of remainingSlots.sort((a,b) => a.length-b.length)) {
    const next = pool.filter(p => !used.has(p.key) && eligible(p,slot)).sort((a,b) => b.projectedPoints-a.projectedPoints)[0];
    if (next) used.add(next.key);
  }
  const baseline = {};
  for (const pos of POSITIONS) {
    const rest = pool.filter(p => !used.has(p.key) && p.positions.includes(pos)).sort((a,b) => b.projectedPoints-a.projectedPoints);
    baseline[pos] = rest[0]?.projectedPoints ?? null;
  }
  return baseline;
}
function rankingOrder(a,b, needs) {
  const rank=p=>p.lateOnly?p.positionRank??Infinity:p.rank??p.adp??p.positionRank??Infinity;
  const aRank = rank(a), bRank = rank(b);
  if (a.tier != null && b.tier != null && a.tier !== b.tier) return a.tier-b.tier;
  const needed = p => p.positions.some(pos => needs.priorities.includes(pos)) ? 1 : 0;
  if(needs.currentRound>=5&&a.tier!=null&&a.tier===b.tier&&needed(a)!==needed(b))return needed(b)-needed(a);
  const aBand = Math.floor((aRank-1)/POLICY.nearRankBand), bBand = Math.floor((bRank-1)/POLICY.nearRankBand);
  if (aBand !== bBand) return aBand-bBand;
  const upside=p=>researchUpsideRelevant(p,needs)?1:0;
  return needed(b)-needed(a) || upside(b)-upside(a) || aRank-bRank || a.name.localeCompare(b.name);
}
function researchUpsideRelevant(player,needs) {
  const benchStage=needs.unfilled.every(slot=>['K','DST'].includes(slot))&&needs.currentRound>=7;
  const inPrice=Number.isFinite(player.targetPickMin)&&Number.isFinite(player.targetPickMax)?needs.nextOverall>=player.targetPickMin&&needs.nextOverall<=player.targetPickMax:
    Number.isFinite(player.targetRoundMin)&&Number.isFinite(player.targetRoundMax)?needs.currentRound>=player.targetRoundMin&&needs.currentRound<=player.targetRoundMax:player.priceLabel==='Late / waiver'&&needs.currentRound>=11;
  return player.researchMatched&&benchStage&&player.tags?.some(tag=>['sleeper','breakout','upside'].includes(tag))&&!!(player.rationale||player.evidence)&&inPrice;
}

function adjustComparableProjections(ranked,scores) {
  const groups=new Map();
  ranked.forEach((p,index)=>{
    const points=scores.get(p.key)?.points;
    if(!p.researchMatched||!p.projections||p.projectionPartial||points==null||p.positions.length!==1||p.rank==null)return;
    const key=JSON.stringify([p.source,p.sourceDate,p.projectionSource,p.positions[0],p.tier,Math.floor((p.rank-1)/POLICY.nearRankBand)]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({p,index,points});
  });
  const result=[...ranked];
  for(const items of groups.values()){
    if(items.length<2)continue;
    const order=[...items].sort((a,b)=>b.points-a.points||a.p.rank-b.p.rank);
    items.forEach((item,i)=>{result[item.index]=order[i].p;result[item.index].projectionReason='Same-position, same-tier comparison uses research components at your scoring';});
  }
  return result;
}

function applyOpeningContext(ranked,profile,currentOverall,warnings) {
  const qbSlots=profile.starterSlots.filter(slot=>slot.includes('QB'));
  const next=nextPicks(profile,currentOverall,1)[0];
  const opening=qbSlots.length===1&&qbSlots[0].length===1&&Math.ceil(next/profile.teams)<=POLICY.singleQBOpeningRounds;
  if(!opening||!ranked.some(p=>p.positions.includes('QB')))return ranked;
  const rank=p=>p.rank??p.adp??Infinity;
  const bestQB=ranked.find(p=>p.positions.includes('QB'));
  const skill=ranked.filter(p=>p.positions.some(pos=>['RB','WR'].includes(pos))&&rank(p)<=rank(bestQB)+profile.teams*2);
  warnings.push('One-QB opening: favor comparable RB/WR value when a partial pool cannot prove an early QB advantage');
  if(!skill.length){warnings.push('No comparable RB/WR choices visible; broaden the player list before treating a QB as best overall');return ranked;}
  const bestSkill=skill[0];
  const clearResearchValue=p=>Number.isFinite(p.researchRank)&&Number.isFinite(bestSkill.researchRank)&&p.source===bestSkill.source&&p.sourceDate===bestSkill.sourceDate&&p.researchRank+profile.teams<=bestSkill.researchRank;
  const delayed=new Set(ranked.filter(p=>p.positions.includes('QB')&&!clearResearchValue(p)));
  const preferred=new Set(skill);
  const others=ranked.filter(p=>!preferred.has(p)&&!delayed.has(p));
  for(const p of skill)p.openingReason='RB/WR foundation in a one-QB opening; no proven QB value advantage';
  // Keep QBs available as alternatives rather than banning the position. A genuine
  // same-source research rank gap can still preserve an early QB recommendation.
  const clear=ranked.filter(p=>p.positions.includes('QB')&&!delayed.has(p));
  return [...clear,...skill,...others.filter(p=>!clear.includes(p)),...ranked.filter(p=>delayed.has(p))];
}

export function recommend(state, research = [], profile, now = Date.now()) {
  const warnings = [...(state?.warnings || [])], check = freshness(state,now), profileErrors = validateProfile(profile).errors;
  const advice = { contextKey: state?.contextKey || '', computedAt: now, coverage: state?.coverage || 'unsafe',
    choices: [], pair: null, warnings, mode: 'unavailable', teamNeeds: null,
    sourceStatus:research.length?'Research imported; checking player matches':'Site fallback — research not loaded' };
  if (!check.usable || profileErrors.length) { warnings.push(...profileErrors, ...(!check.usable ? [check.reason] : [])); return advice; }
  if(state.season&&research.some(p=>p.season&&p.season!==state.season)){warnings.push('Imported research season differs from this draft; import matching-season research');advice.sourceStatus='Research season mismatch';return advice;}
  if(research.some(p=>p.rankBasis?.startsWith('Full-PPR, one-QB'))&&(profile.pointsPer.receptions!==1||profile.starterSlots.filter(s=>s.includes('QB')).length!==1||profile.starterSlots.some(s=>s.includes('QB')&&s.length>1)))warnings.push('Original priorities assume full-PPR, one-QB redraft; this format has only partial projection/context adjustments, not a fully recalibrated board');
  if (!state.ownTeamId || !Array.isArray(state.rosters?.[state.ownTeamId])) { warnings.push('Own roster is unknown; select/confirm your team'); return advice; }
  const merged = matchResearch(research,state.players || []);
  const players = unique([...(state.players || []), ...merged.matched]);
  const byKey = new Map(players.map(p => [p.key,p]));
  const rosterKeys = state.rosters[state.ownTeamId];
  if (rosterKeys.some(k => !byKey.has(k))) { warnings.push('Own roster contains unresolved player identities'); return advice; }
  const roster = rosterKeys.map(k => byKey.get(k));
  advice.teamNeeds = teamNeeds(roster,profile);
  advice.teamNeeds.byeCoverage=byeCoverage(roster,profile);
  const byes=advice.teamNeeds.byeCoverage;
  if(byes.unknown)warnings.push(`Bye coverage incomplete: ${byes.unknown} roster player(s) have unknown byes`);
  for(const w of byes.weeks.filter(w=>w.startersOut>=2))warnings.push(`Week ${w.week}: ${w.startersOut} assigned starters share a bye; ${w.missing} additional starter gap(s) after available depth`);
  advice.teamNeeds.currentRound=Math.ceil(nextPicks(profile,state.currentOverall,1)[0]/profile.teams);
  advice.teamNeeds.nextOverall=nextPicks(profile,state.currentOverall,1)[0];
  const taken = new Set([...(state.picks || []).map(p => p.playerKey), ...Object.values(state.rosters).flat()]);
  const available = new Set(state.availableKeys);
  const candidates = players.filter(p => available.has(p.key) && !taken.has(p.key) && !p.researchAvoid && legalAddition(roster,[p],profile));
  const avoided=players.filter(p=>available.has(p.key)&&p.researchAvoid);
  if(avoided.length)warnings.push(`Research HOLD/VERIFY/OUT excludes ${avoided.map(p=>p.name).join(', ')}; update the imported research after checking fresh status`);
  const matchedCandidates=candidates.filter(p=>p.researchMatched).length;
  if(research.length)advice.sourceStatus=matchedCandidates===candidates.length&&matchedCandidates>0?'Imported research — matched available players':matchedCandidates>0?`Mixed research and site fallback — ${matchedCandidates}/${candidates.length} available players matched`:'Site fallback — imported research not matched to visible players';
  if (!profile.confirmed) warnings.push('Scoring and roster settings are assumptions until confirmed');
  if (state.coverage === 'visible-only') warnings.push('Visible players only; this is not the full available board');
  if (!state.historyComplete) warnings.push('Draft history is incomplete; opponent roster needs are uncertain');
  if (!research.length) warnings.push('Original research not imported; using readable site rankings/projections where supported');
  const unmatchedVisible=candidates.filter(p=>!p.researchMatched);
  if(research.length&&unmatchedVisible.length)warnings.push(`${unmatchedVisible.length} visible player(s) use site fallback: ${unmatchedVisible.map(p=>p.name).join(', ')}`);
  if (!candidates.length) { warnings.push('No verified available choices that preserve a valid roster'); return advice; }
  const scores = new Map(players.map(p => [p.key,scorePlayer(p,profile)]));
  const scoredPlayers = players.filter(p => scores.get(p.key).points !== null).map(p => ({ ...p, projectedPoints: scores.get(p.key).points }));
  const scoredByKey = new Map(scoredPlayers.map(p => [p.key,p]));
  const scoredPool = scoredPlayers.filter(p => available.has(p.key) && !taken.has(p.key));
  const baseline = replacementBaseline(scoredPool,state,profile,scoredByKey);
  const canProject = state.coverage !== 'visible-only' && candidates.every(p => scores.get(p.key).points !== null && p.positions.some(pos => baseline[pos] !== null)) && roster.every(p => scores.get(p.key).points !== null);
  let ranked, pairCandidates, pairRoster;
  if (canProject) {
    const adjusted = p => ({ ...p, projectedPoints: scores.get(p.key).points,
      slotValues: Object.fromEntries(p.positions.map(pos => [pos, baseline[pos] === null ? 0 : Math.max(0, scores.get(p.key).points-baseline[pos])])) });
    pairRoster = roster.map(adjusted);
    const before = rosterValue(pairRoster,profile);
    ranked = candidates.map(p => { const value = adjusted(p); return { ...value, improvement: rosterValue([...pairRoster,value],profile)-before }; })
      .sort((a,b) => b.improvement-a.improvement || rankingOrder(a,b,advice.teamNeeds));
    pairCandidates = ranked;
    advice.mode = 'projection';
    warnings.push('Replacement value uses remaining starter demand; unknown teams use league-format assumptions');
  } else {
    ranked = candidates.filter(p => Number.isFinite(p.rank) || Number.isFinite(p.adp) || Number.isFinite(p.tier)||Number.isFinite(p.positionRank)).map(p=>({...p}))
      .filter(p=>!p.lateOnly||advice.teamNeeds.currentRound>=profile.starterSlots.length+profile.bench-1)
      .sort((a,b) => rankingOrder(a,b,advice.teamNeeds));
    ranked=adjustComparableProjections(ranked,scores);
    ranked=applyOpeningContext(ranked,profile,state.currentOverall,warnings);
    ranked=adjustByeDepth(ranked,roster,profile,advice.teamNeeds);
    // The ranking-only pair objective fills starters before useful depth, while rank
    // remains ordinal: these internal weights are not displayed as projected points.
    pairCandidates = ranked.map((p,i) => ({ ...p, projectedPoints: ranked.length-i }));
    pairRoster = roster.map(p => ({ ...p, projectedPoints: 0 }));
    advice.mode = ranked.length ? 'research-ranking' : 'unavailable';
    warnings.push('Ranking mode: comparable scoring projections or a deep replacement baseline are unavailable');
  }
  const turns = nextPicks(profile,state.currentOverall,2);
  advice.picksUntilTurn = turns.length ? turns[0]-state.currentOverall : null;
  advice.nextPicks = turns;
  advice.choices = ranked.slice(0,POLICY.maxChoices).map(p => {
    const fills = p.positions.some(pos => advice.teamNeeds.priorities.includes(pos));
    let reason = advice.mode === 'projection' ? `${p.improvement.toFixed(1)} estimated roster-value gain` : p.lateOnly?`Late ${p.positions[0]} preference ${p.positionRank}`:`${p.researchMatched&&p.researchRank!=null?'Research rank':'Site rank'} ${p.rank ?? p.adp ?? 'unknown'}${p.tier ? ` · tier ${p.tierLabel||p.tier}` : ''}`;
    reason += fills ? '; addresses a starting need' : '; compare as depth or a starter upgrade';
    if(p.openingReason)reason+=`; ${p.openingReason}`;
    if(researchUpsideRelevant(p,advice.teamNeeds))reason+=`; research upside at this price: ${(p.rationale||p.evidence).slice(0,180)}`;
    if(p.researchFlag)reason+=`; research flag: ${p.researchFlag}`;
    if(p.rationale)reason+=`; ${p.rationale}`;
    if(p.projectionReason)reason+=`; ${p.projectionReason}`;
    if (p.injury) reason += `; injury flag: ${p.injury}`;
    return { byeWeek:validBye(p.byeWeek),byeFit:byeFit(p,roster,profile),playerKey: p.key, name: p.name, positions: p.positions, team: p.team || null, reason,
      basis: `${p.source || state.site} · ${p.sourceDate || 'date unknown'}`, injury: p.injury || null,
      notes: p.notes || [], tags:p.tags||[],evidence:p.evidence||'',rationale:p.rationale||'',uncertainty:p.uncertainty||'',
      researchRank:p.researchRank??null,projectionPoints:scores.get(p.key)?.points??null,projectionScope:p.projectionScope||'',projectionPartial:!!p.projectionPartial,
      actualStats:p.actualStats||null,historicalDiagnostic:p.historicalDiagnostic||null,market:p.market||null,sourceRefs:p.sourceRefs||[],sourceUrl:p.sourceUrl||'',priceLabel:p.priceLabel||'',
      adpSource:p.adpSource||p.source||state.site,
      targetRoundMin:p.targetRoundMin??null,targetRoundMax:p.targetRoundMax??null,researchFlag:p.researchFlag||'',
      nextTurnRisk: p.adp != null ? (p.adp <= turns[1] ? 'May go before your next turn — ADP estimate' : 'Later ADP — availability uncertain') : 'Next-turn availability unknown' };
  });
  if (turns.length === 2 && turns[1] === turns[0]+1 && roster.length+2 <= profile.starterSlots.length+profile.bench) advice.pair = choosePair(pairCandidates,pairRoster,profile);
  return advice;
}
