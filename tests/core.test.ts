import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSocket, defineSocket, fixedBackoff, type SocketOptions } from '../src';
import { MockWebSocket } from './helpers/MockWebSocket';

type Incoming = { type: 'notice'; payload: string } | { type: 'done'; payload: number };
type Outgoing = { type: 'send'; payload: string };
const definition = defineSocket<Incoming, Outgoing>('test');
const tick = async () => { await Promise.resolve(); };

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('logical connection', () => {
  it('preserves identity and subscriptions while updates replace transports', async () => {
    const socket = createSocket(definition, { url: 'wss://example.test/?token=A' });
    const received: string[] = [];
    socket.subscribe('notice', message => received.push(message.payload));
    const states: string[] = [];
    socket.subscribeState(() => states.push(socket.getSnapshot().status));
    socket.connect();
    await tick();
    const first = MockWebSocket.instances[0];
    first.open();
    first.message(JSON.stringify({ type: 'notice', payload: 'first' }));
    const stable = socket;

    socket.update({ url: 'wss://example.test/?token=B' });
    expect(first.closeCalls).toBe(1);
    first.message(JSON.stringify({ type: 'notice', payload: 'stale' }));
    first.open();
    await tick();
    const second = MockWebSocket.instances[1];
    expect(second.url).toContain('token=B');
    second.open();
    second.message(JSON.stringify({ type: 'notice', payload: 'second' }));
    expect(socket).toBe(stable);
    expect(received).toEqual(['first', 'second']);
    expect(states).toContain('RECONNECTING');
    expect(socket.getSnapshot().status).toBe('OPEN');
    socket.dispose();
  });

  it('coalesces rapid updates and keeps intentionally closed connections closed', async () => {
    const socket = createSocket(definition, { url: 'wss://example.test/A' });
    socket.connect();
    socket.update({ url: 'wss://example.test/B' });
    socket.update({ url: 'wss://example.test/C' });
    await tick();
    expect(MockWebSocket.instances.map(s => s.url)).toEqual(['wss://example.test/C']);
    socket.close();
    socket.update({ url: 'wss://example.test/D' });
    await tick();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.getSnapshot().status).toBe('CLOSED');
    socket.connect();
    await tick();
    expect(MockWebSocket.instances[1].url).toBe('wss://example.test/D');
    socket.dispose();
  });

  it('retries unexpected close, retains error, and cancels retry on close', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, {
      url: 'wss://example.test', reconnect: { backoff: fixedBackoff(10), maxAttempts: 2 },
    });
    socket.connect();
    await tick();
    MockWebSocket.instances[0].fail();
    expect(socket.getSnapshot()).toMatchObject({ status: 'RECONNECTING', reconnectAttempt: 1 });
    expect(socket.getSnapshot().lastError?.code).toBe('HANDSHAKE');
    await vi.advanceTimersByTimeAsync(10);
    expect(MockWebSocket.instances).toHaveLength(2);
    socket.close();
    MockWebSocket.instances[1].open();
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.getSnapshot().status).toBe('CLOSED');
    expect(MockWebSocket.instances).toHaveLength(2);
    socket.dispose();
  });

  it('bounds and flushes the queue, and never replays it after close', async () => {
    const socket = createSocket(definition, { url: 'wss://example.test', queue: { maxSize: 1 } });
    expect(socket.send({ type: 'send', payload: 'one' }).status).toBe('queued');
    expect(socket.send({ type: 'send', payload: 'two' })).toEqual({ status: 'rejected', reason: 'Queue is full' });
    socket.connect();
    await tick();
    MockWebSocket.instances[0].open();
    expect(MockWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: 'send', payload: 'one' })]);
    socket.update({ url: 'wss://example.test/next' });
    expect(socket.send({ type: 'send', payload: 'later' }).status).toBe('queued');
    socket.close();
    socket.connect();
    await tick();
    MockWebSocket.instances.at(-1)!.open();
    expect(MockWebSocket.instances.at(-1)!.sent).toEqual([]);
    socket.dispose();
  });

  it('resolves readiness, rejects on timeout, and releases waiters on dispose', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, { url: 'wss://example.test' });
    const ready = socket.whenOpen({ timeoutMs: 100 });
    socket.connect();
    await tick();
    MockWebSocket.instances[0].open();
    await expect(ready).resolves.toBeUndefined();
    socket.reconnect();
    const timeout = socket.whenOpen({ timeoutMs: 5 });
    const timeoutAssertion = expect(timeout).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(5);
    await timeoutAssertion;
    const disposed = socket.whenOpen();
    socket.dispose();
    await expect(disposed).rejects.toThrow('closed');
  });

  it('validates updates before committing and hides credential URLs from errors', async () => {
    const socket = createSocket(definition, { url: 'wss://example.test/?token=secret' });
    socket.connect();
    await tick();
    expect(() => socket.update({ url: 'https://example.test/?token=secret' })).toThrow('ws://');
    expect(socket.getSnapshot().lastError?.code).toBe('CONFIG');
    expect(JSON.stringify(socket.getSnapshot())).not.toContain('secret');
    socket.dispose();
  });

  it('sends heartbeats, detects silence, and removes transport timers on disposal', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, {
      url: 'wss://example.test',
      heartbeat: { message: 'ping', intervalMs: 5, timeoutMs: 12 },
      reconnect: { backoff: fixedBackoff(1) },
    });
    socket.connect();
    await tick();
    const transport = MockWebSocket.instances[0];
    transport.open();
    await vi.advanceTimersByTimeAsync(5);
    expect(transport.sent).toEqual(['ping']);
    await vi.advanceTimersByTimeAsync(7);
    expect(transport.closeCalls).toBe(1);
    transport.fail(4000);
    expect(socket.getSnapshot().status).toBe('RECONNECTING');
    expect(socket.getSnapshot().lastError).toMatchObject({ code: 'CLOSE', reason: 'HEARTBEAT_TIMEOUT' });
    socket.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('tags heartbeat send failures and leaves other closes untagged', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, {
      url: 'wss://example.test',
      heartbeat: { message: 'ping', intervalMs: 5, timeoutMs: 100 },
      reconnect: { backoff: fixedBackoff(1) },
    });
    socket.connect();
    await tick();
    const first = MockWebSocket.instances[0];
    first.open();
    first.send = () => { throw new Error('secret'); };
    await vi.advanceTimersByTimeAsync(5);
    expect(first.closeCalls).toBe(1);
    first.fail(4000);
    expect(socket.getSnapshot().lastError).toMatchObject({ code: 'CLOSE', reason: 'HEARTBEAT_SEND_FAILED' });
    expect(JSON.stringify(socket.getSnapshot())).not.toContain('secret');
    await vi.advanceTimersByTimeAsync(1);
    const second = MockWebSocket.instances[1];
    second.open();
    second.fail();
    expect(socket.getSnapshot().lastError?.reason).toBeUndefined();
    socket.dispose();
  });

  it('discards codec-rejected messages and lets valid queued messages through', async () => {
    const socket = createSocket(definition, {
      url: 'wss://example.test',
      codec: {
        encode: message => {
          if (message.payload === 'bad') throw new Error('secret');
          return JSON.stringify(message);
        },
        decode: () => null,
      },
    });
    socket.send({ type: 'send', payload: 'bad' });
    socket.send({ type: 'send', payload: 'good' });
    socket.connect();
    await tick();
    MockWebSocket.instances[0].open();
    expect(MockWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: 'send', payload: 'good' })]);
    expect(socket.getSnapshot().lastError?.code).toBe('SERIALIZE');
    expect(JSON.stringify(socket.getSnapshot())).not.toContain('secret');
    socket.dispose();
  });
});

describe('retry limits', () => {
  it('stops with RETRY_EXHAUSTED once maxAttempts is used up and rejects waiters', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, {
      url: 'wss://example.test', reconnect: { backoff: fixedBackoff(1), maxAttempts: 1 },
    });
    socket.connect();
    const readyAssertion = expect(socket.whenOpen()).rejects.toThrow('could not be opened');
    await tick();
    MockWebSocket.instances[0].fail();
    expect(socket.getSnapshot()).toMatchObject({ status: 'RECONNECTING', reconnectAttempt: 1 });
    await vi.advanceTimersByTimeAsync(1);
    MockWebSocket.instances[1].fail();
    expect(socket.getSnapshot()).toMatchObject({ status: 'CLOSED', reconnectAttempt: 1 });
    expect(socket.getSnapshot().lastError?.code).toBe('RETRY_EXHAUSTED');
    await readyAssertion;
    await vi.advanceTimersByTimeAsync(100);
    expect(MockWebSocket.instances).toHaveLength(2);
    socket.dispose();
  });

  it('closes without retrying when reconnect is disabled', async () => {
    vi.useFakeTimers();
    const socket = createSocket(definition, { url: 'wss://example.test', reconnect: { enabled: false } });
    socket.connect();
    await tick();
    MockWebSocket.instances[0].fail();
    expect(socket.getSnapshot().status).toBe('CLOSED');
    expect(socket.getSnapshot().lastError?.code).toBe('HANDSHAKE');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    socket.dispose();
  });
});

describe('message dispatch', () => {
  const openSocket = async (options: Partial<SocketOptions<Incoming, Outgoing>> = {}) => {
    const socket = createSocket(definition, { url: 'wss://example.test', ...options });
    socket.connect();
    await tick();
    const transport = MockWebSocket.instances.at(-1)!;
    transport.open();
    return { socket, transport };
  };

  it('delivers typed handlers before wildcard handlers, and wildcard receives every type', async () => {
    const { socket, transport } = await openSocket();
    const calls: string[] = [];
    socket.subscribe('*', message => calls.push(`*:${message.type}`));
    socket.subscribe('notice', message => calls.push(`notice:${message.payload}`));
    transport.message(JSON.stringify({ type: 'notice', payload: 'a' }));
    transport.message(JSON.stringify({ type: 'done', payload: 1 }));
    expect(calls).toEqual(['notice:a', '*:notice', '*:done']);
    socket.dispose();
  });

  it('stops delivering after unsubscribe, even when a handler unsubscribes during dispatch', async () => {
    const { socket, transport } = await openSocket();
    const calls: string[] = [];
    const unsubscribeFirst = socket.subscribe('notice', () => { calls.push('first'); unsubscribeFirst(); });
    socket.subscribe('notice', () => calls.push('second'));
    const unsubscribeAll = socket.subscribe('*', () => calls.push('all'));
    transport.message(JSON.stringify({ type: 'notice', payload: 'a' }));
    expect(calls).toEqual(['first', 'second', 'all']);
    unsubscribeAll();
    transport.message(JSON.stringify({ type: 'notice', payload: 'b' }));
    expect(calls).toEqual(['first', 'second', 'all', 'second']);
    socket.dispose();
  });

  it('ignores messages the default codec cannot use and reports invalid JSON', async () => {
    const { socket, transport } = await openSocket();
    const received: unknown[] = [];
    socket.subscribe('*', message => received.push(message));
    transport.message(JSON.stringify({ payload: 'no type' }));
    transport.message(JSON.stringify({ type: 5 }));
    transport.message(JSON.stringify([1, 2]));
    transport.message(new ArrayBuffer(4));
    expect(socket.getSnapshot().lastError).toBeNull();
    transport.message('not json');
    expect(socket.getSnapshot().lastError?.code).toBe('DESERIALIZE');
    transport.message(JSON.stringify({ type: 'notice', payload: 'ok' }));
    expect(received).toEqual([{ type: 'notice', payload: 'ok' }]);
    socket.dispose();
  });

  it('discards custom-codec results without a string type', async () => {
    const { socket, transport } = await openSocket({
      codec: { encode: JSON.stringify, decode: () => ({}) as Incoming },
    });
    const received: unknown[] = [];
    socket.subscribe('*', message => received.push(message));
    transport.message('anything');
    expect(received).toEqual([]);
    expect(socket.getSnapshot().lastError).toMatchObject({ code: 'DESERIALIZE', message: 'Incoming message was discarded' });
    socket.dispose();
  });
});

describe('transport options', () => {
  it('passes protocols to the native WebSocket, including after update()', async () => {
    const socket = createSocket(definition, { url: 'wss://example.test', protocols: ['chat.v2', 'chat.v1'] });
    socket.connect();
    await tick();
    expect(MockWebSocket.instances[0].protocols).toEqual(['chat.v2', 'chat.v1']);
    socket.update({ protocols: 'chat.v3' });
    await tick();
    expect(MockWebSocket.instances[1].protocols).toBe('chat.v3');
    socket.dispose();
  });
});
