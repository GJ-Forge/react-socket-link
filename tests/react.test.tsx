import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, Component, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  defineSocket, registerSocket, SocketProvider, useGlobalSocket, useGlobalSocketController, useLocalSocket,
  useSocketEvent, useSocketSend, useSocketState, type SendResult, type SocketController,
} from '../src';
import { MockWebSocket } from './helpers/MockWebSocket';

type Incoming = { type: 'notice'; payload: string };
type Outgoing = { type: 'send'; payload: string };
const globalDefinition = defineSocket<Incoming, Outgoing>('global');
const localDefinition = defineSocket<Incoming, Outgoing>('local');
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it('starts a global socket without consumers and shares one controller with all views', async () => {
  let first: ReturnType<typeof useGlobalSocket> | undefined;
  let second: ReturnType<typeof useGlobalSocket> | undefined;
  let controller: SocketController<Incoming, Outgoing> | undefined;
  const received: string[] = [];
  function Consumer({ index }: { index: number }) {
    const socket = useGlobalSocket(globalDefinition);
    const state = useSocketState(socket);
    useSocketEvent(socket, 'notice', message => received.push(`${index}:${message.payload}`));
    if (index === 1) first = socket;
    else second = socket;
    return <span>{state.status}</span>;
  }
  function Control() { controller = useGlobalSocketController(globalDefinition); return null; }
  await act(async () => {
    root.render(<SocketProvider connections={[registerSocket(globalDefinition, { url: 'wss://example.test/A' })]}>
      <Consumer index={1} /><Consumer index={2} /><Control />
    </SocketProvider>);
  });
  expect(MockWebSocket.instances).toHaveLength(1);
  expect(first).toBe(second);
  await act(async () => { MockWebSocket.instances[0].open(); });
  expect(container.textContent).toBe('OPENOPEN');
  MockWebSocket.instances[0].message(JSON.stringify({ type: 'notice', payload: 'hello' }));
  expect(received).toEqual(['1:hello', '2:hello']);
  await act(async () => { controller!.update({ url: 'wss://example.test/B' }); });
  expect(MockWebSocket.instances).toHaveLength(2);
  expect(first).toBe(controller);
  await act(async () => { MockWebSocket.instances[1].open(); });
  expect(container.textContent).toBe('OPENOPEN');
});

it('keeps local identity across re-renders and disposes the old identity on key change', async () => {
  const handles: SocketController<Incoming, Outgoing>[] = [];
  function Local({ id, token }: { id: string; token: string }) {
    const socket = useLocalSocket(localDefinition, {
      key: id,
      options: { url: `wss://example.test/${id}?token=${token}` },
    });
    handles.push(socket);
    return <span>{useSocketState(socket).status}</span>;
  }
  await act(async () => { root.render(<Local id="one" token="A" />); });
  const first = handles.at(-1)!;
  expect(MockWebSocket.instances).toHaveLength(1);
  await act(async () => { root.render(<Local id="one" token="B" />); });
  expect(handles.at(-1)).toBe(first);
  expect(MockWebSocket.instances).toHaveLength(1);
  await act(async () => { root.render(<Local id="two" token="B" />); });
  expect(handles.at(-1)).not.toBe(first);
  expect(MockWebSocket.instances[0].closeCalls).toBe(1);
  expect(MockWebSocket.instances[1].url).toContain('/two');
  expect(first.send({ type: 'send', payload: 'stale' }).status).toBe('rejected');
});

it('survives Strict Mode effect replay without disposing the owned connection', async () => {
  let socket: SocketController<Incoming, Outgoing> | undefined;
  function Local() {
    socket = useLocalSocket(localDefinition, { options: { url: 'wss://example.test' } });
    return null;
  }
  await act(async () => { root.render(<StrictMode><Local /></StrictMode>); });
  expect(MockWebSocket.instances).toHaveLength(1);
  expect(socket!.getSnapshot().status).toBe('CONNECTING');
  await act(async () => { MockWebSocket.instances[0].open(); });
  expect(socket!.getSnapshot().status).toBe('OPEN');
});

it('gives separate hook owners independent connections even with the same definition and key', async () => {
  const handles: SocketController<Incoming, Outgoing>[] = [];
  function Local() {
    const socket = useLocalSocket(localDefinition, {
      key: 'same', options: { url: 'wss://example.test/same' },
    });
    handles.push(socket);
    return null;
  }
  await act(async () => { root.render(<><Local /><Local /></>); });
  expect(MockWebSocket.instances).toHaveLength(2);
  expect(handles[0]).not.toBe(handles[1]);
  await act(async () => { MockWebSocket.instances[0].open(); MockWebSocket.instances[1].open(); });
  expect(handles[0].getSnapshot().status).toBe('OPEN');
  expect(handles[1].getSnapshot().status).toBe('OPEN');
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <span>{this.state.error.message}</span> : this.props.children; }
}

/** Renders inside an error boundary and returns the message of any render error. */
async function renderError(element: ReactNode): Promise<string> {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () => { root.render(<ErrorBoundary>{element}</ErrorBoundary>); });
    return container.textContent ?? '';
  } finally {
    consoleError.mockRestore();
  }
}

it('survives Strict Mode effect replay in the provider with one working socket', async () => {
  let view: ReturnType<typeof useGlobalSocket<Incoming, Outgoing>> | undefined;
  function Consumer() {
    view = useGlobalSocket(globalDefinition);
    return <span>{useSocketState(view).status}</span>;
  }
  await act(async () => {
    root.render(<StrictMode>
      <SocketProvider connections={[registerSocket(globalDefinition, { url: 'wss://example.test' })]}>
        <Consumer />
      </SocketProvider>
    </StrictMode>);
  });
  expect(MockWebSocket.instances).toHaveLength(1);
  await act(async () => { MockWebSocket.instances[0].open(); });
  expect(container.textContent).toBe('OPEN');
  expect(view!.send({ type: 'send', payload: 'hi' }).status).toBe('sent');
});

it('rejects registering the same definition twice', async () => {
  const message = await renderError(
    <SocketProvider connections={[
      registerSocket(globalDefinition, { url: 'wss://example.test/1' }),
      registerSocket(globalDefinition, { url: 'wss://example.test/2' }),
    ]}>{null}</SocketProvider>,
  );
  expect(message).toBe('Duplicate socket definition: global');
  expect(MockWebSocket.instances).toHaveLength(0);
});

it('disposes provider sockets when the provider unmounts', async () => {
  let controller: SocketController<Incoming, Outgoing> | undefined;
  function Control() { controller = useGlobalSocketController(globalDefinition); return null; }
  await act(async () => {
    root.render(<SocketProvider connections={[registerSocket(globalDefinition, { url: 'wss://example.test' })]}>
      <Control />
    </SocketProvider>);
  });
  await act(async () => { MockWebSocket.instances[0].open(); });
  await act(async () => { root.render(null); });
  expect(MockWebSocket.instances[0].closeCalls).toBe(1);
  expect(controller!.getSnapshot().status).toBe('CLOSED');
  expect(controller!.send({ type: 'send', payload: 'late' }).status).toBe('rejected');
  controller!.connect();
  await act(async () => {});
  expect(MockWebSocket.instances).toHaveLength(1);
});

it('explains when a global hook is used outside a provider', async () => {
  function Consumer() { useGlobalSocket(globalDefinition); return null; }
  expect(await renderError(<Consumer />)).toBe('Global socket hooks require <SocketProvider>');
});

it('explains when a definition was not registered in the provider', async () => {
  function Consumer() { useGlobalSocket(localDefinition); return null; }
  const message = await renderError(
    <SocketProvider connections={[registerSocket(globalDefinition, { url: 'wss://example.test' })]}>
      <Consumer />
    </SocketProvider>,
  );
  expect(message).toBe('Socket definition is not registered: local');
});

it('useSocketSend returns a stable function that queues before open and sends after', async () => {
  const senders: ((message: Outgoing) => SendResult)[] = [];
  function Sender({ label }: { label: string }) {
    const socket = useLocalSocket(localDefinition, { options: { url: 'wss://example.test' } });
    senders.push(useSocketSend(socket));
    return <span>{label}</span>;
  }
  await act(async () => { root.render(<Sender label="a" />); });
  await act(async () => { root.render(<Sender label="b" />); });
  expect(senders.at(-1)).toBe(senders[0]);
  const send = senders[0];
  expect(send({ type: 'send', payload: 'early' }).status).toBe('queued');
  await act(async () => { MockWebSocket.instances[0].open(); });
  expect(send({ type: 'send', payload: 'now' }).status).toBe('sent');
  expect(MockWebSocket.instances[0].sent).toEqual([
    JSON.stringify({ type: 'send', payload: 'early' }),
    JSON.stringify({ type: 'send', payload: 'now' }),
  ]);
});
