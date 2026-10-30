'use strict';
import {TRACKING_DEFAULTS,readTrackingPreferences,writeTrackingPreferences,validateTrackingPreferences} from './tracking/preferences.js';
import {INPUT_DEFAULTS,readInputPreferences,writeInputPreferences,validateInputPreferences} from './input-preferences.js';
import {pickMoveTarget,isSpaceId,oppositeDirection,getTargetCenter} from './navigation.js';

/*
  Owner state and command dispatch for the localized keyboard UI.
  All UI and MCP changes go through app.dispatch so behavior is identical.
*/

const LOCALE_IDS = Object.freeze(['ru','uk','en','de','es','pt','it']);
const NATIVE_NAMES = Object.freeze({ru:'Русский',uk:'Українська',en:'English',de:'Deutsch',es:'Español',pt:'Português',it:'Italiano'});
const LOCALE_KEYS = Object.freeze(['title','textRegion','placeholder','backspace','clear','keyboard','numbers','letters','space','settings','close','uiLanguage','keyboardLayout','resourceError','storageError','bridgeTitle','bridgeHelp','bridgeConnect','bridgeDisconnect','bridgeCode','bridgeConnected','bridgeDisconnected','bridgeError','licenseTitle','licenseNotice','licenseLink']);
const DEFAULT_SETTINGS = Object.freeze({schemaVersion:1,uiLocale:'ru',keyboardLayoutId:'ru'});
const STORAGE_KEY = 'keyboardApp.settings.v1';
const MAX_DIAGNOSTICS = 80;
const MAX_IDEMPOTENCY = 200;

const COMMAND_SPECS = Object.freeze({
  'keyboard.getState': {keys:[],requestId:false,idempotentKeys:[]},
  'keyboard.select': {keys:['id','requestId'],requestId:true,idempotentKeys:['id']},
  'keyboard.move': {keys:['direction','steps','requestId'],requestId:true,idempotentKeys:['direction','steps']},
  'keyboard.activate': {keys:['requestId','expectedId','geometryVersion','expectedTextRevision'],requestId:true,idempotentKeys:['expectedId','geometryVersion','expectedTextRevision']},
  'keyboard.backspace': {keys:['requestId','expectedId','geometryVersion','expectedTextRevision'],requestId:true,idempotentKeys:['expectedId','geometryVersion','expectedTextRevision']},
  'keyboard.clear': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'settings.get': {keys:[],requestId:false,idempotentKeys:[]},
  'settings.update': {keys:['uiLocale','keyboardLayoutId','requestId'],requestId:true,idempotentKeys:['uiLocale','keyboardLayoutId']},
  'settings.open': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'settings.close': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'input.settings.get': {keys:[],requestId:false,idempotentKeys:[]},
  'input.settings.update': {keys:['requestId','clickSource','remoteBinding','reset'],requestId:true,idempotentKeys:['clickSource','remoteBinding','reset']},
  'diagnostics.get': {keys:[],requestId:false,idempotentKeys:[]},
  'tracking.getStatus': {keys:[],requestId:false,idempotentKeys:[]},
  'tracking.start': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'tracking.stop': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'tracking.calibrate': {keys:['requestId'],requestId:true,idempotentKeys:[]},
  'tracking.settings.get': {keys:[],requestId:false,idempotentKeys:[]},
  'tracking.settings.update': {keys:['requestId','headAngleDeg','reactionDelayMs','blinkStrictness','invertHorizontal','doubleStepEnabled','doubleStepAngleDeg','doubleStepVerticalAngleDeg','reset'],requestId:true,idempotentKeys:['headAngleDeg','reactionDelayMs','blinkStrictness','invertHorizontal','doubleStepEnabled','doubleStepAngleDeg','doubleStepVerticalAngleDeg','reset']}
});

const state = {
  text: '',
  settings: {...DEFAULT_SETTINGS},
  activeSurface: 'keyboard',
  selectedId: 'letter:0',
  spaceOrigin: null,
  geometryVersion: 0,
  textRevision: 0,
  inputPreferences: INPUT_DEFAULTS,
  inputStorageIssue: false,
  diagnostics: [],
  trackingPreferences: TRACKING_DEFAULTS,
  trackingStorageIssue: false
};

let activeLocale = null;
let activeLayout = null;
let resourceErrorActive = false;
let storageErrorActive = false;
let activationEpoch = 0;
let lastKeyboardSelection = 'letter:0';
let lastTargetsSignature = '';
let commandQueue = Promise.resolve();
const idempotency = new Map();
const localeCache = new Map();
const layoutCache = new Map();
const dom = {};
let requestCounter = 0;
let graphemeSegmenter = null;
let trackingService = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    graphemeSegmenter = new Intl.Segmenter(undefined, {granularity:'grapheme'});
  }
} catch (error) {
  graphemeSegmenter = null;
}

function publicError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (key) { return JSON.stringify(key) + ':' + stableStringify(value[key]); }).join(',') + '}';
}

function makeRequestId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch (error) {}
  requestCounter += 1;
  return 'ui-' + Date.now().toString(36) + '-' + requestCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function isRegionalIndicator(cp) {
  return cp >= 0x1F1E6 && cp <= 0x1F1FF;
}

function isVariationSelector(cp) {
  return cp === 0xFE0E || cp === 0xFE0F;
}

function isEmojiModifier(cp) {
  return cp >= 0x1F3FB && cp <= 0x1F3FF;
}

function isTagCharacter(cp) {
  return cp >= 0xE0020 && cp <= 0xE007E;
}

function isCombiningMark(cp) {
  return (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0591 && cp <= 0x05BD) ||
    cp === 0x05BF || (cp >= 0x05C1 && cp <= 0x05C2) || (cp >= 0x05C4 && cp <= 0x05C5) || cp === 0x05C7 ||
    (cp >= 0x0610 && cp <= 0x061A) || (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670 ||
    (cp >= 0x06D6 && cp <= 0x06DC) || (cp >= 0x06DF && cp <= 0x06E4) || (cp >= 0x06E7 && cp <= 0x06E8) || (cp >= 0x06EA && cp <= 0x06ED) ||
    (cp >= 0x0711 && cp === 0x0711) || (cp >= 0x0730 && cp <= 0x074A) ||
    (cp >= 0x07A6 && cp <= 0x07B0) || (cp >= 0x07EB && cp <= 0x07F3) ||
    (cp >= 0x0816 && cp <= 0x0819) || (cp >= 0x081B && cp <= 0x0823) || (cp >= 0x0825 && cp <= 0x0827) || (cp >= 0x0829 && cp <= 0x082D) ||
    (cp >= 0x0859 && cp <= 0x085B) ||
    (cp >= 0x08D3 && cp <= 0x08E1) || (cp >= 0x08E3 && cp <= 0x0903) ||
    (cp >= 0x093A && cp <= 0x093C) || (cp >= 0x0941 && cp <= 0x0948) || cp === 0x094D || (cp >= 0x0951 && cp <= 0x0957) || (cp >= 0x0962 && cp <= 0x0963) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE20 && cp <= 0xFE2F) ||
    cp === 0x20E3;
}

function splitGraphemesFallback(text) {
  const result = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    let cp = text.codePointAt(index);
    let character = String.fromCodePoint(cp);
    index += character.length;
    if (isRegionalIndicator(cp) && index < text.length) {
      const secondCp = text.codePointAt(index);
      if (isRegionalIndicator(secondCp)) {
        const second = String.fromCodePoint(secondCp);
        index += second.length;
      }
    }
    while (index < text.length) {
      cp = text.codePointAt(index);
      if (isCombiningMark(cp) || isVariationSelector(cp) || isEmojiModifier(cp) || isTagCharacter(cp)) {
        character = String.fromCodePoint(cp);
        index += character.length;
        continue;
      }
      if (cp === 0x200D) {
        character = String.fromCodePoint(cp);
        index += character.length;
        if (index < text.length) {
          cp = text.codePointAt(index);
          character = String.fromCodePoint(cp);
          index += character.length;
        }
        continue;
      }
      break;
    }
    result.push(text.slice(start, index));
  }
  return result;
}

function splitGraphemes(text) {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), function (part) { return part.segment; });
  }
  return splitGraphemesFallback(text);
}

function isSingleGrapheme(value) {
  return typeof value === 'string' && value.length > 0 && splitGraphemes(value).length === 1;
}

function removeLastGrapheme(text) {
  if (!text) return '';
  const parts = splitGraphemes(text);
  if (!parts.length) return '';
  parts.pop();
  return parts.join('');
}

function validateSettings(value) {
  if (!isPlainObject(value)) throw publicError('INVALID_SETTINGS');
  if (value.schemaVersion !== 1) throw publicError('INVALID_SETTINGS');
  if (LOCALE_IDS.indexOf(value.uiLocale) === -1) throw publicError('INVALID_SETTINGS');
  if (LOCALE_IDS.indexOf(value.keyboardLayoutId) === -1) throw publicError('INVALID_SETTINGS');
  return {schemaVersion:1,uiLocale:value.uiLocale,keyboardLayoutId:value.keyboardLayoutId};
}

function validateLocaleData(value, id) {
  if (!isPlainObject(value)) throw publicError('INVALID_LOCALE');
  const keys = Object.keys(value);
  if (keys.length !== LOCALE_KEYS.length) throw publicError('INVALID_LOCALE');
  for (const key of LOCALE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw publicError('INVALID_LOCALE');
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) throw publicError('INVALID_LOCALE');
  }
  for (const key of keys) {
    if (LOCALE_KEYS.indexOf(key) === -1) throw publicError('INVALID_LOCALE');
  }
  if (LOCALE_IDS.indexOf(id) === -1) throw publicError('INVALID_LOCALE');
  const copy = {};
  for (const key of LOCALE_KEYS) copy[key] = value[key];
  return Object.freeze(copy);
}

function validateLayoutData(value, expectedId) {
  if (!isPlainObject(value)) throw publicError('INVALID_LAYOUT');
  const keys = Object.keys(value);
  if (keys.length !== 3 || keys.indexOf('id') === -1 || keys.indexOf('name') === -1 || keys.indexOf('letters') === -1) throw publicError('INVALID_LAYOUT');
  if (typeof value.id !== 'string' || value.id !== expectedId || LOCALE_IDS.indexOf(value.id) === -1) throw publicError('INVALID_LAYOUT');
  if (typeof value.name !== 'string' || value.name.trim().length === 0) throw publicError('INVALID_LAYOUT');
  if (!Array.isArray(value.letters) || value.letters.length === 0) throw publicError('INVALID_LAYOUT');
  const seen = new Set();
  const letters = [];
  for (const letter of value.letters) {
    if (typeof letter !== 'string' || letter.trim().length === 0) throw publicError('INVALID_LAYOUT');
    if (!isSingleGrapheme(letter)) throw publicError('INVALID_LAYOUT');
    if (seen.has(letter)) throw publicError('INVALID_LAYOUT');
    seen.add(letter);
    letters.push(letter);
  }
  return Object.freeze({id:value.id,name:value.name,letters:Object.freeze(letters)});
}

function readStoredSettings() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {settings:{...DEFAULT_SETTINGS},issue:true};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {settings:{...DEFAULT_SETTINGS},issue:false};
    const parsed = JSON.parse(raw);
    return {settings:validateSettings(parsed),issue:false};
  } catch (error) {
    return {settings:{...DEFAULT_SETTINGS},issue:true};
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {credentials:'same-origin',headers:{Accept:'application/json'}});
  if (!response.ok) throw publicError('RESOURCE_ERROR');
  const text = await response.text();
  if (text.length > 250000) throw publicError('RESOURCE_ERROR');
  return JSON.parse(text);
}



function loadLocale(id) {
  if (LOCALE_IDS.indexOf(id) === -1) return Promise.reject(publicError('INVALID_ARGUMENT'));
  if (localeCache.has(id)) return localeCache.get(id);
  const url = new URL('../locales/' + id + '.json', import.meta.url);
  const promise = fetchJson(url).then(function (data) {
    return validateLocaleData(data, id);
  }).catch(function (error) {
    localeCache.delete(id);
    throw error;
  });
  localeCache.set(id, promise);
  return promise;
}

function loadLayout(id) {
  if (LOCALE_IDS.indexOf(id) === -1) return Promise.reject(publicError('INVALID_ARGUMENT'));
  if (layoutCache.has(id)) return layoutCache.get(id);
  const url = new URL('../layouts/' + id + '.json', import.meta.url);
  const promise = fetchJson(url).then(function (data) {
    return validateLayoutData(data, id);
  }).catch(function (error) {
    layoutCache.delete(id);
    throw error;
  });
  layoutCache.set(id, promise);
  return promise;
}

function cacheDom() {
  dom.app = document.getElementById('app');
  dom.textBar = document.querySelector('.text-bar');
  dom.textOutput = document.getElementById('textOutput');
  if (dom.textOutput) {
    // A real flex child preserves a string made only of spaces. Anonymous
    // whitespace would disappear, leaving the visual caret in the old place.
    dom.textValue = document.createElement('span');
    dom.textValue.className = 'text-value';
    dom.textOutput.replaceChildren(dom.textValue);
  }
  dom.backspaceButton = document.getElementById('backspaceButton');
  dom.clearButton = document.getElementById('clearButton');
  dom.settingsButton = document.getElementById('settingsButton');
  dom.keyboardArea = document.getElementById('keyboardArea');
  dom.numbersKeyboard = document.getElementById('numbersKeyboard');
  dom.lettersKeyboard = document.getElementById('lettersKeyboard');
  dom.upperSpaceButton = document.getElementById('upperSpaceButton');
  dom.spaceButton = document.getElementById('spaceButton');
  dom.appStatus = document.getElementById('appStatus');
  dom.settingsDialog = document.getElementById('settingsDialog');
  dom.settingsTitle = document.getElementById('settingsTitle');
  dom.closeSettings = document.getElementById('closeSettings');
  dom.uiLanguageLabel = document.getElementById('uiLanguageLabel');
  dom.uiLocale = document.getElementById('uiLocale');
  dom.keyboardLayoutLabel = document.getElementById('keyboardLayoutLabel');
  dom.keyboardLayoutId = document.getElementById('keyboardLayoutId');
  dom.settingsStatus = document.getElementById('settingsStatus');
  dom.bridgeTitle = document.getElementById('bridgeTitle');
  dom.bridgeCodeLabel = document.getElementById('bridgeCodeLabel');
  dom.bridgeCode = document.getElementById('bridgeCode');
  dom.bridgeConnect = document.getElementById('bridgeConnect');
  dom.bridgeDisconnect = document.getElementById('bridgeDisconnect');
  dom.bridgeStatus = document.getElementById('bridgeStatus');
  dom.bridgeHelp = document.getElementById('bridgeHelp');
  dom.licenseTitle = document.getElementById('licenseTitle');
  dom.licenseNotice = document.getElementById('licenseNotice');
  dom.licenseLink = document.getElementById('licenseLink');
  if (dom.backspaceButton) dom.backspaceButton.dataset.actionId = 'backspace';
  if (dom.clearButton) dom.clearButton.dataset.actionId = 'clear';
  if (dom.spaceButton) dom.spaceButton.dataset.actionId = 'space';
  if (dom.upperSpaceButton) dom.upperSpaceButton.dataset.actionId = 'space:upper';
  if (dom.settingsButton) dom.settingsButton.dataset.actionId = 'settings';
}

function buildOptions() {
  if (dom.uiLocale) {
    dom.uiLocale.replaceChildren();
    for (const id of LOCALE_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = NATIVE_NAMES[id];
      dom.uiLocale.appendChild(option);
    }
  }
  if (dom.keyboardLayoutId) {
    dom.keyboardLayoutId.replaceChildren();
    for (const id of LOCALE_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = NATIVE_NAMES[id];
      dom.keyboardLayoutId.appendChild(option);
    }
  }
}

function renderSettingsValues() {
  if (dom.uiLocale) dom.uiLocale.value = state.settings.uiLocale;
  if (dom.keyboardLayoutId) dom.keyboardLayoutId.value = state.settings.keyboardLayoutId;
}

function renderText() {
  if (!dom.textOutput) return;
  dom.textValue.textContent = state.text;
  dom.textOutput.classList.toggle('empty', state.text.length === 0);
  requestAnimationFrame(function () {
    if (dom.textOutput) dom.textOutput.scrollLeft = dom.textOutput.scrollWidth;
  });
}

function createKeyButton(text, actionId, className, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key ' + className;
  button.dataset.actionId = actionId;
  button.textContent = text;
  button.title = ariaLabel || text;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}

function renderKeyboard() {
  if (dom.numbersKeyboard) dom.numbersKeyboard.replaceChildren();
  if (dom.lettersKeyboard) dom.lettersKeyboard.replaceChildren();
  if (!activeLayout) return;
  const t = activeLocale;
  const numberLabel = t ? t.numbers : 'Numbers';
  const letterLabel = t ? t.letters : 'Letters';
  if (dom.numbersKeyboard) {
    const numberFragment = document.createDocumentFragment();
    for (const digit of '1234567890') {
      numberFragment.appendChild(createKeyButton(digit, 'digit:' + digit, 'number-key', numberLabel + ': ' + digit));
    }
    dom.numbersKeyboard.appendChild(numberFragment);
  }
  if (dom.lettersKeyboard) {
    dom.lettersKeyboard.style.setProperty('--letter-rows', String(Math.ceil((activeLayout.letters.length + 2) / 6)));
    const letterFragment = document.createDocumentFragment();
    activeLayout.letters.forEach(function (letter, index) {
      letterFragment.appendChild(createKeyButton(letter, 'letter:' + index, 'letter-key', letterLabel + ': ' + letter));
    });
    letterFragment.appendChild(createKeyButton('.', 'period', 'letter-key punctuation-key', '.'));
    letterFragment.appendChild(createKeyButton(',', 'comma', 'letter-key punctuation-key', ','));
    dom.lettersKeyboard.appendChild(letterFragment);
  }
}

function renderStaticText() {
  if (!activeLocale) return;
  const t = activeLocale;
  document.title = t.title;
  document.documentElement.lang = state.settings.uiLocale;
  if (dom.textBar) dom.textBar.setAttribute('aria-label', t.textRegion);
  if (dom.textOutput) {
    dom.textOutput.dataset.placeholder = t.placeholder;
    dom.textOutput.setAttribute('aria-label', t.textRegion);
  }
  if (dom.backspaceButton) {
    dom.backspaceButton.textContent = '⌫';
    dom.backspaceButton.setAttribute('aria-label', t.backspace);
    dom.backspaceButton.title = t.backspace;
  }
  if (dom.clearButton) {
    dom.clearButton.textContent = t.clear;
    dom.clearButton.setAttribute('aria-label', t.clear);
    dom.clearButton.title = t.clear;
  }
  if (dom.settingsButton) {
    // Static SVG keeps the settings control sharp at every patient zoom level.
    dom.settingsButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3.4-1.2 1.8V12l1.2 1.8-2 3.4-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3.4L4.2 12V9l-1.2-1.8L5 3.8l2 .2Z"/><circle cx="12" cy="10.5" r="3"/></svg>';
    dom.settingsButton.setAttribute('aria-label', t.settings);
    dom.settingsButton.title = t.settings;
  }
  if (dom.keyboardArea) dom.keyboardArea.setAttribute('aria-label', t.keyboard);
  if (dom.numbersKeyboard) dom.numbersKeyboard.setAttribute('aria-label', t.numbers);
  if (dom.lettersKeyboard) dom.lettersKeyboard.setAttribute('aria-label', t.letters);
  if (dom.spaceButton) {
    dom.spaceButton.textContent = t.space;
    dom.spaceButton.setAttribute('aria-label', t.space);
    dom.spaceButton.title = t.space;
  }
  if (dom.upperSpaceButton) {
    dom.upperSpaceButton.textContent = t.space;
    dom.upperSpaceButton.setAttribute('aria-label', t.space);
    dom.upperSpaceButton.title = t.space;
  }
  if (dom.settingsTitle) dom.settingsTitle.textContent = t.settings;
  if (dom.closeSettings) {
    dom.closeSettings.textContent = '×';
    dom.closeSettings.setAttribute('aria-label', t.close);
    dom.closeSettings.title = t.close;
  }
  if (dom.uiLanguageLabel) dom.uiLanguageLabel.textContent = t.uiLanguage;
  if (dom.keyboardLayoutLabel) dom.keyboardLayoutLabel.textContent = t.keyboardLayout;
  if (dom.uiLocale) dom.uiLocale.setAttribute('aria-label', t.uiLanguage);
  if (dom.keyboardLayoutId) dom.keyboardLayoutId.setAttribute('aria-label', t.keyboardLayout);
  if (dom.bridgeTitle) dom.bridgeTitle.textContent = t.bridgeTitle;
  if (dom.bridgeHelp) dom.bridgeHelp.textContent = t.bridgeHelp;
  if (dom.bridgeCodeLabel) dom.bridgeCodeLabel.textContent = t.bridgeCode;
  if (dom.bridgeCode) dom.bridgeCode.setAttribute('aria-label', t.bridgeCode);
  if (dom.bridgeConnect) {
    dom.bridgeConnect.textContent = t.bridgeConnect;
    dom.bridgeConnect.setAttribute('aria-label', t.bridgeConnect);
  }
  if (dom.bridgeDisconnect) {
    dom.bridgeDisconnect.textContent = t.bridgeDisconnect;
    dom.bridgeDisconnect.setAttribute('aria-label', t.bridgeDisconnect);
  }
  if (dom.bridgeStatus && dom.bridgeStatus.textContent.trim().length === 0) {
    dom.bridgeStatus.textContent = t.bridgeDisconnected;
  }
  if (dom.licenseTitle) dom.licenseTitle.textContent = t.licenseTitle;
  if (dom.licenseNotice) dom.licenseNotice.textContent = t.licenseNotice;
  if (dom.licenseLink) dom.licenseLink.textContent = t.licenseLink;
}

function renderStatus() {
  const t = activeLocale;
  const resourceMessage = resourceErrorActive ? (t ? t.resourceError : 'Resource error') : '';
  const storageMessage = storageErrorActive ? (t ? t.storageError : 'Settings storage error') : '';
  if (dom.appStatus) {
    dom.appStatus.textContent = resourceMessage || storageMessage;
    dom.appStatus.hidden = !(resourceMessage || storageMessage);
  }
  if (dom.settingsStatus) {
    dom.settingsStatus.textContent = storageMessage || resourceMessage;
    dom.settingsStatus.hidden = !(storageMessage || resourceMessage);
  }
}

function findActionElement(id, surface) {
  const root = surface === 'settings' ? dom.settingsDialog : dom.app;
  if (!root) return null;
  const nodes = root.querySelectorAll('[data-action-id]');
  for (const node of nodes) {
    if (node.dataset.actionId === id) return node;
  }
  return null;
}

function applySelection() {
  const roots = [dom.app, dom.settingsDialog].filter(Boolean);
  const activeRoot = state.activeSurface === 'settings' ? dom.settingsDialog : dom.app;
  for (const root of roots) {
    const nodes = root.querySelectorAll('[data-action-id]');
    for (const node of nodes) {
      const selected = root === activeRoot && node.dataset.actionId === state.selectedId;
      node.classList.toggle('selected', selected);
      if (selected) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    }
  }
}

function focusTarget(id, surface) {
  const element = findActionElement(id, surface || state.activeSurface);
  if (element && typeof element.focus === 'function') {
    try {
      element.focus({preventScroll:true});
    } catch (error) {
      element.focus();
    }
  }
}

function collectTargets(surface) {
  const activeSurface = surface || state.activeSurface;
  const root = activeSurface === 'settings' ? dom.settingsDialog : dom.app;
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const nodes = root.querySelectorAll('[data-action-id]');
  for (const node of nodes) {
    if (!node.dataset || !node.dataset.actionId) continue;
    if (seen.has(node.dataset.actionId)) continue;
    if (node.hidden || node.disabled) continue;
    if (node.closest('[hidden]')) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    seen.add(node.dataset.actionId);
    result.push({
      id: node.dataset.actionId,
      x: Math.round(rect.x * 1000) / 1000,
      y: Math.round(rect.y * 1000) / 1000,
      width: Math.round(rect.width * 1000) / 1000,
      height: Math.round(rect.height * 1000) / 1000
    });
  }
  return result;
}

function invalidatePendingActivation() {
  activationEpoch += 1;
}

function syncGeometry(force) {
  const targets = collectTargets();
  const signature = JSON.stringify(targets);
  if (force || signature !== lastTargetsSignature) {
    lastTargetsSignature = signature;
    state.geometryVersion += 1;
    invalidatePendingActivation();
  }
  return targets;
}

function ensureSelection() {
  const targets = collectTargets();
  let found = false;
  for (const target of targets) {
    if (target.id === state.selectedId) {
      found = true;
      break;
    }
  }
  if (!found) {
    let preferred = state.activeSurface === 'keyboard' ? 'letter:0' : 'closeSettings';
    let hasPreferred = false;
    for (const target of targets) {
      if (target.id === preferred) {
        hasPreferred = true;
        break;
      }
    }
    if (!hasPreferred) preferred = targets.length ? targets[0].id : null;
    state.selectedId = preferred;
  }
  if (state.spaceOrigin && (!found || !isSpaceId(state.selectedId))) state.spaceOrigin = null;
  if (state.activeSurface === 'keyboard' && state.selectedId) lastKeyboardSelection = state.selectedId;
  applySelection();
}

function renderAll(forceGeometry) {
  renderStaticText();
  renderSettingsValues();
  renderKeyboard();
  renderText();
  ensureSelection();
  syncGeometry(forceGeometry === true);
  renderStatus();
}

function getStateSnapshot() {
  const targets = syncGeometry(false);
  return cloneJson({
    text: state.text,
    textRevision: state.textRevision,
    settings: {...state.settings},
    activeSurface: state.activeSurface,
    selectedId: state.selectedId,
    geometryVersion: state.geometryVersion,
    inputSettings: getInputSettings(),
    diagnostics: state.diagnostics,
    tracking: trackingService ? trackingService.getStatus() : null,
    trackingSettings: getTrackingSettings(),
    targets: targets
  });
}

function recordDiagnostic(action, result) {
  state.diagnostics.push({time:Date.now(),action:action,result:result});
  if (state.diagnostics.length > MAX_DIAGNOSTICS) {
    state.diagnostics.splice(0, state.diagnostics.length - MAX_DIAGNOSTICS);
  }
}

function normalizeError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') return error;
  return publicError('INTERNAL_ERROR', 'Command failed');
}

function validateCommandEnvelope(name, args) {
  const spec = Object.hasOwn(COMMAND_SPECS, name) ? COMMAND_SPECS[name] : null;
  if (!spec) throw publicError('INVALID_COMMAND');
  if (!isPlainObject(args)) throw publicError('INVALID_ARGUMENT');
  for (const key of Object.keys(args)) {
    if (spec.keys.indexOf(key) === -1) throw publicError('INVALID_ARGUMENT');
  }
  if (spec.requestId) {
    if (typeof args.requestId !== 'string' || args.requestId.trim().length === 0 || args.requestId.length > 128) {
      throw publicError('INVALID_ARGUMENT');
    }
  }
  if (name === 'keyboard.select') {
    if (typeof args.id !== 'string' || args.id.length === 0 || args.id.length > 100) throw publicError('INVALID_ARGUMENT');
  }
  if (name === 'keyboard.move') {
    if (!['up','down','left','right'].includes(args.direction)) throw publicError('INVALID_ARGUMENT');
    if (Object.hasOwn(args, 'steps') && (!Number.isInteger(args.steps) || args.steps < 1 || args.steps > 2)) throw publicError('INVALID_ARGUMENT');
  }
  if ((name === 'keyboard.activate' || name === 'keyboard.backspace') && (args.expectedId !== undefined || args.geometryVersion !== undefined)) {
    if (typeof args.expectedId !== 'string' || !args.expectedId.length || args.expectedId.length > 100 ||
        !Number.isSafeInteger(args.geometryVersion) || args.geometryVersion < 0) throw publicError('INVALID_ARGUMENT');
  }
  if ((name === 'keyboard.activate' || name === 'keyboard.backspace') && args.expectedTextRevision !== undefined) {
    if (!Number.isSafeInteger(args.expectedTextRevision) || args.expectedTextRevision < 0) throw publicError('INVALID_ARGUMENT');
  }
  if (name === 'settings.update') {
    if (args.uiLocale === undefined && args.keyboardLayoutId === undefined) throw publicError('INVALID_ARGUMENT');
    if (Object.prototype.hasOwnProperty.call(args, 'uiLocale') && (typeof args.uiLocale !== 'string' || LOCALE_IDS.indexOf(args.uiLocale) === -1)) throw publicError('INVALID_ARGUMENT');
    if (Object.prototype.hasOwnProperty.call(args, 'keyboardLayoutId') && (typeof args.keyboardLayoutId !== 'string' || LOCALE_IDS.indexOf(args.keyboardLayoutId) === -1)) throw publicError('INVALID_ARGUMENT');
  }
  if (name === 'input.settings.update') {
    const fields = ['clickSource','remoteBinding'].filter(function (key) { return Object.hasOwn(args, key); });
    if (Object.hasOwn(args, 'reset')) {
      if (args.reset !== true || fields.length) throw publicError('INVALID_ARGUMENT');
    } else if (!fields.length) {
      throw publicError('INVALID_ARGUMENT');
    }
    if (Object.hasOwn(args, 'clickSource') && (typeof args.clickSource !== 'string' || ['mouth','blink','external'].indexOf(args.clickSource) === -1)) throw publicError('INVALID_ARGUMENT');
    if (Object.hasOwn(args, 'remoteBinding')) {
      try {
        validateInputPreferences({clickSource:'mouth',remoteBinding:args.remoteBinding});
      } catch (error) {
        throw publicError('INVALID_ARGUMENT');
      }
    }
  }
}

function makeIdempotencyArgsKey(name, args) {
  const spec = COMMAND_SPECS[name];
  const picked = {name};
  for (const key of spec.idempotentKeys) {
    if (args[key] !== undefined) picked[key] = args[key];
  }
  return stableStringify(picked);
}

function storeIdempotency(key, argsKey, result) {
  idempotency.set(key, {argsKey:argsKey,result:cloneJson(result)});
  if (idempotency.size > MAX_IDEMPOTENCY) {
    const first = idempotency.keys().next().value;
    idempotency.delete(first);
  }
}

function normalizeDirection(value) {
  let direction = String(value).trim().toLowerCase();
  if (direction.indexOf('arrow') === 0) direction = direction.slice(5);
  if (direction !== 'left' && direction !== 'right' && direction !== 'up' && direction !== 'down') {
    throw publicError('INVALID_ARGUMENT');
  }
  return direction;
}

function selectTarget(id, preserveOrigin) {
  const targets = syncGeometry(false);
  let found = false;
  for (const target of targets) {
    if (target.id === id) {
      found = true;
      break;
    }
  }
  if (!found) throw publicError('UNKNOWN_TARGET');
  if (state.selectedId !== id) {
    invalidatePendingActivation();
    if (preserveOrigin !== true) state.spaceOrigin = null;
  }
  state.selectedId = id;
  if (state.activeSurface === 'keyboard') lastKeyboardSelection = id;
  applySelection();
  focusTarget(id, state.activeSurface);
  return id;
}

function findTargetById(targets, id) {
  for (const target of targets) {
    if (target.id === id) return target;
  }
  return null;
}

function getOriginProbe(targets) {
  if (!state.spaceOrigin) return null;
  const origin = findTargetById(targets, state.spaceOrigin.originId);
  if (!origin) {
    state.spaceOrigin = null;
    return null;
  }
  return getTargetCenter(origin);
}

function normalizeMoveSteps(value) {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 2) throw publicError('INVALID_ARGUMENT');
  return value;
}

function moveSelection(directionValue, stepsValue) {
  const direction = normalizeDirection(directionValue);
  const steps = normalizeMoveSteps(stepsValue);
  if (state.activeSurface !== 'keyboard') state.spaceOrigin = null;
  const targets = syncGeometry(false);
  if (!targets.length) throw publicError('UNKNOWN_TARGET');
  let current = findTargetById(targets, state.selectedId);
  if (!current) {
    current = targets[0];
    state.selectedId = current.id;
    state.spaceOrigin = null;
    applySelection();
    focusTarget(current.id, state.activeSurface);
    return current.id;
  }
  let next = current;
  for (let step = 0; step < steps; step += 1) {
    let candidate = null;
    let returnedOrigin = false;
    if (isSpaceId(next.id) && state.spaceOrigin) {
      const origin = findTargetById(targets, state.spaceOrigin.originId);
      if (!origin) {
        state.spaceOrigin = null;
      } else if (oppositeDirection(state.spaceOrigin.entryDirection) === direction) {
        candidate = origin;
        returnedOrigin = true;
      }
    }
    let probe = null;
    if (!candidate && isSpaceId(next.id) && state.spaceOrigin &&
        state.spaceOrigin.entryDirection === direction && state.spaceOrigin.originId !== next.id) {
      probe = getOriginProbe(targets);
    }
    if (!candidate) candidate = pickMoveTarget(next, targets, direction, probe);
    if (!candidate) break;
    const previous = next;
    next = candidate;
    if (isSpaceId(next.id) && !isSpaceId(previous.id)) {
      state.spaceOrigin = {originId:previous.id, entryDirection:direction};
    } else if (!isSpaceId(next.id) && isSpaceId(previous.id)) {
      state.spaceOrigin = null;
    }
    if (returnedOrigin) {
      state.spaceOrigin = null;
      break;
    }
  }
  if (next.id !== state.selectedId) return selectTarget(next.id, true);
  return state.selectedId;
}

function appendCharacter(character) {
  state.text += character;
  state.textRevision += 1;
  renderText();
}

function backspaceText() {
  if (state.activeSurface === 'settings') throw publicError('MODAL_BLOCKED');
  const next = removeLastGrapheme(state.text);
  if (next !== state.text) {
    state.text = next;
    state.textRevision += 1;
    renderText();
  }
  return {ok:true};
}

function clearText() {
  if (state.activeSurface === 'settings') throw publicError('MODAL_BLOCKED');
  if (state.text) {
    state.text = '';
    state.textRevision += 1;
    renderText();
  }
  return {ok:true};
}

function getTextForAction(id) {
  if (id.indexOf('letter:') === 0) {
    const index = Number(id.slice('letter:'.length));
    if (!Number.isInteger(index) || index < 0 || !activeLayout || index >= activeLayout.letters.length) throw publicError('UNKNOWN_TARGET');
    return activeLayout.letters[index];
  }
  if (id.indexOf('digit:') === 0) {
    const digit = id.slice('digit:'.length);
    if (digit.length !== 1 || digit < '0' || digit > '9') throw publicError('UNKNOWN_TARGET');
    return digit;
  }
  if (id === 'period') return '.';
  if (id === 'comma') return ',';
  if (id === 'space' || id === 'space:upper') return ' ';
  return null;
}

function openSettings() {
  if (!dom.settingsDialog) throw publicError('INTERNAL_ERROR');
  if (state.activeSurface === 'settings') {
    return {activeSurface:state.activeSurface,selectedId:state.selectedId};
  }
  if (state.activeSurface === 'keyboard' && state.selectedId && state.selectedId !== 'settings') {
    lastKeyboardSelection = state.selectedId;
  }
  invalidatePendingActivation();
  state.spaceOrigin = null;
  state.activeSurface = 'settings';
  if (!dom.settingsDialog.open) {
    if (typeof dom.settingsDialog.showModal === 'function') {
      try {
        dom.settingsDialog.showModal();
      } catch (error) {
        dom.settingsDialog.setAttribute('open', '');
      }
    } else {
      dom.settingsDialog.setAttribute('open', '');
    }
  }
  const targets = collectTargets('settings');
  let preferred = 'uiLocale';
  let hasPreferred = false;
  for (const target of targets) {
    if (target.id === preferred) {
      hasPreferred = true;
      break;
    }
  }
  if (!hasPreferred) preferred = targets.length ? targets[0].id : 'closeSettings';
  state.selectedId = preferred;
  applySelection();
  focusTarget(preferred, 'settings');
  syncGeometry(false);
  return {activeSurface:state.activeSurface,selectedId:state.selectedId};
}

function closeSettings() {
  if (state.activeSurface !== 'settings') {
    return {activeSurface:state.activeSurface,selectedId:state.selectedId};
  }
  invalidatePendingActivation();
  state.spaceOrigin = null;
  state.activeSurface = 'keyboard';
  if (dom.settingsDialog && dom.settingsDialog.open) {
    if (typeof dom.settingsDialog.close === 'function') {
      dom.settingsDialog.close();
    } else {
      dom.settingsDialog.removeAttribute('open');
    }
  }
  state.selectedId = lastKeyboardSelection || 'letter:0';
  ensureSelection();
  syncGeometry(false);
  return {activeSurface:state.activeSurface,selectedId:state.selectedId};
}

function activateTarget(id) {
  const trackingActions = {trackingStart:'tracking.start', trackingStop:'tracking.stop', trackingCalibrate:'tracking.calibrate'};
  if (Object.hasOwn(trackingActions, id)) {
    return executeAction(trackingActions[id], {requestId:makeRequestId()}, {userGesture:false});
  }
  const textValue = getTextForAction(id);
  if (textValue !== null) {
    if (state.activeSurface !== 'keyboard') throw publicError('MODAL_BLOCKED');
    appendCharacter(textValue);
    return {action:'append',id:id};
  }
  if (id === 'backspace') return {action:'backspace',result:backspaceText()};
  if (id === 'clear') return {action:'clear',result:clearText()};
  if (id === 'settings') return {action:'settings',result:openSettings()};
  if (id === 'closeSettings') return {action:'closeSettings',result:closeSettings()};
  if (id === 'uiLocale' || id === 'keyboardLayoutId' || id === 'bridgeCode') {
    focusTarget(id, state.activeSurface);
    return {action:'focus',id:id};
  }
  if (id === 'bridgeConnect' || id === 'bridgeDisconnect') {
    const element = findActionElement(id, state.activeSurface);
    if (!element) throw publicError('UNKNOWN_TARGET');
    if (typeof element.click === 'function') element.click();
    else element.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    return {action:'click',id:id};
  }
  throw publicError('UNKNOWN_TARGET');
}

function activateSelected() {
  const targets = syncGeometry(false);
  let found = false;
  for (const target of targets) {
    if (target.id === state.selectedId) {
      found = true;
      break;
    }
  }
  if (!found) throw publicError('UNKNOWN_TARGET');
  return activateTarget(state.selectedId);
}

async function updateSettings(args) {
  const next = {
    schemaVersion:1,
    uiLocale: state.settings.uiLocale,
    keyboardLayoutId: state.settings.keyboardLayoutId
  };
  if (args.uiLocale !== undefined) next.uiLocale = args.uiLocale;
  if (args.keyboardLayoutId !== undefined) next.keyboardLayoutId = args.keyboardLayoutId;
  const localeChanged = next.uiLocale !== state.settings.uiLocale;
  const layoutChanged = next.keyboardLayoutId !== state.settings.keyboardLayoutId;
  if (!localeChanged && !layoutChanged) {
    renderSettingsValues();
    return {...state.settings};
  }
  let nextLocale = activeLocale;
  let nextLayout = activeLayout;
  const jobs = [];
  if (localeChanged) jobs.push(loadLocale(next.uiLocale).then(function (value) { nextLocale = value; }));
  if (layoutChanged) jobs.push(loadLayout(next.keyboardLayoutId).then(function (value) { nextLayout = value; }));
  try {
    await Promise.all(jobs);
  } catch (error) {
    resourceErrorActive = true;
    renderStatus();
    renderSettingsValues();
    throw publicError('RESOURCE_ERROR', activeLocale ? activeLocale.resourceError : 'Resource error');
  }
  validateSettings(next);
  state.settings = next;
  if (localeChanged) activeLocale = nextLocale;
  if (layoutChanged) activeLayout = nextLayout;
  if (layoutChanged) state.spaceOrigin = null;
  resourceErrorActive = false;
  renderAll(layoutChanged);
  window.dispatchEvent(new Event('keyboardlocalize'));
  persistSettings();
  renderStatus();
  return {...state.settings};
}

function persistSettings() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) throw new Error('storage unavailable');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    storageErrorActive = false;
    return true;
  } catch (error) {
    storageErrorActive = true;
    return false;
  }
}

function getDiagnostics() {
  return cloneJson(state.diagnostics);
}

function getInputSettings() {
  return {schemaVersion:1,values:{...state.inputPreferences},defaults:{...INPUT_DEFAULTS},storageIssue:state.inputStorageIssue};
}

function updateInputSettings(args) {
  const fields = ['clickSource','remoteBinding'].filter(function (key) { return Object.hasOwn(args, key); });
  if (Object.hasOwn(args, 'reset')) {
    if (args.reset !== true || fields.length) throw publicError('INVALID_ARGUMENT');
  } else if (!fields.length) {
    throw publicError('INVALID_ARGUMENT');
  }
  let values;
  try {
    values = validateInputPreferences(args.reset === true ? INPUT_DEFAULTS : {
      clickSource:Object.hasOwn(args, 'clickSource') ? args.clickSource : state.inputPreferences.clickSource,
      remoteBinding:Object.hasOwn(args, 'remoteBinding') ? args.remoteBinding : state.inputPreferences.remoteBinding
    });
  } catch (error) {
    throw publicError('INVALID_ARGUMENT');
  }
  if (values.clickSource !== state.inputPreferences.clickSource) {
    invalidatePendingActivation();
    if (trackingService && typeof trackingService.setClickSource === 'function') {
      trackingService.setClickSource(values.clickSource);
    }
  }
  state.inputPreferences = values;
  state.inputStorageIssue = !writeInputPreferences(values);
  window.dispatchEvent(new Event('keyboardinputsettings'));
  return getInputSettings();
}

function getTrackingSettings() {
  return {schemaVersion:5,values:{...state.trackingPreferences},defaults:{...TRACKING_DEFAULTS},storageIssue:state.trackingStorageIssue};
}

function updateTrackingSettings(args) {
  const fields = Object.keys(TRACKING_DEFAULTS);
  const supplied = fields.filter(key => Object.hasOwn(args,key));
  if (Object.hasOwn(args,'reset') && (args.reset !== true || supplied.length)) throw publicError('INVALID_ARGUMENT');
  if (!supplied.length && args.reset !== true) throw publicError('INVALID_ARGUMENT');
  let values;
  try {
    const patch = Object.fromEntries(supplied.map(key => [key,args[key]]));
    values = validateTrackingPreferences(args.reset === true ? TRACKING_DEFAULTS : {...state.trackingPreferences,...patch});
  } catch {
    throw publicError('INVALID_ARGUMENT');
  }
  // Cancel old physiological/queued activation before committing new sensitivity.
  // The same owner serves sliders and MCP; no parallel preferences are persisted.
  if (trackingService) trackingService.configure(values);
  invalidatePendingActivation();
  state.trackingPreferences = values;
  state.trackingStorageIssue = !writeTrackingPreferences(values);
  window.dispatchEvent(new Event('keyboardtrackingsettings'));
  return getTrackingSettings();
}

function assertSnapshotGuards(args) {
  if (args.expectedId !== undefined &&
      (args.expectedId !== state.selectedId || args.geometryVersion !== state.geometryVersion)) throw publicError('STALE_TARGET');
  if (args.expectedTextRevision !== undefined && args.expectedTextRevision !== state.textRevision) throw publicError('STALE_TEXT');
}

async function executeAction(name, args, context = {}) {
  if (name === 'input.settings.get') return getInputSettings();
  if (name === 'input.settings.update') return updateInputSettings(args);
  if (name === 'tracking.settings.get') return getTrackingSettings();
  if (name === 'tracking.settings.update') return updateTrackingSettings(args);
  if (name.startsWith('tracking.')) {
    if (!trackingService) throw publicError('TRACKING_UNAVAILABLE');
    if (name === 'tracking.getStatus') return trackingService.getStatus();
    // CRITICAL: pairing authorizes control, never local camera consent. JSON
    // callers cannot supply a native trusted event; the camera remains off.
    if (name === 'tracking.start' && !context.userGesture) throw publicError('LOCAL_CAMERA_CONSENT');
    if (name === 'tracking.calibrate' && !trackingService.getStatus().engine.running) throw publicError('NOT_RUNNING');
    const operation = trackingService.handle(name, args, context);
    if (name === 'tracking.calibrate') return operation;
    // Permission/model startup must not hold the queue and freeze touch input.
    Promise.resolve(operation).catch(error => recordDiagnostic(name, normalizeError(error).code));
    return {accepted:true, status:trackingService.getStatus()};
  }
  if (name === 'keyboard.getState') return getStateSnapshot();
  if (name === 'keyboard.select') return selectTarget(args.id);
  if (name === 'keyboard.move') return moveSelection(args.direction, args.steps);
  if (name === 'keyboard.activate') {
    syncGeometry(false);
    assertSnapshotGuards(args);
    return activateSelected();
  }
  if (name === 'keyboard.backspace') {
    if (args.expectedId !== undefined || args.geometryVersion !== undefined || args.expectedTextRevision !== undefined) {
      syncGeometry(false);
      assertSnapshotGuards(args);
    }
    return backspaceText();
  }
  if (name === 'keyboard.clear') return clearText();
  if (name === 'settings.get') return {...state.settings};
  if (name === 'settings.update') return updateSettings(args);
  if (name === 'settings.open') return openSettings();
  if (name === 'settings.close') return closeSettings();
  if (name === 'diagnostics.get') return getDiagnostics();
  throw publicError('INVALID_COMMAND');
}

async function dispatchInternal(name, args, context) {
  try {
    validateCommandEnvelope(name, args);
    const spec = COMMAND_SPECS[name];
    let idempotencyKey = null;
    let idempotencyArgs = null;
    if (spec.requestId) {
      idempotencyKey = args.requestId;
      idempotencyArgs = makeIdempotencyArgsKey(name, args);
      const existing = idempotency.get(idempotencyKey);
      if (existing) {
        if (existing.argsKey !== idempotencyArgs) throw publicError('IDEMPOTENCY_CONFLICT');
        recordDiagnostic(name, 'ok');
        return cloneJson(existing.result);
      }
    }
    const guardedBackspace = name === 'keyboard.backspace' &&
      (args.expectedId !== undefined || args.geometryVersion !== undefined || args.expectedTextRevision !== undefined);
    if ((name === 'keyboard.activate' || guardedBackspace) && context && context.activationEpochAtCall !== activationEpoch) {
      throw publicError('ACTIVATION_INVALIDATED');
    }
    const result = await executeAction(name, args, context);
    if (spec.requestId) storeIdempotency(idempotencyKey, idempotencyArgs, result);
    recordDiagnostic(name, 'ok');
    return cloneJson(result);
  } catch (error) {
    const normalized = normalizeError(error);
    recordDiagnostic(Object.hasOwn(COMMAND_SPECS, name) ? name : 'invalid', normalized.code || 'error');
    throw normalized;
  }
}

function dispatchCommand(name, args, event) {
  const actualArgs = args === undefined ? {} : args;
  const activationEpochAtCall = activationEpoch;
  const run = function () {
    return dispatchInternal(name, actualArgs, {
      activationEpochAtCall:activationEpochAtCall,
      userGesture: event instanceof Event && event.isTrusted && event.type === 'click'
    });
  };
  const result = commandQueue.then(run, run);
  commandQueue = result.catch(function () {});
  return result;
}

async function importInputUi() {
  try {
    const modules = await Promise.all([
      import('./input-panel.js'),
      import('./external-click.js')
    ]);
    const panelModule = modules[0];
    const externalModule = modules[1];
    if (panelModule && typeof panelModule.initInputPanel === 'function') {
      panelModule.initInputPanel(app);
    }
    if (externalModule && typeof externalModule.initExternalClick === 'function') {
      externalModule.initExternalClick(app);
    }
  } catch (error) {
    recordDiagnostic('input.ui.load', 'INPUT_UI_UNAVAILABLE');
  }
}

async function importBridge() {
  try {
    const bridgeModule = await import('./bridge-client.js');
    if (!bridgeModule || typeof bridgeModule.initBridge !== 'function') {
      setBridgeStatus(activeLocale ? activeLocale.bridgeError : 'Bridge unavailable');
      return;
    }
    await bridgeModule.initBridge(app);
  } catch (error) {
    setBridgeStatus(activeLocale ? activeLocale.bridgeError : 'Bridge unavailable');
  }
}

async function importTracking() {
  try {
    const module = await import('./tracking/panel.js');
    trackingService = module.createTrackingPanel(app);
    dom.app.style.gridTemplateRows = 'var(--text-bar-height) auto minmax(0, 1fr) auto';
    syncGeometry(true);
  } catch (error) {
    recordDiagnostic('tracking.load', 'TRACKING_UNAVAILABLE');
  }
}

function setBridgeStatus(message) {
  if (dom.bridgeStatus) dom.bridgeStatus.textContent = message;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = function () {
    try {
      const scriptUrl = new URL('../service-worker.js', import.meta.url);
      const scopeUrl = new URL('../', import.meta.url);
      navigator.serviceWorker.register(scriptUrl, {scope:scopeUrl.pathname}).catch(function () {
        recordDiagnostic('offline.install', 'RESOURCE_ERROR');
        resourceErrorActive = true;
        renderStatus();
      });
    } catch (error) {
      recordDiagnostic('offline.install', 'RESOURCE_ERROR');
    }
  };
  // The module fetches settings before boot completes; load may already be over.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, {once:true});
}

function handleUiError(error) {
  if (!error) return;
  if (error.code === 'RESOURCE_ERROR') {
    resourceErrorActive = true;
    renderStatus();
  }
  if (error.code === 'STORAGE_ERROR') {
    storageErrorActive = true;
    renderStatus();
  }
  renderSettingsValues();
}

async function handleUiAction(id) {
  try {
      await app.dispatch('keyboard.select', {id:id,requestId:makeRequestId()});
    await app.dispatch('keyboard.activate', {requestId:makeRequestId()});
  } catch (error) {
    handleUiError(error);
  }
}

function bindEvents() {
  // A native modal blocks background actions; explicitly wrap keyboard focus too.
  dom.settingsDialog.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    const controls = [...dom.settingsDialog.querySelectorAll('button,select,input,a[href],[tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dom.settingsDialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dom.settingsDialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  if (dom.settingsDialog) {
    dom.settingsDialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      app.dispatch('settings.close', {requestId:makeRequestId()}).catch(handleUiError);
    });
    dom.settingsDialog.addEventListener('close', function () {
      if (state.activeSurface === 'settings') {
        invalidatePendingActivation();
        state.spaceOrigin = null;
        state.activeSurface = 'keyboard';
        state.selectedId = lastKeyboardSelection || 'letter:0';
        ensureSelection();
        syncGeometry(false);
      }
    });
  }
  window.addEventListener('resize', function () {
    invalidatePendingActivation();
    syncGeometry(false);
    applySelection();
  });
  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const element = target.closest('[data-action-id]');
    if (!element) return;
    const actionId = element.dataset.actionId;
    if (actionId === 'bridgeConnect' || actionId === 'bridgeDisconnect' || actionId === 'bridgeCode') return;
    if (element.matches('select, input, textarea')) return;
    if (element.tagName !== 'BUTTON') return;
    event.preventDefault();
    handleUiAction(actionId);
  });
  document.addEventListener('change', function (event) {
    const element = event.target;
    if (!element || !element.id) return;
    if (element.id === 'uiLocale') {
      app.dispatch('settings.update', {uiLocale:element.value,requestId:makeRequestId()}).catch(handleUiError);
    } else if (element.id === 'keyboardLayoutId') {
      app.dispatch('settings.update', {keyboardLayoutId:element.value,requestId:makeRequestId()}).catch(handleUiError);
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.matches('input, select, textarea') || target.isContentEditable)) return;
    const directions = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
      app.dispatch('keyboard.move', {direction:direction,requestId:makeRequestId()}).catch(handleUiError);
  });
}

async function boot() {
  cacheDom();
  const trackingPreferences = readTrackingPreferences();
  state.trackingPreferences = trackingPreferences.values;
  state.trackingStorageIssue = trackingPreferences.storageIssue;
  const inputPreferences = readInputPreferences();
  state.inputPreferences = inputPreferences.values;
  state.inputStorageIssue = inputPreferences.storageIssue;
  buildOptions();
  bindEvents();
  const stored = readStoredSettings();
  state.settings = stored.settings;
  if (stored.issue) storageErrorActive = true;
  let locale = null;
  let layout = null;
  let resourceFailed = false;
  try {
    locale = await loadLocale(state.settings.uiLocale);
  } catch (error) {
    resourceFailed = true;
  }
  try {
    layout = await loadLayout(state.settings.keyboardLayoutId);
  } catch (error) {
    resourceFailed = true;
  }
  activeLocale = locale;
  activeLayout = layout;
  if (resourceFailed) resourceErrorActive = true;
  renderAll(true);
  await importInputUi();
  requestAnimationFrame(function () {
    importBridge();
  });
  registerServiceWorker();
}

export const app = {
  translate: function (key) {
    return activeLocale && Object.hasOwn(activeLocale, key) ? activeLocale[key] : '';
  },
  dispatch: function (name, args, event) {
    return dispatchCommand(name, args, event);
  },
  getState: function () {
    return getStateSnapshot();
  }
};

if (typeof window !== 'undefined') window.keyboardApp = app;

boot().then(function () { void importTracking(); }).catch(function () {
  try {
    cacheDom();
    resourceErrorActive = true;
    renderStatus();
  } catch (error) {}
});
