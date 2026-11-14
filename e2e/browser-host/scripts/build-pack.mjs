/**
 * Builds the test pack into public/generated/e2e.mkp on the Node side, with
 * the INSTALLED @markii/pack-build (the same API a pack build script uses),
 * so the browser host installs a prebuilt archive exactly as a user would.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackArchive } from '@markii/pack-build';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '..');

const packFolder = path.join(fixture, 'pack-fixture', 'e2e');
const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'markii-e2e-pack-'));
const outcome = await buildPackArchive(packFolder, { cacheDir });
rmSync(cacheDir, { recursive: true, force: true });
if (outcome.kind !== 'built') {
  throw new Error(`pack build failed: ${outcome.reason}`);
}

const outDir = path.join(fixture, 'public', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'e2e.mkp'), outcome.bytes);
console.log(`built ${outcome.fileName} (${outcome.bytes.byteLength} bytes)`);
