// Browser bridge adapter. Uses only in-memory token state; never stores or
// renders the token, pairing code, patient text, or raw errors.

const BROKER_URL = 'http://127.0.0.1:61763';
const DESKTOP_ORIGIN = 'http://127.0.0.1:61762';
const MAX_BODY_BYTES = 64 * 1024;
const FALLBACK = {
  bridgeTitle: 'Keyboard bridge',
  bridgeConnect: 'Connect',
  bridgeDisconnect: 'Disconnect',
  bridgeCode: 'Pairing code',
  bridgeConnected: 'Bridge connected',
  bridgeDisconnected: 'Bridge disconnected',
  bridgeError: 'Bridge error',
};

let appRef = null;
let initialized = false;
let token = null;
let sessionId = null;
let generation = 0;
let connecting = false;
let statusKey = 'bridgeDisconnected';
let pollTimer = null;
let pollController = null;
let pollInFlight = false;
let codeInput = null;
let connectButton = null;
let disconnectButton = null;
let statusElement = null;

function exactDesktopOrigin() {
  try {
    return window.location.origin === DESKTOP_ORIGIN;
  } catch (error) {
    return false;
  }
}



function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
    abort: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

async function request(path, payload, authToken, options = {}) {
  const timeoutMs = typeof options.timeout === 'number' ? options.timeout : 6000;
  const externalSignal = options.signal || null;
  const keepalive = options.keepalive === true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relayAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', relayAbort, { once: true });
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return await fetch(BROKER_URL + path, {
      method: 'POST',
      headers,
      body,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      keepalive,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', relayAbort);
  }
}





function localized(key) {
  const value = appRef && typeof appRef.translate === 'function' ? appRef.translate(key) : '';
  return typeof value === 'string' && value ? value : FALLBACK[key];
}

function applyCatalog() {
  if (codeInput) {
    codeInput.placeholder = localized('bridgeCode');
    codeInput.setAttribute('aria-label', localized('bridgeCode'));
  }
  if (connectButton) {
    connectButton.textContent = localized('bridgeConnect');
    connectButton.setAttribute('aria-label', localized('bridgeConnect'));
  }
  if (disconnectButton) {
    disconnectButton.textContent = localized('bridgeDisconnect');
    disconnectButton.setAttribute('aria-label', localized('bridgeDisconnect'));
  }
  if (statusElement) {
    statusElement.textContent = localized(statusKey);
    statusElement.title = localized('bridgeTitle');
    statusElement.setAttribute('aria-label', localized('bridgeTitle'));
  }
}

function updateButtons() {
  const originOk = exactDesktopOrigin();
  if (connectButton) connectButton.disabled = !originOk || connecting || Boolean(token);
  if (disconnectButton) disconnectButton.disabled = connecting || !token;
}

function setStatus(nextStatus) {
  statusKey = nextStatus;
  applyCatalog();
  updateButtons();
}

function publicCode(error) {
  const raw = error && typeof error.code === 'string' ? error.code : 'command_failed';
  const code = raw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64);
  return code || 'command_failed';
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length;
  } catch (error) {
    return text.length * 2;
  }
}

function stopPolling() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (pollController) {
    try {
      pollController.abort();
    } catch (error) {
      // best effort
    }
    pollController = null;
  }
}

function disconnectLocal(nextStatus) {
  token = null;
  sessionId = null;
  generation += 1;
  stopPolling();
  setStatus(nextStatus);
}

async function sendResultBody(body, expectedGeneration) {
  if (!token || generation !== expectedGeneration) return;
  try {
    const response = await request('/result', body, token, { timeout: 6000 });
    if (response.status === 401) {
      disconnectLocal('bridgeDisconnected');
      return;
    }
    if (response.status === 403) {
      disconnectLocal('bridgeError');
      return;
    }
    // 409 means the command was already timed out or revoked; do not resurrect it.
  } catch (error) {
    if (token && generation === expectedGeneration) disconnectLocal('bridgeError');
  }
}

async function postError(id, code, expectedGeneration) {
  let body;
  try {
    body = JSON.stringify({ id, error: { code, message: 'Command failed' } });
  } catch (error) {
    return;
  }
  await sendResultBody(body, expectedGeneration);
}

async function postResult(id, result, expectedGeneration) {
  let body;
  try {
    body = JSON.stringify({ id, result: result === undefined ? null : result });
  } catch (error) {
    await postError(id, 'invalid_result', expectedGeneration);
    return;
  }
  if (byteLength(body) > MAX_BODY_BYTES) {
    await postError(id, 'result_too_large', expectedGeneration);
    return;
  }
  await sendResultBody(body, expectedGeneration);
}

async function processCommand(command, expectedGeneration) {
  if (!token || generation !== expectedGeneration) return;
  const id = command && command.id;
  const name = command && command.name;
  const args = command && command.args;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || !args || typeof args !== 'object' || Array.isArray(args)) {
    if (typeof id === 'string' && id) await postError(id, 'invalid_command', expectedGeneration);
    return;
  }
  let result;
  try {
    result = await appRef.dispatch(name, args);
  } catch (error) {
    if (!token || generation !== expectedGeneration) return;
    await postError(id, publicCode(error), expectedGeneration);
    return;
  }
  if (!token || generation !== expectedGeneration) return;
  await postResult(id, result === undefined ? null : result, expectedGeneration);
}

function startPolling() {
  stopPolling();
  if (!token) return;
  const expectedGeneration = generation;
  const schedule = (delay) => {
    if (!token || generation !== expectedGeneration || pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void tick();
    }, delay);
  };
  const tick = async () => {
    if (!token || generation !== expectedGeneration) return;
    if (pollInFlight) {
      schedule(200);
      return;
    }
    pollInFlight = true;
    const controller = new AbortController();
    pollController = controller;
    try {
      const response = await request('/poll', {}, token, { timeout: 6000, signal: controller.signal });
      if (!token || generation !== expectedGeneration) return;
      if (response.status === 401) {
        disconnectLocal('bridgeDisconnected');
        return;
      }
      if (response.status === 429) {
        schedule(1000);
        return;
      }
      if (!response.ok) {
        disconnectLocal('bridgeError');
        return;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.commands)) {
        disconnectLocal('bridgeError');
        return;
      }
      for (const command of data.commands) void processCommand(command, expectedGeneration);
      if (statusKey !== 'bridgeConnected') setStatus('bridgeConnected');
    } catch (error) {
      if (!token || generation !== expectedGeneration) return;
      disconnectLocal('bridgeError');
      return;
    } finally {
      if (pollController === controller) pollController = null;
      pollInFlight = false;
    }
    if (token && generation === expectedGeneration) schedule(200);
  };
  schedule(0);
}

async function connect() {
  if (!exactDesktopOrigin()) {
    setStatus('bridgeError');
    return;
  }
  if (connecting || token) return;
  const code = codeInput && typeof codeInput.value === 'string' ? codeInput.value.trim() : '';
  if (codeInput) codeInput.value = '';
  if (!code) {
    setStatus('bridgeError');
    return;
  }
  connecting = true;
  updateButtons();
  try {
    const response = await request('/pair', { code }, null, { timeout: 6000 });
    if (!response.ok) {
      setStatus('bridgeError');
      return;
    }
    const data = await response.json();
    if (!data || typeof data.token !== 'string' || !data.token || typeof data.sessionId !== 'string') {
      setStatus('bridgeError');
      return;
    }
    token = data.token;
    sessionId = data.sessionId;
    generation += 1;
    setStatus('bridgeConnected');
    startPolling();
  } catch (error) {
    if (!token) setStatus('bridgeError');
  } finally {
    connecting = false;
    updateButtons();
  }
}

async function disconnect() {
  const oldToken = token;
  token = null;
  sessionId = null;
  generation += 1;
  stopPolling();
  setStatus('bridgeDisconnected');
  if (!oldToken) return;
  try {
    await request('/revoke', {}, oldToken, { timeout: 2000 });
  } catch (error) {
    // best effort
  }
}

function pageHide() {
  const oldToken = token;
  token = null;
  sessionId = null;
  generation += 1;
  stopPolling();
  setStatus('bridgeDisconnected');
  if (oldToken) {
    try {
      void request('/revoke', {}, oldToken, { timeout: 1000, keepalive: true }).catch(() => {});
    } catch (error) {
      // best effort
    }
  }
}

export function initBridge(app) {
  if (initialized) return;
  initialized = true;
  appRef = app;
  try {
    codeInput = document.getElementById('bridgeCode');
    connectButton = document.getElementById('bridgeConnect');
    disconnectButton = document.getElementById('bridgeDisconnect');
    statusElement = document.getElementById('bridgeStatus');
    if (!app || typeof app.dispatch !== 'function' || typeof app.getState !== 'function') {
      setStatus('bridgeError');
      return;
    }
    if (connectButton) connectButton.addEventListener('click', () => { void connect(); });
    if (disconnectButton) disconnectButton.addEventListener('click', () => { void disconnect(); });
    window.addEventListener('pagehide', pageHide, { capture: true });
    if (!exactDesktopOrigin()) {
      setStatus('bridgeError');
    } else {
      setStatus('bridgeDisconnected');
    }
    applyCatalog();
    window.addEventListener('keyboardlocalize', applyCatalog);
  } catch (error) {
    try {
      const element = document.getElementById('bridgeStatus');
      if (element) element.textContent = FALLBACK.bridgeError;
    } catch (innerError) {
      // never break touch behavior
    }
  }
}
