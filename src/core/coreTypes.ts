/** Minimum shape required for typed message subscriptions. */
export interface BaseMessage {
  /** Discriminator used to route an incoming message to subscribers. */
  type: string;
}

/**
 * Identifies a protocol and its message types without opening a connection.
 *
 * @typeParam Incoming - Messages accepted from the server.
 * @typeParam Outgoing - Messages the client may send.
 */
export interface SocketDefinition<Incoming extends BaseMessage, Outgoing extends BaseMessage> {
  /** Unique identity used by provider registrations. */
  readonly id: symbol;
  /** Human-readable name used in registration errors. */
  readonly name: string;
  /** Type-only brand that prevents different protocols from being interchanged. */
  readonly __messages?: (incoming: Incoming, outgoing: Outgoing) => [Incoming, Outgoing];
}

/** Payload accepted by `WebSocket.send` (shared-memory views are not allowed). */
export type WebSocketData = string | ArrayBuffer | Blob | ArrayBufferView<ArrayBuffer>;

/**
 * Converts outgoing messages to WebSocket data and incoming data to typed messages.
 *
 * @remarks Returning null from decode discards a message without recording an error.
 * A thrown exception or a value without a string type records a deserialization error.
 * @typeParam Incoming - Decoded server message type.
 * @typeParam Outgoing - Client message type to encode.
 */
export interface MessageCodec<Incoming extends BaseMessage, Outgoing extends BaseMessage> {
  /** Encodes a message before an open transport sends it. */
  encode(message: Outgoing): WebSocketData;
  /** Decodes MessageEvent.data; return null to ignore it. */
  decode(data: unknown): Incoming | null;
}

/** Receives a one-based retry attempt and returns a delay in milliseconds. */
export type BackoffStrategy = (attempt: number) => number;

/**
 * Optional heartbeat sent while the transport is open.
 *
 * @remarks Any incoming WebSocket message resets the silence timer. A timeout or
 * failed send closes the transport and follows the configured reconnection policy.
 * @typeParam Outgoing - Message type accepted by the configured codec.
 */
export interface HeartbeatOptions<Outgoing extends BaseMessage> {
  /**
   * Encoded through the codec unless given as a raw string.
   * @defaultValue The raw string '{"type":"ping"}'.
   */
  message?: Outgoing | string;
  /**
   * Time between sends in milliseconds; must be positive and finite.
   * @defaultValue 30000
   */
  intervalMs?: number;
  /**
   * Maximum silence in milliseconds; must be positive and finite.
   * @defaultValue 60000
   */
  timeoutMs?: number;
}

/** Policy applied after an unexpected close or failed handshake. */
export interface ReconnectOptions {
  /**
   * Whether to retry automatically.
   * @defaultValue true
   */
  enabled?: boolean;
  /**
   * Maximum retry count; accepts a nonnegative integer or Infinity.
   * @defaultValue Infinity
   */
  maxAttempts?: number;
  /**
   * Delay strategy called with a one-based attempt number.
   * @defaultValue exponentialBackoff()
   */
  backoff?: BackoffStrategy;
}

/** Outgoing messages buffered while the transport is not open. */
export interface QueueOptions {
  /**
   * Whether to buffer messages while disconnected.
   * @defaultValue true
   */
  enabled?: boolean;
  /**
   * Maximum buffered messages; new messages are rejected when full. Must be positive and finite.
   * @defaultValue 100
   */
  maxSize?: number;
}

/**
 * Configuration for a logical WebSocket connection.
 *
 * @remarks The URL is validated when created or updated. No native WebSocket is
 * allocated until connect is called or a React owner mounts.
 * @typeParam Incoming - Messages received from the server.
 * @typeParam Outgoing - Messages sent to the server.
 */
export interface SocketOptions<Incoming extends BaseMessage = BaseMessage, Outgoing extends BaseMessage = BaseMessage> {
  /** ws:// or wss:// endpoint. */
  url: string;
  /** Subprotocols passed to the native WebSocket constructor. */
  protocols?: string | string[];
  /** Heartbeat configuration; omit to disable heartbeats. */
  heartbeat?: HeartbeatOptions<Outgoing>;
  /** Retry configuration; retries are enabled by default. */
  reconnect?: ReconnectOptions;
  /** Outbound queue configuration; buffering is enabled by default. */
  queue?: QueueOptions;
  /**
   * Message codec.
   * @defaultValue JSON encoding and decoding of objects with a string type.
   */
  codec?: MessageCodec<Incoming, Outgoing>;
}

/**
 * Partial configuration accepted by SocketController.update.
 *
 * @remarks heartbeat, reconnect, and queue are merged one level deep. Pass
 * heartbeat: null to remove the heartbeat; omitted properties retain their values.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export type SocketOptionsPatch<I extends BaseMessage, O extends BaseMessage> =
  Partial<Omit<SocketOptions<I, O>, 'heartbeat' | 'reconnect' | 'queue'>> & {
    /** Partial heartbeat options, or null to disable heartbeats. */
    heartbeat?: HeartbeatOptions<O> | null;
    /** Partial retry policy, merged with the current policy. */
    reconnect?: ReconnectOptions;
    /** Partial outbound queue policy, merged with the current policy. */
    queue?: QueueOptions;
  };

/** Observable connection lifecycle state. */
export type SocketStatus = 'IDLE' | 'CONNECTING' | 'OPEN' | 'RECONNECTING' | 'CLOSED';

/** Category of the most recent connection error. */
export type SocketErrorCode = 'CONFIG' | 'TRANSPORT' | 'HANDSHAKE' | 'CLOSE' | 'SERIALIZE' | 'DESERIALIZE' | 'SEND' | 'QUEUE' | 'RETRY_EXHAUSTED';

/** Library-initiated reason for a heartbeat-related close. */
export type SocketErrorReason = 'HEARTBEAT_TIMEOUT' | 'HEARTBEAT_SEND_FAILED';

/** Sanitized error retained in a connection snapshot. */
export interface SocketError {
  /** Error category. */
  readonly code: SocketErrorCode;
  /** Description that deliberately excludes URLs, protocols, and native event details. */
  readonly message: string;
  /** Set when the library closed the socket because of heartbeat failure. */
  readonly reason?: SocketErrorReason;
}

/** Immutable state delivered to subscribers and React consumers. */
export interface ConnectionSnapshot {
  /** Current lifecycle state. */
  readonly status: SocketStatus;
  /** Whether the native transport is open. */
  readonly isConnected: boolean;
  /** Current one-based retry attempt; reset to zero after a successful open. */
  readonly reconnectAttempt: number;
  /** Most recent error, or null after a successful open or intentional close. */
  readonly lastError: SocketError | null;
}

/**
 * Immediate outcome of a send attempt.
 *
 * @remarks sent means the native WebSocket accepted the payload, not that the
 * server acknowledged it. queued means it will be attempted when next open.
 */
export type SendResult =
  | {
      /** Accepted by the native WebSocket. */
      status: 'sent';
    }
  | {
      /** Buffered until an open transport is available. */
      status: 'queued';
    }
  | {
      /** No send or queueing took place. */
      status: 'rejected';
      /** Explanation of the immediate rejection. */
      reason: string;
    };
/** Removes a message or state listener. Calling it again has no further effect. */
export type Unsubscribe = () => void;
/**
 * Extracts the message variant for an event type, or all variants for '*'.
 *
 * @typeParam I - Incoming message union.
 * @typeParam T - Discriminator to select, or '*' for every message.
 */
export type MessageOf<I extends BaseMessage, T extends I['type'] | '*'> = T extends '*' ? I : Extract<I, {
  /** Message discriminator used for extraction. */
  type: T;
}>;

/**
 * Consumer view for sending, observing, and awaiting a connection without lifecycle control.
 *
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export interface SocketView<I extends BaseMessage, O extends BaseMessage> {
  /**
   * Sends immediately if open, otherwise queues or rejects according to the queue policy.
   * @returns The immediate send, queue, or rejection outcome.
   */
  send(message: O): SendResult;
  /**
   * Listens for one message type, or all messages with '*'.
   * @returns A function that removes this listener.
   */
  subscribe<T extends I['type'] | '*'>(type: T, handler: (message: MessageOf<I, T>) => void): Unsubscribe;
  /** Returns the current immutable snapshot. */
  getSnapshot(): ConnectionSnapshot;
  /**
   * Registers a callback for snapshot changes.
   * @returns A function that removes this listener.
   */
  subscribeState(listener: () => void): Unsubscribe;
  /**
   * Waits for a native WebSocket open, including a later reconnect.
   *
   * @remarks This does not await application-level server registration and does
   * not start the connection.
   * @param options - Optional nonnegative, finite timeout in milliseconds.
   * @returns A promise that resolves on open.
   * @throws Rejects on timeout, closure, disposal, or exhausted retries.
   */
  whenOpen(options?: { timeoutMs?: number }): Promise<void>;
}

/**
 * Connection view with explicit lifecycle and configuration controls.
 *
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export interface SocketController<I extends BaseMessage, O extends BaseMessage> extends SocketView<I, O> {
  /** Starts an idle or intentionally closed connection; repeated calls while active do nothing. */
  connect(): void;
  /** Replaces an active transport using current options. Does nothing when inactive. */
  reconnect(): void;
  /**
   * Merges and validates options, replacing the transport when active.
   * @throws Throws when merged options are invalid; previous options remain in effect.
   */
  update(options: SocketOptionsPatch<I, O>): void;
  /** Stops retries, closes the transport, and discards queued messages. connect may reopen it. */
  close(): void;
}

/**
 * Callbacks from the native transport to the logical connection.
 * @internal
 */
export interface TransportEvents {
  open(): void;
  message(data: unknown): void;
  error(): void;
  close(code: number, wasClean: boolean, reason?: SocketErrorReason): void;
}
