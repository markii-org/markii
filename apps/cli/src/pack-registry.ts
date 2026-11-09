/**
 * Turns the host's loaded terminal packs into one `AnsiRegistry` for
 * `markii view` and `markii export --format ansi`. The host
 * (`createMarkiiHost(...).loadTerminalPacks`) discovers the authorized
 * packs and reads each `terminal.js`; this module hands that text to
 * `@markii/ansi`'s loader and installs the result on top of the standard
 * set. A pack that cannot be used contributes nothing: its directives
 * render as a "pack failed to load" fallback and the reason is one line on
 * the diagnostics surface, never a crash and never silent.
 *
 * The pack's own `pack.json` is the authority on what it declares: the
 * manifest the loader sees is the discovered one, and a `terminal.js` that
 * registers a different namespace is refused.
 */
import type { UnavailableComponent } from '@markii/stdlib';
import {
  defaultAnsiRegistry,
  installAnsiPacks,
  loadTerminalPackScript,
  type AnsiPackToInstall,
  type AnsiRegistry,
} from '@markii/ansi';
import {
  terminalScriptNamespaceMismatchLine,
  terminalScriptRejectedLine,
  type MarkiiHost,
} from '@markii/host';

export interface CliPackRegistry {
  readonly registry: AnsiRegistry;
  /** Installed pack components with no terminal view, for the renderer's `unavailableComponents` option. */
  readonly unavailable: readonly UnavailableComponent[];
  /** Every installed pack component, for the static HTML export, which draws no pack views. */
  readonly components: readonly UnavailableComponent[];
  /** Lines that report a real failure; also written to the host's diagnostics. A caller shows these even without `--verbose`. */
  readonly failureLines: readonly string[];
}

export async function loadCliPackRegistry(
  host: MarkiiHost,
): Promise<CliPackRegistry> {
  const outcome = await host.loadTerminalPacks();
  if (outcome.kind !== 'loaded') {
    return {
      registry: defaultAnsiRegistry,
      unavailable: [],
      components: [],
      failureLines: [],
    };
  }

  const failureLines = [...outcome.failureLines];
  const toInstall: AnsiPackToInstall[] = [];
  // Components of packs whose terminal script could not be used. They read
  // "pack failed to load" in the note instead of "unknown component".
  const loadFailed: UnavailableComponent[] = [];
  const markLoadFailed = (namespace: string): void => {
    for (const component of outcome.components) {
      if (component.pack === namespace) {
        loadFailed.push({ ...component, loadFailed: true });
      }
    }
  };
  // A pack that names terminal views but whose terminal.js was missing or
  // unreadable never reaches the loop below; it fails the same way.
  const scripted = new Set(outcome.scripts.map((script) => script.namespace));
  for (const component of outcome.components) {
    if (component.engines.includes('ansi') && !scripted.has(component.pack)) {
      loadFailed.push({ ...component, loadFailed: true });
    }
  }
  for (const script of outcome.scripts) {
    const discovered = outcome.packs.find(
      (pack) => pack.manifest.name === script.namespace,
    );
    if (discovered === undefined) continue;
    const loaded = await loadTerminalPackScript(script.text);
    if (!loaded.ok) {
      const line = terminalScriptRejectedLine(script.namespace, loaded.reason);
      host.diagnostics(line);
      failureLines.push(line);
      markLoadFailed(script.namespace);
      continue;
    }
    if (loaded.pack.manifest.name !== script.namespace) {
      const line = terminalScriptNamespaceMismatchLine(
        script.namespace,
        loaded.pack.manifest.name,
      );
      host.diagnostics(line);
      failureLines.push(line);
      markLoadFailed(script.namespace);
      continue;
    }
    toInstall.push({
      manifest: discovered.manifest,
      componentModules: loaded.pack.componentModules,
    });
  }

  const unavailable = [
    ...loadFailed,
    ...outcome.unavailable.filter(
      (component) =>
        !loadFailed.some((failed) => failed.directive === component.directive),
    ),
  ];
  const installed = installAnsiPacks(toInstall, defaultAnsiRegistry);
  if (!installed.ok) {
    const line = `Packs share a namespace (${installed.collisions.join(', ')}); none of them were loaded.`;
    host.diagnostics(line);
    return {
      registry: defaultAnsiRegistry,
      unavailable,
      components: outcome.components,
      failureLines: [...failureLines, line],
    };
  }
  return {
    registry: installed.registry,
    unavailable,
    components: outcome.components,
    failureLines,
  };
}
