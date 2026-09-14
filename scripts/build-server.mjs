import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('apps/server/package.json', 'utf8'));
await build({entryPoints:['apps/server/src/index.ts'], outfile:'apps/server/dist/index.js', bundle:true, platform:'node', format:'esm', target:'node22', sourcemap:true, external:Object.keys(manifest.dependencies).filter(k => !k.startsWith('@aligned/'))});
