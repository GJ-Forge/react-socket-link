/**
 * Connection lifecycle states.
 * Mirrors the native WebSocket readyState plus a RECONNECTING state.
 */
export enum ConnectionState {
    CONNECTING = 'CONNECTING',
    OPEN = 'OPEN',
    CLOSING = 'CLOSING',
    CLOSED = 'CLOSED',
    RECONNECTING = 'RECONNECTING',
  }
   
  /**
   * Base shape for typed messages. Extend this with a discriminated union
   * to get exhaustive type checking in subscribers.
   *
   * @example
   *   type ChatMessage =
   *     | { type: 'chat'; payload: { user: string; text: string } }
   *     | { type: 'presence'; payload: { user: string; online: boolean } };
   */
  export interface BaseMessage<TType extends string = string, TPayload = unknown> {
    type: TType;
    payload?: TPayload;
  }
   
  /** Listener for messages of a specific type. */
  export type MessageHandler<TMessage extends BaseMessage> = (
    message: TMessage,
  ) => void;
   
  /** Listener for connection state changes. */
  export type StateHandler = (state: ConnectionState) => void;
   
  /** Listener for raw errors (network failures, parse errors, etc.). */
  export type ErrorHandler = (error: Event | Error) => void;
   
  /** Function returned by subscribe() — call it to unsubscribe. */
  export type Unsubscribe = () => void;
   
  /**
   * Strategy for deciding how long to wait between reconnect attempts.
   * Receives the attempt number (1-indexed) and returns milliseconds.
   */
  export type BackoffStrategy = (attempt: number) => number;
   
  /**
   * Configuration for a single WebSocket client.
   */
  export interface WebSocketClientOptions<TMessage extends BaseMessage> {
    /** WebSocket URL (ws:// or wss://). */
    url: string;
    /** Optional sub-protocols passed to the native WebSocket constructor. */
    protocols?: string | string[];
    /** Enable auto-reconnect. Default: true. */
    reconnect?: boolean;
    /** Max reconnect attempts before giving up. Default: Infinity. */
    maxReconnectAttempts?: number;
    /**
     * Backoff strategy. Default: exponential with full jitter,
     * capped at 30s (1s, 2s, 4s, 8s, ...).
     */
    backoff?: BackoffStrategy;
    /**
     * Heartbeat config — sends a ping message at a regular interval
     * and treats a missed pong as a dead connection.
     */
    heartbeat?: {
      /** Message to send. Default: { type: 'ping' }. */
      message?: TMessage | string;
      /** Interval between pings in ms. Default: 30000. */
      intervalMs?: number;
      /** How long to wait for any inbound message before forcing reconnect. Default: 60000. */
      timeoutMs?: number;
    };
    /**
     * Serializer for outbound messages. Default: JSON.stringify.
     * Return a string, ArrayBuffer, or Blob.
     */
    serialize?: (message: TMessage) => string | ArrayBuffer | Blob;
    /**
     * Deserializer for inbound messages. Default: JSON.parse on string data.
     * Return null/undefined to drop the message silently.
     */
    deserialize?: (data: unknown) => TMessage | null | undefined;
    /**
     * Queue messages sent while disconnected and flush on reconnect.
     * Default: true.
     */
    queueWhileDisconnected?: boolean;
    /** Max queued messages. Default: 100. Older messages are dropped. */
    maxQueueSize?: number;
    /** Whether to start connecting immediately on construction. Default: true. */
    autoConnect?: boolean;
  }