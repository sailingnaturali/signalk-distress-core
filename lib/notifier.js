'use strict';

// Per-call notification key. The call's id disambiguates concurrent calls so
// two of them never stomp one key (the pre-uuid scheme kept a single fixed path
// per category). Strip path-reserved chars from the id — it is `<receivedAt>-
// <mmsi>`, and an ISO timestamp is full of `.` and `:` that would otherwise
// split the leaf into extra SignalK path segments.
//   notifications.received.<category>.<transport>-<id>
function receivedPath(category, transport, id) {
  const safe = String(id).replace(/[.:]/g, '');
  return `notifications.received.${category}.${transport}-${safe}`;
}

// Factory around SignalK notification deltas: raise an alarm for an event,
// clear one by path, and re-raise still-active alarms after a restart (SignalK
// notifications are in-memory and lost on restart). Path and severity are
// injected so both DSC and AIS can share this.
//
// When `onCleared` is supplied, each raised alarm also gets a PUT handler at its
// own path: a consumer acking the alarm it sees clears that one call (SignalK's
// standard notification-ack), and `onCleared(event)` lets the caller stamp its
// store so a restart reannounce skips it.
function createNotifier({ app, pluginId, pathFor, stateFor, onCleared }) {
  // Paths we've already wired a PUT-ack handler for. A repeat/reannounce of the
  // same call shares its id → its path → skips re-registration.
  // ponytail: grows one entry per distinct call heard over uptime — negligible
  // at distress-call volume; revisit only if a plugin ever raises at high rate.
  const acked = new Set();

  function registerAck(event, path) {
    if (!onCleared || typeof app.registerPutHandler !== 'function') return;
    if (acked.has(path)) return;
    acked.add(path);
    // Value ignored: any PUT to the alarm's own path means "acknowledge this one".
    app.registerPutHandler('vessels.self', path, () => {
      clear(path);
      onCleared(event);
      return { state: 'COMPLETED', statusCode: 200 };
    });
  }

  // Raise the notification for an event. A falsy state (a non-alarming
  // category, e.g. DSC routine/safety-not-mapped) is a no-op: nothing is
  // emitted and undefined is returned. The event's receivedAt rides along as
  // the notification timestamp when present.
  function raise(event) {
    const state = stateFor(event);
    if (!state) return undefined;
    const path = pathFor(event);
    const value = { state, method: ['visual', 'sound'], message: event.message };
    if (event.receivedAt) value.timestamp = event.receivedAt;
    app.handleMessage(pluginId, { updates: [{ values: [{ path, value }] }] });
    registerAck(event, path);
    return path;
  }

  function clear(path) {
    app.handleMessage(pluginId, { updates: [{ values: [{ path, value: null }] }] });
  }

  // Re-raise the newest still-fresh, uncleared event per notification path.
  // Newest-first so a path's most recent position wins; freshness follows
  // `lastReceivedAt` (a repeat-bumped beacon stays fresh) and falls back to
  // `receivedAt`. `prepare(event)` runs before each raise so a caller can
  // rebuild the spoken message against the current own-ship position.
  function reannounce(events, { window, now = Date.now(), prepare } = {}) {
    const seen = new Set();
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.clearedAt) continue;
      const at = Date.parse(event.lastReceivedAt || event.receivedAt);
      if (Number.isNaN(at) || now - at > window) continue;
      const path = pathFor(event);
      if (seen.has(path)) continue;
      if (prepare) prepare(event);
      raise(event);
      seen.add(path);
    }
  }

  return { raise, clear, reannounce };
}

module.exports = { createNotifier, receivedPath };
