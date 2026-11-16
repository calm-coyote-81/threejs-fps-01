// Small math helpers shared by the simulation. No allocations in the hot
// paths: callers reuse the scratch vectors exported here.

// Deterministic RNG so a ?seed= URL replays the same bot layout and patrols.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function randRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Angle helpers: yaw is rotation around Y, 0 facing -Z.
export function yawToDir(yaw, out) {
  out.x = -Math.sin(yaw);
  out.z = -Math.cos(yaw);
  return out;
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Axis-aligned box collider: { minX, maxX, minZ, maxZ, top }.
// Returns true when a circle of `radius` at (x, z) overlaps the box.
export function circleHitsBox(x, z, radius, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < radius * radius;
}

// Push a circle out of a box it overlaps; returns true when a push happened.
export function resolveCircleBox(pos, radius, b) {
  const cx = clamp(pos.x, b.minX, b.maxX);
  const cz = clamp(pos.z, b.minZ, b.maxZ);
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = (radius - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
    return true;
  }
  // Centre is inside the box: push out along the smallest penetration axis.
  const pl = pos.x - b.minX + radius;
  const pr = b.maxX - pos.x + radius;
  const pt = pos.z - b.minZ + radius;
  const pb = b.maxZ - pos.z + radius;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) pos.x = b.minX - radius;
  else if (m === pr) pos.x = b.maxX + radius;
  else if (m === pt) pos.z = b.minZ - radius;
  else pos.z = b.maxZ + radius;
  return true;
}
