import baseTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readYahoo } from '../extension/readers/yahoo.js';
import { readEspn } from '../extension/readers/espn.js';
import {reconcile} from '../extension/core/state.js';
import {recommend} from '../extension/core/recommend.js';
import {defaultProfile} from '../extension/core/contracts.js';
const hasCaptures=fs.existsSync('work/fixtures/capture-metadata.json');
const test=(name,fn)=>baseTest(name,{skip:!hasCaptures},fn);
const manifest = hasCaptures?JSON.parse(fs.readFileSync('work/fixtures/capture-metadata.json','utf8')):null;
function capture(file,site) {
  const entry = manifest.files.find(x => x.file === file && !x.truncated);
  assert.ok(entry, 'Only verified complete captures enter reader tests');
  const html = fs.readFileSync(`work/fixtures/${file}`,'utf8');
  assert.equal(html.length,entry.chars);
  return new JSDOM(html,{url:manifest[site].url}).window.document;
}
test('captured Yahoo reads header-mapped projections and a limited player pool', () => {
  const d = capture('yahoo-live-2.html','yahoo');
  const s = readYahoo(d,{tabId:1,readAt:1000});
  assert.equal(s.currentOverall,7);
  assert.equal(s.ownTeamId,'10');
  assert.equal(s.observedSlot,10);
  assert.equal(s.availableKeys.length,100);
  assert.equal(s.coverage,'visible-only');
  const p = s.players.find(p=>p.key==='yahoo:40041');
  assert.equal(p.projectedPoints,261.43);
  assert.equal(p.projections.receptions,108);
  assert.equal(p.projections.receivingYards,1495);
  assert.equal(p.scoringBasis,null);
  assert.match(p.rankBasis,/standard scoring/);
  assert.deepEqual(s.rosters['10'],[]);
});
test('captured Yahoo round history extracts explicit overall picks, not selected opponent as own', () => {
  const s = readYahoo(capture('yahoo-round-history.html','yahoo'),{tabId:1,readAt:2000});
  assert.equal(s.currentOverall,3);
  assert.deepEqual(s.picks.sort((a,b)=>a.overall-b.overall).map(x=>[x.overall,x.playerKey,x.teamId]),[[1,'yahoo:40059','1'],[2,'yahoo:40055','2']]);
  assert.equal(s.authoritativeHistory,true);
  assert.deepEqual(s.availableKeys,[]);
  assert.deepEqual(s.rosters['10'],[]);
});
test('synthetic mutation of captured Yahoo disables positive availability and maps reordered columns', () => {
  const d=capture('yahoo-live-2.html','yahoo');
  const row=d.querySelector('.ys-player[data-i13n-module="player-list"]').closest('tr');
  row.querySelector('.ys-addqueue button').disabled=true;
  const s=readYahoo(d,{tabId:1,readAt:1000});
  assert.ok(!s.availableKeys.includes('yahoo:40041'));
  assert.equal(s.players.find(p=>p.key==='yahoo:40041').projections.receptions,108);
});
test('captured ESPN reads within-round feed numbers and reconstructs own roster', () => {
  const s=readEspn(capture('espn-live-2.html','espn'),{tabId:2,readAt:1000});
  assert.equal(s.currentOverall,69);
  assert.equal(s.ownTeamId,'3');
  assert.equal(s.observedSlot,10);
  assert.equal(s.picks.length,68);
  assert.equal(s.picks.at(-1).overall,68);
  assert.equal(s.picks.at(-1).teamId,'8');
  assert.equal(s.rosters['3'].length,6);
  assert.equal(s.availableKeys.length,14);
  const p=s.players.find(p=>p.key==='espn:4871023');
  assert.equal(p.name,'Carnell Tate');
  assert.equal(p.rank,61);
  assert.equal(p.projectedPoints,202.2);
  assert.equal(p.projections.receptions,undefined);
  assert.equal(s.coverage,'visible-only');
});
test('captured ESPN defenses use a stable separate team identity', () => {
  const s=readEspn(capture('espn-live-3.html','espn'),{tabId:2,readAt:1000});
  assert.equal(s.currentOverall,147);
  assert.ok(s.players.some(p=>p.key==='espn:dst:CLE'&&p.positions[0]==='DST'));
});
test('synthetic show-drafted toggle change cannot expose taken players as choices', () => {
  const d=capture('espn-live-2.html','espn');
  d.querySelector('.draft-players-toggle input').checked=true;
  const s=readEspn(d,{tabId:2,readAt:1000});
  assert.equal(s.availableKeys.length,0);
  assert.ok(s.warnings.some(x=>/Show Drafted/iy.test(x)));
});
test('missing draft root is an explicit reader error for both sites', () => {
  const d=new JSDOM('<p>Lobby</p>',{url:'https://example.test/'}).window.document;
  assert.equal(readYahoo(d,{tabId:1,readAt:1000}).coverage,'unsafe');
  assert.equal(readEspn(d,{tabId:1,readAt:1000}).coverage,'unsafe');
});

test('captured Yahoo late round uses overall pick, scoped roster and no unnumbered banner history',()=>{
 const d=new JSDOM(fs.readFileSync('work/fixtures/yahoo-history-conflict/draft-root.html','utf8'),{url:'https://football.fantasysports.yahoo.com/draftclient/f1/11054210/2'}).window.document;
 const s=readYahoo(d,{tabId:1,readAt:1000});
 const label=[...d.querySelectorAll('span')].find(n=>!n.children.length&&/Round \d+, Pick \d+/.test(n.textContent));
 const pick=Number(label.textContent.match(/Pick (\d+)/)[1]);
 assert.ok(pick>100);assert.equal(s.currentOverall,pick);assert.equal(s.observedSlot,2);assert.equal(s.observedTeams,10);
 assert.deepEqual(s.picks,[]);assert.ok(s.rosters['2'].length>=11);assert.equal(s.availableKeys.length,100);
 const profile={...defaultProfile(),slot:2},state=reconcile(null,s,profile);
 assert.equal(state.conflict,false);assert.equal(recommend(state,[],profile,1000).choices.length,5);
 // Synthetic staggered update: current turn changes before Last. No false pick.
 label.textContent=label.textContent.replace(/Round \d+, Pick \d+/,`Round ${Math.ceil((pick+1)/10)}, Pick ${pick+1}`);
 const next=reconcile(state,readYahoo(d,{tabId:1,readAt:2000,knownPlayers:s.players}),profile);
 assert.equal(next.conflict,false);assert.deepEqual(next.picks,[]);
});

test('exact Yahoo before/own/after action fragments preserve availability in a synthetic slot-two room',()=>{
 const fixtureMeta=JSON.parse(fs.readFileSync('work/fixtures/yahoo-own-turn/README.json'));
 let prior;
 for(const [i,file]of ['before','own-turn','after'].entries()){
  const fragment=fs.readFileSync(`work/fixtures/yahoo-own-turn/${file}.html`,'utf8');
  const d=new JSDOM(`<div id="render-target-default"><span>Round 1, Pick ${i+1}</span><span>YOUR TEAM (0/15)</span><div>${Array.from({length:10},(_,j)=>`<div class="ys-team" data-id="${j+1}">Team ${j+1}</div>`).join('')}</div><button id="players" aria-selected="true"></button>${fragment}</div>`,{url:fixtureMeta.source}).window.document;
  // Fixture is one exact row; surrounding room state is explicitly synthetic.
  const s=readYahoo(d,{tabId:1,readAt:1000+i});
  assert.equal(s.observedSlot,2);assert.equal(s.availableKeys.length,1,file);
  prior=reconcile(prior,s,{...defaultProfile(),slot:2});assert.equal(prior.conflict,false);
  if(file==='own-turn'){
   d.querySelector('tbody button').disabled=true;
   assert.equal(readYahoo(d,{tabId:1,readAt:2000}).availableKeys.length,0);
  }
 }
});

test('captured live ESPN action IDs remain stable when lazy headshots change',()=>{
 const captured=JSON.parse(fs.readFileSync('work/evidence/live-extension/espn-rows.json'));
 const d=capture('espn-live-2.html','espn'),grid=d.querySelector('.draft-players [role="grid"]');
 grid.innerHTML=captured.map(r=>r.html).join('');
 const original=readEspn(d,{tabId:1,readAt:1000});
 const before=original.players.find(p=>p.name==='Davante Adams');assert.equal(before.key,'espn:16800');
 const row=[...grid.querySelectorAll('[role="row"]')].find(r=>r.textContent.includes('Davante Adams'));
 for(const img of row.querySelectorAll('img'))img.setAttribute('src','https://example.test/lazy-placeholder.png');
 const next=readEspn(d,{tabId:1,readAt:2000,knownPlayers:original.players});
 assert.equal(next.players.find(p=>p.name==='Davante Adams').key,before.key);
 assert.equal(row.querySelector('[data-player-id]').getAttribute('data-player-id'),'16800');
});

test('captured ESPN completed draft and synthetic Yahoo terminal marker are recognized',()=>{
 const d=new JSDOM(fs.readFileSync('work/evidence/live-extension/espn-completed-main.PRIVATE.html','utf8'),{url:manifest.espn.url}).window.document;
 const completed=readEspn(d,{tabId:2,readAt:1000});assert.equal(completed.status,'complete');assert.ok(!completed.errors.some(e=>/pick unreadable/.test(e)));
 const yahoo=capture('yahoo-live-2.html','yahoo');
 const label=[...yahoo.querySelectorAll('span')].find(n=>!n.children.length&&/Round \d+, Pick \d+/.test(n.textContent));label.textContent='Draft Complete!';
 const ys=readYahoo(yahoo,{tabId:1,readAt:1000});assert.equal(ys.status,'complete');assert.ok(!ys.errors.some(e=>/pick unreadable/.test(e)));
});
