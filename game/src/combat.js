// Combat: firing, recoil, tracers, grenades and the view-model gun. All
// shots are hitscan rays: the ray is tested against the world first, then
// against every actor's capsule, and the nearest hit wins. Damage falls off
// with range, headshots multiply, and firing on the move spreads the shots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { GRENADE, WEAPONS, BOTS } from './config.js';
import { clamp, lerp } from './util.js';
import { rayHitActor, rayHitWorld, applyDamage, currentWeapon } from './actors.js';

const _dir = new THREE.Vector3();
const _botDir = new THREE.Vector3();

// --- view-model gun --------------------------------------------------------
export function createViewModel(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.45, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.3 });
  // Slimmer than a full rifle silhouette: a compact carbine that reads as a
  // gun without eating a quarter of the frame.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.46), dark);
  group.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, -0.34);
  group.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), dark);
  grip.position.set(0, -0.11, 0.1);
  grip.rotation.x = 0.3;
  group.add(grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.05, 0.08), accent);
  sight.position.set(0, 0.075, -0.04);
  group.add(sight);
  // A long scope tube, shown only for the DMR.
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), dark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.1, -0.08);
  scope.visible = false;
  group.add(scope);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.08), dark);
  mag.position.set(0, -0.1, -0.06);
  group.add(mag);
  group.position.set(0.24, -0.27, -0.5);
  camera.add(group);
  return { group, kick: 0, sway: 0, adsBlend: 0, parts: { body, barrel, scope }, weapon: 'carbine' };
}

// Reshape the view-model gun for the equipped weapon: the SMG is short and
// stubby, the DMR is long with a scope, the carbine and sidearm share the
// default shape. Called when the player switches weapons.
export function setViewModelWeapon(vm, weaponId) {
  if (vm.weapon === weaponId) return;
  vm.weapon = weaponId;
  const { body, barrel, scope } = vm.parts;
  if (weaponId === 'smg') {
    body.scale.z = 0.8;
    barrel.scale.z = 0.55;
    barrel.position.z = -0.27;
    scope.visible = false;
  } else if (weaponId === 'dmr') {
    body.scale.z = 1.12;
    barrel.scale.z = 1.6;
    barrel.position.z = -0.44;
    scope.visible = true;
  } else {
    body.scale.z = 1;
    barrel.scale.z = 1;
    barrel.position.z = -0.34;
    scope.visible = false;
  }
}

export function updateViewModel(vm, player, dt, moving, ads) {
  // Recoil kick pushes the gun back and up, then it settles.
  vm.kick = lerp(vm.kick, 0, 1 - Math.exp(-14 * dt));
  // Aiming down sights slides the gun to the centre of the screen so the
  // sight lines up with the crosshair.
  vm.adsBlend = lerp(vm.adsBlend, ads ? 1 : 0, 1 - Math.exp(-14 * dt));
  const bob = Math.sin(player.bobPhase) * 0.006 * Math.min(1, moving / 5);
  const x = lerp(0.24, 0, vm.adsBlend);
  const y = lerp(-0.27, -0.185, vm.adsBlend);
  vm.group.position.set(
    x + Math.sin(player.bobPhase * 0.5) * 0.004 * (1 - vm.adsBlend),
    y + bob - vm.kick * 0.05,
    -0.5 + vm.kick * 0.12,
  );
  vm.group.rotation.x = vm.kick * 0.35;
}

// --- effects ---------------------------------------------------------------
export function createEffects(scene) {
  // One shared tracer material: a tracer lives 0.07 s, so fading it per
  // line would mean a fresh material per shot; a shared material keeps the
  // frame free of per-shot allocations.
  const tracerMat = new THREE.LineBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0.85 });
  const tracers = [];
  const bursts = [];
  const flash = new THREE.PointLight(0xffc861, 0, 9, 2);
  scene.add(flash);
  return {
    flash(pos, intensity = 30) {
      flash.position.set(pos.x, pos.y, pos.z);
      flash.intensity = intensity;
    },
    tracer(from, to) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.x, from.y, from.z),
        new THREE.Vector3(to.x, to.y, to.z),
      ]);
      const line = new THREE.Line(geo, tracerMat);
      scene.add(line);
      tracers.push({ line, life: 0.07 });
    },
    sparks(pos, color = 0xffd27a, n = 10) {
      const geo = new THREE.BufferGeometry();
      const pts = new Float32Array(n * 3);
      const vel = [];
      for (let i = 0; i < n; i++) {
        pts[i * 3] = pos.x;
        pts[i * 3 + 1] = pos.y;
        pts[i * 3 + 2] = pos.z;
        vel.push({
          x: (Math.random() - 0.5) * 4,
          y: Math.random() * 3,
          z: (Math.random() - 0.5) * 4,
        });
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.PointsMaterial({ color, size: 0.07, transparent: true, opacity: 1 });
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      bursts.push({ points, vel, life: 0.4 });
    },
    explosion(pos) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0.9 }),
      );
      mesh.position.set(pos.x, pos.y + 0.3, pos.z);
      scene.add(mesh);
      bursts.push({ mesh, life: 0.5, grows: true });
      this.flash(pos, 90);
      this.sparks(pos, 0xff6a2a, 26);
      this.sparks(pos, 0x555c66, 18);
    },
    update(dt) {
      flash.intensity = Math.max(0, flash.intensity - dt * 400);
      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        t.life -= dt;
        if (t.life <= 0) {
          scene.remove(t.line);
          t.line.geometry.dispose();
          tracers.splice(i, 1);
        }
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life -= dt;
        if (b.mesh) {
          const s = 1 + (0.5 - b.life) * 22;
          b.mesh.scale.setScalar(Math.max(0.1, s));
          b.mesh.material.opacity = Math.max(0, b.life / 0.5);
        } else if (b.points) {
          const arr = b.points.geometry.attributes.position.array;
          for (let j = 0; j < b.vel.length; j++) {
            arr[j * 3] += b.vel[j].x * dt;
            arr[j * 3 + 1] += b.vel[j].y * dt;
            arr[j * 3 + 2] += b.vel[j].z * dt;
            b.vel[j].y -= 9 * dt;
          }
          b.points.geometry.attributes.position.needsUpdate = true;
          b.points.material.opacity = Math.max(0, b.life / 0.4);
        }
        if (b.life <= 0) {
          scene.remove(b.mesh ?? b.points);
          if (b.mesh) b.mesh.material.dispose();
          else b.points.material.dispose();
          bursts.splice(i, 1);
        }
      }
    },
  };
}

// --- firing ----------------------------------------------------------------
// Direction the camera looks, with spread and recoil applied.
function shotDirection(player, weapon, rng) {
  const spread = player.spread + player.recoil * 0.4;
  const yaw = player.yaw + (rng() - 0.5) * 2 * spread + (rng() - 0.5) * 0.002;
  const pitch = player.pitch + player.recoil + (rng() - 0.5) * 2 * spread;
  _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  return _dir;
}

// Fire one player shot. Returns { fired, hit, kill, head } so the caller
// can count accuracy directly instead of inferring it from the hitmarker.
export function tryFirePlayer(state, rng) {
  const player = state.player;
  const weapon = currentWeapon(player);
  const noShot = { fired: false, hit: false, kill: false, head: false };
  if (!player.alive || player.reloading || player.fireCooldown > 0) return noShot;
  if (state.roundPhase !== 'live') return noShot;
  const ammo = player.ammo[weapon.id];
  if (ammo.mag <= 0) {
    state.audio.dryFire();
    player.fireCooldown = 0.25;
    return noShot;
  }
  player.fireCooldown = weapon.fireInterval;
  ammo.mag -= 1;
  const eyeY = player.pos.y + (player.crouched ? 1.05 : 1.62);
  const ox = player.pos.x;
  const oy = eyeY;
  const oz = player.pos.z;
  const dir = shotDirection(player, weapon, rng);
  const wallT = rayHitWorld(ox, oy, oz, dir.x, dir.y, dir.z, weapon.range, state.world.colliders);
  // Nearest enemy hit along the ray.
  let best = null;
  let bestActor = null;
  for (const bot of state.bots) {
    if (!bot.alive || bot.team !== 'enemy') continue;
    const hit = rayHitActor(ox, oy, oz, dir.x, dir.y, dir.z, Math.min(wallT, weapon.range), bot);
    if (hit && (!best || hit.t < best.t)) { best = hit; bestActor = bot; }
  }
  const endT = best ? best.t : Math.min(wallT, weapon.range);
  const end = { x: ox + dir.x * endT, y: oy + dir.y * endT, z: oz + dir.z * endT };
  const muzzle = { x: ox + dir.x * 0.6, y: oy - 0.12, z: oz + dir.z * 0.6 };
  state.effects.tracer(muzzle, end);
  state.effects.flash(muzzle, 22);
  state.audio.shot(weapon.id);
  state.viewModel.kick = 1;
  // Recoil: the aim climbs, more while firing on the move.
  const moving = Math.hypot(player.vel.x, player.vel.z) > 2;
  player.recoil += weapon.recoil * (moving ? 1.5 : 1);
  player.pitch = clamp(player.pitch + weapon.recoil * 0.55, -1.45, 1.45);
  player.spread = Math.min(weapon.spreadMax, player.spread + weapon.spreadPerShot);
  state.lastShot = { x: ox, z: oz, t: state.time };
  if (bestActor) {
    const falloff = clamp(1 - (best.t / weapon.range) * 0.45, 0.55, 1);
    const dmg = weapon.damage * (best.head ? weapon.headMult : 1) * falloff;
    applyDamage(bestActor, dmg, best.head, player, state);
    state.hitmarker = { t: state.time, kill: !bestActor.alive, head: best.head };
    state.audio.hit(best.head);
    if (!bestActor.alive) state.audio.kill();
    state.effects.sparks(end, best.head ? 0xff5a3c : 0xffd27a, best.head ? 14 : 8);
    return { fired: true, hit: true, kill: !bestActor.alive, head: best.head };
  }
  if (wallT < weapon.range) {
    state.effects.sparks(end, 0xbfc4cc, 6);
  }
  if (ammo.mag === 0) state.audio.dryFire();
  return { fired: true, hit: false, kill: false, head: false };
}

export function startReload(state) {
  const player = state.player;
  const weapon = currentWeapon(player);
  const ammo = player.ammo[weapon.id];
  if (player.reloading || ammo.mag >= weapon.mag || ammo.reserve <= 0) return;
  player.reloading = true;
  player.reloadTimer = weapon.reloadTime;
  state.audio.reload();
}

export function finishReload(player) {
  const weapon = currentWeapon(player);
  const ammo = player.ammo[weapon.id];
  const need = weapon.mag - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
  player.reloading = false;
}

// Resolve one queued bot shot against its target.
export function resolveBotShot(state, shot, rng) {
  const { bot, target } = shot;
  if (!bot.alive || !target.alive) return;
  const eyeY = bot.pos.y + 1.55;
  const tx = target.pos.x;
  const ty = target.pos.y + (target.isPlayer && target.crouched ? 1.0 : 1.35);
  const tz = target.pos.z;
  const d = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
  // Aim error grows with distance and with the target's speed; crouching and
  // standing still make you harder to hit. The base error comes from the
  // BOTS config so tuning lives in one place.
  const targetSpeed = Math.hypot(target.vel.x, target.vel.z);
  const err = BOTS.aimError + d * 0.0016 + targetSpeed * 0.004;
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const baseYaw = Math.atan2(-dx, -dz);
  const yaw = baseYaw + (rng() - 0.5) * 2 * err * 3;
  const pitch = Math.atan2(ty - eyeY, d) + (rng() - 0.5) * 2 * err * 2;
  _botDir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const dir = _botDir;
  const wallT = rayHitWorld(bot.pos.x, eyeY, bot.pos.z, dir.x, dir.y, dir.z, 60, state.world.colliders);
  // Any actor in the way can catch the bullet.
  const candidates = [state.player, ...state.bots].filter((a) => a.alive && a !== bot);
  let best = null;
  let bestActor = null;
  for (const a of candidates) {
    const hit = rayHitActor(bot.pos.x, eyeY, bot.pos.z, dir.x, dir.y, dir.z, Math.min(wallT, 60), a);
    if (hit && (!best || hit.t < best.t)) { best = hit; bestActor = a; }
  }
  const endT = best ? best.t : Math.min(wallT, 60);
  const from = { x: bot.pos.x + dir.x * 0.5, y: eyeY - 0.15, z: bot.pos.z + dir.z * 0.5 };
  const end = { x: bot.pos.x + dir.x * endT, y: eyeY + dir.y * endT, z: bot.pos.z + dir.z * endT };
  state.effects.tracer(from, end);
  state.effects.flash(from, 14);
  if (d < 40) state.audio.distantShot(d);
  if (bestActor) {
    const falloff = clamp(1 - (best.t / 60) * 0.4, 0.6, 1);
    const dmg = bot.damage * (best.head ? 2 : 1) * falloff;
    const wasAlive = bestActor.alive;
    applyDamage(bestActor, dmg, best.head, bot, state);
    if (bestActor.isPlayer) {
      state.audio.hurt();
      state.damageFlash = state.time;
      state.damageFrom = Math.atan2(-(bot.pos.x - state.player.pos.x), -(bot.pos.z - state.player.pos.z));
    }
    if (wasAlive && !bestActor.alive && bestActor.isPlayer) state.audio.roundLose();
  }
}

// --- grenades ---------------------------------------------------------------
// Shared launch: `dir` is the throw direction (already normalised-ish) and
// the grenade leaves from the owner's hands with an upward lob.
function launchGrenade(state, owner, dir) {
  const origin = owner.isPlayer
    ? { x: owner.pos.x, y: owner.pos.y + 1.4, z: owner.pos.z }
    : { x: owner.pos.x, y: owner.pos.y + 1.2, z: owner.pos.z };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e332e, roughness: 0.5, metalness: 0.6 }),
  );
  mesh.position.set(origin.x, origin.y, origin.z);
  state.scene.add(mesh);
  state.grenades.push({
    pos: { ...origin },
    vel: { x: dir.x * GRENADE.throwSpeed, y: dir.y * GRENADE.throwSpeed + 3, z: dir.z * GRENADE.throwSpeed },
    fuse: GRENADE.fuse,
    owner,
    mesh,
  });
  state.audio.grenadeThrow();
}

export function throwGrenade(state, owner) {
  if (owner.isPlayer && state.player.grenades <= 0) return false;
  if (owner.isPlayer) {
    state.player.grenades -= 1;
    state.audio.grenadePin();
  }
  const yaw = owner.yaw;
  const pitch = owner.pitch ?? 0;
  launchGrenade(state, owner, {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch) + 0.35,
    z: -Math.cos(yaw) * Math.cos(pitch),
  });
  return true;
}

// A bot's grenade: lobbed at a point (usually the target's feet) with enough
// arc to clear the low crates between thrower and target.
export function throwGrenadeAtPoint(state, owner, tx, tz) {
  const ox = owner.pos.x;
  const oz = owner.pos.z;
  const dx = tx - ox;
  const dz = tz - oz;
  const d = Math.hypot(dx, dz) || 1;
  const flat = 0.8; // mostly horizontal, with a lobbed arc
  const up = clamp(0.35 + (1 - Math.min(d, 24) / 24) * 0.45, 0.35, 0.8);
  launchGrenade(state, owner, {
    x: (dx / d) * flat,
    y: up,
    z: (dz / d) * flat,
  });
}

export function updateGrenades(state, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    // Bounce off the ground and the arena bounds.
    if (g.pos.y < 0.09) {
      g.pos.y = 0.09;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    for (const b of state.world.colliders) {
      const r = 0.09;
      const inX = g.pos.x > b.minX - r && g.pos.x < b.maxX + r;
      const inZ = g.pos.z > b.minZ - r && g.pos.z < b.maxZ + r;
      if (!inX || !inZ) continue;
      if (g.vel.y < 0 && g.pos.y < b.top + r && g.pos.y > b.top - 0.6) {
        // Landed on top of the box: bounce up, lose energy.
        g.pos.y = b.top + r;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
        continue;
      }
      if (g.pos.y >= b.top) continue;
      // Hit a side: push out along the smallest penetration axis and
      // reflect that velocity component, so the grenade never ends up
      // embedded inside a crate rattling against its own walls.
      const pl = g.pos.x - (b.minX - r);
      const pr = (b.maxX + r) - g.pos.x;
      const pt = g.pos.z - (b.minZ - r);
      const pb = (b.maxZ + r) - g.pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) { g.pos.x = b.minX - r; g.vel.x = -Math.abs(g.vel.x) * 0.5; }
      else if (m === pr) { g.pos.x = b.maxX + r; g.vel.x = Math.abs(g.vel.x) * 0.5; }
      else if (m === pt) { g.pos.z = b.minZ - r; g.vel.z = -Math.abs(g.vel.z) * 0.5; }
      else { g.pos.z = b.maxZ + r; g.vel.z = Math.abs(g.vel.z) * 0.5; }
    }
    g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    if (g.fuse <= 0) {
      explodeGrenade(state, g);
      state.scene.remove(g.mesh);
      state.grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(state, g) {
  state.audio.explosion();
  state.effects.explosion(g.pos);
  const actors = [state.player, ...state.bots];
  for (const a of actors) {
    if (!a.alive || a === g.owner) continue;
    const d = Math.hypot(a.pos.x - g.pos.x, a.pos.z - g.pos.z);
    if (d > GRENADE.radius) continue;
    const los = state.world.hasLineOfSight(g.pos.x, g.pos.y + 0.3, g.pos.z, a.pos.x, a.pos.y + 1.2, a.pos.z);
    const fall = 1 - (d / GRENADE.radius) * 0.85;
    const dmg = Math.max(GRENADE.minDamage, GRENADE.damage * fall) * (los ? 1 : 0.5);
    const wasAlive = a.alive;
    applyDamage(a, dmg, false, g.owner, state);
    if (a.isPlayer) {
      state.audio.hurt();
      state.damageFlash = state.time;
    }
    if (wasAlive && !a.alive && g.owner.isPlayer) state.audio.kill();
  }
  if (Math.hypot(state.player.pos.x - g.pos.x, state.player.pos.z - g.pos.z) < 12) {
    state.shake = Math.max(state.shake, 0.35);
  }
}

export { WEAPONS };
