# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
[//]: # (## X.Y.Z - YYYY-MM-DD -)
[//]: # ( ### Added)

[//]: # ( ### Changed)

[//]: # ( ### Deprecated)

[//]: # ( ### Removed)

[//]: # ( ### Fixed)

[//]: # (### Security)

[//]: # (<div style={{height:'1px',width:'100%', border: '1px solid #e5e5e5'}}></div>)

----
<div style={{height:'1px',width:'100%', border: '1px solid #e5e5e5'}}></div>

## 1.0.0 - 2026-11-05

### Added
- Typed socket definitions (`defineSocket`)
- Standalone core: `createSocket`, also at `react-socket-link/core`
- React: `SocketProvider` and `use*Socket*` hooks
- Connection status snapshots with typed errors
- Send results: `sent`, `queued` or `rejected`
- Custom message codecs
- Runtime option updates
- Tests and API docs

### Changed
- Options grouped into `heartbeat`, `reconnect` and `queue` (MAJOR)
- Outbound queue capped at 100 messages
- React is optional, minimum version 18

### Removed
- `WebSocketClient`, `WebSocketProvider` and the v0.1 hooks (MAJOR, see README migration guide)

## 0.1.0 - 2026-05-29

### Added
- Initial release
- `WebSocketClient` and `WebSocketProvider` with named connections
- Hooks: `useWebSocket`, `useSubscription`, `useSend` and more
- Auto-reconnect with exponential backoff
- Offline message queue
- Heartbeat
