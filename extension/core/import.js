import { POSITIONS, STAT_KEYS, normalizeName, normalizePosition, normalizeTeam } from './contracts.js';

function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error('Malformed CSV quoting');
      quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(x => x.trim())) rows.push(row); row = []; if (c === '\r' && text[i+1] === '\n') i++; }
    } else { if (closed && c.trim()) throw new Error('Unexpected text after CSV quote'); if (!closed) field += c; }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
const aliases = { player: 'name', playername: 'name', bye:'byeWeek', pos: 'position', xrank: 'rank', overallrank: 'rank', date: 'sourceDate', snapshotdate: 'sourceDate', projectedpoints: 'projectedPoints', fpts: 'projectedPoints', yahooplayerid: 'yahooId', espnplayerid: 'espnId' };
const columns = ['actualStats','byeWeek','name','position','positions','team','rank','tier','adp','source','sourceDate','notes','injury','yahooId','espnId','projectedPoints','scoringBasis','projections','tags','evidence','rationale','uncertainty','targetRoundMin','targetRoundMax','targetPickMin','targetPickMax','priceLabel','researchFlag','researchAvoid','projectionPartial','projectionScope','projectionSource','referenceComponentPoints','historicalDiagnostic','market','sourceRefs','sourceUrl','tierLabel','positionRank','lateOnly', ...STAT_KEYS];
function canonicalColumn(key) {
  const small = String(key).replace(/[ _-]/g, '').toLowerCase();
  return aliases[small] || columns.find(x => x.toLowerCase() === small) || key;
}
function number(value, label, positive = false) {
  if (value === '' || value === null || value === undefined) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || (positive && result <= 0)) throw new Error(`Invalid ${label}`);
  return result;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

export function parseResearch(text, format = 'csv', metadata = {}) {
  const players = [], errors = [], seen = new Set(); let context=null;
  try {
    if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('Import must be text under 5 MB');
    let records, defaults = metadata;
    if (format === 'json') {
      const data = JSON.parse(text);
      records = Array.isArray(data) ? data : data.players;
      if (!Array.isArray(data)) {
        defaults = { ...data, ...Object.fromEntries(Object.entries(metadata).filter(([,v])=>v!==''&&v!=null)) };
        context={source:defaults.source||'',sourceDate:defaults.sourceDate||'',coverage:String(data.coverage||''),narrative:String(data.narrative||''),sources:data.sources||[],sections:data.sections||[],datasets:data.datasets||{}};
        if(context.narrative.length>1_000_000)throw new Error('Research narrative exceeds 1 MB');
      }
    } else if (format === 'csv') {
      const rows = csvRows(text.replace(/^\uFEFF/, ''));
      const headers = (rows.shift() || []).map(x => canonicalColumn(x.trim()));
      if (new Set(headers).size !== headers.length) throw new Error('Duplicate import column');
      records = rows.map(row => { if (row.length !== headers.length) throw new Error('CSV row has a different column count'); return Object.fromEntries(headers.map((h,i) => [h,row[i]])); });
    } else throw new Error('Choose CSV or JSON');
    if (!Array.isArray(records) || !records.length || records.length > 5000) throw new Error('Import must contain 1–5000 player records');
    records.forEach((raw, index) => {
      try {
        const row = Object.fromEntries(Object.entries(raw).map(([k,v]) => [canonicalColumn(k), v]));
        const name = String(row.name || '').trim();
        const source = String(row.source || defaults.source || '').trim();
        const sourceDate = String(row.sourceDate || defaults.sourceDate || '').trim();
        const positions = [...new Set((Array.isArray(row.positions) ? row.positions : String(row.positions || row.position || '').split(/[|,]/)).map(normalizePosition))];
        if (!name || name.length > 150) throw new Error('Missing or invalid player name');
        if (!source || !validDate(sourceDate)) throw new Error('Source and valid YYYY-MM-DD date required');
        if (!positions.length || positions.some(p => !POSITIONS.includes(p))) throw new Error('Unsupported player position');
        const projections = {};
        for (const key of STAT_KEYS) {
          const value = number(row[key] ?? row.projections?.[key], key);
          if (value !== null) { if (value < 0) throw new Error(`Negative ${key}`); projections[key] = value; }
        }
        const team = normalizeTeam(row.team) || null;
        const identity = `${normalizeName(name)}|${team || ''}|${[...positions].sort().join(',')}`;
        const yahooId = row.yahooId ? String(row.yahooId).trim() : null;
        const espnId = row.espnId ? String(row.espnId).trim() : null;
        const keys = [`name:${identity}`, ...(yahooId ? [`yahoo:${yahooId}`] : []), ...(espnId ? [`espn:${espnId}`] : [])];
        if (keys.some(k => seen.has(k))) throw new Error('Duplicate player identity or site ID');
        const byeWeek=number(row.byeWeek,'bye week',true);
        if(byeWeek!==null&&(!Number.isInteger(byeWeek)||byeWeek>18))throw new Error('Invalid bye week');
        const player = { byeWeek,key: `research:${identity}`, name, positions, team, yahooId, espnId,
          rank: number(row.rank, 'rank', true), tier: number(row.tier, 'tier', true), adp: number(row.adp, 'ADP', true),
          projections: Object.keys(projections).length ? projections : null,
          projectedPoints: number(row.projectedPoints, 'projected points'), scoringBasis: row.scoringBasis || defaults.scoringBasis || null,
          source, sourceDate, injury: row.injury ? String(row.injury).slice(0,200) : null,
          season:number(row.season??defaults.season,'research season',true),rankBasis:String(row.rankBasis||defaults.rankBasis||''),
          notes: (Array.isArray(row.notes) ? row.notes : [row.notes || '']).filter(Boolean).map(String),
          tags:[...new Set((Array.isArray(row.tags)?row.tags:String(row.tags||'').split(/[|,;]/)).map(x=>String(x).trim().toLowerCase()).filter(Boolean))],
          evidence:String(row.evidence||''),rationale:String(row.rationale||''),uncertainty:String(row.uncertainty||''),
          targetRoundMin:number(row.targetRoundMin,'minimum target round',true),targetRoundMax:number(row.targetRoundMax,'maximum target round',true),
          researchFlag:String(row.researchFlag||'').trim().toUpperCase() };
        Object.assign(player,{targetPickMin:number(row.targetPickMin,'minimum target pick',true),targetPickMax:number(row.targetPickMax,'maximum target pick',true),
          priceLabel:String(row.priceLabel||''),tierLabel:String(row.tierLabel||''),positionRank:number(row.positionRank,'position rank',true),
          lateOnly:row.lateOnly===true,researchAvoid:row.researchAvoid===true,projectionPartial:row.projectionPartial===true,
          projectionScope:String(row.projectionScope||''),projectionSource:String(row.projectionSource||''),referenceComponentPoints:number(row.referenceComponentPoints,'reference component points'),
          actualStats:row.actualStats||null,historicalDiagnostic:row.historicalDiagnostic||null,market:row.market||null,sourceRefs:Array.isArray(row.sourceRefs)?row.sourceRefs:[],sourceUrl:String(row.sourceUrl||'')});
        if(player.notes.some(x=>x.length>20000)||[player.evidence,player.rationale,player.uncertainty].some(x=>x.length>50000))throw new Error('Research text exceeds per-player limit; import longer guide text separately');
        if(player.targetRoundMin!==null&&player.targetRoundMax!==null&&player.targetRoundMin>player.targetRoundMax)throw new Error('Research target-round range is reversed');
        if(player.targetPickMin!==null&&player.targetPickMax!==null&&player.targetPickMin>player.targetPickMax)throw new Error('Research target-pick range is reversed');
        if (player.rank === null && player.tier === null && !player.projections && player.projectedPoints === null && !player.notes.length && !player.evidence && !player.rationale) throw new Error('Rank, tier, projections or substantive research notes required');
        keys.forEach(k => seen.add(k)); players.push(player);
      } catch (error) { errors.push(`Row ${index+1}: ${error.message}`); }
    });
  } catch (error) { errors.push(error.message); }
  return { players, errors, context };
}

function namesAgree(a, b) {
  const clean=value=>normalizeName(value).replace(/\s+(jr|sr|ii|iii|iv)$/,'');
  const x = clean(a).split(' '), y = clean(b).split(' ');
  if (x.join(' ') === y.join(' ')) return true;
  const abbreviated=(short,full)=>short[0]?.length===1&&short.length>1&&short[0]===full[0]?.[0]&&short.slice(1).join(' ')===full.slice(-(short.length-1)).join(' ');
  return abbreviated(x,y)||abbreviated(y,x);
}
export function matchResearch(research, sitePlayers) {
  const candidates = research.map(r => ({ r, matches: sitePlayers.filter(p => {
    const site = p.site || p.key?.split(':')[0];
    const id = r[`${site}Id`];
    if (id && p.siteId && String(id) !== String(p.siteId)) return false;
    const sameDefense=r.positions.includes('DST')&&p.positions.includes('DST')&&r.team&&normalizeTeam(r.team)===normalizeTeam(p.team);
    const identity = (namesAgree(r.name, p.name)||sameDefense) && r.positions.some(pos => p.positions.includes(pos));
    return identity && (id && p.siteId ? true : r.team ? normalizeTeam(r.team) === normalizeTeam(p.team) : normalizeName(r.name)===normalizeName(p.name));
  }) }));
  const matched = [], unresolved = [];
  for (const { r, matches } of candidates) {
    if (matches.length !== 1 || candidates.filter(c => c.matches.some(p => p.key === matches[0]?.key)).length !== 1) {
      unresolved.push({ player: r, reason: matches.length ? 'Ambiguous player match' : 'No verified site match' }); continue;
    }
    const site = matches[0];
    matched.push({ ...site, ...r, key: site.key, siteId: site.siteId, site: site.site || site.key.split(':')[0],
      byeWeek:r.byeWeek??site.byeWeek??null,rank:r.rank??site.rank,researchRank:r.rank,adp:r.adp??site.adp,adpSource:r.adp!=null?r.source:site.source,team:r.team||site.team,
      name: r.name, injury: site.injury || r.injury, researchKey: r.key, researchMatched: true });
  }
  return { matched, unresolved };
}
