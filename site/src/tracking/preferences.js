/* One contract for manual sensitivity. Text and camera data never enter storage.
   The app owns live values; the controller consumes immutable validated values. */
export const TRACKING_DEFAULTS = Object.freeze({
  headAngleDeg: 2.5,
  doubleStepAngleDeg: 8,
  doubleStepVerticalAngleDeg: 6,
  reactionDelayMs: 300,
  blinkStrictness: 0,
  invertHorizontal: true,
  doubleStepEnabled: true
});
export const TRACKING_STORAGE_KEY = 'keyboardApp.tracking.v1';

export function validateTrackingPreferences(value) {
  const fields = Object.keys(TRACKING_DEFAULTS);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value,key))) {
    throw new TypeError('INVALID_TRACKING_SETTINGS');
  }
  const {headAngleDeg,doubleStepAngleDeg,doubleStepVerticalAngleDeg,reactionDelayMs,blinkStrictness,invertHorizontal,doubleStepEnabled} = value;
  if (!Number.isFinite(headAngleDeg) || headAngleDeg < 1 || headAngleDeg > 12 ||
      !Number.isInteger(headAngleDeg * 2) ||
      !Number.isFinite(doubleStepAngleDeg) || doubleStepAngleDeg < 1 || doubleStepAngleDeg > 24 ||
      !Number.isInteger(doubleStepAngleDeg * 2) ||
      !Number.isFinite(doubleStepVerticalAngleDeg) || doubleStepVerticalAngleDeg < 1 || doubleStepVerticalAngleDeg > 24 ||
      !Number.isInteger(doubleStepVerticalAngleDeg * 2) ||
      !Number.isInteger(reactionDelayMs) || reactionDelayMs < 0 || reactionDelayMs > 1500 ||
      reactionDelayMs % 50 !== 0 ||
      !Number.isInteger(blinkStrictness) || blinkStrictness < 0 || blinkStrictness > 100 || blinkStrictness % 5 !== 0 ||
      typeof invertHorizontal !== 'boolean' ||
      typeof doubleStepEnabled !== 'boolean') {
    throw new TypeError('INVALID_TRACKING_SETTINGS');
  }
  return Object.freeze({headAngleDeg,doubleStepAngleDeg,doubleStepVerticalAngleDeg,reactionDelayMs,blinkStrictness,invertHorizontal,doubleStepEnabled});
}

export function readTrackingPreferences() {
  try {
    const raw = globalThis.localStorage.getItem(TRACKING_STORAGE_KEY);
    if (raw === null) return {values:TRACKING_DEFAULTS,storageIssue:false};
    const data = JSON.parse(raw);
    if (!data || ![1,2,3,4,5].includes(data.schemaVersion) || Object.keys(data).length !== 2 || !Object.hasOwn(data,'values')) {
      throw new TypeError('INVALID_TRACKING_SETTINGS');
    }
    const saved = data.values && typeof data.values === 'object' && !Array.isArray(data.values) ? data.values : {};
    if (data.schemaVersion === 5) {
      return {values:validateTrackingPreferences(saved),storageIssue:false};
    }
    let values;
    if (data.schemaVersion === 1) {
      values = {...saved,invertHorizontal:TRACKING_DEFAULTS.invertHorizontal,doubleStepEnabled:TRACKING_DEFAULTS.doubleStepEnabled,doubleStepAngleDeg:saved.headAngleDeg * 2,doubleStepVerticalAngleDeg:saved.headAngleDeg * 2};
    } else if (data.schemaVersion === 2) {
      values = {...saved,doubleStepEnabled:TRACKING_DEFAULTS.doubleStepEnabled,doubleStepAngleDeg:saved.headAngleDeg * 2,doubleStepVerticalAngleDeg:saved.headAngleDeg * 2};
    } else if (data.schemaVersion === 3) {
      values = {...saved,doubleStepAngleDeg:saved.headAngleDeg * 2,doubleStepVerticalAngleDeg:saved.headAngleDeg * 2};
    } else {
      values = {...saved,doubleStepVerticalAngleDeg:saved.doubleStepAngleDeg};
    }
    return {values:validateTrackingPreferences(values),storageIssue:false};
  } catch {
    // Corruption or denied storage must not remove unrelated origin data.
    return {values:TRACKING_DEFAULTS,storageIssue:true};
  }
}

export function writeTrackingPreferences(value) {
  const values = validateTrackingPreferences(value);
  try {
    globalThis.localStorage.setItem(TRACKING_STORAGE_KEY,JSON.stringify({schemaVersion:5,values}));
    return true;
  } catch {
    return false;
  }
}
