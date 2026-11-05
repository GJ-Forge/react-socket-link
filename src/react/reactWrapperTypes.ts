import type { ReactNode } from 'react';
import type { BaseMessage, SocketDefinition, SocketOptions } from '../core/coreTypes';

/**
 * Associates a socket definition with its initial configuration for a provider.
 *
 * @remarks Create registrations with registerSocket to preserve their message types.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export interface SocketRegistration<I extends BaseMessage = any, O extends BaseMessage = any> {
  /** Definition used as the provider registry key. */
  definition: SocketDefinition<I, O>;
  /** Configuration used when the provider first creates this connection. */
  options: SocketOptions<I, O>;
}

/** Props for a provider that owns shared global connections. */
export interface SocketProviderProps {
  /** Registrations created when the provider first renders; later prop changes do not reconfigure them. */
  connections: readonly SocketRegistration[];
  /** React subtree that can access registered sockets. */
  children: ReactNode;
}

/**
 * Configuration for a connection owned by one useLocalSocket call.
 *
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 */
export interface LocalSocketOptions<I extends BaseMessage, O extends BaseMessage> {
  /** Identity key; changing it creates a new connection. */
  key?: PropertyKey;
  /** Initial options for this identity; call update for later changes. */
  options: SocketOptions<I, O>;
}
