/**
 * Executes one `conformance/host/<scenario>` case (batch 11 Phase 3,
 * `tmp/W11-corpus-design.md`) against any real `HostAdapter`, so a single
 * plain-data corpus proves the three apps' adapters behave the same.
 *
 * `conformance/host/` itself stays plain data (no TypeScript, matching the
 * repo's existing corpora): a `note.mk.md`, a `scenario.json` (the ordered
 * actions), an `expected.json` (the outcomes), and an optional `files/`
 * directory. This module is the one place that reads that data, drives it
 * through a `MarkiiHost`, and reports what happened.
 *
 * THE CAPABILITY RULE (the design's crux): `ACTION_CAPABILITY` is the one
 * static map from an action's type to the capability it needs.
 * `hostDeclaresCapability` checks the map against the ADAPTER UNDER TEST,
 * never against the scenario data — the corpus itself never encodes
 * per-host knowledge. `createMarkiiHost`'s own behaviors already return the
 * shared `Unsupported` shape when a capability is missing; this module's
 * job is to know that the fact should be a PASS (the correct thing for
 * this host to say), not something to diff against `expected.json`.
 *
 * THE SCRIPTS-DISABLED SCENARIO (`10-scripts-disabled`) is not a
 * `MarkiiHost` capability at all: the device-local execution switch is
 * decided by each app's OWN call site (`preview-panel.ts`, `main.ts`)
 * before it ever reaches `host.run`, using the shared, host-neutral
 * wording in `./script-execution.js`. This module reproduces that same
 * pre-check here, over the same shared functions and the SAME
 * `adapter.labels` a real call site would use, so the scenario proves
 * wording parity across hosts without inventing a capability the contract
 * does not have. See `tmp/W11-phase3.md` for why this is a reported
 * finding, not a silent workaround.
 *
 * SIMULATED EXECUTION. A `run` action's `simulate` field (plain data) tells
 * this module what the isolate would have produced, instead of spawning a
 * real Lua worker: whether the requested value needed a specific granted
 * host, and whether it was a write blocked under the read-only tier. Real
 * sandbox enforcement is `conformance/executor/`'s job; this corpus proves
 * the HOST-LEVEL plumbing around it (grant prompts, wording, capability
 * declarations, trigger forwarding) — see this file's `simulatedRunResult`.
 * Every OTHER action runs through the real, unmocked shared behavior code.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';
import { conformanceDir } from '@markii/core/corpus';
import type { RunTrigger } from '@markii/runtime';
import {
  createMarkiiHost,
  type ExportOutcome,
  type MarkiiHost,
} from './create-host.js';
import type { RunResult, SpawnRunOptions } from '../run/run-host.js';
import type {
  HostAdapter,
  HostExportFormat,
  HostPromptRequest,
} from './adapter.js';
import {
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNotice,
} from './script-execution.js';

// --- corpus location ----------------------------------------------------

/** `conformance/host/`, resolved the same way `@markii/core/corpus`'s `conformanceDir` resolves the repo-root corpus: relative to this module's own file, never `process.cwd()`. */
export function hostConformanceDir(): string {
  return join(conformanceDir(), 'host');
}

/** Every scenario directory name under `dir`, sorted. */
export function listHostScenarioNames(
  dir: string = hostConformanceDir(),
): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// --- scenario / expected schema ------------------------------------------

/** A `run` action's stand-in for what a real isolate would have produced — see this file's top comment. */
export interface RunSimulation {
  /** The script/value name the simulated run reports on. */
  readonly name: string;
  /** The value a successful simulated run stores. Defaults to `1`. */
  readonly value?: number;
  /** A host that must be in the run's granted allowlist for the value to land; otherwise the simulated run reports `'capability-denied'`. */
  readonly requiresHost?: string;
  /** `true` for a simulated write: the run reports `'tier-blocked'` under any trigger but `'manual'`, regardless of grants. */
  readonly requiresManualTier?: boolean;
}

export type HostScenarioAction =
  | { readonly type: 'open' }
  | {
      readonly type: 'run';
      readonly trigger: RunTrigger;
      /** `"allow"`/`"deny"`, consumed by the grant flow's prompts, in order, across the WHOLE scenario (see `createAnswerQueue`). */
      readonly answers?: readonly string[];
      /** When `true`, this action never reaches `host.run` at all — see this file's top comment on the scripts-disabled scenario. */
      readonly scriptsDisabled?: boolean;
      readonly simulate?: RunSimulation;
    }
  | { readonly type: 'exportHtml' }
  | { readonly type: 'exportAnsi' }
  | {
      readonly type: 'installPack';
      /** A directory under the scenario's own folder (e.g. `"files/ana-1.0.0"`), zipped into `.mkp` bytes by this module — never a committed binary. */
      readonly archive: string;
      readonly answers?: readonly string[];
    }
  | { readonly type: 'loadPacks' }
  | {
      readonly type: 'completeAt';
      readonly line: number;
      readonly column: number;
    }
  | { readonly type: 'hoverAt'; readonly line: number; readonly column: number }
  | { readonly type: 'insertComponent'; readonly name: string };

export interface HostScenario {
  readonly id: string;
  readonly invariant: string;
  /** Fixes `adapter.now()` for the whole scenario, so a `RunTrace` write is byte-stable. */
  readonly clock: number;
  readonly actions: readonly HostScenarioAction[];
}

/** `expected.json`'s schema. `outcomes[i]` is a coarse, partial projection of `actions[i]`'s real outcome — see `outcomeMismatches` for exactly what each `kind` compares. */
export interface HostScenarioExpected {
  readonly outcomes: readonly Record<string, unknown>[];
  readonly diagnostics: readonly string[];
  readonly prompts: readonly string[];
}

export interface LoadedHostScenario {
  readonly dir: string;
  readonly noteText: string;
  readonly scenario: HostScenario;
  readonly expected: HostScenarioExpected;
}

/** Loads one scenario's three files. Never validates beyond `JSON.parse` — a malformed fixture is a corpus bug, and throwing loudly here is the right failure mode for it. */
export function loadHostScenario(
  name: string,
  baseDir: string = hostConformanceDir(),
): LoadedHostScenario {
  const dir = join(baseDir, name);
  const noteText = readFileSync(join(dir, 'note.mk.md'), 'utf8');
  const scenario = JSON.parse(
    readFileSync(join(dir, 'scenario.json'), 'utf8'),
  ) as HostScenario;
  const expected = JSON.parse(
    readFileSync(join(dir, 'expected.json'), 'utf8'),
  ) as HostScenarioExpected;
  return { dir, noteText, scenario, expected };
}

// --- .mkp archive zipping (from a plain files/ directory, never a committed binary) ---

function readDirRecursive(
  dir: string,
  base: string,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, readDirRecursive(full, base));
    } else {
      const relativeName = relative(base, full).split(sep).join('/');
      out[relativeName] = new Uint8Array(readFileSync(full));
    }
  }
  return out;
}

/** Zips a scenario's `files/<name>` directory into `.mkp` archive bytes on the fly — this is how the corpus ships pack fixtures as plain files instead of a committed binary. */
export function zipArchiveDirectory(archiveDir: string): Uint8Array {
  return zipSync(readDirRecursive(archiveDir, archiveDir));
}

// --- the capability rule --------------------------------------------------

export type HostScenarioCapability =
  'isolate' | 'editor' | 'packs' | 'export-format';

/** The one static map from an action's type to the capability it needs. `undefined` means every host supports it (there is nothing to decline). */
export const ACTION_CAPABILITY: Readonly<
  Record<HostScenarioAction['type'], HostScenarioCapability | undefined>
> = {
  open: undefined,
  run: 'isolate',
  exportHtml: 'export-format',
  exportAnsi: 'export-format',
  installPack: 'packs',
  loadPacks: 'packs',
  completeAt: 'editor',
  hoverAt: 'editor',
  insertComponent: 'editor',
};

function exportFormatFor(action: HostScenarioAction): HostExportFormat {
  return action.type === 'exportAnsi' ? 'ansi' : 'html';
}

/** Whether `adapter` declares the capability `action` needs. Never consults the scenario or `expected.json` — only the adapter under test. */
export function hostDeclaresCapability(
  adapter: HostAdapter,
  action: HostScenarioAction,
): boolean {
  const capability = ACTION_CAPABILITY[action.type];
  if (capability === undefined) return true;
  if (capability === 'isolate') return adapter.isolate !== undefined;
  if (capability === 'editor') return adapter.editor !== undefined;
  if (capability === 'packs') {
    if (adapter.packs === undefined) return false;
    if (action.type === 'installPack') {
      return adapter.packs.installRoot !== undefined;
    }
    return true;
  }
  // 'export-format'
  return adapter.exports?.formats.has(exportFormatFor(action)) ?? false;
}

// --- the scripted prompt queue --------------------------------------------

/**
 * Flattens every `run`/`installPack` action's `answers` into one queue, in
 * document order — the same order the grant/consent prompts fire in, since
 * `expected.json`'s `prompts` array is itself the ordered proof of that.
 * `next()` THROWS once exhausted rather than returning a default: an
 * unanswered prompt means the scenario and the implementation disagree
 * about how many questions get asked, which must never be silently read
 * as a deny (`tmp/W11-corpus-design.md`, "The prompt policy").
 */
export function createAnswerQueue(scenario: HostScenario): {
  next(): boolean;
} {
  const answers: boolean[] = [];
  for (const action of scenario.actions) {
    const source =
      action.type === 'run' || action.type === 'installPack'
        ? action.answers
        : undefined;
    for (const answer of source ?? []) answers.push(answer === 'allow');
  }
  let index = 0;
  return {
    next(): boolean {
      if (index >= answers.length) {
        throw new Error(
          `scripted prompt queue exhausted after ${String(index)} answer(s): ` +
            'the scenario and the implementation disagree about how many ' +
            'questions get asked.',
        );
      }
      return answers[index++]!;
    },
  };
}

// --- simulated execution ---------------------------------------------------

function simulatedRunResult(
  sim: RunSimulation | undefined,
  options: SpawnRunOptions,
): RunResult {
  const name = sim?.name ?? 'value';
  if (sim?.requiresManualTier === true && options.trigger !== 'manual') {
    return {
      values: {},
      failures: [
        {
          name,
          message: `${name}: a write was attempted under the read-only "${options.trigger ?? 'manual'}" tier.`,
          kind: 'tier-blocked',
        },
      ],
      cacheSnapshot: options.cacheSnapshot,
    };
  }
  if (
    sim?.requiresHost !== undefined &&
    !options.netAllowlist.includes(sim.requiresHost)
  ) {
    return {
      values: {},
      failures: [
        {
          name,
          message: `${name}: host "${sim.requiresHost}" was not granted.`,
          kind: 'capability-denied',
        },
      ],
      cacheSnapshot: options.cacheSnapshot,
    };
  }
  return {
    values: { [name]: { status: 'fresh', value: sim?.value ?? 1 } },
    failures: [],
    cacheSnapshot: options.cacheSnapshot,
  };
}

// --- running one scenario ---------------------------------------------------

export interface HostScenarioRunResult {
  /** `outcomes[i]` is `actions[i]`'s real (or synthesized, for the two cases documented above) outcome, JSON-shaped for diffing. */
  readonly outcomes: readonly unknown[];
  /** Every diagnostics line written, UNPREFIXED (this module wraps `adapter.diagnostics` before the real adapter's own sink prefixing runs), in order. */
  readonly diagnostics: readonly string[];
  /** Every prompt's `message`, in order, exactly as built by `@markii/host`'s shared message functions. */
  readonly prompts: readonly string[];
  /** Set when a scripted prompt ran out of answers — a hard error, never folded into a silent deny. */
  readonly promptQueueError?: string;
}

/** `unsupported()` in `./create-host.js` writes exactly this shape of line; scenarios describe the fully-capable host's behavior, so a decline line is not something `expected.json` should have to also state per host. */
const UNSUPPORTED_DIAGNOSTIC_LINE = /^declined \([a-z-]+ unsupported on /;

function decodeWritten(
  writtenFiles: ReadonlyMap<string, Uint8Array>,
  path: string | undefined,
): string | undefined {
  if (path === undefined) return undefined;
  const bytes = writtenFiles.get(path);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/**
 * Runs `scenario` against `adapter` end to end. `adapter` is the REAL,
 * already-constructed host adapter under test (built by the caller from
 * its own injected dependencies plus a scripted prompt source, e.g.
 * `createAnswerQueue`); this function never builds one itself, so it works
 * identically for any `HostAdapter`.
 */
export async function runHostScenario(
  adapter: HostAdapter,
  scenario: HostScenario,
  noteText: string,
  scenarioDir: string,
  options: { readonly renderAnsi?: (text: string) => Promise<string> } = {},
): Promise<HostScenarioRunResult> {
  const diagnostics: string[] = [];
  const prompts: string[] = [];
  const writtenFiles = new Map<string, Uint8Array>();
  let promptQueueError: string | undefined;

  const recording: HostAdapter = {
    ...adapter,
    now: () => scenario.clock,
    diagnostics: (line: string): void => {
      diagnostics.push(line);
      adapter.diagnostics(line);
    },
    prompt: async (request: HostPromptRequest): Promise<boolean> => {
      prompts.push(request.message);
      return adapter.prompt(request);
    },
    writeFile: async (path: string, bytes: Uint8Array): Promise<void> => {
      writtenFiles.set(path, bytes);
      await adapter.writeFile(path, bytes);
    },
  };

  let currentSimulation: RunSimulation | undefined;
  const host: MarkiiHost = createMarkiiHost(recording, {
    spawnRun: (spawnOptions: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(simulatedRunResult(currentSimulation, spawnOptions)),
    ...(options.renderAnsi ? { renderAnsi: options.renderAnsi } : {}),
  });

  const notePath = join(scenarioDir, 'note.mk.md');
  const outcomes: unknown[] = [];

  for (const action of scenario.actions) {
    try {
      outcomes.push(
        await runOneAction(host, recording, action, {
          noteText,
          notePath,
          scenarioDir,
          writtenFiles,
          setSimulation: (sim) => {
            currentSimulation = sim;
          },
        }),
      );
    } catch (err) {
      promptQueueError = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  return {
    outcomes,
    diagnostics,
    prompts,
    ...(promptQueueError !== undefined ? { promptQueueError } : {}),
  };
}

interface ActionContext {
  readonly noteText: string;
  readonly notePath: string;
  readonly scenarioDir: string;
  readonly writtenFiles: ReadonlyMap<string, Uint8Array>;
  readonly setSimulation: (sim: RunSimulation | undefined) => void;
}

async function runOneAction(
  host: MarkiiHost,
  adapter: HostAdapter,
  action: HostScenarioAction,
  ctx: ActionContext,
): Promise<unknown> {
  switch (action.type) {
    case 'open':
      return host.open({ path: ctx.notePath });

    case 'run': {
      if (action.scriptsDisabled === true) {
        // The device-local scripts-off switch is not a `MarkiiHost`
        // capability (see this file's top comment): it is decided at each
        // app's own call site, before `host.run` is ever reached, using
        // the shared wording in `./script-execution.js`. Reproduced here
        // over the SAME functions and the adapter's own `labels` so the
        // scenario proves wording parity without inventing a capability.
        adapter.diagnostics(
          scriptsDisabledDiagnosticLine(action.trigger, adapter.labels),
        );
        return {
          kind: 'declined',
          reason:
            scriptsDisabledNotice(action.trigger, adapter.labels) ??
            scriptsDisabledDiagnosticLine(action.trigger, adapter.labels),
        };
      }
      ctx.setSimulation(action.simulate);
      return host.run({
        documentKey: ctx.notePath,
        text: ctx.noteText,
        trigger: action.trigger,
      });
    }

    case 'exportHtml':
    case 'exportAnsi': {
      const outcome = await host.exportNote({
        format: exportFormatFor(action),
        notePath: ctx.notePath,
        text: ctx.noteText,
      });
      return augmentExportOutcome(outcome, ctx.writtenFiles);
    }

    case 'installPack': {
      const archiveBytes = zipArchiveDirectory(
        join(ctx.scenarioDir, action.archive),
      );
      return host.installPack({ archiveBytes, archivePath: action.archive });
    }

    case 'loadPacks':
      return host.loadPacks();

    case 'completeAt':
      return host.completeAt({ line: action.line, column: action.column });

    case 'hoverAt':
      return host.hoverAt({ line: action.line, column: action.column });

    case 'insertComponent':
      return host.insertComponent({ name: action.name });
  }
}

function augmentExportOutcome(
  outcome: ExportOutcome,
  writtenFiles: ReadonlyMap<string, Uint8Array>,
): unknown {
  if (outcome.kind !== 'exported') return outcome;
  return { ...outcome, content: decodeWritten(writtenFiles, outcome.path) };
}

// --- diffing against expected.json -----------------------------------------

/** `expected[i]` compared against `actual[i]` for each index up to `expected`'s own length; a length mismatch is reported once rather than index-by-index noise. */
export function containsInOrder(
  actual: readonly string[],
  expected: readonly string[],
): string[] {
  if (actual.length !== expected.length) {
    return [
      `count: expected ${String(expected.length)}, got ${String(actual.length)} ` +
        `(actual: ${JSON.stringify(actual)})`,
    ];
  }
  const mismatches: string[] = [];
  expected.forEach((exp, i) => {
    if (!(actual[i] ?? '').includes(exp)) {
      mismatches.push(
        `[${String(i)}]: expected to contain "${exp}", got "${actual[i]}"`,
      );
    }
  });
  return mismatches;
}

/** Extracts `{name: value}` for every non-error `StoredValue` in a `'ran'` outcome's `values`, for a plain-data comparison against `expected.json`. */
function landedValues(values: unknown): Record<string, unknown> {
  if (typeof values !== 'object' || values === null) return {};
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(
    values as Record<string, unknown>,
  )) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'status' in entry &&
      (entry as { status: unknown }).status !== 'error' &&
      'value' in entry
    ) {
      out[name] = (entry as { value: unknown }).value;
    }
  }
  return out;
}

function failureKinds(failures: unknown): string[] {
  if (!Array.isArray(failures)) return [];
  return failures.map((f) =>
    typeof f === 'object' && f !== null && 'kind' in f
      ? String((f as { kind: unknown }).kind)
      : 'unknown',
  );
}

/**
 * A coarse, per-`kind` comparison between one action's real outcome and its
 * `expected.json` entry. Deliberately partial (matching the design's own
 * "deliberately coarse" posture): a `'ran'` outcome compares landed values
 * and failure KINDS, never timings or raw messages; an `'exported'` outcome
 * compares `contains`/`excludes` substrings against the written file's
 * content, never the whole document.
 */
export function outcomeMismatches(
  actual: unknown,
  expected: Record<string, unknown> | undefined,
): string[] {
  if (expected === undefined) return [];
  const actualRecord =
    typeof actual === 'object' && actual !== null
      ? (actual as Record<string, unknown>)
      : {};
  if (actualRecord['kind'] !== expected['kind']) {
    return [
      `kind: expected "${String(expected['kind'])}", got "${String(actualRecord['kind'])}"`,
    ];
  }
  const mismatches: string[] = [];
  switch (expected['kind']) {
    case 'ran': {
      const wantValues = (expected['values'] as Record<string, unknown>) ?? {};
      const gotValues = landedValues(actualRecord['values']);
      if (JSON.stringify(gotValues) !== JSON.stringify(wantValues)) {
        mismatches.push(
          `values: expected ${JSON.stringify(wantValues)}, got ${JSON.stringify(gotValues)}`,
        );
      }
      const wantKinds = (expected['failureKinds'] as string[]) ?? [];
      const gotKinds = failureKinds(actualRecord['failures']);
      if (JSON.stringify(gotKinds) !== JSON.stringify(wantKinds)) {
        mismatches.push(
          `failure kinds: expected ${JSON.stringify(wantKinds)}, got ${JSON.stringify(gotKinds)}`,
        );
      }
      break;
    }
    case 'exported': {
      const content = String(actualRecord['content'] ?? '');
      for (const needle of (expected['contains'] as string[]) ?? []) {
        if (!content.includes(needle)) {
          mismatches.push(`export should contain "${needle}"`);
        }
      }
      for (const needle of (expected['excludes'] as string[]) ?? []) {
        if (content.includes(needle)) {
          mismatches.push(`export should not contain "${needle}"`);
        }
      }
      break;
    }
    case 'installed': {
      if (
        expected['namespace'] !== undefined &&
        actualRecord['namespace'] !== expected['namespace']
      ) {
        mismatches.push(
          `namespace: expected "${String(expected['namespace'])}", got "${String(actualRecord['namespace'])}"`,
        );
      }
      if (
        expected['replaced'] !== undefined &&
        actualRecord['replaced'] !== expected['replaced']
      ) {
        mismatches.push(
          `replaced: expected ${String(expected['replaced'])}, got ${String(actualRecord['replaced'])}`,
        );
      }
      break;
    }
    case 'declined': {
      if (
        expected['step'] !== undefined &&
        actualRecord['step'] !== expected['step']
      ) {
        mismatches.push(
          `step: expected "${String(expected['step'])}", got "${String(actualRecord['step'])}"`,
        );
      }
      if (
        expected['reasonContains'] !== undefined &&
        !String(actualRecord['reason'] ?? '').includes(
          String(expected['reasonContains']),
        )
      ) {
        mismatches.push(
          `reason: expected to contain "${String(expected['reasonContains'])}", got "${String(actualRecord['reason'])}"`,
        );
      }
      break;
    }
    case 'loaded': {
      const want = [...((expected['namespaces'] as string[]) ?? [])].sort();
      const got = [...((actualRecord['namespaces'] as string[]) ?? [])].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push(
          `namespaces: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
        );
      }
      break;
    }
    case 'completions': {
      const got = (actualRecord['labels'] as string[]) ?? [];
      for (const label of (expected['labels'] as string[]) ?? []) {
        if (!got.includes(label)) {
          mismatches.push(`completions should include "${label}"`);
        }
      }
      break;
    }
    case 'hover': {
      const contains = expected['contains'] as string | undefined;
      if (
        contains !== undefined &&
        !String(actualRecord['text'] ?? '').includes(contains)
      ) {
        mismatches.push(`hover text should contain "${contains}"`);
      }
      break;
    }
    default:
      break; // kind equality is the whole check for every other outcome.
  }
  return mismatches;
}

/**
 * The full assertion an app's conformance test makes for one scenario: for
 * every action whose capability `adapter` declares, its outcome matches
 * `expected`'s; for every other action, the outcome is exactly the shared
 * `unsupported` record. Returns a list of human-readable problems — empty
 * means the scenario passed.
 */
export function assertHostScenario(
  adapter: HostAdapter,
  scenario: HostScenario,
  expected: HostScenarioExpected,
  result: HostScenarioRunResult,
): string[] {
  const problems: string[] = [];
  if (result.promptQueueError !== undefined) {
    problems.push(`prompt queue: ${result.promptQueueError}`);
  }

  scenario.actions.forEach((action, i) => {
    const actual = result.outcomes[i];
    const declared = hostDeclaresCapability(adapter, action);
    if (!declared) {
      const capability = ACTION_CAPABILITY[action.type];
      const actualRecord =
        typeof actual === 'object' && actual !== null
          ? (actual as Record<string, unknown>)
          : {};
      if (
        actualRecord['kind'] !== 'unsupported' ||
        actualRecord['capability'] !== capability
      ) {
        problems.push(
          `action ${String(i)} (${action.type}): expected {kind:"unsupported", capability:"${String(capability)}"}, got ${JSON.stringify(actual)}`,
        );
      }
      return;
    }
    for (const problem of outcomeMismatches(actual, expected.outcomes[i])) {
      problems.push(`action ${String(i)} (${action.type}): ${problem}`);
    }
  });

  // `expected.json`'s `diagnostics`/`prompts` describe what a FULLY CAPABLE
  // host does. When every action in this scenario needs a capability the
  // adapter lacks (a whole scenario built around one capability domain,
  // e.g. every action in `06-install-pack-then-render` needs `packs`),
  // nothing meaningful ran and there is nothing to compare — the
  // per-action `unsupported` check above already covers this host
  // honestly. Comparing an unrelated host's empty prompt/diagnostics list
  // against a capable host's expectation here would be double-counting
  // the same capability gap as a second, spurious failure.
  const capabilityGatedActions = scenario.actions.filter(
    (action) => ACTION_CAPABILITY[action.type] !== undefined,
  );
  const anyActionDeclared =
    capabilityGatedActions.length === 0 ||
    capabilityGatedActions.some((action) =>
      hostDeclaresCapability(adapter, action),
    );
  if (anyActionDeclared) {
    const filteredDiagnostics = result.diagnostics.filter(
      (line) => !UNSUPPORTED_DIAGNOSTIC_LINE.test(line),
    );
    for (const problem of containsInOrder(
      filteredDiagnostics,
      expected.diagnostics,
    )) {
      problems.push(`diagnostics ${problem}`);
    }
    for (const problem of containsInOrder(result.prompts, expected.prompts)) {
      problems.push(`prompts ${problem}`);
    }
  }

  return problems;
}
