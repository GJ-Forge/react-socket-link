import { useEffect, useRef } from 'react';
import type { BaseMessage, MessageOf, SocketView } from '../core/coreTypes';

/**
 * Subscribes to one typed incoming event, or all events with '*'.
 *
 * @remarks The subscription is removed on cleanup or when socket or type changes.
 * The latest handler is used without resubscribing on every render.
 * @typeParam I - Incoming message union.
 * @typeParam O - Outgoing message type.
 * @typeParam T - Event discriminator or '*'.
 * @param socket - View to observe.
 * @param type - Message type to receive.
 * @param handler - Callback for matching messages.
 */
export function useSocketEvent<I extends BaseMessage, O extends BaseMessage, T extends I['type'] | '*'>(
  socket: SocketView<I, O>, type: T, handler: (message: MessageOf<I, T>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => socket.subscribe(type, message => handlerRef.current(message)), [socket, type]);
}
