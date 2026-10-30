import {
  FaceLandmarker,
  FilesetResolver
} from '../../vendor/mediapipe/vision_bundle.mjs';
import { measureEyes } from './eye-geometry.js';
import { measureMouth } from './mouth-geometry.js';

// FilesetResolver appends its own slash. A doubled slash is a different cache
// key, so a server-normalized online load can otherwise fail only when offline.
const WASM_BASE_PATH = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../../models/face_landmarker.task', import.meta.url).href;

const MODEL_GATE = 0.75;
const WARMUP_MS = 300;
const MIN_INFERENCE_INTERVAL_MS = 1000 / 30;

// Nominal 30 fps camera callbacks jitter around the ideal 33.333 ms period.
// A strict interval gate can reject one callback and then skip the next
// distinct camera frame. Allow a small, bounded early-arrival window while
// still keeping 60 fps callbacks from turning into unbounded inference work.
const MAX_INFERENCE_EARLY_MS = 6;
const MIN_INFERENCE_SPACING_MS = Math.max(
  0,
  MIN_INFERENCE_INTERVAL_MS - MAX_INFERENCE_EARLY_MS
);
const MIN_FACE_LANDMARKS = 478;
const RAD_TO_DEG = 180 / Math.PI;

// MediaPipe Face Landmarker iris indices. These are geometry checks only;
// eyelid openness/blink scores are deliberately not part of confidence.
const LEFT_EYE = Object.freeze({ outer: 33, inner: 133, iris: 468 });
const RIGHT_EYE = Object.freeze({ outer: 263, inner: 362, iris: 473 });

const STOP_REASONS = new Set([
  'stop',
  'hidden',
  'pagehide',
  'camera-ended',
  'dispose'
]);

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trackingError(code) {
  const error = new Error(code);
  error.name = 'TrackingEngineError';
  error.code = code;
  return error;
}

async function closeTask(task) {
  if (!task || typeof task.close !== 'function') return;
  try {
    const result = task.close();
    if (result && typeof result.then === 'function') await result;
  } catch {
    // Closing is best-effort cleanup; no patient data is retained here.
  }
}

function noFaceFrame(timestamp) {
  return {
    timestamp,
    facePresent: false,
    confidence: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    blinkLeft: 0,
    blinkRight: 0,
    eyeLookDownLeft: 0,
    eyeLookDownRight: 0,
    eyeLookUpLeft: 0,
    eyeLookUpRight: 0,
    lookEvidenceValid: false,
    faceScale: 0,
    eyeAspectLeft: 0,
    eyeAspectRight: 0,
    eyeGeometryValid: false,
    mouthPucker: 0,
    mouthFunnel: 0,
    jawOpen: 0,
    mouthClose: 0,
    mouthSignalValid: false,
    lipGapRatio: 0,
    mouthWidthRatio: 0,
    mouthGeometryValid: false
  };
}

/**
 * Extracts yaw/pitch/roll from MediaPipe facialTransformationMatrixes[0].data.
 * The chain is documented as column-major, so column j occupies indexes j*4..j*4+3.
 * Rotation channels are returned in radians and converted to degrees here.
 * No mirror sign is assumed: front-camera CSS preview mirroring is presentation
 * only and is not applied to ML input. yawSign/pitchSign must be calibrated by
 * device/settings and validated on real hardware.
 */
function poseFromMatrix(data) {
  if (!data || typeof data.length !== 'number' || data.length < 16) return null;

  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(data[index])) return null;
  }

  // R(row,column) = data[column * 4 + row].
  const r10 = data[1];
  const r11 = data[5];
  const r02 = data[8];
  const r12 = data[9];
  const r22 = data[10];

  const yaw = Math.atan2(r02, r22) * RAD_TO_DEG;
  const pitch = Math.atan2(-r12, Math.hypot(r02, r22)) * RAD_TO_DEG;
  const roll = Math.atan2(r10, r11) * RAD_TO_DEG;

  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(roll)) {
    return null;
  }

  return { yaw, pitch, roll };
}

/**
 * Reads blink and eye-look blendshapes in one pass. Eye-look scores are
 * appearance evidence for distinguishing a down-looking pose from a blink;
 * they are not part of derived quality/confidence. The look block is only
 * trusted when all four categories are present and finite.
 */
function extractBlendshapeScores(categories) {
  if (!categories || typeof categories.length !== 'number') return null;

  let blinkLeft;
  let blinkRight;
  let lookDownLeft;
  let lookDownRight;
  let lookUpLeft;
  let lookUpRight;
  let hasBlinkLeft = false;
  let hasBlinkRight = false;
  let hasLookDownLeft = false;
  let hasLookDownRight = false;
  let hasLookUpLeft = false;
  let hasLookUpRight = false;

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    if (!category || typeof category.categoryName !== 'string') continue;

    if (category.categoryName === 'eyeBlinkLeft') {
      blinkLeft = category.score;
      hasBlinkLeft = true;
    } else if (category.categoryName === 'eyeBlinkRight') {
      blinkRight = category.score;
      hasBlinkRight = true;
    } else if (category.categoryName === 'eyeLookDownLeft') {
      lookDownLeft = category.score;
      hasLookDownLeft = true;
    } else if (category.categoryName === 'eyeLookDownRight') {
      lookDownRight = category.score;
      hasLookDownRight = true;
    } else if (category.categoryName === 'eyeLookUpLeft') {
      lookUpLeft = category.score;
      hasLookUpLeft = true;
    } else if (category.categoryName === 'eyeLookUpRight') {
      lookUpRight = category.score;
      hasLookUpRight = true;
    }
  }

  if (!hasBlinkLeft || !hasBlinkRight) return null;
  if (!Number.isFinite(blinkLeft) || !Number.isFinite(blinkRight)) return null;

  const lookEvidenceValid =
    hasLookDownLeft &&
    hasLookDownRight &&
    hasLookUpLeft &&
    hasLookUpRight &&
    Number.isFinite(lookDownLeft) &&
    Number.isFinite(lookDownRight) &&
    Number.isFinite(lookUpLeft) &&
    Number.isFinite(lookUpRight);

  const look = lookEvidenceValid
    ? {
        eyeLookDownLeft: clamp01(lookDownLeft),
        eyeLookDownRight: clamp01(lookDownRight),
        eyeLookUpLeft: clamp01(lookUpLeft),
        eyeLookUpRight: clamp01(lookUpRight),
        lookEvidenceValid: true
      }
    : {
        eyeLookDownLeft: 0,
        eyeLookDownRight: 0,
        eyeLookUpLeft: 0,
        eyeLookUpRight: 0,
        lookEvidenceValid: false
      };

  return {
    blink: {
      left: clamp01(blinkLeft),
      right: clamp01(blinkRight)
    },
    look
  };
}

function invalidMouthScores() {
  // Explicit zeros/false: a missing or malformed mouth block is never reported
  // as a reliable neutral mouth.
  return {
    mouthPucker: 0,
    mouthFunnel: 0,
    jawOpen: 0,
    mouthClose: 0,
    mouthSignalValid: false
  };
}

/**
 * Reads the mouth blendshape scores in one pass. The mouth signal is trusted
 * only when all four categories are present, finite, and inside the documented
 * 0..1 domain. These scores are deliberately kept separate from head/eye
 * confidence, so a missing mouth signal cannot degrade existing output.
 */
function extractMouthScores(categories) {
  if (!categories || typeof categories.length !== 'number') {
    return invalidMouthScores();
  }

  let mouthPucker;
  let mouthFunnel;
  let jawOpen;
  let mouthClose;
  let hasMouthPucker = false;
  let hasMouthFunnel = false;
  let hasJawOpen = false;
  let hasMouthClose = false;

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    if (!category || typeof category.categoryName !== 'string') continue;

    if (category.categoryName === 'mouthPucker') {
      mouthPucker = category.score;
      hasMouthPucker = true;
    } else if (category.categoryName === 'mouthFunnel') {
      mouthFunnel = category.score;
      hasMouthFunnel = true;
    } else if (category.categoryName === 'jawOpen') {
      jawOpen = category.score;
      hasJawOpen = true;
    } else if (category.categoryName === 'mouthClose') {
      mouthClose = category.score;
      hasMouthClose = true;
    }
  }

  const mouthSignalValid =
    hasMouthPucker &&
    hasMouthFunnel &&
    hasJawOpen &&
    hasMouthClose &&
    Number.isFinite(mouthPucker) &&
    Number.isFinite(mouthFunnel) &&
    Number.isFinite(jawOpen) &&
    Number.isFinite(mouthClose) &&
    mouthPucker >= 0 &&
    mouthPucker <= 1 &&
    mouthFunnel >= 0 &&
    mouthFunnel <= 1 &&
    jawOpen >= 0 &&
    jawOpen <= 1 &&
    mouthClose >= 0 &&
    mouthClose <= 1;

  if (!mouthSignalValid) return invalidMouthScores();

  return {
    mouthPucker,
    mouthFunnel,
    jawOpen,
    mouthClose,
    mouthSignalValid: true
  };
}

function computeFaceBox(landmarks) {
  if (!landmarks || typeof landmarks.length !== 'number') return null;
  if (landmarks.length < MIN_FACE_LANDMARKS) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < landmarks.length; index += 1) {
    const point = landmarks[index];
    if (!point) return null;

    const x = point.x;
    const y = point.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > 1.5 || height > 1.5) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: Math.max(width, height)
  };
}

function faceInFrameQuality(box) {
  const overflow = Math.max(
    0,
    -box.minX,
    box.maxX - 1,
    -box.minY,
    box.maxY - 1
  );

  return clamp01(1 - overflow / 0.2);
}

function faceScaleQuality(scale) {
  const hardMin = 0.07;
  const softMin = 0.18;
  const softMax = 0.82;
  const hardMax = 1.0;

  if (!Number.isFinite(scale)) return 0;
  if (scale <= hardMin || scale >= hardMax) return 0;
  if (scale < softMin) return clamp01((scale - hardMin) / (softMin - hardMin));
  if (scale > softMax) return clamp01((hardMax - scale) / (hardMax - softMax));
  return 1;
}

function eyeIrisGeometryScore(landmarks, eye) {
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const iris = landmarks[eye.iris];

  if (!outer || !inner || !iris) return 0;
  if (
    !Number.isFinite(outer.x) ||
    !Number.isFinite(outer.y) ||
    !Number.isFinite(inner.x) ||
    !Number.isFinite(inner.y) ||
    !Number.isFinite(iris.x) ||
    !Number.isFinite(iris.y)
  ) {
    return 0;
  }

  const eyeWidth = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  if (!Number.isFinite(eyeWidth) || eyeWidth < 0.004) return 0;

  const eyeCenterX = (outer.x + inner.x) / 2;
  const eyeCenterY = (outer.y + inner.y) / 2;
  const irisDistance = Math.hypot(iris.x - eyeCenterX, iris.y - eyeCenterY);
  const relativeIrisDistance = irisDistance / eyeWidth;

  const widthScore = clamp01((eyeWidth - 0.004) / 0.03);
  const irisScore = clamp01((1.6 - relativeIrisDistance) / 0.9);

  return Math.min(widthScore, irisScore);
}

/**
 * Derived quality confidence, not a fake model-provided probability.
 *
 * Signal availability:
 * - Face Landmarker is configured with .75 detection/presence/tracking gates,
 *   but the browser result does not expose a raw per-frame confidence number.
 * - A complete result therefore contributes modelGate = 1 only after those
 *   configured gates and local metric validation.
 * - Face-in-frame, face-scale, temporal pose/landmark stability, and eye/iris
 *   geometry are measured from the current result plus previous derived metrics
 *   only. No landmarks, frames, images, or video are retained.
 * - Eyelid openness/blink scores are intentionally excluded. Using them here
 *   would suppress intentional blinks.
 *
 * Formula:
 * base = 0.30*modelGate + 0.20*faceInFrame + 0.15*faceScale
 *      + 0.15*temporalStability + 0.20*eyeIrisGeometry
 * geometryGate = 0.35 + 0.65*min(faceInFrame, faceScale, eyeIrisGeometry)
 * confidence = clamp01(base * geometryGate)
 */
function derivedConfidence(faceInFrame, faceScale, temporalStability, eyeIrisGeometry) {
  const modelGate = 1;
  const base =
    0.3 * modelGate +
    0.2 * faceInFrame +
    0.15 * faceScale +
    0.15 * temporalStability +
    0.2 * eyeIrisGeometry;

  const geometryGate = clamp01(
    0.35 + 0.65 * Math.min(faceInFrame, faceScale, eyeIrisGeometry)
  );

  return clamp01(base * geometryGate);
}

export class TrackingEngine {
  constructor({ onFrame, onStatus } = {}) {
    this._onFrame = typeof onFrame === 'function' ? onFrame : null;
    this._onStatus = typeof onStatus === 'function' ? onStatus : null;

    this._disposed = false;
    this._epoch = 0;
    this._startPromise = null;
    this._running = false;

    this._state = 'idle';
    this._statusCode = 'idle';
    this._cameraState = 'off';
    this._modelState = 'unloaded';

    this._video = null;
    this._stream = null;
    this._track = null;
    this._trackEndedHandler = null;
    this._landmarker = null;

    this._videoFrameId = null;
    this._rafId = null;
    this._lifecycleAttached = false;

    this._warmupUntil = 0;
    this._lastInferenceAt = 0;
    this._lastMlTimestamp = 0;
    this._lastInferredVideoTime = -1;

    this._fpsWindowStart = 0;
    this._fpsWindowCount = 0;
    this._fps = 0;
    this._inferenceAvgMs = 0;
    this._inferenceAverageCount = 0;

    this._lastFacePresent = false;
    this._lastConfidence = 0;
    this._prevStability = null;

    this._lastErrorCode = null;
    this._counts = {
      inferences: 0,
      faceFrames: 0,
      errors: 0
    };

    this._onVisibilityChange = () => {
      if (!this._isSessionActive()) return;
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible' || document.hidden === true) {
        void this.stop('hidden');
      }
    };

    this._onPageHide = () => {
      if (!this._isSessionActive()) return;
      void this.stop('pagehide');
    };
  }

  async start(videoElement) {
    if (this._disposed) throw trackingError('disposed');
    if (this._running) return this.getStatus();

    // Serialize starts without overlapping camera acquisition/model loading.
    while (this._startPromise) {
      const pending = this._startPromise;
      try {
        await pending;
      } catch {
        // Failure is reflected in bounded status; continue only if no session.
      }

      if (this._disposed) throw trackingError('disposed');
      if (this._running) return this.getStatus();
      if (this._startPromise === pending) this._startPromise = null;
    }

    if (!videoElement || typeof videoElement !== 'object') {
      throw trackingError('invalid-video');
    }

    this._attachLifecycle();

    const generation = ++this._epoch;
    const promise = this._startInternal(videoElement, generation);
    this._startPromise = promise;

    try {
      return await promise;
    } finally {
      if (this._startPromise === promise) this._startPromise = null;
    }
  }

  async stop(reason = 'stop') {
    const normalizedReason = typeof reason === 'string' && STOP_REASONS.has(reason)
      ? reason
      : 'stop';

    this._epoch += 1;
    this._running = false;
    this._cameraState = 'off';
    this._modelState = 'unloading';

    await this._releaseResources();

    this._cameraState = 'off';
    this._modelState = 'unloaded';

    if (normalizedReason === 'camera-ended') {
      this._lastErrorCode = 'camera-ended';
    }

    if (!this._disposed) {
      this._state = 'stopped';
      this._statusCode = normalizedReason;
      this._emitStatus();
    }

    return this.getStatus();
  }

  async dispose() {
    if (this._disposed) return this.getStatus();

    this._disposed = true;
    this._epoch += 1;
    this._running = false;
    this._cameraState = 'off';
    this._modelState = 'unloading';

    await this._releaseResources();

    this._cameraState = 'off';
    this._modelState = 'unloaded';
    this._state = 'disposed';
    this._statusCode = 'disposed';
    this._emitStatus();

    this._onFrame = null;
    this._onStatus = null;

    return this.getStatus();
  }

  getStatus() {
    return {
      state: this._state,
      statusCode: this._statusCode,
      running: this._running,
      camera: this._cameraState,
      model: this._modelState,
      facePresent: this._lastFacePresent,
      confidence: round(this._lastConfidence, 3),
      confidenceKind: 'derived-quality',
      fps: round(this._fps, 1),
      inferenceAvgMs: round(this._inferenceAvgMs, 2),
      counts: {
        inferences: this._counts.inferences,
        faceFrames: this._counts.faceFrames,
        errors: this._counts.errors
      },
      lastErrorCode: this._lastErrorCode || null
    };
  }

  async _startInternal(videoElement, generation) {
    let stream = null;
    let track = null;
    let trackEndedHandler = null;
    let landmarker = null;
    let committed = false;

    const cleanupLocal = async () => {
      if (track && trackEndedHandler && typeof track.removeEventListener === 'function') {
        try {
          track.removeEventListener('ended', trackEndedHandler);
        } catch {
          // Best-effort cleanup.
        }
      }

      if (stream) {
        let tracks = [];
        try {
          if (typeof stream.getTracks === 'function') tracks = stream.getTracks();
        } catch {
          tracks = [];
        }

        for (let index = 0; index < tracks.length; index += 1) {
          try {
            tracks[index].stop();
          } catch {
            // Best-effort cleanup.
          }
        }
      }

      if (videoElement && 'srcObject' in videoElement) {
        try {
          if (videoElement.srcObject === stream) videoElement.srcObject = null;
        } catch {
          // Best-effort cleanup.
        }
      }

      if (videoElement && typeof videoElement.pause === 'function') {
        try {
          if (videoElement.paused !== true) videoElement.pause();
        } catch {
          // Best-effort cleanup.
        }
      }

      if (landmarker) {
        const task = landmarker;
        landmarker = null;
        await closeTask(task);
      }
    };

    try {
      this._state = 'requesting-camera';
      this._statusCode = 'requesting-camera';
      this._cameraState = 'requesting';
      this._modelState = 'unloaded';
      this._emitStatus();

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        throw trackingError('camera-unsupported');
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 }
        }
      });

      if (!this._isCurrent(generation)) {
        await cleanupLocal();
        return this.getStatus();
      }

      let videoTracks = [];
      if (stream && typeof stream.getVideoTracks === 'function') {
        videoTracks = stream.getVideoTracks();
      }

      track = videoTracks.length > 0 ? videoTracks[0] : null;
      if (!track) throw trackingError('camera-no-track');
      if (typeof track.readyState === 'string' && track.readyState === 'ended') {
        throw trackingError('camera-ended');
      }

      this._cameraState = 'active';

      trackEndedHandler = () => {
        if (
          !this._disposed &&
          this._epoch === generation &&
          this._stream === stream
        ) {
          void this.stop('camera-ended');
        }
      };

      if (typeof track.addEventListener === 'function') {
        track.addEventListener('ended', trackEndedHandler);
      }

      if (!('srcObject' in videoElement)) throw trackingError('invalid-video');
      if (typeof videoElement.play !== 'function') throw trackingError('invalid-video');

      videoElement.muted = true;
      videoElement.playsInline = true;
      if (typeof videoElement.setAttribute === 'function') {
        videoElement.setAttribute('playsinline', '');
      }
      videoElement.srcObject = stream;

      try {
        await videoElement.play();
      } catch {
        if (!this._isCurrent(generation)) {
          await cleanupLocal();
          return this.getStatus();
        }
        throw trackingError('video-play-failed');
      }

      if (!this._isCurrent(generation)) {
        await cleanupLocal();
        return this.getStatus();
      }

      if (typeof track.readyState === 'string' && track.readyState === 'ended') {
        throw trackingError('camera-ended');
      }

      this._state = 'loading-model';
      this._statusCode = 'loading-model';
      this._modelState = 'loading';
      this._emitStatus();

      landmarker = await this._createLandmarker(generation);

      if (!this._isCurrent(generation)) {
        await cleanupLocal();
        return this.getStatus();
      }

      if (typeof track.readyState === 'string' && track.readyState === 'ended') {
        throw trackingError('camera-ended');
      }

      // Commit only after camera, video element, and local model are ready.
      this._stream = stream;
      this._track = track;
      this._trackEndedHandler = trackEndedHandler;
      this._landmarker = landmarker;
      this._video = videoElement;
      committed = true;

      this._state = 'running';
      this._statusCode = 'running';
      this._cameraState = 'active';
      this._modelState = 'ready';
      this._lastErrorCode = null;
      this._lastFacePresent = false;
      this._lastConfidence = 0;
      this._counts = {
        inferences: 0,
        faceFrames: 0,
        errors: 0
      };
      this._resetLoopMetrics();
      this._running = true;
      this._warmupUntil = performance.now() + WARMUP_MS;

      this._emitStatus();
      this._scheduleFrame();

      return this.getStatus();
    } catch (error) {
      if (committed) {
        this._stream = null;
        this._track = null;
        this._trackEndedHandler = null;
        this._landmarker = null;
        this._video = null;
        this._running = false;
      }

      await cleanupLocal();

      if (!this._isCurrent(generation)) {
        return this.getStatus();
      }

      this._detachLifecycle();

      const code = this._normalizeStartError(error);
      this._recordError(code);

      this._running = false;
      this._cameraState = 'off';
      this._modelState = 'unloaded';

      if (
        code.startsWith('camera') ||
        code === 'video-play-failed' ||
        code === 'invalid-video'
      ) {
        this._cameraState = 'error';
      }

      if (code === 'model-load-failed') {
        this._modelState = 'error';
      }

      this._state = 'error';
      this._statusCode = code;
      this._emitStatus();

      throw trackingError(code);
    }
  }

  async _createLandmarker(generation) {
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

    if (!this._isCurrent(generation)) {
      throw trackingError('start-canceled');
    }

    const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: MODEL_GATE,
      minFacePresenceConfidence: MODEL_GATE,
      minTrackingConfidence: MODEL_GATE,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true
    });

    if (!landmarker) throw trackingError('model-load-failed');

    if (!this._isCurrent(generation)) {
      await closeTask(landmarker);
      throw trackingError('start-canceled');
    }

    return landmarker;
  }

  _normalizeStartError(error) {
    const explicitCode = error && typeof error.code === 'string' ? error.code : '';
    if (explicitCode) return explicitCode.slice(0, 64);

    if (this._modelState === 'loading' || this._state === 'loading-model') {
      return 'model-load-failed';
    }

    const name = error && typeof error.name === 'string' ? error.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'camera-permission-denied';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'camera-not-found';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'camera-not-readable';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'camera-constraints';
      case 'AbortError':
        return 'camera-aborted';
      case 'SecurityError':
        return 'camera-insecure-context';
      default:
        return this._state === 'requesting-camera' ? 'camera-failed' : 'start-failed';
    }
  }

  _isCurrent(generation) {
    return !this._disposed && generation === this._epoch;
  }

  _isSessionActive() {
    return (
      this._running ||
      this._state === 'requesting-camera' ||
      this._state === 'loading-model'
    );
  }

  _attachLifecycle() {
    if (this._lifecycleAttached) return;
    this._lifecycleAttached = true;

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this._onPageHide);
    }
  }

  _detachLifecycle() {
    if (!this._lifecycleAttached) return;
    this._lifecycleAttached = false;

    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this._onPageHide);
    }
  }

  async _releaseResources() {
    this._running = false;
    this._cancelFrameLoop();
    this._detachLifecycle();

    const stream = this._stream;
    const track = this._track;
    const trackEndedHandler = this._trackEndedHandler;
    const video = this._video;
    const landmarker = this._landmarker;

    this._stream = null;
    this._track = null;
    this._trackEndedHandler = null;
    this._video = null;
    this._landmarker = null;

    if (track && trackEndedHandler && typeof track.removeEventListener === 'function') {
      try {
        track.removeEventListener('ended', trackEndedHandler);
      } catch {
        // Best-effort cleanup.
      }
    }

    if (stream) {
      let tracks = [];
      try {
        if (typeof stream.getTracks === 'function') tracks = stream.getTracks();
      } catch {
        tracks = [];
      }

      for (let index = 0; index < tracks.length; index += 1) {
        try {
          tracks[index].stop();
        } catch {
          // Best-effort cleanup.
        }
      }
    }

    if (video) {
      if (stream && 'srcObject' in video) {
        try {
          if (video.srcObject === stream) video.srcObject = null;
        } catch {
          // Best-effort cleanup.
        }
      }

      try {
        if (typeof video.pause === 'function' && video.paused !== true) video.pause();
      } catch {
        // Best-effort cleanup.
      }
    }

    if (landmarker) await closeTask(landmarker);

    this._prevStability = null;
    this._lastFacePresent = false;
    this._lastConfidence = 0;
    this._lastInferenceAt = 0;
    this._lastMlTimestamp = 0;
    this._lastInferredVideoTime = -1;
    this._warmupUntil = 0;
    this._fps = 0;
    this._fpsWindowStart = 0;
    this._fpsWindowCount = 0;
    this._inferenceAvgMs = 0;
    this._inferenceAverageCount = 0;
    this._cameraState = 'off';
    this._modelState = 'unloaded';
  }

  _cancelFrameLoop() {
    const video = this._video;

    if (this._videoFrameId !== null) {
      const frameId = this._videoFrameId;
      this._videoFrameId = null;

      if (video && typeof video.cancelVideoFrameCallback === 'function') {
        try {
          video.cancelVideoFrameCallback(frameId);
        } catch {
          // Best-effort cleanup.
        }
      }
    }

    if (this._rafId !== null) {
      const rafId = this._rafId;
      this._rafId = null;

      if (typeof cancelAnimationFrame === 'function') {
        try {
          cancelAnimationFrame(rafId);
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  }

  _scheduleFrame() {
    if (!this._running || this._disposed) return;

    const video = this._video;
    if (!video) return;

    const generation = this._epoch;

    try {
      if (typeof video.requestVideoFrameCallback === 'function') {
        this._videoFrameId = video.requestVideoFrameCallback(() => {
          this._videoFrameId = null;

          if (!this._isCurrent(generation)) return;

          try {
            this._handleFrame(generation);
          } finally {
            if (this._isCurrent(generation) && this._running) {
              this._scheduleFrame();
            }
          }
        });
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;

          if (!this._isCurrent(generation)) return;

          try {
            this._handleFrame(generation);
          } finally {
            if (this._isCurrent(generation) && this._running) {
              this._scheduleFrame();
            }
          }
        });
      }
    } catch {
      this._recordError('scheduler-failed');
    }
  }

  _handleFrame(generation) {
    if (!this._isCurrent(generation) || !this._running) return;

    const video = this._video;
    const landmarker = this._landmarker;
    if (!video || !landmarker) return;

    const now = performance.now();
    if (now < this._warmupUntil) return;
    if (now - this._lastInferenceAt < MIN_INFERENCE_SPACING_MS) return;
    if (!this._videoReady(video)) return;

    const currentTime = video.currentTime;
    if (!Number.isFinite(currentTime)) return;
    if (currentTime === this._lastInferredVideoTime) return;

    this._lastInferenceAt = now;
    this._lastInferredVideoTime = currentTime;

    let timestamp = performance.now();
    if (!Number.isFinite(timestamp) || timestamp <= this._lastMlTimestamp) {
      timestamp = this._lastMlTimestamp + 0.001;
    }
    this._lastMlTimestamp = timestamp;

    let frame;
    const inferenceStartedAt = performance.now();

    try {
      const result = landmarker.detectForVideo(video, timestamp);
      frame = this._buildFrame(timestamp, result);
    } catch {
      this._recordError('inference-failed');
      frame = this._noFaceFrame(timestamp);
    }

    const inferenceMs = performance.now() - inferenceStartedAt;

    this._lastFacePresent = frame.facePresent;
    this._lastConfidence = frame.facePresent ? frame.confidence : 0;

    this._updateInferenceMetrics(inferenceMs, frame.facePresent);
    this._emitFrame(frame);
  }

  _videoReady(video) {
    return (
      typeof video.readyState === 'number' &&
      video.readyState >= 2 &&
      video.paused !== true &&
      video.ended !== true &&
      typeof video.videoWidth === 'number' &&
      video.videoWidth > 0 &&
      typeof video.videoHeight === 'number' &&
      video.videoHeight > 0
    );
  }

  _noFaceFrame(timestamp) {
    this._prevStability = null;
    return noFaceFrame(timestamp);
  }

  _buildFrame(timestamp, result) {
    const landmarks = result && result.faceLandmarks && result.faceLandmarks[0];
    if (!landmarks) return this._noFaceFrame(timestamp);

    const box = computeFaceBox(landmarks);
    const blendshapeCategories =
      result &&
      result.faceBlendshapes &&
      result.faceBlendshapes[0] &&
      result.faceBlendshapes[0].categories;
    const blendshapes = extractBlendshapeScores(blendshapeCategories);
    const mouthScores = extractMouthScores(blendshapeCategories);
    const pose = poseFromMatrix(
      result &&
      result.facialTransformationMatrixes &&
      result.facialTransformationMatrixes[0] &&
      result.facialTransformationMatrixes[0].data
    );

    if (!box || !blendshapes || !pose) {
      return this._noFaceFrame(timestamp);
    }

    const leftEyeGeometry = eyeIrisGeometryScore(landmarks, LEFT_EYE);
    const rightEyeGeometry = eyeIrisGeometryScore(landmarks, RIGHT_EYE);
    const eyeIrisGeometry = Math.min(leftEyeGeometry, rightEyeGeometry);

    // EAR is closure evidence only. It is deliberately excluded from confidence
    // so a closed eye cannot be mistaken for a low-quality face.
    const video = this._video;
    const eyes = measureEyes(
      landmarks,
      video && video.videoWidth,
      video && video.videoHeight
    );
    const mouthGeometry = measureMouth(
      landmarks,
      video && video.videoWidth,
      video && video.videoHeight
    );

    const faceInFrame = faceInFrameQuality(box);
    const faceScale = faceScaleQuality(box.scale);
    const temporalStability = this._updateTemporalStability(timestamp, pose, box);
    const confidence = derivedConfidence(
      faceInFrame,
      faceScale,
      temporalStability,
      eyeIrisGeometry
    );

    return {
      timestamp,
      facePresent: true,
      confidence,
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      blinkLeft: blendshapes.blink.left,
      blinkRight: blendshapes.blink.right,
      eyeLookDownLeft: blendshapes.look.eyeLookDownLeft,
      eyeLookDownRight: blendshapes.look.eyeLookDownRight,
      eyeLookUpLeft: blendshapes.look.eyeLookUpLeft,
      eyeLookUpRight: blendshapes.look.eyeLookUpRight,
      lookEvidenceValid: blendshapes.look.lookEvidenceValid,
      faceScale: box.scale,
      eyeAspectLeft: eyes.eyeAspectLeft,
      eyeAspectRight: eyes.eyeAspectRight,
      eyeGeometryValid: eyes.eyeGeometryValid,
      mouthPucker: mouthScores.mouthPucker,
      mouthFunnel: mouthScores.mouthFunnel,
      jawOpen: mouthScores.jawOpen,
      mouthClose: mouthScores.mouthClose,
      mouthSignalValid: mouthScores.mouthSignalValid,
      lipGapRatio: mouthGeometry.lipGapRatio,
      mouthWidthRatio: mouthGeometry.mouthWidthRatio,
      mouthGeometryValid: mouthGeometry.mouthGeometryValid
    };
  }

  _updateTemporalStability(timestamp, pose, box) {
    const previous = this._prevStability;
    let stability = 0.85;

    if (previous && Number.isFinite(previous.timestamp)) {
      const deltaMs = Math.max(1, timestamp - previous.timestamp);
      const expectedFrames = Math.max(1, deltaMs / (1000 / 30));

      const poseDelta = Math.max(
        Math.abs(pose.yaw - previous.yaw),
        Math.abs(pose.pitch - previous.pitch),
        Math.abs(pose.roll - previous.roll)
      );

      const poseRate = poseDelta / expectedFrames;
      const scaleRate = Math.abs(box.scale - previous.faceScale) / expectedFrames;
      const centerRate =
        Math.hypot(box.centerX - previous.centerX, box.centerY - previous.centerY) /
        expectedFrames;

      stability = clamp01(
        1 - Math.max(poseRate / 18, scaleRate / 0.12, centerRate / 0.15)
      );
    }

    this._prevStability = {
      timestamp,
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      faceScale: box.scale,
      centerX: box.centerX,
      centerY: box.centerY
    };

    return stability;
  }

  _updateInferenceMetrics(inferenceMs, facePresent) {
    this._counts.inferences += 1;
    if (facePresent) this._counts.faceFrames += 1;

    if (Number.isFinite(inferenceMs) && inferenceMs >= 0) {
      this._inferenceAverageCount += 1;
      this._inferenceAvgMs = this._inferenceAvgMs === 0
        ? inferenceMs
        : this._inferenceAvgMs * 0.9 + inferenceMs * 0.1;
    }

    const now = performance.now();
    if (this._fpsWindowStart === 0) this._fpsWindowStart = now;

    this._fpsWindowCount += 1;

    const elapsed = now - this._fpsWindowStart;
    if (elapsed >= 1000) {
      this._fps = (this._fpsWindowCount * 1000) / elapsed;
      this._fpsWindowStart = now;
      this._fpsWindowCount = 0;
    }
  }

  _resetLoopMetrics() {
    this._lastInferenceAt = 0;
    this._lastMlTimestamp = 0;
    this._lastInferredVideoTime = -1;
    this._warmupUntil = 0;
    this._fps = 0;
    this._fpsWindowStart = performance.now();
    this._fpsWindowCount = 0;
    this._inferenceAvgMs = 0;
    this._inferenceAverageCount = 0;
    this._prevStability = null;
  }

  _recordError(code) {
    const boundedCode = typeof code === 'string' && code.length > 0
      ? code.slice(0, 64)
      : 'unknown-error';

    this._counts.errors += 1;
    this._lastErrorCode = boundedCode;
  }

  _emitStatus() {
    if (typeof this._onStatus !== 'function') return;

    const status = this.getStatus();

    try {
      this._onStatus(status);
    } catch {
      this._counts.errors += 1;
      this._lastErrorCode = 'onStatus-failed';
    }
  }

  _emitFrame(frame) {
    if (typeof this._onFrame !== 'function') return;

    try {
      this._onFrame(frame);
    } catch {
      this._counts.errors += 1;
      this._lastErrorCode = 'onFrame-failed';
    }
  }
}
