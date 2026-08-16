// This is @markii/core's browser-safe entry point: parsing and hast conversion
// only. The conformance-corpus runner (`./corpus`) touches `node:fs` and is
// Node-only tooling for tests/scripts — it lives at the `@markii/core/corpus`
// subpath instead of here so a browser bundler consuming `@markii/core` (e.g.
// via `@markii/react`) never has to reason about Node built-ins reachable from
// its entry point.
export { parse } from './parse';
export { toHast } from './to-hast';
export {
  extractScripts,
  parseMetaAttributes,
  type ScriptBlock,
} from './scripts';
