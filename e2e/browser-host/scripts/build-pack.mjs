/**
 * Builds the test pack into public/generated/e2e.mkp on the Node side, with
 * the INSTALLED @markii/pack-build (the same API an authoring host uses), so
 * the browser host installs a prebuilt archive exactly as a user would.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import {
  createNodeDirectoryLister,
  createNodeFileReader,
} from '@markii/host/node';
import { discoverPacks } from '@markii/host';
import {
  buildPackRegistrationScript,
  exportPackArchive,
} from '@markii/pack-build';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const packFolder = path.join(fixture, 'pack-fixture', 'e2e');
const discovered = await discoverPacks(
  [packFolder],
  createNodeFileReader(),
  createNodeDirectoryLister(),
  'react',
);
const pack = discovered.packs[0];
if (!pack) {
  throw new Error(
    `pack discovery failed: ${JSON.stringify(discovered.skipped)}`,
  );
}

const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'markii-e2e-pack-'));
const outcome = await exportPackArchive({
  pack,
  cacheDir,
  build: (source, dir) =>
    buildPackRegistrationScript(source, dir, {
      esbuildBrowserModulePath: require.resolve('esbuild-wasm/lib/browser.js'),
      esbuildWasmBinaryPath: require.resolve('esbuild-wasm/esbuild.wasm'),
    }),
  fs: {
    readFile: async (p) => {
      try {
        return await readFile(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    listDirectory: async (p) => {
      try {
        return await readdir(p);
      } catch {
        return [];
      }
    },
  },
});
rmSync(cacheDir, { recursive: true, force: true });
if (outcome.kind !== 'built') {
  throw new Error(`pack build failed: ${outcome.reason}`);
}

const outDir = path.join(fixture, 'public', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'e2e.mkp'), outcome.bytes);
console.log(`built ${outcome.fileName} (${outcome.bytes.byteLength} bytes)`);
