import { describe, expect, it } from 'vitest';
import { isNetProviderDenial, isNetTransportFailure } from '@markii/lua';
import { createNetBridge } from './net-bridge-worker.js';
import type { NetBridgeRequest } from './net-bridge.js';

async function failureFor(reply: Record<string, unknown>): Promise<unknown> {
  const sent: NetBridgeRequest[] = [];
  const bridge = createNetBridge((message) => sent.push(message));
  const pending = bridge.provider.get('http://x.example/');
  bridge.handleMessage({
    kind: 'markii:net-reply',
    id: sent[0]?.id,
    ok: false,
    error: 'request failed: boom',
    ...reply,
  });
  return pending.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('net bridge, worker half', () => {
  it('rebuilds a marked transport failure from the transport flag', async () => {
    const error = await failureFor({ transport: true });
    expect(isNetTransportFailure(error)).toBe(true);
    expect(isNetProviderDenial(error)).toBe(false);
  });

  it('leaves an unflagged failure plain', async () => {
    const error = await failureFor({});
    expect(isNetTransportFailure(error)).toBe(false);
    expect(isNetProviderDenial(error)).toBe(false);
  });

  it('rebuilds a denial from the denied flag, never as a transport failure', async () => {
    const error = await failureFor({ denied: true });
    expect(isNetProviderDenial(error)).toBe(true);
    expect(isNetTransportFailure(error)).toBe(false);
  });
});
