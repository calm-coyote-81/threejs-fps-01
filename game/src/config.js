// Tunables for Ember Yard. Nothing here is read from the network; the whole
// game is decided by these numbers plus the map in world.js.

export const ARENA = {
  width: 56, // x: -28 .. 28
  depth: 40, // z: -20 .. 20
  wallHeight: 5,
  eyeHeight: 1.62,
  crouchEye: 1.05,
  gravity: 22,
  jumpSpeed: 7.2,
};

export const PLAYER = {
  radius: 0.42,
  walkSpeed: 5.2,
  sprintSpeed: 7.0,
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
    damage: 26,
    headMult: 2.0,
    fireInterval: 0.115,
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
    price: 800,
    auto: true,
    damage: 17,
    headMult: 1.8,
    fireInterval: 0.075,
    mag: 32,
    reserveMax: 128,
    reloadTime: 1.7,
    spreadBase: 0.016,
    spreadMove: 0.038,
    spreadPerShot: 0.0035,
    spreadMax: 0.06,
    recoil: 0.007,
    range: 55,
    tracer: true,
  },
  dmr: {
    id: 'dmr',
    name: 'Longbow DMR',
    price: 2400,
    auto: false,
    damage: 74,
    headMult: 2.2,
    fireInterval: 0.85,
    mag: 8,
    reserveMax: 32,
    reloadTime: 2.8,
    spreadBase: 0.004,
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
    damage: 20,
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
  radius: 7.5,
  damage: 110, // at the centre, falling off linearly to 15 at the edge
  minDamage: 15,
  throwSpeed: 16,
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  roundWin: 1200,
  roundLoss: 600,
  plantReward: 400,
  defuseReward: 400,
  maxMoney: 9000,
};

export const ROUND = {
  roundsToWin: 5,
  maxRounds: 9,
  roundTime: 100, // seconds; attackers lose on timeout if the spike is not planted
  buyTime: 18, // seconds of buy phase before the round clock starts
  plantTime: 3.0, // seconds channelling E on a site
  defuseTime: 5.0,
  detonateTime: 35, // seconds from plant to detonation
  freezeAfterRound: 4, // seconds the end banner shows before the next buy phase
};

export const BOTS = {
  countEnemy: 4,
  countAlly: 2,
  health: 100,
  walkSpeed: 3.4,
  runSpeed: 4.6,
  reactionMin: 0.35, // seconds before a bot that just saw you starts firing
  reactionMax: 0.8,
  aimError: 0.035, // radians of random aim error, worse while moving
  burstMin: 3,
  burstMax: 6,
  burstPauseMin: 0.5,
  burstPauseMax: 1.1,
  hearRadius: 26, // gunfire heard inside this radius draws bots to investigate
  sightRange: 42,
  sightHalfFov: 1.05, // radians; bots see you inside this cone (or if you shoot)
};
