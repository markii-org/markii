import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import {
  evaluatePackScripts,
  readPackRegistrationQueue,
} from './pack-scripts.js';

/**
 * Executed probe for the in-page pack loader: it runs real scripts through
 * the real `Function` constructor and checks what a hostile or careless
 * script can and cannot do to the globals around it.
 */

interface Globals {
  __markiiReact?: unknown;
  __markiiPackRegistrations?: unknown;
  __markiiRegisterPack?: unknown;
}

const globals = (): Globals =>
  (globalThis as { window?: unknown }).window as Globals;

afterEach(() => {
  const g = globals();
  delete g.__markiiReact;
  delete g.__markiiPackRegistrations;
  delete g.__markiiRegisterPack;
});

const register = (name: string): string =>
  `window.__markiiRegisterPack(${JSON.stringify(JSON.stringify({ name }))}, {});`;

describe('evaluatePackScripts', () => {
  it('collects registrations from every script, in order', () => {
    const result = evaluatePackScripts(
      [
        { namespace: 'a', source: register('a') },
        { namespace: 'b', source: register('b') },
      ],
      { react: React },
    );
    expect(result.failures).toEqual([]);
    expect(result.registrations.map((r) => r.manifestJson)).toEqual([
      '{"name":"a"}',
      '{"name":"b"}',
    ]);
  });

  it('reports a throwing script under its namespace and still runs the rest', () => {
    const result = evaluatePackScripts(
      [
        { namespace: 'a', source: 'throw new Error("boom");' },
        { namespace: 'syntax', source: 'this is not javascript' },
        { namespace: 'b', source: register('b') },
      ],
      { react: React },
    );
    expect(result.failures.map((f) => f.namespace)).toEqual(['a', 'syntax']);
    expect(result.failures[0]?.reason).toBe('boom');
    expect(result.registrations).toHaveLength(1);
  });

  it('hands the script the given React instance', () => {
    let seen: unknown;
    const probe = { ...React, marker: 1 } as typeof React;
    (globalThis as { __probeSeen?: (value: unknown) => void }).__probeSeen = (
      value,
    ) => {
      seen = value;
    };
    evaluatePackScripts(
      [{ namespace: 'a', source: '__probeSeen(window.__markiiReact);' }],
      { react: probe },
    );
    expect(seen).toBe(probe);
  });

  it('leaves window.__markiiReact set for a lazy read at render time', () => {
    evaluatePackScripts([], { react: React });
    expect(globals().__markiiReact).toBe(React);
  });

  it('restores the register callback and queue the page had before', () => {
    const g = globals() ?? ((globalThis as { window?: unknown }).window = {});
    const before = (): void => undefined;
    const queue: unknown[] = ['kept'];
    (g as Globals).__markiiRegisterPack = before;
    (g as Globals).__markiiPackRegistrations = queue;
    evaluatePackScripts([{ namespace: 'a', source: register('a') }], {
      react: React,
    });
    expect(globals().__markiiRegisterPack).toBe(before);
    expect(globals().__markiiPackRegistrations).toBe(queue);
    expect(queue).toEqual(['kept']);
  });

  it('removes the register callback and queue when the page had none', () => {
    evaluatePackScripts([{ namespace: 'a', source: register('a') }], {
      react: React,
    });
    expect('__markiiRegisterPack' in globals()).toBe(false);
    expect('__markiiPackRegistrations' in globals()).toBe(false);
  });

  it('ignores a registration a script makes through a callback it kept', () => {
    const result = evaluatePackScripts(
      [
        {
          namespace: 'a',
          source: 'globalThis.__kept = window.__markiiRegisterPack;',
        },
      ],
      { react: React },
    );
    const kept = (globalThis as { __kept?: (m: unknown, c: unknown) => void })
      .__kept;
    kept?.('{"name":"late"}', {});
    expect(result.registrations).toEqual([]);
    delete (globalThis as { __kept?: unknown }).__kept;
  });

  it('returns a registration under another pack namespace as written', () => {
    const result = evaluatePackScripts(
      [{ namespace: 'honest', source: register('other') }],
      { react: React },
    );
    expect(result.registrations).toEqual([
      { manifestJson: '{"name":"other"}', componentModules: {} },
    ]);
  });

  it('ignores a script that replaces the queue instead of using the callback', () => {
    const result = evaluatePackScripts(
      [
        {
          namespace: 'a',
          source:
            'window.__markiiPackRegistrations = [{ manifest: "{}", componentModules: {} }];',
        },
      ],
      { react: React },
    );
    expect(result.registrations).toEqual([]);
  });

  it('includes an entry a script pushes straight onto the queue', () => {
    const result = evaluatePackScripts(
      [
        {
          namespace: 'a',
          source:
            'window.__markiiPackRegistrations.push({ manifest: "{}", componentModules: {} });',
        },
      ],
      { react: React },
    );
    expect(result.registrations).toHaveLength(1);
  });
});

describe('readPackRegistrationQueue', () => {
  it('keeps every position and blanks an entry that is not an object', () => {
    expect(
      readPackRegistrationQueue([
        { manifest: 'm', componentModules: { x: 1 } },
        'junk',
        null,
        [],
      ]),
    ).toEqual([
      { manifestJson: 'm', componentModules: { x: 1 } },
      { manifestJson: undefined, componentModules: undefined },
      { manifestJson: undefined, componentModules: undefined },
      { manifestJson: undefined, componentModules: undefined },
    ]);
  });

  it('reads anything that is not an array as empty', () => {
    expect(readPackRegistrationQueue(undefined)).toEqual([]);
    expect(readPackRegistrationQueue({ length: 1 })).toEqual([]);
  });
});
