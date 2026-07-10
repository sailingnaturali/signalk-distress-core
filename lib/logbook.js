'use strict';

// POST a ship's-log entry to the signalk-logbook plugin's REST API. Extracted
// from signalk-dsc so any distress source can write a GMDSS-style radio-log
// entry. Transport-specific fields (e.g. DSC's `vhf: '70'`) come in via `extra`.
// `fetchImpl` is injectable for testing; it defaults to the global fetch.
async function writeLogbookEntry({ url, token, text, observations, extra = {}, fetchImpl = fetch }) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // signalk-server's auth gate reads the Authorization header; the logbook
      // plugin reads the author from the JAUTHENTICATION cookie.
      Authorization: `Bearer ${token}`,
      Cookie: `JAUTHENTICATION=${token}`,
    },
    body: JSON.stringify({
      text,
      ago: 0,
      category: 'radio',
      // Provenance: distress logging is unattended machinery. Ignored by
      // signalk-logbook until its origin-field PR ships, then explicit.
      origin: 'auto',
      ...(observations ? { observations } : {}),
      ...extra,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

module.exports = { writeLogbookEntry };
