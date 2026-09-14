// Presentation only: source values and advice are never changed or reordered.
export function cardSummary(choice,needs) {
  const actual=choice.historicalDiagnostic;
  let actualStats=null;
  const number=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
  let year=null;
  try{year=new URL(actual?.source_url).searchParams.get('year');}catch{}
  if(actual&&/^\d{4}$/.test(year||'')){
    const values=[actual.receptions,actual.yards,actual.td].map(number);
    if(values.every(v=>v!==null))actualStats=`${year} actual receiving: ${values[0].toLocaleString('en-US')} catches Â· ${values[1].toLocaleString('en-US')} yards Â· ${values[2].toLocaleString('en-US')} TDs`;
  }
  const history=choice.actualStats;
  if(history?.seasonType==='REG'&&Number.isInteger(history.season)&&history.sourceUrl&&history.stats){
    const stats=history.stats,parts=[],fmt=v=>Number(v).toLocaleString('en-US');
    const valid=keys=>keys.every(k=>stats[k]!==null&&stats[k]!==undefined&&stats[k]!==''&&Number.isFinite(Number(stats[k])));
    if(choice.positions?.includes('QB')&&valid(['passing_yards','passing_tds','passing_interceptions']))parts.push(`${fmt(stats.passing_yards)} pass yd · ${fmt(stats.passing_tds)} pass TD · ${fmt(stats.passing_interceptions)} INT`);
    if((choice.positions?.some(p=>['QB','RB'].includes(p))||Number(stats.carries)>0)&&valid(['rushing_yards','rushing_tds']))parts.push(`${fmt(stats.rushing_yards)} rush yd · ${fmt(stats.rushing_tds)} rush TD`);
    if(choice.positions?.some(p=>['RB','WR','TE'].includes(p))&&valid(['receptions','receiving_yards','receiving_tds']))parts.push(`${fmt(stats.receptions)} catches · ${fmt(stats.receiving_yards)} rec yd · ${fmt(stats.receiving_tds)} rec TD`);
    if(parts.length)actualStats=`${history.season} actual regular season: ${parts.join(' | ')}`;
  }
  const note=String(choice.rationale||'').trim();
  const first=note.match(/^.*?[.!?](?=\s|$)/)?.[0]||note;
  const playerNote=first?first.replace(/[.!?]+$/,'')+'.':'';
  const holes=needs?.unfilled||[];
  const positions=choice.positions||[];
  const specific=holes.find(slot=>positions.includes(slot));
  const flex=holes.some(slot=>slot.startsWith('FLEX')&&positions.some(pos=>slot.includes(pos)));
  let situation;
  if(specific)situation=`You still need a starting ${specific}, so this pick helps fill that spot`;
  else if(flex)situation='This pick can fill your open flex spot';
  else if(needs)situation='Your starting spots at this position are covered, so consider this pick for depth';
  else situation='Compare this player with your remaining roster needs';
  if(choice.byeFit?.message)situation+=`; ${choice.byeFit.message.charAt(0).toLowerCase()+choice.byeFit.message.slice(1)}`;
  if(choice.injury)situation+=`; check the ${choice.injury.toLowerCase()} status before picking`;
  else if(choice.priceLabel)situation+=`; the research price is ${choice.priceLabel.toLowerCase()}`;
  return {actualStats,explanation:[playerNote,situation+'.'].filter(Boolean).join(' ')};
}
