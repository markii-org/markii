/**
 * Compiles a pack's `.tsx` component sources into the SAME shape as a
 * hand-written `webview.js` registration script (see
 * `test-fixtures/packs/demo/webview.js`'s own doc comment for the
 * contract this must produce: a classic IIFE that reads
 * `window.__markiiReact` LAZILY and calls
 * `window.__markiiRegisterPack(manifestJson, componentModules)`).
 *
 * Why this exists: `docs/packs.md` describes a pack as source plus a
 * manifest — nothing in this repository ever produces a prebuilt
 * `webview.js` from that source. Without this module, a real pack shipped
 * as `.tsx` sources (the ordinary case) discovers cleanly (its namespace
 * and Lua modules are real — see `./discover.ts`) but contributes ZERO
 * components to the preview, so every directive under its namespace
 * silently falls through to the unknown-component fallback with no
 * explanation. `./pack-context.ts` calls `buildPackRegistrationScript` for
 * exactly that case: a discovered pack with no `webview.js` sitting next
 * to its `pack.json`.
 *
 * `vscode`-free by design (plain paths in, a result out) — the only
 * runtime dependency is `esbuild-wasm`, loaded lazily and once per process
 * (`loadEsbuildWasm`).
 *
 * ## The lazy-React contract
 *
 * A pack script loads BEFORE the main webview bundle sets
 * `window.__markiiReact` (see `../webview-html.ts`'s three-step load
 * order). Every reference this module's compiled output makes to React —
 * both a component's own JSX and any `import { useX } from 'react'` it
 * writes — must therefore read `window.__markiiReact` only from INSIDE a
 * function that runs at render time, never at the module's top level.
 * Two building blocks make that true for arbitrary component source
 * without needing to understand it:
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
 *   `fixture-integration.test.ts`: a built script is loaded into a window
 *   with `window.__markiiReact` left `undefined`, and loading it alone
 *   must not throw.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  mkdir,
  readFile as nodeReadFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { DiscoveredPack } from './discover.js';
import type { PackFileReader } from './discover.js';
import { lintPackCss } from './pack-css-lint.js';

/** esbuild-wasm's own `build` function signature — imported as a TYPE only, so this line never causes `esbuild-wasm` itself to be pulled into whatever bundles this module (see `loadEsbuildWasm`'s doc comment for why the VALUE side must never be a static import). */
type EsbuildBuildFn = typeof import('esbuild-wasm').build;

/** Bumped whenever this module's OUTPUT for the same pack sources would change (a banner/plugin tweak, an esbuild option change) — folded into the cache key (`computeCacheKey`) so a stale cached script from a previous version of this builder is never reused after an extension upgrade. */
const BUILDER_VERSION = 2;

let cachedBuildFn: EsbuildBuildFn | undefined;

/**
 * Loads esbuild-wasm's Node `build` function, lazily and once per process.
 * `mainModulePath`, when given, is an absolute path to a REAL, unbundled
 * copy of `esbuild-wasm`'s `lib/main.js` — what the packaged extension
 * supplies (`esbuild.config.mjs` copies the whole `esbuild-wasm` package
 * next to `dist/extension.js`; `preview-panel.ts` points here via
 * `context.extensionUri`). This has to be an explicit path rather than a
 * plain top-level `import 'esbuild-wasm'` because esbuild-wasm's own Node
 * API refuses to run once it has been bundled into another file: its
 * `lib/main.js` checks its own `__filename`/`__dirname` against the
 * package's real layout and throws
 * (`"The esbuild JavaScript API cannot be bundled"`) if they don't match
 * — confirmed empirically against the installed `esbuild-wasm@0.28.2`.
 * `undefined` (the default, and what every test in this file uses) lets
 * plain Node module resolution find the ordinary `esbuild-wasm` package
 * under `node_modules` — correct in dev and under Vitest, where nothing
 * has bundled it away.
 *
 * A runtime `require()` (never a static `import`) is deliberate: a static
 * `import * as esbuildWasm from 'esbuild-wasm'` at this module's top level
 * would itself be a bundlable reference, which is exactly what
 * `esbuild.config.mjs` must avoid for the SAME reason as above — this
 * module is imported (transitively) from `extension.ts`, which IS bundled
 * for the packaged extension. A `require()` reached only at runtime is
 * opaque to a bundler: it is never statically resolved or inlined, so
 * `esbuild-wasm` reaches this file only as a genuine, unbundled runtime
 * `require` — see `esbuild.config.mjs`'s `external` list for the other
 * half of this contract.
 *
 * `resolveRequire` picks HOW to get that runtime `require`, because this
 * source is authored as ESM but ships in two different module formats:
 * the packaged extension bundles it into `dist/extension.js` as CJS
 * (`esbuild.config.mjs`'s `extensionBuild`), where a real ambient
 * `require` already exists and must be used directly — `import.meta.url`
 * is EMPTY in a CJS bundle (esbuild warns exactly this at build time),
 * so `createRequire(import.meta.url)` would resolve against nothing and
 * fail. In dev/tsx and under Vitest, this file runs as genuine ESM, where
 * `require` is not ambient and `createRequire(import.meta.url)` is the
 * correct (and only) way to get one. Checking `typeof require` at runtime
 * picks the right one in either format without needing two builds of this
 * module.
 */
function resolveRequire(): NodeJS.Require {
  if (typeof require === 'function') {
    return require;
  }
  return createRequire(import.meta.url);
}

function loadEsbuildWasm(mainModulePath?: string): EsbuildBuildFn {
  if (!cachedBuildFn) {
    const req = resolveRequire();
    const specifier = mainModulePath ?? 'esbuild-wasm';
    const mod = req(specifier) as { build: EsbuildBuildFn };
    cachedBuildFn = mod.build;
  }
  return cachedBuildFn;
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

/** Module specifier -> (global property name on `window`, exported key list) for every import `lazyGlobalModulePlugin` redirects to a lazy `Proxy`. `@markii/react`'s webview bundle is the ONE place that ever sets `window.__markiiReact`/`window.__markiiReactDom` (see `../webview/main.tsx`); a pack component reads the SAME instance, never its own copy. */
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

/** An esbuild plugin (see esbuild-wasm's plugin API, identical shape to `esbuild`'s) that intercepts `import ... from 'react'` (and the other `LAZY_GLOBAL_MODULES` specifiers) and serves `lazyGlobalModuleSource` instead of resolving them from `node_modules` — so the compiled script never bundles its own copy of React, and never reads `window.__markiiReact` outside a getter/proxy trap. */
function lazyGlobalModulePlugin(): {
  name: string;
  setup: (build: {
    onResolve: (
      options: { filter: RegExp },
      callback: (args: {
        path: string;
      }) => { path: string; namespace: string } | undefined,
    ) => void;
    onLoad: (
      options: { filter: RegExp; namespace: string },
      callback: (args: { path: string }) => { contents: string; loader: 'js' },
    ) => void;
  }) => void;
} {
  const namespace = 'markii-lazy-global';
  const specifiers = new Set(LAZY_GLOBAL_MODULES.keys());
  return {
    name: 'markii-lazy-global',
    setup(build) {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
        if (!specifiers.has(args.path)) return undefined;
        return { path: args.path, namespace };
      });
      build.onLoad({ filter: /.*/, namespace }, (args) => {
        const entry = LAZY_GLOBAL_MODULES.get(args.path);
        const resolved = entry ?? {
          globalName: '__markiiReact',
          keys: REACT_KEYS,
        };
        return {
          contents: lazyGlobalModuleSource(resolved.globalName, resolved.keys),
          loader: 'js',
        };
      });
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

/** One component's declared local name and the absolute path to its source, in `manifest.components` iteration order (`Object.hasOwn`-guarded, matching `./discover.ts`'s own hostile-map discipline). */
function orderedComponents(
  pack: DiscoveredPack,
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
 * named or `default`, is a host concern per `@markii/react`'s
 * `pack-loader.ts` doc comment; taking the first function-typed export
 * covers both without requiring a convention this repo has never
 * documented), and calls `window.__markiiRegisterPack` exactly like
 * `test-fixtures/packs/demo/webview.js` does by hand.
 */
function entrySource(
  pack: DiscoveredPack,
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
 * this misses just means esbuild's own bundler (which uses REAL module
 * resolution) still finds and bundles the file correctly — only this
 * cache-key computation's ability to notice a CSS-only edit up front is
 * affected, and only for an import shape unusual enough not to match a
 * plain string-literal `.css` specifier.
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
 * The cache key for one pack's build: a SHA-256 of `BUILDER_VERSION`, the
 * manifest (stable-stringified: `Object.keys` order for a plain
 * `Record<string,string>` from `parsePackManifest`'s own construction is
 * already insertion order, and there is exactly one manifest shape), every
 * declared component's absolute path plus its own source bytes, and every
 * CSS file the component sources statically import (`cssSources`, keyed the
 * same way) — so touching any one component file, any CSS file it imports,
 * adding/removing a component, or shipping a new builder version each
 * independently invalidates the cache. Entries are sorted by path first so
 * the digest does not depend on either map's insertion order.
 */
export function computeCacheKey(
  pack: DiscoveredPack,
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

/** A cache-safe file-name fragment: the pack's namespace, already restricted to lowercase-kebab by `@markii/pack`'s `validatePackName` (`./discover.ts` never constructs a `DiscoveredPack` from a manifest that failed validation), so no further sanitizing is needed here — kept as a small local guard anyway, cheap insurance against a future relaxed namespace rule. */
function safeCacheBaseName(pack: DiscoveredPack): string {
  return pack.manifest.name.replace(/[^a-z0-9-]/g, '-') || 'pack';
}

/** What `buildPackRegistrationScript` reports. `'built'` and `'failed'` are real outcomes of an attempted build; `'skipped'` means no attempt was made at all (the default, no-op builder `./pack-context.ts` uses when no cache directory is configured) — kept distinct from `'failed'` so a caller never records a spurious "build failed" reason for a pack that simply had no build attempted. */
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
       * never thrown; `./pack-context.ts`/`./pack-diagnostics.ts` surface
       * these to the "Markii" output channel.
       */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'skipped' };

export interface PackBuildOptions {
  /** Absolute path to a real, unbundled `esbuild-wasm/lib/main.js` — forwarded to `loadEsbuildWasm`. */
  readonly esbuildMainModulePath?: string;
  /** Reads one component source file's UTF-8 text, or `undefined` if unreadable — defaults to real `node:fs`. Injected so a build-failure ("missing component source") path is testable without touching disk. */
  readonly readComponentSource?: PackFileReader;
  /** Replaces esbuild-wasm's `build` function outright — for tests that want to assert cache behavior (or a build failure) without paying for a real esbuild-wasm invocation, and for the ANY-real-invocation counting a cache-hit test needs. Bypasses `loadEsbuildWasm`/`esbuildMainModulePath` entirely when given. */
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
 * `{ kind: 'failed', reason }` — `./pack-context.ts` records that reason
 * in its `skipped` list and simply excludes the pack from `webviewPacks`,
 * the same quiet degradation as every other pack failure (AGENTS.md's
 * cleanliness rule: never a compiler error dump as page content).
 *
 * `cacheDir` is an EXTENSION-OWNED directory (`preview-panel.ts` passes
 * one derived from `ExtensionContext.globalStorageUri`) — never the pack's
 * own folder, per AGENTS.md's cleanliness rule that the user's file tree
 * stays clean. A cache hit (the built script for this exact pack content
 * already exists under `cacheDir`) skips esbuild-wasm entirely: esbuild-wasm
 * initialization is slow (roughly 600ms on first use in this environment;
 * see this file's test for the measured figure), and a warm preview open
 * must not pay that cost on every panel (re)creation.
 */
export async function buildPackRegistrationScript(
  pack: DiscoveredPack,
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
  // source genuinely needs it, esbuild's own bundler step further down will
  // fail on it with a proper reason.
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

  if (existsSync(cachePath)) {
    return await builtOutcomeFromCache(pack, cachePath, cssCachePath);
  }

  let build: EsbuildBuildFn;
  try {
    build = options.build ?? loadEsbuildWasm(options.esbuildMainModulePath);
  } catch (err) {
    return {
      kind: 'failed',
      reason: `could not load esbuild-wasm: ${describeThrown(err)}`,
    };
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
      format: 'iife',
      platform: 'browser',
      // VS Code 1.90 ships Electron 29 / Chromium 122 (matches
      // esbuild.config.mjs's webviewBuild target).
      target: 'chrome122',
      jsx: 'transform',
      jsxFactory: '__markiiJSX.createElement',
      jsxFragment: '__markiiJSX.Fragment',
      // Bypasses esbuild's own tsconfig.json AUTO-DISCOVERY (it otherwise
      // walks up from `resolveDir` — the pack's own folder — looking for
      // one, and would find THIS REPO's `apps/vscode/tsconfig.json`, whose
      // `jsx: "react-jsx"` compiler option silently overrides the
      // `jsx`/`jsxFactory`/`jsxFragment` options above, re-introducing the
      // automatic runtime and its `react/jsx-runtime` import this builder
      // exists to avoid — confirmed empirically: without this, the output
      // ships a full bundled copy of React's development JSX runtime). An
      // empty inline config is deliberate: a pack's own source has no
      // business being compiled against ITS host's unrelated TypeScript
      // settings anyway.
      tsconfigRaw: '{}',
      banner: { js: REACT_SHIM_BANNER },
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx' },
      plugins: [lazyGlobalModulePlugin() as never],
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
  pack: DiscoveredPack,
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
