import { validateLocalComponentName, validatePackName } from './namespace.js';
import {
  PACK_ATTRIBUTE_NAME_PATTERN,
  PACK_COMPONENT_KINDS,
  isPackAttributeName,
} from './components.js';
import type {
  PackComponentAttribute,
  PackComponentEntry,
  PackComponentKind,
} from './components.js';

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
 * `kind`/`attributes` metadata (see `./components.ts`,
 * `resolvePackComponent`, `packComponents`).
 *
 * `components` may be an EMPTY object. There is exactly one way to share
 * Lua beyond a bundle's own `scripts/` folder: a pack module. A folder of
 * shared Lua with nothing to render is simply a pack whose `components`
 * is `{}` and which carries its own `scripts/*.lua` — it contributes zero
 * directives and never appears in a component catalog, but its modules
 * still resolve through `require "name/module"` like any other pack's.
 *
 * Shared Lua modules are NOT a manifest field. docs/packs.md says they
 * travel under a conventional `scripts/` directory inside the pack
 * (`require "ana/http"`), the same way a bundle's `scripts/` works — there
 * is no separate manifest declaration for them, so this type doesn't add
 * one.
 *
 * `version` is an OPTIONAL fourth field: a plain semver string
 * (`MAJOR.MINOR.PATCH`, digits only, no leading zeros on a multi-digit
 * component — see `SEMVER_PATTERN`). A pack that omits it keeps loading
 * exactly as before, with no warning. Prerelease/build suffixes
 * (`-beta.1`, `+build5`) are deliberately NOT accepted: AGENTS.md already
 * commits this project to "plain semver" for spec versioning, and a pack
 * version exists so a host can compare/display it, not to drive a resolver
 * that needs prerelease ordering. Accepting a wider grammar than the one
 * fact this field is for would be a casual-user-facing complication with
 * no present consumer. A malformed `version` is an ERROR, not a
 * forward-compatible warning, the same posture `name` gets: a version a
 * host cannot trust is worse than no version.
 */
export interface PackManifest {
  /** The pack's namespace, e.g. `"ana"`. See `validatePackName`. */
  name: string;
  /** The renderer framework the pack's components target, e.g. `"react"`. */
  engine: string;
  /**
   * Local component name -> a pack-relative source path, or an object
   * naming that source plus optional `description`/`kind`/`attributes`
   * metadata. Read
   * this map only through `resolvePackComponent`/`packComponents`
   * (`./components.ts`) rather than inspecting entries directly — that is
   * the one place both forms are normalized.
   */
  components: Record<string, PackComponentEntry>;
  /**
   * Optional plain-semver version string, e.g. `"1.0.0"`. Absent unless
   * the pack author declared one. See this interface's doc comment for
   * the accepted grammar and why prerelease/build suffixes are rejected.
   */
  version?: string;
}

export type PackManifestParseResult =
  | { ok: true; manifest: PackManifest; warnings: string[] }
  | { ok: false; errors: string[] };

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'name',
  'engine',
  'components',
  'version',
]);

// Plain semver only: MAJOR.MINOR.PATCH, digits only, no leading zeros on a
// multi-digit component ("1.0.0" and "0.0.1" are valid; "01.0.0" is not).
// No prerelease or build metadata suffix — see PackManifest's doc comment
// for why this field deliberately does not accept the wider semver grammar.
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// The keys a component's object-form entry may carry, and which of those
// are required. Mirrors KNOWN_TOP_LEVEL_KEYS's role for the manifest root:
// an unrecognized key here is a forward-compatible warning, not an error.
const KNOWN_COMPONENT_KEYS = new Set([
  'source',
  'description',
  'kind',
  'attributes',
]);
// The keys one entry of a component's `attributes` array may carry. Same
// posture as KNOWN_COMPONENT_KEYS one level up: an unrecognized key is a
// forward-compatible warning, everything recognized is validated strictly.
const KNOWN_ATTRIBUTE_KEYS = new Set([
  'name',
  'description',
  'required',
  'values',
  'default',
]);
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
 * The strict half of attribute validation (the lenient half lives in
 * `./components.ts`'s `resolveAttribute`, which a consumer may call on
 * never-validated JSON). Anything malformed here pushes an error and
 * rejects the WHOLE manifest, so a pack author is told what is wrong at
 * validation time rather than quietly losing an attribute from a
 * completion popup later.
 *
 * Returns the sanitized list, or `undefined` when anything failed. An
 * empty declared list is valid and returns `[]`; the caller drops that
 * rather than storing it, so "declared nothing" and "declared an empty
 * list" are one state downstream.
 */
function parseComponentAttributes(
  componentKey: string,
  raw: readonly unknown[],
  errors: string[],
  warnings: string[],
): PackComponentAttribute[] | undefined {
  const parsed: PackComponentAttribute[] = [];
  const seen = new Set<string>();
  let valid = true;

  for (const [index, entry] of raw.entries()) {
    const where = `"components.${componentKey}.attributes[${String(index)}]"`;

    if (!isPlainObject(entry)) {
      errors.push(`${where} must be an object with a "name" field`);
      valid = false;
      continue;
    }

    const rawName = Object.hasOwn(entry, 'name') ? entry.name : undefined;
    if (!isPackAttributeName(rawName)) {
      errors.push(
        `${where}.name must be a non-empty string matching ${PACK_ATTRIBUTE_NAME_PATTERN.source}`,
      );
      valid = false;
      continue;
    }
    if (seen.has(rawName)) {
      errors.push(`${where}.name "${rawName}" is declared more than once`);
      valid = false;
      continue;
    }
    seen.add(rawName);

    let entryValid = true;

    let description: string | undefined;
    if (Object.hasOwn(entry, 'description')) {
      const rawDescription = entry.description;
      if (typeof rawDescription !== 'string' || rawDescription.length === 0) {
        errors.push(`${where}.description must be a non-empty string`);
        entryValid = false;
      } else {
        description = rawDescription;
      }
    }

    let required: boolean | undefined;
    if (Object.hasOwn(entry, 'required')) {
      const rawRequired = entry.required;
      if (typeof rawRequired !== 'boolean') {
        errors.push(`${where}.required must be a boolean`);
        entryValid = false;
      } else {
        required = rawRequired;
      }
    }

    let values: string[] | undefined;
    if (Object.hasOwn(entry, 'values')) {
      const rawValues = entry.values;
      if (
        !Array.isArray(rawValues) ||
        rawValues.length === 0 ||
        rawValues.some(
          (value) => typeof value !== 'string' || value.length === 0,
        )
      ) {
        errors.push(
          `${where}.values must be a non-empty array of non-empty strings`,
        );
        entryValid = false;
      } else {
        values = rawValues as string[];
      }
    }

    let defaultValue: string | undefined;
    if (Object.hasOwn(entry, 'default')) {
      const rawDefault = entry.default;
      if (typeof rawDefault !== 'string' || rawDefault.length === 0) {
        errors.push(`${where}.default must be a non-empty string`);
        entryValid = false;
      } else if (values !== undefined && !values.includes(rawDefault)) {
        errors.push(
          `${where}.default "${rawDefault}" must be one of its "values": ${values.join(', ')}`,
        );
        entryValid = false;
      } else {
        defaultValue = rawDefault;
      }
    }

    for (const attributeKey of Object.keys(entry)) {
      if (
        Object.hasOwn(entry, attributeKey) &&
        !KNOWN_ATTRIBUTE_KEYS.has(attributeKey)
      ) {
        warnings.push(
          `unknown pack component attribute key ${where}.${attributeKey} (ignored by this implementation)`,
        );
      }
    }

    if (!entryValid) {
      valid = false;
      continue;
    }

    // Rebuilt rather than stored raw, the same discipline the component
    // object form uses: only checked fields ever reach the result.
    const sanitized: {
      name: string;
      description?: string;
      required?: boolean;
      values?: readonly string[];
      default?: string;
    } = { name: rawName };
    if (description !== undefined) sanitized.description = description;
    if (required !== undefined) sanitized.required = required;
    if (values !== undefined) sanitized.values = values;
    if (defaultValue !== undefined) sanitized.default = defaultValue;
    parsed.push(sanitized);
  }

  return valid ? parsed : undefined;
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
  // or an object form { source, description?, kind?, attributes? }. A
  // malformed entry — wrong value type, invalid key, bad `kind`, non-string
  // `description`, a malformed `attributes` list, missing/empty `source` in
  // object form — pushes an error and rejects the
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

      let attributes: PackComponentAttribute[] | undefined;
      if (Object.hasOwn(value, 'attributes')) {
        const rawAttributes = value.attributes;
        if (!Array.isArray(rawAttributes)) {
          errors.push(
            `"components.${key}.attributes" must be an array of attribute objects`,
          );
          entryValid = false;
        } else {
          const parsed = parseComponentAttributes(
            key,
            rawAttributes,
            errors,
            warnings,
          );
          if (parsed === undefined) {
            entryValid = false;
          } else if (parsed.length > 0) {
            attributes = parsed;
          }
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
        attributes?: readonly PackComponentAttribute[];
      } = { source: source as string };
      if (description !== undefined) sanitized.description = description;
      if (kind !== undefined) sanitized.kind = kind;
      if (attributes !== undefined) sanitized.attributes = attributes;
      result[key] = sanitized;
    }

    if (componentsValid) {
      components = result;
    }
  }

  // --- version (optional) ---
  //
  // Absent is valid and produces neither an error nor a warning. Present
  // but malformed is an ERROR (rejects the whole manifest), not a
  // forward-compatible warning: a version a host cannot trust is worse
  // than no version at all, the same posture as a malformed `name`.
  let version: string | undefined;
  let versionValid = true;
  if (Object.hasOwn(obj, 'version')) {
    const rawVersion = obj.version;
    if (typeof rawVersion !== 'string' || !SEMVER_PATTERN.test(rawVersion)) {
      errors.push(
        '"version" must be a plain semver string ("MAJOR.MINOR.PATCH", digits only, no leading zeros, no prerelease or build suffix)',
      );
      versionValid = false;
    } else {
      version = rawVersion;
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
    components === undefined ||
    !versionValid
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest:
      version === undefined
        ? { name, engine, components }
        : { name, engine, components, version },
    warnings,
  };
}
