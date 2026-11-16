// Bootstrap and the render loop. The simulation runs on a fixed 1/60 s step
// kept apart from rendering: input is sampled, the step advances the match,
// then the camera is placed from the player's state and the scene is drawn.
// `?shot=start|play|buy|end&seed=N` stages the game for screenshots without
// a pointer lock: the same code path renders them, nothing is faked.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ARENA, WEAPONS, ROUND } from './config.js';
import { mulberry32, clamp, lerp } from './util.js';
import { buildWorld } from './world.js';
import { createAudio } from './audio.js';
import { createGameState, startMatch, spawnBots, buyWeapon, buyGrenade, buyAmmo, stepGame } from './sim.js';
import { createViewModel, createEffects, updateViewModel, setViewModelWeapon, throwGrenade } from './combat.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') ?? 7) || 7;
const shot = params.get('shot'); // start | play | buy | end | null
const rng = mulberry32(seed);

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene, rng);
const audio = createAudio();
const effects = createEffects(scene);
const viewModel = createViewModel(camera);
const state = createGameState(scene, world, audio, effects, viewModel, rng);
spawnBots(state);

const inputCtl = createInput(renderer.domElement);
const input = inputCtl.input;

let started = false;
let paused = false;

const hud = createHud(state, {
  onPlay() {
    audio.unlock();
    if (!started) {
      started = true;
      startMatch(state);
    }
    hud.hideStart();
    hud.showPause(false);
    paused = false;
    // Deliberately no pointer lock here: the buy menu is open and the
    // player needs a free cursor to click its cards. The lock engages when
    // the player clicks the yard (see the canvas handler below).
  },
  onResume() {
    hud.showPause(false);
    paused = false;
    // Resume also leaves the cursor free: the player re-locks by clicking
    // the yard, which is also how they re-enter the fight.
  },
  onRestart() {
    audio.unlock();
    startMatch(state);
    hud.hideStart();
    hud.showPause(false);
    paused = false;
  },
  onBuyWeapon(id) {
    const res = buyWeapon(state, id);
    if (!res.ok) flashBuyNote(res.why);
    else setViewModelWeapon(viewModel, id); // buying equips it at once
  },
  onBuyGrenade() {
    const res = buyGrenade(state);
    if (!res.ok) flashBuyNote(res.why);
  },
  onBuyAmmo() {
    const res = buyAmmo(state);
    if (!res.ok) flashBuyNote(res.why);
  },
  onCloseBuy() {
    hud.closeBuy();
  },
});

function flashBuyNote(text) {
  const n = document.getElementById('buy-note');
  if (!n) return;
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(flashBuyNote._t);
  flashBuyNote._t = setTimeout(() => n.classList.remove('show'), 1600);
}

// Clicking the yard locks the pointer so mouse-look and firing work. Clicks
// on the buy menu never reach the canvas (the menu sits above it), so the
// player can shop with a free cursor and lock in by clicking beside it.
renderer.domElement.addEventListener('mousedown', () => {
  if (shot) return;
  if (started && !paused && !state.matchOver && !input.locked) inputCtl.lock();
});

// Buy menu toggle and pause key, handled outside the simulation input.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && state.roundPhase === 'buy' && started && !state.matchOver) {
    const menu = document.getElementById('buy-menu');
    if (menu.hidden) hud.reopenBuy();
    else hud.closeBuy();
  }
  if (e.code === 'KeyP' && started && !shot) {
    paused = !paused;
    hud.showPause(paused);
    if (paused) inputCtl.unlock();
    else inputCtl.lock();
  }
});

// Pointer lock loss pauses the match — but only while a round is live.
// During the buy phase the player exits the lock on purpose to click the
// buy menu, and pausing there would cover the menu with the pause screen.
document.addEventListener('pointerlockchange', () => {
  if (shot) return;
  if (!input.locked && started && !state.matchOver && !paused && state.roundPhase === 'live') {
    const startHidden = document.getElementById('start-screen').hidden;
    if (startHidden) {
      paused = true;
      hud.showPause(true);
    }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- screenshot staging -----------------------------------------------------
if (shot === 'start') {
  state.suppressBuy = true;
}
if (shot === 'play' || shot === 'buy' || shot === 'end') {
  started = true;
  startMatch(state);
  hud.hideStart();
  if (shot === 'buy') {
    // Stay in the buy phase with the menu open.
  } else if (shot === 'play') {
    state.roundPhase = 'live';
    state.roundTimer = 96;
    // Vantage: south edge of mid, looking north up the lane at the enemy.
    state.player.pos.x = 0;
    state.player.pos.z = 17;
    state.player.yaw = 0.04;
    state.player.pitch = 0.01;
    const foes = state.bots.filter((b) => b.team === 'enemy');
    foes[0].pos.x = -2.5; foes[0].pos.z = -5; foes[0].yaw = Math.PI;
    foes[1].pos.x = 3.5; foes[1].pos.z = -8; foes[1].yaw = Math.PI;
    foes[2].pos.x = -9; foes[2].pos.z = -10; foes[2].yaw = Math.PI * 0.8;
    const allies = state.bots.filter((b) => b.team === 'ally');
    allies[0].pos.x = -4; allies[0].pos.z = 12; allies[0].yaw = 0.2;
    // Let the bots settle into their patrols so the frame is alive.
    const idle = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false, fireHeld: false };
    for (let i = 0; i < 150; i++) stepGame(state, idle, STEP);
    state.player.pos.x = 0;
    state.player.pos.z = 17;
    state.player.yaw = 0.04;
    // The staging fight must not leave the player wounded or the feed stale.
    state.player.health = 100;
    state.player.armor = 50;
    state.feed.length = 0;
  } else if (shot === 'end') {
    state.score.us = 5;
    state.score.them = 2;
    state.round = 7;
    state.roundPhase = 'over';
    state.roundReason = 'enemy team eliminated';
    state.matchOver = true;
    state.matchWinner = 'us';
    state.player.kills = 14;
    state.stats = { shots: 212, hits: 96, plants: 2 };
    state.player.pos.x = -6;
    state.player.pos.z = 10;
    state.player.yaw = 0.6;
    state.feed.length = 0;
    state.feed.push({ text: 'Round 7 won — enemy team eliminated', kind: 'win', t: state.time });
  }
}

// --- main loop ---------------------------------------------------------------
let last = performance.now();
let acc = 0;

const aimHint = document.getElementById('aim-hint');

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // Mouse look applies every frame, not per step.
  const look = inputCtl.consumeLook();
  const sens = input.ads ? 0.0013 : 0.0023;
  state.player.yaw -= look.dx * sens;
  state.player.pitch = clamp(state.player.pitch - look.dy * sens, -1.45, 1.45);

  // Weapon switching and grenades are frame-level actions.
  if (input.switchTo >= 0 && input.switchTo < state.player.weapons.length) {
    state.player.weaponIndex = input.switchTo;
    state.player.reloading = false;
    state.player.reloadTimer = 0;
    setViewModelWeapon(viewModel, state.player.weapons[state.player.weaponIndex]);
  }
  if (input.grenade && state.roundPhase === 'live' && state.player.alive) {
    throwGrenade(state, state.player);
  }

  if (started && !paused) {
    // Resolve semi-auto vs automatic fire before stepping.
    const weapon = WEAPONS[state.player.weapons[state.player.weaponIndex]];
    const stepInput = { ...input, fireHeld: weapon.auto ? input.fireHeld : input.fireEdge };
    acc += frameDt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      stepGame(state, stepInput, STEP);
      acc -= STEP;
      steps += 1;
      inputCtl.clearOneShots();
      stepInput.fireEdge = false;
    }
    if (steps === 5) acc = 0;
  } else {
    inputCtl.clearOneShots();
  }

  // --- camera ------------------------------------------------------------------
  const p = state.player;
  const eyeBase = p.crouched ? 1.05 : 1.62;
  const bobY = Math.sin(p.bobPhase * 2) * 0.028 * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5);
  const eyeY = p.alive ? p.pos.y + eyeBase + bobY : lerp(camera.position.y, 0.7, 0.08);
  const shake = state.shake;
  camera.position.set(
    p.pos.x + (Math.random() - 0.5) * shake * 0.12,
    eyeY + (Math.random() - 0.5) * shake * 0.12,
    p.pos.z + (Math.random() - 0.5) * shake * 0.12,
  );
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  camera.rotation.z = lerp(camera.rotation.z, (input.r ? -0.012 : 0) + (input.l ? 0.012 : 0), 0.2);
  // Aim-down-sights narrows the field of view (the DMR zooms further).
  const weapon = WEAPONS[p.weapons[p.weaponIndex]];
  const targetFov = input.ads ? (weapon.zoomFov ?? 52) : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-12 * frameDt));
    camera.updateProjectionMatrix();
  }
  viewModel.group.visible = started && p.alive && shot !== 'start' && shot !== 'end';
  updateViewModel(viewModel, p, frameDt, Math.hypot(p.vel.x, p.vel.z), input.ads);

  // Nudge the player to click the yard when a round is live but the mouse
  // is not locked yet (e.g. right after the buy phase ends).
  if (aimHint) {
    aimHint.hidden = !(started && !paused && !shot && !state.matchOver && state.roundPhase === 'live' && !input.locked);
  }

  world.update(frameDt);
  effects.update(frameDt);
  hud.update();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
