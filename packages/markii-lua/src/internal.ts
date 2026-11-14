// @markii/lua/internal: the sandbox assembly parts another workspace in this
// repository builds on. It carries NO semver promise: a name here can change
// or disappear in any release. An outside consumer should use the main entry.

export type { RequireConfig } from './require.js';
export { buildRequire } from './require.js';
