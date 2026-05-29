// Core
export { WebSocketClient } from './client/WebsocketClient';

// React
export {
  WebSocketProvider,
  type WebSocketProviderProps,
  type ConnectionsConfig,
  type ResolveConnection,
} from './context/WebSocketProvider';
export {
  useWebSocket,
  useSubscription,
  useConnectionState,
  useSend,
  useCloseClient,
  useDynamicConnection,
} from './hooks';

// Types
export {
  ConnectionState,
  type BaseMessage,
  type MessageHandler,
  type StateHandler,
  type ErrorHandler,
  type Unsubscribe,
  type BackoffStrategy,
  type WebSocketClientOptions,
} from './types';

// Utils
export { exponentialBackoff, fixedBackoff } from './utils/Backoff';