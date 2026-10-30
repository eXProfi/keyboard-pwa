const LEFT_EYE_INDICES = Object.freeze([362, 385, 387, 263, 373, 380]);
const RIGHT_EYE_INDICES = Object.freeze([33, 160, 158, 133, 153, 144]);

function invalidEyes() {
  // Keep the frozen DTO numeric while making it explicit that no EAR is usable.
  return {
    eyeAspectLeft: 0,
    eyeAspectRight: 0,
    eyeGeometryValid: false
  };
}

function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPixelPoint(landmarks, index, width, height) {
  if (!landmarks || typeof landmarks.length !== 'number') return null;
  if (index < 0 || index >= landmarks.length) return null;

  const point = landmarks[index];
  if (!point) return null;

  const x = point.x;
  const y = point.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // MediaPipe landmarks are normalized. A point outside the frame is not a
  // trustworthy eye measurement, so reject it instead of clipping.
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const pixelX = x * width;
  const pixelY = y * height;
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return null;

  return { x: pixelX, y: pixelY };
}

function eyeAspect(landmarks, indices, width, height) {
  const points = new Array(6);

  for (let i = 0; i < 6; i += 1) {
    const point = toPixelPoint(landmarks, indices[i], width, height);
    if (!point) return null;
    points[i] = point;
  }

  const p1 = points[0];
  const p2 = points[1];
  const p3 = points[2];
  const p4 = points[3];
  const p5 = points[4];
  const p6 = points[5];

  const eyeWidth = euclidean(p1, p4);
  if (!Number.isFinite(eyeWidth) || eyeWidth < 1e-6) return null;

  const ear = (euclidean(p2, p6) + euclidean(p3, p5)) / (2 * eyeWidth);
  if (!Number.isFinite(ear) || ear < 0) return null;

  return ear;
}

/**
 * Measures eye aspect ratio from MediaPipe Face Landmarker landmarks.
 *
 * The caller passes the current video dimensions so normalized x/y become
 * pixel-aspect-correct 2D coordinates. EAR uses only Euclidean distances, so it
 * is rotation invariant in the image plane. Any missing, non-finite,
 * out-of-frame, or degenerate eye geometry produces an explicit invalid result
 * rather than a fabricated valid ratio.
 */
export function measureEyes(landmarks, width, height) {
  if (!Number.isFinite(width) || width <= 0) return invalidEyes();
  if (!Number.isFinite(height) || height <= 0) return invalidEyes();

  const eyeAspectLeft = eyeAspect(landmarks, LEFT_EYE_INDICES, width, height);
  const eyeAspectRight = eyeAspect(landmarks, RIGHT_EYE_INDICES, width, height);

  if (eyeAspectLeft === null || eyeAspectRight === null) return invalidEyes();

  return {
    eyeAspectLeft,
    eyeAspectRight,
    eyeGeometryValid: true
  };
}
