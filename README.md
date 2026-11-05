# react-socket-link v1.0

For the locally generated API reference and comment guidelines, see [Documentation](docs/README.md).

Typed WebSocket connection management for React 18+ and standalone TypeScript services. A socket **definition** fixes incoming and outgoing message types. A **logical connection** keeps its identity, state, queue, and subscriptions while replaceable native WebSockets handle the actual transport.

## Install

```bash
npm install react-socket-link
```

React consumers need React 18 or newer. Standalone consumers can import `react-socket-link/core` without installing React. The package does not open a WebSocket at import time or during React render.

## Define a protocol

```ts
import { defineSocket } from 'react-socket-link';

type Incoming =
  | { type: 'notification'; payload: { text: string } }
  | { type: 'count'; payload: number };
type Outgoing = { type: 'mark-read'; payload: string };

export const notifications = defineSocket<Incoming, Outgoing>('notifications');
```

Definitions are reusable identity tokens. Create them outside components and reuse the same object wherever you refer to a global connection.

## Global React connection

```tsx
import { useEffect, useRef } from 'react';
import {
  SocketProvider, registerSocket, useGlobalSocket, useGlobalSocketController,
  useLocalSocket, useSocketEvent, useSocketSend, useSocketState,
} from 'react-socket-link';

function AuthenticatedApp({ token }: { token: string }) {
  return (
    <SocketProvider connections={[
      registerSocket(notifications, { url: `wss://example.com/notifications?token=${token}` }),
    ]}>
      <Notifications />
      <TokenUpdater token={token} />
    </SocketProvider>
  );
}

function Notifications() {
  const socket = useGlobalSocket(notifications); // shared view; no lifecycle commands
  const { status, lastError } = useSocketState(socket);
  const send = useSocketSend(socket);
  useSocketEvent(socket, 'notification', message => {
    console.log(message.payload.text); // narrowed to the notification variant
  });
  return <button disabled={status !== 'OPEN'} onClick={() => send({ type: 'mark-read', payload: '123' })}>
    {lastError?.message ?? status}
  </button>;
}

function TokenUpdater({ token }: { token: string }) {
  const socket = useGlobalSocketController(notifications);
  const previousToken = useRef(token);
  useEffect(() => {
    if (previousToken.current === token) return;
    previousToken.current = token;
    socket.update({ url: `wss://example.com/notifications?token=${token}` });
  }, [socket, token]);
  return null;
}
```

The Provider creates and activates each configured connection on mount, whether or not a child consumes it. Multiple consumers of the same definition share one logical connection. The Provider closes and disposes its connections on unmount.

## Local React connection

```tsx
const questionDefinition = defineSocket<Incoming, Outgoing>('question');

function Question({ questionId, url }: { questionId: string; url: string }) {
  const socket = useLocalSocket(questionDefinition, {
    key: questionId,
    options: { url },
  });
  const { status } = useSocketState(socket);
  return <span>{status}</span>;
}
```

A local hook owns a connection without a Provider. Ordinary rerenders retain it; changing `key` disposes the old connection and creates a new one. `options` initialize that identity once. To change its URL or another option while keeping identity, call `socket.update(...)` from application code. Local controllers can be passed to child components.

## Standalone connection

```ts
import { createSocket, defineSocket } from 'react-socket-link/core';

const question = defineSocket<Incoming, Outgoing>('question');
const socket = createSocket(question, { url: 'wss://example.com/question/42' });
const unsubscribe = socket.subscribe('notification', message => console.log(message.payload.text));
socket.connect();
await socket.whenOpen({ timeoutMs: 10_000 });
const result = socket.send({ type: 'mark-read', payload: '123' });
// result.status is 'sent', 'queued', or 'rejected'. 'sent' is browser acceptance,
// not a server delivery acknowledgement.
unsubscribe();
socket.close();
socket.dispose();
```

`connect()` is idempotent while active and can reopen a previously closed connection. `reconnect()` replaces the current transport with the same options; `update(partialOptions)` merges options and replaces the transport if active. `close()` stops retries and clears queued messages. `dispose()` permanently releases the instance. `whenOpen()` resolves on a native handshake and rejects on timeout, closure, or disposal; it does not wait for application-level server registration.

## Options and behavior

```ts
createSocket(question, {
  url: 'wss://example.com/question/42',
  protocols: ['v1'],
  heartbeat: { message: '{"type":"ping"}', intervalMs: 30_000, timeoutMs: 60_000 },
  reconnect: { enabled: true, maxAttempts: Infinity, backoff: exponentialBackoff() },
  queue: { enabled: true, maxSize: 100 },
  codec: {
    encode: message => JSON.stringify(message),
    decode: data => {
      // Validate network input here and return null for messages to discard.
      return typeof data === 'string' ? JSON.parse(data) as Incoming : null;
    },
  },
});
```

Defaults: automatic reconnect with full-jitter exponential backoff, a 100-message outbound queue, JSON codec, and no heartbeat. The queue rejects new messages when full and is cleared on intentional close or disposal. `fixedBackoff(ms)` is also available. If the backend needs explicit subscriptions after each handshake, replay those at the application level.

State snapshots contain `status` (`IDLE`, `CONNECTING`, `OPEN`, `RECONNECTING`, `CLOSED`), `isConnected`, `reconnectAttempt`, and `lastError`. `useSocketState()` observes them through `useSyncExternalStore`. Errors omit connection URLs and protocol values. A codec can return `null` to discard a message silently; decoding exceptions and invalid decoded shapes set a deserialization error.

Transport replacement is close-first. Old transport events cannot update the logical connection, but events sent by the server during the gap may be lost. Applications requiring lossless delivery need backend replay or resynchronization.

## Migration from v0.1

This is a breaking API change. Replace named Provider registries and `resolve(name)` with typed definitions and explicit global registrations. Replace `useWebSocket(name)` with `useGlobalSocket(definition)` or `useGlobalSocketController(definition)`. Replace `useSubscription`, `useConnectionState`, and `useSend` with `useSocketEvent`, `useSocketState`, and `useSocketSend`. Replace dynamic named connections with `useLocalSocket(definition, { key, options })`. `WebSocketClient` is no longer a package export; use `createSocket` for standalone use.
