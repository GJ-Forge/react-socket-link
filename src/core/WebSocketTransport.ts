import type { BaseMessage, HeartbeatOptions, MessageCodec, SocketErrorReason, TransportEvents, WebSocketData } from './coreTypes';

/**
 * Owns one native WebSocket and its heartbeat timers.
 *
 * @remarks Disposal removes native event listeners before closing the socket,
 * so a retired transport cannot report stale events to its logical owner.
 * @internal
 */
export class WebSocketTransport<I extends BaseMessage, O extends BaseMessage> {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private closeReason: SocketErrorReason | undefined;

  constructor(
    private readonly url: string,
    private readonly protocols: string | string[] | undefined,
    private readonly heartbeat: HeartbeatOptions<O> | undefined,
    private readonly codec: MessageCodec<I, O>,
    private readonly events: TransportEvents,
  ) {}

  get isOpen(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  connect(): void {
    if (this.disposed || this.socket) return;
    const socket = new WebSocket(this.url, this.protocols);
    this.socket = socket;
    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('error', this.onError);
    socket.addEventListener('close', this.onClose);
  }

  send(data: WebSocketData): void {
    if (!this.isOpen || !this.socket) throw new Error('Transport is not open');
    this.socket.send(data);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeEventListener('open', this.onOpen);
    socket.removeEventListener('message', this.onMessage);
    socket.removeEventListener('error', this.onError);
    socket.removeEventListener('close', this.onClose);
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000);
  }

  private onOpen = (): void => { this.startHeartbeat(); this.events.open(); };
  private onMessage = (event: MessageEvent): void => { this.resetSilenceTimer(); this.events.message(event.data); };
  private onError = (): void => { this.events.error(); };
  private onClose = (event: CloseEvent): void => {
    this.stopHeartbeat();
    this.events.close(event.code, event.wasClean, this.closeReason);
  };

  private startHeartbeat(): void {
    if (!this.heartbeat) return;
    const { intervalMs = 30_000, message = '{"type":"ping"}' } = this.heartbeat;
    this.heartbeatTimer = setInterval(() => {
      if (!this.isOpen) return;
      try { this.send(typeof message === 'string' ? message : this.codec.encode(message)); }
      catch { this.closeWithReason('HEARTBEAT_SEND_FAILED', 'heartbeat send failed'); }
    }, intervalMs);
    this.resetSilenceTimer();
  }

  private resetSilenceTimer(): void {
    if (!this.heartbeat) return;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.isOpen) this.closeWithReason('HEARTBEAT_TIMEOUT', 'heartbeat timeout');
    }, this.heartbeat.timeoutMs ?? 60_000);
  }

  private closeWithReason(reason: SocketErrorReason, text: string): void {
    this.closeReason = reason;
    this.socket?.close(4000, text);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.heartbeatTimer = this.silenceTimer = null;
  }
}
