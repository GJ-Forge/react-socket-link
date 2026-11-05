export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: unknown[] = [];
  closeCalls = 0;

  constructor(readonly url: string, readonly protocols?: string | string[]) {
    super();
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  fail(code = 1006): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, wasClean: false }));
  }

  send(data: unknown): void { this.sent.push(data); }

  close(): void {
    this.closeCalls++;
    this.readyState = MockWebSocket.CLOSING;
  }
}
