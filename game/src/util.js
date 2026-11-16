// Small math helpers shared by the simulation. No allocations in the hot
// paths: callers reuse the scratch vectors exported here.
//
// Round 2 added the helpers the spike flow and the new HUD needed — 2D
// distances, easing for the HUD bars, a seeded shuffle for bot variety —
// without touching the signatures the rest of the game already relies on.

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

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent lerp: `rate` is how fast the value closes the gap
// per second, `dt` the step. Used for camera FOV and view-model blends.
export function damp(a, b, rate, dt) {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function randRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Fisher–Yates with the seeded RNG, so a shuffle replays with ?seed=.
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- 2D helpers: the simulation lives on the XZ plane -----------------------
export function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

export function dist2DSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// True when (x, z) is inside the circle — the spike pickup, plant sites and
// grenade splash all test this.
export function isInCircle(x, z, cx, cz, radius) {
  return dist2DSq(x, z, cx, cz) < radius * radius;
}

// Move `v` toward `target` by at most `maxDelta`; returns the new value.
// Used for smooth bar fills and the spike pickup channel.
export function moveToward(v, target, maxDelta) {
  if (Math.abs(target - v) <= maxDelta) return target;
  return v + Math.sign(target - v) * maxDelta;
}

// A random unit direction on the XZ plane, for scatter and spawn jitter.
export function randomUnit2D(rng, out) {
  const a = rng() * Math.PI * 2;
  out.x = Math.cos(a);
  out.z = Math.sin(a);
  return out;
}

// --- easing -----------------------------------------------------------------
export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t) {
  return 1 - (1 - clamp01(t)) ** 3;
}

export function easeInOutQuad(t) {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

// --- angles -----------------------------------------------------------------
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

// Shortest-path turn toward `target` at most `maxStep` radians.
export function angleLerp(a, target, maxStep) {
  return a + clamp(angleDiff(target, a), -maxStep, maxStep);
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function radToDeg(r) {
  return (r * 180) / Math.PI;
}

// --- formatting -------------------------------------------------------------
// "1:07" for the round clock; shared by the HUD and the buy menu.
export function formatClock(seconds) {
  const t = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// --- collision --------------------------------------------------------------
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
