import { useEffect, useMemo, useRef } from 'react';
import type { BaseMessage, SocketController, SocketDefinition } from '../core/coreTypes';
import { createSocket } from '../core/LogicalConnection';
import type { LocalSocketOptions } from './reactWrapperTypes';

/**
 * Owns a connection locally without requiring a provider.
 *
 * @remarks The connection starts after mount and closes on cleanup. A change to
 * definition or key replaces and disposes the old identity; ordinary rerenders
 * keep it. Initial options are used only when an identity is created, so call
 * update for later configuration changes.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param definition - Protocol identity.
 * @param config - Initial options and optional identity key.
 * @returns A controller owned by this hook call.
 * @example
 * const socket = useLocalSocket(chat, {
 *   key: roomId,
 *   options: { url: roomUrl },
 * });
 */
export function useLocalSocket<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>, config: LocalSocketOptions<I, O>,
): SocketController<I, O> {
  const socket = useMemo(
    () => createSocket(definition, config.options),
    // Configuration objects are intentionally excluded. The explicit key changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, config.key],
  );
  const lifecycles = useRef(new WeakMap<object, number>());

  useEffect(() => {
    const version = (lifecycles.current.get(socket) ?? 0) + 1;
    lifecycles.current.set(socket, version);
    socket.connect();
    return () => {
      socket.close();
      queueMicrotask(() => {
        if (lifecycles.current.get(socket) === version) socket.dispose();
      });
    };
  }, [socket]);

  return socket;
}
