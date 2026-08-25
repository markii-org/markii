/**
 * The seam between `spawnRun`'s watchdog logic and the KIND of isolate a
 * host can actually create.
 *
 * `./run-host.ts` owns the part that must never differ between hosts: the
 * external wall-clock watchdog, exactly-once settlement, and the
 * never-rejects contract. What differs is what the runtime can spawn at
 * all. A Node host (the VS Code extension's extension host) uses
 * `node:worker_threads`. An Electron RENDERER, which is what an Obsidian
 * plugin runs in, supports neither: `new Worker()` from `worker_threads`
 * throws "The V8 platform used by this instance of Node does not support
 * creating Workers", and forking a Node child via `ELECTRON_RUN_AS_NODE`
 * was measured failing there too (no IPC round-trip; the child exited on
 * SIGTRAP). A Web Worker is what remains, and it works.
 *
 * Both satisfy the normative requirement in docs/security.md: a dedicated
 * isolate that an external watchdog can terminate from outside. They do
 * NOT have equal capabilities, and the difference is documented rather than
 * papered over: `maxOldGenerationSizeMb` bounds a worker thread's V8 heap,
 * and a Web Worker accepts no such cap.
 */

/**
 * One spawned isolate, reduced to what the watchdog needs. Deliberately
 * event-callback shaped rather than promise-shaped: `spawnRun` settles on
 * whichever of message/error/exit/watchdog fires FIRST, which a promise
 * per event would make harder to express, not easier.
 *
 * Every implementation must guarantee: `kill()` is idempotent and safe on
 * an isolate that already exited, and no callback fires after `kill()`
 * resolves the run (late events are harmless anyway, since `spawnRun`
 * guards settlement, but an implementation should not rely on that).
 */
export interface RunIsolate {
  /**
   * Hands the job to the isolate. MAY THROW synchronously — a structured
   * clone of an uncloneable payload does exactly that — and `spawnRun`
   * catches it, so an implementation must not swallow it into a silent
   * no-op that would leave the run hanging until the watchdog.
   */
  send(job: unknown): void;
  /** Terminates the isolate. Called by the watchdog and again on settle; must tolerate both. */
  kill(): void;
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: unknown) => void): void;
  /** `code` is `null` where the runtime does not report one (a Web Worker never does). */
  onExit(listener: (code: number | null) => void): void;
}

export interface SpawnIsolateOptions {
  /** The entry the isolate loads — resolved by the host, never guessed here (see `./run-host.ts`'s `defaultWorkerPath`). */
  entryPath: string;
  /** Node `execArgv` for a worker-thread isolate; meaningless to a Web Worker, which ignores it. */
  execArgv?: string[];
  /** V8 old-space cap in MB. A worker thread honors it; a Web Worker cannot, and says so in its own doc comment. */
  maxOldGenerationSizeMb: number;
}

/** Creates one isolate per run. Injected via `SpawnRunOptions.spawnIsolate`; defaults to the worker-thread implementation. */
export type IsolateSpawner = (options: SpawnIsolateOptions) => RunIsolate;
