import type { PackManifest } from '@markii/pack';
import {
  composeDirectiveName,
  detectNamespaceCollisions,
  packComponentsForEngine,
  packDeclaredEngines,
  packSupportsEngine,
} from '@markii/pack';
import type {
  AnsiComponent,
  AnsiComponentProps,
  AnsiRegistry,
  AnsiRegistryEntry,
  AnsiRenderContext,
  DirectiveAttributes,
} from './registry.js';
import { createAnsiRegistry, mergeAnsiRegistries } from './registry.js';
import { stripControlCharacters } from './sanitize.js';

/**
 * This engine's id in a pack manifest's per-component `sources` map
 * (docs/packs.md). A component with an `ansi` source has a terminal view.
 */
export const ANSI_ENGINE_ID = 'ansi';

/**
 * The component modules a host hands to `loadAnsiPack`, keyed by the
 * manifest's LOCAL component name. Each is the `{ component, inline? }`
 * pair a pack's `terminal.js` registered (`./pack-script.ts`).
 */
export type AnsiPackComponentModules = Record<string, AnsiRegistryEntry>;

/** The deepest a stored value is walked when sanitizing it for a pack. */
const MAX_SANITIZE_DEPTH = 16;

/**
 * Returns `value` with every string in it run through
 * `stripControlCharacters`, so a pack that prints a stored value cannot
 * print a control character a script smuggled in. Arrays and plain objects
 * are copied (null-prototype for objects, hasOwn-guarded), never mutated.
 * Anything past `MAX_SANITIZE_DEPTH`, and every non-JSON value, becomes
 * `undefined`. Never throws: a throwing getter reads as `undefined`.
 */
export function sanitizeValueForPack(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return undefined;
  if (typeof value === 'string') return stripControlCharacters(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValueForPack(item, depth + 1));
    }
    if (typeof value === 'object') {
      const out = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(value, key)) continue;
        out[stripControlCharacters(key)] = sanitizeValueForPack(
          (value as Record<string, unknown>)[key],
          depth + 1,
        );
      }
      return out;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** A copy of `attributes` with every string value (and key) stripped of control characters. A bare attribute stays `null`. */
function sanitizeAttributes(
  attributes: DirectiveAttributes,
): DirectiveAttributes {
  const out: DirectiveAttributes = Object.create(null) as DirectiveAttributes;
  try {
    for (const key of Object.keys(attributes)) {
      if (!Object.hasOwn(attributes, key)) continue;
      const raw = attributes[key];
      out[stripControlCharacters(key)] =
        typeof raw === 'string' ? stripControlCharacters(raw) : raw;
    }
  } catch {
    // A hostile attribute object yields whatever copied so far.
  }
  return out;
}

/**
 * The ctx a pack component receives: the engine's ctx with `resolve` and
 * `data` replaced by sanitized-copy versions. `ctx.text` stays the engine's
 * sanitizer, the way a pack prints any other string it composes.
 */
function packContext(ctx: AnsiRenderContext): AnsiRenderContext {
  const packCtx: AnsiRenderContext = {
    ...ctx,
    resolve: (name) => {
      const resolution = ctx.resolve(name);
      return {
        ...resolution,
        value: sanitizeValueForPack(resolution.value),
        ...(resolution.error !== undefined
          ? { error: stripControlCharacters(resolution.error) }
          : {}),
      };
    },
  };
  if ('data' in ctx) packCtx.data = sanitizeValueForPack(ctx.data);
  if (ctx.dataError !== undefined) {
    packCtx.dataError = stripControlCharacters(ctx.dataError);
  }
  return packCtx;
}

/**
 * Wraps a pack's component so the engine, not the pack, decides what text
 * reaches it. The wrapper sanitizes the attributes and the stored-value
 * view of the ctx before calling the pack, and a throw inside the pack's
 * render is contained by the walk's existing per-component boundary.
 *
 * This bounds what AUTHOR text can do through a pack. It cannot bound the
 * pack's own code: a terminal pack runs in the host's process with the
 * host's privileges and can write to stdout itself (docs/security.md).
 */
function wrapPackComponent(component: AnsiComponent): AnsiComponent {
  // Called as a plain function, like every registry component: it returns
  // a string or an Ink element (the engine lays the element out at the
  // directive's width). Components the pack's view renders INSIDE that
  // element are ordinary React components and may use hooks.
  return function PackComponent(
    props: AnsiComponentProps,
  ): ReturnType<AnsiComponent> {
    return component({
      attributes: sanitizeAttributes(props.attributes),
      children: props.children,
      ctx: packContext(props.ctx),
    });
  };
}

/** What `loadAnsiPack` reports about a pack it could not run. */
export interface LoadAnsiPackResult {
  registry: AnsiRegistry;
  /** Present when the pack has components but none has an `ansi` source: the pack contributes nothing. `engine` names the engines it does declare. */
  dropped?: { name: string; engine: string };
}

/**
 * Loads one pack's terminal components into a namespaced `AnsiRegistry`,
 * mirroring `@markii/react`'s `loadPack`: gating is per component (only
 * components with an `ansi` source register; the rest fall back to the
 * unknown-component box), a manifest component with no module is skipped,
 * a stray module is ignored, and a declared `kind` decides the `inline`
 * flag. Reads are `Object.hasOwn`-guarded. Never throws.
 */
export function loadAnsiPack(
  manifest: PackManifest,
  componentModules: AnsiPackComponentModules,
): LoadAnsiPackResult {
  if (!packSupportsEngine(manifest, ANSI_ENGINE_ID)) {
    return {
      registry: createAnsiRegistry(),
      dropped: { name: manifest.name, engine: packDeclaredEngines(manifest) },
    };
  }

  const entries: AnsiRegistry = {};
  for (const { localName, kind } of packComponentsForEngine(
    manifest,
    ANSI_ENGINE_ID,
  )) {
    if (!Object.hasOwn(componentModules, localName)) continue;
    const module = componentModules[localName];
    if (module == null || typeof module.component !== 'function') continue;
    const composed = composeDirectiveName(manifest.name, localName);
    if (!composed.ok) continue;

    const entry: AnsiRegistryEntry = {
      component: wrapPackComponent(module.component),
    };
    const inline = kind === undefined ? module.inline : kind === 'inline';
    if (inline !== undefined) entry.inline = inline;
    entries[composed.name] = entry;
  }
  return { registry: createAnsiRegistry(entries) };
}

/** One pack ready to install: its manifest plus its registered component modules. */
export interface AnsiPackToInstall {
  manifest: PackManifest;
  componentModules: AnsiPackComponentModules;
}

export type InstallAnsiPacksResult =
  | {
      ok: true;
      registry: AnsiRegistry;
      dropped: { name: string; engine: string }[];
    }
  | { ok: false; collisions: readonly string[] };

/**
 * Installs several packs into one registry on top of `base`, rejecting the
 * whole install when two share a namespace (the install-time rule in
 * docs/packs.md), exactly like `@markii/react`'s `installPacks`. A host
 * that wants keep-first behavior (a bundled pack wins over a user pack of
 * the same namespace) filters the list before calling.
 */
export function installAnsiPacks(
  packs: readonly AnsiPackToInstall[],
  base: AnsiRegistry = createAnsiRegistry(),
): InstallAnsiPacksResult {
  const collisions = detectNamespaceCollisions(
    packs.map((pack) => pack.manifest.name),
  );
  if (collisions.length > 0) {
    return {
      ok: false,
      collisions: collisions.map((collision) => collision.namespace),
    };
  }
  const dropped: { name: string; engine: string }[] = [];
  const loaded = packs.map((pack) => {
    const result = loadAnsiPack(pack.manifest, pack.componentModules);
    if (result.dropped) dropped.push(result.dropped);
    return result.registry;
  });
  return { ok: true, registry: mergeAnsiRegistries(base, ...loaded), dropped };
}
