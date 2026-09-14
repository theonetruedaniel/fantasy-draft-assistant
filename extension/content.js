import { readYahoo } from './readers/yahoo.js';
import { readEspn } from './readers/espn.js';
const reader=location.hostname==='fantasy.espn.com'?readEspn:readYahoo;
let timer=null,knownPlayers=[],lastScan=0,stopped=false;
function scan() {
  timer=null;if(stopped)return;
  const started=performance.now();
  try {
    const snapshot=reader(document,{readAt:Date.now(),url:location.href,knownPlayers});
    knownPlayers=snapshot.players;
    snapshot.timing={scanMs:performance.now()-started,observedAt:Date.now()};
    chrome.runtime.sendMessage({type:'DRAFT_SNAPSHOT',snapshot}).catch(()=>{stopped=true;observer.disconnect();clearInterval(heartbeat);});
  } catch(error) {
    chrome.runtime.sendMessage({type:'READER_ERROR',message:String(error.message).slice(0,200)}).catch(()=>{});
  }
  lastScan=performance.now();
}
function schedule() {if(!timer&&!stopped)timer=setTimeout(scan,Math.max(100,200-(performance.now()-lastScan)));}
const observer=new MutationObserver(schedule);
observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-selected','disabled','checked','value']});
const heartbeat=setInterval(schedule,1000);
document.addEventListener('change',schedule,true);
scan();
