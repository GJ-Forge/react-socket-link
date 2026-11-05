import type { BaseMessage, MessageCodec, SocketOptions, SocketOptionsPatch } from './coreTypes';

export const defaultCodec: MessageCodec<BaseMessage, BaseMessage> = {
  encode: JSON.stringify,
  decode(data) {
    if (typeof data !== 'string') return null;
    const value: unknown = JSON.parse(data);
    return typeof value === 'object' && value !== null &&
      'type' in value && typeof value.type === 'string' ? value as BaseMessage : null;
  },
};

const positive = (value: number | undefined, label: string) => {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive finite number`);
  }
};

export function validateOptions<I extends BaseMessage, O extends BaseMessage>(options: SocketOptions<I, O>): void {
  let url: URL;
  try { url = new URL(options.url); } catch { throw new Error('Socket URL must be a valid ws:// or wss:// URL'); }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Socket URL must use ws:// or wss://');
  }
  if (options.protocols !== undefined &&
    !(typeof options.protocols === 'string' ||
      (Array.isArray(options.protocols) && options.protocols.every(p => typeof p === 'string')))) {
    throw new Error('Socket protocols must be a string or an array of strings');
  }
  positive(options.heartbeat?.intervalMs, 'heartbeat.intervalMs');
  positive(options.heartbeat?.timeoutMs, 'heartbeat.timeoutMs');
  positive(options.queue?.maxSize, 'queue.maxSize');
  const maxAttempts = options.reconnect?.maxAttempts;
  if (maxAttempts !== undefined && !(maxAttempts === Infinity ||
    (Number.isInteger(maxAttempts) && maxAttempts >= 0))) {
    throw new Error('reconnect.maxAttempts must be a nonnegative integer or Infinity');
  }
  if (options.reconnect?.backoff !== undefined && typeof options.reconnect.backoff !== 'function') {
    throw new Error('reconnect.backoff must be a function');
  }
  if (options.codec && (typeof options.codec.encode !== 'function' || typeof options.codec.decode !== 'function')) {
    throw new Error('codec must provide encode and decode functions');
  }
}

export function mergeOptions<I extends BaseMessage, O extends BaseMessage>(
  current: SocketOptions<I, O>, patch: SocketOptionsPatch<I, O>,
): SocketOptions<I, O> {
  const next = {
    ...current, ...patch,
    heartbeat: patch.heartbeat === null ? undefined : patch.heartbeat === undefined
      ? current.heartbeat : { ...current.heartbeat, ...patch.heartbeat },
    reconnect: patch.reconnect === undefined ? current.reconnect : { ...current.reconnect, ...patch.reconnect },
    queue: patch.queue === undefined ? current.queue : { ...current.queue, ...patch.queue },
  };
  validateOptions(next);
  return next;
}
