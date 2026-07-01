'use strict';

// Factory around SignalK notification deltas: raise an alarm for an event,
// clear one by path, and re-raise still-active alarms after a restart (SignalK
// notifications are in-memory and lost on restart). Path and severity are
// injected so both DSC (notifications.dsc.<category>) and AIS
// (notifications.ais.distress.<beacon>) can share this.
function createNotifier({ app, pluginId, pathFor, stateFor }) {
  function raise(event) {
    const path = pathFor(event);
    const state = stateFor(event);
    app.handleMessage(pluginId, {
      updates: [{ values: [{ path, value: { state, method: ['visual', 'sound'], message: event.message } }] }],
    });
    return path;
  }

  function clear(path) {
    app.handleMessage(pluginId, { updates: [{ values: [{ path, value: null }] }] });
  }

  function reannounce(events, { window, now = Date.now() }) {
    const seen = new Set();
    for (const event of events) {
      if (event.clearedAt) continue;
      const received = Date.parse(event.receivedAt);
      if (Number.isNaN(received) || now - received > window) continue;
      const path = pathFor(event);
      if (seen.has(path)) continue;
      raise(event);
      seen.add(path);
    }
  }

  return { raise, clear, reannounce };
}

module.exports = { createNotifier };
