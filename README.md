# react-socket-link

A lightweight, TypeScript-first WebSocket library for React featuring hook-based APIs, automatic reconnection with exponential backoff, typed pub/sub messaging, and flexible multi-connection management.

- Named connections — `useSubscription('chat', ...)`, `useSend('notifications')`
- Static connections (known at startup) and dynamic ones (pattern-based, resolved at runtime)
- Auto-reconnect with exponential backoff and full jitter
- Message queue while disconnected, flushed on reconnect
- Heartbeat / dead-connection detection
- React Strict Mode safe

---

## Installation

```bash
npm install react-socket-link
```

---

## Quick start

**1. Wrap your app with `WebSocketProvider`**

```tsx
import { WebSocketProvider } from 'react-socket-link';

function App() {
  return (
    <WebSocketProvider
      connections={{
        chat: { url: 'wss://api.example.com/chat' },
        notifications: { url: 'wss://api.example.com/notifications' },
      }}
    >
      <YourApp />
    </WebSocketProvider>
  );
}
```

**2. Subscribe to messages in any component**

```tsx
import { useSubscription, useSend } from 'react-socket-link';

function ChatBox() {
  const send = useSend('chat');

  useSubscription('chat', '*', (message) => {
    console.log('received', message);
  });

  return <button onClick={() => send({ type: 'hello', payload: 'world' })}>Send</button>;
}
```

---

## Typing your messages

Extend `BaseMessage` with a discriminated union to get exhaustive type checking in subscribers:

```ts
import type { BaseMessage } from 'react-socket-link';

type ChatMessage =
  | { type: 'chat';     payload: { user: string; text: string } }
  | { type: 'presence'; payload: { user: string; online: boolean } };
```

Then pass the type to hooks:

```tsx
useSubscription<ChatMessage>('chat', 'chat', (msg) => {
  // msg is typed as { type: 'chat'; payload: { user: string; text: string } }
  console.log(msg.payload.text);
});
```

Using `'*'` as the event type receives every message as the full union:

```tsx
useSubscription<ChatMessage>('chat', '*', (msg) => {
  // msg is ChatMessage — switch on msg.type for exhaustive handling
});
```

---

## Provider

### Static connections

Static connections are known at startup. Each key is the name you'll reference from hooks.

```tsx
<WebSocketProvider
  connections={{
    general:       { url: 'wss://api.example.com/ws?type=general' },
    chat:          { url: 'wss://api.example.com/ws?type=chat' },
    notifications: { url: 'wss://api.example.com/ws?type=notifications', autoConnect: false },
  }}
>
  {children}
</WebSocketProvider>
```

### Dynamic connections

Use the `resolve` prop for connections whose URLs depend on runtime values (room IDs, document IDs, etc.). It is called the first time a hook requests a name that isn't in the static map.

```tsx
<WebSocketProvider
  connections={{ general: { url: '...' } }}
  resolve={(name) => {
    if (name.startsWith('room:')) {
      const id = name.slice(5);
      return { url: `wss://api.example.com/rooms/${id}` };
    }
    return null; // not handled — provider will throw a clear error
  }}
>
  {children}
</WebSocketProvider>
```

Return `null` or `undefined` for names your resolver doesn't handle. The provider throws a descriptive error rather than silently creating a broken connection.

### Global error handler

Pass `onError` to capture errors from every connection (static and dynamic) in one place:

```tsx
<WebSocketProvider
  connections={connections}
  resolve={resolveConnection}
  onError={(name, event) => {
    captureError(event, { tags: { connection: name } });
  }}
>
  {children}
</WebSocketProvider>
```

The `name` argument is the connection name (`'chat'`, `'room:42'`, etc.).

---

## Hooks

### `useSubscription`

Subscribe to messages on a connection. Re-subscribes only when the connection name or message type changes — inline handler functions are safe to pass without causing churn.

```tsx
useSubscription<ChatMessage>('chat', 'chat', (msg) => {
  console.log(msg.payload.text);
});

// Subscribe to all message types
useSubscription<ChatMessage>('chat', '*', (msg) => {
  switch (msg.type) { ... }
});
```

### `useSend`

Returns a stable `send` function. Returns `true` if sent immediately, `false` if queued (when `queueWhileDisconnected` is enabled).

```tsx
const send = useSend<ChatMessage>('chat');
send({ type: 'chat', payload: { user: 'alice', text: 'hello' } });
```

### `useConnectionState`

Tracks the connection state as React state — triggers a re-render on each transition.

```tsx
import { ConnectionState, useConnectionState } from 'react-socket-link';

const state = useConnectionState('chat');
// ConnectionState.CONNECTING | OPEN | CLOSING | CLOSED | RECONNECTING
```

### `useWebSocket`

Returns the raw `WebSocketClient` instance. Use this when you need direct access — for example, to set up a per-component error handler:

```tsx
const client = useWebSocket('chat');

useEffect(() => client.onError((event) => {
  console.error('chat error', event);
}), [client]);
```

### `useDynamicConnection`

Manages a single dynamic connection that follows an ID. When the ID changes, the previous connection is closed and a new one is opened. On unmount, the active connection is closed automatically.

```tsx
function Room({ roomId }: { roomId: string | null }) {
  // Returns 'room:42' when roomId is '42', null when roomId is null
  const connectionName = useDynamicConnection('room', roomId);

  useSubscription<RoomMessage>(
    connectionName ?? 'room:_placeholder',
    '*',
    (msg) => { ... },
  );
}
```

The provider's `resolve` function must handle the resulting name (`room:42`).

### `useCloseClient`

Closes and removes a client by name. The next time a hook requests the same name, the client is recreated from config. Useful for explicitly tearing down dynamic connections.

```tsx
const closeClient = useCloseClient();
closeClient('room:42');
```

`useDynamicConnection` handles this automatically on ID change and unmount. Use `useCloseClient` directly only when you need manual control.

---

## Connection options

All options for `WebSocketClientOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | WebSocket URL (`ws://` or `wss://`) |
| `protocols` | `string \| string[]` | — | Sub-protocols for the native WebSocket |
| `autoConnect` | `boolean` | `true` | Connect immediately on construction |
| `reconnect` | `boolean` | `true` | Auto-reconnect on unexpected close |
| `maxReconnectAttempts` | `number` | `Infinity` | Give up after this many attempts |
| `backoff` | `BackoffStrategy` | exponential, capped at 30s | Delay between reconnect attempts |
| `queueWhileDisconnected` | `boolean` | `true` | Queue outbound messages while offline |
| `maxQueueSize` | `number` | `100` | Max queued messages (oldest dropped) |
| `heartbeat.message` | `TMessage \| string` | `{ type: 'ping' }` | Message to send as a ping |
| `heartbeat.intervalMs` | `number` | `30000` | Ping interval in ms |
| `heartbeat.timeoutMs` | `number` | `60000` | Silence threshold before force-reconnect |
| `serialize` | `(msg) => string \| ArrayBuffer \| Blob` | `JSON.stringify` | Outbound message serializer |
| `deserialize` | `(data) => TMessage \| null` | `JSON.parse` | Inbound message deserializer |

---

## Backoff strategies

Two built-in strategies, or bring your own `BackoffStrategy = (attempt: number) => number`:

```ts
import { exponentialBackoff, fixedBackoff } from 'react-socket-link';

// Exponential with full jitter — prevents thundering herd on server restart
// Formula: random(0, min(cap, base * 2^attempt))
exponentialBackoff(1000, 30_000) // default

// Fixed delay — useful for tests or LAN apps
fixedBackoff(2000)
```

---

## Framework-agnostic client

`WebSocketClient` has no React dependency and can be used in any environment:

```ts
import { WebSocketClient } from 'react-socket-link';

const client = new WebSocketClient<ChatMessage>({
  url: 'wss://api.example.com/chat',
  reconnect: true,
});

const unsub = client.subscribe('chat', (msg) => {
  console.log(msg.payload.text);
});

client.onStateChange((state) => console.log('state:', state));
client.onError((event) => console.error('error:', event));

client.send({ type: 'chat', payload: { user: 'alice', text: 'hello' } });
client.close();
unsub();
```

---

## React Strict Mode

The provider is Strict Mode safe. In development, React mounts effects twice (mount → cleanup → remount) to surface bugs. The provider tracks which connections were active when the cleanup ran and reconnects only those on remount — connections configured with `autoConnect: false` are never prematurely started.
