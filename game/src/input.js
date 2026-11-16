// Input: keyboard, mouse look and pointer lock, reduced to one plain object
// the simulation reads each fixed step. One-shot actions (reload, grenade,
// weapon switch) are flags main.js clears after the step consumes them.
//
// Round 2: bindings are remappable and persist in localStorage, jumps are
// buffered (pressing Space just before landing still jumps), the mouse wheel
// cycles weapons, crouch can be a toggle, and pointer-lock failures are
// reported instead of throwing an unhandled rejection into the console.
import { clamp } from './util.js';

// Every action a key can be bound to. `hold` actions stay true while the key
// is down; `press` actions fire once per keydown.
export const ACTIONS = [
  { id: 'f', label: 'Move forward', kind: 'hold' },
  { id: 'b', label: 'Move back', kind: 'hold' },
  { id: 'l', label: 'Strafe left', kind: 'hold' },
  { id: 'r', label: 'Strafe right', kind: 'hold' },
  { id: 'sprint', label: 'Sprint', kind: 'hold' },
  { id: 'crouch', label: 'Crouch', kind: 'hold' },
  { id: 'jump', label: 'Jump', kind: 'press' },
  { id: 'plant', label: 'Plant / interact', kind: 'hold' },
  { id: 'reload', label: 'Reload', kind: 'press' },
  { id: 'grenade', label: 'Throw grenade', kind: 'press' },
];

const DEFAULT_BINDINGS = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', KeyC: 'crouch',
  Space: 'jump',
  KeyE: 'plant',
  KeyR: 'reload',
  KeyG: 'grenade',
};

const STORAGE_KEY = 'ember-yard-bindings-v1';
const SETTINGS_KEY = 'ember-yard-settings-v1';

// A human label for a KeyboardEvent.code, for the settings panel.
export function prettyKey(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  const names = {
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt', Space: 'Space', Tab: 'Tab',
    CapsLock: 'Caps Lock', Escape: 'Esc',
  };
  return names[code] ?? code;
}

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function createInput(canvas) {
  const input = {
    f: false, b: false, l: false, r: false,
    sprint: false, crouch: false, jump: false,
    ads: false,
    fireHeld: false,
    fireEdge: false,
    reload: false,
    plant: false,
    grenade: false,
    switchTo: -1,
    lookDX: 0,
    lookDY: 0,
    locked: false,
    lockError: null, // set when requestPointerLock is refused (e.g. too soon after exit)
  };

  // --- settings: sensitivity, crouch toggle, persisted bindings -----------
  const settings = loadJson(SETTINGS_KEY, { sensitivity: 1, crouchToggle: false });
  let bindings = loadJson(STORAGE_KEY, DEFAULT_BINDINGS);
  // Drop bindings that point at unknown actions (a stale save from an older
  // build must not wedge the input map).
  for (const code of Object.keys(bindings)) {
    if (!ACTIONS.some((a) => a.id === bindings[code])) delete bindings[code];
  }

  const saveBindings = () => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* private mode */ }
  };
  const saveSettings = () => {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  };

  // Jump buffering: a Space press up to 150 ms before landing still jumps,
  // so the game never eats a jump pressed a frame too early.
  let jumpTimer = null;
  const queueJump = () => {
    input.jump = true;
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(() => { input.jump = false; }, 150);
  };

  // Crouch as a toggle (when enabled): one press crouches, the next stands.
  let crouchToggled = false;

  const pressAction = (action, repeat) => {
    if (repeat) return;
    if (action === 'jump') queueJump();
    else if (action === 'reload') input.reload = true;
    else if (action === 'grenade') input.grenade = true;
  };

  const onKeyDown = (e) => {
    if (e.code === 'Space') e.preventDefault();
    const action = bindings[e.code];
    if (!action) {
      // Digit keys are weapon slots, not rebindable actions.
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 4) input.switchTo = n - 1;
      }
      return;
    }
    const def = ACTIONS.find((a) => a.id === action);
    if (def.kind === 'press') {
      pressAction(action, e.repeat);
    } else if (action === 'crouch' && settings.crouchToggle) {
      if (!e.repeat) {
        crouchToggled = !crouchToggled;
        input.crouch = crouchToggled;
      }
    } else {
      input[action] = true;
    }
  };
  const onKeyUp = (e) => {
    const action = bindings[e.code];
    if (!action) return;
    const def = ACTIONS.find((a) => a.id === action);
    if (def.kind === 'hold' && !(action === 'crouch' && settings.crouchToggle)) {
      input[action] = false;
    }
  };
  const onMouseMove = (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  };
  const onMouseDown = (e) => {
    if (!input.locked) return;
    if (e.button === 0) {
      input.fireHeld = true;
      input.fireEdge = true;
    }
    if (e.button === 2) input.ads = true;
  };
  const onMouseUp = (e) => {
    if (e.button === 0) input.fireHeld = false;
    if (e.button === 2) input.ads = false;
  };
  // The wheel cycles weapons: down = next, up = previous. main.js resolves
  // the slot against the owned weapons, so scrolling past the end wraps.
  const onWheel = (e) => {
    if (!input.locked) return;
    input.switchTo = e.deltaY > 0 ? -2 : -3; // -2: next, -3: previous
  };
  const onContextMenu = (e) => e.preventDefault();
  const onLockChange = () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.locked) input.lockError = null;
  };
  const onLockError = () => {
    // Chrome refuses a lock requested too soon after exiting one; that is a
    // normal flow (buy menu, pause), not a bug — record it so the HUD can
    // say "click again" instead of the console showing a rejection.
    input.lockError = 'pointer lock refused — click the yard again';
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  return {
    input,
    lock() {
      // requestPointerLock returns a promise in Chrome; an uncaught
      // rejection used to land in the console on every fast re-lock.
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => { input.lockError = 'pointer lock refused — click the yard again'; });
      } catch {
        input.lockError = 'pointer lock unavailable';
      }
    },
    unlock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    consumeLook() {
      const dx = input.lookDX;
      const dy = input.lookDY;
      input.lookDX = 0;
      input.lookDY = 0;
      return { dx, dy };
    },
    clearOneShots() {
      input.reload = false;
      input.grenade = false;
      input.fireEdge = false;
      input.switchTo = -1;
    },
    // --- settings API (used by the settings panel in index.html) ----------
    sensitivity() { return settings.sensitivity; },
    setSensitivity(v) {
      settings.sensitivity = clamp(Number(v) || 1, 0.2, 3);
      saveSettings();
    },
    crouchToggle() { return settings.crouchToggle; },
    setCrouchToggle(v) {
      settings.crouchToggle = !!v;
      if (!v) { crouchToggled = false; input.crouch = false; }
      saveSettings();
    },
    // Returns [{ action, label, keys: [codes] }] for the settings panel.
    listBindings() {
      return ACTIONS.map((a) => ({
        ...a,
        keys: Object.keys(bindings).filter((code) => bindings[code] === a.id),
      }));
    },
    // Rebind `action` to `code`, unbinding whatever `code` held first so one
    // key never drives two actions. Returns false when the code is reserved
    // (weapon slots and Escape stay fixed).
    rebind(action, code) {
      if (code.startsWith('Digit') || code === 'Escape' || code === 'KeyB' || code === 'KeyP') return false;
      for (const c of Object.keys(bindings)) if (bindings[c] === action) delete bindings[c];
      delete bindings[code];
      bindings[code] = action;
      saveBindings();
      return true;
    },
    resetBindings() {
      bindings = { ...DEFAULT_BINDINGS };
      saveBindings();
      crouchToggled = false;
      input.crouch = false;
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      clearTimeout(jumpTimer);
    },
  };
}
