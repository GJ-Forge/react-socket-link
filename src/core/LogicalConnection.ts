import type {
  BaseMessage, ConnectionSnapshot, MessageCodec, MessageOf, SendResult, SocketController, SocketDefinition,
  SocketError, SocketErrorCode, SocketErrorReason, SocketOptions, SocketOptionsPatch, SocketStatus, Unsubscribe,
} from './coreTypes';
import { defaultCodec, mergeOptions, validateOptions } from './ConnectionOptions';
import { snapshot } from './ConnectionState';
import { WebSocketTransport } from './WebSocketTransport';
import { exponentialBackoff } from '../utils/Backoff';

type Waiter = { resolve(): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> };

/**
 * Owns a stable connection identity across replaceable native WebSockets.
 *
 * @remarks Retains listeners and queued messages across reconnects. Transport
 * replacement closes the old socket first; server messages during the gap may
 * be lost. Call dispose when a standalone connection is no longer needed.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export class LogicalConnection<I extends BaseMessage, O extends BaseMessage> implements SocketController<I, O> {
  private options: SocketOptions<I, O>;
  private transport: WebSocketTransport<I, O> | null = null;
  private currentSnapshot = snapshot('IDLE');
  private readonly stateListeners = new Set<() => void>();
  private readonly messageListeners = new Map<string, Set<(message: I) => void>>();
  private readonly waiters = new Set<Waiter>();
  private readonly queue: O[] = [];
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private disposed = false;

  /**
   * Validates initial options without opening a native WebSocket.
   * @throws If the URL or another option is invalid.
   */
  constructor(
    /** Protocol identity associated with this connection. */
    readonly definition: SocketDefinition<I, O>,
    options: SocketOptions<I, O>,
  ) {
    validateOptions(options);
    this.options = mergeOptions(options, {});
  }

  /** Returns the current immutable snapshot; its reference changes only on a state transition. */
  getSnapshot = (): ConnectionSnapshot => this.currentSnapshot;

  /** Registers a state listener and returns its removal function. */
  subscribeState = (listener: () => void): Unsubscribe => {
    if (this.disposed) return () => {};
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  };

  /** Subscribes to a message type, or all incoming messages with '*'. */
  subscribe<T extends I['type'] | '*'>(type: T, handler: (message: MessageOf<I, T>) => void): Unsubscribe {
    if (this.disposed) return () => {};
    let handlers = this.messageListeners.get(type);
    if (!handlers) {
      handlers = new Set();
      this.messageListeners.set(type, handlers);
    }
    const callback = handler as (message: I) => void;
    handlers.add(callback);
    return () => {
      handlers?.delete(callback);
      if (handlers?.size === 0) this.messageListeners.delete(type);
    };
  }

  /** Starts an idle or closed connection; repeated calls while active do nothing. */
  connect(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.transition('CONNECTING', 0, null);
    this.startAttempt('CONNECTING');
  }

  /** Replaces the active transport using current options; does nothing when inactive. */
  reconnect(): void {
    if (this.disposed || !this.active) return;
    if (this.currentSnapshot.status === 'RECONNECTING' && !this.retryTimer) return;
    this.startAttempt('RECONNECTING');
  }

  /**
   * Validates and merges options, then replaces an active transport.
   * @throws If the merged options are invalid; prior options remain in effect.
   */
  update(patch: SocketOptionsPatch<I, O>): void {
    if (this.disposed) return;
    if (Object.keys(patch).length === 0) return;
    try { this.options = mergeOptions(this.options, patch); }
    catch (error) {
      this.recordError('CONFIG', error instanceof Error ? error.message : 'Invalid socket configuration');
      throw error;
    }
    if (this.active) this.startAttempt(this.currentSnapshot.status === 'CONNECTING' ? 'CONNECTING' : 'RECONNECTING');
  }

  /** Stops retries, clears queued messages, and closes the transport; connect may reopen it. */
  close(): void {
    if (this.disposed) return;
    this.active = false;
    this.generation++;
    this.clearRetry();
    this.retireTransport();
    this.queue.length = 0;
    this.rejectWaiters('Connection closed');
    this.transition('CLOSED', 0, null);
  }

  /** Permanently closes the connection and removes all listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
    this.messageListeners.clear();
    this.stateListeners.clear();
  }

  /**
   * Sends on an open transport or queues according to the queue policy.
   * @returns An immediate outcome; sent is not a server delivery acknowledgement.
   */
  send(message: O): SendResult {
    if (this.disposed || this.currentSnapshot.status === 'CLOSED') return { status: 'rejected', reason: 'Connection is closed' };
    if (this.transport?.isOpen) {
      let data: ReturnType<MessageCodec<I, O>['encode']>;
      try { data = this.codec().encode(message); }
      catch { this.recordError('SERIALIZE', 'Could not serialize outgoing message'); return { status: 'rejected', reason: 'Serialization failed' }; }
      try { this.transport.send(data); return { status: 'sent' }; }
      catch { this.recordError('SEND', 'Could not send message'); return { status: 'rejected', reason: 'Transport send failed' }; }
    }
    if (this.options.queue?.enabled === false) return { status: 'rejected', reason: 'Connection is not open' };
    if (this.queue.length >= (this.options.queue?.maxSize ?? 100)) {
      this.recordError('QUEUE', 'Outgoing message queue is full');
      return { status: 'rejected', reason: 'Queue is full' };
    }
    this.queue.push(message);
    return { status: 'queued' };
  }

  /**
   * Waits for a native WebSocket open without starting the connection.
   * @param options - Optional nonnegative, finite timeout in milliseconds.
   * @throws Rejects on timeout, closure, disposal, or exhausted retries.
   */
  whenOpen(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.disposed || this.currentSnapshot.status === 'CLOSED') return Promise.reject(new Error('Connection is closed'));
    if (this.currentSnapshot.status === 'OPEN') return Promise.resolve();
    const { timeoutMs } = options;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      return Promise.reject(new Error('timeoutMs must be a nonnegative finite number'));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (timeoutMs !== undefined) waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('Timed out waiting for connection to open'));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private codec(): MessageCodec<I, O> {
    return this.options.codec ?? defaultCodec as MessageCodec<I, O>;
  }

  /** Replaces the transport; the generation guard ignores events from retired sockets. */
  private startAttempt(status: SocketStatus): void {
    const generation = ++this.generation;
    this.clearRetry();
    this.retireTransport();
    this.transition(status, status === 'CONNECTING' ? 0 : this.currentSnapshot.reconnectAttempt,
      status === 'CONNECTING' ? null : this.currentSnapshot.lastError);
    // Coalesce synchronous updates before allocating any native WebSocket.
    queueMicrotask(() => {
      if (!this.active || this.disposed || generation !== this.generation) return;
      const transport = new WebSocketTransport(
        this.options.url, this.options.protocols,
        this.options.heartbeat && { ...this.options.heartbeat }, this.codec(), {
          open: () => {
            if (!this.isCurrent(generation, transport)) return;
            this.transition('OPEN', 0, null);
            this.resolveWaiters();
            this.flushQueue();
          },
          message: data => {
            if (!this.isCurrent(generation, transport)) return;
            let message: I | null;
            try { message = this.codec().decode(data); }
            catch { this.recordError('DESERIALIZE', 'Could not deserialize incoming message'); return; }
            if (message === null) return;
            if (!message || typeof message.type !== 'string') {
              this.recordError('DESERIALIZE', 'Incoming message was discarded');
              return;
            }
            for (const handler of [...(this.messageListeners.get(message.type) ?? [])]) handler(message);
            for (const handler of [...(this.messageListeners.get('*') ?? [])]) handler(message);
          },
          error: () => {
            if (this.isCurrent(generation, transport)) this.recordError('TRANSPORT', 'WebSocket transport error');
          },
          close: (code, wasClean, reason) => {
            if (!this.isCurrent(generation, transport)) return;
            this.transport = null;
            transport.dispose();
            this.recordError(this.currentSnapshot.status === 'CONNECTING' ? 'HANDSHAKE' : 'CLOSE',
              wasClean ? 'WebSocket closed unexpectedly' : `WebSocket closed unexpectedly (code ${code})`, reason);
            this.scheduleRetry();
          },
        },
      );
      this.transport = transport;
      try { transport.connect(); }
      catch {
        if (!this.isCurrent(generation, transport)) return;
        this.transport = null;
        transport.dispose();
        this.recordError('HANDSHAKE', 'Could not create WebSocket transport');
        this.scheduleRetry();
      }
    });
  }

  /** Schedules an allowed retry or closes after the retry policy is exhausted. */
  private scheduleRetry(): void {
    if (!this.active || this.disposed) return;
    if (this.options.reconnect?.enabled === false) {
      this.stopRetrying();
      return;
    }
    const attempt = this.currentSnapshot.reconnectAttempt + 1;
    if (attempt > (this.options.reconnect?.maxAttempts ?? Infinity)) {
      this.recordError('RETRY_EXHAUSTED', 'WebSocket retry limit reached');
      this.stopRetrying();
      return;
    }
    let delay: number;
    try { delay = (this.options.reconnect?.backoff ?? exponentialBackoff())(attempt); }
    catch { delay = 0; }
    if (!Number.isFinite(delay) || delay < 0) delay = 0;
    this.transition('RECONNECTING', attempt, this.currentSnapshot.lastError);
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.active && !this.disposed && generation === this.generation) this.startAttempt('RECONNECTING');
    }, delay);
  }

  private stopRetrying(): void {
    this.active = false;
    this.queue.length = 0;
    this.transition('CLOSED', this.currentSnapshot.reconnectAttempt, this.currentSnapshot.lastError);
    this.rejectWaiters('Connection could not be opened');
  }

  private flushQueue(): void {
    while (this.queue.length && this.transport?.isOpen) {
      const result = this.send(this.queue[0]);
      if (result.status === 'rejected' && result.reason !== 'Serialization failed') return;
      this.queue.shift();
    }
  }

  private isCurrent(generation: number, transport: WebSocketTransport<I, O>): boolean {
    return this.active && !this.disposed && generation === this.generation && transport === this.transport;
  }

  private retireTransport(): void {
    const previous = this.transport;
    this.transport = null;
    previous?.dispose();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private recordError(code: SocketErrorCode, message: string, reason?: SocketErrorReason): void {
    const error: SocketError = Object.freeze(reason ? { code, message, reason } : { code, message });
    this.transition(this.currentSnapshot.status, this.currentSnapshot.reconnectAttempt, error);
  }

  private transition(status: SocketStatus, reconnectAttempt: number, lastError: SocketError | null): void {
    const current = this.currentSnapshot;
    if (current.status === status && current.reconnectAttempt === reconnectAttempt && current.lastError === lastError) return;
    this.currentSnapshot = snapshot(status, reconnectAttempt, lastError);
    for (const listener of [...this.stateListeners]) listener();
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.waiters.clear();
  }

  private rejectWaiters(message: string): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.waiters.clear();
  }
}

/**
 * Creates a standalone logical connection without opening a WebSocket.
 *
 * @remarks Call connect to start it and dispose to release it permanently.
 * React consumers normally use SocketProvider or useLocalSocket instead.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param definition - Reusable protocol identity.
 * @param options - Initial connection configuration.
 * @returns A controller with an initial IDLE snapshot.
 * @throws If initial options are invalid.
 * @example
 * const socket = createSocket(chat, { url: 'wss://example.com/chat' });
 * socket.connect();
 * await socket.whenOpen({ timeoutMs: 10000 });
 * // Later: socket.dispose();
 */
export function createSocket<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>, options: SocketOptions<I, O>,
): LogicalConnection<I, O> {
  return new LogicalConnection(definition, options);
}
