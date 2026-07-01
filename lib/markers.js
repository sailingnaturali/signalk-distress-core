'use strict';

const CATEGORY_COLORS = {
  distress: 'rgba(211,47,47,1)',
  urgency: 'rgba(245,124,0,1)',
  safety: 'rgba(251,192,45,1)',
  routine: 'rgba(117,117,117,1)',
};

const HOUR_MS = 60 * 60 * 1000;

function withinWindow(event, now, windowHours) {
  if (event.category === 'distress' && !event.clearedAt) return true;
  const received = Date.parse(event.receivedAt);
  if (Number.isNaN(received)) return false;
  return now - received <= windowHours * HOUR_MS;
}

function toFeature(event, nameFor) {
  const mmsi = event.distressedMmsi || event.mmsi;
  const vesselName = nameFor ? nameFor(mmsi) : undefined;
  const properties = {
    name: event.natureOfDistress
      ? `${event.category}: ${event.natureOfDistress}`
      : event.category,
    category: event.category,
    mmsi,
    utcTime: event.utcTime,
    receivedAt: event.receivedAt,
  };
  if (event.natureOfDistress) properties.natureOfDistress = event.natureOfDistress;
  if (vesselName) properties.vesselName = vesselName;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [event.position.longitude, event.position.latitude] },
    properties,
  };
}

// Turn stored distress events into Freeboard ResourceSets, one per bucket. The
// bucket key, colours, and set name/description are injectable so DSC (buckets
// by category, defaults below) and AIS (buckets by device beacon) can share this.
// Empty buckets are omitted.
function buildMarkerResourceSets(events, {
  now,
  windowHours = 24,
  nameFor,
  bucketOf = (e) => e.category || 'routine',
  colors = CATEGORY_COLORS,
  label = (b) => `DSC — ${b}`,
  describe = (b) => `DSC ${b} calls heard on channel 70`,
} = {}) {
  const buckets = {};
  for (const event of events) {
    if (
      !event.position ||
      typeof event.position.latitude !== 'number' ||
      typeof event.position.longitude !== 'number'
    )
      continue;
    if (!withinWindow(event, now, windowHours)) continue;
    const bucket = bucketOf(event);
    (buckets[bucket] = buckets[bucket] || []).push(toFeature(event, nameFor));
  }
  const out = {};
  for (const [bucket, features] of Object.entries(buckets)) {
    const color = colors[bucket] || CATEGORY_COLORS.routine;
    out[bucket] = {
      // Freeboard's isResourceSet() requires this exact discriminator, else it
      // filters the resource out and the chart layer renders nothing.
      type: 'ResourceSet',
      name: label(bucket),
      description: describe(bucket),
      styles: { default: { width: 2, stroke: color, fill: color } },
      values: { type: 'FeatureCollection', features },
    };
  }
  return out;
}

module.exports = { buildMarkerResourceSets, CATEGORY_COLORS };
