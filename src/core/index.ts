export { defineSocket } from './ConnectionDefinition';
export { createSocket, LogicalConnection } from './LogicalConnection';
export { exponentialBackoff, fixedBackoff } from '../utils/Backoff';
export type {
  BaseMessage, SocketDefinition, SocketView, SocketController, SendResult, MessageOf, Unsubscribe,
  SocketOptions, SocketOptionsPatch, HeartbeatOptions, ReconnectOptions, QueueOptions, MessageCodec,
  ConnectionSnapshot, SocketStatus, SocketError, SocketErrorCode, SocketErrorReason, BackoffStrategy,
} from './coreTypes';
