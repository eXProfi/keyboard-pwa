import {validateInputPreferences} from './input-preferences.js';

const STYLE_ID = 'input-mode-style';
const STYLE_TEXT = `
  .input-mode-panel {
    display: grid;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #ffffff;
    color: var(--text);
  }
  .input-mode-panel legend {
    padding: 0 4px;
    font: 700 17px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .input-mode-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    min-width: 0;
  }
  .input-mode-option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font: 600 15px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
    cursor: pointer;
    touch-action: manipulation;
  }
  .input-mode-option input {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: #0a84ff;
  }
  .input-mode-option input:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  .input-mode-help {
    margin: 0;
    color: #3a3a3c;
    font: 500 13px/1.3 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .input-binding-panel {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .input-binding-current {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .input-binding-label {
    font-weight: 700;
  }
  .input-binding-value {
    font: 700 15px/1.3 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .input-binding-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .input-binding-actions button {
    min-width: 44px;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--control-bg);
    color: var(--text);
    font: 700 15px/1.2 Arial, sans-serif;
    cursor: pointer;
    touch-action: manipulation;
    overflow-wrap: anywhere;
  }
  .input-binding-actions button:disabled {
    opacity: .55;
    cursor: default;
  }
  .input-binding-actions button:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  .input-binding-status {
    min-height: 1.2em;
    margin: 0;
    color: #3a3a3c;
    font: 600 13px/1.3 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .input-binding-status[data-tone='warning'] {
    color: #8a5a00;
  }
  .input-binding-status[data-tone='error'] {
    color: #b00020;
  }
  .input-head-panel {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #ffffff;
    color: var(--text);
  }
  .input-head-panel legend {
    padding: 0 4px;
    font: 700 17px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .input-head-option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font: 600 15px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
    cursor: pointer;
    touch-action: manipulation;
  }
  .input-head-option input {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: #0a84ff;
  }
  .input-head-option input:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  @media (max-width: 700px) {
    .input-mode-options,
    .input-binding-actions {
      grid-template-columns: 1fr;
    }
  }
`;

let instanceCounter = 0;
let requestSerial = 0;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT;
}

function nextRequestId() {
  requestSerial += 1;
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch (error) {}
  return 'input-ui-' + Date.now().toString(36) + '-' + requestSerial.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function hasModifiers(event) {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph'));
}

function isComposing(event) {
  return event.isComposing || event.keyCode === 229;
}

export function initInputPanel(app) {
  const dialog = document.getElementById('settingsDialog');
  const body = dialog ? dialog.querySelector('.settings-body') : null;
  const bridgePanel = body ? body.querySelector('.bridge-panel') : null;
  if (!dialog || !body || !bridgePanel) return null;
  if (document.getElementById('inputModePanel')) return null;
  ensureStyle();
  const instanceId = 'input-mode-' + (++instanceCounter);
  const radioName = instanceId + '-source';
  const panel = document.createElement('fieldset');
  panel.id = 'inputModePanel';
  panel.className = 'input-mode-panel';
  const legend = document.createElement('legend');
  legend.id = instanceId + '-legend';
  panel.append(legend);
  const options = document.createElement('div');
  options.className = 'input-mode-options';
  const radios = new Map();
  const modeLabels = new Map();
  for (const value of ['mouth', 'blink', 'external']) {
    const label = document.createElement('label');
    label.className = 'input-mode-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = radioName;
    input.value = value;
    const labelText = document.createElement('span');
    labelText.className = 'input-mode-option-label';
    label.append(input, labelText);
    options.append(label);
    radios.set(value, input);
    modeLabels.set(value, labelText);
    input.addEventListener('change', handleSourceChange);
  }
  panel.append(options);
  const help = document.createElement('p');
  help.id = instanceId + '-help';
  help.className = 'input-mode-help';
  panel.append(help);
  const externalPanel = document.createElement('div');
  externalPanel.className = 'input-binding-panel';
  externalPanel.hidden = true;
  const bindingLine = document.createElement('p');
  bindingLine.className = 'input-binding-current';
  const bindingLabel = document.createElement('span');
  bindingLabel.className = 'input-binding-label';
  const bindingValue = document.createElement('span');
  bindingValue.className = 'input-binding-value';
  bindingLine.append(bindingLabel, document.createTextNode(' '), bindingValue);
  const actions = document.createElement('div');
  actions.className = 'input-binding-actions';
  const bindButton = document.createElement('button');
  bindButton.type = 'button';
  bindButton.className = 'input-bind-button';
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'input-clear-button';
  actions.append(bindButton, clearButton);
  const status = document.createElement('p');
  status.id = instanceId + '-status';
  status.className = 'input-binding-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  externalPanel.append(bindingLine, actions, status);
  panel.append(externalPanel);
  panel.setAttribute('aria-labelledby', legend.id);
  panel.setAttribute('aria-describedby', help.id);
  bridgePanel.before(panel);

  const headPanel = document.createElement('fieldset');
  headPanel.id = 'headOptionsPanel';
  headPanel.className = 'input-head-panel';
  const headLegend = document.createElement('legend');
  headLegend.id = instanceId + '-head-legend';
  const headOption = document.createElement('label');
  headOption.className = 'input-head-option';
  const headCheckbox = document.createElement('input');
  headCheckbox.type = 'checkbox';
  headCheckbox.id = instanceId + '-double-step';
  const headLabelText = document.createElement('span');
  headLabelText.className = 'input-head-option-label';
  headOption.append(headCheckbox, headLabelText);
  const headHelp = document.createElement('p');
  headHelp.id = instanceId + '-head-help';
  headHelp.className = 'input-mode-help';
  headCheckbox.setAttribute('aria-describedby', headHelp.id);

  headPanel.append(headLegend, headOption, headHelp);
  headPanel.setAttribute('aria-labelledby', headLegend.id);
  headPanel.setAttribute('aria-describedby', headHelp.id);
  panel.after(headPanel);

  let listening = false;
  let captureTimer = null;
  let statusKey = null;
  let statusTone = '';
  let settingsIssue = false;

  // Texts live in locales/<id>.json; check rejects catalogs with missing keys.
  function strings() {
    return app.catalog('inputPanel') || {};
  }

  function headStrings() {
    return app.catalog('headPanel') || {};
  }

  function readTrackingSettings() {
    try {
      const state = app.getState();
      return state && state.trackingSettings ? state.trackingSettings : null;
    } catch (error) {
      return null;
    }
  }

  function readInputSettings() {
    try {
      const state = app.getState();
      return state && state.inputSettings ? state.inputSettings : null;
    } catch (error) {
      return null;
    }
  }

  function currentSource() {
    const settings = readInputSettings();
    return settings && settings.values && settings.values.clickSource ? settings.values.clickSource : 'mouth';
  }

  function dispatch(name, args) {
    try {
      return Promise.resolve(app.dispatch(name, args));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function setStatus(key, tone) {
    statusKey = key || null;
    statusTone = tone || '';
    renderStatus();
  }

  function renderStatus() {
    const text = strings();
    let message = '';
    let tone = '';
    if (statusKey) {
      message = text[statusKey] || '';
      tone = statusTone;
    } else if (settingsIssue) {
      message = text.storageIssue;
      tone = 'warning';
    }
    if (status.textContent !== message) status.textContent = message;
    status.hidden = message === '';
    if (tone) status.dataset.tone = tone;
    else status.removeAttribute('data-tone');
  }

  function formatBinding(binding) {
    const key = typeof binding.key === 'string' ? binding.key : '';
    const code = typeof binding.code === 'string' && binding.code ? ' · ' + binding.code : '';
    return key + code;
  }

  function render() {
    const text = strings();
    const headText = headStrings();
    const settings = readInputSettings();
    const values = settings && settings.values ? settings.values : null;
    const tracking = readTrackingSettings();
    const trackingValues = tracking && tracking.values ? tracking.values : null;
    settingsIssue = !!(settings && settings.storageIssue) || !!(tracking && tracking.storageIssue);
    legend.textContent = text.legend;
    headLegend.textContent = headText.legend;
    headLabelText.textContent = headText.doubleStep;
    headHelp.textContent = trackingValues ? headText.doubleStepHelp : headText.unavailable;
    headCheckbox.disabled = !trackingValues;
    headCheckbox.checked = trackingValues ? trackingValues.doubleStepEnabled === true : false;
    for (const value of ['mouth', 'blink', 'external']) {
      const label = modeLabels.get(value);
      if (label) label.textContent = text[value];
    }
    if (!values) {
      for (const radio of radios.values()) radio.disabled = true;
      bindButton.disabled = true;
      clearButton.disabled = true;
      externalPanel.hidden = true;
      help.textContent = text.unavailable;
      bindingLabel.textContent = text.currentBinding;
      bindingValue.textContent = text.noBinding;
      if (statusKey === null) setStatus('unavailable');
      else renderStatus();
      return;
    }
    if (statusKey === 'unavailable') statusKey = null;
    for (const [value, radio] of radios) {
      radio.disabled = false;
      radio.checked = value === values.clickSource;
    }
    help.textContent = text[values.clickSource + 'Help'] || '';
    externalPanel.hidden = values.clickSource !== 'external';
    bindButton.disabled = listening;
    clearButton.disabled = listening || !values.remoteBinding;
    bindButton.textContent = text.bind;
    clearButton.textContent = text.clearBinding;
    bindingLabel.textContent = text.currentBinding;
    bindingValue.textContent = values.remoteBinding ? formatBinding(values.remoteBinding) : text.noBinding;
    renderStatus();
  }

  function handleSourceChange(event) {
    const input = event.target;
    if (!input || input.name !== radioName || !input.checked) return;
    const settings = readInputSettings();
    if (settings && settings.values && input.value === settings.values.clickSource) {
      render();
      return;
    }
    cancelCapture(null, '');
    setStatus(null, '');
    dispatch('input.settings.update', {requestId:nextRequestId(), clickSource:input.value}).then(function (result) {
      if (result && result.storageIssue) setStatus('storageIssue', 'warning');
      else setStatus(null, '');
      render();
    }).catch(function () {
      setStatus('updateError', 'error');
      render();
    });
  }

  function handleBindClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) {
      setStatus('bindingUntrusted', 'warning');
      renderStatus();
      return;
    }
    if (listening) {
      cancelCapture('bindingCanceled', 'warning');
      return;
    }
    if (currentSource() !== 'external') {
      setStatus('bindingOnlyExternal', 'warning');
      renderStatus();
      return;
    }
    beginCapture();
  }

  function handleClearBinding(event) {
    event.preventDefault();
    event.stopPropagation();
    if (listening) cancelCapture(null, '');
    setStatus(null, '');
    dispatch('input.settings.update', {requestId:nextRequestId(), remoteBinding:null}).then(function (result) {
      if (result && result.storageIssue) setStatus('storageIssue', 'warning');
      else setStatus('bindingSaved', '');
      render();
    }).catch(function () {
      setStatus('updateError', 'error');
      render();
    });
  }

  function beginCapture() {
    if (listening) return;
    listening = true;
    document.documentElement.setAttribute('data-input-binding-capture', 'true');
    setStatus('bindingListening', '');
    if (captureTimer !== null) clearTimeout(captureTimer);
    captureTimer = window.setTimeout(function () {
      captureTimer = null;
      cancelCapture('bindingTimeout', 'warning');
    }, 10000);
    window.addEventListener('keydown', handleCaptureKeydown, true);
    window.addEventListener('blur', handleCaptureBlur, true);
    document.addEventListener('visibilitychange', handleCaptureVisibility, true);
    render();
  }

  function stopCapture() {
    if (!listening) return;
    listening = false;
    if (captureTimer !== null) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
    window.removeEventListener('keydown', handleCaptureKeydown, true);
    window.removeEventListener('blur', handleCaptureBlur, true);
    document.removeEventListener('visibilitychange', handleCaptureVisibility, true);
    document.documentElement.removeAttribute('data-input-binding-capture');
  }

  function cancelCapture(key, tone) {
    if (!listening) {
      if (key) {
        setStatus(key, tone);
        renderStatus();
      }
      return;
    }
    stopCapture();
    if (key) setStatus(key, tone || '');
    else setStatus(null, '');
    render();
  }

  function saveBinding(binding) {
    setStatus(null, '');
    render();
    dispatch('input.settings.update', {requestId:nextRequestId(), remoteBinding:binding}).then(function (result) {
      if (result && result.storageIssue) setStatus('storageIssue', 'warning');
      else setStatus('bindingSaved', '');
      render();
    }).catch(function () {
      setStatus('bindingError', 'error');
      render();
    });
  }

  function handleCaptureKeydown(event) {
    if (!event.isTrusted) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      cancelCapture('bindingCanceled', 'warning');
      return;
    }
    if (event.repeat || hasModifiers(event) || isComposing(event)) return;
    const binding = {key:event.key, code:event.code, location:event.location};
    try {
      validateInputPreferences({clickSource:'external', remoteBinding:binding});
    } catch (error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus('bindingUnsupported', 'error');
      renderStatus();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    stopCapture();
    saveBinding(binding);
  }

  function handleCaptureBlur(event) {
    // Disabling the focused bind button also emits blur. Only leaving the
    // browser window cancels capture; focus changes inside settings are safe.
    if (event.target === window) cancelCapture('bindingCanceled', 'warning');
  }

  function handleCaptureVisibility() {
    if (document.visibilityState === 'hidden') cancelCapture('bindingCanceled', 'warning');
  }

  function handleDoubleStepChange() {
    const enabled = headCheckbox.checked === true;
    setStatus(null, '');
    dispatch('tracking.settings.update', {requestId:nextRequestId(), doubleStepEnabled:enabled}).then(function (result) {
      if (result && result.storageIssue) setStatus('storageIssue', 'warning');
      else setStatus(null, '');
      render();
    }).catch(function () {
      setStatus('updateError', 'error');
      render();
    });
  }

  headCheckbox.addEventListener('change', handleDoubleStepChange);
  headCheckbox.addEventListener('pointerdown', function () {
    if (listening) cancelCapture(null, '');
  });
  headCheckbox.addEventListener('focus', function () {
    if (listening) cancelCapture(null, '');
  });
  bindButton.addEventListener('click', handleBindClick);
  clearButton.addEventListener('click', handleClearBinding);
  window.addEventListener('keyboardtrackingsettings', render);
  window.addEventListener('keyboardinputsettings', function () {
    if (listening) cancelCapture('bindingCanceled', 'warning');
    render();
  });
  window.addEventListener('keyboardlocalize', render);
  dialog.addEventListener('cancel', function () {
    if (listening) cancelCapture('bindingCanceled', 'warning');
  });
  dialog.addEventListener('close', function () {
    if (listening) cancelCapture('bindingCanceled', 'warning');
  });
  render();
  return {refresh:render};
}
