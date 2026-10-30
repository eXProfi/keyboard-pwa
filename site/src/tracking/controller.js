import {TRACKING_DEFAULTS,validateTrackingPreferences} from './preferences.js';

/** One-step head gestures with a controlled return and bilateral blink control.
 * Neutral is calibrated once; absolute zones and hysteresis own each step.
 * Eyelid geometry confirms closure and reopening independently of score drift.
 * No camera, patient text or signal history is owned by this module.
 */
const MIN_CONFIDENCE = 0.75;

function clamp01(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function round(value, digits) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const factor = Math.pow(10, digits);
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function normalizeId(value) {
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    return value.length > 128 ? value.slice(0, 128) : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function evaluateFrame(frame) {
  if (frame === null || typeof frame !== 'object') {
    return { ok: false, reason: 'face_lost' };
  }
  if (frame.facePresent !== true) {
    return { ok: false, reason: 'face_lost' };
  }
  const confidence = frame.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: 'invalid_metric' };
  }
  if (confidence < MIN_CONFIDENCE) {
    return { ok: false, reason: 'low_confidence' };
  }
  const metrics = [frame.yaw, frame.pitch, frame.roll, frame.faceScale, frame.blinkLeft, frame.blinkRight];
  for (let index = 0; index < metrics.length; index += 1) {
    if (typeof metrics[index] !== 'number' || !Number.isFinite(metrics[index])) {
      return { ok: false, reason: 'invalid_metric' };
    }
  }
  if (!(frame.faceScale > 0)) {
    return { ok: false, reason: 'invalid_metric' };
  }
  return { ok: true, reason: null };
}

function poseStable(samples) {
  const yaw = median(samples.map((sample) => sample.yaw));
  const pitch = median(samples.map((sample) => sample.pitch));
  const roll = median(samples.map((sample) => sample.roll));
  const yawMad = median(samples.map((sample) => Math.abs(sample.yaw - yaw)));
  const pitchMad = median(samples.map((sample) => Math.abs(sample.pitch - pitch)));
  const rollMad = median(samples.map((sample) => Math.abs(sample.roll - roll)));
  return yawMad <= HEAD.poseMadDeg && pitchMad <= HEAD.poseMadDeg && rollMad <= HEAD.poseMadDeg;
}

const HEAD = Object.freeze({
  yawTriggerDeg: 3,
  pitchTriggerDeg: 3,
  neutralZoneDeg: 1.25,
  holdMs: 70,
  emaTauMs: 60,
  largeYawDeg: 30,
  largePitchDeg: 25,
  calibrationMinMs: 1000,
  calibrationMinSamples: 15,
  calibrationMaxSamples: 900,
  poseMadDeg: 2.5,
  motionSpeedDegPerSec: 12,
  motionQuietMs: 120,
  motionJitterDeg: 0.6,
  blinkPoseExcursionDeg: 1.25,
  eyeRefPoseDeltaDeg: 2,
  eyeRefMinMs: 350,
  eyeRefMinFrames: 6,
  eyeRefWindow: 30,
  eyeRefSampleGapMs: 100,
  lookStableMs: 120,
  lookTransitionDelta: 0.3,
  minOpenEar: 0.08,
  blinkCorrelationMs: 150,
  // The operator rejected the faster 126ms return; preserve the accepted 180ms
  // stability requirement, concurrent with the configured minimum pause.
  returnStableWindowMs: 180,
  returnSampleSpacingMs: 25,
  returnSampleGapMs: 250,
  returnMaxSamples: 12,
});
// Symmetric axis-intent margin, expressed as a fraction of the established axis
// magnitude and always combined with the existing absolute jitter bound. It is
// not a user setting and owns no timer: it only decides which axis already has
// clear evidence, so a moderate cross-axis drift cannot steal a pending step
// while a definite stronger change still re-aims after the unchanged hold.
const AXIS_DOMINANCE_RATIO = 0.25;
const BLINK = Object.freeze({
  closeRatio: 0.6,
  // Reopening must stay reachable when the live open level drifts below the
  // calibrated reference (gaze at the keyboard, glasses, small pose changes).
  // Closure evidence still uses the calibrated open level and the unchanged
  // evidence correlation, so this does not loosen what counts as a closure.
  openRatio: 0.7,
  minOpenEar: 0.08,
  // A weak or partly occluded closure can keep the model blink score below the
  // previous 0.55 floor. The floor is reachable now, and strictness moves both
  // the EAR ratio and this score threshold.
  minCloseScore: 0.4,
  closeScoreOffset: 0.15,
  maxCloseScore: 0.9,
  maxCalibrationScore: 0.8,
  // One eye can report a weaker model score through glasses. Lid geometry stays
  // strictly bilateral; only score corroboration uses this margin.
  scoreAsymmetryMargin: 0.15,
});
const LOOK = Object.freeze({
  enterThreshold: 0.6,
  exitThreshold: 0.4,
});
// Mouth evidence bands and the bounded neutral reference window from the frozen
// consumer contract. Reference medians for pucker/jaw/gap/width are captured
// once; every gesture is then judged relative to that neutral. Model and
// geometry evidence are both required for each decision; none of these values
// is a policy owner.
const MOUTH = Object.freeze({
  neutralPucker: 0.35,
  neutralJaw: 0.15,
  neutralGap: 0.12,
  // Kiss: a pucker that rises clearly above neutral, a jaw that does not open,
  // and a width that narrowed relative to the neutral median corroborate it.
  kissPucker: 0.65,
  kissPuckerRise: 0.4,
  kissJawRise: 0.1,
  kissGap: 0.12,
  kissWidthRatio: 0.95,
  // Delete: a real vertical gap that grew from neutral plus a jaw that opened
  // relative to neutral. A single fixed jaw value missed modest opens, so both
  // remain required corroborators.
  deleteGap: 0.2,
  deleteGapRise: 0.12,
  deleteJawRise: 0.08,
  deletePucker: 0.45,
  refMinSamples: 6,
  refMinMs: 250,
  refWindow: 30,
  sampleGapMs: 400,
});
const ERROR_CALLBACK_FAILED = 'callback_failed';
const ERROR_EYE_SIGNAL = 'EYE_SIGNAL_UNRELIABLE';
const MAX_ACTIVATION_QUEUE = 8;

function quantile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function upperQuartile(values) {
  return quantile(values, 0.75);
}

export class HeadBlinkController {
  #settings = TRACKING_DEFAULTS;
  #move;
  #activate;
  #onStatus;
  #paused = false;
  #epoch = 0;
  #commandSeq = 0;
  #inflight = null;
  #activationQueue = [];
  #activationSeq = 0;
  #lastTimestamp = null;
  #lastNotifiedKey = '';
  #lastError = null;
  #phase = 'IDLE';
  #lastConfidence = 0;
  #lastRelative = { yaw: 0, pitch: 0, roll: 0 };
  #operational = false;
  #neutral = null;
  #filtered = { yaw: 0, pitch: 0, roll: 0, valid: false, lastTimestamp: null, speed: 0 };
  #head = { latchedDirection: null, candidateDirection: null, candidateSince: null, lastMoveAt: null };
  #navigation = { phase: 'READY', locked: false, stepAt: null, deadline: null, recenters: 0, awaitingStablePose: false, stableSamples: [] };
  #initialNeutral = null;
  #headMotion = { anchor: null, lastActivityAt: null };
  #calibration = { active: false, samples: [], startedAt: null };
  #context = { initialized: false, selectedId: null, geometryVersion: null, activeSurface: null, textRevision: null };
  #selection = { selectedId: null, geometryVersion: null, activeSurface: null, textRevision: null };
  #blink = { state: 'REQUIRE_OPEN', closedAt: null, pending: null, snapshotPose: null, blocked: false, capturedPosture: null };
  #eyes = { state: 'UNRELIABLE', earLeft: 0, earRight: 0, ratioLeft: 0, ratioRight: 0, scoreLeft: 0, scoreRight: 0, geometryValid: false, lookEvidenceValid: false, lookDown: 0, lookUp: 0, posture: 'FORWARD', referenceValid: false, referencePhase: 'NONE' };
  #eyeEvidence = { geometryClosedAt: null, scoreClosedAt: null };
  #eyeRef = null;
  #forwardEyeRef = null;
  #eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
  #eyeRefPhase = 'NONE';
  #eyeRefStale = false;
  #look = { valid: false, down: 0, up: 0, posture: 'FORWARD', changedAt: null, stableSince: null, transitionAt: null, lastDown: 0, lastUp: 0 };
  #counts = { closures: 0, completedBlinks: 0, acceptedBlinks: 0, rejectedBlinks: 0, moves: 0 };
  #lastBlink = null;
  #clickSource = 'blink';
  #backspace = null;
  #mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
  #mouthReference = null;
  #mouthSamples = [];
  #mouthGesture = null;
  #mouthSnapshot = null;
  #mouthBlocked = false;
  #mouthCounts = { clicks: 0, deletes: 0, rejected: 0 };
  #mouthLastAction = null;

  constructor(options) {
    const opts = options !== null && typeof options === 'object' ? options : {};
    if (typeof opts.move !== 'function') throw new TypeError('HeadBlinkController: move() callback is required');
    if (typeof opts.activate !== 'function') throw new TypeError('HeadBlinkController: activate() callback is required');
    this.#move = opts.move;
    this.#activate = opts.activate;
    // The real delete effect is optional. Without it a delete gesture is
    // refused instead of pretending the character was removed.
    this.#backspace = typeof opts.backspace === 'function' ? opts.backspace : null;
    this.#onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
    this.#notify();
  }

  configure(settings) {
    const values = validateTrackingPreferences(settings);
    if (values.invertHorizontal !== this.#settings.invertHorizontal) {
      // Changing the mapping is not a new head gesture. Keep the held physical
      // direction latched under its new name instead of emitting a phantom step.
      if (this.#head.latchedDirection === 'left') this.#head.latchedDirection = 'right';
      else if (this.#head.latchedDirection === 'right') this.#head.latchedDirection = 'left';
    }
    const previousDelay = this.#settings.reactionDelayMs;
    this.#rejectPendingBlink('settings_changed',this.#lastTimestamp ?? 0);
    this.#cancelMouthCycle();
    this.#epoch += 1;
    this.#activationQueue.length = 0;
    this.#clearHeadCandidate();
    this.#resetBlinkRequireOpen();
    this.#settings = values;
    if (this.#navigation.phase === 'RETURNING' && values.reactionDelayMs !== previousDelay) {
      const stepAt = this.#navigation.stepAt ?? this.#lastTimestamp ?? 0;
      this.#navigation.deadline = stepAt + values.reactionDelayMs;
      // Deadline changes are derived from the ORIGINAL stepAt; already banked
      // stable observations stay valid so the timer is never restarted.
      this.#navigation.awaitingStablePose = (this.#lastTimestamp ?? 0) >= this.#navigation.deadline;
    }
    this.#notify();
    return {...values};
  }

  // The app owns the source setting; this controller only owns the live state.
  // Switching source drops pending input and queued face actions under the same
  // epoch guard, but never touches head neutral, timers, filter or latch, so a
  // mode choice cannot fabricate a head step.
  setClickSource(source) {
    if (source !== 'mouth' && source !== 'blink' && source !== 'external') {
      throw new TypeError('HeadBlinkController: click source must be mouth, blink or external');
    }
    if (source === this.#clickSource) return this.#clickSource;
    this.#clickSource = source;
    const timestamp = this.#lastTimestamp === null ? 0 : this.#lastTimestamp;
    this.#rejectPendingBlink('source_changed', timestamp);
    this.#cancelMouthCycle();
    this.#mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
    this.#mouthSamples.length = 0;
    this.#epoch += 1;
    this.#activationQueue.length = 0;
    this.#resetBlinkRequireOpen();
    this.#notify();
    return this.#clickSource;
  }

  #neutralZone() { return Math.min(HEAD.neutralZoneDeg,this.#settings.headAngleDeg * .45); }
  #closeRatio() { return .65 - this.#settings.blinkStrictness * .004; }
  // Model thresholds are derived here, at use time, from the calibrated OPEN
  // score stored in the reference. Manual strictness therefore takes effect
  // immediately, including on the forward reference, with no recalibration.
  #closeScoreFor(base) {
    const strictness = clamp01(this.#settings.blinkStrictness / 100);
    const offset = BLINK.closeScoreOffset * (0.4 + 0.8 * strictness);
    const floor = BLINK.minCloseScore + (BLINK.maxCloseScore - BLINK.minCloseScore) * 0.55 * strictness;
    return Math.min(BLINK.maxCloseScore, Math.max(floor, clamp01(base) + offset));
  }

  beginCalibration() {
    if (this.#paused) return false;
    this.#initialNeutral = null;
    this.#cancelNavigation();
    this.#navigation.recenters = 0;
    this.#neutral = null;
    this.#cancelTransient();
    this.#eyeRef = null;
    this.#forwardEyeRef = null;
    this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
    this.#eyeRefPhase = 'NONE';
    this.#eyeRefStale = false;
    this.#eyes = { state: 'UNRELIABLE', earLeft: 0, earRight: 0, ratioLeft: 0, ratioRight: 0, scoreLeft: 0, scoreRight: 0, geometryValid: false, lookEvidenceValid: false, lookDown: 0, lookUp: 0, posture: 'FORWARD', referenceValid: false, referencePhase: 'NONE' };
    this.#filtered = { yaw: 0, pitch: 0, roll: 0, valid: false, lastTimestamp: null, speed: 0 };
    this.#calibration = { active: true, samples: [], startedAt: null };
    this.#mouthReference = null;
    this.#mouthSamples.length = 0;
    this.#mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
    this.#cancelMouthCycle();
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#lastError = null;
    this.#operational = false;
    this.#phase = 'CALIBRATING';
    this.#notify();
    return true;
  }

  ingest(frame, context) {
    if (this.#paused) return { accepted: false, reason: 'paused' };
    if (frame === null || typeof frame !== 'object') return { accepted: false, reason: 'invalid_frame' };
    const timestamp = frame.timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return { accepted: false, reason: 'invalid_timestamp' };
    if (this.#lastTimestamp !== null && !(timestamp > this.#lastTimestamp)) return { accepted: false, reason: 'non_monotonic_timestamp' };
    this.#lastTimestamp = timestamp;
    const ctx = context !== null && typeof context === 'object' ? context : {};
    const selectedId = normalizeId(ctx.selectedId);
    const geometryVersion = normalizeId(ctx.geometryVersion);
    const surfaceValue = ctx.activeSurface;
    const activeSurface = surfaceValue === 'keyboard' || surfaceValue === 'settings' ? surfaceValue : null;
    // A mouth delete may only use a nonnegative safe integer text revision. Any
    // other value is treated as absent and never authorises an edit.
    const rawTextRevision = ctx.textRevision;
    const textRevision = typeof rawTextRevision === 'number' && Number.isSafeInteger(rawTextRevision) && rawTextRevision >= 0 ? rawTextRevision : null;
    const hadContext = this.#context.initialized;
    const previousSelectedId = this.#context.selectedId;
    const previousGeometryVersion = this.#context.geometryVersion;
    const previousActiveSurface = this.#context.activeSurface;
    const previousTextRevision = this.#context.textRevision;
    const selectionChanged = hadContext && previousSelectedId !== selectedId;
    const geometryChanged = hadContext && previousGeometryVersion !== geometryVersion;
    const surfaceChanged = hadContext && previousActiveSurface !== activeSurface;
    const textChanged = hadContext && previousTextRevision !== textRevision;
    this.#context = { initialized: true, selectedId, geometryVersion, activeSurface, textRevision };
    this.#selection = { selectedId, geometryVersion, activeSurface, textRevision };
    if (selectionChanged || geometryChanged || surfaceChanged || textChanged) {
      let reason = 'selection_changed';
      if (surfaceChanged) reason = 'modal_open';
      else if (geometryChanged) reason = 'geometry_changed';
      else if (textChanged) reason = 'text_changed';
      this.#rejectPendingBlink(reason, timestamp);
      this.#cancelMouthCycle();
      if (geometryChanged || surfaceChanged) {
        this.#cancelTransient();
      } else {
        // A completed head step changes selection. Keep its directional latch:
        // releasing it here would repeat the same step while the head is held.
        this.#epoch += 1;
        this.#activationQueue.length = 0;
        this.#clearHeadCandidate();
      }
    }
    const modalOpen = activeSurface !== 'keyboard';
    const quality = evaluateFrame(frame);
    if (!quality.ok) {
      this.#handleDegraded(quality.reason, frame, timestamp);
      return { accepted: true, phase: this.#phase };
    }
    this.#lastConfidence = clamp01(frame.confidence);
    if (this.#calibration.active) {
      this.#phase = 'CALIBRATING';
      this.#collectCalibrationSample(frame, timestamp);
      this.#notify();
      return { accepted: true, phase: this.#phase };
    }
    if (this.#neutral === null) {
      this.#phase = 'CALIBRATION_REQUIRED';
      this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
      this.#operational = false;
      this.#notify();
      return { accepted: true, phase: this.#phase };
    }
    const speed = this.#updateFiltered(frame, timestamp);
    const relative = this.#relativePose();
    this.#lastRelative = relative;
    const initialRelative = this.#initialRelativePose();
    const large = Math.abs(initialRelative.yaw) > HEAD.largeYawDeg || Math.abs(initialRelative.pitch) > HEAD.largePitchDeg;
    if (large) {
      if (this.#navigation.phase === 'RETURNING') {
        this.#navigation.stableSamples = [];
        this.#navigation.awaitingStablePose = this.#navigation.deadline !== null && timestamp >= this.#navigation.deadline;
      }
      if (this.#blink.state === 'CLOSED') this.#rejectPendingBlink('return_center', timestamp);
      else this.#resetBlinkRequireOpen();
      this.#cancelMouthCycle();
      this.#resetHead();
      this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
      this.#eyeRefPhase = this.#eyeRef === null ? 'NONE' : 'READY';
      this.#eyeRefStale = false;
      this.#phase = this.#navigation.phase === 'RETURNING' ? 'RETURNING' : 'RETURN_CENTER';
      this.#operational = false;
      this.#notify();
      return { accepted: true, phase: this.#phase };
    }
    if (modalOpen) {
      this.#cancelNavigation();
      if (this.#blink.state === 'CLOSED') this.#rejectPendingBlink('modal_open', timestamp);
      else this.#resetBlinkRequireOpen();
      this.#resetHead();
      this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
      this.#eyeRefPhase = this.#eyeRef === null ? 'NONE' : 'READY';
      this.#eyeRefStale = false;
      this.#phase = 'MODAL';
      this.#operational = false;
      this.#notify();
      return { accepted: true, phase: this.#phase };
    }
    this.#updateLook(frame, timestamp);
    this.#updateEyeReference(frame, timestamp, relative);
    this.#updateEyes(frame);
    this.#updateBlink(timestamp, speed, relative);
    this.#updateMouth(timestamp, frame);
    this.#updateHead(timestamp, relative);
    this.#operational = true;
    this.#phase = this.#eyeRefStale || this.#eyes.referenceValid !== true ? 'EYE_REFERENCE' : 'TRACKING';
    this.#notify();
    return { accepted: true, phase: this.#phase };
  }

  invalidate() {
    const timestamp = this.#lastTimestamp === null ? 0 : this.#lastTimestamp;
    this.#rejectPendingBlink('selection_changed', timestamp);
    this.#cancelTransient();
    this.#calibration.active = false;
    this.#calibration.samples = [];
    this.#calibration.startedAt = null;
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#operational = false;
    if (!this.#paused) this.#phase = this.#neutral === null ? 'CALIBRATION_REQUIRED' : 'REACQUIRE';
    this.#notify();
  }

  pause() {
    this.#enterPaused('PAUSED');
    return true;
  }

  resume() {
    if (!this.#paused) return false;
    this.#paused = false;
    this.#lastError = null;
    this.#cancelTransient();
    this.#calibration.active = false;
    this.#calibration.samples = [];
    this.#calibration.startedAt = null;
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#phase = this.#neutral === null ? 'CALIBRATION_REQUIRED' : 'REACQUIRE';
    this.#notify();
    return true;
  }

  getStatus() {
    const ref = this.#eyeRef;
    const headMode = this.#head.latchedDirection !== null ? 'LATCHED' : this.#head.candidateDirection !== null ? 'CANDIDATE' : 'IDLE';
    return {
      settings: {...this.#settings,closureRatio:this.#closeRatio()},
      navigation: this.#navigationStatus(),
      blinkAvailability: this.#blinkAvailability(),
      clickSource: this.#clickSource,
      mouth: this.#mouthStatus(),
      phase: this.#phase,
      fsm: {
        head: headMode,
        blink: this.#blink.state,
        armed: this.#isArmed(),
      },
      confidence: clamp01(this.#lastConfidence),
      relativePose: {
        yaw: round(this.#lastRelative.yaw, 2),
        pitch: round(this.#lastRelative.pitch, 2),
        roll: round(this.#lastRelative.roll, 2),
      },
      lastError: this.#lastError,
      head: {
        latchedDirection: this.#head.latchedDirection,
        candidateDirection: this.#head.candidateDirection,
        motionSettled: this.#isHeadSettled(this.#lastTimestamp ?? 0),
        angularSpeedDegPerSec: round(this.#filtered.speed,2),
      },
      eyes: {
        state: this.#eyes.state,
        earLeft: round(this.#eyes.earLeft, 3),
        earRight: round(this.#eyes.earRight, 3),
        ratioLeft: round(this.#eyes.ratioLeft, 2),
        ratioRight: round(this.#eyes.ratioRight, 2),
        scoreLeft: round(this.#eyes.scoreLeft, 2),
        scoreRight: round(this.#eyes.scoreRight, 2),
        closeScoreLeft: round(this.#closeScoreFor(ref === null ? 0 : (ref.baseScoreLeft ?? 0)), 2),
        closeScoreRight: round(this.#closeScoreFor(ref === null ? 0 : (ref.baseScoreRight ?? 0)), 2),
        openEarLeft: ref === null ? 0 : round(ref.left, 3),
        openEarRight: ref === null ? 0 : round(ref.right, 3),
        geometryValid: this.#eyes.geometryValid === true,
        referenceValid: ref !== null && ref.valid === true,
        referencePhase: this.#eyeRefPhase,
        lookDown: round(this.#eyes.lookDown, 2),
        lookUp: round(this.#eyes.lookUp, 2),
        lookEvidenceValid: this.#eyes.lookEvidenceValid === true,
        posture: this.#eyes.posture,
      },
      neutral: this.#neutral === null
        ? { yaw: 0, pitch: 0, roll: 0 }
        : { yaw: round(this.#neutral.yaw, 2), pitch: round(this.#neutral.pitch, 2), roll: round(this.#neutral.roll, 2) },
      counts: {
        closures: this.#counts.closures,
        completedBlinks: this.#counts.completedBlinks,
        acceptedBlinks: this.#counts.acceptedBlinks,
        rejectedBlinks: this.#counts.rejectedBlinks,
        moves: this.#counts.moves,
      },
      lastBlink: this.#lastBlink === null
        ? null
        : {
            durationMs: round(this.#lastBlink.durationMs, 0),
            accepted: this.#lastBlink.accepted === true,
            reason: this.#lastBlink.reason,
            selectedId: this.#lastBlink.selectedId,
          },
    };
  }

  #relativePose() {
    if (!this.#filtered.valid || this.#neutral === null) return { yaw: 0, pitch: 0, roll: 0 };
    return {
      yaw: this.#filtered.yaw - this.#neutral.yaw,
      pitch: this.#filtered.pitch - this.#neutral.pitch,
      roll: this.#filtered.roll - this.#neutral.roll,
    };
  }

  #initialRelativePose() {
    const base = this.#initialNeutral === null ? this.#neutral : this.#initialNeutral;
    if (!this.#filtered.valid || base === null) return { yaw: 0, pitch: 0, roll: 0 };
    return {
      yaw: this.#filtered.yaw - base.yaw,
      pitch: this.#filtered.pitch - base.pitch,
      roll: this.#filtered.roll - base.roll,
    };
  }

  #updateFiltered(frame, timestamp) {
    if (!this.#filtered.valid) {
      this.#filtered = { yaw: frame.yaw, pitch: frame.pitch, roll: frame.roll, valid: true, lastTimestamp: timestamp, speed: 0 };
      this.#headMotion = {anchor:{yaw:frame.yaw,pitch:frame.pitch,t:timestamp},lastActivityAt:timestamp};
      return 0;
    }
    const dt = timestamp - this.#filtered.lastTimestamp;
    if (!(dt > 0)) {
      this.#filtered.lastTimestamp = timestamp;
      return this.#filtered.speed;
    }
    const previousYaw = this.#filtered.yaw;
    const previousPitch = this.#filtered.pitch;
    const previousRoll = this.#filtered.roll;
    const alpha = 1 - Math.exp(-dt / HEAD.emaTauMs);
    this.#filtered.yaw = previousYaw + (frame.yaw - previousYaw) * alpha;
    this.#filtered.pitch = previousPitch + (frame.pitch - previousPitch) * alpha;
    this.#filtered.roll = previousRoll + (frame.roll - previousRoll) * alpha;
    this.#filtered.lastTimestamp = timestamp;
    const movedYaw = this.#filtered.yaw - previousYaw;
    const movedPitch = this.#filtered.pitch - previousPitch;
    const speed = Math.hypot(movedYaw, movedPitch) / (dt / 1000);
    this.#filtered.speed = speed;
    const anchor = this.#headMotion.anchor;
    // Differentiating frame-to-frame noise can report perpetual motion while a
    // person is still. Measure actual angular excursion over the quiet window;
    // large/fast motion still resets it and cancels a pending blink below.
    if (!anchor || speed > HEAD.motionSpeedDegPerSec ||
        Math.abs(this.#filtered.yaw-anchor.yaw) > HEAD.motionJitterDeg ||
        Math.abs(this.#filtered.pitch-anchor.pitch) > HEAD.motionJitterDeg) {
      this.#headMotion = {anchor:{yaw:this.#filtered.yaw,pitch:this.#filtered.pitch,t:timestamp},lastActivityAt:timestamp};
    } else if (timestamp - anchor.t >= HEAD.motionQuietMs) {
      // Roll the quiet window without inventing motion. Otherwise residual EMA
      // convergence accumulates against an old anchor and rejects the next blink.
      this.#headMotion.anchor = {yaw:this.#filtered.yaw,pitch:this.#filtered.pitch,t:timestamp};
    }
    return speed;
  }

  #updateLook(frame, timestamp) {
    const dl = frame.eyeLookDownLeft;
    const dr = frame.eyeLookDownRight;
    const ul = frame.eyeLookUpLeft;
    const ur = frame.eyeLookUpRight;
    const valid = frame.lookEvidenceValid === true
      && typeof dl === 'number' && Number.isFinite(dl)
      && typeof dr === 'number' && Number.isFinite(dr)
      && typeof ul === 'number' && Number.isFinite(ul)
      && typeof ur === 'number' && Number.isFinite(ur);
    if (!valid) {
      this.#look = { valid: false, down: 0, up: 0, posture: 'FORWARD', changedAt: null, stableSince: null, transitionAt: null, lastDown: 0, lastUp: 0 };
      return;
    }
    // Lids closing raise the model's gaze evidence on the closure frame itself.
    // A bilateral contraction measured against the trustworthy OPEN reference is
    // a closure, not a new posture, so hold the posture the open lids supported.
    // An absolute lid floor only caught forceful squeezes, so this decision is
    // relative and bilateral while the current model scores must corroborate it.
    // The held posture must still match the calibrated reference (or the capture)
    // before a blink can complete, so a downlook false click stays blocked.
    if (this.#closureContraction(frame)) return;
    const down = (clamp01(dl) + clamp01(dr)) / 2;
    const up = (clamp01(ul) + clamp01(ur)) / 2;
    // Hysteresis keeps posture stable when model evidence sits near 0.5, while
    // a strong bilateral gaze still enters or reverses the posture.
    const downEnter = dl >= LOOK.enterThreshold && dr >= LOOK.enterThreshold;
    const upEnter = ul >= LOOK.enterThreshold && ur >= LOOK.enterThreshold;
    const downHold = dl >= LOOK.exitThreshold && dr >= LOOK.exitThreshold;
    const upHold = ul >= LOOK.exitThreshold && ur >= LOOK.exitThreshold;
    const look = this.#look;
    let posture = 'FORWARD';
    if (downEnter || upEnter) {
      if (downEnter && upEnter) posture = down >= up ? 'DOWN' : 'UP';
      else if (downEnter) posture = 'DOWN';
      else posture = 'UP';
    } else if (look.posture === 'DOWN' && downHold) {
      posture = 'DOWN';
    } else if (look.posture === 'UP' && upHold) {
      posture = 'UP';
    }
    if (Math.abs(down - look.lastDown) > HEAD.lookTransitionDelta || Math.abs(up - look.lastUp) > HEAD.lookTransitionDelta) {
      look.transitionAt = timestamp;
    }
    if (posture !== look.posture) {
      look.posture = posture;
      look.changedAt = timestamp;
      look.stableSince = null;
    } else if (look.stableSince === null) {
      look.stableSince = timestamp;
    }
    look.valid = true;
    look.down = down;
    look.up = up;
    look.lastDown = down;
    look.lastUp = up;
  }

  // Bilateral lid contraction measured against the trustworthy OPEN reference.
  // A soft ordinary closure (about half of the measured open level) qualifies
  // without an absolute squeeze floor, while a wink or a one-sided artefact still
  // fails this bilateral geometry test. The calibrated ratio and the current model
  // scores must both corroborate before the pre-closure gaze posture is held
  // through the closed-lid frames.
  #closureContraction(frame) {
    if (frame.eyeGeometryValid !== true) return false;
    const earLeft = frame.eyeAspectLeft;
    const earRight = frame.eyeAspectRight;
    if (!(typeof earLeft === 'number' && Number.isFinite(earLeft) && earLeft >= 0)) return false;
    if (!(typeof earRight === 'number' && Number.isFinite(earRight) && earRight >= 0)) return false;
    const ref = this.#eyeRef;
    if (ref === null || ref.valid !== true) return false;
    if (!(ref.left > BLINK.minOpenEar) || !(ref.right > BLINK.minOpenEar)) return false;
    if (!(earLeft / ref.left <= this.#closeRatio()) || !(earRight / ref.right <= this.#closeRatio())) return false;
    const scoreMarginLeft = clamp01(frame.blinkLeft) - this.#closeScoreFor(ref.baseScoreLeft ?? 0);
    const scoreMarginRight = clamp01(frame.blinkRight) - this.#closeScoreFor(ref.baseScoreRight ?? 0);
    // Same eyelid corroboration as the closure state: one eye may report a
    // weaker score through glasses, but the geometry above stays bilateral.
    return (scoreMarginLeft > 0 && scoreMarginRight > 0)
      || (Math.max(scoreMarginLeft, scoreMarginRight) > 0
        && Math.min(scoreMarginLeft, scoreMarginRight) > -BLINK.scoreAsymmetryMargin);
  }

  #lookTransitionRecent(timestamp) {
    return this.#look.valid
      && this.#look.transitionAt !== null
      && timestamp - this.#look.transitionAt <= HEAD.lookStableMs
      && (this.#look.down >= 0.3 || this.#look.up >= 0.3);
  }

  #lookCancelsClosure(timestamp) {
    // Refining a still-valid reference is observable; only a genuinely
    // unusable eye signal suppresses closures. A settled non-FORWARD posture
    // that matches the calibrated reference may still blink on lower keys.
    if (this.#eyeRefStale) return true;
    if (!this.#look.valid) return false;
    const posture = this.#look.posture;
    if (posture !== 'FORWARD') {
      if (this.#eyeRef === null || this.#eyeRef.posture !== posture) return true;
    }
    if (this.#lookTransitionRecent(timestamp)) {
      if (this.#eyeRef === null || posture !== this.#eyeRef.posture || posture === 'FORWARD') return true;
    }
    return false;
  }

  // True when a pending closure was captured against a reference that the
  // settled observed posture no longer matches. Such a cycle has no measurable
  // reopen level and must be released instead of silently blinding later blinks.
  #pendingCycleObsolete(timestamp) {
    const ref = this.#eyeRef;
    if (ref === null || ref.valid !== true) return true;
    if (this.#blink.capturedPosture === null) return false;
    if (!this.#look.valid) return false;
    if (this.#look.posture === ref.posture) return false;
    if (this.#look.stableSince === null) return false;
    return timestamp - this.#look.stableSince >= HEAD.lookStableMs;
  }

  #openEvidence(frame, reference) {
    const scoreLeft = clamp01(frame.blinkLeft);
    const scoreRight = clamp01(frame.blinkRight);
    if (reference === null || reference.valid !== true) {
      return scoreLeft < BLINK.maxCalibrationScore && scoreRight < BLINK.maxCalibrationScore;
    }
    return scoreLeft < this.#closeScoreFor(reference.baseScoreLeft ?? 0)
      && scoreRight < this.#closeScoreFor(reference.baseScoreRight ?? 0);
  }

  #referenceNeedsRecovery(frame, reference) {
    if (reference === null || reference.valid !== true) return false;
    if (this.#look.valid && this.#look.posture !== reference.posture) return false;
    if (!(reference.left > 0) || !(reference.right > 0)) return false;
    const earLeft = frame.eyeAspectLeft;
    const earRight = frame.eyeAspectRight;
    if (!(frame.eyeGeometryValid === true
      && typeof earLeft === 'number' && Number.isFinite(earLeft) && earLeft > BLINK.minOpenEar
      && typeof earRight === 'number' && Number.isFinite(earRight) && earRight > BLINK.minOpenEar)) return false;
    if (!(earLeft / reference.left < BLINK.openRatio
      || earRight / reference.right < BLINK.openRatio)) return false;
    return this.#openEvidence(frame, reference);
  }

  #updateEyeReference(frame, timestamp, relative) {
    if (this.#blink.state === 'CLOSED') {
      const currentPosture = this.#look.valid ? this.#look.posture : 'FORWARD';
      const samePostureReference = this.#eyeRef !== null && this.#eyeRef.valid === true
        && this.#eyeRef.posture === currentPosture;
      if (samePostureReference
        && !this.#referenceNeedsRecovery(frame, this.#eyeRef)
        && !this.#referenceNeedsRecovery(frame, this.#forwardEyeRef)) {
        // A pending blink must also break acquisition contiguity. Otherwise
        // low-score samples on either side of closing lids could be merged.
        this.#eyeAcquire.samples = [];
        this.#eyeAcquire.startedAt = timestamp;
        return;
      }
    }
    const earLeftValue = frame.eyeAspectLeft;
    const earRightValue = frame.eyeAspectRight;
    const geometryValid = frame.eyeGeometryValid === true
      && typeof earLeftValue === 'number' && Number.isFinite(earLeftValue) && earLeftValue > BLINK.minOpenEar
      && typeof earRightValue === 'number' && Number.isFinite(earRightValue) && earRightValue > BLINK.minOpenEar;
    const nearNeutralForward = this.#look.valid
      && this.#look.posture === 'FORWARD'
      && Math.abs(relative.yaw) <= this.#neutralZone()
      && Math.abs(relative.pitch) <= this.#neutralZone()
      && this.#forwardEyeRef !== null;
    if (nearNeutralForward) {
      if (!this.#referenceNeedsRecovery(frame, this.#forwardEyeRef)) {
        if (this.#eyeRef !== this.#forwardEyeRef) {
          if (this.#blink.state === 'CLOSED') this.#rejectPendingBlink('eye_posture', timestamp);
          this.#eyeRef = this.#forwardEyeRef;
          this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
          this.#eyeRefPhase = 'READY';
          this.#eyeRefStale = false;
          this.#resetBlinkRequireOpen();
        } else {
          this.#eyeRefPhase = 'READY';
          this.#eyeRefStale = false;
        }
        return;
      }
      // Do not keep restoring an anchored open level that no longer matches
      // sustained, non-closing lids. The bounded acquisition below replaces it.
      this.#forwardEyeRef = null;
    }
    if (this.#eyeAcquire.active) {
      if (this.#look.valid && this.#look.posture !== this.#eyeAcquire.posture) {
        this.#eyeAcquire.samples = [];
        this.#eyeAcquire.startedAt = timestamp;
        this.#eyeAcquire.posture = this.#look.posture;
        this.#eyeRefPhase = this.#eyeAcquire.posture === 'DOWN' ? 'LOOKING_DOWN' : this.#eyeAcquire.posture === 'UP' ? 'LOOKING_UP' : 'ACQUIRING';
        return;
      }
      if (!geometryValid) {
        this.#eyeAcquire.samples = [];
        this.#eyeAcquire.startedAt = timestamp;
        return;
      }
      if (!this.#isHeadSettled(timestamp)) {
        this.#eyeAcquire.samples = [];
        this.#eyeAcquire.startedAt = timestamp;
        return;
      }
      const scoreLeft = clamp01(frame.blinkLeft);
      const scoreRight = clamp01(frame.blinkRight);
      const reference = this.#eyeRef;
      // The measured open lids can be below 0.16; keep the established 0.08
      // geometry floor and require independent bilateral non-closing scores.
      if (!(earLeftValue > BLINK.minOpenEar) || !(earRightValue > BLINK.minOpenEar)
        || !this.#openEvidence(frame, reference)) {
        // One unobservable, closing or high-score frame breaks contiguity. The
        // baseline is never averaged across a blink or a narrowed-lid episode.
        this.#eyeAcquire.samples = [];
        this.#eyeAcquire.startedAt = timestamp;
        return;
      }
      const samples = this.#eyeAcquire.samples;
      const previousSample = samples[samples.length - 1];
      if (previousSample && timestamp - previousSample.t > HEAD.eyeRefSampleGapMs) {
        samples.length = 0;
        this.#eyeAcquire.startedAt = timestamp;
      }
      samples.push({ earLeft: earLeftValue, earRight: earRightValue, scoreLeft, scoreRight, t: timestamp });
      if (samples.length > HEAD.eyeRefWindow) samples.shift();
      if (timestamp - samples[0].t < HEAD.eyeRefMinMs) return;
      if (samples.length < HEAD.eyeRefMinFrames) return;
      const measuredOpenLeft = median(samples.map((sample) => sample.earLeft));
      const measuredOpenRight = median(samples.map((sample) => sample.earRight));
      if (!(measuredOpenLeft > BLINK.minOpenEar) || !(measuredOpenRight > BLINK.minOpenEar)) return;
      const posture = this.#eyeAcquire.posture;
      const existing = this.#eyeRef;
      const samePosture = existing !== null && existing.valid === true && existing.posture === posture;
      // A same-posture anchor normally refines upward. Sustained lids below the
      // reopening ratio are direct evidence that the anchor is inflated, so the
      // robust median replaces it instead of being ignored by Math.max forever.
      const lowerMismatch = samePosture
        && (measuredOpenLeft < existing.left * BLINK.openRatio
          || measuredOpenRight < existing.right * BLINK.openRatio);
      const openEarLeft = samePosture && !lowerMismatch ? Math.max(existing.left, measuredOpenLeft) : measuredOpenLeft;
      const openEarRight = samePosture && !lowerMismatch ? Math.max(existing.right, measuredOpenRight) : measuredOpenRight;
      const baseLeft = median(samples.map((sample) => sample.scoreLeft));
      const baseRight = median(samples.map((sample) => sample.scoreRight));
      if (this.#blink.state === 'CLOSED') {
        // The pending closure was captured against a reference this posture/pose
        // no longer matches, so its reopen cannot be measured. Release it without
        // activation; the fresh reference makes the next blink measurable again.
        this.#rejectPendingBlink('eye_posture', timestamp);
      }
      this.#eyeRef = {
        left: openEarLeft,
        right: openEarRight,
        baseScoreLeft: baseLeft,
        baseScoreRight: baseRight,
        relYaw: relative.yaw,
        relPitch: relative.pitch,
        roll: this.#filtered.roll,
        posture,
        valid: true,
      };
      if (posture === 'FORWARD'
        && Math.abs(relative.yaw) <= this.#neutralZone()
        && Math.abs(relative.pitch) <= this.#neutralZone()) {
        this.#forwardEyeRef = this.#eyeRef;
      }
      this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
      this.#eyeRefPhase = 'READY';
      this.#eyeRefStale = false;
      this.#resetBlinkRequireOpen();
      return;
    }
    if (this.#eyeRef === null || this.#eyeRef.valid !== true) {
      // Calibration can miss usable eye samples (occlusion, too few valid geometry
      // frames). Without a live acquisition #updateEyes never reports OPEN, so
      // blinking stayed disabled at every strictness. Learn the missing open
      // reference only from settled, forward, near-neutral frames.
      if (!geometryValid) return;
      if (this.#look.valid && this.#look.posture !== 'FORWARD') return;
      if (Math.abs(relative.yaw) > this.#neutralZone()) return;
      if (Math.abs(relative.pitch) > this.#neutralZone()) return;
      if (!this.#isHeadSettled(timestamp)) return;
      if (!this.#eyeAcquire.active) {
        this.#eyeAcquire = { active: true, startedAt: timestamp, samples: [], posture: 'FORWARD' };
        this.#eyeRefPhase = 'ACQUIRING';
      }
      return;
    }
    const poseChanged = Math.abs(relative.yaw - this.#eyeRef.relYaw) > HEAD.eyeRefPoseDeltaDeg
      || Math.abs(relative.pitch - this.#eyeRef.relPitch) > HEAD.eyeRefPoseDeltaDeg;
    const postureChanged = this.#look.valid && this.#look.posture !== this.#eyeRef.posture;
    const referenceObsolete = this.#referenceNeedsRecovery(frame, this.#eyeRef);
    if (!poseChanged && !postureChanged && !referenceObsolete) {
      this.#eyeRefPhase = 'READY';
      this.#eyeRefStale = false;
      return;
    }
    // A still-valid reference stays usable while the bounded refinement runs;
    // only an unusable reference may disable blink availability.
    if (!this.#isHeadSettled(timestamp)) {
      this.#eyeRefPhase = 'WAITING';
      return;
    }
    if (postureChanged) {
      if (this.#look.stableSince === null || timestamp - this.#look.stableSince < HEAD.lookStableMs) {
        this.#eyeRefPhase = 'WAITING';
        return;
      }
    }
    const posture = this.#look.valid ? this.#look.posture : 'FORWARD';
    this.#eyeAcquire = { active: true, startedAt: timestamp, samples: [], posture };
    this.#eyeRefPhase = posture === 'DOWN' ? 'LOOKING_DOWN' : posture === 'UP' ? 'LOOKING_UP' : 'ACQUIRING';
    // The previous reference remains valid while it is being refined.
    this.#eyeRefStale = false;
  }

  #isHeadSettled(timestamp) {
    return this.#filtered.speed <= HEAD.motionSpeedDegPerSec
      && (this.#headMotion.lastActivityAt === null || timestamp - this.#headMotion.lastActivityAt >= HEAD.motionQuietMs);
  }

  #updateEyes(frame) {
    const leftEar = typeof frame.eyeAspectLeft === 'number' && Number.isFinite(frame.eyeAspectLeft) ? frame.eyeAspectLeft : 0;
    const rightEar = typeof frame.eyeAspectRight === 'number' && Number.isFinite(frame.eyeAspectRight) ? frame.eyeAspectRight : 0;
    const scoreLeft = clamp01(frame.blinkLeft);
    const scoreRight = clamp01(frame.blinkRight);
    const geometryValid = frame.eyeGeometryValid === true && leftEar > 0 && rightEar > 0;
    const ref = this.#eyeRef;
    const refValid = ref !== null && ref.valid === true && ref.left > BLINK.minOpenEar && ref.right > BLINK.minOpenEar;
    let state = 'UNRELIABLE';
    let ratioLeft = 0;
    let ratioRight = 0;
    if (geometryValid && refValid) {
      ratioLeft = leftEar / ref.left;
      ratioRight = rightEar / ref.right;
      const geometryClosedLeft = ratioLeft <= this.#closeRatio();
      const geometryClosedRight = ratioRight <= this.#closeRatio();
      // Thresholds come from the calibrated OPEN score plus the CURRENT
      // strictness, so tuning applies to every stored or acquired reference.
      const closeScoreLeft = this.#closeScoreFor(ref.baseScoreLeft ?? 0);
      const closeScoreRight = this.#closeScoreFor(ref.baseScoreRight ?? 0);
      const scoreMarginLeft = scoreLeft - closeScoreLeft;
      const scoreMarginRight = scoreRight - closeScoreRight;
      const scoreClosedLeft = scoreMarginLeft > 0;
      const scoreClosedRight = scoreMarginRight > 0;
      // Lid geometry below stays strictly bilateral. One eye can report a weaker
      // model score through glasses, so corroboration accepts a bounded deficit
      // on the quieter eye; a wink still fails the geometry evidence.
      const scoreCorroborated = (scoreClosedLeft && scoreClosedRight)
        || (Math.max(scoreMarginLeft, scoreMarginRight) > 0
          && Math.min(scoreMarginLeft, scoreMarginRight) > -BLINK.scoreAsymmetryMargin);
      const openLeft = ratioLeft >= BLINK.openRatio;
      const openRight = ratioRight >= BLINK.openRatio;
      const acquiring = this.#eyeRefStale === true;
      const posture = this.#look.valid ? this.#look.posture : 'FORWARD';
      // Closing the lids raises the model's eyeLookDown/Up evidence, so the gaze
      // label can flip after a closure was captured. A capture made while the
      // gaze matched the reference stays authoritative for that cycle only; a
      // capture made in another posture still blocks.
      const captured = this.#blink.state === 'CLOSED' ? this.#blink.capturedPosture : null;
      const trustedPosture = captured !== null && captured === ref.posture ? captured : posture;
      const lookBlocks = this.#look.valid && trustedPosture !== 'FORWARD'
        && (acquiring || ref.posture !== trustedPosture);
      const timestamp = this.#lastTimestamp ?? 0;
      const evidence = this.#eyeEvidence;
      if (lookBlocks || acquiring) {
        evidence.geometryClosedAt = null;
        evidence.scoreClosedAt = null;
      } else {
        if (geometryClosedLeft && geometryClosedRight) evidence.geometryClosedAt = timestamp;
        if (scoreCorroborated) evidence.scoreClosedAt = timestamp;
        // Evidence is only usable while recent relative to NOW, so do not pair an
        // old geometry peak with a much later score peak.
        if (evidence.geometryClosedAt !== null && timestamp - evidence.geometryClosedAt > HEAD.blinkCorrelationMs) evidence.geometryClosedAt = null;
        if (evidence.scoreClosedAt !== null && timestamp - evidence.scoreClosedAt > HEAD.blinkCorrelationMs) evidence.scoreClosedAt = null;
      }
      const correlated = evidence.geometryClosedAt !== null && evidence.scoreClosedAt !== null;
      const geometryOpenNow = openLeft && openRight;
      const wasClosed = this.#eyes.state === 'CLOSED';
      const closedLeft = geometryClosedLeft && scoreClosedLeft;
      const closedRight = geometryClosedRight && scoreClosedRight;
      // A reopen is only measurable against the posture the cycle started in. If
      // the gaze label still contradicts that posture once the lids are open, the
      // narrowing was a downlook returning, not a blink, so fail closed here and
      // let the bounded pending-cycle release retire it without pressing.
      const reopenPostureBlocks = this.#look.valid && posture !== ref.posture;
      if (lookBlocks) state = posture === 'DOWN' ? 'LOOKING_DOWN' : posture === 'UP' ? 'LOOKING_UP' : 'TRANSITION';
      else if (acquiring) state = 'TRANSITION';
      else if (geometryOpenNow && wasClosed && reopenPostureBlocks) state = 'CLOSED';
      else if (geometryOpenNow && wasClosed) {
        state = 'OPEN';
        evidence.geometryClosedAt = null;
        evidence.scoreClosedAt = null;
      } else if (correlated) state = 'CLOSED';
      else if (geometryOpenNow) state = 'OPEN';
      else if ((closedLeft && openRight) || (closedRight && openLeft)
        || (geometryClosedLeft && openRight) || (geometryClosedRight && openLeft)) state = 'ASYMMETRIC';
      else state = 'TRANSITION';
    } else if (geometryValid && !refValid) {
      state = 'TRANSITION';
      this.#eyeEvidence = { geometryClosedAt: null, scoreClosedAt: null };
    } else {
      this.#eyeEvidence = { geometryClosedAt: null, scoreClosedAt: null };
    }
    this.#eyes = {
      state,
      earLeft: leftEar,
      earRight: rightEar,
      ratioLeft,
      ratioRight,
      scoreLeft,
      scoreRight,
      geometryValid,
      lookEvidenceValid: this.#look.valid,
      lookDown: this.#look.down,
      lookUp: this.#look.up,
      posture: this.#look.posture,
      referenceValid: refValid,
      referencePhase: this.#eyeRefPhase,
    };
  }

  #headZone(relative) {
    const ay = Math.abs(relative.yaw);
    const ap = Math.abs(relative.pitch);
    const angle = this.#settings.headAngleDeg;
    const yawActive = ay >= angle;
    const pitchActive = ap >= angle;
    if (!yawActive && !pitchActive) return null;
    const horizontal = this.#settings.invertHorizontal ? -relative.yaw : relative.yaw;
    const yawDirection = horizontal > 0 ? 'right' : 'left';
    const pitchDirection = relative.pitch > 0 ? 'down' : 'up';
    // The axis that is already over the unchanged trigger owns the pending step
    // while it stays active, so a moderate cross-axis drift can no longer restart
    // the confirmation hold on the other axis every frame. Ownership is bounded:
    // the other axis re-aims the step only once it exceeds the established one by
    // a relative margin AND the absolute jitter bound, so a definite change or
    // reversal still takes over after the unchanged hold.
    const prior = this.#head.candidateDirection;
    if (prior !== null) {
      const priorIsYaw = prior === 'left' || prior === 'right';
      const priorActive = priorIsYaw ? yawActive : pitchActive;
      const otherActive = priorIsYaw ? pitchActive : yawActive;
      if (priorActive) {
        if (otherActive) {
          const priorStrength = priorIsYaw ? ay : ap;
          const otherStrength = priorIsYaw ? ap : ay;
          const dominance = Math.max(HEAD.motionJitterDeg, priorStrength * AXIS_DOMINANCE_RATIO);
          if (otherStrength - priorStrength > dominance) {
            return priorIsYaw ? pitchDirection : yawDirection;
          }
        }
        return priorIsYaw ? yawDirection : pitchDirection;
      }
    }
    if (yawActive && pitchActive) {
      // With no established intent a near tie is an ambiguous diagonal. Wait for
      // clear dominance instead of resolving the tie to horizontal.
      const tieMargin = Math.max(HEAD.motionJitterDeg, Math.min(ay, ap) * AXIS_DOMINANCE_RATIO);
      if (Math.abs(ay - ap) <= tieMargin) return null;
      return ay > ap ? yawDirection : pitchDirection;
    }
    return yawActive ? yawDirection : pitchDirection;
  }

  #updateHead(timestamp, relative) {
    if (this.#neutral === null || this.#paused) return;
    if (this.#navigation.phase === 'RETURNING') {
      this.#updateReturning(timestamp);
      return;
    }
    if (this.#blink.state === 'CLOSED' || this.#mouthGesture !== null) {
      // Freeze selection only while a face action is actually pending, so a lost
      // or disabled mouth signal can never block head navigation.
      this.#clearHeadCandidate();
      return;
    }
    const direction = this.#headZone(relative);
    if (direction === null) {
      if (Math.abs(relative.yaw) <= this.#neutralZone() && Math.abs(relative.pitch) <= this.#neutralZone()) {
        this.#head.latchedDirection = null;
      }
      this.#clearHeadCandidate();
      return;
    }
    if (this.#head.latchedDirection === direction) {
      this.#clearHeadCandidate();
      return;
    }
    const head = this.#head;
    if (head.candidateDirection !== direction) {
      head.candidateDirection = direction;
      head.candidateSince = timestamp;
      return;
    }
    if (head.candidateSince === null) {
      head.candidateSince = timestamp;
      return;
    }
    if (timestamp - head.candidateSince >= HEAD.holdMs) this.#commitMove(direction, timestamp);
  }

  #updateReturning(timestamp) {
    const nav = this.#navigation;
    if (nav.phase !== 'RETURNING') return;
    this.#head.candidateDirection = null;
    this.#head.candidateSince = null;
    if (nav.deadline === null) nav.deadline = (nav.stepAt ?? timestamp) + this.#settings.reactionDelayMs;
    // Keep the return pause and pose acquisition separate. Otherwise a held
    // deflection becomes the new center at the pause deadline and the person's
    // actual return is interpreted as a second step in the opposite direction.
    nav.awaitingStablePose = timestamp >= nav.deadline;
    if (timestamp < nav.deadline) {
      nav.stableSamples = [];
      return;
    }
    // A settings update can extend the original step deadline. Observations
    // before that deadline cannot establish the new post-pause neutral.
    nav.stableSamples = nav.stableSamples.filter(sample => sample.t >= nav.deadline);
    if (nav.stableSamples.length > 0) {
      const lastSample = nav.stableSamples[nav.stableSamples.length - 1];
      if (timestamp - lastSample.t > HEAD.returnSampleGapMs) nav.stableSamples = [];
    }
    // Space observations by time so the bounded window still covers 180ms even
    // when input arrives faster than the window needs.
    const previousSample = nav.stableSamples[nav.stableSamples.length - 1];
    if (!previousSample || timestamp - previousSample.t >= HEAD.returnSampleSpacingMs) {
      nav.stableSamples.push({ yaw: this.#filtered.yaw, pitch: this.#filtered.pitch, roll: this.#filtered.roll, t: timestamp });
      if (nav.stableSamples.length > HEAD.returnMaxSamples) nav.stableSamples.shift();
    }
    const candidate = this.#returnWindowCandidate(timestamp);
    if (candidate === null) return;
    const initial = this.#initialNeutral;
    if (initial !== null && (Math.abs(candidate.yaw - initial.yaw) > HEAD.largeYawDeg || Math.abs(candidate.pitch - initial.pitch) > HEAD.largePitchDeg)) {
      nav.stableSamples = [];
      nav.awaitingStablePose = true;
      return;
    }
    this.#completeRecenter(candidate, timestamp);
  }

  // A bounded recent pose window owns return stability. The median and quartile
  // spread tolerate an isolated estimator outlier without clearing the history;
  // a stale first half, endpoint drift, or unstable newest tail still rejects a
  // genuine moving return. The per-frame derivative remains a blink/navigation
  // motion signal, not a second RETURNING veto.
  #returnWindowCandidate(timestamp) {
    const samples = this.#navigation.stableSamples;
    if (samples.length < 2) return null;
    const last = samples[samples.length - 1];
    if (timestamp - last.t > HEAD.returnSampleGapMs) return null;
    const cutoff = last.t - HEAD.returnStableWindowMs;
    let start = samples.length - 1;
    while (start > 0 && samples[start - 1].t >= cutoff) start -= 1;
    // Keep a preceding observation only when no sample lands on the boundary;
    // otherwise FPS that divides 180ms would unnecessarily lengthen the window.
    if (start > 0 && samples[start].t > cutoff) start -= 1;
    const recent = samples.slice(start);
    if (recent.length < 2) return null;
    if (last.t - recent[0].t < HEAD.returnStableWindowMs) return null;
    const candidate = {
      yaw: median(recent.map((sample) => sample.yaw)),
      pitch: median(recent.map((sample) => sample.pitch)),
      roll: median(recent.map((sample) => sample.roll)),
    };
    for (const axis of ['yaw', 'pitch', 'roll']) {
      const values = recent.map((sample) => sample[axis]);
      const center = candidate[axis];
      if (Math.abs(this.#filtered[axis] - center) > HEAD.motionJitterDeg) return null;
      if (recent.length <= 3) {
        if (Math.max(...values) - Math.min(...values) > HEAD.motionJitterDeg) return null;
        continue;
      }
      if (upperQuartile(values) - quantile(values, 0.25) > HEAD.motionJitterDeg) return null;
      if (Math.abs(values[values.length - 1] - values[0]) > HEAD.motionJitterDeg) return null;
      const half = values.length >> 1;
      const firstHalf = values.slice(0, half);
      const lastHalf = values.slice(values.length - half);
      if (Math.abs(median(firstHalf) - median(lastHalf)) > HEAD.motionJitterDeg) return null;
      const tail = values.slice(-3);
      if (Math.max(...tail) - Math.min(...tail) > HEAD.motionJitterDeg) return null;
    }
    return candidate;
  }

  #completeRecenter(candidate, timestamp) {
    const previous = this.#neutral;
    const faceScale = previous === null ? 0 : previous.faceScale;
    this.#neutral = {
      yaw: candidate.yaw,
      pitch: candidate.pitch,
      roll: candidate.roll,
      faceScale,
      samples: this.#navigation.stableSamples.length,
      completedAt: timestamp,
    };
    if (previous !== null) {
      const deltaYaw = candidate.yaw - previous.yaw;
      const deltaPitch = candidate.pitch - previous.pitch;
      const ref = this.#eyeRef;
      if (ref !== null && ref.valid === true) {
        this.#eyeRef = { ...ref, relYaw: ref.relYaw - deltaYaw, relPitch: ref.relPitch - deltaPitch };
      }
    }
    this.#forwardEyeRef = null;
    this.#filtered = { ...this.#filtered, valid: true, speed: 0, lastTimestamp: timestamp };
    // Rebasing coordinates is not physical motion; keep blink readiness intact.
    this.#headMotion = { ...this.#headMotion, anchor: { yaw: this.#filtered.yaw, pitch: this.#filtered.pitch, t: timestamp } };
    this.#head = { latchedDirection: null, candidateDirection: null, candidateSince: null, lastMoveAt: null };
    this.#navigation = { phase: 'READY', locked: false, stepAt: null, deadline: null, recenters: this.#navigation.recenters + 1, awaitingStablePose: false, stableSamples: [] };
    this.#lastRelative = this.#relativePose();
  }

  #cancelNavigation() {
    this.#navigation = { phase: 'READY', locked: false, stepAt: null, deadline: null, recenters: this.#navigation.recenters, awaitingStablePose: false, stableSamples: [] };
  }

  #navigationStatus() {
    const nav = this.#navigation;
    const remainingMs = nav.phase === 'RETURNING' && nav.deadline !== null
      ? Math.max(0, round(nav.deadline - (this.#lastTimestamp ?? nav.deadline), 0))
      : 0;
    return {
      phase: nav.phase,
      locked: nav.locked === true,
      remainingMs,
      awaitingStablePose: nav.awaitingStablePose === true,
      recenters: nav.recenters,
    };
  }

  #blinkAvailability() {
    // Exactly one source is live: blink clicks are silenced for mouth/external.
    if (this.#clickSource !== 'blink') return { ready: false, reason: 'source_disabled' };
    if (this.#paused) return { ready: false, reason: 'camera_paused' };
    if (this.#phase === 'FACE_LOST' || this.#phase === 'LOW_CONFIDENCE') return { ready: false, reason: 'face_lost' };
    if (this.#selection.activeSurface !== 'keyboard') return { ready: false, reason: 'modal_open' };
    if (this.#blink.state === 'CLOSED' || this.#eyes.state === 'CLOSED') return { ready: false, reason: 'closed' };
    if (this.#eyeRef === null || this.#eyeRef.valid !== true || this.#eyes.referenceValid !== true || this.#eyeRefStale) return { ready: false, reason: 'eye_reference' };
    if (this.#eyes.state === 'UNRELIABLE' || this.#eyes.state === 'TRANSITION' || this.#eyes.state === 'ASYMMETRIC') return { ready: false, reason: 'eyes_unreliable' };
    if (this.#eyes.state === 'LOOKING_DOWN' || this.#eyes.state === 'LOOKING_UP' || this.#lookCancelsClosure(this.#lastTimestamp ?? 0)) return { ready: false, reason: 'eye_posture' };
    if (!this.#isHeadSettled(this.#lastTimestamp ?? 0) || this.#filtered.speed > HEAD.motionSpeedDegPerSec) return { ready: false, reason: 'head_motion' };
    if (this.#blink.state !== 'OPEN' || this.#eyes.state !== 'OPEN') return { ready: false, reason: 'eyes_unreliable' };
    if (this.#selection.selectedId === null) return { ready: false, reason: 'eye_reference' };
    return { ready: true, reason: null };
  }

  #commitMove(direction, timestamp) {
    if (this.#paused || this.#inflight !== null || this.#navigation.phase !== 'READY' || this.#navigation.locked) return;
    this.#head.latchedDirection = direction;
    this.#head.candidateDirection = null;
    this.#head.candidateSince = null;
    this.#head.lastMoveAt = timestamp;
    this.#counts.moves += 1;
    this.#navigation = {
      phase: 'RETURNING',
      locked: true,
      stepAt: timestamp,
      deadline: timestamp + this.#settings.reactionDelayMs,
      recenters: this.#navigation.recenters,
      awaitingStablePose: false,
      stableSamples: [],
    };
    const relative = this.#relativePose();
    const axis = direction === 'left' || direction === 'right' ? 'yaw' : 'pitch';
    const threshold = axis === 'yaw' ? this.#settings.doubleStepAngleDeg : this.#settings.doubleStepVerticalAngleDeg;
    const steps = this.#settings.doubleStepEnabled === true
      && Math.abs(relative[axis]) >= threshold
      ? 2
      : 1;
    this.#runCommand('move', () => this.#move(direction, steps), null, null);
  }

  #clearHeadCandidate() {
    this.#head.candidateDirection = null;
    this.#head.candidateSince = null;
  }

  #resetHead() {
    this.#head = { latchedDirection: null, candidateDirection: null, candidateSince: null, lastMoveAt: null };
  }

  #resetBlinkRequireOpen() {
    this.#blink = { state: 'REQUIRE_OPEN', closedAt: null, pending: null, snapshotPose: null, blocked: false, capturedPosture: null };
    this.#eyeEvidence = { geometryClosedAt: null, scoreClosedAt: null };
  }

  #updateBlink(timestamp, speed, relative) {
    if (this.#clickSource !== 'blink') {
      // A disabled source must not emit automatic blink clicks, and a closure it
      // cannot use must not freeze head navigation either.
      this.#blink = { state: 'OPEN', closedAt: null, pending: null, snapshotPose: null, blocked: false, capturedPosture: null };
      return;
    }
    const blink = this.#blink;
    const eyes = this.#eyes;
    if (eyes.state === 'UNRELIABLE' || eyes.referenceValid !== true) {
      if (blink.state === 'CLOSED') {
        this.#rejectPendingBlink('eye_signal_unreliable', timestamp);
        return;
      }
      this.#resetBlinkRequireOpen();
      // Unobservable eyelids disable clicks only. Clearing the head candidate
      // here every frame would prevent its hold timer from ever completing.
      return;
    }
    if (blink.state === 'REQUIRE_OPEN') {
      if (eyes.state === 'OPEN') {
        blink.state = 'OPEN';
        blink.blocked = false;
      }
      return;
    }
    if (blink.state === 'OPEN') {
      if (eyes.state !== 'CLOSED') {
        blink.blocked = false;
        return;
      }
      const settled = this.#isHeadSettled(timestamp) && speed <= HEAD.motionSpeedDegPerSec;
      const lookBlocks = this.#lookCancelsClosure(timestamp);
      if (!settled || lookBlocks) {
        blink.blocked = true;
        return;
      }
      if (blink.blocked) return;
      blink.state = 'CLOSED';
      blink.closedAt = timestamp;
      blink.pending = this.#captureSnapshot();
      blink.snapshotPose = { yaw: this.#filtered.yaw, pitch: this.#filtered.pitch };
      blink.capturedPosture = this.#look.valid ? this.#look.posture : null;
      blink.blocked = false;
      this.#counts.closures += 1;
      this.#clearHeadCandidate();
      return;
    }
    if (blink.state === 'CLOSED') {
      const snapshot = blink.snapshotPose;
      if (snapshot !== null && (Math.abs(this.#filtered.yaw - snapshot.yaw) > HEAD.blinkPoseExcursionDeg || Math.abs(this.#filtered.pitch - snapshot.pitch) > HEAD.blinkPoseExcursionDeg)) {
        this.#rejectPendingBlink('head_motion', timestamp);
        return;
      }
      // Recovery: this cycle was captured against a reference the observed
      // posture no longer matches, and the lids are not currently closed. That
      // reopen can never be measured against the stale reference, so release the
      // uncertain cycle without activating it and let the reference re-learn.
      const geometryReopened = eyes.ratioLeft >= BLINK.openRatio && eyes.ratioRight >= BLINK.openRatio;
      if (eyes.state !== 'OPEN' && this.#pendingCycleObsolete(timestamp)
        && (eyes.state !== 'CLOSED' || geometryReopened)) {
        this.#rejectPendingBlink('eye_posture', timestamp);
        return;
      }
      if (eyes.state === 'CLOSED') return;
      if (eyes.state !== 'OPEN') return;
      const duration = blink.closedAt === null ? 0 : Math.max(0, timestamp - blink.closedAt);
      const pending = blink.pending;
      blink.state = 'OPEN';
      blink.closedAt = null;
      blink.pending = null;
      blink.snapshotPose = null;
      blink.capturedPosture = null;
      blink.blocked = false;
      this.#counts.completedBlinks += 1;
      this.#clearHeadCandidate();
      const reason = this.#blinkRejectReason(pending);
      if (reason !== null) {
        this.#counts.rejectedBlinks += 1;
        this.#lastBlink = { durationMs: duration, accepted: false, reason, selectedId: pending === null ? null : pending.selectedId, activationId: null };
        return;
      }
      const activationId = ++this.#activationSeq;
      this.#lastBlink = { durationMs: duration, accepted: false, reason: null, selectedId: pending.selectedId, activationId };
      this.#enqueueActivation({ id: activationId, kind: 'activate', source: 'blink', durationMs: duration, selectedId: pending.selectedId, geometryVersion: pending.geometryVersion, textRevision: pending.textRevision, epoch: this.#epoch });
    }
  }

  #captureSnapshot() {
    return {
      selectedId: this.#selection.selectedId,
      geometryVersion: this.#selection.geometryVersion,
      activeSurface: this.#selection.activeSurface,
      textRevision: this.#selection.textRevision,
      epoch: this.#epoch,
    };
  }

  #blinkRejectReason(pending) {
    if (pending === null) return 'face_lost';
    if (pending.activeSurface !== 'keyboard' || this.#selection.activeSurface !== 'keyboard') return 'modal_open';
    if (pending.epoch !== this.#epoch) return 'selection_changed';
    if (pending.selectedId === null || pending.selectedId !== this.#selection.selectedId) return 'selection_changed';
    if (pending.geometryVersion !== this.#selection.geometryVersion) return 'geometry_changed';
    if (!this.#eyes.geometryValid || !this.#eyes.referenceValid) return 'eye_signal_unreliable';
    return null;
  }

  #rejectPendingBlink(reason, timestamp) {
    const blink = this.#blink;
    if (blink.state !== 'CLOSED') return;
    const duration = blink.closedAt === null ? 0 : Math.max(0, timestamp - blink.closedAt);
    const pending = blink.pending;
    this.#counts.completedBlinks += 1;
    this.#counts.rejectedBlinks += 1;
    this.#lastBlink = { durationMs: duration, accepted: false, reason, selectedId: pending === null ? null : pending.selectedId, activationId: null };
    this.#resetBlinkRequireOpen();
    this.#clearHeadCandidate();
  }

  #enqueueActivation(entry) {
    if (this.#activationQueue.length >= MAX_ACTIVATION_QUEUE) {
      this.#rejectActivation(entry, 'callback_failed');
      this.#fault(entry.kind);
      return;
    }
    this.#activationQueue.push(entry);
    this.#pumpActivations();
  }

  #pumpActivations() {
    if (this.#paused || this.#inflight !== null) return;
    const entry = this.#activationQueue.shift();
    if (entry === undefined) return;
    if (entry.epoch !== this.#epoch) {
      this.#rejectActivation(entry, 'selection_changed');
      this.#pumpActivations();
      return;
    }
    if (entry.kind === 'backspace' && this.#backspace === null) {
      this.#rejectActivation(entry, 'action_unavailable');
      this.#pumpActivations();
      return;
    }
    // Both face actions share the single existing serialization slot, so a
    // head step and a face action can never take effect at the same time.
    const started = this.#runCommand(
      entry.kind,
      () => (entry.kind === 'backspace'
        ? this.#backspace({ selectedId: entry.selectedId, geometryVersion: entry.geometryVersion, textRevision: entry.textRevision })
        : this.#activate({ selectedId: entry.selectedId, geometryVersion: entry.geometryVersion, textRevision: entry.textRevision })),
      () => this.#onActivationSuccess(entry),
      () => this.#onActivationFailure(entry),
    );
    if (!started && !this.#paused) this.#activationQueue.unshift(entry);
  }

  #onActivationSuccess(entry) {
    if (entry.source === 'mouth') {
      if (entry.kind === 'backspace') this.#mouthCounts.deletes += 1;
      else this.#mouthCounts.clicks += 1;
      this.#mouthLastAction = { kind: entry.kind, accepted: true, reason: null };
      return;
    }
    this.#counts.acceptedBlinks += 1;
    if (this.#lastBlink !== null && this.#lastBlink.activationId === entry.id) {
      this.#lastBlink = { ...this.#lastBlink, accepted: true, reason: null };
    }
  }

  #onActivationFailure(entry) {
    this.#rejectActivation(entry, 'callback_failed');
  }

  // Counters follow the real effect: a mouth click/delete is only counted once
  // its callback resolved, and a refused one never looks like success.
  #rejectActivation(entry, reason) {
    if (entry.source === 'mouth') {
      this.#mouthCounts.rejected += 1;
      this.#mouthLastAction = { kind: entry.kind, accepted: false, reason };
      return;
    }
    this.#counts.rejectedBlinks += 1;
    if (this.#lastBlink !== null && this.#lastBlink.activationId === entry.id) {
      this.#lastBlink = { ...this.#lastBlink, accepted: false, reason };
    }
  }

  #runCommand(kind, invoke, onSuccess, onFailure) {
    if (this.#inflight !== null || this.#paused) return false;
    const token = ++this.#commandSeq;
    const epoch = this.#epoch;
    this.#inflight = { kind, token, epoch, onSuccess, onFailure };
    let result;
    try {
      result = invoke();
    } catch (error) {
      this.#inflight = null;
      if (typeof onFailure === 'function') onFailure();
      this.#fault(kind);
      return false;
    }
    if (result && typeof result.then === 'function') {
      result.then(
        () => this.#settleCommand(token, epoch, false),
        () => this.#settleCommand(token, epoch, true),
      );
    } else {
      this.#settleCommand(token, epoch, false);
    }
    return true;
  }

  #settleCommand(token, epoch, failed) {
    const inflight = this.#inflight;
    if (inflight === null || inflight.token !== token) return;
    this.#inflight = null;
    if (epoch !== this.#epoch) {
      this.#pumpActivations();
      this.#notify();
      return;
    }
    if (failed) {
      if (typeof inflight.onFailure === 'function') inflight.onFailure();
      this.#fault(inflight.kind);
      return;
    }
    if (typeof inflight.onSuccess === 'function') inflight.onSuccess();
    this.#pumpActivations();
    this.#notify();
  }

  #computeCalibration(samples) {
    if (!Array.isArray(samples) || samples.length < HEAD.calibrationMinSamples) return null;
    const span = samples[samples.length - 1].t - samples[0].t;
    if (!(span >= HEAD.calibrationMinMs)) return null;
    if (!poseStable(samples)) return null;
    const faceScale = median(samples.map((sample) => sample.faceScale));
    if (!(faceScale > 0)) return null;
    // Head pose is independently observable when glasses obscure the eyelids.
    // Missing eye samples must disable clicks, not prevent head calibration.
    const eyeSamples = samples.filter(sample => sample.eyeGeometryValid
      && Number.isFinite(sample.earLeft) && sample.earLeft > BLINK.minOpenEar
      && Number.isFinite(sample.earRight) && sample.earRight > BLINK.minOpenEar
      && sample.leftScore < BLINK.maxCalibrationScore && sample.rightScore < BLINK.maxCalibrationScore);
    const openEarLeft = upperQuartile(eyeSamples.map(sample => sample.earLeft));
    const openEarRight = upperQuartile(eyeSamples.map(sample => sample.earRight));
    const eyeReferenceValid = eyeSamples.length >= HEAD.eyeRefMinFrames
      && openEarLeft > BLINK.minOpenEar && openEarRight > BLINK.minOpenEar;
    // Store the OPEN score baseline, not a precomputed threshold: manual
    // strictness must be able to re-derive the threshold without recalibration.
    const baseScoreLeft = median(eyeSamples.map(sample => sample.leftScore));
    const baseScoreRight = median(eyeSamples.map(sample => sample.rightScore));
    return {
      yaw: median(samples.map((sample) => sample.yaw)),
      pitch: median(samples.map((sample) => sample.pitch)),
      roll: median(samples.map((sample) => sample.roll)),
      faceScale,
      eyeReferenceValid,
      openEarLeft,
      openEarRight,
      baseScoreLeft,
      baseScoreRight,
    };
  }

  #collectCalibrationSample(frame, timestamp) {
    const calibration = this.#calibration;
    if (!calibration.active) return;
    const earLeft = frame.eyeAspectLeft;
    const earRight = frame.eyeAspectRight;
    const leftScore = clamp01(frame.blinkLeft);
    const rightScore = clamp01(frame.blinkRight);
    if (!(frame.faceScale > 0)) return;
    if (calibration.startedAt === null) calibration.startedAt = timestamp;
    if (calibration.samples.length >= HEAD.calibrationMaxSamples) {
      calibration.samples = [];
      calibration.startedAt = timestamp;
    }
    calibration.samples.push({
      yaw: frame.yaw,
      pitch: frame.pitch,
      roll: frame.roll,
      faceScale: frame.faceScale,
      earLeft,
      earRight,
      eyeGeometryValid: frame.eyeGeometryValid === true,
      leftScore,
      rightScore,
      t: timestamp,
    });
    if (calibration.samples.length < HEAD.calibrationMinSamples) return;
    if (timestamp - calibration.startedAt < HEAD.calibrationMinMs) return;
    if (!poseStable(calibration.samples)) {
      calibration.samples = [];
      calibration.startedAt = timestamp;
      return;
    }
    const neutral = this.#computeCalibration(calibration.samples);
    if (neutral === null) {
      calibration.samples = [];
      calibration.startedAt = timestamp;
      if (this.#lastError !== ERROR_CALLBACK_FAILED) this.#lastError = ERROR_EYE_SIGNAL;
      return;
    }
    this.#neutral = {
      yaw: neutral.yaw,
      pitch: neutral.pitch,
      roll: neutral.roll,
      faceScale: neutral.faceScale,
      samples: calibration.samples.length,
      completedAt: timestamp,
    };
    this.#initialNeutral = this.#neutral;
    this.#cancelNavigation();
    // Only explicit calibration can replace this head neutral. Eye references
    // below may adapt without moving it or claiming a usable blink signal.
    this.#forwardEyeRef = neutral.eyeReferenceValid ? {
      left: neutral.openEarLeft,
      right: neutral.openEarRight,
      baseScoreLeft: neutral.baseScoreLeft,
      baseScoreRight: neutral.baseScoreRight,
      relYaw: 0,
      relPitch: 0,
      roll: neutral.roll,
      posture: 'FORWARD',
      valid: true,
    } : null;
    this.#eyeRef = this.#forwardEyeRef;
    this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
    this.#eyeRefPhase = this.#eyeRef === null ? 'NONE' : 'READY';
    this.#eyeRefStale = false;
    this.#filtered = { yaw: neutral.yaw, pitch: neutral.pitch, roll: neutral.roll, valid: true, lastTimestamp: timestamp, speed: 0 };
    this.#headMotion = {anchor:{yaw:neutral.yaw,pitch:neutral.pitch,t:timestamp},lastActivityAt:null};
    this.#resetHead();
    calibration.active = false;
    calibration.samples = [];
    calibration.startedAt = null;
    this.#updateLook(frame, timestamp);
    this.#updateEyes(frame);
    this.#blink = { state: this.#eyes.state === 'OPEN' ? 'OPEN' : 'REQUIRE_OPEN', closedAt: null, pending: null, snapshotPose: null, blocked: false, capturedPosture: null };
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#lastError = null;
    this.#operational = true;
    this.#phase = 'TRACKING';
    this.#notify();
  }

  #handleDegraded(reason, frame, timestamp) {
    this.#lastConfidence = clamp01(frame.confidence);
    if (this.#navigation.phase === 'RETURNING') {
      this.#navigation.stableSamples = [];
      this.#navigation.locked = true;
      this.#navigation.awaitingStablePose = this.#navigation.deadline !== null && timestamp >= this.#navigation.deadline;
    }
    const rejectReason = reason === 'low_confidence' ? 'low_confidence' : 'face_lost';
    this.#filtered = { ...this.#filtered, valid: false, speed: 0 };
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#rejectPendingBlink(rejectReason, timestamp);
    this.#cancelTransient();
    if (this.#calibration.active) {
      this.#calibration.samples = [];
      this.#calibration.startedAt = null;
    }
    this.#operational = false;
    this.#phase = reason === 'low_confidence' ? 'LOW_CONFIDENCE' : 'FACE_LOST';
    this.#notify();
  }

  #cancelTransient() {
    this.#epoch += 1;
    this.#resetHead();
    this.#resetBlinkRequireOpen();
    this.#activationQueue.length = 0;
    this.#cancelMouthCycle();
    this.#mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
    this.#mouthSamples.length = 0;
    this.#eyeAcquire = { active: false, startedAt: null, samples: [], posture: 'FORWARD' };
    this.#eyeRefPhase = this.#eyeRef === null ? 'NONE' : 'READY';
    this.#eyeRefStale = false;
    this.#look = { valid: false, down: 0, up: 0, posture: 'FORWARD', changedAt: null, stableSince: null, transitionAt: null, lastDown: 0, lastUp: 0 };
    this.#operational = false;
  }

  // Mouth evidence lives beside the head/blink path on purpose: losing eye data
  // must not disable mouth, and losing mouth data must not disable head or blink.
  #updateMouth(timestamp, frame) {
    if (this.#clickSource !== 'mouth') {
      this.#mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
      this.#mouthSamples.length = 0;
      return;
    }
    const pucker = frame.mouthPucker;
    const jawOpen = frame.jawOpen;
    const gap = frame.lipGapRatio;
    const width = frame.mouthWidthRatio;
    // Producer flags are advisory: the controller re-checks the exact numbers it
    // uses so a malformed or partial frame can never form a gesture.
    const signalValid = frame.mouthSignalValid === true
      && frame.mouthGeometryValid === true
      && typeof pucker === 'number' && Number.isFinite(pucker) && pucker >= 0 && pucker <= 1
      && typeof jawOpen === 'number' && Number.isFinite(jawOpen) && jawOpen >= 0 && jawOpen <= 1
      && typeof gap === 'number' && Number.isFinite(gap) && gap >= 0
      && typeof width === 'number' && Number.isFinite(width) && width > 0;
    if (!signalValid) {
      // Fail closed: no reference sample, no gesture, and no held pose survives.
      this.#cancelMouthCycle();
      this.#mouthSamples.length = 0;
      this.#mouth = { pucker: 0, jawOpen: 0, gap: 0, width: 0, signalValid: false };
      return;
    }
    this.#mouth = { pucker, jawOpen, gap, width, signalValid: true };
    const neutral = pucker < MOUTH.neutralPucker && jawOpen < MOUTH.neutralJaw && gap < MOUTH.neutralGap;
    if (this.#mouthReference === null) {
      this.#acquireMouthNeutral(timestamp, neutral);
      return;
    }
    if (this.#mouthGesture !== null && this.#mouthSnapshot !== null) {
      const pose = this.#mouthSnapshot.pose;
      const limit = Math.max(this.#settings.headAngleDeg, HEAD.poseMadDeg);
      // A kiss or jaw drop moves the tracked head about two degrees, so the blink
      // 1.25deg guard is wrong here; only a real excursion past the configured
      // head threshold cancels. Coordinates are absolute, so a return rebase is
      // not physical motion and cannot cancel a safe cycle.
      if (Math.abs(this.#filtered.yaw - pose.yaw) > limit || Math.abs(this.#filtered.pitch - pose.pitch) > limit) {
        this.#cancelMouthCycle();
      }
    }
    if (this.#mouthGesture !== null) {
      if (neutral) {
        this.#completeMouthGesture();
      } else if ((this.#mouthGesture === 'kiss' && (jawOpen >= 0.3 || this.#isDeleteShape(pucker, jawOpen, gap)))
        || (this.#mouthGesture === 'open' && pucker >= MOUTH.kissPucker)) {
        // Straight from one shape into the other without an observed neutral is
        // ambiguous: fire neither action and require a real neutral rearm.
        this.#cancelMouthCycle();
      }
      return;
    }
    if (neutral) {
      this.#mouthBlocked = false;
      return;
    }
    if (this.#mouthBlocked || !this.#canStartMouthGesture(timestamp)) return;
    const kiss = this.#isKissShape(pucker, jawOpen, gap, width);
    const remove = this.#isDeleteShape(pucker, jawOpen, gap);
    if (!kiss && !remove) return;
    this.#mouthGesture = kiss ? 'kiss' : 'open';
    this.#mouthSnapshot = {
      ...this.#captureSnapshot(),
      pose: { yaw: this.#filtered.yaw, pitch: this.#filtered.pitch },
    };
    this.#clearHeadCandidate();
  }

  #acquireMouthNeutral(timestamp, neutral) {
    const samples = this.#mouthSamples;
    if (!neutral || !this.#isHeadSettled(timestamp)) {
      samples.length = 0;
      return;
    }
    const previous = samples[samples.length - 1];
    if (previous !== undefined && timestamp - previous.t > MOUTH.sampleGapMs) samples.length = 0;
    samples.push({ pucker: this.#mouth.pucker, jawOpen: this.#mouth.jawOpen, gap: this.#mouth.gap, width: this.#mouth.width, t: timestamp });
    if (samples.length > MOUTH.refWindow) samples.shift();
    if (samples.length < MOUTH.refMinSamples) return;
    if (timestamp - samples[0].t < MOUTH.refMinMs) return;
    const pucker = median(samples.map((sample) => sample.pucker));
    const jawOpen = median(samples.map((sample) => sample.jawOpen));
    const gap = median(samples.map((sample) => sample.gap));
    const width = median(samples.map((sample) => sample.width));
    if (!(width > 0)) return;
    this.#mouthReference = { pucker, jawOpen, gap, width };
    samples.length = 0;
  }

  // A kiss is a strong pucker that rose from the measured neutral while the
  // jaw stayed closed and the mouth narrowed relative to the neutral width.
  // Every corroborator is required, so one noisy score cannot fire it alone.
  #isKissShape(pucker, jawOpen, gap, width) {
    const reference = this.#mouthReference;
    if (reference === null) return false;
    if (!(pucker >= MOUTH.kissPucker)) return false;
    if (!(pucker - reference.pucker >= MOUTH.kissPuckerRise)) return false;
    if (!(jawOpen - reference.jawOpen <= MOUTH.kissJawRise)) return false;
    if (!(gap < MOUTH.kissGap)) return false;
    return width <= MOUTH.kissWidthRatio * reference.width;
  }

  // A delete is a real vertical gap that grew from the measured neutral and a
  // jaw that opened relative to neutral, with no strong pucker competing.
  #isDeleteShape(pucker, jawOpen, gap) {
    const reference = this.#mouthReference;
    if (reference === null) return false;
    if (!(gap >= MOUTH.deleteGap)) return false;
    if (!(gap - reference.gap >= MOUTH.deleteGapRise)) return false;
    if (!(jawOpen - reference.jawOpen >= MOUTH.deleteJawRise)) return false;
    return pucker < MOUTH.deletePucker;
  }

  #canStartMouthGesture(timestamp) {
    // A gesture may only start from a reliable settled pose over a valid target.
    return !this.#paused
      && this.#neutral !== null
      && this.#selection.activeSurface === 'keyboard'
      && this.#selection.selectedId !== null
      && this.#isHeadSettled(timestamp);
  }

  #completeMouthGesture() {
    const gesture = this.#mouthGesture;
    const snapshot = this.#mouthSnapshot;
    this.#mouthGesture = null;
    this.#mouthSnapshot = null;
    if (gesture === null || snapshot === null) return;
    const kind = gesture === 'kiss' ? 'activate' : 'backspace';
    if (kind === 'backspace') {
      if (this.#backspace === null) {
        // No real delete effect exists, so refuse instead of faking success.
        this.#rejectMouthAction(kind, 'action_unavailable');
        return;
      }
      if (!Number.isSafeInteger(snapshot.textRevision) || snapshot.textRevision < 0) {
        // An absent or invalid revision can never authorise an edit.
        this.#rejectMouthAction(kind, 'text_revision_unavailable');
        return;
      }
    }
    this.#enqueueActivation({
      id: ++this.#activationSeq,
      kind,
      source: 'mouth',
      selectedId: snapshot.selectedId,
      geometryVersion: snapshot.geometryVersion,
      textRevision: snapshot.textRevision,
      epoch: snapshot.epoch,
    });
  }

  #rejectMouthAction(kind, reason) {
    this.#mouthCounts.rejected += 1;
    this.#mouthLastAction = { kind, accepted: false, reason };
  }

  #cancelMouthCycle() {
    this.#mouthGesture = null;
    this.#mouthSnapshot = null;
    // A held shape must not re-fire: a neutral pose is required to rearm.
    this.#mouthBlocked = true;
  }

  #mouthAvailability() {
    if (this.#clickSource !== 'mouth') return { ready: false, reason: 'source_disabled' };
    if (this.#paused) return { ready: false, reason: 'camera_paused' };
    if (this.#phase === 'FACE_LOST' || this.#phase === 'LOW_CONFIDENCE') return { ready: false, reason: 'face_lost' };
    if (this.#calibration.active) return { ready: false, reason: 'calibrating' };
    if (this.#neutral === null) return { ready: false, reason: 'calibration_required' };
    if (this.#selection.activeSurface !== 'keyboard') return { ready: false, reason: 'modal_open' };
    if (this.#selection.selectedId === null) return { ready: false, reason: 'no_target' };
    if (this.#mouthReference === null) return { ready: false, reason: 'mouth_reference' };
    if (this.#mouth.signalValid !== true) return { ready: false, reason: 'mouth_unreliable' };
    if (this.#mouthBlocked) return { ready: false, reason: 'rearm_required' };
    if (this.#mouthGesture !== null) return { ready: false, reason: 'gesture_active' };
    if (!this.#isHeadSettled(this.#lastTimestamp ?? 0)) return { ready: false, reason: 'head_motion' };
    return { ready: true, reason: null };
  }

  #mouthPhaseValue() {
    if (this.#clickSource !== 'mouth') return 'DISABLED';
    if (this.#paused) return 'UNRELIABLE';
    if (this.#mouthGesture === 'kiss') return 'KISS';
    if (this.#mouthGesture === 'open') return 'OPEN';
    if (this.#mouth.signalValid !== true) return 'UNRELIABLE';
    if (this.#mouthReference === null) return 'ACQUIRING';
    return 'READY';
  }

  #mouthStatus() {
    const availability = this.#mouthAvailability();
    return {
      phase: this.#mouthPhaseValue(),
      ready: availability.ready,
      reason: availability.reason,
      pucker: round(this.#mouth.pucker, 4),
      jawOpen: round(this.#mouth.jawOpen, 4),
      lipGapRatio: round(this.#mouth.gap, 4),
      mouthWidthRatio: round(this.#mouth.width, 4),
      referenceValid: this.#mouthReference !== null,
      counts: {
        clicks: this.#mouthCounts.clicks,
        deletes: this.#mouthCounts.deletes,
        rejected: this.#mouthCounts.rejected,
      },
      lastAction: this.#mouthLastAction === null ? null : {
        kind: this.#mouthLastAction.kind,
        accepted: this.#mouthLastAction.accepted === true,
        reason: this.#mouthLastAction.reason,
      },
    };
  }

  #enterPaused(phase) {
    this.#paused = true;
    this.#cancelNavigation();
    this.#cancelTransient();
    this.#calibration.active = false;
    this.#calibration.samples = [];
    this.#calibration.startedAt = null;
    this.#lastRelative = { yaw: 0, pitch: 0, roll: 0 };
    this.#phase = phase;
    this.#notify();
  }

  #fault(kind) {
    this.#lastError = ERROR_CALLBACK_FAILED;
    this.#activationQueue.length = 0;
    this.#enterPaused('ERROR');
  }

  #isArmed() {
    return !this.#paused
      && this.#clickSource === 'blink'
      && this.#neutral !== null
      && this.#calibration.active === false
      && this.#operational === true
      && this.#blink.state === 'OPEN'
      && this.#eyes.state === 'OPEN'
      && this.#eyes.geometryValid === true
      && this.#eyes.referenceValid === true
      && !this.#eyeRefStale
      && this.#isHeadSettled(this.#lastTimestamp ?? 0)
      && this.#selection.selectedId !== null
      && this.#selection.activeSurface === 'keyboard';
  }

  #notify() {
    const statusCallback = this.#onStatus;
    if (statusCallback === null) return;
    const headMode = this.#head.latchedDirection !== null ? 'LATCHED' : this.#head.candidateDirection !== null ? 'CANDIDATE' : 'IDLE';
    const lastBlink = this.#lastBlink;
    const lastBlinkKey = lastBlink === null
      ? ''
      : (lastBlink.accepted ? 'a' : 'r') + ':' + (lastBlink.reason === null ? '' : lastBlink.reason) + ':' + (lastBlink.selectedId === null ? '' : lastBlink.selectedId) + ':' + round(lastBlink.durationMs, 0);
    const nav = this.#navigation;
    const availability = this.#blinkAvailability();
    const mouthAvailability = this.#mouthAvailability();
    const mouthKey = this.#mouthPhaseValue() + ':' + (mouthAvailability.ready ? '1' : '0') + ':' + (mouthAvailability.reason ?? '') + ':' + this.#mouthCounts.clicks + ':' + this.#mouthCounts.deletes + ':' + this.#mouthCounts.rejected + ':' + (this.#mouthLastAction === null ? '' : this.#mouthLastAction.kind + (this.#mouthLastAction.accepted ? '+' : '-') + (this.#mouthLastAction.reason ?? ''));
    const navRemaining = nav.phase === 'RETURNING' && nav.deadline !== null
      ? Math.ceil(Math.max(0, nav.deadline - (this.#lastTimestamp ?? nav.deadline)) / 100)
      : 0;
    const key = this.#phase + '|' + nav.phase + '|' + (nav.locked ? '1' : '0') + '|' + navRemaining + '|' + (nav.awaitingStablePose ? '1' : '0') + '|' + nav.recenters + '|' + (availability.ready ? '1' : '0') + ':' + (availability.reason ?? '') + '|' + headMode + '|' + this.#blink.state + '|' + this.#clickSource + '|' + mouthKey + '|' + (this.#isArmed() ? '1' : '0') + '|' + (this.#lastError === null ? '' : this.#lastError) + '|' + this.#eyes.state + '|' + this.#eyeRefPhase + '|' + this.#counts.closures + '|' + this.#counts.completedBlinks + '|' + this.#counts.acceptedBlinks + '|' + this.#counts.rejectedBlinks + '|' + this.#counts.moves + '|' + lastBlinkKey;
    if (key === this.#lastNotifiedKey) return;
    this.#lastNotifiedKey = key;
    try {
      statusCallback(this.getStatus());
    } catch (error) {}
  }
}

export default HeadBlinkController;
