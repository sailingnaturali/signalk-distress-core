'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** Read the persisted receiver key, or mint a lowercase UUID once and keep it.
 *  DSCWatch has no registration call: the first report for a new key creates
 *  the receiver record, so the only rule is "reuse the same value forever". */
function loadOrCreateReceiverKey(filePath) {
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // no key yet
  }
  const key = crypto.randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, key + '\n');
  return key;
}

/*
 * Generic "deliver JSON payloads to an HTTP endpoint through a persistent
 * queue" module. Payloads are opaque — no DSC (or any service) semantics
 * here; signalk-dsc maps its events onto DSCWatch bodies before calling
 * report(), and signalk-ais-distress can reuse this as-is.
 *
 * Write-through, not batching: report() appends to the JSONL queue and
 * immediately kicks the flusher, so a healthy network sees the POST within
 * milliseconds. The append-before-POST ordering is crash-safety — a report
 * survives the process dying mid-flight. Delivery is sequential and in
 * order so position refinements follow the alerts they refine.
 */
function createReporter({
  url,
  userAgent,
  queueFile,
  maxQueue = 5000,
  maxAttempts = 10,
  backoffBaseMs = 1000,
  backoffMaxMs = 5 * 60 * 1000,
  log = () => {},
  onPermanentError = () => {},
  fetchImpl = fetch,
}) {
  let queue = []; // { payload, attempts } — attempts is in-memory only
  let started = false;
  let flushing = false;
  let timer = null;
  let backoffMs = backoffBaseMs;
  let permanentSignaled = false;

  try {
    for (const line of fs.readFileSync(queueFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        queue.push({ payload: JSON.parse(line), attempts: 0 });
      } catch {
        // torn/corrupt line — skip it, keep the rest
      }
    }
  } catch {
    // no queue yet
  }

  function persist() {
    const tmp = `${queueFile}.tmp`;
    fs.mkdirSync(path.dirname(queueFile), { recursive: true });
    fs.writeFileSync(tmp, queue.map((e) => JSON.stringify(e.payload)).join('\n') + '\n');
    fs.renameSync(tmp, queueFile);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, ms);
    if (timer.unref) timer.unref();
  }

  function backoff() {
    schedule(backoffMs);
    backoffMs = Math.min(backoffMs * 2, backoffMaxMs);
  }

  async function flush() {
    if (!started || flushing) return;
    flushing = true;
    try {
      while (started && queue.length) {
        const entry = queue[0];
        let res;
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
            body: JSON.stringify(entry.payload),
          });
        } catch (err) {
          // Network down (the offline-passage case): keep everything —
          // whatever is behind the head is failing for the same reason,
          // so in-order blocking costs nothing. Retry on a growing timer.
          log(`reporter: network error (${err.message}) — ${queue.length} queued`);
          backoff();
          return;
        }
        if (res.ok) {
          queue.shift();
          persist();
          backoffMs = backoffBaseMs;
          permanentSignaled = false;
          continue;
        }
        if (res.status === 400 || res.status === 404) {
          // A retry cannot fix a bad body or a rejected receiver key.
          queue.shift();
          persist();
          log(`reporter: dropped report (HTTP ${res.status})`);
          if (res.status === 404 && !permanentSignaled) {
            permanentSignaled = true;
            onPermanentError(res.status);
          }
          continue;
        }
        // Server reachable but erroring (5xx): retry with backoff, but cap
        // per entry — one poison payload must not block the queue behind it.
        entry.attempts += 1;
        if (entry.attempts >= maxAttempts) {
          queue.shift();
          persist();
          log(`reporter: dropped report after ${maxAttempts} attempts (HTTP ${res.status})`);
          continue;
        }
        backoff();
        return;
      }
    } catch (err) {
      log(`reporter: flush failed: ${err.message}`);
    } finally {
      flushing = false;
    }
  }

  return {
    /** Enqueue and kick the flusher. Fire-behind: never throws. */
    report(payload) {
      try {
        queue.push({ payload, attempts: 0 });
        if (queue.length > maxQueue) {
          queue = queue.slice(-maxQueue);
          persist();
        } else {
          fs.mkdirSync(path.dirname(queueFile), { recursive: true });
          fs.appendFileSync(queueFile, JSON.stringify(payload) + '\n');
        }
        flush();
      } catch (err) {
        log(`reporter: enqueue failed: ${err.message}`);
      }
    },
    start() {
      started = true;
      flush();
    },
    stop() {
      started = false;
      clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = { createReporter, loadOrCreateReceiverKey };
