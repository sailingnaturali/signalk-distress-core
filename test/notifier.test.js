'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier } = require('../lib/notifier');

function fakeApp() {
  const deltas = [];
  return { handleMessage: (id, d) => deltas.push({ id, d }), deltas };
}

test('raise emits a notification delta at the event path and state', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => `notifications.ais.distress.${e.deviceBeacon}`,
    stateFor: () => 'emergency',
  });
  n.raise({ deviceBeacon: 'epirb', message: 'AIS EPIRB beacon' });
  const v = app.deltas[0].d.updates[0].values[0];
  assert.equal(v.path, 'notifications.ais.distress.epirb');
  assert.equal(v.value.state, 'emergency');
  assert.equal(v.value.message, 'AIS EPIRB beacon');
});

test('clear emits a null value at the given path', () => {
  const app = fakeApp();
  const n = createNotifier({ app, pluginId: 'test', pathFor: () => 'x', stateFor: () => 'emergency' });
  n.clear('notifications.ais.distress.epirb');
  const v = app.deltas[0].d.updates[0].values[0];
  assert.equal(v.path, 'notifications.ais.distress.epirb');
  assert.equal(v.value, null);
});

test('reannounce re-raises only uncleared events within the window, once per path', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => `notifications.ais.distress.${e.deviceBeacon}`,
    stateFor: () => 'emergency',
  });
  const now = Date.parse('2026-06-30T20:00:00.000Z');
  const recent = { deviceBeacon: 'epirb', message: 'm', receivedAt: '2026-06-30T19:59:00.000Z' };
  const stale = { deviceBeacon: 'mob', message: 'm', receivedAt: '2026-06-30T17:00:00.000Z' };
  const cleared = { deviceBeacon: 'sart', message: 'm', receivedAt: '2026-06-30T19:59:00.000Z', clearedAt: '2026-06-30T19:59:30.000Z' };
  n.reannounce([recent, stale, cleared], { window: 60 * 60 * 1000, now });
  assert.equal(app.deltas.length, 1);
  assert.equal(app.deltas[0].d.updates[0].values[0].path, 'notifications.ais.distress.epirb');
});
