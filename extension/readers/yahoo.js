import { blankSnapshot, text, numeric, makePlayer, STAT_TITLES, completeHistory, dedupePlayers } from './common.js';

function playerNode(node,known) {
  if(!node) return null;
  const abbr=[...node.querySelectorAll('abbr')];
  const injury=[...node.querySelectorAll('[title]')].find(n=>/^(Questionable|Doubtful|Out|Injured Reserve|Suspended)/i.test(n.getAttribute('title')));
  const name=node.querySelector('img[title]')?.title;
  const defenses={Rams:'LAR',Seahawks:'SEA',Texans:'HOU',Broncos:'DEN',Vikings:'MIN',Eagles:'PHI',Chargers:'LAC',Jaguars:'JAX',Patriots:'NE',Steelers:'PIT',Lions:'DET',Chiefs:'KC',Bills:'BUF',Dolphins:'MIA',Jets:'NYJ',Ravens:'BAL',Bengals:'CIN',Browns:'CLE',Colts:'IND',Titans:'TEN',Raiders:'LV',Cowboys:'DAL',Giants:'NYG',Commanders:'WAS',Bears:'CHI',Packers:'GB',Falcons:'ATL',Panthers:'CAR',Saints:'NO',Buccaneers:'TB',Cardinals:'ARI','49ers':'SF'};
  return makePlayer('yahoo',{id:node.dataset.id || null,name,
    position:text(abbr[0]),team:text(abbr[0])==='DEF'?defenses[name]||null:text(abbr[1]),injury:injury?.getAttribute('title')||null},known);
}
export function readYahoo(document,metadata={}) {
  const s=blankSnapshot('yahoo',document,metadata),root=document.querySelector('#render-target-default');
  const url=new URL(s.url);
  const route=url.pathname.match(/^\/draftclient\/f1\/(\d+)\/(\d+)/);
  if(!root||!route) return {...s,coverage:'unsafe',errors:['Yahoo draft room not found']};
  s.draftId=`yahoo:${route[1]}`;s.ownTeamId=route[2];
  s.readerVersion=2;
  const teams=[...root.querySelectorAll('.ys-team[data-id]')];
  const teamMap=new Map(teams.map(n=>[text(n),n.dataset.id]));
  const teamOrder=[...new Set(teams.map(n=>n.dataset.id))];
  s.observedTeams=teamOrder.length;s.observedSlot=teamOrder.indexOf(s.ownTeamId)+1||null;
  const statusNode=[...root.querySelectorAll('span')].find(n=>!n.children.length&&/Round \d+, Pick \d+/.test(text(n)));
  const signature=text(statusNode),turn=signature.match(/Round (\d+), Pick (\d+)/);
  s.status=turn?'drafting':/Draft Starting Soon/.test(root.textContent)?'waiting':'unknown';
  if([...root.querySelectorAll('h1,h2,h3,span')].some(n=>!n.children.length&&/^(Your )?Draft (is )?Complete!?$/i.test(text(n))))s.status='complete';
  // Yahoo labels the overall number as Pick (ESPN's feed uses within-round).
  s.currentOverall=turn ? Number(turn[2]) : s.status==='waiting'?1:null;
  if(turn&&s.observedTeams&&Math.ceil(s.currentOverall/s.observedTeams)!==Number(turn[1]))s.errors.push('Yahoo round and overall pick are updating; waiting for a consistent read');
  s.currentTeamId=root.querySelector('.ys-draftorder-current .ys-team')?.dataset.id||null;
  s.clock=text([...root.querySelectorAll('span')].find(n=>!n.children.length&&/^\d\d:\d\d$/.test(text(n))));
  const known=metadata.knownPlayers||[];
  s.players=[...root.querySelectorAll('.ys-player[data-id]')].map(n=>playerNode(n,known)).filter(Boolean);
  const ownLabel=[...root.querySelectorAll('span')].find(n=>!n.children.length&&/^YOUR TEAM \(/.test(text(n)));
  if(ownLabel) {
    const count=Number(text(ownLabel).match(/\((\d+)/)?.[1]);
    const ownPlayers=[...ownLabel.parentElement.querySelectorAll('.ys-player[data-id]')].map(n=>playerNode(n,known)).filter(Boolean);
    if(ownPlayers.length===count) s.rosters[s.ownTeamId]=ownPlayers.map(p=>p.key);
    else s.warnings.push('Own roster count does not match readable players');
  }
  for(const select of root.querySelectorAll('select[id]')) s.filters.push(`${select.id}=${select.value}`);
  if(root.querySelector('#search')?.value) s.filters.push(`search=${root.querySelector('#search').value}`);
  const playersTab=root.querySelector('#players[aria-selected="true"]');
  const statMode=root.querySelector('#stat-mode-filter')?.value;
  s.season=Number(root.querySelector('#stat-mode-filter option:checked')?.textContent.match(/20\d{2}/)?.[0])||null;
  if(playersTab) for(const table of root.querySelectorAll('table')) {
    const headers=[...table.querySelectorAll('thead th')];
    if(!headers.some(h=>h.dataset.id==='fname')) continue;
    for(const row of table.querySelectorAll('tbody tr')) {
      const node=row.querySelector('.ys-player[data-i13n-module="player-list"]'),p=playerNode(node,known);
      if(!p) continue;
      const cells=[...row.children],projections={};
      headers.forEach((h,i)=>{
        const value=numeric(text(cells[i])),id=h.dataset.id||'',title=h.title||'';
        if(/^(bye|bye week)$/i.test(title)||id==='bye')p.byeWeek=Number.isInteger(value)&&value>=1&&value<=18?value:null;
        if(id.startsWith('expert_ranks:')) {p.rank=value;p.rankBasis=title;}
        if(/average.*pick|adp/i.test(id)) p.adp=value;
        if(id==='values:projected:points') p.projectedPoints=value;
        if(STAT_TITLES[title]&&statMode==='projected'&&value!==null) projections[STAT_TITLES[title]]=value;
      });
      p.projections=Object.keys(projections).length?projections:null;
      s.players.push(p);
      // Read-only evidence: Yahoo replaces the queue star with Draft on our turn.
      const actionCell=cells[headers.findIndex(h=>h.dataset.id==='draft-action')];
      const draftEnabled=[...(actionCell?.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')||[])].some(b=>text(b)==='Draft');
      if(row.querySelector('.ys-addqueue button:not([disabled]):not([aria-disabled="true"])')||draftEnabled) s.availableKeys.push(p.key);
    }
  }
  for(const table of root.querySelectorAll('table')) {
    const headers=[...table.querySelectorAll('thead th')].map(h=>h.dataset.id);
    const pickIndex=headers.indexOf('pick'),teamIndex=headers.indexOf('team');
    if(pickIndex<0||teamIndex<0) continue;
    for(const row of table.querySelectorAll('tbody tr')) {
      const p=playerNode(row.querySelector('.ys-player'),known),cells=[...row.children];
      const overall=numeric(text(cells[pickIndex])),teamId=teamMap.get(text(cells[teamIndex]));
      if(p&&overall&&teamId) s.picks.push({overall,playerKey:p.key,teamId});
    }
  }
  // The Last banner has no pick number and can update separately from the turn.
  // Pairing it with currentOverall-1 invents a numbered event during transitions.
  // Only the explicitly numbered history table supplies pick events.
  s.players=dedupePlayers(s.players);s.availableKeys=[...new Set(s.availableKeys)];
  s.authoritativeHistory=!!root.querySelector('[data-id="round"][aria-selected="true"]')&&completeHistory(s.picks,s.currentOverall);
  s.historyComplete=completeHistory(s.picks,s.currentOverall);
  s.warnings.push('Yahoo mounted rows only; full pool unverified','Yahoo XRank may use standard scoring; see source basis');
  if(!playersTab) s.warnings.push('Open Players to refresh available choices');
  if(!s.currentOverall&&s.status!=='complete') s.errors.push('Yahoo current pick unreadable');
  if(text(statusNode)!==signature) s.errors.push('Yahoo pick changed during scan');
  if(s.errors.length)s.coverage='unsafe';
  return s;
}
