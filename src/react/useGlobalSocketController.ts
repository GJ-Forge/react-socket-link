import type { BaseMessage, SocketController, SocketDefinition } from '../core/coreTypes';
import { useProviderSocket } from './SocketProvider';

/**
 * Reads the shared controller for a provider-owned socket.
 *
 * @remarks Requires a SocketProvider that registered this exact definition object.
 * Use update to change options while preserving logical connection identity.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param definition - Definition registered by the nearest provider.
 * @returns The shared controller with lifecycle and configuration methods.
 * @throws If no provider exists or the definition is not registered.
 */
export function useGlobalSocketController<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>,
): SocketController<I, O> {
  return useProviderSocket(definition);
}
