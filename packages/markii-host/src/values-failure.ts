/**
 * `ValuesFailure` is the wire-protocol shape a host uses to report one
 * script's failure back to its renderer/webview: the script's name and a
 * closed `FailureKind`, never the raw error message (the rendered page
 * shows quiet markers, never error dumps — see AGENTS.md's cleanliness
 * principle). Defined here, in the shared host layer, so every host
 * (`apps/vscode`, and any future host) and this package's own `run-flow.ts`
 * agree on a single definition instead of drifting copies; a consuming
 * app's own wire-protocol module (e.g. `apps/vscode/src/protocol.ts`) is
 * expected to import and re-export this type rather than restate it.
 */
import type { FailureKind } from '@markii/runtime';

/** One script's outcome, reduced to just its name and failure kind — never the raw error message. */
export interface ValuesFailure {
  readonly name: string;
  readonly kind: FailureKind;
}
