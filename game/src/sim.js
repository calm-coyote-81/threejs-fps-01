// Simulation: the match state machine. One place holds the score, the
// round clock, the economy, the spike and every actor, and one fixed-step
// function advances it. Rendering never writes here; it only reads.
import { ECONOMY, ROUND, WEAPONS, GRENADE, SPIKE } from './config.js';
import { createPlayer, createBot, updatePlayer, updateBot, botCanSee, applyDamage } from './actors.js';
import { tryFirePlayer, startReload, finishReload, resolveBotShot, updateGrenades, throwGrenadeAtPoint } from './combat.js';
import { randRange } from './util.js';

export function createGameState(scene, world, audio, effects, viewModel, rng) {
  const state = {
    scene,
    world,
    audio,
    effects,
    viewModel,
    rng,
    time: 0,
    player: null,
    bots: [],
    round: 1,
    score: { us: 0, them: 0 },
    roundPhase: 'buy', // 'buy' | 'live' | 'over'
    buyTimer: ROUND.buyTime,
    roundTimer: ROUND.roundTime,
    freezeTimer: 0,
    roundReason: '',
    // The spike starts on the player's back. `dropped` marks it lying on
    // the ground after a carrier died; `carrier` is the ally bot carrying
    // it, or null when the player (or nobody) has it.
    spike: { planted: false, defused: false, dropped: false, carrier: null, pickupTimer: 0, x: 0, z: 0, site: null, timer: 0, beepTimer: 0, defuser: null },
    feed: [],
    hitmarker: null,
    damageFlash: -10,
    damageFrom: 0,
    lastShot: null,
    botShots: [],
    grenades: [],
    shake: 0,
    matchOver: false,
    matchWinner: null,
    suppressBuy: false, // screenshot staging (start screen) hides the buy menu
    stats: { shots: 0, hits: 0, plants: 0 },
  };
  state.player = createPlayer(world.spawns.attacker[1]);
  return state;
}

function placeActors(state) {
  const { world, player, bots, rng } = state;
  const aSpawn = world.spawns.attacker;
  player.pos.x = aSpawn[1].x;
  player.pos.z = aSpawn[1].z;
  player.pos.y = 0;
  player.yaw = aSpawn[1].yaw;
  player.pitch = 0;
  player.vel.x = 0;
  player.vel.z = 0;
  player.vy = 0;
  player.health = 100;
  player.armor = 50;
  player.alive = true;
  player.hasSpike = true;
  player.planting = 0;
  player.defusing = 0;
  // Refill magazines; reserves persist between rounds.
  for (const id of player.weapons) {
    const w = WEAPONS[id];
    const ammo = player.ammo[id];
    const missing = w.mag - ammo.mag;
    const take = Math.min(missing, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }
  const allySpawns = [aSpawn[0], aSpawn[2]];
  const enemySpawns = world.spawns.defender;
  let ai = 0;
  let ei = 0;
  for (const bot of bots) {
    const spawn = bot.team === 'ally' ? allySpawns[ai++] : enemySpawns[ei++];
    bot.pos.x = spawn.x;
    bot.pos.z = spawn.z;
    bot.pos.y = 0;
    bot.yaw = spawn.yaw;
    bot.health = 100;
    bot.armor = 0;
    bot.alive = true;
    bot.state = bot.team === 'enemy' ? 'hold' : 'patrol';
    bot.target = null;
    bot.lastSeen = null;
    bot.hearPos = null;
    bot.defusing = 0;
    bot.burstLeft = 0;
    bot.burstPause = 0;
    bot.hasSpike = false; // nobody carries into a new round but the player
    bot.planting = 0;
    bot.mesh.rotation.x = 0;
    bot.mesh.position.set(spawn.x, 0, spawn.z);
    bot.mesh.rotation.y = spawn.yaw;
    bot.waypoint = Math.floor(rng() * world.waypoints.length);
    bot.waitTimer = 0;
  }
  state.spike = { planted: false, defused: false, dropped: false, carrier: null, pickupTimer: 0, x: 0, z: 0, site: null, timer: 0, beepTimer: 0, defuser: null };
  state.grenades.forEach((g) => state.scene.remove(g.mesh));
  state.grenades.length = 0;
}

export function spawnBots(state) {
  const { world, rng } = state;
  state.bots = [];
  for (let i = 0; i < 2; i++) {
    state.bots.push(createBot('ally', i, world.spawns.attacker[i === 0 ? 0 : 2], state.scene, rng));
  }
  for (let i = 0; i < 4; i++) {
    state.bots.push(createBot('enemy', i, world.spawns.defender[i], state.scene, rng));
  }
}

export function startMatch(state) {
  state.score = { us: 0, them: 0 };
  state.round = 1;
  state.matchOver = false;
  state.matchWinner = null;
  state.feed.length = 0;
  state.botShots.length = 0;
  const player = state.player;
  player.money = ECONOMY.startMoney;
  player.weapons = ['carbine', 'sidearm'];
  player.weaponIndex = 0;
  player.kills = 0;
  player.deaths = 0;
  // A fresh match starts from the loadout, not from last match's leftovers:
  // grenades and bought reserves do not carry across "Play again".
  player.grenades = 0;
  player.ammo = {
    carbine: { mag: 30, reserve: 120 },
    sidearm: { mag: 12, reserve: 48 },
    smg: { mag: 32, reserve: 128 },
    dmr: { mag: 8, reserve: 32 },
  };
  player.reloading = false;
  player.reloadTimer = 0;
  state.stats = { shots: 0, hits: 0, plants: 0 };
  startBuyPhase(state);
}

function startBuyPhase(state) {
  placeActors(state);
  state.roundPhase = 'buy';
  state.buyTimer = ROUND.buyTime;
  state.roundTimer = ROUND.roundTime;
  state.feed.push({ text: `Round ${state.round} — buy phase`, kind: 'info', t: state.time });
}

function startRound(state) {
  state.roundPhase = 'live';
  state.roundTimer = ROUND.roundTime;
  state.audio.roundStart();
  state.feed.push({ text: 'Round started — plant the spike at A or B', kind: 'info', t: state.time });
}

// A carrier died: the spike drops where they fell instead of vanishing
// with them. Until someone walks over it, the round can only be won by
// elimination — which is exactly the failure the old build had permanently.
function dropSpike(state, carrier) {
  const angle = state.rng() * Math.PI * 2;
  const scatter = state.rng() * SPIKE.dropScatter;
  carrier.hasSpike = false;
  state.spike.dropped = true;
  state.spike.carrier = null;
  state.spike.x = carrier.pos.x + Math.cos(angle) * scatter;
  state.spike.z = carrier.pos.z + Math.sin(angle) * scatter;
  state.spike.pickupTimer = 0;
  state.feed.push({ text: `${carrier.name} dropped the spike`, kind: 'info', t: state.time });
  state.audio.spikeDrop();
}

// Carriers die in several places (bot shots, grenades); one sweep per step
// catches them all instead of wiring a drop into every damage path.
function checkSpikeDrops(state) {
  const player = state.player;
  if (!player.alive && player.hasSpike) dropSpike(state, player);
  for (const bot of state.bots) {
    if (bot.team === 'ally' && !bot.alive && bot.hasSpike) dropSpike(state, bot);
  }
}

function endRound(state, winner, reason) {
  if (state.roundPhase === 'over') return;
  state.roundPhase = 'over';
  state.roundReason = reason;
  state.freezeTimer = ROUND.freezeAfterRound;
  // Queued bot shots belong to the round that just ended: bots keep
  // queuing shots during the freeze, and without this they would resolve
  // against the freshly placed actors of the next round.
  state.botShots.length = 0;
  state.spike.defuser = null;
  if (winner === 'us') {
    state.score.us += 1;
    state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + ECONOMY.roundWin);
    state.audio.roundWin();
    state.feed.push({ text: `Round ${state.round} won — ${reason}`, kind: 'win', t: state.time });
  } else {
    state.score.them += 1;
    state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + ECONOMY.roundLoss);
    state.audio.roundLose();
    state.feed.push({ text: `Round ${state.round} lost — ${reason}`, kind: 'lose', t: state.time });
  }
  if (state.score.us >= ROUND.roundsToWin || state.score.them >= ROUND.roundsToWin || state.round >= ROUND.maxRounds) {
    state.matchOver = true;
    state.matchWinner = state.score.us > state.score.them ? 'us' : state.score.them > state.score.us ? 'them' : 'draw';
  }
}

export function buyWeapon(state, id) {
  const player = state.player;
  const weapon = WEAPONS[id];
  if (!weapon || state.roundPhase !== 'buy') return { ok: false, why: 'Buy phase is over' };
  if (player.weapons.includes(id)) return { ok: false, why: 'Already owned' };
  if (player.money < weapon.price) return { ok: false, why: 'Not enough credits' };
  player.money -= weapon.price;
  player.weapons.push(id);
  player.weaponIndex = player.weapons.indexOf(id);
  state.audio.buy();
  state.feed.push({ text: `Bought ${weapon.name} — $${weapon.price}`, kind: 'info', t: state.time });
  return { ok: true };
}

export function buyGrenade(state) {
  const player = state.player;
  if (state.roundPhase !== 'buy') return { ok: false, why: 'Buy phase is over' };
  if (player.grenades >= 2) return { ok: false, why: 'Carrying the maximum' };
  if (player.money < GRENADE.price) return { ok: false, why: 'Not enough credits' };
  player.money -= GRENADE.price;
  player.grenades += 1;
  state.audio.buy();
  state.feed.push({ text: 'Bought a Spark grenade — $300', kind: 'info', t: state.time });
  return { ok: true };
}

export function buyAmmo(state) {
  const player = state.player;
  if (state.roundPhase !== 'buy') return { ok: false, why: 'Buy phase is over' };
  let spent = 0;
  for (const id of player.weapons) {
    const w = WEAPONS[id];
    const ammo = player.ammo[id];
    const missing = w.reserveMax - ammo.reserve;
    if (missing > 0 && player.money - spent >= 100) {
      spent += 100;
      ammo.reserve = w.reserveMax;
    }
  }
  if (spent === 0) return { ok: false, why: 'Reserves are already full' };
  player.money -= spent;
  state.audio.buy();
  state.feed.push({ text: `Restocked reserve ammo — $${spent}`, kind: 'info', t: state.time });
  return { ok: true };
}

// One fixed step (1/60 s). `input` carries the frame's keys and look deltas.
export function stepGame(state, input, dt) {
  state.time += dt;
  const player = state.player;

  // Cooldowns tick in every phase.
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  if (player.reloading) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) finishReload(player);
  }
  state.shake = Math.max(0, state.shake - dt * 1.4);
  if (state.hitmarker && state.time - state.hitmarker.t > 0.25) state.hitmarker = null;

  if (state.roundPhase === 'buy') {
    state.buyTimer -= dt;
    // Bots idle at spawn during the buy phase; the player can walk the yard.
    updatePlayer(player, input, dt, state.world);
    if (state.buyTimer <= 0) startRound(state);
    return;
  }

  if (state.roundPhase === 'over') {
    state.freezeTimer -= dt;
    for (const bot of state.bots) updateBot(bot, state, dt, state.rng);
    updateGrenades(state, dt);
    if (state.freezeTimer <= 0 && !state.matchOver) {
      state.round += 1;
      startBuyPhase(state);
    }
    return;
  }

  // --- live round ----------------------------------------------------------
  state.roundTimer -= dt;

  // Player movement and actions.
  if (player.alive) {
    const stepped = updatePlayer(player, input, dt, state.world);
    if (stepped) state.audio.step(input.sprint && input.f);
    if (input.fireHeld) {
      const res = tryFirePlayer(state, state.rng);
      if (res.fired) {
        state.stats.shots += 1;
        if (res.hit) state.stats.hits += 1;
      }
    }
    if (input.reload) startReload(state);
    // Planting: hold E inside a site while carrying the spike.
    if (!state.spike.planted && player.hasSpike) {
      const site = Object.values(state.world.sites).find(
        (s) => Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < s.radius,
      );
      if (site && input.plant) {
        player.planting += dt;
        if (Math.floor(player.planting * 4) !== Math.floor((player.planting - dt) * 4)) {
          state.audio.plantBeep();
        }
        if (player.planting >= ROUND.plantTime) {
          state.spike = { planted: true, defused: false, dropped: false, carrier: null, pickupTimer: 0, x: site.x, z: site.z, site: site.id, timer: ROUND.detonateTime, beepTimer: 0, defuser: null };
          player.hasSpike = false;
          player.planting = 0;
          player.money = Math.min(ECONOMY.maxMoney, player.money + ECONOMY.plantReward);
          state.stats.plants += 1;
          state.feed.push({ text: `Spike planted at Site ${site.id} — defend it`, kind: 'win', t: state.time });
          state.audio.roundWin();
        }
      } else {
        player.planting = Math.max(0, player.planting - dt * 2);
      }
    }
    // Picking up a dropped spike: stand on it briefly and it is yours
    // again. The short channel stops the spike flickering between carriers
    // when two teammates cross the same spot.
    if (state.spike.dropped && player.alive) {
      const d = Math.hypot(state.spike.x - player.pos.x, state.spike.z - player.pos.z);
      if (d < SPIKE.pickupRadius) {
        state.spike.pickupTimer += dt;
        if (state.spike.pickupTimer >= SPIKE.pickupDelay) {
          player.hasSpike = true;
          state.spike.dropped = false;
          state.spike.carrier = null;
          state.spike.pickupTimer = 0;
          state.feed.push({ text: 'You picked up the spike', kind: 'info', t: state.time });
          state.audio.spikePickup();
        }
      } else {
        state.spike.pickupTimer = 0;
      }
    }
  }

  // Spike countdown.
  if (state.spike.planted) {
    state.spike.timer -= dt;
    state.spike.beepTimer -= dt;
    if (state.spike.beepTimer <= 0) {
      state.spike.beepTimer = Math.max(0.25, state.spike.timer / ROUND.detonateTime);
      state.audio.plantBeep();
    }
    if (state.spike.timer <= 0) {
      endRound(state, 'us', 'spike detonated');
      return;
    }
  }
  if (state.spike.defused) {
    endRound(state, 'them', 'spike defused');
    return;
  }

  // Bots and their queued shots.
  for (const bot of state.bots) updateBot(bot, state, dt, state.rng);
  while (state.botShots.length > 0) {
    resolveBotShot(state, state.botShots.shift(), state.rng);
  }
  // Enemy bots lob a grenade at a visible target now and then — it flushes
  // a player out of cover instead of letting them hold one angle all round.
  for (const bot of state.bots) {
    if (bot.team !== 'enemy' || !bot.alive || !bot.target) continue;
    bot.grenadeTimer -= dt;
    if (bot.grenadeTimer > 0) continue;
    const d = Math.hypot(bot.target.pos.x - bot.pos.x, bot.target.pos.z - bot.pos.z);
    if (d > 8 && d < 24 && botCanSee(bot, bot.target, state.world)) {
      throwGrenadeAtPoint(state, bot, bot.target.pos.x, bot.target.pos.z);
      bot.grenadeTimer = randRange(state.rng, 14, 22);
    } else {
      bot.grenadeTimer = 2; // not a good throw yet; check again soon
    }
  }
  updateGrenades(state, dt);

  // A carrier may have died to a bot shot or a grenade this step.
  checkSpikeDrops(state);

  // Round end conditions.
  const enemiesAlive = state.bots.some((b) => b.team === 'enemy' && b.alive);
  const friendliesAlive = player.alive || state.bots.some((b) => b.team === 'ally' && b.alive);
  if (!enemiesAlive) {
    endRound(state, 'us', 'enemy team eliminated');
    return;
  }
  if (!friendliesAlive) {
    endRound(state, 'them', 'your team was eliminated');
    return;
  }
  if (state.roundTimer <= 0 && !state.spike.planted) {
    endRound(state, 'them', 'time expired before the plant');
  }
}

// Damage from an explosion or a fall is routed through here so the feed and
// the player's death stay consistent; see actors.applyDamage.
export { applyDamage };
