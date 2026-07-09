'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReporter, loadOrCreateReceiverKey } = require('../lib/reporter');

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

test('400 is dropped without retry; the next report still delivers', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch((call) =>
    call.body.bad ? { ok: false, status: 400 } : { ok: true, status: 201 }
  );
  const dropped = [];
  const reporter = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl,
    log: (m) => dropped.push(m),
  });
  reporter.start();
  reporter.report({ bad: true });
  reporter.report({ good: true });
  await eventually(() => {
    assert.equal(calls.length, 2); // bad tried exactly once
    assert.equal(calls[1].body.good, true);
    assert.ok(dropped.some((m) => /HTTP 400/.test(m)));
  });
  reporter.stop();
});

test('404 drops and signals onPermanentError once until a success resets it', async () => {
  const queueFile = tmpQueue();
  let mode = 404;
  const { impl, calls } = mockFetch(() =>
    mode === 404 ? { ok: false, status: 404 } : { ok: true, status: 200 }
  );
  const signals = [];
  const reporter = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl,
    onPermanentError: (status) => signals.push(status),
  });
  reporter.start();
  reporter.report({ n: 1 });
  reporter.report({ n: 2 });
  await eventually(() => assert.equal(calls.length, 2));
  assert.deepEqual(signals, [404]); // two drops, one signal — no spam

  mode = 200;
  reporter.report({ n: 3 }); // success resets the once-guard
  await eventually(() => assert.equal(calls.length, 3));
  mode = 404;
  reporter.report({ n: 4 });
  await eventually(() => assert.deepEqual(signals, [404, 404]));
  reporter.stop();
});

test('network error keeps the entry; delivery resumes when fetch recovers', async () => {
  const queueFile = tmpQueue();
  let online = false;
  const { impl, calls } = mockFetch(() => {
    if (!online) throw new Error('ECONNREFUSED');
    return { ok: true, status: 201 };
  });
  const reporter = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl, backoffBaseMs: 10,
  });
  reporter.start();
  reporter.report({ seq: 0 });
  reporter.report({ seq: 1 });
  await eventually(() => assert.ok(calls.length >= 1)); // tried and failed
  const failedTries = calls.length;
  online = true;
  await eventually(() => {
    // Everything delivered, in order, nothing dropped by the outage.
    const delivered = calls.slice(failedTries).map((c) => c.body.seq);
    assert.deepEqual(delivered, [0, 1]);
    assert.equal(fs.readFileSync(queueFile, 'utf8').trim(), '');
  });
  reporter.stop();
});

test('5xx retries are capped per entry, then the entry drops and the queue moves on', async () => {
  const queueFile = tmpQueue();
  const { impl, calls } = mockFetch((call) =>
    call.body.poison ? { ok: false, status: 500 } : { ok: true, status: 201 }
  );
  const reporter = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl,
    maxAttempts: 3, backoffBaseMs: 5, backoffMaxMs: 10,
  });
  reporter.start();
  reporter.report({ poison: true });
  reporter.report({ after: true });
  await eventually(() => {
    const poisonTries = calls.filter((c) => c.body.poison).length;
    assert.equal(poisonTries, 3); // exactly maxAttempts, then dropped
    assert.equal(calls[calls.length - 1].body.after, true);
  });
  reporter.stop();
});

test('undelivered reports survive a restart and flush in order', async () => {
  const queueFile = tmpQueue();
  const offline = mockFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  const first = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: offline.impl, backoffBaseMs: 5,
  });
  first.start();
  first.report({ seq: 0 });
  first.report({ seq: 1 });
  await eventually(() => assert.ok(offline.calls.length >= 1));
  first.stop(); // "process exit" — queue stays on disk

  const online = mockFetch();
  const second = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: online.impl,
  });
  second.start();
  await eventually(() => {
    assert.deepEqual(online.calls.map((c) => c.body.seq), [0, 1]);
    assert.equal(fs.readFileSync(queueFile, 'utf8').trim(), '');
  });
  second.stop();
});

test('a torn queue line is skipped; the rest of the queue still delivers', async () => {
  const queueFile = tmpQueue();
  fs.writeFileSync(queueFile, `${JSON.stringify({ seq: 0 })}\n{"seq": 1, "torn\n${JSON.stringify({ seq: 2 })}\n`);
  const { impl, calls } = mockFetch();
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl });
  reporter.start();
  await eventually(() => assert.deepEqual(calls.map((c) => c.body.seq), [0, 2]));
  reporter.stop();
});

test('maxQueue caps growth by dropping oldest', async () => {
  const queueFile = tmpQueue();
  const { impl } = mockFetch(() => {
    throw new Error('offline');
  });
  const reporter = createReporter({
    url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl, maxQueue: 3, backoffBaseMs: 60000,
  });
  reporter.start();
  for (let i = 0; i < 5; i++) reporter.report({ seq: i });
  await eventually(() => {
    const lines = fs.readFileSync(queueFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).seq);
    assert.deepEqual(lines, [2, 3, 4]);
  });
  reporter.stop();
});

test('stop() during an in-flight POST: the stale flusher never touches the queue file', async () => {
  const queueFile = tmpQueue();
  let resolveFetch;
  const gate = new Promise((r) => (resolveFetch = r));
  const calls = [];
  const impl = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    await gate; // hold the POST in flight
    return { ok: true, status: 201 };
  };
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl });
  reporter.start();
  reporter.report({ seq: 0 });
  await eventually(() => assert.equal(calls.length, 1)); // fetch is in flight
  reporter.stop(); // plugin restart: a new instance may now own the file
  fs.appendFileSync(queueFile, JSON.stringify({ seq: 99 }) + '\n'); // new instance's append
  resolveFetch(); // stale POST finally resolves
  await new Promise((r) => setTimeout(r, 50));
  const onDisk = fs.readFileSync(queueFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).seq);
  assert.deepEqual(onDisk, [0, 99]); // stale flusher must NOT have shifted/persisted
});

test('fetch options carry a signal (AbortSignal) for timeout', async () => {
  const queueFile = tmpQueue();
  let capturedSignal;
  const impl = async (url, opts) => {
    capturedSignal = opts.signal;
    return { ok: true, status: 201 };
  };
  const reporter = createReporter({ url: 'u', userAgent: 'ua', queueFile, fetchImpl: impl, fetchTimeoutMs: 5000 });
  reporter.start();
  reporter.report({ n: 1 });
  await eventually(() => assert.ok(capturedSignal !== undefined));
  assert.ok(capturedSignal instanceof AbortSignal, 'signal must be an AbortSignal');
  reporter.stop();
});

test('loadOrCreateReceiverKey mints a lowercase UUID once and reuses it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-')), 'dscwatch-receiver-key');
  const key = loadOrCreateReceiverKey(file);
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(loadOrCreateReceiverKey(file), key); // stable across calls
  assert.equal(fs.readFileSync(file, 'utf8').trim(), key); // persisted
});
