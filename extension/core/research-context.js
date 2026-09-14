// Full guide remains in local storage. Send bounded, labeled excerpts relevant
// to the current comparison so refinement stays within the draft deadline.
export function researchForAi(context,choices) {
  if(!context)return null;
  const refs=new Set(choices.flatMap(p=>p.sourceRefs||[]));
  const sections=(context.sections||[]).filter(s=>/^## (1\.|4\.|5\.|6\.|7\.|9\.|15\.)/.test(s.title||''));
  let remaining=18000;
  const excerpts=sections.map(s=>{
    const text=String(s.text||'').slice(0,Math.min(remaining,4500));remaining-=text.length;
    return {title:s.title,text,abridged:text.length<String(s.text||'').length};
  }).filter(s=>s.text);
  return {source:context.source,sourceDate:context.sourceDate,coverage:context.coverage,
    sources:(context.sources||[]).filter(s=>refs.has(s.id)),excerpts,
    limits:'Original snapshot, not live news. Historical TD regression is descriptive 2025 evidence, not a 2026 forecast. Receiving-only TE checks are not complete projections.'};
}

export function boundedAiChoices(choices) {
  return choices.map(p=>({...p,notes:(p.notes||[]).join('\n\n').slice(0,6000),evidence:(p.evidence||'').slice(0,2000),rationale:(p.rationale||'').slice(0,2000),uncertainty:(p.uncertainty||'').slice(0,1000)}));
}
