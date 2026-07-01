'use strict';

const NATURES = {
  '00': 'fire', '01': 'flooding', '02': 'collision', '03': 'grounding',
  '04': 'listing', '05': 'sinking', '06': 'adrift', '07': 'undesignated',
  '08': 'abandon', '09': 'piracy', '10': 'mob', '12': 'epirb',
};

const NATURE_TEXT = {
  fire: 'fire and explosion', flooding: 'flooding', collision: 'collision',
  grounding: 'grounding', listing: 'listing, in danger of capsize',
  sinking: 'sinking', adrift: 'disabled and adrift',
  undesignated: 'undesignated distress', abandon: 'abandoning ship',
  piracy: 'piracy attack', mob: 'man overboard', epirb: 'EPIRB emission',
};

const DEVICE_BEACONS = { '970': 'sart', '972': 'mob', '974': 'epirb' };

function deviceBeaconFor(mmsi) {
  if (typeof mmsi !== 'string') return undefined;
  return DEVICE_BEACONS[mmsi.substring(0, 3)];
}

module.exports = { NATURES, NATURE_TEXT, DEVICE_BEACONS, deviceBeaconFor };
