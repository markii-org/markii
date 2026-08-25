import { describe, expect, it } from 'vitest';
import {
  collectPackRegistrations,
  evaluatePackScript,
  installPackRuntime,
} from './pack-runtime.js';

describe('installPackRuntime / evaluatePackScript / collectPackRegistrations', () => {
  it('a compiled script calling window.__markiiRegisterPack is captured', () => {
    installPackRuntime();
    const result = evaluatePackScript(`
      window.__markiiRegisterPack(
        JSON.stringify({ name: 'demo', engine: 'react', components: { badge: './Badge.tsx' } }),
        { badge: { component: function () { return null; }, inline: false } },
      );
    `);
    expect(result.ok).toBe(true);

    const registrations = collectPackRegistrations();
    expect(registrations).toHaveLength(1);
    expect(typeof registrations[0]!.manifestJson).toBe('string');
    expect(JSON.parse(registrations[0]!.manifestJson as string)).toMatchObject({
      name: 'demo',
    });
  });

  it('collectPackRegistrations clears the queue — a second call is empty', () => {
    installPackRuntime();
    evaluatePackScript(`window.__markiiRegisterPack('{}', {});`);
    expect(collectPackRegistrations()).toHaveLength(1);
    expect(collectPackRegistrations()).toHaveLength(0);
  });

  it('a script that throws while loading is reported, never thrown out', () => {
    installPackRuntime();
    const result = evaluatePackScript('throw new Error("boom");');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('boom');
    }
  });

  it('a script that never calls __markiiRegisterPack simply registers nothing', () => {
    installPackRuntime();
    const result = evaluatePackScript('var x = 1 + 1;');
    expect(result.ok).toBe(true);
    expect(collectPackRegistrations()).toEqual([]);
  });

  it('window.__markiiReact is set for a compiled script to read lazily', () => {
    installPackRuntime();
    const result = evaluatePackScript(`
      window.__markiiRegisterPack('{}', {
        badge: {
          component: function () {
            // Only reachable if window.__markiiReact resolved to something.
            return typeof window.__markiiReact;
          },
        },
      });
    `);
    expect(result.ok).toBe(true);
    const [registration] = collectPackRegistrations();
    const componentModules = registration!.componentModules as Record<
      string,
      { component: () => unknown }
    >;
    expect(componentModules.badge!.component()).toBe('object');
  });

  it('installPackRuntime resets a stale queue from a previous load', () => {
    installPackRuntime();
    evaluatePackScript(`window.__markiiRegisterPack('{}', {});`);
    // A fresh load, without reading the previous queue first.
    installPackRuntime();
    expect(collectPackRegistrations()).toEqual([]);
  });
});
