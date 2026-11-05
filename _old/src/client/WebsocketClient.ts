import {
    ConnectionState,
    type BaseMessage,
    type ErrorHandler,
    type MessageHandler,
    type StateHandler,
    type Unsubscribe,
    type WebSocketClientOptions,
  } from '../types';
 import { exponentialBackoff } from '../utils/Backoff';
  
  /**
   * Framework-agnostic WebSocket client.
   *
   * Responsibilities:
   *  - Manage the underlying WebSocket lifecycle
   *  - Reconnect with backoff
   *  - Send heartbeats and detect silent failures
   *  - Pub/sub dispatch by message.type
   *  - Queue outbound messages while offline
   *
   * The React hooks wrap this — the class itself has no React dependency,
   * so it's testable in isolation and reusable outside of components.
   */
  export class WebSocketClient<TMessage extends BaseMessage = BaseMessage> {
    private socket: WebSocket | null = null;
    private state: ConnectionState = ConnectionState.CLOSED;
  
    // Pub/sub: '*' subscribers receive every message; others filter by type.
    private readonly typeHandlers = new Map<string, Set<MessageHandler<TMessage>>>();
    private readonly wildcardHandlers = new Set<MessageHandler<TMessage>>();
    private readonly stateHandlers = new Set<StateHandler>();
    private readonly errorHandlers = new Set<ErrorHandler>();
  
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private deadConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  
    private readonly sendQueue: TMessage[] = [];
    private isClosedByUser = false;
  
    private readonly opts: Required<
      Omit<WebSocketClientOptions<TMessage>, 'protocols' | 'heartbeat'>
    > & {
      protocols: string | string[] | undefined;
      heartbeat: WebSocketClientOptions<TMessage>['heartbeat'];
    };
  
    constructor(options: WebSocketClientOptions<TMessage>) {
      // Resolve defaults once so we don't pay the cost on every method call.
      this.opts = {
        url: options.url,
        protocols: options.protocols,
        reconnect: options.reconnect ?? true,
        maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
        backoff: options.backoff ?? exponentialBackoff(),
        heartbeat: options.heartbeat,
        serialize: options.serialize ?? ((msg) => JSON.stringify(msg)),
        deserialize:
          options.deserialize ??
          ((data) => {
            if (typeof data !== 'string') return null;
            try {
              return JSON.parse(data) as TMessage;
            } catch {
              return null;
            }
          }),
        queueWhileDisconnected: options.queueWhileDisconnected ?? true,
        maxQueueSize: options.maxQueueSize ?? 100,
        autoConnect: options.autoConnect ?? true,
      };
  
      if (this.opts.autoConnect) {
        this.connect();
      }
    }
  
    // ===========================================================================
    // Public API
    // ===========================================================================
  
    /** Open the connection. Safe to call multiple times — no-op if already open. */
    connect(): void {
      if (
        this.socket &&
        (this.state === ConnectionState.OPEN ||
          this.state === ConnectionState.CONNECTING)
      ) {
        return;
      }
  
      this.isClosedByUser = false;
      this.setState(ConnectionState.CONNECTING);
  
      try {
        this.socket = new WebSocket(this.opts.url, this.opts.protocols);
      } catch (err) {
        // URL malformed, etc. Surface to error handlers and schedule a retry.
        this.emitError(err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect();
        return;
      }
  
      this.socket.addEventListener('open', this.handleOpen);
      this.socket.addEventListener('message', this.handleMessage);
      this.socket.addEventListener('error', this.handleError);
      this.socket.addEventListener('close', this.handleClose);
    }
  
    /**
     * Close the connection. By default this is treated as a user-initiated close,
     * so auto-reconnect is suppressed.
     */
    close(code = 1000, reason = 'client closed'): void {
      this.isClosedByUser = true;
      this.clearTimers();
      if (this.socket) {
        const socket = this.socket;
        // Remove listeners before closing so the browser's abort-error event
        // (fired when closing a CONNECTING socket) never reaches user handlers.
        this.cleanupSocket();
        this.setState(ConnectionState.CLOSING);
        socket.close(code, reason);
        this.setState(ConnectionState.CLOSED);
      } else {
        this.setState(ConnectionState.CLOSED);
      }
    }
  
    /**
     * Send a message. If the socket isn't open, the message is queued
     * (when queueWhileDisconnected is true) and flushed on (re)connect.
     *
     * Returns true if sent immediately, false if queued or dropped.
     */
    send(message: TMessage): boolean {
      if (this.socket && this.state === ConnectionState.OPEN) {
        this.socket.send(this.opts.serialize(message));
        return true;
      }
  
      if (this.opts.queueWhileDisconnected) {
        if (this.sendQueue.length >= this.opts.maxQueueSize) {
          // Drop the oldest — newer messages are usually more useful.
          this.sendQueue.shift();
        }
        this.sendQueue.push(message);
      }
      return false;
    }
  
    /**
     * Subscribe to messages of a specific type, or all messages via '*'.
     * Returns an unsubscribe function — call on cleanup.
     */
    subscribe<T extends TMessage['type'] | '*'>(
      type: T,
      handler: T extends '*'
        ? MessageHandler<TMessage>
        : MessageHandler<Extract<TMessage, { type: T }>>,
    ): Unsubscribe {
      if (type === '*') {
        const h = handler as MessageHandler<TMessage>;
        this.wildcardHandlers.add(h);
        return () => this.wildcardHandlers.delete(h);
      }
  
      const h = handler as MessageHandler<TMessage>;
      let set = this.typeHandlers.get(type);
      if (!set) {
        set = new Set();
        this.typeHandlers.set(type, set);
      }
      set.add(h);
      return () => {
        set!.delete(h);
        if (set!.size === 0) this.typeHandlers.delete(type);
      };
    }
  
    /** Subscribe to connection state changes. */
    onStateChange(handler: StateHandler): Unsubscribe {
      this.stateHandlers.add(handler);
      // Fire immediately with current state so subscribers can initialise UI.
      handler(this.state);
      return () => this.stateHandlers.delete(handler);
    }
  
    /** Subscribe to errors. */
    onError(handler: ErrorHandler): Unsubscribe {
      this.errorHandlers.add(handler);
      return () => this.errorHandlers.delete(handler);
    }
  
    /** Current connection state. */
    getState(): ConnectionState {
      return this.state;
    }
  
    // ===========================================================================
    // Internal — socket event handlers (arrow funcs to preserve `this`)
    // ===========================================================================
  
    private handleOpen = (): void => {
      this.reconnectAttempts = 0;
      this.setState(ConnectionState.OPEN);
      this.startHeartbeat();
      this.flushQueue();
    };
  
    private handleMessage = (event: MessageEvent): void => {
      // Any inbound traffic counts as proof of life — reset the dead-conn timer.
      this.resetDeadConnectionTimer();
  
      const message = this.opts.deserialize(event.data);
      if (message == null) return;
  
      // Dispatch to type-specific subscribers first, then wildcard.
      const typed = this.typeHandlers.get(message.type);
      if (typed) {
        // Copy to array so handlers can unsubscribe themselves without breaking iteration.
        for (const h of [...typed]) h(message);
      }
      for (const h of [...this.wildcardHandlers]) h(message);
    };
  
    private handleError = (event: Event): void => {
      this.emitError(event);
    };
  
    private handleClose = (): void => {
      this.cleanupSocket();
      this.stopHeartbeat();
  
      if (this.isClosedByUser || !this.opts.reconnect) {
        this.setState(ConnectionState.CLOSED);
        return;
      }
      this.scheduleReconnect();
    };
  
    // ===========================================================================
    // Internal — lifecycle helpers
    // ===========================================================================
  
    private scheduleReconnect(): void {
      if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
        this.setState(ConnectionState.CLOSED);
        return;
      }
      this.reconnectAttempts += 1;
      this.setState(ConnectionState.RECONNECTING);
  
      const delay = this.opts.backoff(this.reconnectAttempts);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }
  
    private startHeartbeat(): void {
      const hb = this.opts.heartbeat;
      if (!hb) return;
  
      const intervalMs = hb.intervalMs ?? 30_000;
      const timeoutMs = hb.timeoutMs ?? 60_000;
      const message = hb.message ?? ({ type: 'ping' } as unknown as TMessage);
  
      this.heartbeatTimer = setInterval(() => {
        if (this.socket && this.state === ConnectionState.OPEN) {
          const payload =
            typeof message === 'string' ? message : this.opts.serialize(message);
          this.socket.send(payload);
        }
      }, intervalMs);
  
      // Dead-connection detector — if no inbound traffic for `timeoutMs`,
      // force-close so the reconnect logic kicks in.
      this.resetDeadConnectionTimer(timeoutMs);
    }
  
    private resetDeadConnectionTimer(timeoutMs?: number): void {
      const hb = this.opts.heartbeat;
      if (!hb) return;
      const t = timeoutMs ?? hb.timeoutMs ?? 60_000;
  
      if (this.deadConnectionTimer) clearTimeout(this.deadConnectionTimer);
      this.deadConnectionTimer = setTimeout(() => {
        // Don't mark as user-closed — we want reconnect to fire.
        this.socket?.close(4000, 'heartbeat timeout');
      }, t);
    }
  
    private stopHeartbeat(): void {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.deadConnectionTimer) {
        clearTimeout(this.deadConnectionTimer);
        this.deadConnectionTimer = null;
      }
    }
  
    private clearTimers(): void {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.stopHeartbeat();
    }
  
    private flushQueue(): void {
      while (
        this.sendQueue.length > 0 &&
        this.socket &&
        this.state === ConnectionState.OPEN
      ) {
        const msg = this.sendQueue.shift()!;
        this.socket.send(this.opts.serialize(msg));
      }
    }
  
    private cleanupSocket(): void {
      if (!this.socket) return;
      this.socket.removeEventListener('open', this.handleOpen);
      this.socket.removeEventListener('message', this.handleMessage);
      this.socket.removeEventListener('error', this.handleError);
      this.socket.removeEventListener('close', this.handleClose);
      this.socket = null;
    }
  
    private setState(next: ConnectionState): void {
      if (next === this.state) return;
      this.state = next;
      for (const h of [...this.stateHandlers]) h(next);
    }
  
    private emitError(err: Event | Error): void {
      for (const h of [...this.errorHandlers]) h(err);
    }
  }