'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deviceBeaconFor, NATURES, NATURE_TEXT } = require('../lib/constants');

test('deviceBeaconFor maps 97x prefixes to device classes', () => {
  assert.equal(deviceBeaconFor('974321098'), 'epirb');
  assert.equal(deviceBeaconFor('972321098'), 'mob');
  assert.equal(deviceBeaconFor('970321098'), 'sart');
  assert.equal(deviceBeaconFor('338040079'), undefined);
  assert.equal(deviceBeaconFor(undefined), undefined);
});

test('nature code/name/text tables agree', () => {
  assert.equal(NATURES['12'], 'epirb');
  assert.equal(NATURE_TEXT.epirb, 'EPIRB emission');
  assert.equal(NATURE_TEXT.mob, 'man overboard');
});
