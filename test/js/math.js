export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export const angDiff = (a, b) => {
  let d = (b - a + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
};
export const wrapPi = a => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const len2 = (x, z) => Math.hypot(x, z);
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const aabbHit = (x, z, r, b) => x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;
export function sepAABB(x, z, r, b) {
  const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
  const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
  if (d >= r || (dx === 0 && dz === 0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) {
    if (d === 0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
      const left = x - b.x0, right = b.x1 - x, down = z - b.z0, up = b.z1 - z;
      const m = Math.min(left, right, down, up);
      if (m === left) return { x: b.x0 - r, z };
      if (m === right) return { x: b.x1 + r, z };
      if (m === down) return { x, z: b.z0 - r };
      return { x, z: b.z1 + r };
    }
    if (d >= r) return null;
  }
  if (d < 1e-6) return { x: x + r, z };
  const s = (r - d) / d;
  return { x: x + dx * s, z: z + dz * s };
}
export function rayAABB(ox, oy, oz, dx, dy, dz, b, tmax = 1e6) {
  let tmin = 0, tmax2 = tmax;
  const inv = (o, d, a, c) => {
    if (Math.abs(d) < 1e-8) return o >= a && o <= c;
    let t0 = (a - o) / d, t1 = (c - o) / d;
    if (t0 > t1) { const k = t0; t0 = t1; t1 = k; }
    tmin = Math.max(tmin, t0); tmax2 = Math.min(tmax2, t1);
    return tmax2 >= tmin;
  };
  if (!inv(ox, dx, b.x0, b.x1) || !inv(oy, dy, b.y0, b.y1) || !inv(oz, dz, b.z0, b.z1)) return null;
  if (tmin > tmax2 || tmax2 < 0) return null;
  const t = tmin >= 0 ? tmin : tmax2;
  return { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
}
export const rand = (a, b) => a + Math.random() * (b - a);
export const irand = (a, b) => a + (Math.random() * (b - a + 1) | 0);
export function mulberry32(s) {
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
