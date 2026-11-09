/**
 * Builds the packages a consumer would install, packs them, and installs the
 * TARBALLS into this fixture. The fixture never links the workspace: what the
 * suite exercises is what `npm pack` ships (the `files` list, the `exports`
 * map, `dist/browser-worker.js` and `dist/glue.wasm` beside `dist/browser.js`).
 *
 * Steps:
 *   1. `npm run build:dist` for each needed package, in dependency order
 *      (skip with E2E_SKIP_DIST=1 when dist is known to be fresh);
 *   2. `npm pack` each into a temp folder under this fixture (`.tarballs/`);
 *   3. install them, plus the fixture's own dependencies, with `--no-save`;
 *   4. build the test pack (.mkp) with the installed @markii/pack-build.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '..');
const repoRoot = path.resolve(fixture, '..', '..');
const tarballs = path.join(fixture, '.tarballs');

/** Dependency order matters: each build:dist reads the previous packages' dist types. */
const PACKAGES = [
  '@markii/core',
  '@markii/stdlib',
  '@markii/bundle',
  '@markii/pack',
  '@markii/runtime',
  '@markii/lua',
  '@markii/react',
  '@markii/html',
  '@markii/host',
  '@markii/pack-build',
];

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  }
}

if (process.env.E2E_SKIP_DIST !== '1') {
  for (const name of PACKAGES) {
    run('npm', ['run', 'build:dist', '-w', name], repoRoot);
  }
}

rmSync(tarballs, { recursive: true, force: true });
mkdirSync(tarballs, { recursive: true });
for (const name of PACKAGES) {
  run(
    'npm',
    ['pack', '-w', name, '--pack-destination', tarballs, '--silent'],
    repoRoot,
  );
}

rmSync(path.join(fixture, 'node_modules', '@markii'), {
  recursive: true,
  force: true,
});
const files = readdirSync(tarballs)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => path.join(tarballs, file));
run(
  'npm',
  [
    'install',
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    ...files,
  ],
  fixture,
);

run('node', ['scripts/build-pack.mjs'], fixture);
