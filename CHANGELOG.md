# Changelog

All notable changes to `@sailingnaturali/signalk-distress-core` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0]

### Added

- `receivedPath(category, transport, id)` — builds the per-call notification key
  `notifications.received.<category>.<transport>-<id>`, stripping `.`/`:` from the
  id so an ISO-timestamp id can't split the SignalK path leaf. Lets two concurrent
  received calls each hold their own alarm instead of stomping one fixed key.

### Changed

- `createNotifier` accepts `onCleared(event)`: when supplied, each raised alarm
  also gets a PUT handler at its own path, so a consumer can acknowledge the
  specific alarm it sees; `onCleared` stamps the caller's store so a restart
  reannounce skips it.

## [0.5.1]

### Fixed

- Stale flusher restart race: after `stop()` is called while a fetch is in-flight,
  the resolving `await` no longer calls `queue.shift()` / `persist()`, preventing a
  restarted plugin's queue file from being overwritten by the previous instance.
  The in-flight entry stays queued for the new instance; the backend deduplicates
  any duplicate POST.

### Added

- Per-request fetch timeout (`fetchTimeoutMs`, default 30 s) passed as
  `AbortSignal.timeout(fetchTimeoutMs)` to every POST, so a black-holed marine link
  does not stall the flusher indefinitely. An aborted request takes the existing
  network-error path (keep entry, backoff, retry).

## [0.5.0]

### Added

- `createReporter` / `loadOrCreateReceiverKey` — generic persistent-queue HTTP reporter
  for event submission (DSCWatch et al.).

## [0.4.0]

### Added

- `buildMessage` / `buildLogbookText` render AIS Msg 14 safety-related broadcasts
  (`kind: 'safetyBroadcast'`) — spoken as "AIS MAYDAY relay / urgency broadcast /
  safety broadcast" by category, plus a GMDSS-style logbook line — so
  `signalk-ais-distress` can alarm on coast-station relay text.

## [0.3.0]

### Fixed

- `EventStore.findRecent` now measures recency from `lastReceivedAt` (falling
  back to `receivedAt`), so a beacon that keeps transmitting slides its own
  dedupe window forward instead of a fresh event being minted every window.
  Previously a continuous survival beacon re-alarmed every window and defeated
  an operator's clear once the original `receivedAt` aged out.

### Changed

- `createNotifier(...).reannounce(events, { window, now, prepare })` re-raises
  the **newest** still-fresh, uncleared event per notification path (was oldest),
  measures freshness from `lastReceivedAt || receivedAt`, and runs the optional
  `prepare(event)` hook before each raise so callers can rebuild the spoken
  message against the current own-ship position. `signalk-ais-distress` and
  `signalk-dsc` can now drop their duplicated inline reannounce loops.
- `createNotifier(...).raise` is a no-op when `stateFor` yields a falsy state
  (a non-alarming category such as DSC routine/unknown), and carries the
  event's `receivedAt` as the notification `timestamp` when present. This lets
  `signalk-dsc` retire its hand-rolled notification delta and share `raise`.

## [0.2.0]

### Added

- `writeLogbookEntry({ url, token, text, observations, extra, fetchImpl })` —
  POSTs a GMDSS-style radio-log entry to the signalk-logbook REST API, extracted
  from `signalk-dsc` so any distress source can share it. Transport-specific
  body fields (e.g. DSC's `vhf: '70'`) pass through `extra`.

## [0.1.0]

### Added

- Initial extraction from `signalk-dsc`: event store, chart-marker builder,
  spoken/logbook rendering, geo/snapshot helpers, shared constants, notifier.
