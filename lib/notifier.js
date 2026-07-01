'use strict';

// Factory around SignalK notification deltas: raise an alarm for an event,
// clear one by path, and re-raise still-active alarms after a restart (SignalK
// notifications are in-memory and lost on restart). Path and severity are
// injected so both DSC (notifications.dsc.<category>) and AIS
// (notifications.ais.distress.<beacon>) can share this.
function createNotifier({ app, pluginId, pathFor, stateFor }) {
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

module.exports = { createNotifier };
