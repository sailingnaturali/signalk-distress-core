'use strict';

/*
 * Two renderings of a distress event (DSC call or AIS beacon):
 *
 * - buildMessage: the notification message. This ends up SPOKEN by the voice
 *   pipeline, so it is deliberately minimal — type, vessel, situation, range
 *   and direction from us, action. Nothing else.
 * - buildLogbookText: the ship's-log entry — full detail (MMSI, coordinates,
 *   reported time, transport), GMDSS radio-log style.
 */

const { distanceNm, bearingDegrees, compassWord } = require('./geo');
const { NATURE_TEXT } = require('./constants');

const AIS_BEACON_PHRASE = {
  sart: 'AIS distress: SART active',
  mob: 'AIS man-overboard beacon',
  epirb: 'AIS EPIRB beacon',
};

function formatCoordinate(value, axis) {
  const hemisphere = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return `${degrees}°${minutes.toFixed(3)}′${hemisphere}`;
}

function formatPosition(position) {
  return `${formatCoordinate(position.latitude, 'lat')} ${formatCoordinate(position.longitude, 'lon')}`;
}

// Spoken form. No MMSI fallback here on purpose: TTS reads 366123456 as
// "three hundred sixty-six million...". The MMSI stays in the call log and
// the logbook entry.
function vesselPhrase(event, vesselName) {
  return vesselName ? `vessel ${vesselName}` : 'unidentified vessel';
}

/** "2.3 nautical miles northwest" | "position 48°47.700′N ..." | "position unknown" */
function wherePhrase(event, ownPosition, { spoken }) {
  if (event.position && ownPosition) {
    const range = distanceNm(ownPosition, event.position);
    const direction = compassWord(bearingDegrees(ownPosition, event.position));
    const unit = spoken ? 'nautical miles' : 'NM';
    const suffix = spoken ? '' : ' of us';
    return `${range.toFixed(1)} ${unit} ${direction}${suffix}`;
  }
  if (event.position) return `position ${formatPosition(event.position)}`;
  return 'position unknown';
}

function buildMessage(event, { ownPosition, vesselName } = {}) {
  const who = vesselPhrase(event, vesselName);
  const where = wherePhrase(event, ownPosition, { spoken: true });
  if (event.source === 'ais') {
    const lead = AIS_BEACON_PHRASE[event.deviceBeacon] || 'AIS distress beacon';
    return `${lead}, ${where}. Monitor channel 16.`;
  }
  if (event.category === 'distress') {
    const nature = NATURE_TEXT[event.natureOfDistress] || event.natureOfDistress || 'undesignated distress';
    const lead = event.relay ? 'DSC distress relay' : 'DSC distress alert';
    return `${lead}: ${who}, ${nature}, ${where}. Monitor channel 16.`;
  }
  const kind = event.category === 'unknown' ? 'call' : `${event.category} call`;
  return `DSC ${kind}: ${who}, ${where}.`;
}

function buildLogbookText(event, { ownPosition, vesselName } = {}) {
  const parts = [];
  const name = vesselName ? `${vesselName} (MMSI ${event.mmsi || 'unknown'})` : `MMSI ${event.mmsi || 'unknown'}`;
  if (event.source === 'ais') {
    const kind = { sart: 'SART', mob: 'MOB', epirb: 'EPIRB' }[event.deviceBeacon] || 'distress';
    parts.push(`${kind} beacon ${name}${event.state ? ` (${event.state})` : ''}`);
  } else if (event.category === 'distress') {
    const nature = NATURE_TEXT[event.natureOfDistress] || event.natureOfDistress || 'undesignated distress';
    if (event.relay) {
      // Name the casualty (distressedMmsi) and the relaying station (name).
      const casualty = event.distressedMmsi ? `MMSI ${event.distressedMmsi}` : 'an unidentified vessel';
      parts.push(`DISTRESS RELAY from ${name} reporting ${casualty}: ${nature}`);
    } else {
      parts.push(`DISTRESS alert from ${name}: ${nature}`);
    }
  } else {
    parts.push(`${event.category} call from ${name}`);
  }
  if (event.position) {
    let pos = `position ${formatPosition(event.position)}`;
    if (event.utcTime) pos += ` at ${event.utcTime} UTC`;
    if (ownPosition) pos += `, ${wherePhrase(event, ownPosition, { spoken: false })}`;
    parts.push(pos);
  } else if (event.utcTime) {
    parts.push(`reported at ${event.utcTime} UTC`);
  }
  if (event.workingChannel) parts.push(`proposed working channel ${event.workingChannel}`);
  if (event.source) parts.push(`via ${event.source}`);
  const tag = event.source === 'ais' ? 'AIS' : 'DSC';
  return `[${tag}] ${parts.join('. ')}`;
}

module.exports = { buildMessage, buildLogbookText, formatPosition };
