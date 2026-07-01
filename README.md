# @sailingnaturali/signalk-distress-core

Shared distress plumbing for SignalK distress plugins: an on-disk event store,
Freeboard chart-marker builder, spoken/logbook renderers, geo + own-ship snapshot
helpers, shared identity/nature constants, and a notification manager. Consumed by
[`signalk-dsc`](https://github.com/sailingnaturali/signalk-dsc) and
[`signalk-ais-distress`](https://github.com/sailingnaturali/signalk-ais-distress).

## API

- `EventStore` — JSONL persistence, retention, dedupe, mark-cleared
- `buildMarkerResourceSets(events, opts)` — Freeboard ResourceSets (bucket/label/colors injectable)
- `buildMessage` / `buildLogbookText` — source-aware (DSC + AIS) rendering
- `createNotifier({ app, pluginId, pathFor, stateFor })` — raise/clear/reannounce
- `deviceBeaconFor`, `NATURES`, `NATURE_TEXT`, geo + snapshot helpers
