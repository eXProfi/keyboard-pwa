/* The user surface joins camera/FSM owners to the existing keyboard command owner.
   This module never stores text or records video, landmarks or biometric history. */
import {TrackingEngine} from './engine.js';
import {HeadBlinkController} from './controller.js';
import {initTuningPanel} from './tuning-panel.js';

function publicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// locales/<id>.json tracking.eye: open, closed, asymmetric, waiting, detected,
// typed, rejected, fallback; then the rejection reasons in REJECT_KEYS order. These are current diagnostics,
// not a saved eye signal or biometric history.
const REJECT_KEYS = ['not_armed','too_short','too_long','face_lost','selection_changed','modal_open','cooldown','callback_failed','moving','low_confidence','one_eye'];
export function createTrackingPanel(app) {
  const toolbar = document.createElement('section');
  toolbar.className = 'tracking-toolbar';
  const buttons = ['trackingStart','trackingStop','trackingCalibrate'].map(id => {
    const button = document.createElement('button');
    button.id = id; button.type = 'button'; button.dataset.actionId = id;
    toolbar.append(button);
    return button;
  });
  const status = document.createElement('p');
  status.id = 'trackingStatus'; status.setAttribute('role','status');
  status.setAttribute('aria-live','polite'); toolbar.append(status);
  const navigationIndicator = document.createElement('div');
  navigationIndicator.id = 'trackingNavigation';
  navigationIndicator.className = 'tracking-navigation';
  navigationIndicator.hidden = true;
  const navigationPhase = document.createElement('span');
  navigationPhase.className = 'tracking-navigation-phase';
  const navigationTimer = document.createElement('span');
  navigationTimer.className = 'tracking-navigation-timer';
  navigationTimer.setAttribute('aria-hidden','true');
  const navigationAnnounce = document.createElement('span');
  navigationAnnounce.className = 'tracking-sr-only';
  navigationAnnounce.setAttribute('role','status');
  navigationAnnounce.setAttribute('aria-live','polite');
  navigationAnnounce.setAttribute('aria-atomic','true');
  navigationIndicator.append(navigationPhase, navigationTimer, navigationAnnounce);
  toolbar.append(navigationIndicator);
  const blinkIndicator = document.createElement('div');
  blinkIndicator.id = 'trackingBlinkAvailability';
  blinkIndicator.className = 'tracking-blink-availability';
  blinkIndicator.hidden = true;
  toolbar.append(blinkIndicator);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.hidden = true;
  document.querySelector('#keyboardArea').before(toolbar);
  toolbar.append(video);
  const style = document.createElement('style');
  style.textContent = `
    .tracking-toolbar {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;background:var(--bg);}
    .tracking-toolbar button {min-width:0;min-height:44px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--control-bg);color:var(--text);font:600 clamp(14px,1.5vw,20px)/1.2 Arial,sans-serif;overflow-wrap:anywhere;}
    .tracking-toolbar button:disabled {opacity:.55;}
    .tracking-toolbar button:focus-visible,.tracking-toolbar button.selected {outline:3px solid #087dff;outline-offset:-3px;}
    .tracking-toolbar p {grid-column:1/-1;margin:0;min-height:5.2em;max-height:5.2em;overflow:auto;text-align:center;display:flex;align-items:center;justify-content:center;white-space:pre-line;font:500 16px/1.3 Arial,sans-serif;}
    .tracking-navigation {grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;gap:4px 10px;min-height:1.4em;text-align:center;font:700 14px/1.3 Arial,sans-serif;}
    .tracking-navigation[data-locked='true'] {color:#8a4b00;}
    .tracking-navigation-timer {font-variant-numeric:tabular-nums;white-space:nowrap;}
    .tracking-blink-availability {grid-column:1/-1;text-align:center;font:600 13px/1.3 Arial,sans-serif;color:#3a3a3c;overflow-wrap:anywhere;}
    .tracking-blink-availability[data-ready='false'] {color:#8a4b00;}
    .tracking-return-locked {outline:3px solid #b36b00 !important;outline-offset:-3px;}
    .tracking-navigation[hidden], .tracking-blink-availability[hidden] {display:none;}
    .tracking-sr-only {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
    /* The compact status slot stays the same size while gestures change its
       text, so keyboard geometry cannot move underneath a captured action. */
    .tracking-toolbar p {height:52px;min-height:52px;max-height:52px;overflow:auto;text-align:left;display:block;padding:2px 4px;font:500 13px/1.25 Arial,sans-serif;}
    .tracking-navigation {min-height:0;font-size:12px;}
    .tracking-blink-availability {font-size:12px;}
    @media (min-width: 900px) {
      .tracking-toolbar {grid-template-columns:repeat(3,minmax(0,max-content)) minmax(0,1fr);align-items:stretch;}
      .tracking-toolbar button {padding:4px 8px;}
      .tracking-toolbar p {grid-column:4;grid-row:1;display:flex;align-items:center;justify-content:flex-start;padding:2px 8px;}
      .tracking-navigation {grid-column:1/4;grid-row:2;justify-content:flex-start;flex-wrap:nowrap;max-height:18px;overflow:auto;}
      .tracking-blink-availability {grid-column:4;grid-row:2;text-align:left;white-space:nowrap;max-height:18px;overflow:auto;}
    }
    @media (max-width: 700px) {
      .tracking-toolbar p {text-align:center;display:flex;align-items:center;justify-content:center;}
    }
  `;
  document.head.append(style);
  let controller = null;
  let starting = false;
  let lastPaint = -Infinity;
  let errorCode = null;
  let serial = 0;
  let lockedKey = null;
  let lastNavAnnounce = '';
  const id = () => 'tracking-' + Date.now().toString(36) + '-' + (++serial);
  const engine = new TrackingEngine({
    onFrame(frame) {
      if (controller) {
        const current = app.getState();
        controller.ingest(frame, current);
      }
      paint();
    },
    onStatus(value) {
      if (!value.running && !starting && controller) controller.pause();
      paint(true);
    }
  });

  function snapshot() {
    return {
      engine:engine.getStatus(),
      controller:controller ? controller.getStatus() : {
        phase:'IDLE',
        fsm:{head:'NEUTRAL',blink:'REQUIRE_OPEN',armed:false},
        confidence:0,
        relativePose:{yaw:0,pitch:0,roll:0},
        lastError:null,
        navigation:{phase:'READY',locked:false,remainingMs:0,awaitingStablePose:false,recenters:0},
        blinkAvailability:{ready:false,reason:'camera_paused'}
      }
    };
  }

  function selectedKeyElement() {
    const selectedId = app.getState().selectedId;
    // Use the keyboard owner's existing action identity, also used for MCP actions.
    return [...document.querySelectorAll('[data-action-id]')]
      .find(element => element.dataset.actionId === selectedId) || null;
  }

  function setLockedKey(active) {
    if (!active) {
      if (lockedKey) lockedKey.classList.remove('tracking-return-locked');
      lockedKey = null;
      toolbar.classList.remove('tracking-nav-locked');
      return;
    }
    const next = selectedKeyElement();
    if (lockedKey && lockedKey !== next) lockedKey.classList.remove('tracking-return-locked');
    if (next) next.classList.add('tracking-return-locked');
    lockedKey = next;
    toolbar.classList.add('tracking-nav-locked');
  }

  function paint(force = false) {
    const now = performance.now();
    if (!force && now - lastPaint < 100) return;
    lastPaint = now;
    // Texts live in locales/<id>.json; check rejects catalogs with missing keys.
    const tr = app.catalog('tracking');
    if (!tr) return;
    const appState = app.getState();
    const text = tr.base;
    const state = snapshot();
    const values = appState.inputSettings && appState.inputSettings.values ? appState.inputSettings.values : null;
    const source = state.controller.clickSource || (values && values.clickSource) || 'mouth';
    const modeText = tr.mode;
    const sourceText = modeText[source] || modeText.mouth;
    const active = state.engine.running && !!controller;
    const navState = active && state.controller.navigation ? state.controller.navigation : null;
    const returning = !!navState && navState.phase === 'RETURNING';
    const navText = tr.nav;
    navigationIndicator.hidden = !active;
    blinkIndicator.hidden = !active || source !== 'blink';
    if (active) {
      const remaining = returning ? Math.max(0, Number(navState.remainingMs) || 0) : 0;
      const phaseText = returning ? (remaining > 0 ? navText.locked : navText.hold) : navText.ready;
      if (navigationPhase.textContent !== phaseText) navigationPhase.textContent = phaseText;
      const timerText = returning && remaining > 0 ? navText.remaining.replace('{seconds}', (Math.ceil(remaining / 100) / 10).toFixed(1)) : '';
      if (navigationTimer.textContent !== timerText) navigationTimer.textContent = timerText;
      navigationIndicator.dataset.locked = returning ? 'true' : 'false';
      const announce = returning ? (remaining > 0 ? navText.locked : navText.hold) : navText.ready;
      if (lastNavAnnounce !== announce) {
        navigationAnnounce.textContent = announce;
        lastNavAnnounce = announce;
      }
      if (source === 'blink') {
        const blinkState = state.controller.blinkAvailability || {ready:false, reason:'camera_paused'};
        const blinkText = tr.blink;
        const reason = blinkState.ready ? null : (blinkState.reason || 'camera_paused');
        const reasons = blinkText.reasons || {};
        const blinkMessage = reason === null ? `${blinkText.prefix}: ${blinkText.ready}` : `${blinkText.prefix}: ${reasons[reason] || reasons.camera_paused || ''}`;
        if (blinkIndicator.textContent !== blinkMessage) blinkIndicator.textContent = blinkMessage;
        blinkIndicator.dataset.ready = reason === null ? 'true' : 'false';
      } else {
        if (blinkIndicator.textContent !== '') blinkIndicator.textContent = '';
        blinkIndicator.removeAttribute('data-ready');
      }
      setLockedKey(returning);
    } else {
      if (navigationPhase.textContent !== '') navigationPhase.textContent = '';
      if (navigationTimer.textContent !== '') navigationTimer.textContent = '';
      navigationIndicator.removeAttribute('data-locked');
      if (lastNavAnnounce !== '') { navigationAnnounce.textContent = ''; lastNavAnnounce = ''; }
      if (blinkIndicator.textContent !== '') blinkIndicator.textContent = '';
      blinkIndicator.removeAttribute('data-ready');
      setLockedKey(false);
    }
    buttons.forEach((button,index) => {
      if (button.textContent !== text[index]) button.textContent = text[index];
      button.setAttribute('aria-label',text[index]);
    });
    toolbar.setAttribute('aria-label',text[0]);
    buttons[0].disabled = starting || state.engine.running;
    buttons[1].disabled = !starting && !state.engine.running;
    buttons[2].disabled = !state.engine.running || starting;
    const phase = state.controller.phase;
    let message = text[3];
    if (starting) message = text[4];
    else if (state.controller.lastError === 'EYE_SIGNAL_UNRELIABLE') message = tr.eyeUnreliable;
    else if (state.controller.lastError) message = tr.controlError;
    else if (errorCode || state.engine.lastErrorCode) message = text[10];
    else if (state.engine.running) {
      if (phase === 'FACE_LOST') message = text[7];
      else if (phase === 'LOW_CONFIDENCE') message = text[8];
      else if (phase === 'EYE_SIGNAL_UNRELIABLE') message = tr.eyeUnreliable;
      else if (phase === 'EYE_REFERENCE') message = tr.eyeReference;
      else if (phase === 'RETURN_CENTER') message = tr.returnCenter;
      else if (phase === 'CALIBRATING') message = sourceText.calibrating;
      else if (phase === 'CALIBRATION_REQUIRED' || phase === 'IDLE') message = text[13];
      else if (phase === 'PAUSED') message = text[12];
      else if (phase === 'REACQUIRE') message = sourceText.calibrating;
      else if (source === 'mouth' && state.controller.mouth) {
        const mouth = state.controller.mouth;
        const feedback = tr.mouthFeedback;
        message = mouth.ready ? sourceText.ready
          : mouth.reason === 'mouth_unreliable' ? feedback.unreliable
          : mouth.reason === 'gesture_active' || mouth.reason === 'rearm_required' ? feedback.release
          : sourceText.acquiring;
      }
      else message = state.controller.fsm.armed ? sourceText.ready : sourceText.acquiring;
    }
    if (source === 'blink' && (state.engine.running || state.controller.counts?.completedBlinks > 0)) {
      const labels = tr.eye;
      const eyes = state.controller.eyes || {};
      const counts = state.controller.counts || {};
      const eyeIndex = {OPEN:0,CLOSED:1,ASYMMETRIC:2}[eyes.state] ?? 3;
      const eyeCaption = eyes.state === 'LOOKING_DOWN' ? tr.lookingDown
        : eyes.state === 'UNRELIABLE' ? tr.eyeUnreliable
        : eyes.state === 'TRANSITION' ? tr.transitionEyes : labels[eyeIndex];
      let detail = `${state.engine.running ? eyeCaption + ' · ' : ''}${labels[4]}: ${counts.completedBlinks || 0} · ${labels[5]}: ${counts.acceptedBlinks || 0}`;
      const last = state.controller.lastBlink;
      if (last && !last.accepted) {
        const index = REJECT_KEYS.indexOf(last.reason);
        const reason = last.reason === 'head_motion' ? tr.turnSignal
          : index < 0 ? labels[7] : labels[index + 8];
        detail += ` · ${labels[6]}: ${reason}`;
      }
      message += '\n' + detail;
    } else if (source === 'mouth' && state.controller.mouth) {
      const mouth = state.controller.mouth;
      const counts = mouth.counts || {};
      const labels = sourceText.counters || {};
      const clicks = Number.isFinite(counts.clicks) ? counts.clicks : 0;
      const deletes = Number.isFinite(counts.deletes) ? counts.deletes : 0;
      let detail = `${labels.clicks || ''}: ${clicks} · ${labels.deletes || ''}: ${deletes}`;
      if (Number.isFinite(counts.rejected) && counts.rejected > 0) {
        detail += ` · ${labels.rejected || ''}: ${counts.rejected}`;
      }
      const last = mouth.lastAction;
      if (last && last.accepted === false && last.reason) {
        detail += ` · ${tr.mouthFeedback.retry}`;
      }
      message += '\n' + detail;
    }
    if (status.textContent !== message) {
      status.textContent = message;
      status.title = message;
    }
  }

  async function handle(name,args,context = {}) {
    if (name === 'tracking.getStatus') return snapshot();
    if (name === 'tracking.start') {
      // CRITICAL: this flag is derived by the owner from an actual trusted click.
      // JSON/MCP arguments can never grant permission to activate the camera.
      if (!context.userGesture) throw publicError('LOCAL_CAMERA_CONSENT');
      if (starting || engine.getStatus().running) return snapshot();
      starting = true; errorCode = null;
      controller = new HeadBlinkController({
        move:(direction,steps = 1) => app.dispatch('keyboard.move',{direction,steps,requestId:id()}),
        activate:snapshot => {
          const args = {
            requestId:id(),expectedId:snapshot.selectedId,geometryVersion:Number(snapshot.geometryVersion)
          };
          if (Number.isSafeInteger(snapshot.textRevision) && snapshot.textRevision >= 0) args.expectedTextRevision = snapshot.textRevision;
          return app.dispatch('keyboard.activate',args);
        },
        backspace:snapshot => {
          if (!Number.isSafeInteger(snapshot.textRevision) || snapshot.textRevision < 0) {
            return Promise.reject(publicError('STALE_TEXT'));
          }
          return app.dispatch('keyboard.backspace',{
            requestId:id(),expectedId:snapshot.selectedId,geometryVersion:Number(snapshot.geometryVersion),
            expectedTextRevision:snapshot.textRevision
          });
        },
        onStatus:() => paint()
      });
      controller.setClickSource(app.getState().inputSettings.values.clickSource);
      controller.configure(app.getState().trackingSettings.values);
      controller.beginCalibration();
      paint(true);
      try { await engine.start(video); }
      catch (error) {
        errorCode = 'CAMERA_OR_MODEL_ERROR'; controller.pause();
        throw publicError(errorCode);
      } finally { starting = false; paint(true); }
      return snapshot();
    }
    if (name === 'tracking.stop') {
      if (controller) controller.pause();
      await engine.stop(); starting = false; errorCode = null; paint(true);
      return snapshot();
    }
    if (name === 'tracking.calibrate') {
      if (!engine.getStatus().running || !controller) throw publicError('NOT_RUNNING');
      controller.resume(); controller.beginCalibration(); errorCode = null; paint(true);
      return snapshot();
    }
    throw publicError('INVALID_COMMAND');
  }

  ['tracking.start','tracking.stop','tracking.calibrate'].forEach((name,index) => {
    buttons[index].addEventListener('click',event => {
      // The toolbar already dispatches its semantic action. Do not route this
      // trusted click through keyboard activation a second time or move its key.
      event.stopPropagation();
      app.dispatch(name,{requestId:id()},event).catch(error => {
        errorCode = error.code === 'LOCAL_CAMERA_CONSENT' ? error.code : 'CAMERA_OR_MODEL_ERROR';
        paint(true);
      });
    });
  });
  window.addEventListener('keyboardlocalize',() => paint(true));
  initTuningPanel(app);
  paint(true);
  return {handle,getStatus:snapshot,configure(values) {
    if (controller) controller.configure(values);
    paint(true);
  },setClickSource(source) {
    if (controller) controller.setClickSource(source);
    paint(true);
  }};
}
