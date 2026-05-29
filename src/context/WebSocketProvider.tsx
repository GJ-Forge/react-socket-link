import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { WebSocketClient } from '../client/WebsocketClient';
import { ConnectionState } from '../types';
import type { BaseMessage, WebSocketClientOptions } from '../types';

/**
 * Map of statically known connections.
 * The key is a stable name you'll use from hooks (e.g. 'chat', 'notifications').
 */
export type ConnectionsConfig = Record<
  string,
  WebSocketClientOptions<BaseMessage>
>;

/**
 * Resolver for dynamic connections — called when a hook requests a name
 * that isn't in the static `connections` map. Return options to create
 * the connection on demand, or null/undefined if the name isn't handled.
 *
 * Typical use: pattern-based names like 'room:42', 'doc:abc-123'.
 *
 * @example
 *   resolve: (name) => {
 *     if (name.startsWith('room:')) {
 *       const id = name.slice(5);
 *       return { url: `wss://api.example.com/rooms/${id}` };
 *     }
 *     return null;
 *   }
 */
export type ResolveConnection = (
  name: string,
) => WebSocketClientOptions<BaseMessage> | null | undefined;

interface WebSocketContextValue {
  /**
   * Get a client by name.
   * Looks up the static `connections` map first, then falls back to `resolve`.
   * Throws if neither produces a config for the name.
   */
  getClient: <TMessage extends BaseMessage = BaseMessage>(
    name: string,
  ) => WebSocketClient<TMessage>;
  /**
   * Explicitly close and discard a client by name.
   * The next call to getClient(name) will recreate it from config.
   *
   * Use this for dynamic connections that should be torn down when no
   * longer needed (e.g. leaving a chat room). Static connections can be
   * closed too, but they'll just be recreated next time they're used.
   */
  closeClient: (name: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export interface WebSocketProviderProps {
  /**
   * Statically configured connections — known at app startup.
   * Use this for connections that exist for the app's lifetime
   * (notifications, presence, auth-level channels).
   */
  connections?: ConnectionsConfig;
  /**
   * Resolver for dynamically named connections — invoked when a name
   * isn't in the static map. Use for pattern-based connections where
   * the URL depends on a runtime value (room IDs, document IDs, etc.).
   *
   * Return null/undefined if your resolver doesn't handle the name —
   * the Provider will throw a clear error so unhandled names don't
   * silently create broken connections.
   */
  resolve?: ResolveConnection;
  /**
   * Called whenever any managed client emits an error, with the
   * connection name and the error. Wired at client creation time so
   * it covers both static and dynamically resolved connections.
   */
  onError?: (name: string, event: Event | Error) => void;
  children: ReactNode;
}

/**
 * Provider that owns one WebSocketClient per named connection.
 *
 * Clients are created lazily on first access. The lookup order is:
 *   1. The static `connections` map
 *   2. The `resolve` function, if provided
 *   3. Throw — no config means we'd silently make a broken connection
 *
 * Clients persist for the provider's lifetime by default, so navigating
 * between components doesn't churn the socket. Call `closeClient(name)`
 * (typically via the `useDynamicConnection` hook) to discard a client
 * when its work is done.
 *
 * Note: prop changes to `connections` and `resolve` are picked up via refs,
 * but they only affect NEW client creation — existing clients keep their
 * original config. If you need to swap a live client's URL, put a `key`
 * on the Provider, which remounts it fresh.
 */
export function WebSocketProvider({
  connections = {},
  resolve,
  onError,
  children,
}: WebSocketProviderProps): JSX.Element {
  // Cache clients in a ref so they survive re-renders without useState churn.
  const clientsRef = useRef(new Map<string, WebSocketClient<BaseMessage>>());
  // Tracks names closed by the cleanup so only those are reconnected on Strict Mode
  // remount. Clients with autoConnect:false that were never connected must stay idle.
  const toReconnectRef = useRef(new Set<string>());

  // Keep latest config in a ref so lazy creation always uses the freshest
  // resolver/connections, even if the parent re-renders with new closures.
  // We avoid putting this in the memoized context value because that would
  // force every consumer to re-render on each parent render.
  const configRef = useRef({ connections, resolve });
  configRef.current = { connections, resolve };

  // Keep the latest onError in a ref so handler identity changes don't force
  // existing clients to re-subscribe (clients are wired once at creation time).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const value = useMemo<WebSocketContextValue>(
    () => ({
      getClient: <TMessage extends BaseMessage = BaseMessage>(name: string) => {
        let client = clientsRef.current.get(name);
        if (!client) {
          // Lookup order: static map first, then dynamic resolver.
          // Static wins if both define the same name — the explicit
          // config is more specific than a pattern match.
          const opts =
            configRef.current.connections[name] ??
            configRef.current.resolve?.(name) ??
            null;

          if (!opts) {
            const known = Object.keys(configRef.current.connections).join(', ');
            throw new Error(
              `[WebSocketProvider] No connection configured for "${name}". ` +
                `Static: ${known || '(none)'}. ` +
                `Resolver: ${configRef.current.resolve ? 'present but returned null' : 'not provided'}.`,
            );
          }
          client = new WebSocketClient<BaseMessage>(opts);
          if (onErrorRef.current) {
            const handler = onErrorRef.current;
            client.onError((event) => handler(name, event));
          }
          clientsRef.current.set(name, client);
        }
        // Through unknown: clients are stored as the base shape but each named
        // connection is consumed with its specific TMessage type by callers.
        return client as unknown as WebSocketClient<TMessage>;
      },

      closeClient: (name: string) => {
        const client = clientsRef.current.get(name);
        if (!client) return;
        client.close();
        clientsRef.current.delete(name);
      },
    }),
    [],
  );

  useEffect(() => {
    const clients = clientsRef.current;
    // Re-open only the connections that were closed by the previous cleanup cycle
    // (React Strict Mode). Clients with autoConnect:false that were never connected
    // must not be touched here — they stay idle until their hook calls connect().
    for (const [name, client] of clients.entries()) {
      if (toReconnectRef.current.has(name)) {
        toReconnectRef.current.delete(name);
        client.connect();
      }
    }
    return () => {
      for (const [name, client] of clients.entries()) {
        if (client.getState() !== ConnectionState.CLOSED) {
          toReconnectRef.current.add(name);
          client.close();
        }
      }
      // Intentionally not clearing the map — hooks hold useMemo references to the
      // same instances, so they must survive the Strict Mode cleanup/remount cycle.
    };
  }, []);

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

/** Internal — used by hooks to grab the context. */
export function useWebSocketContext(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error(
      'useWebSocket hooks must be used inside <WebSocketProvider>.',
    );
  }
  return ctx;
}