import { expectTypeOf, it } from 'vitest';
import { createSocket, defineSocket } from '../src/core';
import { registerSocket } from '../src';

type Incoming = { type: 'count'; payload: number } | { type: 'text'; payload: string };
type Outgoing = { type: 'send'; payload: boolean };

it('binds message types to definitions and narrows subscribed events', () => {
  const definition = defineSocket<Incoming, Outgoing>('typed');
  const socket = createSocket(definition, { url: 'wss://example.test' });
  socket.subscribe('count', message => expectTypeOf(message.payload).toEqualTypeOf<number>());
  socket.subscribe('*', message => expectTypeOf(message).toEqualTypeOf<Incoming>());
  expectTypeOf(socket.send).parameter(0).toEqualTypeOf<Outgoing>();
  registerSocket(definition, { url: 'wss://example.test' });
  const wrongCodec = {
    encode: (_message: { type: 'wrong' }) => '',
    decode: (_data: unknown): Incoming | null => null,
  };
  // @ts-expect-error Registration codecs must encode the definition's outgoing type.
  if (false) registerSocket(definition, { url: 'wss://example.test', codec: wrongCodec });
  // @ts-expect-error Incoming events cannot be sent as outgoing messages.
  if (false) socket.send({ type: 'count', payload: 1 });
  // @ts-expect-error Unknown event types cannot be subscribed to.
  if (false) socket.subscribe('missing', () => {});
  socket.dispose();
});
