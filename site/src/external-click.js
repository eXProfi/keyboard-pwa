function hasModifiers(event) {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph'));
}

function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select')) || target.isContentEditable === true;
}

let requestSerial = 0;

function nextRequestId() {
  requestSerial += 1;
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch (error) {}
  return 'external-click-' + Date.now().toString(36) + '-' + requestSerial.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function initExternalClick(app) {
  if (!app || typeof app.dispatch !== 'function' || typeof app.getState !== 'function') {
    throw new Error('EXTERNAL_CLICK_APP_REQUIRED');
  }
  let held = null;

  function resetHeld() {
    held = null;
  }

  function currentBinding() {
    try {
      const state = app.getState();
      const input = state && state.inputSettings;
      const values = input && input.values;
      if (!values || values.clickSource !== 'external' || !values.remoteBinding) return null;
      return values.remoteBinding;
    } catch (error) {
      return null;
    }
  }

  function visibleFocusedKeyboardSurface(state) {
    if (!state || state.activeSurface !== 'keyboard') return false;
    if (document.visibilityState !== 'visible') return false;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    if (document.documentElement.getAttribute('data-input-binding-capture') === 'true') return false;
    const dialog = document.getElementById('settingsDialog');
    if (dialog && dialog.open) return false;
    return true;
  }

  function handleKeydown(event) {
    if (!event.isTrusted) return;
    const binding = currentBinding();
    if (!binding) {
      resetHeld();
      return;
    }
    const matches = event.key === binding.key && event.code === binding.code && event.location === binding.location;
    // Only this button's release or an actual lifecycle change rearms it.
    // An unrelated key must not turn one held press into another click.
    if (!matches) return;
    let state;
    try {
      state = app.getState();
    } catch (error) {
      resetHeld();
      return;
    }
    if (!visibleFocusedKeyboardSurface(state)) return;
    if (isEditableTarget(event.target)) return;
    // Once a bound key belongs to this input channel, suppress its native
    // button activation even when the event cannot be used as a new press.
    if (event.repeat || hasModifiers(event) || event.isComposing || event.keyCode === 229) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (held) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    held = {key:binding.key, code:binding.code, location:binding.location};
    event.preventDefault();
    event.stopImmediatePropagation();
    const args = {
      requestId:nextRequestId(),
      expectedId:state.selectedId,
      geometryVersion:state.geometryVersion,
      expectedTextRevision:state.textRevision
    };
    try {
      Promise.resolve(app.dispatch('keyboard.activate', args)).catch(function () {});
    } catch (error) {}
  }

  function handleKeyup(event) {
    if (!event.isTrusted || !held) return;
    if (event.key === held.key && event.code === held.code && event.location === held.location) held = null;
  }

  function handleVisibility() {
    if (document.visibilityState === 'hidden') resetHeld();
  }

  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('keyup', handleKeyup, true);
  window.addEventListener('blur', resetHeld, true);
  window.addEventListener('pagehide', resetHeld, true);
  window.addEventListener('keyboardinputsettings', resetHeld);
  document.addEventListener('visibilitychange', handleVisibility, true);

  return {dispose:function () {
    resetHeld();
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('keyup', handleKeyup, true);
    window.removeEventListener('blur', resetHeld, true);
    window.removeEventListener('pagehide', resetHeld, true);
    window.removeEventListener('keyboardinputsettings', resetHeld);
    document.removeEventListener('visibilitychange', handleVisibility, true);
  }};
}
