// Keep the original entry path while routing all operations through authenticated services.
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
register();
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await import('../apps/server/src/index.ts');
