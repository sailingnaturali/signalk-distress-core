# Changelog

All notable changes to `@sailingnaturali/signalk-distress-core` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
