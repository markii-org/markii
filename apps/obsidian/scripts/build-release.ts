#!/usr/bin/env node
// The release CLI for the Obsidian plugin (issue #13 step 1). Given a
// release tag, it:
//   1. checks the tag against manifest.json/package.json (version gate,
//      see scripts/release/version.ts for why this is strict);
//   2. assembles the installable plugin folder (scripts/release/plugin-folder.ts);
//   3. builds the read-only source mirror snapshot (scripts/release/mirror-snapshot.ts);
//   4. reports what it produced, and, under GitHub Actions, exposes the
//      version and plugin directory as step outputs.
//
// Usage: node scripts/build-release.ts --tag <tag> --out <dir>
//
// Plain `node scripts/build-release.ts` (no build step): Node's built-in
// TypeScript type-stripping runs this directly, the same way this
// workspace's scripts/generate-doc-css.ts already does.
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseVersions } from './release/version.ts';
import { assemblePluginFolder } from './release/plugin-folder.ts';
import { buildMirrorSnapshot } from './release/mirror-snapshot.ts';

const here = dirname(fileURLToPath(import.meta.url));
// apps/obsidian/scripts -> apps/obsidian
const appDir = join(here, '..');
// apps/obsidian -> apps -> repo root
const repoRoot = join(appDir, '..', '..');

interface Args {
  tag: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  let tag: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag') {
      tag = argv[i + 1];
      i += 1;
    } else if (arg === '--out') {
      out = argv[i + 1];
      i += 1;
    } else {
      throw new Error(
        `unknown argument "${arg}" — usage: node scripts/build-release.ts --tag <tag> --out <dir>`,
      );
    }
  }

  if (tag === undefined) {
    throw new Error('missing required argument --tag <tag>');
  }
  if (out === undefined) {
    throw new Error('missing required argument --out <dir>');
  }

  return { tag, out };
}

function readJsonVersion(path: string): string {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('version' in raw) ||
    typeof (raw as { version: unknown }).version !== 'string'
  ) {
    throw new Error(`${path} is missing a string "version" field`);
  }
  return (raw as { version: string }).version;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);

  console.log(`markii obsidian release build`);
  console.log(`  tag: ${args.tag}`);
  console.log(`  out: ${outDir}`);

  console.log('\n[1/4] checking release versions...');
  const manifestVersion = readJsonVersion(join(appDir, 'manifest.json'));
  const packageVersion = readJsonVersion(join(appDir, 'package.json'));
  const { version, problems } = checkReleaseVersions({
    tag: args.tag,
    manifestVersion,
    packageVersion,
  });

  if (problems.length > 0 || version === null) {
    console.error('release version check failed:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
    return;
  }
  console.log(`  ok: version ${version}`);

  if (existsSync(outDir)) {
    console.log(`\nremoving existing out dir ${outDir}`);
    rmSync(outDir, { recursive: true, force: true });
  }

  console.log('\n[2/4] assembling plugin folder...');
  const pluginOut = join(outDir, 'plugin');
  const { pluginDir, files: pluginFiles } = assemblePluginFolder({
    appDir,
    outDir: pluginOut,
  });
  console.log(`  ok: ${pluginDir} (${String(pluginFiles.length)} files)`);

  console.log('\n[3/4] building mirror snapshot...');
  const mirrorOut = join(outDir, 'mirror');
  const { files: mirrorFiles } = buildMirrorSnapshot({
    appDir,
    outDir: mirrorOut,
    licensePath: join(repoRoot, 'LICENSE'),
    version,
  });
  console.log(`  ok: ${mirrorOut} (${String(mirrorFiles.length)} files)`);

  console.log('\n[4/4] summary');
  console.log(`  version: ${version}`);
  console.log(`  plugin files: ${String(pluginFiles.length)}`);
  console.log(`  mirror files: ${String(mirrorFiles.length)}`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput.length > 0) {
    appendFileSync(githubOutput, `version=${version}\n`);
    appendFileSync(githubOutput, `plugin_dir=${pluginDir}\n`);
  }
  console.log(`version=${version}`);
}

main();
