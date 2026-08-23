import { validateLocalComponentName, validatePackName } from './namespace.js';

/**
 * `pack.json`'s contract (docs/packs.md). Three fields, all required:
 *
 *   { "name": "ana", "engine": "react",
 *     "components": { "timeline": "./Timeline.tsx" } }
 *
 * `name` is the pack's namespace (see `./namespace.ts`). `engine` names the
 * renderer framework the pack's components are written for; it is any
 * string — the host decides whether it can run it, so this package does
 * not maintain a closed enum of known engines. `components` maps a local
 * component name to a pack-relative source path.
 *
 * Shared Lua modules are NOT a manifest field. docs/packs.md says they
 * travel under a conventional `scripts/` directory inside the pack
 * (`require "ana/http"`), the same way a bundle's `scripts/` works — there
 * is no separate manifest declaration for them, so this type doesn't add
 * one. (Flagged in the slice-0 report for orchestrator sign-off in case
 * docs/packs.md meant something more explicit.)
 */
export interface PackManifest {
  /** The pack's namespace, e.g. `"ana"`. See `validatePackName`. */
  name: string;
  /** The renderer framework the pack's components target, e.g. `"react"`. */
  engine: string;
  /** Local component name -> pack-relative source path. */
  components: Record<string, string>;
}

export type PackManifestParseResult =
  | { ok: true; manifest: PackManifest; warnings: string[] }
  | { ok: false; errors: string[] };

const KNOWN_TOP_LEVEL_KEYS = new Set(['name', 'engine', 'components']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Hand-rolled `pack.json` validation (no schema library — see AGENTS.md
 * dependency policy), mirroring `@markii/bundle`'s `parseManifest` style:
 * never throws, malformed JSON or a non-object root comes back as
 * `{ ok: false, errors }`, and unrecognized top-level keys are
 * forward-compatible warnings rather than errors.
 *
 * Reads the `components` map with `Object.hasOwn` only — never a `for...in`
 * or bare property access — so a hostile manifest cannot use inherited
 * properties (`{}.toString`, etc.) to inject a component entry, and a key
 * literally named `__proto__`/`constructor`/`prototype` is validated (and
 * rejected — see `validateLocalComponentName`'s charset) like any other
 * string key, never treated as a prototype-chain write.
 */
export function parsePackManifest(json: string): PackManifestParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['pack manifest must be a JSON object'] };
  }

  const obj = raw;
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- name (required) ---
  let name: string | undefined;
  if (!Object.hasOwn(obj, 'name')) {
    errors.push('"name" is required');
  } else {
    const nameResult = validatePackName(obj.name);
    if (!nameResult.ok) {
      errors.push(`"name": ${nameResult.reason}`);
    } else {
      name = obj.name as string;
    }
  }

  // --- engine (required) ---
  let engine: string | undefined;
  if (!Object.hasOwn(obj, 'engine')) {
    errors.push('"engine" is required');
  } else if (typeof obj.engine !== 'string' || obj.engine.length === 0) {
    errors.push('"engine" must be a non-empty string');
  } else {
    engine = obj.engine;
  }

  // --- components (required) ---
  let components: Record<string, string> | undefined;
  if (!Object.hasOwn(obj, 'components')) {
    errors.push('"components" is required');
  } else if (!isPlainObject(obj.components)) {
    errors.push('"components" must be an object');
  } else {
    const componentsObj = obj.components;
    const result: Record<string, string> = {};
    let componentsValid = true;

    for (const key of Object.keys(componentsObj)) {
      if (!Object.hasOwn(componentsObj, key)) continue;

      const localNameResult = validateLocalComponentName(key);
      if (!localNameResult.ok) {
        errors.push(`"components" key "${key}": ${localNameResult.reason}`);
        componentsValid = false;
        continue;
      }

      const value = componentsObj[key];
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(
          `"components.${key}" must be a non-empty string (a pack-relative source path)`,
        );
        componentsValid = false;
        continue;
      }

      // Only the type is checked here, matching @markii/bundle's
      // `document` field: path-jailing a pack-relative source path is a
      // filesystem concern for the later registry-loading slice, not this
      // contract-only one. Object.hasOwn above already keeps prototype
      // members out of `result`.
      result[key] = value;
    }

    if (Object.keys(componentsObj).length === 0) {
      errors.push('"components" must have at least one entry');
      componentsValid = false;
    }

    if (componentsValid) {
      components = result;
    }
  }

  // --- unknown top-level keys: forward-compat warning, not an error ---
  for (const key of Object.keys(obj)) {
    if (Object.hasOwn(obj, key) && !KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(
        `unknown pack manifest key "${key}" (ignored by this implementation)`,
      );
    }
  }

  if (
    errors.length > 0 ||
    name === undefined ||
    engine === undefined ||
    components === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: { name, engine, components },
    warnings,
  };
}
