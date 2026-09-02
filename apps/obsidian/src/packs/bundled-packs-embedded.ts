/**
 * Placeholder for the three bundled packs' compiled artifacts (GitHub
 * issue #15).
 *
 * The plugin build (`../../esbuild.options.mjs`'s `buildEmbeddedBundledPacks`
 * and the `embed-bundled-packs` plugin in `createMainBuild`) compiles
 * `packs/read`, `packs/dash`, and `packs/prep` at the repo root into their
 * prebuilt form (reusing `@markii/host`'s `buildPackRegistrationScript` —
 * no second compiler), JSON-encodes the result as a `BundledPackAsset[]`
 * (`./bundled-packs.ts`), and REPLACES THIS ENTIRE FILE'S CONTENTS wholesale
 * with the same one `export const` statement below, base64 payload filled
 * in. That is why the file's whole body is just this one export: the
 * build's `onLoad` swap assumes there is nothing else here to preserve.
 *
 * Running from source — Vitest, a bare `tsc --noEmit`, `npm run dev` before
 * the plugin build has run — sees this empty placeholder instead.
 * `./bundled-packs.ts`'s `decodeBundledPackAssets` treats an empty string
 * exactly like "no bundled packs": it returns `[]`, and every caller
 * degrades to "nothing bundled" rather than throwing.
 *
 * Nothing else may ever be added to this file. Its contents are replaced,
 * not appended to or read for anything beyond this one name.
 */

export const EMBEDDED_BUNDLED_PACKS_BASE64: string = '';
