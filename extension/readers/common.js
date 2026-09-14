import { normalizeName, normalizePosition, normalizeTeam, POSITIONS } from '../core/contracts.js';
export const text = node => node?.textContent?.replace(/\s+/g,' ').trim() || '';
export const numeric = value => { const s=String(value ?? '').trim().replace(/,/g,''); return s && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
export function blankSnapshot(site,document,metadata) {
  return { site, draftId: '', tabId: metadata.tabId, readAt: metadata.readAt ?? Date.now(), currentOverall: null,
    currentTeamId: null, ownTeamId: null, players: [], availableKeys: [], picks: [], rosters: {},
    coverage: 'visible-only', historyComplete: false, filters: [], errors: [], warnings: [],
    catalogComplete: false, availabilityComplete: false, url: metadata.url || document.URL,
    season:Number(new URL(metadata.url||document.URL).searchParams.get('seasonId'))||null };
}
export function makePlayer(site,{ id=null,name,team,position,injury=null },known=[]) {
  const positions=[...new Set(String(position || '').split(',').map(normalizePosition))];
  if(!name || !positions.length || positions.some(p=>!POSITIONS.includes(p))) return null;
  team=normalizeTeam(team) || null;
  const same=[...new Map(known.filter(p=>normalizeName(p.name)===normalizeName(name)&&normalizeTeam(p.team)===team&&p.positions.some(pos=>positions.includes(pos))).map(p=>[p.key,p])).values()];
  const key=id ? `${site}:${id}` : positions[0]==='DST' && team ? `${site}:dst:${team}` : same.length===1 ? same[0].key : `${site}:name:${encodeURIComponent(`${normalizeName(name)}|${team || ''}|${positions.join(',')}`)}`;
  return { byeWeek:known.find(p=>p.key===key)?.byeWeek??null,key,site,siteId:id,name,team,positions,injury,rank:null,tier:null,adp:null,projectedPoints:null,scoringBasis:null,
    projections:null,source:site==='yahoo'?'Yahoo visible draft data':'ESPN visible draft data',sourceDate:null,notes:[] };
}
export const STAT_TITLES={ 'Passing Yards':'passingYards','Passing Touchdowns':'passingTD','Interceptions':'interceptions',
  'Rushing Yards':'rushingYards','Rushing Touchdowns':'rushingTD','Receptions':'receptions','Receiving Yards':'receivingYards',
  'Receiving Touchdowns':'receivingTD','Fumbles Lost':'fumblesLost','2-Point Conversions':'twoPoint' };
export function completeHistory(picks,current) {
  if(!Number.isInteger(current)||current<1) return false;
  const seen=new Set(picks.map(p=>p.overall));
  return picks.length===current-1 && seen.size===picks.length && picks.every(p=>p.overall>=1&&p.overall<current);
}
export function dedupePlayers(players) {
  const found=new Map();
  for(const p of players.filter(Boolean)) {
    const prior=found.get(p.key);
    found.set(p.key,prior ? {...prior,...Object.fromEntries(Object.entries(p).filter(([,v])=>v!==null&&v!==undefined)),
      projections:p.projections||prior.projections,rank:p.rank??prior.rank,adp:p.adp??prior.adp,projectedPoints:p.projectedPoints??prior.projectedPoints}:p);
  }
  return [...found.values()];
}
