// Ember Yard: an original dockyard arena. Two plant sites (A north-west,
// B south-east), a mid lane with a container stack, and side lanes lined with
// crates and containers. Collision is a flat list of axis-aligned boxes; the
// same boxes decide line of sight, so what blocks your feet blocks a bullet's
// eye-line too. Nothing here copies any existing game's map.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ARENA } from './config.js';

function box(w, h, d, color, x, y, z, roughness = 0.9) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 2D segment (x0,z0)->(x1,z1) vs an AABB; true when the segment crosses the
// box while both ends are below the box top (i.e. the box is tall enough to
// block the sight line at eye height).
function segmentBlocks(x0, z0, x1, z1, eye0, eye1, b) {
  if (Math.min(eye0, eye1) > b.top) return false;
  // Slab test in XZ.
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tMin = 0;
  let tMax = 1;
  for (const [o, d, mn, mx] of [
    [x0, dx, b.minX, b.maxX],
    [z0, dz, b.minZ, b.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return false;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

export function buildWorld(scene, rng) {
  const colliders = []; // { minX, maxX, minZ, maxZ, top, blocksSight }
  const group = new THREE.Group();
  scene.add(group);

  const addCollider = (minX, maxX, minZ, maxZ, top, blocksSight = true) => {
    colliders.push({ minX, maxX, minZ, maxZ, top, blocksSight });
  };
  const addBox = (w, h, d, color, x, z, opts = {}) => {
    const mesh = box(w, h, d, color, x, h / 2, z, opts.roughness);
    group.add(mesh);
    if (opts.solid !== false) {
      addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h, opts.blocksSight ?? true);
    }
    return mesh;
  };

  // --- sky, fog, light -------------------------------------------------
  scene.background = new THREE.Color(PALETTE.skyTop);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 130);
  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x3a2f26, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
  sun.position.set(-30, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);

  // --- sky: a gradient dome, stars and a low dusk sun ---------------------
  // The flat background colour read as a painted wall in screenshots; a
  // real dome gives the yard a horizon. Fog is off for the sky itself.
  const skyGeo = new THREE.SphereGeometry(180, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vPos; uniform vec3 top; uniform vec3 horizon; void main() { float h = clamp(vPos.y / 180.0, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);
  // Stars on the upper hemisphere, fading out toward the horizon glow.
  const starCount = 260;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = rng() * Math.PI * 2;
    const e = 0.25 + rng() * 1.2; // elevation, radians above the horizon
    const r = 170;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false }));
  scene.add(stars);
  // Low sun disc and halo over the west wall.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, fog: false }),
  );
  sunDisc.position.set(-120, 26, -60);
  sunDisc.lookAt(0, 8, 0);
  scene.add(sunDisc);
  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(16, 32),
    new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0.28, fog: false }),
  );
  sunHalo.position.set(-121, 26, -61);
  sunHalo.lookAt(0, 8, 0);
  scene.add(sunHalo);

  // --- ground ----------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.width + 30, ARENA.depth + 30),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // Painted lane markings: pale strips that read as yard striping.
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x8f8578, roughness: 0.9 });
  for (const [w, d, x, z] of [
    [0.5, 34, -8, 0],
    [0.5, 34, 8, 0],
    [44, 0.5, 0, -6],
    [44, 0.5, 0, 6],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.02, z);
    group.add(s);
  }

  // --- perimeter walls --------------------------------------------------
  const W = ARENA.width / 2;
  const D = ARENA.depth / 2;
  const H = ARENA.wallHeight;
  addBox(ARENA.width + 2, H, 1, PALETTE.wall, 0, -D - 0.5);
  addBox(ARENA.width + 2, H, 1, PALETTE.wall, 0, D + 0.5);
  addBox(1, H, ARENA.depth + 2, PALETTE.wallDark, -W - 0.5, 0);
  addBox(1, H, ARENA.depth + 2, PALETTE.wallDark, W + 0.5, 0);
  // Low parapet caps so the wall tops read in the distance. They sit on top
  // of the walls (position.y is overridden below), so they must not register
  // their own ground-level collider — the walls already collide.
  addBox(ARENA.width + 2, 0.35, 1.3, PALETTE.wallDark, 0, -D - 0.5, { solid: false }).position.y = H + 0.1;
  addBox(ARENA.width + 2, 0.35, 1.3, PALETTE.wallDark, 0, D + 0.5, { solid: false }).position.y = H + 0.1;

  // --- mid: a container stack that splits the lane ----------------------
  addBox(6, 2.6, 2.6, PALETTE.containerTeal, -2, -1.5);
  addBox(6, 2.6, 2.6, PALETTE.containerRust, 2, 1.5);
  // The top box is stacked, not standing on the ground: its mesh is raised
  // to y 3.8, so it must not register the ground-level collider addBox
  // would give it — the union collider below is the stack's real footprint.
  const midTop = addBox(5.4, 2.4, 2.4, PALETTE.containerAmber, 0, 0, { solid: false });
  midTop.position.y = 2.6 + 1.2;
  // The stack's top box overhangs the two below; its collider is the union.
  colliders.push({ minX: -5, maxX: 5, minZ: -2.8, maxZ: 2.8, top: 5.0, blocksSight: true });

  // --- site A (north-west): crate fort ----------------------------------
  addBox(4, 2.4, 2.4, PALETTE.containerTeal, -20, -13);
  addBox(2.4, 1.15, 2.4, PALETTE.crate, -15.5, -15.5);
  addBox(2.4, 1.15, 2.4, PALETTE.crateDark, -23.5, -16.5);
  addBox(2.2, 2.2, 2.2, PALETTE.crate, -24, -10.5);

  // --- site B (south-east): container corner -----------------------------
  addBox(6, 2.6, 2.6, PALETTE.containerRust, 20, 13);
  addBox(2.4, 1.15, 2.4, PALETTE.crate, 15.5, 15.8);
  addBox(2.4, 1.15, 2.4, PALETTE.crateDark, 24, 16.5);
  addBox(2.2, 2.2, 2.2, PALETTE.crate, 23.5, 9.5);

  // --- side lanes: scattered cover ---------------------------------------
  addBox(3, 1.15, 3, PALETTE.crate, -13, -8);
  addBox(3, 1.15, 3, PALETTE.crateDark, 13, -8);
  addBox(2.4, 2.4, 2.4, PALETTE.containerAmber, -13, 9);
  addBox(2.4, 2.4, 2.4, PALETTE.containerTeal, 13, 9);
  addBox(4, 1.15, 2, PALETTE.crate, -6, -13.5);
  addBox(4, 1.15, 2, PALETTE.crateDark, 6, 13.5);
  addBox(2, 2.2, 6, PALETTE.wallDark, -25.5, 2);
  addBox(2, 2.2, 6, PALETTE.wallDark, 25.5, -2);
  addBox(3, 1.15, 3, PALETTE.crate, 0, -17.5);
  addBox(3, 1.15, 3, PALETTE.crateDark, 0, 17.5);

  // --- site markers: glowing floor rings ---------------------------------
  const ringGeo = new THREE.RingGeometry(2.2, 2.8, 40);
  const ringA = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: PALETTE.siteA, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(-20, 0.03, -14);
  group.add(ringA);
  const ringB = ringA.clone();
  ringB.material = new THREE.MeshBasicMaterial({ color: PALETTE.siteB, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  ringB.position.set(20, 0.03, 13);
  group.add(ringB);

  // --- amber work lights --------------------------------------------------
  const lampLights = [];
  for (const [x, z] of [[-20, -14], [20, 13], [0, 0], [-13, 9], [13, -9]]) {
    const pole = box(0.18, 4.4, 0.18, 0x2c2f33, x + 3.4, 2.2, z + 3.4);
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent }),
    );
    lamp.position.set(x + 3.4, 4.5, z + 3.4);
    group.add(lamp);
    const light = new THREE.PointLight(0xffa63d, 18, 20, 1.8);
    light.position.set(x + 3.4, 4.4, z + 3.4);
    scene.add(light);
    lampLights.push(light);
  }

  // --- distant skyline silhouettes (outside the walls, no collision) -----
  for (let i = 0; i < 14; i++) {
    const h = 8 + rng() * 18;
    const w = 5 + rng() * 7;
    const side = i % 4;
    const x = side === 0 ? -W - 14 - rng() * 20 : side === 1 ? W + 14 + rng() * 20 : (rng() - 0.5) * 90;
    const z = side === 2 ? -D - 14 - rng() * 18 : side === 3 ? D + 14 + rng() * 18 : (rng() - 0.5) * 70;
    const sil = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshBasicMaterial({ color: 0x232833 }),
    );
    sil.position.set(x, h / 2, z);
    group.add(sil);
  }

  // --- waypoints: patrol graph bots walk ----------------------------------
  // Nodes sit in open ground; edges link neighbours with clear straight lines.
  const waypointDefs = [
    [-20, -14], [-14, -14], [-8, -10], [-2, -6], // A side -> mid
    [2, -6], [8, -10], [14, -8], [20, 6], [20, 13], // mid -> B
    [-14, 2], [-8, 6], [0, 8], [8, 8], // south lane
    [-24, 2], [-24, -6], [24, -8], [24, 4], // flanks
    [0, -14], [0, 14], [-4, 16], [4, -16], // spawns and centre
    [-20, 6], [16, -14], [16, 14],
  ];
  const waypoints = waypointDefs.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  const link = (a, b) => {
    waypoints[a].links.push(b);
    waypoints[b].links.push(a);
  };
  [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
    [9, 10], [10, 11], [11, 12], [12, 7], [13, 0], [13, 14], [14, 1],
    [15, 6], [15, 16], [16, 8], [17, 5], [17, 2], [18, 3], [19, 11],
    [19, 12], [20, 10], [21, 6], [22, 0], [22, 9], [23, 6], [23, 2],
  ].forEach(([a, b]) => link(a, b));

  const sites = {
    A: { id: 'A', x: -20, z: -14, radius: 3.2, color: PALETTE.siteA },
    B: { id: 'B', x: 20, z: 13, radius: 3.2, color: PALETTE.siteB },
  };

  const spawns = {
    attacker: [
      { x: -6, z: 17.5, yaw: 0 },
      { x: 0, z: 18, yaw: 0 },
      { x: 6, z: 17.5, yaw: 0 },
    ],
    defender: [
      { x: -8, z: -17.5, yaw: Math.PI },
      { x: 0, z: -18, yaw: Math.PI },
      { x: 8, z: -17.5, yaw: Math.PI },
      { x: -20, z: -8, yaw: Math.PI + 0.6 },
      { x: 20, z: 8, yaw: Math.PI - 0.6 },
    ],
  };

  const hasLineOfSight = (ax, az, ay, bx, bz, by) => {
    for (const b of colliders) {
      if (!b.blocksSight) continue;
      if (segmentBlocks(ax, az, bx, bz, ay, by, b)) return false;
    }
    return true;
  };

  const pointFree = (x, z, radius) => {
    if (Math.abs(x) > W - radius || Math.abs(z) > D - radius) return false;
    return !colliders.some((b) => {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      return dx * dx + dz * dz < radius * radius;
    });
  };

  let time = 0;
  return {
    colliders,
    waypoints,
    sites,
    spawns,
    hasLineOfSight,
    pointFree,
    update(dt) {
      // Work lights breathe gently; purely cosmetic.
      time += dt;
      const pulse = 0.92 + 0.08 * Math.sin(time * 1.7);
      for (const l of lampLights) l.intensity = 18 * pulse;
    },
  };
}
