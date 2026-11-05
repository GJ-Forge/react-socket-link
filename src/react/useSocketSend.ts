import { useCallback } from 'react';
import type { BaseMessage, SendResult, SocketView } from '../core/coreTypes';

/**
 * Returns a send callback bound to a socket view.
 *
 * @remarks The callback reference remains stable while the socket reference is unchanged.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param socket - View used to send messages.
 * @returns A callback that reports the immediate send outcome.
 */
export function useSocketSend<I extends BaseMessage, O extends BaseMessage>(
  socket: SocketView<I, O>,
): (message: O) => SendResult {
  return useCallback((message: O) => socket.send(message), [socket]);
}
