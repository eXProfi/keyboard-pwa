const INNER_LIP_TOP = 13;
const INNER_LIP_BOTTOM = 14;
const MOUTH_CORNER_LEFT = 61;
const MOUTH_CORNER_RIGHT = 291;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

function invalidMouth() {
  // Keep the frozen DTO numeric while making it explicit that no mouth
  // geometry is usable; a missing signal is never reported as reliable.
  return {
    lipGapRatio: 0,
    mouthWidthRatio: 0,
    mouthGeometryValid: false
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
  // trustworthy mouth measurement, so reject it instead of clipping.
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const pixelX = x * width;
  const pixelY = y * height;
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return null;

  return { x: pixelX, y: pixelY };
}

/**
 * Measures mouth geometry from MediaPipe Face Landmarker landmarks.
 *
 * The caller passes the current video dimensions so normalized x/y become
 * pixel-aspect-correct 2D coordinates. lipGapRatio is the inner-lip distance
 * (13-14) over the mouth-corner width (61-291); mouthWidthRatio is the
 * mouth-corner width over the face width (234-454). A zero inner-lip gap is a
 * valid neutral measurement, not an error. Any missing, non-finite,
 * out-of-frame, or degenerate geometry produces an explicit invalid result
 * rather than a fabricated ratio.
 */
export function measureMouth(landmarks, width, height) {
  if (!Number.isFinite(width) || width <= 0) return invalidMouth();
  if (!Number.isFinite(height) || height <= 0) return invalidMouth();

  const lipTop = toPixelPoint(landmarks, INNER_LIP_TOP, width, height);
  const lipBottom = toPixelPoint(landmarks, INNER_LIP_BOTTOM, width, height);
  const cornerLeft = toPixelPoint(landmarks, MOUTH_CORNER_LEFT, width, height);
  const cornerRight = toPixelPoint(landmarks, MOUTH_CORNER_RIGHT, width, height);
  const faceLeft = toPixelPoint(landmarks, FACE_LEFT, width, height);
  const faceRight = toPixelPoint(landmarks, FACE_RIGHT, width, height);

  if (
    !lipTop ||
    !lipBottom ||
    !cornerLeft ||
    !cornerRight ||
    !faceLeft ||
    !faceRight
  ) {
    return invalidMouth();
  }

  const mouthWidth = euclidean(cornerLeft, cornerRight);
  if (!Number.isFinite(mouthWidth) || mouthWidth < 1e-6) return invalidMouth();

  const faceWidth = euclidean(faceLeft, faceRight);
  if (!Number.isFinite(faceWidth) || faceWidth < 1e-6) return invalidMouth();

  const lipGap = euclidean(lipTop, lipBottom);
  if (!Number.isFinite(lipGap) || lipGap < 0) return invalidMouth();

  const lipGapRatio = lipGap / mouthWidth;
  const mouthWidthRatio = mouthWidth / faceWidth;

  if (!Number.isFinite(lipGapRatio) || lipGapRatio < 0) return invalidMouth();
  if (!Number.isFinite(mouthWidthRatio) || mouthWidthRatio < 0) return invalidMouth();

  return {
    lipGapRatio,
    mouthWidthRatio,
    mouthGeometryValid: true
  };
}
