import { createContext, useContext, useEffect, useRef } from 'react';
import type { BaseMessage, SocketDefinition, SocketOptions } from '../core/coreTypes';
import { createSocket, type LogicalConnection } from '../core/LogicalConnection';
import type { SocketProviderProps, SocketRegistration } from './reactWrapperTypes';

/**
 * Binds connection options to a definition before placing it in a provider list.
 *
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param definition - Shared protocol identity.
 * @param options - Initial connection configuration.
 * @returns A typed provider registration.
 */
export function registerSocket<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>, options: SocketOptions<I, O>,
): SocketRegistration<I, O> {
  return { definition, options };
}

type Registry = Map<symbol, LogicalConnection<any, any>>;
const SocketContext = createContext<Registry | null>(null);

/**
 * Owns and activates registered global connections for its React subtree.
 *
 * @remarks Connections start on mount even without consumers. Each definition
 * maps to one shared logical connection. Initial registrations are captured on
 * first render; use a controller's update method for later option changes.
 * Unmount closes and disposes owned connections.
 * @param props - Registrations and child content.
 * @throws During render if the same definition is registered twice.
 * @example
 * <SocketProvider connections={[registerSocket(chat, { url: 'wss://example.com/chat' })]}>
 *   <Chat />
 * </SocketProvider>
 */
export function SocketProvider({ connections, children }: SocketProviderProps) {
  const registryRef = useRef<Registry | null>(null);
  const lifecycleRef = useRef(0);
  if (!registryRef.current) {
    const registry: Registry = new Map();
    for (const { definition, options } of connections) {
      if (registry.has(definition.id)) throw new Error(`Duplicate socket definition: ${definition.name}`);
      registry.set(definition.id, createSocket(definition, options));
    }
    registryRef.current = registry;
  }

  useEffect(() => {
    const version = ++lifecycleRef.current;
    const registry = registryRef.current!;
    for (const socket of registry.values()) socket.connect();
    return () => {
      for (const socket of registry.values()) socket.close();
      queueMicrotask(() => {
        if (lifecycleRef.current === version) {
          for (const socket of registry.values()) socket.dispose();
        }
      });
    };
  }, []);

  return <SocketContext.Provider value={registryRef.current}>{children}</SocketContext.Provider>;
}

/**
 * Resolves a registered controller from provider context.
 *
 * @remarks Shared by the public global socket hooks.
 * @throws If no provider exists or the definition is not registered.
 * @internal
 */
export function useProviderSocket<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>,
): LogicalConnection<I, O> {
  const registry = useContext(SocketContext);
  if (!registry) throw new Error('Global socket hooks require <SocketProvider>');
  const socket = registry.get(definition.id);
  if (!socket) throw new Error(`Socket definition is not registered: ${definition.name}`);
  return socket as LogicalConnection<I, O>;
}
