import { blankSnapshot,text,numeric,makePlayer,STAT_TITLES,completeHistory,dedupePlayers } from './common.js';
import { normalizeName } from '../core/contracts.js';

function playerNode(node,known) {
  const nameNode=node.querySelector('.playerinfo__playername');
  if(!nameNode) return null;
  // The row action publishes a stable player ID even before lazy headshots
  // load. Read the attribute only; never invoke the action.
  const actionId=node.querySelector('[data-player-id]')?.getAttribute('data-player-id');
  const id=actionId&&/^\d+$/.test(actionId)?actionId:[...node.querySelectorAll('img')].map(img=>img.getAttribute('src')?.match(/headshots\/nfl\/players\/full\/(\d+)\.png/)?.[1]).find(Boolean)||null;
  return makePlayer('espn',{id,name:nameNode.querySelector('a[title]')?.title||text(nameNode),
    team:text(node.querySelector('.playerinfo__playerteam')),position:text(node.querySelector('.playerinfo__playerpos')),
    injury:node.querySelector('.playerinfo__injurystatus')?.getAttribute('title')||text(node.querySelector('.playerinfo__injurystatus'))||null},known);
}
export function readEspn(document,metadata={}) {
  const s=blankSnapshot('espn',document,metadata),url=new URL(s.url);
  const clock=document.querySelector('[data-testid="clock"]'),current=document.querySelector('[data-testid="current-pick"]');
  if(!clock||!url.pathname.includes('/football/draft')||!url.searchParams.get('leagueId')) return {...s,coverage:'unsafe',errors:['ESPN draft room not found']};
  s.draftId=`espn:${url.searchParams.get('leagueId')}:${url.searchParams.get('seasonId')||'unknown-season'}`;
  s.readerVersion=2;
  s.ownTeamId=url.searchParams.get('teamId');
  const options=[...document.querySelectorAll('.roster__dropdown option')];
  const teamMap=new Map(options.map(n=>[text(n),n.value]));
  s.observedTeams=options.length;
  const signature=text(current),pick=signature.match(/Pick (\d+)/i);
  s.currentOverall=pick?Number(pick[1]):null;s.status=pick?'drafting':'waiting';
  if([...document.querySelectorAll('h1,h2,h3')].some(n=>/^(Your )?Draft (is )?Complete!?$/i.test(text(n))))s.status='complete';
  s.clock=text(clock.querySelector('.clock__digits'));
  s.currentTeamId=teamMap.get(text(current?.querySelector('.team-name')))||null;
  const ownPick=text(document.querySelector('.own-pick .pick-number')).match(/PICK (\d+)/i);
  if(ownPick&&s.observedTeams) {
    const n=Number(ownPick[1]),round=Math.floor((n-1)/s.observedTeams)+1,inRound=(n-1)%s.observedTeams+1;
    s.observedSlot=round%2?inRound:s.observedTeams+1-inRound;
  }
  const known=metadata.knownPlayers||[];
  for(const node of document.querySelectorAll('.pick-message__container')) {
    const p=playerNode(node,known),info=node.querySelector('.pick-info'),parts=text(info).match(/R(\d+),\s*P(\d+)/i);
    const teamId=teamMap.get(text(info?.querySelector('span')).replace(/^[-–]\s*/,''));
    if(p) s.players.push(p);
    if(p&&parts&&teamId&&s.observedTeams) s.picks.push({overall:(Number(parts[1])-1)*s.observedTeams+Number(parts[2]),playerKey:p.key,teamId});
    else s.warnings.push('Unresolved ESPN pick-feed entry');
  }
  s.picks=[...new Map(s.picks.map(p=>[p.overall,p])).values()].sort((a,b)=>a.overall-b.overall);
  s.historyComplete=completeHistory(s.picks,s.currentOverall);
  s.authoritativeHistory=s.historyComplete;
  if(s.historyComplete) {
    for(const option of options) s.rosters[option.value]=[];
    for(const pick of s.picks) s.rosters[pick.teamId].push(pick.playerKey);
  }
  const selectedTab=text(document.querySelector('[role="tab"][aria-selected="true"]'));
  const grid=document.querySelector('.draft-players [role="grid"]'),toggle=document.querySelector('.draft-players-toggle input');
  const showDrafted=metadata.showDrafted??toggle?.checked;
  s.filters.push(`showDrafted=${showDrafted}`);
  for(const select of document.querySelectorAll('.draft-players select.dropdown__select:not([aria-hidden="true"])')) s.filters.push(`${text(select.selectedOptions[0])}=${select.value}`);
  const headers=[...(grid?.querySelectorAll('[role="columnheader"]')||[])];
  const taken=new Set(s.picks.map(p=>p.playerKey));
  for(const row of grid?.querySelectorAll('[role="row"]')||[]) {
    const p=playerNode(row,[...known,...s.players]);if(!p)continue;
    const cells=[...row.querySelectorAll('[role="gridcell"]')],projections={};
    headers.forEach((h,i)=>{
      const label=text(h),value=numeric(text(cells[i])),title=h.querySelector('[title]')?.title||h.title||'';
      if(/^bye$/i.test(label))p.byeWeek=Number.isInteger(value)&&value>=1&&value<=18?value:null;
      if(label==='RK')p.rank=value;
      if(label==='FPTS')p.projectedPoints=value;
      if(STAT_TITLES[title]&&value!==null)projections[STAT_TITLES[title]]=value;
    });
    p.projections=Object.keys(projections).length?projections:null;s.players.push(p);
    if(selectedTab==='Players'&&showDrafted===false&&!taken.has(p.key))s.availableKeys.push(p.key);
  }
  s.players=dedupePlayers(s.players);
  // Live select.value is authoritative for selection, but serialized HTML may omit
  // it. Cross-check membership against pick history before trusting the table.
  const selectedId=metadata.selectedRosterTeamId||document.querySelector('.roster__dropdown select')?.value;
  if(selectedId&&!s.historyComplete) {
    const rows=[...document.querySelectorAll('.roster-module tbody tr')],keys=[];let valid=rows.length>0;
    for(const row of rows) {
      const name=row.querySelector('.player-column[title]')?.title;
      if(!name)continue;
      const matches=s.players.filter(p=>normalizeName(p.name)===normalizeName(name));
      if(matches.length===1&&!s.picks.some(p=>p.playerKey===matches[0].key&&p.teamId!==selectedId))keys.push(matches[0].key);
      else valid=false;
    }
    if(valid)s.rosters[selectedId]=keys;
  }
  if(showDrafted!==false)s.warnings.push('Show Drafted must be off to confirm visible availability');
  if(selectedTab!=='Players')s.warnings.push('Open Players to refresh available choices');
  s.warnings.push(`ESPN virtualized list: ${s.availableKeys.length} available rows mounted; ${grid?.getAttribute('aria-rowcount')||'unknown'} declared rows`);
  if(!s.currentOverall&&s.status!=='complete')s.errors.push('ESPN current pick unreadable');
  if(text(current)!==signature)s.errors.push('ESPN pick changed during scan');
  if(s.errors.length)s.coverage='unsafe';
  return s;
}
