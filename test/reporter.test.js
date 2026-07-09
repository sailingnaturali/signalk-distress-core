'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReporter } = require('../lib/reporter');

function tmpQueue() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-')), 'queue.jsonl');
}

// Poll until the assertions inside `fn` pass — delivery is async fire-behind.
async function eventually(fn, timeout = 1000) {
  const start = Date.now();
  for (;;) {
    try {
      fn();
      return;
    } catch (err) {
      if (Date.now() - start > timeout) throw err;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

/** fetch stand-in: records calls, answers from a scriptable handler. */
function mockFetch(handler = () => ({ ok: true, status: 201 })) {
  const calls = [];
  const impl = async (url, opts) => {
    const call = { url, opts, body: JSON.parse(opts.body) };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { impl, calls };
}

test('report() POSTs immediately with headers, then dequeues on 2xx', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch();
  const reporter = createReporter({
    url: 'https://x.test/api/v1/report/key-1',
    userAgent: 'test-client/1.0',
    queueFile,
    fetchImpl: impl,
  });
  reporter.start();
  reporter.report({ category: 'distress', mmsi: '244223600' });

  await eventually(() => {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://x.test/api/v1/report/key-1');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].opts.headers['User-Agent'], 'test-client/1.0');
    assert.equal(calls[0].body.mmsi, '244223600');
    // Dequeued: nothing left on disk.
    assert.equal(fs.readFileSync(queueFile, 'utf8').trim(), '');
  });
  reporter.stop();
});

test('200 (merged) and 201 (created) are both accepted', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch((call, n) => ({ ok: true, status: n === 1 ? 201 : 200 }));
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl });
  reporter.start();
  reporter.report({ n: 1 });
  reporter.report({ n: 2 });
  await eventually(() => {
    assert.equal(calls.length, 2);
    assert.equal(fs.readFileSync(queueFile, 'utf8').trim(), '');
  });
  reporter.stop();
});

test('delivery is sequential and in submission order', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch();
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl });
  reporter.start();
  for (let i = 0; i < 5; i++) reporter.report({ seq: i });
  await eventually(() => {
    assert.deepEqual(calls.map((c) => c.body.seq), [0, 1, 2, 3, 4]);
  });
  reporter.stop();
});

test('reports enqueued before start() flush on start()', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch();
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl });
  reporter.report({ early: true }); // not started yet: queued, not sent
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 0);
  reporter.start();
  await eventually(() => assert.equal(calls.length, 1));
  reporter.stop();
});
