export const INPUT_DEFAULTS = Object.freeze({clickSource: 'mouth', remoteBinding: null});
export const INPUT_STORAGE_KEY = 'keyboardApp.input.v1';

const CLICK_SOURCES = new Set(['mouth', 'blink', 'external']);
const MODIFIER_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock',
  'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'Symbol', 'SymbolLock'
]);
const RESERVED_BINDING_KEYS = new Set(['Tab', 'Escape', 'Dead', 'Process', 'Unidentified']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateRemoteBinding(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 3 ||
      !Object.hasOwn(value, 'key') || !Object.hasOwn(value, 'code') || !Object.hasOwn(value, 'location')) {
    throw new TypeError('INVALID_INPUT_SETTINGS');
  }
  const {key, code, location} = value;
  if (typeof key !== 'string' || key.length < 1 || key.length > 64 ||
      MODIFIER_KEYS.has(key) || RESERVED_BINDING_KEYS.has(key) ||
      typeof code !== 'string' || code.length > 64 ||
      !Number.isInteger(location) || location < 0 || location > 3) {
    throw new TypeError('INVALID_INPUT_SETTINGS');
  }
  return Object.freeze({key, code, location});
}

export function validateInputPreferences(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'clickSource') || !Object.hasOwn(value, 'remoteBinding')) {
    throw new TypeError('INVALID_INPUT_SETTINGS');
  }
  const {clickSource, remoteBinding} = value;
  if (typeof clickSource !== 'string' || !CLICK_SOURCES.has(clickSource)) {
    throw new TypeError('INVALID_INPUT_SETTINGS');
  }
  return Object.freeze({
    clickSource,
    remoteBinding: remoteBinding === null ? null : validateRemoteBinding(remoteBinding)
  });
}

export function readInputPreferences() {
  try {
    const raw = globalThis.localStorage.getItem(INPUT_STORAGE_KEY);
    if (raw === null) return {values: INPUT_DEFAULTS, storageIssue: false};
    const data = JSON.parse(raw);
    if (!isPlainObject(data) || Object.keys(data).length !== 2 ||
        data.schemaVersion !== 1 || !Object.hasOwn(data, 'values')) {
      throw new TypeError('INVALID_INPUT_SETTINGS');
    }
    return {values: validateInputPreferences(data.values), storageIssue: false};
  } catch {
    return {values: INPUT_DEFAULTS, storageIssue: true};
  }
}

export function writeInputPreferences(value) {
  const values = validateInputPreferences(value);
  try {
    globalThis.localStorage.setItem(INPUT_STORAGE_KEY, JSON.stringify({schemaVersion: 1, values}));
    return true;
  } catch {
    return false;
  }
}
