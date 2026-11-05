import type { BaseMessage, SocketDefinition, SocketView } from '../core/coreTypes';
import { useProviderSocket } from './SocketProvider';

/**
 * Reads a shared socket without exposing lifecycle controls.
 *
 * @remarks Requires a SocketProvider that registered this exact definition object.
 * The returned view is shared by consumers of that registration.
 * @typeParam I - Incoming message type.
 * @typeParam O - Outgoing message type.
 * @param definition - Definition registered by the nearest provider.
 * @returns A shared view for sending, subscriptions, and state observation.
 * @throws If no provider exists or the definition is not registered.
 */
export function useGlobalSocket<I extends BaseMessage, O extends BaseMessage>(
  definition: SocketDefinition<I, O>,
): SocketView<I, O> {
  return useProviderSocket(definition);
}
