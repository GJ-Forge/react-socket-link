import { describe, expect, it } from 'vitest';
import { defaultCodec, mergeOptions, validateOptions } from '../src/core/ConnectionOptions';
import { createSocket, defineSocket, fixedBackoff, type SocketOptions } from '../src';

const valid: SocketOptions = { url: 'wss://example.test' };
const definition = defineSocket('options');

describe('validateOptions', () => {
  it.each<[string, Partial<SocketOptions>, string]>([
    ['an unparseable url', { url: 'not a url' }, 'valid ws:// or wss:// URL'],
    ['an http url', { url: 'http://example.test' }, 'must use ws:// or wss://'],
    ['numeric protocols', { protocols: 5 as never }, 'protocols must be a string or an array of strings'],
    ['a mixed protocols array', { protocols: ['ok', 1] as never }, 'protocols must be a string or an array of strings'],
    ['a zero heartbeat interval', { heartbeat: { intervalMs: 0 } }, 'heartbeat.intervalMs must be a positive finite number'],
    ['a negative heartbeat interval', { heartbeat: { intervalMs: -1 } }, 'heartbeat.intervalMs'],
    ['a NaN heartbeat timeout', { heartbeat: { timeoutMs: NaN } }, 'heartbeat.timeoutMs'],
    ['an infinite heartbeat timeout', { heartbeat: { timeoutMs: Infinity } }, 'heartbeat.timeoutMs'],
    ['a zero queue size', { queue: { maxSize: 0 } }, 'queue.maxSize'],
    ['negative maxAttempts', { reconnect: { maxAttempts: -1 } }, 'reconnect.maxAttempts'],
    ['fractional maxAttempts', { reconnect: { maxAttempts: 1.5 } }, 'reconnect.maxAttempts'],
    ['NaN maxAttempts', { reconnect: { maxAttempts: NaN } }, 'reconnect.maxAttempts'],
    ['a non-function backoff', { reconnect: { backoff: 100 as never } }, 'reconnect.backoff must be a function'],
    ['a codec without decode', { codec: { encode: JSON.stringify } as never }, 'codec must provide encode and decode functions'],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => validateOptions({ ...valid, ...patch })).toThrow(message);
  });

  it.each<[string, Partial<SocketOptions>]>([
    ['a ws url', { url: 'ws://localhost:8080/path' }],
    ['a string protocol', { protocols: 'chat' }],
    ['zero maxAttempts', { reconnect: { maxAttempts: 0 } }],
    ['infinite maxAttempts', { reconnect: { maxAttempts: Infinity } }],
    ['a complete heartbeat', { heartbeat: { intervalMs: 1, timeoutMs: 2, message: 'ping' } }],
  ])('accepts %s', (_label, patch) => {
    expect(() => validateOptions({ ...valid, ...patch })).not.toThrow();
  });

  it('runs when a socket is created', () => {
    expect(() => createSocket(definition, { url: 'http://example.test' })).toThrow('ws://');
  });
});

describe('mergeOptions', () => {
  it('merges grouped options one level deep without mutating the current options', () => {
    const backoff = fixedBackoff(5);
    const current: SocketOptions = { url: 'wss://a.test', protocols: 'v1', reconnect: { maxAttempts: 3, backoff } };
    const next = mergeOptions(current, { url: 'wss://b.test', reconnect: { maxAttempts: 10 } });
    expect(next).toMatchObject({ url: 'wss://b.test', protocols: 'v1', reconnect: { maxAttempts: 10, backoff } });
    expect(current).toEqual({ url: 'wss://a.test', protocols: 'v1', reconnect: { maxAttempts: 3, backoff } });
  });

  it('removes heartbeat with null and keeps it when omitted', () => {
    const current: SocketOptions = { url: 'wss://a.test', heartbeat: { intervalMs: 10 } };
    expect(mergeOptions(current, {}).heartbeat).toEqual({ intervalMs: 10 });
    expect(mergeOptions(current, { heartbeat: { timeoutMs: 20 } }).heartbeat).toEqual({ intervalMs: 10, timeoutMs: 20 });
    expect(mergeOptions(current, { heartbeat: null }).heartbeat).toBeUndefined();
  });

  it('validates the merged result', () => {
    expect(() => mergeOptions(valid, { queue: { maxSize: -1 } })).toThrow('queue.maxSize');
  });
});

describe('defaultCodec', () => {
  it('encodes as JSON', () => {
    expect(defaultCodec.encode({ type: 'a' })).toBe('{"type":"a"}');
  });

  it('decodes JSON objects with a string type and returns null for everything else', () => {
    expect(defaultCodec.decode('{"type":"a","x":1}')).toEqual({ type: 'a', x: 1 });
    expect(defaultCodec.decode('{"x":1}')).toBeNull();
    expect(defaultCodec.decode('{"type":1}')).toBeNull();
    expect(defaultCodec.decode('null')).toBeNull();
    expect(defaultCodec.decode('"text"')).toBeNull();
    expect(defaultCodec.decode(new ArrayBuffer(2))).toBeNull();
    expect(() => defaultCodec.decode('not json')).toThrow();
  });
});
