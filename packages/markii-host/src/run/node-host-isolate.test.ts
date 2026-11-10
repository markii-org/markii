import { describe, expect, it } from 'vitest';
import { createNodeHostIsolate } from './node-isolate';
import { workerThreadIsolate } from './node-isolate';

describe('createNodeHostIsolate', () => {
  it('declares the node kind with the worker-thread spawner', () => {
    const isolate = createNodeHostIsolate({ workerPath: '/x/worker.js' });
    expect(isolate.kind).toBe('node');
    expect(isolate.spawnIsolate).toBe(workerThreadIsolate);
    expect(isolate.workerPath()).toBe('/x/worker.js');
  });

  it('constructs without a worker path, and names the packaged file only when asked for it', () => {
    const isolate = createNodeHostIsolate();
    expect(() => isolate.workerPath()).toThrow(/pass workerPath/);
  });
});
