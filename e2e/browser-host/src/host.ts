import {
  createMarkiiHost,
  type GrantMemento,
  type HostAdapter,
  type HostLabels,
  type HostPromptRequest,
  type MarkiiHost,
  type Thenable,
} from '@markii/host';
import {
  createBrowserHostIsolate,
  createFetchNetProvider,
} from '@markii/host/browser';
import { MemoryFs } from './memory-fs';

const PACK_ROOT = '/packs';

const LABELS: HostLabels = {
  appNoun: 'page',
  previewNoun: 'the rendered note',
  diagnosticsSurface: 'the diagnostics list',
  deviceNoun: 'this browser',
};

/** A localStorage-backed memento: device-local, JSON, never throws. */
function createLocalStorageMemento(): GrantMemento {
  return {
    get<T>(key: string, defaultValue?: T): T {
      try {
        const raw = localStorage.getItem(`markii-e2e:${key}`);
        if (raw !== null) return JSON.parse(raw) as T;
      } catch {
        // fall through to the default
      }
      return defaultValue as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      try {
        localStorage.setItem(`markii-e2e:${key}`, JSON.stringify(value));
      } catch {
        // a full or blocked store degrades to no memory
      }
      return Promise.resolve();
    },
  };
}

export interface PromptBridge {
  /** Set by the UI: shows the request and resolves with the user's answer. */
  ask: ((request: HostPromptRequest) => Promise<boolean>) | undefined;
}

export interface FixtureHost {
  readonly host: MarkiiHost;
  readonly fs: MemoryFs;
  readonly packRoot: string;
  readonly diagnostics: string[];
  onDiagnostic(listener: () => void): void;
}

export function createFixtureHost(
  prompts: PromptBridge,
  allowedOrigins: readonly string[],
): FixtureHost {
  const fs = new MemoryFs();
  const diagnostics: string[] = [];
  const listeners: (() => void)[] = [];

  const adapter: HostAdapter = {
    id: 'browser-fixture',
    labels: LABELS,
    readFile: (p) => fs.readFile(p),
    exists: (p) => fs.exists(p),
    writeFile: (p, bytes) => fs.writeFile(p, bytes),
    listFolder: (p) => fs.listFolder(p),
    // A denial is the safe answer when no dialog is mounted.
    prompt: (request) => prompts.ask?.(request) ?? Promise.resolve(false),
    memento: createLocalStorageMemento(),
    diagnostics: (line) => {
      diagnostics.push(line);
      for (const listener of listeners) listener();
    },
    now: () => Date.now(),
    isolate: createBrowserHostIsolate({
      netProvider: createFetchNetProvider({ allowedOrigins }),
    }),
    packs: {
      engine: 'react',
      trust: 'none',
      authorizedFolders: async () =>
        (await fs.listFolder(PACK_ROOT))
          .filter((entry) => entry.isDirectory)
          .map((entry) => `${PACK_ROOT}/${entry.name}`),
      reservedNamespaces: () => new Set<string>(),
      installRoot: () => PACK_ROOT,
      removeFolder: (p) => fs.removeDirectory(p),
    },
  };

  const host = createMarkiiHost(adapter, {
    archiveExtractFs: fs.asArchiveExtractFs(),
  });

  return {
    host,
    fs,
    packRoot: PACK_ROOT,
    diagnostics,
    onDiagnostic: (listener) => {
      listeners.push(listener);
    },
  };
}
