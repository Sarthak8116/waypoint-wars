/**
 * Copy curated hunt content into the Next.js public dir so the browser can
 * fetch it at runtime.
 *
 * Runtime fetch, not a build-time JSON import, deliberately: the app must
 * build and run whether or not the curated content exists yet. A missing file
 * degrades to the labeled placeholder instead of failing the build.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../data/pittsburgh-hunts.json');
const dest = resolve(here, '../public/hunts/pittsburgh.json');

if (!existsSync(src)) {
  console.warn('[sync-content] data/pittsburgh-hunts.json not found — app will use placeholder.');
  process.exit(0);
}

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log('[sync-content] curated hunt content synced to public/hunts/pittsburgh.json');
