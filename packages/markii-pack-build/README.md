# @markii/pack-build

Builds [Markii](https://github.com/markii-org/markii) component packs:
compiles a pack's component sources (and the CSS they import) with
esbuild's WebAssembly build, writes the prebuilt form, or produces a
`.mkp` archive. It is the one Markii package that carries a build
toolchain, for authoring hosts and pack build scripts; an app that only
installs prebuilt packs does not need it. Node only.

## Entry points

- `buildPackArchive(packFolder, options?)` takes a folder that holds one
  pack and returns the bytes of its `.mkp` archive. It discovers the pack,
  compiles its React views and, when the pack has terminal views, its
  terminal script, and zips the result. The optional `cacheDir` is a folder
  you own for the compiled scripts. It defaults to a folder under the
  system's temporary directory and is never the pack's own folder.
- `buildPackRegistrationScript(pack, cacheDir, options?)` compiles the
  pack's React sources into one registration script, `webview.js`, and an
  optional stylesheet. It caches the result under `cacheDir`.
- `buildPackTerminalScript(pack, cacheDir, options?)` does the same for
  the pack's `ansi` sources and produces `terminal.js`. It reports
  `skipped` when no component names an `ansi` source.
- `exportPackArchive({ pack, cacheDir, build, buildTerminal?, fs })`
  builds through those functions and returns the bytes of a
  `<name>-<version>.mkp` archive. It writes nothing itself.
- `exportPack` writes the prebuilt form into a destination folder instead
  of an archive.

Every build function returns an outcome and never throws. The outcome is
`built`, `failed` with a reason, or `skipped`. `buildPackArchive` returns
`built` or `failed`.

The two script builders return paths into the cache. Those paths are valid
until the next build replaces them, so read a script before you build
again. `buildPackArchive` does this for you and returns bytes.

## The pack source

The lower-level functions take a pack as `discoverPacks` from
`@markii/host/internal` returns it. A discovered pack carries its `folder`,
its parsed `manifest`, the `manifestText`, the absolute `componentPaths` of
its React sources, `componentPathsByEngine` for other engines, and its
`scriptsDir` for shared Lua. A build script that only wants an archive
does not need any of this: it calls `buildPackArchive` with the folder.

## Example

This script writes one `.mkp` archive for each pack folder under
`./packs`.

```ts
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPackArchive } from '@markii/pack-build';

const root = './packs';
const cacheDir = join(process.cwd(), '.pack-cache');

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const result = await buildPackArchive(join(root, entry.name), { cacheDir });
  if (result.kind === 'failed') throw new Error(result.reason);
  for (const warning of result.warnings) console.warn(warning);
  await writeFile(result.fileName, result.bytes);
}
```

See `docs/packs.md` in the repository for the pack contract.
