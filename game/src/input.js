// Input: keyboard, mouse look and pointer lock, reduced to one plain object
// the simulation reads each fixed step. One-shot actions (reload, grenade,
// weapon switch) are flags main.js clears after the step consumes them.
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
  };

  const keyMap = {
    KeyW: 'f', ArrowUp: 'f',
    KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l',
    KeyD: 'r', ArrowRight: 'r',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    ControlLeft: 'crouch', KeyC: 'crouch',
    Space: 'jump',
    KeyE: 'plant',
  };

  const onKeyDown = (e) => {
    if (e.code === 'Space') e.preventDefault();
    const mapped = keyMap[e.code];
    if (mapped) input[mapped] = true;
    if (e.code === 'KeyR' && !e.repeat) input.reload = true;
    if (e.code === 'KeyG' && !e.repeat) input.grenade = true;
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 4) input.switchTo = n - 1;
    }
  };
  const onKeyUp = (e) => {
    const mapped = keyMap[e.code];
    if (mapped) input[mapped] = false;
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
  const onContextMenu = (e) => e.preventDefault();
  const onLockChange = () => {
    input.locked = document.pointerLockElement === canvas;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    input,
    lock() {
      canvas.requestPointerLock();
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
  };
}
