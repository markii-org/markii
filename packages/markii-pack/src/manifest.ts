import { validateLocalComponentName, validatePackName } from './namespace.js';
import { PACK_COMPONENT_KINDS } from './components.js';
import type { PackComponentEntry, PackComponentKind } from './components.js';

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
 * component name to either a pack-relative source path (the string
 * shorthand) or an object carrying that source plus optional `description`/
 * `kind` metadata (see `./components.ts`, `resolvePackComponent`,
 * `packComponents`).
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
  /**
   * Local component name -> a pack-relative source path, or an object
   * naming that source plus optional `description`/`kind` metadata. Read
   * this map only through `resolvePackComponent`/`packComponents`
   * (`./components.ts`) rather than inspecting entries directly — that is
   * the one place both forms are normalized.
   */
  components: Record<string, PackComponentEntry>;
}

export type PackManifestParseResult =
  | { ok: true; manifest: PackManifest; warnings: string[] }
  | { ok: false; errors: string[] };

const KNOWN_TOP_LEVEL_KEYS = new Set(['name', 'engine', 'components']);

// The keys a component's object-form entry may carry, and which of those
// are required. Mirrors KNOWN_TOP_LEVEL_KEYS's role for the manifest root:
// an unrecognized key here is a forward-compatible warning, not an error.
const KNOWN_COMPONENT_KEYS = new Set(['source', 'description', 'kind']);
// Checked against ./components.ts's single runtime list rather than a second
// copy of the three values, so the validator and the accessor can never
// disagree about what a valid `kind` is.
const PACK_COMPONENT_KIND_SET: ReadonlySet<string> = new Set(
  PACK_COMPONENT_KINDS,
);

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
  //
  // Each entry is either the string shorthand (a pack-relative source path)
  // or an object form { source, description?, kind? }. A malformed entry —
  // wrong value type, invalid key, bad `kind`, non-string `description`,
  // missing/empty `source` in object form — pushes an error and rejects the
  // WHOLE manifest, matching this file's existing posture for a bad
  // top-level field. An unrecognized key INSIDE a component object is a
  // forward-compatible warning, the same posture KNOWN_TOP_LEVEL_KEYS uses
  // for the manifest root. Only the checked, sanitized fields are ever
  // copied into `result`/the rebuilt component object — the raw parsed
  // value is never stored, so an unknown or hostile key on a component
  // object can never surface later even as inert data.
  let components: Record<string, PackComponentEntry> | undefined;
  if (!Object.hasOwn(obj, 'components')) {
    errors.push('"components" is required');
  } else if (!isPlainObject(obj.components)) {
    errors.push('"components" must be an object');
  } else {
    const componentsObj = obj.components;
    const result: Record<string, PackComponentEntry> = {};
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

      if (typeof value === 'string') {
        if (value.length === 0) {
          errors.push(
            `"components.${key}" must be a non-empty string (a pack-relative source path) or an object with a "source" field`,
          );
          componentsValid = false;
          continue;
        }
        // Only the type is checked here, matching @markii/bundle's
        // `document` field: path-jailing a pack-relative source path is a
        // filesystem concern for the later registry-loading slice, not
        // this contract-only one. Object.hasOwn above already keeps
        // prototype members out of `result`.
        result[key] = value;
        continue;
      }

      if (!isPlainObject(value)) {
        errors.push(
          `"components.${key}" must be a non-empty string (a pack-relative source path) or an object with a "source" field`,
        );
        componentsValid = false;
        continue;
      }

      // Object form: validate source (required), description (optional),
      // kind (optional), and rebuild a sanitized object rather than storing
      // the raw parsed one — the same discipline as the string-form branch
      // and as the top-level Object.hasOwn guarding throughout this file.
      let entryValid = true;

      const source = Object.hasOwn(value, 'source') ? value.source : undefined;
      if (typeof source !== 'string' || source.length === 0) {
        errors.push(
          `"components.${key}.source" must be a non-empty string (a pack-relative source path)`,
        );
        entryValid = false;
      }

      let description: string | undefined;
      if (Object.hasOwn(value, 'description')) {
        const rawDescription = value.description;
        if (typeof rawDescription !== 'string' || rawDescription.length === 0) {
          errors.push(
            `"components.${key}.description" must be a non-empty string`,
          );
          entryValid = false;
        } else {
          description = rawDescription;
        }
      }

      let kind: PackComponentKind | undefined;
      if (Object.hasOwn(value, 'kind')) {
        const rawKind = value.kind;
        if (
          typeof rawKind !== 'string' ||
          !PACK_COMPONENT_KIND_SET.has(rawKind)
        ) {
          errors.push(
            `"components.${key}.kind" must be one of "inline", "leaf", "container"`,
          );
          entryValid = false;
        } else {
          kind = rawKind as PackComponentKind;
        }
      }

      for (const componentKey of Object.keys(value)) {
        if (
          Object.hasOwn(value, componentKey) &&
          !KNOWN_COMPONENT_KEYS.has(componentKey)
        ) {
          warnings.push(
            `unknown pack component key "components.${key}.${componentKey}" (ignored by this implementation)`,
          );
        }
      }

      if (!entryValid) {
        componentsValid = false;
        continue;
      }

      // The object form is kept as an object even when neither optional
      // field was present — only the string shorthand collapses to a bare
      // string. This preserves the author's declared form rather than
      // silently normalizing `{ "source": "./x.tsx" }` into `"./x.tsx"`.
      const sanitized: {
        source: string;
        description?: string;
        kind?: PackComponentKind;
      } = { source: source as string };
      if (description !== undefined) sanitized.description = description;
      if (kind !== undefined) sanitized.kind = kind;
      result[key] = sanitized;
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
