/**
 * Compiles a pack's `.tsx` component sources into the SAME shape as a
 * hand-written `webview.js` registration script (see
 * `apps/vscode/test-fixtures/packs/demo/webview.js`'s own doc comment for
 * the contract this must produce: a classic IIFE that reads
 * `window.__markiiReact` LAZILY and calls
 * `window.__markiiRegisterPack(manifestJson, componentModules)`).
 *
 * Why this exists: `docs/packs.md` describes a pack as source plus a
 * manifest — nothing in this repository ever produces a prebuilt
 * `webview.js` from that source. Without this module, a real pack shipped
 * as `.tsx` sources (the ordinary case) discovers cleanly but contributes
 * ZERO components to a preview, so every directive under its namespace
 * silently falls through to the unknown-component fallback with no
 * explanation.
 *
 * Lives in `@markii/host` (not `apps/vscode`) because it is shared,
 * host-neutral logic: any Markii host that wants to compile a pack from
 * source — `apps/vscode` today, a future Obsidian host next — needs the
 * exact same builder, not a second drifting copy of it. `@markii/host` is
 * PRIVATE and never published, so depending on `esbuild-wasm` here does not
 * put a build toolchain into a published package (AGENTS.md's Stack
 * section). This module knows nothing about a host's discovery mechanism
 * (`markii.packs`, an Obsidian settings tab, …) — it only needs
 * `PackBuildSource`: a pack's folder, manifest, and component paths, which
 * a host's own discovery module can hand it directly (structurally
 * compatible with `apps/vscode`'s `DiscoveredPack`, which is a superset).
 *
 * ## The in-process WebAssembly path (not the Node child-process path)
 *
 * esbuild-wasm ships two Node-reachable entry points with very different
 * runtime behavior:
 *
 * - `lib/main.js` (the package's `main`): spawns `node bin/esbuild` as a
 *   CHILD PROCESS and talks to it over a pipe. This is the ordinary
 *   `esbuild`/`esbuild-wasm` Node experience, and is what this module used
 *   before this file moved here.
 * - `lib/browser.js` (the package's `browser` field, meant for bundlers
 *   targeting a browser environment): runs the SAME Go-compiled esbuild
 *   core, but entirely IN PROCESS via `WebAssembly.compile`/`instantiate` —
 *   no child process, no `node` binary required at all.
 *
 * This module uses `lib/browser.js`, and that is a REQUIREMENT, not a
 * preference: an Obsidian host runs inside Electron's renderer process,
 * which ships no `node` binary on its `PATH` at all, so `lib/main.js`'s
 * `child_process.spawn('node', ['bin/esbuild', ...])` fails immediately with
 * `Error: The service was stopped: spawn node ENOENT` — confirmed
 * empirically in a real Obsidian vault (Electron 43 / Node 24). The
 * `lib/browser.js` path, initialized once with a compiled
 * `WebAssembly.Module` (`loadEsbuildWasm` below), was confirmed working in
 * that same vault: roughly 221ms to initialize and 809ms for a cold build,
 * 69ms warm. It is also the FASTER option in plain Node — roughly 918ms
 * total cold against 1554ms for the child-process path, measured against
 * this exact builder — so both hosts use the SAME path; there is no
 * per-host divergence to maintain.
 *
 * The consequence: `lib/browser.js` has no filesystem access whatsoever —
 * esbuild will not open a single file on its own when run this way. Every
 * source byte this builder's build needs — the synthetic entry, every
 * declared component, every file ANY of those transitively imports (a
 * relative helper module, a helper's own further helper, a directory
 * `index`, CSS pulled in from a non-entry module) — is therefore supplied
 * directly through an esbuild plugin (`virtualSourcePlugin` below) with
 * `onResolve`/`onLoad` handlers over a private namespace.
 *
 * `virtualSourcePlugin` seeds itself from the SAME `sources`/`cssSources`
 * maps `buildPackRegistrationScript` already reads via `node:fs` to compute
 * its (necessarily incomplete, pre-build) cache key, but it does not stop
 * there: `onResolve` performs REAL module resolution — exact path, then
 * each of `.tsx`/`.ts`/`.jsx`/`.js`/`.mjs`/`.cjs`/`.css`, then the same list
 * under a directory's own `index` — and reads a newly-discovered file
 * itself via `node:fs` (fine: only *esbuild* has no filesystem here, the
 * plugin is ordinary host code in both hosts this module ships in). A
 * resolved path is rejected unless it stays inside the pack's own folder
 * (`fs.realpath`-compared, so `..` segments and symlinks cannot walk out —
 * defense in depth, packs are self-contained by contract already); a bare
 * specifier other than `react`/`react-dom` is rejected with a clear
 * "pack ... cannot resolve" message rather than falling through to
 * esbuild's own resolver — which has no filesystem either and previously
 * surfaced as an opaque `Cannot read directory ".": not implemented on js`
 * once a lookup missed the pre-seeded maps. `onResolve` therefore always
 * returns a definitive result (a resolved path or an explicit `errors`
 * entry), never `undefined`, so esbuild's built-in resolver is never
 * reached at all; `absWorkingDir` is also pinned to the pack's folder as a
 * second guard against the same class of failure.
 *
 * Because the full file set a build touches can only be known AFTER the
 * build runs, the cache key computed up front (`computeCacheKey`, over the
 * manifest plus the declared components plus a best-effort static CSS
 * scan) decides only the cache FILE NAME, not by itself whether a cached
 * entry is still valid. Validity is a sidecar file
 * (`<cacheBaseName>.sources.json`) written next to the cached script on
 * every successful build, recording the path and content hash of every
 * file `virtualSourcePlugin` actually loaded (the full transitive set,
 * including helpers the static scan never saw). A later call with an
 * existing cache file re-hashes exactly those recorded files; any missing
 * or changed file is a miss, same as no sidecar at all. This is what makes
 * editing a shared helper module — invisible to the pre-build key — still
 * invalidate the cache.
 *
 * `react`/`react-dom` stay external (`lazyGlobalModulePlugin`, unchanged by
 * any of this) — the OUTPUT this module produces is unchanged in shape:
 * same IIFE, same `window.__markiiRegisterPack` call, same lazy
 * `window.__markiiReact` access, same sibling stylesheet, same
 * content-hash cache naming. Only how the build is INVOKED changed.
 *
 * ## The lazy-React contract
 *
 * A pack script loads BEFORE a host's main webview/renderer bundle sets
 * `window.__markiiReact`. Every reference this module's compiled output
 * makes to React — both a component's own JSX and any
 * `import { useX } from 'react'` it writes — must therefore read
 * `window.__markiiReact` only from INSIDE a function that runs at render
 * time, never at the module's top level. Two building blocks make that true
 * for arbitrary component source without needing to understand it:
 *
 * - JSX itself never imports `react` or `react/jsx-runtime` at all: a
 *   custom `jsxFactory`/`jsxFragment` pair (`__markiiJSX.createElement` /
 *   `__markiiJSX.Fragment`, defined in `REACT_SHIM_BANNER` below as plain
 *   getters) replaces the automatic runtime, and a getter's body only
 *   runs when the property is actually read — i.e. at the JSX call site
 *   inside a component's render, not when the script loads.
 * - An explicit `import ... from 'react'` (hooks, `forwardRef`, etc.) is
 *   redirected by `lazyGlobalModulePlugin` to a virtual CommonJS module
 *   whose `module.exports` is a `Proxy` over `window.__markiiReact`. A
 *   `Proxy` get trap only fires when a property is actually read, so the
 *   `require()`/`__toESM()` machinery esbuild's own bundler generates for
 *   this import (unavoidably called at the module's top level) never
 *   itself touches `window.__markiiReact` — only a later, real property
 *   access (again, from inside a component body) does. This is verified
 *   empirically, not just argued, in `pack-build.test.ts` and
 *   `pack-build.fixture.test.ts`: a built script is loaded into a window
 *   with `window.__markiiReact` left `undefined`, and loading it alone
 *   must not throw.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  mkdir,
  readFile as nodeReadFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PackManifest } from '@markii/pack';
import type {
  Loader,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
} from 'esbuild-wasm/lib/browser.js';
import { lintPackCss } from './pack-css-lint.js';

/**
 * Everything `buildPackRegistrationScript` needs to know about one pack —
 * a host-neutral SUBSET of `apps/vscode`'s `DiscoveredPack` (and whatever
 * an Obsidian host's own discovery module produces): a discovery module's
 * richer, host-specific result (which also carries e.g. a `webview.js`
 * convention path, a `scripts/` directory) is passed here directly and
 * satisfies this shape structurally — no import needed either way, and no
 * host-specific field this module has no business knowing about.
 */
export interface PackBuildSource {
  /** The pack's own folder on disk — `resolveDir` for the synthetic entry `entrySource` compiles. */
  readonly folder: string;
  readonly manifest: PackManifest;
  /** Local component name -> absolute path to its declared source file (`manifest.components[name]`, resolved against `folder`). */
  readonly componentPaths: Readonly<Record<string, string>>;
}

/** Reads a file's UTF-8 text, or resolves `undefined` if it does not exist / cannot be read. Never rejects for an ordinary "not found" — injected so this module needs no real filesystem to test. Structurally identical to `apps/vscode`'s own `PackFileReader` (`./discover.ts`), deliberately not shared by import: a host's discovery module and this builder are independent seams. */
export type PackFileReader = (
  absolutePath: string,
) => Promise<string | undefined>;

/** esbuild-wasm's browser (in-process WebAssembly) `build` function signature — imported as a TYPE only, so this line never causes `esbuild-wasm` itself to be pulled into whatever bundles this module (see `loadEsbuildWasm`'s doc comment for why the VALUE side must never be a static import). */
type EsbuildBuildFn = typeof import('esbuild-wasm/lib/browser.js').build;
type EsbuildInitializeFn =
  typeof import('esbuild-wasm/lib/browser.js').initialize;

/** Bumped whenever this module's OUTPUT for the same pack sources would change (a banner/plugin tweak, an esbuild option change) — folded into the cache key (`computeCacheKey`) so a stale cached script from a previous version of this builder is never reused after an upgrade. Bumped again for the real dynamic module resolution + sidecar cache fix (`virtualSourcePlugin`'s doc comment): a pack with a helper module built before this version may have silently failed, or (had it somehow succeeded) would not be sidecar-tracked — either way, a fresh cache key forces every pack through the corrected path once. */
const BUILDER_VERSION = 4;

/**
 * `esbuild-wasm`'s browser entry unconditionally reaches for the `self`
 * global while assembling its Go/WebAssembly runtime bridge — confirmed
 * empirically against `esbuild-wasm@0.28.2`: both the worker-mode code path
 * AND the in-process code path this module actually uses
 * (`initialize({ worker: false })`) share the exact same generated source,
 * which contains `for (let o = self; o; o = Object.getPrototypeOf(o)) ...`
 * with no guard. A browser (or an Electron renderer, where an Obsidian host
 * runs) always has `self`; a plain Node process — this repo's Vitest run,
 * and the VS Code extension host — does not, and fails outright with
 * `ReferenceError: self is not defined` without this shim. Applied
 * defensively, once, and only when `self` is not already defined, so it is
 * a no-op wherever a real `self` already exists.
 */
function ensureSelfGlobal(): void {
  const g = globalThis as unknown as { self?: unknown };
  if (typeof g.self === 'undefined') {
    g.self = globalThis;
  }
}

/**
 * `resolveRequire` picks HOW to get a runtime `require`, because this
 * source is authored as ESM but ships in two different module formats: a
 * packaged VS Code extension bundles it into `dist/extension.js` as CJS,
 * where a real ambient `require` already exists and must be used directly
 * — `import.meta.url` is EMPTY in a CJS bundle (esbuild warns exactly this
 * at build time), so `createRequire(import.meta.url)` would resolve
 * against nothing and fail. In dev/tsx and under Vitest, this file runs as
 * genuine ESM, where `require` is not ambient and
 * `createRequire(import.meta.url)` is the correct (and only) way to get
 * one. Checking `typeof require` at runtime picks the right one in either
 * format without needing two builds of this module.
 *
 * A runtime `require()` (never a static `import`) for `esbuild-wasm`
 * itself is deliberate for the same reason it always was: a static
 * `import * as esbuildWasm from 'esbuild-wasm/lib/browser.js'` at this
 * module's top level would be a bundlable reference, which a host's own
 * bundler (`apps/vscode/esbuild.config.mjs`'s `extensionBuild`, for
 * instance) must be able to keep external — see that file's own doc
 * comment for the other half of this contract.
 */
function resolveRequire(): NodeJS.Require {
  if (typeof require === 'function') {
    return require;
  }
  return createRequire(import.meta.url);
}

let cachedBuildFn: EsbuildBuildFn | undefined;
let cachedInitPromise: Promise<EsbuildBuildFn> | undefined;

/**
 * Loads and initializes esbuild-wasm's in-process, WebAssembly `build`
 * function, lazily and once per process (a second `initialize()` call
 * throws — esbuild-wasm's own restriction — so this is cached across every
 * `buildPackRegistrationScript` call the process ever makes, cache hits
 * included).
 *
 * `browserModulePath`, when given, is an absolute path to a REAL,
 * unbundled copy of `esbuild-wasm`'s `lib/browser.js` — what a packaged
 * host supplies (`apps/vscode/esbuild.config.mjs` copies it next to
 * `dist/extension.js`; that file's own doc comment has the other half of
 * this contract). `undefined` (the default, and what every test in this
 * file uses) lets plain Node module resolution find the ordinary
 * `esbuild-wasm` package under `node_modules`. `wasmBinaryPath` is the
 * matching absolute path to the `esbuild.wasm` binary this function
 * compiles via `WebAssembly.compile` before initializing; `undefined`
 * resolves the ordinary package's copy the same way.
 */
function loadEsbuildWasm(
  browserModulePath?: string,
  wasmBinaryPath?: string,
): Promise<EsbuildBuildFn> {
  if (cachedBuildFn) {
    return Promise.resolve(cachedBuildFn);
  }
  if (!cachedInitPromise) {
    cachedInitPromise = (async () => {
      ensureSelfGlobal();
      const req = resolveRequire();
      const moduleSpecifier =
        browserModulePath ?? 'esbuild-wasm/lib/browser.js';
      const mod = req(moduleSpecifier) as {
        build: EsbuildBuildFn;
        initialize: EsbuildInitializeFn;
      };
      const wasmPath =
        wasmBinaryPath ?? req.resolve('esbuild-wasm/esbuild.wasm');
      const wasmBytes = await nodeReadFile(wasmPath);
      const wasmModule = await WebAssembly.compile(wasmBytes);
      await mod.initialize({ wasmModule, worker: false });
      cachedBuildFn = mod.build;
      return mod.build;
    })();
  }
  return cachedInitPromise;
}

/** Every named export the installed `react`/`react-dom` (18.3.x) actually ship, confirmed by inspecting the real packages under `node_modules` — the fixed key list `lazyGlobalModulePlugin`'s virtual modules report via their `Proxy`'s `ownKeys` trap (a `Proxy` cannot report "every possible key"; it must report a concrete list for `Object.getOwnPropertyNames`/esbuild's `__copyProps` helper to iterate). Deliberately excludes the `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` internals export — no legitimate pack component reaches for it. */
const REACT_KEYS = [
  'Children',
  'Component',
  'Fragment',
  'Profiler',
  'PureComponent',
  'StrictMode',
  'Suspense',
  'act',
  'cloneElement',
  'createContext',
  'createElement',
  'createFactory',
  'createRef',
  'forwardRef',
  'isValidElement',
  'lazy',
  'memo',
  'startTransition',
  'unstable_act',
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
  'version',
];

const REACT_DOM_KEYS = [
  'createPortal',
  'findDOMNode',
  'flushSync',
  'hydrate',
  'render',
  'unmountComponentAtNode',
  'unstable_batchedUpdates',
  'unstable_renderSubtreeIntoContainer',
  'version',
];

const REACT_DOM_CLIENT_KEYS = ['createRoot', 'hydrateRoot'];

/** Module specifier -> (global property name on `window`, exported key list) for every import `lazyGlobalModulePlugin` redirects to a lazy `Proxy`. A host's own webview/renderer bundle is the ONE place that ever sets `window.__markiiReact`/`window.__markiiReactDom`; a pack component reads the SAME instance, never its own copy. */
const LAZY_GLOBAL_MODULES: ReadonlyMap<
  string,
  { readonly globalName: string; readonly keys: readonly string[] }
> = new Map([
  ['react', { globalName: '__markiiReact', keys: REACT_KEYS }],
  ['react-dom', { globalName: '__markiiReactDom', keys: REACT_DOM_KEYS }],
  [
    'react-dom/client',
    { globalName: '__markiiReactDom', keys: REACT_DOM_CLIENT_KEYS },
  ],
]);

/**
 * Source text for one virtual lazy-global module: a `Proxy` whose every
 * trap reads `window[globalName]` at call time, never at load time — see
 * this file's top doc comment. `ownKeys`/`getOwnPropertyDescriptor` report
 * the fixed `keys` list so esbuild's `__copyProps` helper (generated for
 * `import { x } from '<specifier>'`) can enumerate and re-export them as
 * lazy getters, without ever eagerly reading a value itself (`__copyProps`
 * defines `{ get: () => from[key] }` descriptors — defining a getter never
 * invokes it).
 *
 * `get`/`has` are guarded to the SAME `keys` allowlist as
 * `getOwnPropertyDescriptor`, on purpose: esbuild's own `__toESM` helper
 * (generated for every `import ... from '<specifier>'`, including a bare
 * namespace import) probes `mod.__esModule` at the TOP of the compiled
 * bundle to decide CJS/ESM interop — an unconditional `get` trap would
 * forward that probe straight to `window[globalName]`, defeating the
 * whole point of this module (confirmed empirically: without this guard,
 * loading a script that merely imports from `react` reads
 * `window.__markiiReact` once before any component ever renders). Denying
 * every key outside `keys` up front means only a genuine, intentional
 * property read of something this module actually re-exports ever reaches
 * `window[globalName]`.
 */
function lazyGlobalModuleSource(
  globalName: string,
  keys: readonly string[],
): string {
  return [
    `function __markiiTarget() { return (typeof window !== 'undefined' && window[${JSON.stringify(globalName)}]) || {}; }`,
    `var __markiiKeys = ${JSON.stringify(keys)};`,
    'module.exports = new Proxy({}, {',
    '  get(_t, prop) {',
    '    if (__markiiKeys.indexOf(prop) === -1) return undefined;',
    '    return __markiiTarget()[prop];',
    '  },',
    '  has(_t, prop) { return __markiiKeys.indexOf(prop) !== -1; },',
    '  ownKeys() { return __markiiKeys; },',
    '  getOwnPropertyDescriptor(_t, prop) {',
    '    if (__markiiKeys.indexOf(prop) === -1) return undefined;',
    '    return { enumerable: true, configurable: true };',
    '  },',
    '});',
  ].join('\n');
}

const LAZY_GLOBAL_NAMESPACE = 'markii-lazy-global';

/** An esbuild plugin that intercepts `import ... from 'react'` (and the other `LAZY_GLOBAL_MODULES` specifiers) and serves `lazyGlobalModuleSource` instead — so the compiled script never bundles its own copy of React, and never reads `window.__markiiReact` outside a getter/proxy trap. */
function lazyGlobalModulePlugin(): Plugin {
  const specifiers = new Set(LAZY_GLOBAL_MODULES.keys());
  return {
    name: 'markii-lazy-global',
    setup(build) {
      build.onResolve(
        { filter: /^react(-dom)?(\/.*)?$/ },
        (args: OnResolveArgs): OnResolveResult | undefined => {
          if (!specifiers.has(args.path)) return undefined;
          return { path: args.path, namespace: LAZY_GLOBAL_NAMESPACE };
        },
      );
      build.onLoad(
        { filter: /.*/, namespace: LAZY_GLOBAL_NAMESPACE },
        (args: OnLoadArgs): OnLoadResult => {
          const entry = LAZY_GLOBAL_MODULES.get(args.path);
          const resolved = entry ?? {
            globalName: '__markiiReact',
            keys: REACT_KEYS,
          };
          return {
            contents: lazyGlobalModuleSource(
              resolved.globalName,
              resolved.keys,
            ),
            loader: 'js',
          };
        },
      );
    },
  };
}

const VIRTUAL_SOURCE_NAMESPACE = 'markii-pack-source';

/** `path.extname` -> esbuild `Loader`, for every extension this builder's own virtual sources ever carry. Anything else loads as plain `text` — never `js`/`ts`, since silently parsing an unrecognized file as a script would be worse than a clear "could not resolve" build failure. */
function loaderForPath(absolutePath: string): Loader {
  switch (path.extname(absolutePath)) {
    case '.tsx':
      return 'tsx';
    case '.ts':
      return 'ts';
    case '.jsx':
      return 'jsx';
    case '.css':
      return 'css';
    case '.js':
      return 'js';
    default:
      return 'text';
  }
}

/** Extensions this builder's real module resolution (`resolveImportCandidate`) tries, in order, after the exact specifier itself — both bare (`./guard` -> `./guard.ts`) and as a directory `index` (`./util` -> `./util/index.ts`). Mirrors ordinary Node/bundler resolution closely enough for a pack's own self-contained sources; a pack never resolves against `node_modules`. */
const RESOLUTION_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
] as const;

/** True when `candidate` exists and is a regular file (never a directory: a directory only ever matches through the `index.*` arm of `resolveImportCandidate`, so a bare directory hit there must fall through to the next extension rather than "resolving" to the directory itself). */
async function isResolvableFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Real module resolution for one already-joined base path (an absolute
 * specifier as-is, or a relative specifier already resolved against its
 * importer's directory): tries `base` itself, then `base` plus each of
 * `RESOLUTION_EXTENSIONS`, then `base` as a directory with `index` plus
 * each extension — the order this file's top doc comment and AGENTS.md's
 * task both specify. Resolves to `undefined` (never throws) when nothing
 * on disk matches any candidate.
 */
async function resolveImportCandidate(
  base: string,
): Promise<string | undefined> {
  if (await isResolvableFile(base)) return base;
  for (const ext of RESOLUTION_EXTENSIONS) {
    const withExt = `${base}${ext}`;
    if (await isResolvableFile(withExt)) return withExt;
  }
  for (const ext of RESOLUTION_EXTENSIONS) {
    const indexPath = path.join(base, `index${ext}`);
    if (await isResolvableFile(indexPath)) return indexPath;
  }
  return undefined;
}

/** One `onResolve`/`onLoad` failure, shaped as esbuild's own `OnResolveResult.errors` — used for every rejection `virtualSourcePlugin` produces (unresolvable bare specifier, resolution miss, jail violation, unreadable file) so esbuild treats it as a normal build error (surfaced through `result.errors` exactly like a real syntax error) rather than falling through to its own filesystem-less default resolver. */
function resolveFailure(text: string): OnResolveResult {
  return { errors: [{ text }] };
}

/**
 * The plugin that stands in for filesystem access entirely: `lib/browser.js`
 * (see this file's top doc comment) never reads a file on its own, so every
 * source byte this build touches must be supplied here. `fileContents` is
 * the SAME mutable map `buildPackRegistrationScript` seeds from its
 * pre-build `sources`/`cssSources` scan — this plugin both reads from it
 * (a component's own absolute path, a statically-found CSS file) and
 * WRITES to it as resolution discovers further files (a relative helper
 * import, a helper's own helper, a directory `index`, CSS imported from a
 * non-entry module), so that after a successful build `fileContents` holds
 * the complete, real transitive file set — what the sidecar cache records.
 *
 * `onResolve` handles three shapes: an ALREADY-ABSOLUTE specifier (what
 * `entrySource` writes for each declared component) is looked up as its own
 * base path; a RELATIVE specifier (`./guard`, `./util`, `./x.css`, …) is
 * resolved against `path.dirname(args.importer)` first; anything else is a
 * BARE specifier, which — `react`/`react-dom` having already been claimed
 * by `lazyGlobalModulePlugin` earlier in the `plugins` array — this pack
 * cannot supply (a pack ships its own sources only, never a `node_modules`
 * dependency) and is rejected outright with a clear reason naming the pack
 * and the specifier. A resolved candidate that falls outside
 * `jailRealRoot` (the pack's own folder, real-path compared so `..` and
 * symlinks cannot walk out) is rejected the same way. Every rejection is an
 * explicit `errors` result, never `undefined` — so esbuild's own
 * filesystem-less default resolver is never reached.
 */
function virtualSourcePlugin(
  packName: string,
  fileContents: Map<string, string>,
  jailRealRoot: string,
): Plugin {
  return {
    name: 'markii-pack-source',
    setup(build) {
      build.onResolve(
        { filter: /.*/ },
        async (args: OnResolveArgs): Promise<OnResolveResult> => {
          let base: string;
          if (path.isAbsolute(args.path)) {
            base = args.path;
          } else if (
            args.path.startsWith('./') ||
            args.path.startsWith('../')
          ) {
            base = path.resolve(path.dirname(args.importer), args.path);
          } else {
            return resolveFailure(
              `pack "${packName}": cannot resolve "${args.path}" — a pack import must be a relative path within the pack, or "react"/"react-dom"; other bare package specifiers are not supported (packs are self-contained).`,
            );
          }

          const resolved = fileContents.has(base)
            ? base
            : await resolveImportCandidate(base);
          if (resolved === undefined) {
            return resolveFailure(
              `pack "${packName}": could not resolve "${args.path}" imported from "${args.importer}"`,
            );
          }

          let real: string;
          try {
            real = await realpath(resolved);
          } catch (err) {
            return resolveFailure(
              `pack "${packName}": could not read "${resolved}" resolving "${args.path}": ${describeThrown(err)}`,
            );
          }
          if (
            real !== jailRealRoot &&
            !real.startsWith(jailRealRoot + path.sep)
          ) {
            return resolveFailure(
              `pack "${packName}": import "${args.path}" resolves to "${resolved}", which is outside the pack's own folder — a pack must be self-contained.`,
            );
          }

          if (!fileContents.has(resolved)) {
            let text: string;
            try {
              text = await nodeReadFile(resolved, 'utf8');
            } catch (err) {
              return resolveFailure(
                `pack "${packName}": could not read "${resolved}" resolving "${args.path}": ${describeThrown(err)}`,
              );
            }
            fileContents.set(resolved, text);
          }

          return { path: resolved, namespace: VIRTUAL_SOURCE_NAMESPACE };
        },
      );
      build.onLoad(
        { filter: /.*/, namespace: VIRTUAL_SOURCE_NAMESPACE },
        (args: OnLoadArgs): OnLoadResult => {
          return {
            contents: fileContents.get(args.path) ?? '',
            loader: loaderForPath(args.path),
            resolveDir: path.dirname(args.path),
          };
        },
      );
    },
  };
}

/**
 * Custom JSX compiler options: JSX never imports `react`/`react/jsx-runtime`
 * at all. `__markiiJSX` (defined in `REACT_SHIM_BANNER`) exposes
 * `createElement`/`Fragment` as GETTERS over `window.__markiiReact` — read
 * only at the point a JSX expression actually evaluates (inside a
 * component's render), never at the top of the compiled script.
 */
const REACT_SHIM_BANNER = [
  'var __markiiJSX = {',
  "  get createElement() { return (typeof window !== 'undefined' && window.__markiiReact || {}).createElement; },",
  "  get Fragment() { return (typeof window !== 'undefined' && window.__markiiReact || {}).Fragment; },",
  '};',
].join('\n');

/** One component's declared local name and the absolute path to its source, in `manifest.components` iteration order (`Object.hasOwn`-guarded, matching a host's own hostile-map discipline). */
function orderedComponents(
  pack: PackBuildSource,
): Array<{ localName: string; sourcePath: string }> {
  const result: Array<{ localName: string; sourcePath: string }> = [];
  for (const localName of Object.keys(pack.manifest.components)) {
    if (!Object.hasOwn(pack.manifest.components, localName)) continue;
    const sourcePath = pack.componentPaths[localName];
    if (sourcePath === undefined) continue;
    result.push({ localName, sourcePath });
  }
  return result;
}

/**
 * The synthetic entry module esbuild compiles (via its `stdin` option, so
 * nothing needs to exist on disk for it): imports every declared
 * component's source, picks the exported component FUNCTION from each
 * module (`__markiiPick` below — the pack author's own export style,
 * named or `default`, is a host concern, taking the first function-typed
 * export covers both without requiring a convention this repo has never
 * documented), and calls `window.__markiiRegisterPack` exactly like
 * `apps/vscode/test-fixtures/packs/demo/webview.js` does by hand.
 */
function entrySource(
  pack: PackBuildSource,
  components: ReadonlyArray<{ localName: string; sourcePath: string }>,
): string {
  const imports = components
    .map(
      (c, i) =>
        `import * as __markiiMod${i} from ${JSON.stringify(c.sourcePath)};`,
    )
    .join('\n');
  const picks = components
    .map(
      (c, i) =>
        `  ${JSON.stringify(c.localName)}: __markiiPick(__markiiMod${i}),`,
    )
    .join('\n');
  const manifestJsonLiteral = JSON.stringify(JSON.stringify(pack.manifest));

  return [
    imports,
    '',
    'function __markiiPick(mod) {',
    "  if (mod && typeof mod['default'] === 'function') return mod['default'];",
    '  for (var key in mod) {',
    "    if (Object.prototype.hasOwnProperty.call(mod, key) && typeof mod[key] === 'function') return mod[key];",
    '  }',
    '  return undefined;',
    '}',
    '',
    'var __markiiComponents = {',
    picks,
    '};',
    '',
    "if (typeof window !== 'undefined' && typeof window.__markiiRegisterPack === 'function') {",
    '  var __markiiEntries = {};',
    '  for (var __markiiLocalName in __markiiComponents) {',
    '    if (!Object.prototype.hasOwnProperty.call(__markiiComponents, __markiiLocalName)) continue;',
    "    if (typeof __markiiComponents[__markiiLocalName] !== 'function') continue;",
    '    __markiiEntries[__markiiLocalName] = { component: __markiiComponents[__markiiLocalName], inline: false };',
    '  }',
    `  window.__markiiRegisterPack(${manifestJsonLiteral}, __markiiEntries);`,
    '}',
    '',
  ].join('\n');
}

/**
 * A best-effort, static scan of one component source file for side-effect
 * `import '...css'` specifiers (`import './hn-list.css';`, and the `import
 * styles from './x.css'` shape too, though a pack CSS component is expected
 * to use the plain side-effect form per the pack CSS design). Resolves only
 * RELATIVE specifiers (`./...`/`../...`) against `sourceDir` — a bare
 * specifier (`import 'some-package/x.css'`) is out of scope for a pack,
 * which ships its own sources and never a `node_modules` dependency of its
 * own. This is intentionally a regex, not a real JS/TS parser: a specifier
 * this misses is not a build failure any more: virtualSourcePlugin resolves
 * the real file itself, on demand, during the build. This scan only gives the
 * PRE-build cache key (computeCacheKey, which decides the cache file's name)
 * a head start on catching a component's own direct CSS edit without a
 * rebuild's help; a specifier it misses (a helper module's own .css import,
 * say) is still caught correctly on the NEXT call by the sidecar cache (this
 * file's top doc comment) once the file has actually been loaded once.
 */
const CSS_IMPORT_RE = /\bimport\s+(?:[^'";]+\s+from\s+)?["']([^"']+\.css)["']/g;

function staticCssImportPaths(source: string, sourceDir: string): string[] {
  const specifiers: string[] = [];
  CSS_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_IMPORT_RE.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    specifiers.push(path.resolve(sourceDir, specifier));
  }
  return specifiers;
}

/**
 * The PRE-build cache key for one pack: a SHA-256 of `BUILDER_VERSION`, the
 * manifest (stable-stringified: `Object.keys` order for a plain
 * `Record<string,string>` from `parsePackManifest`'s own construction is
 * already insertion order, and there is exactly one manifest shape), every
 * declared component's absolute path plus its own source bytes, and every
 * CSS file the component sources statically import (`cssSources`, keyed the
 * same way) — so touching any one component file, any CSS file it imports,
 * adding/removing a component, or shipping a new builder version each
 * independently invalidates the cache FILE NAME. Entries are sorted by path
 * first so the digest does not depend on either map's insertion order.
 *
 * This key alone cannot know about a file only a transitive import
 * discovers (this file's top doc comment: the sidecar cache is what
 * catches that). It still decides the cache file's NAME because it is
 * cheap, deterministic, and known before any build attempt — an edit to a
 * declared component or its statically-visible CSS gets a fresh name
 * immediately, and a genuinely stale entry under an unchanged name is
 * still caught by the sidecar hash check before it is ever reused.
 */
export function computeCacheKey(
  pack: PackBuildSource,
  componentSources: ReadonlyMap<string, string>,
  cssSources: ReadonlyMap<string, string> = new Map(),
): string {
  const hash = createHash('sha256');
  hash.update(`builder:${BUILDER_VERSION}\n`);
  hash.update(`manifest:${JSON.stringify(pack.manifest)}\n`);
  const entries = [...componentSources.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [sourcePath, source] of entries) {
    hash.update(`component:${sourcePath}\n`);
    hash.update(source);
    hash.update('\n');
  }
  const cssEntries = [...cssSources.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [cssPath, source] of cssEntries) {
    hash.update(`css:${cssPath}\n`);
    hash.update(source);
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** A cache-safe file-name fragment: the pack's namespace, already restricted to lowercase-kebab by `@markii/pack`'s `validatePackName` (a host's own discovery never constructs a `PackBuildSource` from a manifest that failed validation), so no further sanitizing is needed here — kept as a small local guard anyway, cheap insurance against a future relaxed namespace rule. */
function safeCacheBaseName(pack: PackBuildSource): string {
  return pack.manifest.name.replace(/[^a-z0-9-]/g, '-') || 'pack';
}

/**
 * The sidecar cache file (this file's top doc comment): the path and
 * content hash of every file `virtualSourcePlugin` actually loaded for one
 * successful build — the declared components, every statically-scanned CSS
 * file, and every further file resolution discovered (a helper module, a
 * helper's own helper, a directory `index`, CSS imported from a non-entry
 * module). Written next to the cached script/stylesheet under the same
 * `cacheBaseName`, and re-checked on every later call before trusting an
 * existing cache file.
 */
interface CacheSidecar {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly hash: string;
  }>;
}

/** SHA-256 hex digest of one file's text — the sidecar's per-file fingerprint. */
function hashFileContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Builds the sidecar record for a completed build's full, real file set (`fileContents`, mutated in place by `virtualSourcePlugin` as it resolved). Sorted by path so the serialized JSON is stable across runs with the same file set. */
function buildSidecar(fileContents: ReadonlyMap<string, string>): CacheSidecar {
  const files = [...fileContents.entries()]
    .map(([filePath, text]) => ({
      path: filePath,
      hash: hashFileContent(text),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files };
}

/**
 * Reads and validates one sidecar file's shape. Returns `undefined` — never
 * throws — for a missing file, unparsable JSON, or any shape that is not
 * exactly `{ files: Array<{ path: string, hash: string }> }`: per this
 * file's top doc comment, "no sidecar" and "a sidecar that cannot be
 * trusted" are the same outcome, a cache miss.
 */
async function loadSidecar(
  sidecarPath: string,
): Promise<CacheSidecar | undefined> {
  let raw: string;
  try {
    raw = await nodeReadFile(sidecarPath, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const rawFiles = (parsed as { files?: unknown }).files;
  if (!Array.isArray(rawFiles)) return undefined;
  const files: Array<{ path: string; hash: string }> = [];
  for (const entry of rawFiles) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== 'string' ||
      typeof (entry as { hash?: unknown }).hash !== 'string'
    ) {
      return undefined;
    }
    files.push({
      path: (entry as { path: string }).path,
      hash: (entry as { hash: string }).hash,
    });
  }
  return { files };
}

/**
 * Whether every file a sidecar recorded still reads back with the same
 * content hash — a cache HIT only when this is true for every entry.
 * `readComponentSource` (the same injected/real reader
 * `buildPackRegistrationScript` already uses) rather than raw `node:fs`,
 * so this stays testable with a fake reader exactly like the rest of this
 * module's cache-key logic; a file that is missing, or throws while being
 * read, is treated as changed (a miss), never as a crash.
 */
async function sidecarStillValid(
  sidecar: CacheSidecar,
  readComponentSource: PackFileReader,
): Promise<boolean> {
  for (const file of sidecar.files) {
    let text: string | undefined;
    try {
      text = await readComponentSource(file.path);
    } catch {
      text = undefined;
    }
    if (text === undefined || hashFileContent(text) !== file.hash) {
      return false;
    }
  }
  return true;
}

/** What `buildPackRegistrationScript` reports. `'built'` and `'failed'` are real outcomes of an attempted build; `'skipped'` means no attempt was made at all (the default, no-op builder a host may use when no cache directory is configured) — kept distinct from `'failed'` so a caller never records a spurious "build failed" reason for a pack that simply had no build attempted. */
export type PackBuildOutcome =
  | {
      readonly kind: 'built';
      readonly scriptPath: string;
      /**
       * Absolute path to this build's emitted stylesheet, a SIBLING of
       * `scriptPath` in the same cache directory with the same
       * content-hash base name — present only when at least one built
       * component imported CSS (`import './x.css'`); a pack with no CSS
       * imports produces `undefined` here and no `.css` file is ever
       * written, matching its behavior before this feature existed.
       */
      readonly stylesheetPath?: string;
      /**
       * Rule A/B warnings (`./pack-css-lint.ts`) against `stylesheetPath`'s
       * emitted content — empty when there is no stylesheet, or the
       * stylesheet has no findings. Warnings only: never a build failure,
       * never thrown; a host's own diagnostics surface (`apps/vscode`'s
       * `pack-diagnostics.ts`) surfaces these.
       */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'skipped' };

export interface PackBuildOptions {
  /** Absolute path to a real, unbundled `esbuild-wasm/lib/browser.js` — forwarded to `loadEsbuildWasm`. */
  readonly esbuildBrowserModulePath?: string;
  /** Absolute path to the `esbuild.wasm` binary this builder compiles once via `WebAssembly.compile` — forwarded to `loadEsbuildWasm`. */
  readonly esbuildWasmBinaryPath?: string;
  /** Reads one component source file's UTF-8 text, or `undefined` if unreadable — defaults to real `node:fs`. Injected so a build-failure ("missing component source") path is testable without touching disk. */
  readonly readComponentSource?: PackFileReader;
  /** Replaces esbuild-wasm's `build` function outright — for tests that want to assert cache behavior (or a build failure) without paying for a real esbuild-wasm invocation, and for the ANY-real-invocation counting a cache-hit test needs. Bypasses `loadEsbuildWasm`/the module-path options entirely when given. */
  readonly build?: EsbuildBuildFn;
}

const defaultReadComponentSource: PackFileReader = async (absolutePath) => {
  try {
    return await nodeReadFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Builds (or reuses a cached build of) one pack's webview registration
 * script. NEVER throws: every failure mode (a missing component source, a
 * broken `.tsx`, an esbuild-wasm error) comes back as
 * `{ kind: 'failed', reason }` — a host records that reason next to the
 * pack and simply excludes it from its own webview/renderer registry, the
 * same quiet degradation as every other pack failure (AGENTS.md's
 * cleanliness rule: never a compiler error dump as page content).
 *
 * `cacheDir` is a HOST-OWNED directory — never the pack's own folder, per
 * AGENTS.md's cleanliness rule that the user's file tree stays clean. A
 * cache hit (the built script for this exact pack content already exists
 * under `cacheDir`) skips esbuild-wasm entirely: esbuild-wasm
 * initialization is not free (see this file's top doc comment for measured
 * figures), and a warm preview open must not pay that cost on every panel
 * (re)creation.
 */
export async function buildPackRegistrationScript(
  pack: PackBuildSource,
  cacheDir: string,
  options: PackBuildOptions = {},
): Promise<PackBuildOutcome> {
  const readComponentSource =
    options.readComponentSource ?? defaultReadComponentSource;
  const components = orderedComponents(pack);

  const sources = new Map<string, string>();
  for (const component of components) {
    let text: string | undefined;
    try {
      text = await readComponentSource(component.sourcePath);
    } catch {
      text = undefined;
    }
    if (text === undefined) {
      return {
        kind: 'failed',
        reason: `missing component source "${component.localName}" (${component.sourcePath})`,
      };
    }
    sources.set(component.sourcePath, text);
  }

  // Best-effort CSS-import discovery (`staticCssImportPaths`) so a CSS-only
  // edit is a cache miss same as a `.tsx` edit — see that function's doc
  // comment for why this is a static scan rather than asking esbuild (which
  // would mean building first, defeating the cache-hit fast path below).
  // An unreadable candidate is silently skipped here: if the pack's real
  // source genuinely needs it, `virtualSourcePlugin` below will fail the
  // build on it with a proper reason.
  const cssSources = new Map<string, string>();
  for (const [sourcePath, source] of sources) {
    for (const cssPath of staticCssImportPaths(
      source,
      path.dirname(sourcePath),
    )) {
      if (cssSources.has(cssPath)) continue;
      let cssText: string | undefined;
      try {
        cssText = await readComponentSource(cssPath);
      } catch {
        cssText = undefined;
      }
      if (cssText !== undefined) cssSources.set(cssPath, cssText);
    }
  }

  let cacheKey: string;
  try {
    cacheKey = computeCacheKey(pack, sources, cssSources);
  } catch (err) {
    return { kind: 'failed', reason: describeThrown(err) };
  }

  const cacheBaseName = `${safeCacheBaseName(pack)}-${cacheKey}`;
  const cachePath = path.join(cacheDir, `${cacheBaseName}.js`);
  const cssCachePath = path.join(cacheDir, `${cacheBaseName}.css`);
  const sidecarPath = path.join(cacheDir, `${cacheBaseName}.sources.json`);

  if (existsSync(cachePath)) {
    const sidecar = await loadSidecar(sidecarPath);
    if (sidecar && (await sidecarStillValid(sidecar, readComponentSource))) {
      return await builtOutcomeFromCache(pack, cachePath, cssCachePath);
    }
    // No sidecar, or one of its recorded files is missing/changed (most
    // often a transitively-imported helper the pre-build key above never
    // saw) — a miss, same as no cache file at all. Falls through to a real
    // rebuild, which overwrites this exact `cachePath`/`sidecarPath` pair.
  }

  let build: EsbuildBuildFn;
  try {
    build =
      options.build ??
      (await loadEsbuildWasm(
        options.esbuildBrowserModulePath,
        options.esbuildWasmBinaryPath,
      ));
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not load esbuild-wasm: ${describeThrown(err)}`,
    };
  }

  // Every source byte esbuild might touch for this build, in one map —
  // `virtualSourcePlugin` is the ONLY way any of it reaches esbuild: the
  // in-process WebAssembly build (this file's top doc comment) has no
  // filesystem of its own. Seeded with what the pre-build scan already
  // knows; `virtualSourcePlugin` mutates this in place as it resolves
  // further files, so after a successful build it holds the complete,
  // real transitive set — what `buildSidecar` records below.
  const fileContents = new Map<string, string>([...sources, ...cssSources]);

  // The jail boundary every dynamically-resolved import must stay inside
  // (task #2 in this file's top doc comment). A pack folder that cannot be
  // real-path'd (does not exist) falls back to its own resolved form: in
  // that case the build below fails for other, more fundamental reasons
  // (an unreadable `stdin.resolveDir`), and this fallback only matters so
  // a caller that already validated `pack.folder` some other way (a test
  // double, say) is never blocked on a jail check that has nothing real to
  // compare against.
  let jailRealRoot: string;
  try {
    jailRealRoot = await realpath(pack.folder);
  } catch {
    jailRealRoot = path.resolve(pack.folder);
  }

  let scriptText: string;
  let stylesheetText: string | undefined;
  try {
    const result = await build({
      stdin: {
        contents: entrySource(pack, components),
        resolveDir: pack.folder,
        sourcefile: `${pack.manifest.name}-pack-entry.js`,
        loader: 'js',
      },
      bundle: true,
      write: false,
      // `outdir` + `entryNames` (rather than a bare `write:false` with no
      // output-path option at all) is what makes a CSS import legal in the
      // first place — esbuild refuses to bundle a CSS import "without an
      // output path configured" otherwise (confirmed empirically against
      // esbuild-wasm@0.28.2) — and gives any emitted stylesheet the SAME
      // content-hash base name as the script, one directory entry apart by
      // extension only: `${cacheBaseName}.js` next to `${cacheBaseName}.css`.
      // A pack with no CSS import simply never gets a `.css` entry in
      // `result.outputFiles` — confirmed empirically, no special-casing
      // needed. Nothing is actually written to `cacheDir` by esbuild itself
      // (`write: false`): this repo's own atomic temp+rename dance below is
      // what lands the file(s), exactly as it already did for the script.
      outdir: cacheDir,
      entryNames: cacheBaseName,
      // Pins esbuild's own idea of "the current directory" to the pack's
      // folder. Without this, `lib/browser.js` falls back to its default
      // (effectively `.`), and a resolution path that reaches esbuild's
      // OWN internal directory-walking logic — even briefly, before a
      // plugin's `onResolve` result is applied — tries to read that
      // literal `.` and fails with `Cannot read directory ".": not
      // implemented on js` (there is no real filesystem in this mode).
      // `virtualSourcePlugin`'s `onResolve` now always returns a
      // definitive result (never `undefined`) so esbuild's own resolver
      // is never reached at all; this option is kept anyway as a second,
      // independent guard against the same failure mode.
      absWorkingDir: pack.folder,
      format: 'iife',
      platform: 'browser',
      // VS Code 1.90 ships Electron 29 / Chromium 122 (matches
      // esbuild.config.mjs's webviewBuild target); the same target is a
      // safe floor for any other browser-embedded host too.
      target: 'chrome122',
      jsx: 'transform',
      jsxFactory: '__markiiJSX.createElement',
      jsxFragment: '__markiiJSX.Fragment',
      // Bypasses esbuild's own tsconfig.json AUTO-DISCOVERY (it otherwise
      // walks up from `resolveDir` — the pack's own folder — looking for
      // one, and could find a HOST'S OWN `tsconfig.json`, whose `jsx`
      // compiler option would silently override the
      // `jsx`/`jsxFactory`/`jsxFragment` options above, re-introducing the
      // automatic runtime and its `react/jsx-runtime` import this builder
      // exists to avoid — confirmed empirically: without this, the output
      // ships a full bundled copy of React's development JSX runtime). An
      // empty inline config is deliberate: a pack's own source has no
      // business being compiled against ITS host's unrelated TypeScript
      // settings anyway.
      tsconfigRaw: '{}',
      banner: { js: REACT_SHIM_BANNER },
      plugins: [
        lazyGlobalModulePlugin(),
        virtualSourcePlugin(pack.manifest.name, fileContents, jailRealRoot),
      ],
      logLevel: 'silent',
    });
    const outputFiles = result.outputFiles ?? [];
    // The main script is always the FIRST output file esbuild produces for
    // a single-entry build, script before any co-emitted asset (confirmed
    // empirically, and unaffected by whether a CSS file also came out) —
    // kept as an index lookup (not a `.js`-suffix `find`) so the fast,
    // fake-`build`-backed unit tests (`pack-build.test.ts`, which use an
    // opaque `path: '<stdout>'` and never touch real esbuild-wasm) keep
    // working unchanged.
    const output = outputFiles[0];
    if (!output) {
      const messages = (result.errors ?? []).map((e) => e.text).join('; ');
      return {
        kind: 'failed',
        reason: messages || 'esbuild-wasm produced no output',
      };
    }
    scriptText = output.text;
    stylesheetText = outputFiles
      .slice(1)
      .find((file) => file.path.endsWith('.css'))?.text;
  } catch (err) {
    return { kind: 'failed', reason: describeThrown(err) };
  }

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeCacheFileAtomic(cachePath, scriptText);
    if (stylesheetText !== undefined) {
      await writeCacheFileAtomic(cssCachePath, stylesheetText);
    }
    // The sidecar records the FULL, real file set this build actually
    // touched (`fileContents`, mutated in place by `virtualSourcePlugin` as
    // it resolved) — written last, after the cache file(s) it protects
    // already exist, so a crash between the two never leaves a sidecar
    // pointing at a script that was never written.
    await writeCacheFileAtomic(
      sidecarPath,
      JSON.stringify(buildSidecar(fileContents)),
    );
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not write cache file: ${describeThrown(err)}`,
    };
  }

  return {
    kind: 'built',
    scriptPath: cachePath,
    ...(stylesheetText !== undefined
      ? {
          stylesheetPath: cssCachePath,
          warnings: lintPackCss(pack.manifest.name, stylesheetText),
        }
      : { warnings: [] }),
  };
}

/** Writes `text` to `targetPath` via the same temp-file-then-rename dance for every cache file this module writes (script or stylesheet): a partially-written file is never observable at `targetPath`, and a concurrent build that already won the race (another process/window building the same content-addressed path first) is treated as success rather than an error. */
async function writeCacheFileAtomic(
  targetPath: string,
  text: string,
): Promise<void> {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, text, 'utf8');
  try {
    await rename(tempPath, targetPath);
  } catch {
    await unlink(tempPath).catch(() => undefined);
  }
}

/**
 * The `'built'` outcome for a cache HIT: `cachePath` (the script) already
 * exists, so no esbuild-wasm invocation happens at all. `cssCachePath` is
 * checked the same way — its presence or absence reflects whether THIS
 * exact cache key's build produced a stylesheet, since both files share one
 * content-hash base name. When present, its text is read back and re-linted
 * (`lintPackCss`) — cheap string analysis, so re-running it on every cache
 * hit keeps a developer informed on every panel (re)open, not only the
 * first time a pack was ever compiled in this environment.
 */
async function builtOutcomeFromCache(
  pack: PackBuildSource,
  cachePath: string,
  cssCachePath: string,
): Promise<PackBuildOutcome> {
  if (!existsSync(cssCachePath)) {
    return { kind: 'built', scriptPath: cachePath, warnings: [] };
  }
  let cssText: string | undefined;
  try {
    cssText = await nodeReadFile(cssCachePath, 'utf8');
  } catch {
    cssText = undefined;
  }
  if (cssText === undefined) {
    return { kind: 'built', scriptPath: cachePath, warnings: [] };
  }
  return {
    kind: 'built',
    scriptPath: cachePath,
    stylesheetPath: cssCachePath,
    warnings: lintPackCss(pack.manifest.name, cssText),
  };
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
