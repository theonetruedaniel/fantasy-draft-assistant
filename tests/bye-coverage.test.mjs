import test from 'node:test';import assert from 'node:assert/strict';
import {recommend,byeCoverage,byeFit} from '../extension/core/recommend.js';
import {parseResearch,matchResearch} from '../extension/core/import.js';
const profile={teams:10,slot:1,bench:5,confirmed:true,starterSlots:[['RB'],['RB']],pointsPer:{receptions:1}};
const player=(key,byeWeek,rank=82)=>({key,name:key,team:'BUF',positions:['RB'],rank,tier:5,byeWeek,source:'test',sourceDate:'2026-09-06',notes:[]});
const roster=[player('own1',7),player('own2',7)];
function advice(a,b){const players=[...roster,a,b];return recommend({site:'yahoo',draftId:'test',readAt:1000,currentOverall:90,ownTeamId:'1',players,availableKeys:[a.key,b.key],rosters:{'1':roster.map(p=>p.key)},picks:[],errors:[],coverage:'visible-only',contextKey:'test'},[a,b],profile,1001);}
test('comparable backup covers two-RB bye shortage, without banning stronger same-bye value',()=>{
 const same=player('same',7,81),other=player('other',9,82);
 assert.equal(advice(same,other).choices[0].playerKey,'other');
 assert.equal(advice({...same,rank:50,tier:3},other).choices[0].playerKey,'same');
 assert.match(advice(same,other).choices.find(p=>p.playerKey==='same').byeFit.message,/injury or upside/);
 assert.equal(byeCoverage(roster,profile).weeks[0].missing,2);
});
test('unknown byes do not receive a ranking penalty or count as verified conflicts',()=>{
 const unknown=player('unknown',null,81),other=player('other',9,82);
 assert.equal(advice(unknown,other).choices[0].playerKey,'unknown');
 assert.equal(byeFit(unknown,roster,profile).gain,0);
 assert.equal(byeCoverage([unknown],profile).weeks.length,0);
});
test('multi-starter and flex coverage uses unique eligible players across all slots',()=>{
 const p={...profile,starterSlots:[['RB'],['RB'],['WR'],['WR'],['RB','WR','TE']]};
 const own=[...roster,{...player('w1',8),positions:['WR']},{...player('w2',8),positions:['WR']},{...player('te',10),positions:['TE']}];
 assert.equal(byeCoverage(own,p).weeks.find(w=>w.week===7).missing,2);
 assert.equal(byeFit(player('backup',9),own,p).gain,2);
 assert.equal(byeFit({...player('qb',9),positions:['QB']},own,p).gain,0);
});
test('verified site bye survives research without history; invalid imported byes reject',()=>{
 const raw={name:'Example',position:'RB',team:'BUF',rank:81,source:'test',sourceDate:'2026-09-06'};
 const r=parseResearch(JSON.stringify([raw]),'json');assert.equal(r.errors.length,0);
 assert.equal(matchResearch(r.players,[{...player('site',7),name:'Example'}]).matched[0].byeWeek,7);
 assert.match(parseResearch(JSON.stringify([{...raw,byeWeek:22}]),'json').errors[0],/bye week/);
});
