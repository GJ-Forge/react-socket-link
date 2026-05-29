import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketProvider';
import { ConnectionState, type BaseMessage } from '../types';
import type { WebSocketClient } from '../client/WebsocketClient';

/**
 * Get the client for a named connection.
 *
 * Returns a stable reference — the same client instance is returned across
 * renders so you can safely use it in deps arrays.
 */
export function useWebSocket<TMessage extends BaseMessage = BaseMessage>(
  name: string,
): WebSocketClient<TMessage> {
  const { getClient } = useWebSocketContext();
  // Resolve synchronously when `name` changes so hooks in the same render
  // (e.g. useSubscription) always target the correct client instance.
  return useMemo(() => getClient<TMessage>(name), [getClient, name]);
}

/**
 * Subscribe to messages of a specific type on a named connection.
 *
 * Re-subscribes only when the connection name or message type changes.
 * The handler ref pattern keeps the subscription stable even if the
 * caller passes an inline function (which would otherwise re-subscribe
 * on every render).
 */
export function useSubscription<
  TMessage extends BaseMessage,
  TType extends TMessage['type'] | '*' = '*',
>(
  name: string,
  type: TType,
  handler: (
    message: TType extends '*' ? TMessage : Extract<TMessage, { type: TType }>,
  ) => void,
): void {
  const client = useWebSocket<TMessage>(name);

  // Stash the latest handler in a ref so subscribers don't churn when the
  // caller passes a fresh function each render.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const unsubscribe = client.subscribe(
      type as TMessage['type'] | '*',
      ((msg: TMessage) => {
        // Cast is safe — the client only dispatches matching types to this handler.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handlerRef.current(msg as any);
      }) as never,
    );
    return unsubscribe;
  }, [client, name, type]);
}

/**
 * Track the connection state of a named connection as React state.
 *
 * Triggers a re-render on every state transition (CONNECTING → OPEN, etc.).
 */
export function useConnectionState(name: string): ConnectionState {
  const client = useWebSocket(name);
  const [state, setState] = useState<ConnectionState>(() => client.getState());

  useEffect(() => {
    // onStateChange fires immediately with the current value, keeping us in sync
    // even if state changed between render and effect.
    const unsubscribe = client.onStateChange(setState);
    return unsubscribe;
  }, [client]);

  return state;
}

/**
 * Get a stable `send` function bound to a named connection.
 *
 * The returned function has a stable identity across renders, so it's safe
 * to include in dependency arrays of other hooks.
 */
export function useSend<TMessage extends BaseMessage = BaseMessage>(
  name: string,
): (message: TMessage) => boolean {
  const client = useWebSocket<TMessage>(name);
  return useCallback((message: TMessage) => client.send(message), [client]);
}

/**
 * Get a stable function for closing and discarding a client by name.
 *
 * The next call to a hook with the same name will recreate the client
 * from config. Useful for cleaning up dynamic connections (rooms, docs).
 */
export function useCloseClient(): (name: string) => void {
  const { closeClient } = useWebSocketContext();
  return useCallback((name: string) => closeClient(name), [closeClient]);
}

/**
 * Manages a single dynamic connection that follows an ID over time.
 *
 * When the ID changes (e.g. user switches rooms), the previous connection
 * is closed and a new one is opened. On unmount, the active connection
 * is closed.
 *
 * Pass `null` to deactivate without choosing a new ID (e.g. leaving a room
 * without joining another). The returned value is the connection name to
 * pass to `useConnectionState`, `useSend`, `useSubscription`, or null.
 *
 * The Provider's `resolve` function must handle the resulting name
 * (typically of the form `${prefix}:${id}`).
 *
 * @example
 *   const connectionName = useDynamicConnection('room', activeRoomId);
 *   const send = connectionName ? useSend(connectionName) : null;
 */
export function useDynamicConnection(
  namePrefix: string,
  id: string | null | undefined,
): string | null {
  const { closeClient } = useWebSocketContext();
  const connectionName = id ? `${namePrefix}:${id}` : null;

  // Track which name we most recently "own" so we can close it when it
  // changes or when the component unmounts. Without this ref, the cleanup
  // function would close stale names that no longer correspond to anything.
  const ownedRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = ownedRef.current;
    // Switching from one active connection to another (or to null):
    // close the previous before adopting the new one.
    if (previous && previous !== connectionName) {
      closeClient(previous);
    }
    ownedRef.current = connectionName;

    return () => {
      // Cleanup on unmount: close whatever we're currently holding.
      // We re-read from the ref because `connectionName` is captured
      // by closure and might be stale by the time cleanup runs.
      if (ownedRef.current) {
        closeClient(ownedRef.current);
        ownedRef.current = null;
      }
    };
  }, [connectionName, closeClient]);

  return connectionName;
}