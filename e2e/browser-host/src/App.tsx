import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { renderMark } from '@markii/react';
import type { Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { createValueStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';
import type { HostPromptRequest } from '@markii/host';
import { createFixtureHost, type PromptBridge } from './host';
import { registryFromPackScripts } from './pack-runtime';

const DEFAULT_NOTE = `# Fixture note

:::callout{type=info}
A standard component renders.
:::

Answer: :value[answer]

\`\`\`lua {name=answer}
return 42
\`\`\`
`;

const params = new URLSearchParams(window.location.search);
const NOTE_TEXT = params.get('text') ?? DEFAULT_NOTE;
const TIMEOUT_MS = Number(params.get('timeout') ?? '15000');
const ALLOWED_ORIGINS = (params.get('allow') ?? '')
  .split(',')
  .filter((origin) => origin !== '');

type RunState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok' | 'failed'; reason?: string };

interface PendingPrompt {
  request: HostPromptRequest;
  resolve: (answer: boolean) => void;
}

export function App(): ReactElement {
  const prompts = useMemo<PromptBridge>(() => ({ ask: undefined }), []);
  const fixture = useMemo(
    () => createFixtureHost(prompts, ALLOWED_ORIGINS),
    [prompts],
  );
  const [pending, setPending] = useState<PendingPrompt | undefined>();
  const [values, setValues] = useState<Record<string, StoredValue>>({});
  const [run, setRun] = useState<RunState>({ state: 'idle' });
  const [registry, setRegistry] = useState<Registry>(defaultRegistry);
  const [packNames, setPackNames] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const packStyle = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    prompts.ask = (request) =>
      new Promise<boolean>((resolve) => {
        setPending({ request, resolve });
      });
    fixture.onDiagnostic(() => setDiagnostics([...fixture.diagnostics]));
  }, [prompts, fixture]);

  const answer = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return undefined;
    });
  }, []);

  const onRun = useCallback(async () => {
    setRun({ state: 'running' });
    try {
      const outcome = await fixture.host.run({
        documentKey: 'fixture/note.mk.md',
        text: NOTE_TEXT,
        trigger: 'manual',
        timeoutMs: TIMEOUT_MS,
      });
      if (outcome.kind !== 'ran') {
        setRun({ state: 'failed', reason: 'unsupported' });
        return;
      }
      setValues(outcome.values);
      setRun(
        outcome.trace.ok
          ? { state: 'ok' }
          : { state: 'failed', reason: outcome.trace.reason },
      );
    } catch (error) {
      setRun({
        state: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }, [fixture]);

  const onInstallPack = useCallback(async () => {
    const response = await fetch('/generated/e2e.mkp');
    const archiveBytes = new Uint8Array(await response.arrayBuffer());
    const installed = await fixture.host.installPack({
      archiveBytes,
      archivePath: 'e2e.mkp',
    });
    if (installed.kind !== 'installed') return;
    const loaded = await fixture.host.loadPacks();
    if (loaded.kind !== 'loaded') return;
    const scripts: string[] = [];
    for (const pack of loaded.packs) {
      scripts.push(
        new TextDecoder().decode(await fixture.fs.readFile(pack.scriptPath)),
      );
      const cssPath = pack.scriptPath.replace(/webview\.js$/, 'webview.css');
      if (await fixture.fs.exists(cssPath)) {
        packStyle.current ??= document.head.appendChild(
          document.createElement('style'),
        );
        packStyle.current.textContent += new TextDecoder().decode(
          await fixture.fs.readFile(cssPath),
        );
      }
    }
    const built = registryFromPackScripts(scripts, defaultRegistry);
    for (const reason of built.reasons) fixture.host.diagnostics(reason);
    setRegistry(built.registry);
    setPackNames(loaded.namespaces.slice());
  }, [fixture]);

  const tree = useMemo(
    () =>
      renderMark(NOTE_TEXT, registry, createValueStore(values), undefined, {
        renderCode: ({ lang, code }) =>
          lang === 'e2e-widget' ? (
            <div data-testid="custom-code">custom: {code.trim()}</div>
          ) : undefined,
      }),
    [registry, values],
  );

  return (
    <div>
      <header>
        <button data-testid="run" onClick={() => void onRun()}>
          Run
        </button>
        <button data-testid="install-pack" onClick={() => void onInstallPack()}>
          Install pack
        </button>
        <span
          data-testid="run-marker"
          data-state={run.state}
          title={'reason' in run ? run.reason : undefined}
        >
          {run.state}
        </span>
        <span data-testid="packs">{packNames.join(',')}</span>
      </header>
      <main className="doc" data-testid="doc">
        {tree}
      </main>
      {pending ? (
        <div role="dialog" data-testid="prompt-dialog">
          <p data-testid="prompt-message">{pending.request.message}</p>
          <button data-testid="prompt-allow" onClick={() => answer(true)}>
            {pending.request.allowLabel}
          </button>
          <button data-testid="prompt-deny" onClick={() => answer(false)}>
            {pending.request.denyLabel}
          </button>
        </div>
      ) : null}
      <ul data-testid="diagnostics">
        {diagnostics.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
