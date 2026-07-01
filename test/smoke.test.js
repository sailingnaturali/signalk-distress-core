'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('..');

test('package requires cleanly', () => {
  assert.equal(typeof core, 'object');
});
