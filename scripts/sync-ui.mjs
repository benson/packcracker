import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const source = join('node_modules', '@benson', 'vellum-ui', 'dist');
const target = join('vendor', 'vellum-ui');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
await rm(join(target, 'design-system.html'), { force: true });
await rm(join(target, 'demo'), { recursive: true, force: true });

console.log(`synced ${source} -> ${target}`);
