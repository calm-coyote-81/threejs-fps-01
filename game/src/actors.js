// Actors: the player controller and the bots. The player is a first-person
// capsule moved by acceleration and friction; a bot is a low-poly figure with
// a small state machine (patrol, investigate, engage, hold, defuse, hunt)
// that walks the waypoint graph, hears gunfire and shoots back.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ARENA, PLAYER, BOTS, WEAPONS, ECONOMY, ROUND, SPIKE } from './config.js';
import { clamp, lerp, randRange, pick, angleDiff, resolveCircleBox } from './util.js';

// --- shared hit testing ---------------------------------------------------
// Ray (origin, dir, maxDist) against a standing actor's capsule. The capsule
// is the segment feet->head at (x, z) with radius r. Returns { t, head } or
// null. Headshots are the top 0.28 m of the capsule.
export function rayHitActor(ox, oy, oz, dx, dy, dz, maxDist, actor) {
  const px = actor.pos.x - ox;
  const pz = actor.pos.z - oz;
  // Closest approach of the ray to the actor's vertical axis.
  const tAxis = px * dx + pz * dz;
  if (tAxis < 0 || tAxis > maxDist) return null;
  const cx = ox + dx * tAxis;
  const cz = oz + dz * tAxis;
  const ddx = cx - actor.pos.x;
  const ddz = cz - actor.pos.z;
  const r = actor.radius + 0.18;
  if (ddx * ddx + ddz * ddz > r * r) return null;
  const yAt = oy + dy * tAxis;
  const feet = actor.pos.y;
  const headTop = feet + actor.height;
  if (yAt < feet - 0.1 || yAt > headTop + 0.1) return null;
  return { t: tAxis, head: yAt > headTop - 0.28 };
}

// Ray against the world's boxes. Returns the nearest blocking distance or
// Infinity. The ray is blocked when it enters a box's XZ footprint below the
// box top. Boxes flagged blocksSight: false (decorative low cover) never
// block a bullet's eye-line.
export function rayHitWorld(ox, oy, oz, dx, dy, dz, maxDist, colliders) {
  let best = Infinity;
  for (const b of colliders) {
    if (b.blocksSight === false) continue;
    let tMin = 0;
    let tMax = maxDist;
    let ok = true;
    for (const [o, d, mn, mx] of [
      [ox, dx, b.minX, b.maxX],
      [oz, dz, b.minZ, b.maxZ],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) { ok = false; break; }
      }
    }
    if (!ok || tMin > maxDist) continue;
    const yAt = oy + dy * tMin;
    if (yAt > b.top) continue; // flew over a low crate
    if (tMin < best) best = tMin;
  }
  // Ground plane.
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// --- damage ---------------------------------------------------------------
export function applyDamage(target, amount, isHead, attacker, state) {
  if (!target.alive) return 0;
  let remaining = amount;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, remaining * 0.5);
    target.armor -= absorbed;
    remaining -= absorbed;
  }
  target.health -= remaining;
  target.lastAttacker = attacker ?? null;
  target.lastHitHead = isHead;
  // A hit breaks the player's plant channel: you cannot tank a bullet
  // through a 3-second plant.
  if (target.isPlayer) target.planting = 0;
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    if (attacker && attacker.isPlayer) {
      state.player.kills += 1;
      state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + ECONOMY.killReward);
      state.feed.push({ text: `You eliminated ${target.name}`, kind: 'kill', t: state.time });
    } else if (target.isPlayer) {
      state.player.deaths += 1;
      state.feed.push({ text: `${attacker ? attacker.name : 'A bot'} eliminated you`, kind: 'death', t: state.time });
    } else if (attacker) {
      state.feed.push({ text: `${attacker.name} eliminated ${target.name}`, kind: 'info', t: state.time });
    }
  }
  return remaining;
}

// --- player ---------------------------------------------------------------
export function createPlayer(spawn) {
  return {
    isPlayer: true,
    name: 'You',
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, z: 0 },
    vy: 0,
    yaw: spawn.yaw,
    pitch: 0,
    radius: PLAYER.radius,
    height: 1.75,
    health: PLAYER.health,
    armor: PLAYER.armor,
    alive: true,
    crouched: false,
    onGround: true,
    kills: 0,
    deaths: 0,
    money: 800,
    weapons: ['carbine', 'sidearm'],
    weaponIndex: 0,
    ammo: {
      carbine: { mag: 30, reserve: 120 },
      sidearm: { mag: 12, reserve: 48 },
      smg: { mag: 32, reserve: 128 },
      dmr: { mag: 8, reserve: 32 },
    },
    grenades: 0,
    spread: 0,
    recoil: 0,
    fireCooldown: 0,
    reloadTimer: 0,
    reloading: false,
    planting: 0,
    defusing: 0,
    hasSpike: true,
    bobPhase: 0,
    stepTimer: 0,
  };
}

export function currentWeapon(player) {
  return WEAPONS[player.weapons[player.weaponIndex]];
}

// Move the player one fixed step. `input` is { f, b, l, r, sprint, crouch,
// jump }. Returns true when a footstep landed (for the step sound).
export function updatePlayer(player, input, dt, world) {
  if (!player.alive) return false;
  player.crouched = input.crouch;
  const speed = player.crouched
    ? PLAYER.crouchSpeed
    : input.sprint && input.f
      ? PLAYER.sprintSpeed
      : PLAYER.walkSpeed;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wx = 0;
  let wz = 0;
  if (input.f) { wx += -sin; wz += -cos; }
  if (input.b) { wx += sin; wz += cos; }
  if (input.r) { wx += cos; wz += -sin; }
  if (input.l) { wx += -cos; wz += sin; }
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const accel = player.onGround ? PLAYER.accel : PLAYER.accel * PLAYER.airControl;
  player.vel.x += wx * accel * dt;
  player.vel.z += wz * accel * dt;
  // Friction bleeds speed when there is no input; otherwise the speed cap
  // below keeps the player at the target speed (a short overshoot decays
  // instead of snapping, so sprinting into a strafe feels smooth).
  const sp = Math.hypot(player.vel.x, player.vel.z);
  if (len === 0 && player.onGround && sp > 0) {
    const drop = Math.max(0, sp - PLAYER.friction * dt);
    player.vel.x *= drop / sp;
    player.vel.z *= drop / sp;
  } else if (sp > speed) {
    const cap = Math.max(speed, sp - PLAYER.friction * 2.4 * dt);
    player.vel.x *= cap / sp;
    player.vel.z *= cap / sp;
  }

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  for (const b of world.colliders) resolveCircleBox(player.pos, player.radius, b);
  player.pos.x = clamp(player.pos.x, -ARENA.width / 2 + player.radius, ARENA.width / 2 - player.radius);
  player.pos.z = clamp(player.pos.z, -ARENA.depth / 2 + player.radius, ARENA.depth / 2 - player.radius);

  if (input.jump && player.onGround) {
    player.vy = ARENA.jumpSpeed;
    player.onGround = false;
  }
  player.vy -= ARENA.gravity * dt;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vy = 0;
    player.onGround = true;
  }

  // Head bob and footsteps while moving on the ground.
  const moving = Math.hypot(player.vel.x, player.vel.z);
  let stepped = false;
  if (player.onGround && moving > 1) {
    player.bobPhase += dt * moving * 1.6;
    player.stepTimer -= dt * moving;
    if (player.stepTimer <= 0) {
      player.stepTimer = 2.2;
      stepped = true;
    }
  }
  // Spread grows while moving, shrinks while still and crouched.
  const w = currentWeapon(player);
  const moveSpread = (moving / PLAYER.sprintSpeed) * w.spreadMove;
  const adsFactor = input.ads ? 0.55 : 1;
  const target = (w.spreadBase + moveSpread + (player.crouched ? -0.004 : 0)) * adsFactor;
  player.spread = lerp(player.spread, Math.max(0.002, target), 1 - Math.exp(-8 * dt));
  player.recoil = Math.max(0, player.recoil - dt * 0.09);
  return stepped;
}

// --- bots -----------------------------------------------------------------
const BOT_NAMES_ENEMY = ['Vex', 'Rook', 'Havoc', 'Mira'];
const BOT_NAMES_ALLY = ['Juno', 'Falk'];

function buildBotMesh(team) {
  const color = team === 'enemy' ? PALETTE.enemy : PALETTE.ally;
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.85 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.08;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.34), accent);
  vest.position.y = 1.16;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.32), accent);
  visor.position.y = 1.6;
  g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), suit);
  legL.position.set(-0.14, 0.36, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.62), new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.4 }));
  gun.position.set(0.22, 1.22, 0.3);
  g.add(gun);
  g.userData.legL = legL;
  g.userData.legR = legR;
  g.userData.gun = gun;
  return g;
}

export function createBot(team, index, spawn, scene, rng) {
  const name = team === 'enemy' ? BOT_NAMES_ENEMY[index % BOT_NAMES_ENEMY.length] : BOT_NAMES_ALLY[index % BOT_NAMES_ALLY.length];
  const mesh = buildBotMesh(team);
  mesh.position.set(spawn.x, 0, spawn.z);
  scene.add(mesh);
  return {
    isPlayer: false,
    name,
    team,
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, z: 0 },
    yaw: spawn.yaw,
    radius: 0.42,
    height: 1.75,
    health: BOTS.health,
    armor: 0,
    alive: true,
    mesh,
    state: 'patrol',
    waypoint: Math.floor(rng() * 6),
    waitTimer: randRange(rng, 0, 1.5),
    target: null, // actor currently engaged
    lastSeen: null, // { x, z, t }
    hearPos: null,
    reaction: 0,
    burstLeft: 0,
    burstPause: 0,
    fireCooldown: 0,
    aimYaw: spawn.yaw,
    strafeDir: 1,
    strafeTimer: 0,
    holdSite: team === 'enemy' ? (index < 2 ? 'A' : 'B') : null,
    defusing: 0,
    hasSpike: false, // an ally that picks up a dropped spike carries it to a site
    planting: 0, // channel progress when an ally carrier plants the spike
    grenadeTimer: randRange(rng, 10, 20), // enemy bots lob a grenade now and then
    walkPhase: rng() * 6,
    damage: WEAPONS.carbine.damage * 0.8,
  };
}

function nearestWaypoint(bot, world) {
  let best = bot.waypoint;
  let bestD = Infinity;
  for (const w of world.waypoints) {
    const d = (w.x - bot.pos.x) ** 2 + (w.z - bot.pos.z) ** 2;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// Walk toward (tx, tz) at `speed`, turning toward the destination first so
// the bot never strafes sideways. Records the bot's velocity so other bots'
// perception can tell a moving target from a still one. Returns true when
// the bot arrives within 0.4 m.
function moveBotToward(bot, tx, tz, speed, dt, world) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) {
    bot.vel.x = 0;
    bot.vel.z = 0;
    return true;
  }
  const targetYaw = Math.atan2(-dx, -dz);
  bot.yaw += clamp(angleDiff(targetYaw, bot.yaw), -3.2 * dt, 3.2 * dt);
  const step = Math.min(d, speed * dt);
  const ox = bot.pos.x;
  const oz = bot.pos.z;
  bot.pos.x += (-Math.sin(bot.yaw)) * step;
  bot.pos.z += (-Math.cos(bot.yaw)) * step;
  for (const b of world.colliders) resolveCircleBox(bot.pos, bot.radius, b);
  bot.vel.x = (bot.pos.x - ox) / dt;
  bot.vel.z = (bot.pos.z - oz) / dt;
  bot.walkPhase += dt * speed * 2.2;
  return d < 0.4;
}

// Can `bot` see `other`? Range, cone and line of sight.
export function botCanSee(bot, other, world) {
  if (!other.alive) return false;
  const dx = other.pos.x - bot.pos.x;
  const dz = other.pos.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > BOTS.sightRange) return false;
  const eyeY = bot.pos.y + 1.55;
  const otherEyeY = other.pos.y + (other.isPlayer && other.crouched ? 1.0 : 1.5);
  const toTarget = Math.atan2(-dx, -dz);
  const diff = Math.abs(angleDiff(toTarget, bot.yaw));
  const moving = Math.hypot(other.vel.x, other.vel.z) > 2.5;
  // Standing still far away, outside the cone, you stay hidden; moving or
  // close, you are easier to spot.
  if (diff > BOTS.sightHalfFov && d > 12 && !moving) return false;
  if (diff > BOTS.sightHalfFov * 1.6 && d > 6) return false;
  return world.hasLineOfSight(bot.pos.x, bot.pos.z, eyeY, other.pos.x, other.pos.z, otherEyeY);
}

export function updateBot(bot, state, dt, rng) {
  const world = state.world;
  if (!bot.alive) {
    // Fallen: lie on the ground.
    bot.mesh.rotation.x = -Math.PI / 2 + 0.12;
    bot.mesh.position.y = 0.25;
    bot.vel.x = 0;
    bot.vel.z = 0;
    // A dead defuser is no longer defusing: clear the HUD's warning, which
    // otherwise sticks on a corpse's progress forever.
    if (state.spike.defuser === bot) state.spike.defuser = null;
    return;
  }
  const player = state.player;
  const foes = bot.team === 'enemy'
    ? [player, ...state.bots.filter((b) => b.team === 'ally' && b.alive)]
    : [...state.bots.filter((b) => b.team === 'enemy' && b.alive)];
  // Perception: scan for a visible foe.
  let seen = null;
  for (const foe of foes) {
    if (foe.alive && botCanSee(bot, foe, world)) { seen = foe; break; }
  }
  if (seen) {
    bot.lastSeen = { x: seen.pos.x, z: seen.pos.z, t: state.time };
    if (bot.target !== seen) {
      bot.target = seen;
      bot.reaction = randRange(rng, BOTS.reactionMin, BOTS.reactionMax);
    }
  } else if (bot.target && state.time - (bot.lastSeen?.t ?? 0) > 2.5) {
    bot.target = null;
  }
  if (bot.target && !bot.target.alive) bot.target = null;
  // Gunfire draws bots: a shot inside hearRadius becomes an investigate point.
  if (state.lastShot && bot.team === 'enemy') {
    const s = state.lastShot;
    if (state.time - s.t < 0.4) {
      const d = Math.hypot(s.x - bot.pos.x, s.z - bot.pos.z);
      if (d < BOTS.hearRadius && !bot.target) bot.hearPos = { x: s.x, z: s.z };
    }
  }

  // Objective behaviour overrides patrol when the spike is planted.
  const planted = state.spike.planted;
  if (planted && bot.team === 'enemy' && bot.state !== 'defuse') {
    // Nearest living enemy bot goes to defuse; the rest hunt.
    const living = state.bots.filter((b) => b.team === 'enemy' && b.alive);
    const nearest = living.reduce((a, b) => {
      const da = (a.pos.x - state.spike.x) ** 2 + (a.pos.z - state.spike.z) ** 2;
      const db = (b.pos.x - state.spike.x) ** 2 + (b.pos.z - state.spike.z) ** 2;
      return db < da ? b : a;
    }, bot);
    if (nearest === bot) bot.state = 'defuse';
    else if (!bot.target) bot.state = 'hunt';
  }
  if (planted && bot.team === 'ally' && !bot.target) bot.state = 'hunt';

  // An ally that walks over a dropped spike picks it up — the round is no
  // longer stranded when the player dies carrying it.
  if (state.spike.dropped && bot.team === 'ally' && bot.alive && !state.spike.planted) {
    const d = Math.hypot(state.spike.x - bot.pos.x, state.spike.z - bot.pos.z);
    if (d < SPIKE.pickupRadius) {
      bot.hasSpike = true;
      state.spike.dropped = false;
      state.spike.carrier = bot;
      state.feed.push({ text: `${bot.name} picked up the spike`, kind: 'info', t: state.time });
      state.audio.spikePickup();
    }
  }

  // --- state machine -------------------------------------------------------
  // A spike carrier's job is the objective, not a duel: run to the nearest
  // site and plant. Combat is suspended while carrying, so the carrier
  // cannot get stuck trading shots in mid while the round clock runs out.
  if (bot.hasSpike && !planted) {
    const sites = Object.values(world.sites);
    const site = sites.reduce((a, b) => {
      const da = (a.x - bot.pos.x) ** 2 + (a.z - bot.pos.z) ** 2;
      const db = (b.x - bot.pos.x) ** 2 + (b.z - bot.pos.z) ** 2;
      return db < da ? b : a;
    });
    const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
    if (d <= site.radius) {
      bot.vel.x = 0;
      bot.vel.z = 0;
      bot.planting += dt;
      if (Math.floor(bot.planting * 4) !== Math.floor((bot.planting - dt) * 4)) {
        state.audio.plantBeep();
      }
      if (bot.planting >= SPIKE.allyPlantTime) {
        state.spike = { ...state.spike, planted: true, defused: false, dropped: false, carrier: null, pickupTimer: 0, x: site.x, z: site.z, site: site.id, timer: ROUND.detonateTime, beepTimer: 0, defuser: null };
        bot.hasSpike = false;
        bot.planting = 0;
        state.feed.push({ text: `${bot.name} planted the spike at Site ${site.id} — defend it`, kind: 'win', t: state.time });
        state.audio.roundWin();
      }
    } else {
      bot.planting = 0;
      moveBotToward(bot, site.x, site.z, SPIKE.carrierSpeed, dt, world);
    }
  } else if (bot.target && bot.reaction > 0) {
    bot.reaction -= dt;
    bot.vel.x = 0;
    bot.vel.z = 0;
    // Track the target while reacting.
    const t = bot.target;
    bot.yaw += clamp(angleDiff(Math.atan2(-(t.pos.x - bot.pos.x), -(t.pos.z - bot.pos.z)), bot.yaw), -4 * dt, 4 * dt);
  } else if (bot.target) {
    bot.state = 'engage';
    const t = bot.target;
    const dx = t.pos.x - bot.pos.x;
    const dz = t.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    bot.yaw += clamp(angleDiff(wantYaw, bot.yaw), -5 * dt, 5 * dt);
    // Strafe to stay a hard target; close in when far, back off when close.
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = randRange(rng, 0.7, 1.6);
      bot.strafeDir = rng() < 0.5 ? -1 : 1;
    }
    let mx = 0;
    let mz = 0;
    if (d > 16) { mx = -Math.sin(bot.yaw); mz = -Math.cos(bot.yaw); }
    else if (d < 5) { mx = Math.sin(bot.yaw); mz = Math.cos(bot.yaw); }
    mx += Math.cos(bot.yaw) * bot.strafeDir * 0.8;
    mz += -Math.sin(bot.yaw) * bot.strafeDir * 0.8;
    const ml = Math.hypot(mx, mz) || 1;
    const speed = BOTS.walkSpeed * 0.8;
    const ox = bot.pos.x;
    const oz = bot.pos.z;
    bot.pos.x += (mx / ml) * speed * dt;
    bot.pos.z += (mz / ml) * speed * dt;
    for (const b of world.colliders) resolveCircleBox(bot.pos, bot.radius, b);
    bot.vel.x = (bot.pos.x - ox) / dt;
    bot.vel.z = (bot.pos.z - oz) / dt;
    bot.walkPhase += dt * speed * 2.2;
    // Fire in bursts once the reaction time has passed.
    bot.fireCooldown -= dt;
    if (bot.burstLeft > 0) {
      if (bot.fireCooldown <= 0) {
        state.botShots.push({ bot, target: t });
        bot.burstLeft -= 1;
        bot.fireCooldown = 0.13;
      }
    } else {
      bot.burstPause -= dt;
      if (bot.burstPause <= 0) {
        bot.burstLeft = Math.floor(randRange(rng, BOTS.burstMin, BOTS.burstMax + 1));
        bot.burstPause = randRange(rng, BOTS.burstPauseMin, BOTS.burstPauseMax);
      }
    }
  } else if (bot.state === 'defuse') {
    const d = Math.hypot(state.spike.x - bot.pos.x, state.spike.z - bot.pos.z);
    if (d > 1.6) {
      moveBotToward(bot, state.spike.x, state.spike.z, BOTS.runSpeed, dt, world);
      bot.defusing = 0;
      state.spike.defuser = null;
    } else {
      bot.vel.x = 0;
      bot.vel.z = 0;
      bot.defusing += dt;
      state.spike.defuser = bot;
      if (Math.floor(bot.defusing * 4) !== Math.floor((bot.defusing - dt) * 4)) {
        state.audio.defuseBeep();
      }
      if (bot.defusing >= ROUND.defuseTime) {
        state.spike.defused = true;
        state.spike.planted = false;
        state.spike.defuser = null;
        bot.defusing = 0;
        state.feed.push({ text: `${bot.name} defused the spike`, kind: 'lose', t: state.time });
      }
    }
  } else if (bot.state === 'hunt' && bot.lastSeen) {
    const arrived = moveBotToward(bot, bot.lastSeen.x, bot.lastSeen.z, BOTS.runSpeed, dt, world);
    if (arrived) {
      bot.state = 'patrol';
      bot.waypoint = nearestWaypoint(bot, world);
    }
  } else if (bot.hearPos && bot.state === 'patrol') {
    const arrived = moveBotToward(bot, bot.hearPos.x, bot.hearPos.z, BOTS.runSpeed, dt, world);
    if (arrived) bot.hearPos = null;
  } else if (bot.state === 'hold' && bot.holdSite) {
    // Defenders hold near their site, shifting between two nearby waypoints.
    const site = world.sites[bot.holdSite];
    const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
    if (d > 6) moveBotToward(bot, site.x, site.z, BOTS.walkSpeed, dt, world);
    else {
      bot.vel.x = 0;
      bot.vel.z = 0;
      bot.waitTimer -= dt;
      if (bot.waitTimer <= 0) {
        bot.waitTimer = randRange(rng, 2, 5);
        bot.yaw += randRange(rng, -1.2, 1.2);
      }
    }
  } else {
    // Patrol the waypoint graph.
    bot.state = 'patrol';
    if (bot.waitTimer > 0) {
      bot.waitTimer -= dt;
      bot.vel.x = 0;
      bot.vel.z = 0;
    } else {
      const wp = world.waypoints[bot.waypoint];
      const arrived = moveBotToward(bot, wp.x, wp.z, BOTS.walkSpeed, dt, world);
      if (arrived) {
        bot.waypoint = pick(rng, wp.links);
        bot.waitTimer = rng() < 0.3 ? randRange(rng, 0.5, 2) : 0;
      }
    }
  }

  // Ally bots trail the player at a loose distance when idle.
  if (bot.team === 'ally' && !bot.target && bot.state === 'patrol' && state.roundPhase === 'live') {
    const d = Math.hypot(player.pos.x - bot.pos.x, player.pos.z - bot.pos.z);
    if (d > 14) moveBotToward(bot, player.pos.x, player.pos.z, BOTS.walkSpeed, dt, world);
  }

  // Sync the mesh: position, facing, walk cycle.
  bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  bot.mesh.rotation.y = bot.yaw;
  const swing = Math.sin(bot.walkPhase) * 0.45;
  bot.mesh.userData.legL.rotation.x = swing;
  bot.mesh.userData.legR.rotation.x = -swing;
}
