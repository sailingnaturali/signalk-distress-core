'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('..');

test('public API exposes the full shared surface', () => {
  for (const name of [
    'EventStore', 'buildMarkerResourceSets', 'CATEGORY_COLORS',
    'buildMessage', 'buildLogbookText', 'formatPosition',
    'createNotifier', 'writeLogbookEntry', 'deviceBeaconFor', 'NATURES', 'NATURE_TEXT',
    'distanceNm', 'bearingDegrees', 'compassWord',
    'captureOwnShip', 'buildObservations',
    'createReporter', 'loadOrCreateReceiverKey',
  ]) {
    assert.ok(core[name] !== undefined, `missing export: ${name}`);
  }
});
