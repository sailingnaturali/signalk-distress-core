'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier, receivedPath } = require('../lib/notifier');

function fakeApp() {
  const deltas = [];
  const putHandlers = {};
  return {
    handleMessage: (id, d) => deltas.push({ id, d }),
    deltas,
    putHandlers,
    registerPutHandler: (ctx, path, cb) => { putHandlers[`${ctx}:${path}`] = cb; },
  };
}

test('receivedPath keys per call and strips path-reserved chars from the id', () => {
  const path = receivedPath('distress', 'dsc', '2026-07-17T12:34:56.000Z-338040079');
  assert.equal(path, 'notifications.received.distress.dsc-2026-07-17T123456000Z-338040079');
  assert.doesNotMatch(path.split('.').pop(), /[.:]/);
});

test('with onCleared, raise registers a per-call PUT ack that clears just that call', () => {
  const app = fakeApp();
  const cleared = [];
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => receivedPath('distress', 'dsc', e.id),
    stateFor: () => 'emergency',
    onCleared: (e) => cleared.push(e.id),
  });
  const path = n.raise({ id: 'a', message: 'm' });
  const handler = app.putHandlers[`vessels.self:${path}`];
  assert.ok(handler, 'a PUT handler was registered at the call path');

  const res = handler();
  assert.equal(res.state, 'COMPLETED');
  // Cleared: the notification is nulled and onCleared fired for this call only.
  assert.equal(app.deltas.at(-1).d.updates[0].values[0].value, null);
  assert.deepEqual(cleared, ['a']);
});

test('without onCleared, raise never touches registerPutHandler', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => receivedPath('distress', 'dsc', e.id),
    stateFor: () => 'emergency',
  });
  n.raise({ id: 'a', message: 'm' });
  assert.equal(Object.keys(app.putHandlers).length, 0);
});

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

test('raise is a no-op when stateFor yields no state (non-alarming category)', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => `notifications.dsc.${e.category}`,
    stateFor: (e) => ({ distress: 'emergency' })[e.category],
  });
  const path = n.raise({ category: 'routine', message: 'm', receivedAt: '2026-06-30T20:00:00.000Z' });
  assert.equal(app.deltas.length, 0);
  assert.equal(path, undefined);
});

test('raise carries the event receivedAt as the notification timestamp', () => {
  const app = fakeApp();
  const n = createNotifier({ app, pluginId: 'test', pathFor: () => 'notifications.x', stateFor: () => 'emergency' });
  n.raise({ message: 'm', receivedAt: '2026-06-30T20:00:00.000Z' });
  assert.equal(app.deltas[0].d.updates[0].values[0].value.timestamp, '2026-06-30T20:00:00.000Z');
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

test('reannounce measures freshness from lastReceivedAt when a repeat has bumped it', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => `notifications.ais.distress.${e.deviceBeacon}`,
    stateFor: () => 'emergency',
  });
  const now = Date.parse('2026-06-30T20:00:00.000Z');
  // First heard long ago, but still transmitting a minute ago → still fresh.
  const beacon = {
    deviceBeacon: 'epirb', message: 'm',
    receivedAt: '2026-06-30T17:00:00.000Z',
    lastReceivedAt: '2026-06-30T19:59:00.000Z',
  };
  n.reannounce([beacon], { window: 60 * 60 * 1000, now });
  assert.equal(app.deltas.length, 1);
});

test('reannounce re-raises the newest event per path and runs prepare on it first', () => {
  const app = fakeApp();
  const n = createNotifier({
    app, pluginId: 'test',
    pathFor: (e) => `notifications.ais.distress.${e.deviceBeacon}`,
    stateFor: () => 'emergency',
  });
  const now = Date.parse('2026-06-30T20:00:00.000Z');
  const older = { deviceBeacon: 'epirb', receivedAt: '2026-06-30T19:50:00.000Z' };
  const newer = { deviceBeacon: 'epirb', receivedAt: '2026-06-30T19:59:00.000Z' };
  const prepared = [];
  n.reannounce([older, newer], {
    window: 60 * 60 * 1000, now,
    prepare: (e) => { prepared.push(e); e.message = `refreshed ${e.receivedAt}`; },
  });
  assert.equal(app.deltas.length, 1);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0], newer); // newest wins
  assert.equal(app.deltas[0].d.updates[0].values[0].value.message, 'refreshed 2026-06-30T19:59:00.000Z');
});
