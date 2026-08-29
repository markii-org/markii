/**
 * End-to-end coverage of the whole Obsidian pack-loading path against a
 * REAL, minimal fixture pack (`test-fixtures/packs/demo/`) that ships a
 * `.tsx` component, its own CSS import, AND a relative helper import with
 * no extension (`./helpers/label`) — deliberately not a flat single-file
 * pack. `@markii/host`'s own `pack-build.fixture.test.ts` doc comment
 * explains why a flat fixture is exactly what let a resolution regression
 * through: this file exists so this HOST's own wiring (evaluate the
 * compiled artifact via `./pack-runtime.ts`, merge it via
 * `./pack-render-registry.ts`) gets the same real-fixture proof, not just
 * `@markii/host`'s own build step.
 *
 * The real `buildPackRegistrationScript` call runs in a genuinely separate
 * `node` process — mirroring `packages/markii-host/src/packs/pack-build.fixture.test.ts`'s
 * own pattern exactly, including the reason: esbuild-wasm's browser
 * (in-process WebAssembly) entry fails an internal startup invariant check
 * when evaluated inside Vitest's per-file `vm` module-transform context.
 * Everything AFTER the build (reading the compiled script, evaluating it
 * via `./pack-runtime.ts`, merging it via `./pack-render-registry.ts`,
 * rendering the resulting component) runs in this file's own process, using
 * the exact modules a real preview open would use.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRegistry } from '@markii/react';
import {
  collectPackRegistrations,
  evaluatePackScript,
  installPackRuntime,
} from './pack-runtime.js';
import { buildRenderRegistry } from '@markii/host';
import type { PackBuildOutcome } from '@markii/host';

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  '../../test-fixtures/packs/demo',
);
const PACK_BUILD_TS = path.resolve(
  import.meta.dirname,
  '../../../../packages/markii-host/src/packs/pack-build.ts',
);

/** Runs the real `buildPackRegistrationScript` in a separate `node` process — see this file's top doc comment for why. */
function buildInChildProcess(
  packDir: string,
  cacheDir: string,
  workDir: string,
): PackBuildOutcome {
  const driverPath = path.join(workDir, 'run-build.cjs');
  const driverSource = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { buildPackRegistrationScript } = require(${JSON.stringify(PACK_BUILD_TS)});
    (async () => {
      const packDir = ${JSON.stringify(packDir)};
      const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'));
      const componentPaths = {};
      for (const [localName, relativePath] of Object.entries(manifest.components)) {
        componentPaths[localName] = path.join(packDir, relativePath);
      }
      const pack = { folder: packDir, manifest, componentPaths };
      const outcome = await buildPackRegistrationScript(pack, ${JSON.stringify(cacheDir)});
      process.stdout.write(JSON.stringify(outcome));
    })().catch((err) => {
      process.stdout.write(JSON.stringify({ kind: 'failed', reason: String((err && err.stack) || err) }));
    });
  `;
  writeFileSync(driverPath, driverSource, 'utf8');

  const output = execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return JSON.parse(output) as PackBuildOutcome;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(tmpdir(), 'markii-obsidian-pack-fixture-'),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('demo fixture pack — the real build, evaluated the way a preview open would', () => {
  it('compiles, evaluates, registers, and renders the component with its helper import folded in', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();

    const outcome = buildInChildProcess(FIXTURE_DIR, cacheDir, workDir);
    expect(outcome.kind).toBe('built');
    if (outcome.kind !== 'built') return;

    // Proof the relative, extensionless helper import was really
    // resolved and bundled in, not just the flat component file.
    const scriptText = await readFile(outcome.scriptPath, 'utf8');
    expect(scriptText).toContain('demo-fixture-marker-7c1a');

    // Proof the CSS import produced a real sibling stylesheet.
    expect(outcome.stylesheetPath).toBeDefined();
    const css = await readFile(outcome.stylesheetPath!, 'utf8');
    expect(css).toContain('.mk-demo_badge');
    expect(outcome.warnings).toEqual([]);

    // This is the exact sequence `view.tsx`'s `loadPacks` runs for a
    // real preview open: reset the runtime globals, evaluate the
    // compiled script, collect what it registered.
    installPackRuntime();
    const evalResult = evaluatePackScript(scriptText);
    expect(evalResult.ok).toBe(true);

    const registrations = collectPackRegistrations();
    expect(registrations).toHaveLength(1);

    const { registry, invalidReasons, collisions } = buildRenderRegistry(
      registrations,
      createRegistry(),
    );
    expect(invalidReasons).toEqual([]);
    expect(collisions).toEqual([]);
    expect(registry['demo_badge']).toBeDefined();

    // Render it for real, through the SAME React instance
    // `installPackRuntime` installed as `window.__markiiReact` — proof
    // there is no second React copy involved.
    const entry = registry['demo_badge']!;
    const html = renderToStaticMarkup(
      createElement(entry.component, {
        attributes: { label: 'hi' },
        children: null,
      }),
    );
    expect(html).toContain('mk-demo_badge');
    expect(html).toContain('demo-fixture-marker-7c1a:hi');
  }, 30_000);
});
