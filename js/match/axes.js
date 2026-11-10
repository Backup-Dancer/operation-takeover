/** Shared input-axis math for touch, gamepad and keyboard.
 *  One contract for on-foot, drone and camera views:
 *    moveX > 0 = strafe right,  moveY > 0 = forward (stick up / W)
 *    lookX > 0 = turn right (drag right / right-stick right)
 *    lookY > 0 = look down (mouse-like). invertY flips lookY only.
 *  Camera pitch is applied as `pitch -= lookY`.
 */

export const STICK_DEADZONE = 0.14;
export const LOOK_DEADZONE = 0.14;
export const STICK_CURVE = 1.35;

export function applyDeadzone(x, y, dead = STICK_DEADZONE) {
  const m = Math.hypot(x || 0, y || 0);
  if (m < dead || m === 0) return { x: 0, y: 0, mag: 0 };
  const scaled = (m - dead) / (1 - dead);
  const k = Math.min(1, scaled) / m;
  return { x: (x || 0) * k, y: (y || 0) * k, mag: Math.min(1, scaled) };
}

export function responseCurve(v, exp = STICK_CURVE) {
  const s = Math.sign(v);
  return s * Math.pow(Math.min(1, Math.abs(v)), exp);
}

export function shapeStick(x, y, dead = STICK_DEADZONE, exp = STICK_CURVE) {
  const d = applyDeadzone(x, y, dead);
  if (!d.mag) return d;
  let sx = responseCurve(d.x, exp);
  let sy = responseCurve(d.y, exp);
  const m = Math.hypot(sx, sy);
  if (m > 1) { sx /= m; sy /= m; }
  return { x: sx, y: sy, mag: Math.min(1, m) };
}

/** Touch / on-screen stick. dx, dy in pixels from the pad centre (screen Y down).
 *  Stick up (dy < 0) yields moveY > 0 (forward). */
export function stickFromDelta(dx, dy, radius, dead = STICK_DEADZONE, exp = STICK_CURVE) {
  const r = radius || 60;
  return shapeStick((dx || 0) / r, -(dy || 0) / r, dead, exp);
}

/** Standard gamepad left stick: axis 0 right-positive, axis 1 down-positive. */
export function moveFromPad(ax, ay, dead = STICK_DEADZONE, exp = STICK_CURVE) {
  return shapeStick(ax || 0, -(ay || 0), dead, exp);
}

/** Keyboard WASD already expressed as moveX / moveY in our convention. */
export function moveFromKeys(right, left, forward, back) {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (forward ? 1 : 0) - (back ? 1 : 0);
  const m = Math.hypot(x, y);
  if (!m) return { x: 0, y: 0, mag: 0 };
  return { x: x / m, y: y / m, mag: 1 };
}

/** Pointer / mouse drag. Drag right → lookX > 0; drag up (dy < 0) → lookY < 0
 *  (look up) when invertY is false. */
export function lookFromDrag(dx, dy, opts = {}) {
  const sensitivity = opts.sensitivity ?? 1;
  const adsSensitivity = opts.adsSensitivity ?? 0.7;
  const ads = opts.ads ?? 0;
  const invertY = opts.invertY === true;
  const scale = opts.scale ?? 0.006;
  const s = scale * sensitivity * (ads > 0.5 ? adsSensitivity : 1);
  return {
    lookX: (dx || 0) * s,
    lookY: (dy || 0) * s * (invertY ? -1 : 1),
  };
}

/** Standard gamepad right stick: axis 2 right-positive, axis 3 down-positive. */
export function lookFromPad(rx, ry, opts = {}) {
  const dead = opts.dead ?? LOOK_DEADZONE;
  const sensitivity = opts.sensitivity ?? 1;
  const adsSensitivity = opts.adsSensitivity ?? 0.7;
  const ads = opts.ads ?? 0;
  const invertY = opts.invertY === true;
  const scale = opts.scale ?? 0.04;
  const d = applyDeadzone(rx || 0, ry || 0, dead);
  const s = scale * sensitivity * (ads > 0.5 ? adsSensitivity : 1);
  return {
    lookX: d.x * s,
    lookY: d.y * s * (invertY ? -1 : 1),
  };
}

export function forwardFromYaw(yaw) {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

export function rightFromYaw(yaw) {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/** World-space XZ from move axes and a yaw (or explicit fwd/right).
 *  Stick up walks along forward. */
export function worldMove(moveX, moveY, yawOrFwd, right) {
  const fwd = typeof yawOrFwd === 'number' ? forwardFromYaw(yawOrFwd) : yawOrFwd;
  const r = right || rightFromYaw(typeof yawOrFwd === 'number' ? yawOrFwd : Math.atan2(fwd.x, fwd.z));
  return {
    x: fwd.x * (moveY || 0) + r.x * (moveX || 0),
    z: fwd.z * (moveY || 0) + r.z * (moveX || 0),
  };
}

/** Apply a look delta. lookX > 0 turns right; lookY > 0 looks down. */
export function applyLook(yaw, pitch, lookX, lookY, pitchMin = -1.2, pitchMax = 1.2) {
  let p = (pitch || 0) - (lookY || 0);
  if (p < pitchMin) p = pitchMin;
  if (p > pitchMax) p = pitchMax;
  return { yaw: (yaw || 0) + (lookX || 0), pitch: p };
}

/** True when a world displacement matches the intended stick direction
 *  (same half-space, not sideways / backwards). Used by tests. */
export function directionAgrees(dx, dz, intendedX, intendedZ, minDot = 0.7) {
  const a = Math.hypot(dx, dz), b = Math.hypot(intendedX, intendedZ);
  if (a < 1e-8 || b < 1e-8) return false;
  return (dx * intendedX + dz * intendedZ) / (a * b) >= minDot;
}
