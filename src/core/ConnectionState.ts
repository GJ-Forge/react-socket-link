import type { ConnectionSnapshot, SocketError, SocketStatus } from './coreTypes';

export function snapshot(status: SocketStatus, reconnectAttempt = 0, lastError: SocketError | null = null): ConnectionSnapshot {
  return Object.freeze({ status, isConnected: status === 'OPEN', reconnectAttempt, lastError });
}
