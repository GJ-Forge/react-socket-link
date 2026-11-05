import type { BaseMessage, SocketDefinition } from './coreTypes';

/**
 * Creates a reusable identity token for a typed message protocol.
 *
 * @remarks Define it once outside components and reuse the same object for global
 * registration and lookup. Creating another definition with the same name gives it
 * a different identity.
 * @typeParam Incoming - Messages accepted from the server.
 * @typeParam Outgoing - Messages the client may send.
 * @param name - Nonempty label used in registration errors.
 * @returns A frozen definition that does not open a WebSocket.
 * @throws If name is empty or whitespace.
 * @example
 * const chat = defineSocket<
 *   { type: 'received'; text: string },
 *   { type: 'send'; text: string }
 * >('chat');
 */
export function defineSocket<Incoming extends BaseMessage, Outgoing extends BaseMessage>(
  name: string,
): SocketDefinition<Incoming, Outgoing> {
  if (!name.trim()) throw new Error('Socket definition name must not be empty');
  return Object.freeze({ id: Symbol(name), name });
}
