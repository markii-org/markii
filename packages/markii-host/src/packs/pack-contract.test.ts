import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '@markii/react';
import { buildRenderRegistry } from './pack-render-registry.js';

/**
 * The prebuilt-pack registration contract, exercised against a
 * HAND-WRITTEN `webview.js`.
 *
 * Every other test in this folder feeds `buildPackRegistrationScript`'s own
 * output back to it, which proves the compiler agrees with itself and
 * nothing more. This file exists because the contract is public: docs/
 * packs.md ("What a prebuilt `webview.js` must do") tells a pack author
 * with their own toolchain exactly what to emit, and the markii-packs
 * repository has a second, independent implementation of it. A contract
 * with only one implementation testing itself is a contract that can drift
 * silently, and the failure would surface as a pack that loads and
 * registers nothing.
 *
 * So the script below is written by hand from the documented rules alone.
 * It never goes near `pack-build.ts`. If a change to the registration
 * convention lands without updating the document, this test fails and names
 * the rule it broke.
 */

/** The pack manifest the hand-written script registers. */
const MANIFEST = {
  name: 'demo',
  engine: 'react',
  version: '1.0.0',
  components: {
    hello: { source: './hello.tsx', description: 'A greeting.' },
  },
};

/**
 * A `webview.js` written from docs/packs.md alone: an IIFE, one
 * `window.__markiiRegisterPack(manifestJson, componentModules)` call, and a
 * component that reads `window.__markiiReact` only from inside its own
 * body, never at the top level.
 */
const HAND_WRITTEN_WEBVIEW_JS = `
(function () {
  // The RAW pack.json text, passed through unchanged. Not an object, and
  // not re-serialized: docs/packs.md requires the file's own string.
  var manifestJson = ${JSON.stringify(JSON.stringify(MANIFEST, null, 2))};
  function Hello(props) {
    // Read at RENDER time only. Reading here is legal; reading it above,
    // at module scope, is what the lazy rule forbids.
    var React = window.__markiiReact;
    return React.createElement('p', null, props.children);
  }
  window.__markiiRegisterPack(manifestJson, { hello: { component: Hello } });
})();
`;

interface SandboxWindow {
  __markiiPackRegistrations: Array<{
    manifest: unknown;
    componentModules: unknown;
  }>;
  __markiiRegisterPack: (manifest: unknown, componentModules: unknown) => void;
  __markiiReact?: unknown;
}

/** A fake `window` whose `__markiiReact` getter counts reads, so "never touched at load" is asserted rather than assumed. */
function makeSandbox(): {
  context: vm.Context;
  windowObj: SandboxWindow;
  reactReads: () => number;
  setReact: (value: unknown) => void;
} {
  let reads = 0;
  let reactValue: unknown;
  const windowObj = {
    __markiiPackRegistrations: [],
    __markiiRegisterPack(manifest: unknown, componentModules: unknown) {
      windowObj.__markiiPackRegistrations.push({ manifest, componentModules });
    },
  } as SandboxWindow;
  Object.defineProperty(windowObj, '__markiiReact', {
    configurable: true,
    get() {
      reads += 1;
      return reactValue;
    },
  });
  return {
    context: vm.createContext({ window: windowObj, console }),
    windowObj,
    reactReads: () => reads,
    setReact: (value) => {
      reactValue = value;
    },
  };
}

describe('the prebuilt webview.js contract, against a hand-written script', () => {
  it('registers exactly once, passing the manifest and a component per declared name', () => {
    const box = makeSandbox();
    vm.runInContext(HAND_WRITTEN_WEBVIEW_JS, box.context);

    expect(box.windowObj.__markiiPackRegistrations).toHaveLength(1);
    const queued = box.windowObj.__markiiPackRegistrations[0];
    expect(queued).toBeDefined();
    // The contract carries the manifest as raw TEXT, not a parsed object.
    expect(typeof queued?.manifest).toBe('string');
    expect(JSON.parse(queued?.manifest as string)).toEqual(MANIFEST);
    const modules = queued?.componentModules as Record<
      string,
      { component?: unknown }
    >;
    // Keyed by the LOCAL manifest name, not the composed directive name.
    expect(Object.keys(modules)).toEqual(['hello']);
    expect(typeof modules.hello?.component).toBe('function');
  });

  it('never reads window.__markiiReact while merely loading', () => {
    const box = makeSandbox();
    // React deliberately left undefined: a pack script loads BEFORE the
    // host bundle sets it, so a top-level read would throw in a real host.
    vm.runInContext(HAND_WRITTEN_WEBVIEW_JS, box.context);
    expect(box.reactReads()).toBe(0);
  });

  it('reads window.__markiiReact once the component is actually rendered', () => {
    const box = makeSandbox();
    vm.runInContext(HAND_WRITTEN_WEBVIEW_JS, box.context);
    box.setReact({
      createElement: (tag: string) => ({ tag }),
    });

    const modules = box.windowObj.__markiiPackRegistrations[0]
      ?.componentModules as Record<
      string,
      { component: (p: unknown) => unknown }
    >;
    const hello = modules.hello;
    expect(hello).toBeDefined();
    const rendered = hello?.component({ children: 'hi' });

    expect(box.reactReads()).toBe(1);
    expect(rendered).toEqual({ tag: 'p' });
  });

  it('leaves no globals behind beyond the one registration call', () => {
    const box = makeSandbox();
    const before = new Set(vm.runInContext('Object.keys(this)', box.context));
    vm.runInContext(HAND_WRITTEN_WEBVIEW_JS, box.context);
    const after: string[] = vm.runInContext('Object.keys(this)', box.context);

    // A JSX shim or helper preamble emitted OUTSIDE the IIFE would show up
    // here as a stray global. That is a real bug this rule exists to catch,
    // not a hypothetical one.
    expect(after.filter((key) => !before.has(key))).toEqual([]);
  });

  it('is accepted by the real registry builder under its composed directive name', () => {
    const box = makeSandbox();
    vm.runInContext(HAND_WRITTEN_WEBVIEW_JS, box.context);

    const result = buildRenderRegistry(
      box.windowObj.__markiiPackRegistrations.map((entry) => ({
        manifestJson: entry.manifest,
        componentModules: entry.componentModules,
      })),
      createRegistry({}),
    );

    expect(result.invalidReasons).toEqual([]);
    expect(result.collisions).toEqual([]);
    // packName + "_" + localName, per docs/packs.md's namespace rule.
    expect(Object.keys(result.registry)).toContain('demo_hello');
  });
});
