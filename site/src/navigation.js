'use strict';

export const SPACE_IDS = Object.freeze(['space', 'space:upper']);
const EPSILON = 0.5;

export function isSpaceId(id) {
  return SPACE_IDS.indexOf(id) !== -1;
}

export function oppositeDirection(direction) {
  if (direction === 'up') return 'down';
  if (direction === 'down') return 'up';
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  return null;
}

export function getTargetCenter(target) {
  return {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2
  };
}

function isVertical(direction) {
  return direction === 'up' || direction === 'down';
}

function isDirectional(current, target, direction) {
  const currentCenter = getTargetCenter(current);
  const targetCenter = getTargetCenter(target);
  if (direction === 'right') return targetCenter.x > currentCenter.x + EPSILON;
  if (direction === 'left') return targetCenter.x < currentCenter.x - EPSILON;
  if (direction === 'down') return targetCenter.y > currentCenter.y + EPSILON;
  if (direction === 'up') return targetCenter.y < currentCenter.y - EPSILON;
  return false;
}

function directionalGap(current, target, direction) {
  if (direction === 'right') return Math.max(0, target.x - (current.x + current.width));
  if (direction === 'left') return Math.max(0, current.x - (target.x + target.width));
  if (direction === 'down') return Math.max(0, target.y - (current.y + current.height));
  if (direction === 'up') return Math.max(0, current.y - (target.y + target.height));
  return Infinity;
}

function pointIntervalDistance(point, start, end) {
  if (point < start) return start - point;
  if (point > end) return point - end;
  return 0;
}

function compareScores(a, b, keys) {
  for (const key of keys) {
    const difference = a[key] - b[key];
    if (Math.abs(difference) > 1e-6) return difference;
  }
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

export function pickMoveTarget(current, targets, direction, probe) {
  if (!current || !Array.isArray(targets)) return null;
  const vertical = isVertical(direction);
  if (!vertical && direction !== 'left' && direction !== 'right') return null;
  const currentCenter = getTargetCenter(current);
  const probePoint = probe && Number.isFinite(probe.x) && Number.isFinite(probe.y) ? probe : null;
  const crossPoint = vertical
    ? (probePoint ? probePoint.x : currentCenter.x)
    : (probePoint ? probePoint.y : currentCenter.y);
  const keys = vertical
    ? ['primary', 'spacePriority', 'crossGap', 'crossCenterDistance', 'primaryCenterDistance']
    : ['primary', 'crossGap', 'crossCenterDistance', 'primaryCenterDistance'];
  let best = null;
  for (const target of targets) {
    if (!target || target.id === current.id) continue;
    // A nearer rectangle in a different lane is not a directional neighbor.
    // Keep broad space rows eligible through interval overlap, not their center.
    const overlaps = vertical
      ? target.x < current.x + current.width && target.x + target.width > current.x
      : target.y < current.y + current.height && target.y + target.height > current.y;
    if (!overlaps && !(vertical && isSpaceId(target.id))) continue;
    if (!isDirectional(current, target, direction)) continue;
    const targetCenter = getTargetCenter(target);
    const primary = directionalGap(current, target, direction);
    const crossStart = vertical ? target.x : target.y;
    const crossEnd = vertical ? target.x + target.width : target.y + target.height;
    const crossGap = pointIntervalDistance(crossPoint, crossStart, crossEnd);
    const crossCenterDistance = Math.abs((vertical ? targetCenter.x : targetCenter.y) - crossPoint);
    const primaryCenterDistance = Math.abs((vertical ? targetCenter.y : targetCenter.x) - (vertical ? currentCenter.y : currentCenter.x));
    const score = {
      id: target.id,
      target: target,
      primary: primary,
      // A space represents its entire row for vertical reachability. Without
      // this preference the adjacent settings control can steal a bottom-row
      // letter based on its center even though the space row spans that column.
      spacePriority: vertical && isSpaceId(target.id) ? 0 : 1,
      crossGap: crossGap,
      crossCenterDistance: crossCenterDistance,
      primaryCenterDistance: primaryCenterDistance
    };
    if (!best || compareScores(score, best, keys) < 0) best = score;
  }
  return best ? best.target : null;
}
