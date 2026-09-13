import { describe, expect, it } from 'vitest';
import { layoutWrapperAxis } from '@markii/stdlib';
import { defaultAnsiRegistry } from './index.js';
import { registryLayoutAxis, readRegistryComponent } from '../registry.js';

describe('defaultAnsiRegistry', () => {
  it('registers all 23 standard components', () => {
    expect(Object.keys(defaultAnsiRegistry)).toHaveLength(23);
  });

  it('every entry has a real component function', () => {
    for (const name of Object.keys(defaultAnsiRegistry)) {
      expect(typeof readRegistryComponent(defaultAnsiRegistry[name])).toBe(
        'function',
      );
    }
  });

  it('every layout wrapper is registered with the axis its own name decides', () => {
    for (const name of [
      'center',
      'left',
      'right',
      'wide',
      'narrow',
      'full',
      'fit',
    ]) {
      expect(registryLayoutAxis(defaultAnsiRegistry, name)).toBe(
        layoutWrapperAxis(name),
      );
    }
  });

  it('card, callout, divider, and table are the selfLayout components', () => {
    expect(defaultAnsiRegistry.card?.selfLayout).toBe(true);
    expect(defaultAnsiRegistry.callout?.selfLayout).toBe(true);
    expect(defaultAnsiRegistry.divider?.selfLayout).toBe(true);
    expect(defaultAnsiRegistry.table?.selfLayout).toBe(true);
    expect(defaultAnsiRegistry.chart?.selfLayout).toBeUndefined();
  });
});
