import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const outIndex=process.argv.indexOf('--out');
const out=outIndex>=0?path.resolve(root,process.argv[outIndex+1]):path.join(root,'outputs','draft-companion');
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'extension'),out,{recursive:true});
await build({entryPoints:[path.join(root,'extension/content.js')],outfile:path.join(out,'content.bundle.js'),bundle:true,format:'iife',target:'chrome116',logLevel:'warning'});
const manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
if(process.argv.includes('--local-research')){
  const {parseResearch}=await import('../extension/core/import.js');
  const backup=path.join(root,'private-data','2026-research-with-2025-stats.json');
  const input=await fs.access(backup).then(()=>backup,()=>path.join(root,'outputs','2026-research-with-2025-stats.json'));
  const text=await fs.readFile(input,'utf8');
  const imported=parseResearch(text,'json');if(imported.errors.length)throw Error(imported.errors.join('; '));
  await fs.mkdir(path.join(out,'private'),{recursive:true});await fs.writeFile(path.join(out,'private','research.json'),text);
  console.log(`User-local research seed: ${imported.players.length} players. Exclude private/ from public distributions.`);
}
for(const file of [manifest.background.service_worker,manifest.side_panel.default_path,...manifest.content_scripts.flatMap(x=>x.js)])await fs.access(path.join(out,file));
console.log(`Unpacked extension built: ${out}`);
