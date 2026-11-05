import { useSyncExternalStore } from 'react';
import type { BaseMessage, ConnectionSnapshot, SocketView } from '../core/coreTypes';

/**
 * Observes the current connection snapshot in React.
 *
 * @remarks Uses the socket's external-store subscription and rerenders when its
 * snapshot changes. Accepts a global view or local controller.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param socket - View to observe.
 * @returns The current immutable connection snapshot.
 */
export function useSocketState<I extends BaseMessage, O extends BaseMessage>(
  socket: SocketView<I, O>,
): ConnectionSnapshot {
  return useSyncExternalStore(socket.subscribeState, socket.getSnapshot, socket.getSnapshot);
}
