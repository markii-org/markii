# @markii/pack-build

Builds [Markii](https://github.com/markii-org/markii) component packs:
compiles a pack's component sources (and the CSS they import) with
esbuild's WebAssembly build, writes the prebuilt form, or produces a
`.mkp` archive. It is the one Markii package that carries a build
toolchain, for authoring hosts and pack build scripts; an app that only
installs prebuilt packs does not need it. Node only.

## Entry points

- `buildPackRegistrationScript(pack, cacheDir, options?)` compiles the
  pack's React sources into one registration script, `webview.js`, and an
  optional stylesheet. It caches the result under `cacheDir`, which must
  be a folder you own and never the pack's own folder.
- `buildPackTerminalScript(pack, cacheDir, options?)` does the same for
  the pack's `ansi` sources and produces `terminal.js`. It reports
  `skipped` when no component names an `ansi` source.
- `exportPackArchive({ pack, cacheDir, build, buildTerminal?, fs })`
  builds through those functions and returns the bytes of a
  `<name>-<version>.mkp` archive. It writes nothing itself.
- `exportPack` writes the prebuilt form into a destination folder instead
  of an archive.
- `lintPackCss` returns the class-prefix and color warnings for a
  stylesheet.

Every build function returns an outcome and never throws. The outcome is
`built`, `failed` with a reason, or `skipped`.

## The pack source

Each function takes a pack as `discoverPacks` from `@markii/host`
returns it. A discovered pack carries its `folder`, its parsed
`manifest`, the `manifestText`, the absolute `componentPaths` of its
React sources, `componentPathsByEngine` for other engines, and its
`scriptsDir` for shared Lua. `discoverPacks(folders, readFile,
listDirectory)` takes the folders to scan and two read functions.
`createNodePackDiscoveryIo()` from `@markii/host/node` supplies both.

## Example

This script discovers the packs in a folder and writes one `.mkp` archive
for each.

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverPacks } from '@markii/host';
import { createNodePackDiscoveryIo } from '@markii/host/node';
import {
  buildPackRegistrationScript,
  buildPackTerminalScript,
  exportPackArchive,
} from '@markii/pack-build';

const cacheDir = join(process.cwd(), '.pack-cache');
await mkdir(cacheDir, { recursive: true });

const io = createNodePackDiscoveryIo();
const { packs, skipped } = await discoverPacks(
  ['./packs'],
  io.readFile,
  io.listDirectory,
);
for (const folder of skipped) console.warn(folder);

for (const pack of packs) {
  const result = await exportPackArchive({
    pack,
    cacheDir,
    build: buildPackRegistrationScript,
    buildTerminal: buildPackTerminalScript,
    fs: {
      readFile: (path) => readFile(path, 'utf8').catch(() => undefined),
      listDirectory: (path) => readdir(path).catch(() => []),
    },
  });
  if (result.kind === 'failed') throw new Error(result.reason);
  await writeFile(result.fileName, result.bytes);
}
```

See `docs/packs.md` in the repository for the pack contract.
