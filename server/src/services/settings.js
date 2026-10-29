import { getSetting } from '../db.js';

/** Admin-adjustable numbers, with defaults and allowed ranges. */
export const SETTING_DEFAULTS = {
  'approval.escalationMinutes': 15, // next authority sees a request after this many minutes without a decision
  'approval.autoCancelHours': 8, // a request nobody answers is cancelled automatically after this many hours
  'gate.notReturnedGraceMin': 60, // "not returned" this many minutes after the expected arrival time
};

export const SETTING_RANGES = {
  'approval.escalationMinutes': [1, 1440, 'Minutes before the next authority sees a request must be between 1 and 1440'],
  'approval.autoCancelHours': [1, 168, 'Hours before an unanswered request is cancelled must be between 1 and 168 (7 days)'],
  'gate.notReturnedGraceMin': [1, 1440, 'Minutes after expected arrival must be between 1 and 1440'],
};

export async function numSetting(key) {
  const v = Number(await getSetting(key, SETTING_DEFAULTS[key]));
  return Number.isFinite(v) && v >= 0 ? v : SETTING_DEFAULTS[key];
}
