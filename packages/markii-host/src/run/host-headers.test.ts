import { describe, expect, it } from 'vitest';
import { createFetchNetProvider } from '../browser';
import { createNodeHostIsolate } from './node-isolate';
import { normalizeNodeHostHeaders } from './net-provider';

const ORIGIN = 'https://api.github.com';

describe('host header validation', () => {
  it('normalizes the origin and lower-cases names', () => {
    const map = normalizeNodeHostHeaders({
      'https://API.github.com:443/': {
        Authorization: 'Bearer x',
        'X-Key': '1',
      },
    });
    expect(map.get(ORIGIN)).toEqual({
      authorization: 'Bearer x',
      'x-key': '1',
    });
  });

  it('lets user-agent and accept be overridden', () => {
    expect(() =>
      normalizeNodeHostHeaders({
        [ORIGIN]: { 'User-Agent': 'markii', Accept: 'application/json' },
      }),
    ).not.toThrow();
  });

  it.each([
    'https://api.github.com/v3',
    'ftp://x.example',
    'api.github.com',
    'https://u:p@x.example',
    'https://x.example/?q=1',
  ])('refuses the key %s', (key) => {
    expect(() => normalizeNodeHostHeaders({ [key]: { a: 'b' } })).toThrow(
      /headers:/,
    );
  });

  it.each([
    'Host',
    'Content-Length',
    'content-type',
    'Transfer-Encoding',
    'Connection',
  ])('refuses the framing header %s', (name) => {
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { [name]: 'x' } }),
    ).toThrow(/cannot be overridden/);
  });

  it('refuses line breaks and invalid names or values', () => {
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { a: 'b\r\nx: y' } }),
    ).toThrow(/line break/);
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { 'a\nb': 'c' } }),
    ).toThrow(/line break/);
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { 'bad name': 'c' } }),
    ).toThrow(/not a valid header/);
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { a: 'café☃' } }),
    ).toThrow(/not a valid header/);
  });

  it('refuses a duplicate name after lower-casing', () => {
    expect(() =>
      normalizeNodeHostHeaders({ [ORIGIN]: { A: '1', a: '2' } }),
    ).toThrow(/twice/);
  });

  it('throws at construction on the node isolate and the browser provider', () => {
    expect(() =>
      createNodeHostIsolate({ headers: { nope: { a: 'b' } } }),
    ).toThrow(/headers:/);
    expect(() =>
      createFetchNetProvider({ headers: { [ORIGIN]: { host: 'x' } } }),
    ).toThrow(/cannot be overridden/);
    expect(() =>
      createFetchNetProvider({ headers: { [ORIGIN]: { 'bad name': 'x' } } }),
    ).toThrow(/not a valid header/);
  });
});
