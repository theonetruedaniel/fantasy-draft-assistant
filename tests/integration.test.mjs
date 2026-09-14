import baseTest from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM}from'jsdom';
import {readYahoo}from'../extension/readers/yahoo.js';import {readEspn}from'../extension/readers/espn.js';
import {reconcile}from'../extension/core/state.js';import {recommend}from'../extension/core/recommend.js';import{defaultProfile}from'../extension/core/contracts.js';
const hasCaptures=fs.existsSync('work/fixtures/capture-metadata.json');
const test=(name,fn)=>baseTest(name,{skip:!hasCaptures},fn);
const meta=hasCaptures?JSON.parse(fs.readFileSync('work/fixtures/capture-metadata.json','utf8')):null;
for(const [site,reader]of[['yahoo',readYahoo],['espn',readEspn]])test(`captured ${site} flows through state to five safe local recommendations`,()=>{
 const d=new JSDOM(fs.readFileSync(`work/fixtures/${site}-live-2.html`,'utf8'),{url:meta[site].url}).window.document;
 const now=Date.now(),s=reader(d,{tabId:1,readAt:now}),profile=defaultProfile();
 const state=reconcile(null,s,profile,0),advice=recommend(state,[],profile,now);
 assert.equal(advice.choices.length,5,advice.warnings.join('; '));
 assert.ok(advice.teamNeeds);
 const taken=new Set(state.picks.map(p=>p.playerKey));
 assert.ok(advice.choices.every(p=>state.availableKeys.includes(p.playerKey)&&!taken.has(p.playerKey)));
 assert.equal(advice.coverage,'visible-only');
 const heartbeat=reconcile(state,reader(d,{tabId:1,readAt:now+1}),profile,0);
 assert.equal(heartbeat.contextKey,state.contextKey,'Recommendation explanations must not mutate the observed board and trigger repeated AI calls');
});
