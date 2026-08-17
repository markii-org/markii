/**
 * docs/security.md ("Security model"): "Grants are remembered per note, keyed
 * by a hash of the note's full *executable closure* — its inline scripts,
 * `src=` script files, required bundle-local modules, vault-library
 * modules, and the versions of any pack modules it requires. If any of that
 * code changes, the grant is stale and the host re-prompts; otherwise
 * edited shared code would silently inherit grants that were made to
 * different code."
 *
 * This module is that hash. It is deliberately inert: nothing here parses
 * markdown, reads a file, or touches the network — the host (the piece that
 * already knows how to walk a note's scripts, resolve its `src=` files,
 * follow its `require`s into the bundle and the vault library, and read the
 * installed pack manifest) assembles a `GrantClosure` and hands it in.
 * `@markii/core`'s `ScriptBlock` is NOT imported here on purpose — this
 * package stays independent of the parser layer (see AGENTS.md's import
 * rule); `GrantClosureScript` below is a local structural type that mirrors
 * the fields that matter to the closure.
 *
 * ## Canonical serialization ("markii-grant-key/1")
 *
 * `computeGrantKey` serializes a `GrantClosure` to a single byte string and
 * returns the lowercase hex SHA-256 digest of those bytes. The byte string
 * is built as follows, and a second implementation (in any language) that
 * follows this precisely reproduces byte-identical output for the same
 * closure:
 *
 * Primitives:
 * - `u32(n)`: 4 bytes, big-endian unsigned.
 * - `str(s)`: `u32(byteLength)` followed by `s`'s UTF-8 bytes, where
 *   `byteLength` is the UTF-8 *byte* length (as `TextEncoder` would
 *   produce), never the string's UTF-16 code-unit `.length`. Every string
 *   in the closure is framed this way — a length prefix, not a delimiter —
 *   specifically so no delimiter character embedded in a name, path, or
 *   source text can ever be mistaken for a field or section boundary.
 * - `opt(s)`: one tag byte — `0x00` if `s` is `undefined`, `0x01` followed
 *   by `str(s)` if it is present. This is what makes an absent optional
 *   field distinguishable from one holding `""`  (`opt(undefined)` is one
 *   byte; `opt("")` is `0x01` + `u32(0)`, five bytes).
 *
 * A *record* is the concatenation of its fields' encodings, in the fixed
 * field order given below — records never carry their own outer length
 * prefix, because their field-level length prefixes already make the byte
 * stream self-delimiting given the record's known schema.
 *
 * A *set* of same-shaped records (used for anything that is conceptually
 * unordered — an array of scripts, the entries of a `Record<string, …>`
 * map) is encoded as `u32(count)` followed by each record's bytes, IN
 * ASCENDING ORDER OF THE RECORD'S OWN ENCODED BYTES (lexicographic,
 * shorter-is-less on equal prefix). Sorting by encoded bytes rather than by
 * some "obvious" key (a name, a path) is what makes the digest depend only
 * on the closure's *content*, never on the order the host happened to
 * collect scripts in, or a `Record`'s key iteration order.
 *
 * A *section* is `tag(1 byte)` + a set, where `tag` is a fixed per-section
 * constant (`0x01` scripts, `0x02` bundle modules, `0x03` vault modules,
 * `0x04` packs). The tag exists so that two structurally different record
 * shapes (e.g. a 2-field module record vs. a 4-field script record) can
 * never be confused for each other even if some pathological input made
 * their encoded byte counts coincide.
 *
 * The whole closure is:
 *
 * ```
 * str("markii-grant-key/1")            // scheme/version marker
 * section(0x01, scripts)                // GrantClosureScript records:
 *                                        //   str(name) str(lang) opt(src) str(code)
 * section(0x02, bundleModules)          // module records: str(path) str(source)
 * section(0x03, vaultModules)           // namespace records:
 *                                        //   str(namespace) + moduleSet
 *                                        //   (moduleSet = u32(count) + sorted
 *                                        //   module records: str(path) str(source);
 *                                        //   note: no section tag inside — it's
 *                                        //   nested in an already-tagged section)
 * section(0x04, packs)                  // pack records:
 *                                        //   str(namespace) str(version) opt-flag(1 byte)
 *                                        //   + moduleSet only when the flag is 0x01
 * ```
 *
 * `SHA-256(bytes)`, rendered as 64 lowercase hex characters, is the grant
 * key. Bumping `markii-grant-key/1` to `/2` (or later) is how a future
 * change to this scheme is made explicit and visible — any consumer keying
 * off the literal string sees a different marker rather than a silent
 * reinterpretation of old digests.
 */

/**
 * One of the note's own script blocks — the inline `` ```lang {name=...}
 * `` `` fences and the `src=`-referenced ones, in any order. Mirrors the
 * fields of `@markii/core`'s `ScriptBlock` that are part of what actually
 * *executes* (not `publish` or `position`, which don't change what code
 * runs). Deliberately a local type — see this module's top doc comment for
 * why `@markii/core` is never imported here.
 */
export interface GrantClosureScript {
  /** The script fence's `name=` attribute — the value-store key it writes to. */
  name: string;
  /** The fence's language tag (e.g. `"lua"`), or `""` if the fence had none. */
  lang: string;
  /**
   * Bundle-relative path when this block is a `src=` reference to a
   * long-script file; `undefined` for an inline block. The referenced
   * file's own source text is NOT here — it belongs in `bundleModules`,
   * keyed by this same path, so its content participates in the closure
   * too.
   */
  src?: string;
  /**
   * The fence's own body text. Empty (`""`) for a `src=` reference, whose
   * code lives in the referenced file instead.
   */
  code: string;
}

/**
 * One installed pack's identity, plus its module sources when the host has
 * them. A pack's `version` alone must move the key even if the host never
 * fetched its source — docs/security.md keys the grant to "the versions of any
 * pack modules it requires", not only to code the host happens to have
 * bytes for.
 */
export interface GrantClosurePack {
  /** The pack's namespace (its directive-resolution prefix). */
  namespace: string;
  /** The installed version string (semver or otherwise). */
  version: string;
  /**
   * Module path -> source text, when the host has resolved the pack's
   * module sources. Omit the field entirely (not `{}`) when the host only
   * knows the pack's identity, not its code — an empty map and "no map"
   * are different closures and must hash differently.
   */
  modules?: Record<string, string>;
}

/**
 * The full executable closure a grant is keyed to (docs/security.md). Every
 * field here must be populated by the host from whatever it has already
 * resolved; `computeGrantKey` does no resolution of its own.
 */
export interface GrantClosure {
  /** The note's own script blocks — inline and `src=`-referenced, in any order. */
  scripts: GrantClosureScript[];
  /**
   * Bundle-relative script-file path -> source text, for every bundle-local
   * module the closure requires: `src=` targets, and any modules those
   * files (transitively) `require`.
   */
  bundleModules: Record<string, string>;
  /**
   * Vault-library module sources, keyed by vault namespace, then by module
   * path -> source text.
   */
  vaultModules: Record<string, Record<string, string>>;
  /** Installed pack modules the closure requires. */
  packs: GrantClosurePack[];
}

const SCHEME_VERSION = 'markii-grant-key/1';

const SECTION_TAG = {
  scripts: 0x01,
  bundleModules: 0x02,
  vaultModules: 0x03,
  packs: 0x04,
} as const;

const textEncoder = new TextEncoder();

/**
 * Concatenates byte chunks into ONE freshly allocated buffer. The return
 * type is pinned to `Uint8Array<ArrayBuffer>` (never the default
 * `ArrayBufferLike`, which also admits `SharedArrayBuffer`) by allocating
 * through an explicit `new ArrayBuffer` — that is what lets the digest call
 * in `computeGrantKey` pass this straight to `SubtleCrypto.digest`, whose
 * `BufferSource` parameter excludes shared memory, with no cast anywhere.
 */
function concatBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** `u32(n)`: 4 bytes, big-endian. See the module doc comment's canonical form. */
function encodeU32(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, false);
  return bytes;
}

/**
 * `str(s)`: length-prefixed UTF-8 bytes. The prefix is the UTF-8 BYTE
 * length (via `TextEncoder`), never `s.length` (UTF-16 code units) — this
 * is what keeps multi-byte text framed correctly.
 */
function encodeString(value: string): Uint8Array {
  const bytes = textEncoder.encode(value);
  return concatBytes([encodeU32(bytes.length), bytes]);
}

/** `opt(s)`: one tag byte, then `str(s)` only when present. See top doc comment. */
function encodeOptionalString(value: string | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array([0x00]);
  return concatBytes([new Uint8Array([0x01]), encodeString(value)]);
}

/** Lexicographic byte-array comparison: shorter-is-less on equal prefix. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/** Sorts records by their own encoded bytes — never by an original array/map order. */
function sortRecords(records: readonly Uint8Array[]): Uint8Array[] {
  return [...records].sort(compareBytes);
}

/** `section(tag, records)`: 1 tag byte + `u32(count)` + sorted record bytes. */
function encodeSection(
  tag: number,
  records: readonly Uint8Array[],
): Uint8Array {
  const sorted = sortRecords(records);
  return concatBytes([
    new Uint8Array([tag]),
    encodeU32(sorted.length),
    ...sorted,
  ]);
}

function encodeScriptRecord(script: GrantClosureScript): Uint8Array {
  return concatBytes([
    encodeString(script.name),
    encodeString(script.lang),
    encodeOptionalString(script.src),
    encodeString(script.code),
  ]);
}

function encodeModuleRecord(path: string, source: string): Uint8Array {
  return concatBytes([encodeString(path), encodeString(source)]);
}

/** `moduleSet`: `u32(count)` + sorted `str(path) str(source)` records. No section tag — always nested inside an already-tagged section/record. */
function encodeModuleSet(modules: Record<string, string>): Uint8Array {
  const records = Object.entries(modules).map(([path, source]) =>
    encodeModuleRecord(path, source),
  );
  const sorted = sortRecords(records);
  return concatBytes([encodeU32(sorted.length), ...sorted]);
}

function encodeVaultNamespaceRecord(
  namespace: string,
  modules: Record<string, string>,
): Uint8Array {
  return concatBytes([encodeString(namespace), encodeModuleSet(modules)]);
}

function encodePackRecord(pack: GrantClosurePack): Uint8Array {
  const modules = pack.modules;
  return concatBytes([
    encodeString(pack.namespace),
    encodeString(pack.version),
    new Uint8Array([modules === undefined ? 0x00 : 0x01]),
    modules === undefined ? new Uint8Array(0) : encodeModuleSet(modules),
  ]);
}

function encodeClosure(closure: GrantClosure): Uint8Array<ArrayBuffer> {
  const scriptRecords = closure.scripts.map(encodeScriptRecord);
  const bundleRecords = Object.entries(closure.bundleModules).map(
    ([path, source]) => encodeModuleRecord(path, source),
  );
  const vaultRecords = Object.entries(closure.vaultModules).map(
    ([namespace, modules]) => encodeVaultNamespaceRecord(namespace, modules),
  );
  const packRecords = closure.packs.map(encodePackRecord);

  return concatBytes([
    encodeString(SCHEME_VERSION),
    encodeSection(SECTION_TAG.scripts, scriptRecords),
    encodeSection(SECTION_TAG.bundleModules, bundleRecords),
    encodeSection(SECTION_TAG.vaultModules, vaultRecords),
    encodeSection(SECTION_TAG.packs, packRecords),
  ]);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes the grant key for a note's executable closure (docs/security.md):
 * the lowercase hex SHA-256 digest of the closure's canonical serialization
 * — see this module's top doc comment for the exact byte form. Pure and
 * side-effect free: this function does not parse, fetch, or read anything;
 * the host must have already assembled `closure` from the note's scripts,
 * resolved `src=`/`require` targets, and installed pack manifest.
 *
 * Uses `globalThis.crypto.subtle` (Web Crypto — available in Node >=20 and
 * every browser) rather than `node:crypto`, so this package stays
 * browser-safe with no added dependency.
 */
export async function computeGrantKey(closure: GrantClosure): Promise<string> {
  const bytes = encodeClosure(closure);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}
