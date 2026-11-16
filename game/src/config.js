// Tunables for Ember Yard. Nothing here is read from the network; the whole
// game is decided by these numbers plus the map in world.js.
//
// Balance notes (revised round 2, after the first fresh-session play-test):
// every weapon is priced against a round's income — a kill pays $250 and a
// round win $1000, so a player who wins a round and gets two kills banks
// ~$1500, which buys exactly one tier of gun per round. The DMR is the only
// weapon that one-taps a helmetless headshot through armour, which is why
// it costs more than two rounds of perfect play. Bots react in 0.3–0.7 s so
// a player who peeks first usually wins the duel, but a player who holds a
// bad angle still loses it.

export const ARENA = {
  width: 56, // x: -28 .. 28
  depth: 40, // z: -20 .. 20
  wallHeight: 5,
  eyeHeight: 1.62,
  crouchEye: 1.05,
  gravity: 22,
  jumpSpeed: 7.6, // up from 7.2: clears the 1.1 m crates without a running start
};

export const PLAYER = {
  radius: 0.42,
  walkSpeed: 5.4, // up from 5.2: crossing mid (28 m) takes ~5 s, not ~5.5
  sprintSpeed: 7.4, // up from 7.0: sprinting to a site beats the defenders' rotate
  crouchSpeed: 2.6,
  accel: 34,
  friction: 11,
  airControl: 0.35,
  health: 100,
  armor: 50, // absorbs 50% of damage until depleted
};

export const WEAPONS = {
  carbine: {
    id: 'carbine',
    name: 'VK-9 Carbine',
    price: 0,
    auto: true,
    // 24 damage: 5 body shots to kill an unarmoured bot (100 hp), 7 through
    // fresh armour (150 effective hp). The old 26 made it a 4-shot kill,
    // which left the SMG with no reason to exist.
    damage: 24,
    headMult: 2.0,
    fireInterval: 0.12, // 500 rpm; was 0.115 — a touch slower to pay for the TTK above
    mag: 30,
    reserveMax: 120,
    reloadTime: 2.1,
    spreadBase: 0.011,
    spreadMove: 0.030,
    spreadPerShot: 0.0045,
    spreadMax: 0.055,
    recoil: 0.011,
    range: 90,
    tracer: true,
  },
  smg: {
    id: 'smg',
    name: 'Hornet SMG',
    price: 700, // down from 800: affordable after one kill in round 1
    auto: true,
    damage: 18, // up from 17: 6 body shots unarmoured, so it beats the carbine close-up
    headMult: 1.8,
    fireInterval: 0.075, // 800 rpm — the close-quarters shredder
    mag: 32,
    reserveMax: 128,
    reloadTime: 1.7,
    spreadBase: 0.016,
    spreadMove: 0.038,
    spreadPerShot: 0.0035,
    spreadMax: 0.06,
    recoil: 0.007,
    range: 55, // hard falloff past mid: this is not a lane gun
    tracer: true,
  },
  dmr: {
    id: 'dmr',
    name: 'Longbow DMR',
    price: 2200, // down from 2400: reachable after two won rounds, not three
    auto: false,
    damage: 80, // up from 74: a headshot (×2.2 = 176) kills through full armour
    headMult: 2.2,
    fireInterval: 0.85,
    mag: 8,
    reserveMax: 32,
    reloadTime: 2.8,
    spreadBase: 0.004, // laser-accurate standing still; the price is the fire rate
    spreadMove: 0.05,
    spreadPerShot: 0.02,
    spreadMax: 0.07,
    recoil: 0.045,
    range: 120,
    tracer: true,
    zoomFov: 34,
  },
  sidearm: {
    id: 'sidearm',
    name: 'P9 Sidearm',
    price: 0,
    auto: false,
    damage: 22, // up from 20: 5 body shots, so the fallback pistol can still clutch
    headMult: 1.8,
    fireInterval: 0.22,
    mag: 12,
    reserveMax: 48,
    reloadTime: 1.4,
    spreadBase: 0.014,
    spreadMove: 0.032,
    spreadPerShot: 0.006,
    spreadMax: 0.05,
    recoil: 0.012,
    range: 45,
    tracer: true,
  },
};

export const GRENADE = {
  price: 300,
  fuse: 1.6, // seconds after the throw before it bursts
  radius: 8, // up from 7.5: covers a whole site (radius 3.2) plus its approaches
  damage: 100, // down from 110: a centre hit still kills an unarmoured bot, not an armoured one
  minDamage: 15,
  throwSpeed: 16,
};

export const ECONOMY = {
  startMoney: 1000, // up from 800: SMG ($700) + one grenade ($300) is exactly round 1
  killReward: 250, // down from 300: kills alone should not fund a DMR in two rounds
  roundWin: 1000, // down from 1200: the win bonus plus two kills is one gun tier
  roundLoss: 700, // up from 600: a losing streak still affords an SMG every round
  plantReward: 500, // up from 400: planting is the objective, it should pay like a win
  defuseReward: 400,
  maxMoney: 9000,
};

export const ROUND = {
  roundsToWin: 5,
  maxRounds: 9,
  roundTime: 110, // up from 100: the map is 56 m wide, rotates need the extra 10 s
  buyTime: 20, // up from 18: first-time players need the extra seconds to read the shop
  plantTime: 3.5, // up from 3.0: a 3 s channel was plantable between bot bursts too easily
  defuseTime: 5.0,
  detonateTime: 40, // up from 35: defenders get a real retake window after a plant
  freezeAfterRound: 4, // seconds the end banner shows before the next buy phase
};

// The spike: the objective the attackers carry. Round 2 adds a real drop /
// pickup flow — a dead carrier no longer strands the round on elimination
// alone. See sim.js for the flow and actors.js for the ally carry behaviour.
export const SPIKE = {
  pickupRadius: 1.6, // walk within this of a dropped spike to pick it up
  pickupDelay: 0.25, // seconds standing on the spike before it is yours (avoids flicker)
  dropScatter: 0.6, // metres the spike scatters from the carrier's feet on death
  allyPlantTime: 3.5, // an ally bot channels the same plant time as the player
  carrierSpeed: 4.6, // an ally carrying the spike runs at bot run speed
};

export const BOTS = {
  countEnemy: 4,
  countAlly: 2,
  health: 100,
  walkSpeed: 3.4,
  runSpeed: 4.6,
  reactionMin: 0.3, // down from 0.35: bots punish a slow peek, but still lose to a fast one
  reactionMax: 0.7, // down from 0.8: the spread is tighter, so duels feel fairer
  aimError: 0.03, // down from 0.035: bots hit ~55% of shots at 15 m, ~35% at 30 m
  burstMin: 3,
  burstMax: 6,
  burstPauseMin: 0.5,
  burstPauseMax: 1.1,
  hearRadius: 24, // down from 26: gunfire across the whole map no longer pulls every bot
  sightRange: 42,
  sightHalfFov: 1.05, // radians; bots see you inside this cone (or if you shoot)
};

// Audio mix: one place for volumes so a loud effect can be turned down
// without hunting through audio.js.
export const AUDIO = {
  masterVolume: 0.35,
  sfxVolume: 1.0,
  ambientVolume: 0.12, // wind loop, barely there until the round goes quiet
  footstepVolume: 0.07,
  distantShotVolume: 0.18,
  lowHealthThreshold: 30, // heartbeat starts under this health
  heartbeatInterval: 0.9, // seconds between low-health thumps
};
