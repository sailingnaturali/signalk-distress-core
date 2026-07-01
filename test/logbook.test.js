'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeLogbookEntry } = require('../lib/logbook');

test('writeLogbookEntry POSTs text/observations with auth headers and radio category', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true }; };
  await writeLogbookEntry({
    url: 'http://x/logs', token: 'tok', text: 'hello',
    observations: { visibility: 3 }, extra: { vhf: '70' }, fetchImpl,
  });
  assert.equal(captured.url, 'http://x/logs');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  assert.match(captured.opts.headers.Cookie, /JAUTHENTICATION=tok/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.text, 'hello');
  assert.equal(body.ago, 0);
  assert.equal(body.category, 'radio');
  assert.equal(body.vhf, '70');
  assert.deepEqual(body.observations, { visibility: 3 });
});

test('writeLogbookEntry omits observations when none, and throws on non-ok', async () => {
  const okNoObs = async (url, opts) => {
    assert.equal(JSON.parse(opts.body).observations, undefined);
    return { ok: true };
  };
  await writeLogbookEntry({ url: 'u', token: 't', text: 'x', fetchImpl: okNoObs });

  const bad = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    () => writeLogbookEntry({ url: 'u', token: 't', text: 'x', fetchImpl: bad }),
    /HTTP 401/
  );
});
