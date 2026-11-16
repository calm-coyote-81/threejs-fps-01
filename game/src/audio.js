// Procedural sound: every effect is synthesised with WebAudio, so the game
// ships no audio assets and makes no network request. Created lazily on the
// first user gesture, as browsers require.
//
// Round 2: the set grew past gunshots — footsteps alternate pitch so they
// stop sounding like a metronome, the spike has its own pickup/drop sounds,
// the grenade has a pin pull, headshots ding, the round starts with a horn,
// and a wind loop fills the quiet moments. Everything routes through one
// master gain with a mute switch, so the settings panel has one knob.
import { AUDIO } from './config.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfx = null;
  let ambient = null;
  let muted = false;
  let stepAlt = false;
  let lastHeartbeat = 0;

  const ensure = () => {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : AUDIO.masterVolume;
      master.connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.gain.value = AUDIO.sfxVolume;
      sfx.connect(master);
      startAmbient();
      return true;
    } catch {
      return false;
    }
  };

  // Wind: a looped noise buffer through a slow lowpass, barely audible.
  // It starts with the context and runs for the whole session; without it
  // the yard is dead silent between gunfights.
  const startAmbient = () => {
    const dur = 4;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish noise, no harsh highs
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    ambient = ctx.createGain();
    ambient.gain.value = AUDIO.ambientVolume;
    src.connect(filter).connect(ambient).connect(master);
    src.start();
    // Slow swell so the wind never sits at one flat level.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = AUDIO.ambientVolume * 0.5;
    lfo.connect(lfoGain).connect(ambient.gain);
    lfo.start();
  };

  const noiseBuffer = (dur) => {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  // `at` is a volume scale for distance: a bot's shot 30 m away is quieter
  // than your own. 1 = point blank, 0 = silent.
  const burst = (dur, filterFreq, gain, type = 'lowpass', at = 1) => {
    if (!ensure()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * at, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(sfx);
    src.start();
    src.stop(ctx.currentTime + dur);
  };

  const tone = (freq, dur, gain, slideTo = null, type = 'sine', at = 1, delay = 0) => {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * at, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(sfx);
    osc.start(t0);
    osc.stop(t0 + dur);
  };

  return {
    unlock() { ensure(); },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : AUDIO.masterVolume;
    },
    isMuted() { return muted; },
    setVolume(v) {
      if (master) master.gain.value = (muted ? 0 : Math.max(0, Math.min(1, v)));
    },

    shot(kind, at = 1) {
      // Rifle crack: short noise burst plus a low thump. The DMR is longer
      // and deeper; the SMG is a sharper, shorter crack.
      const params = {
        dmr: [0.22, 900, 0.9],
        smg: [0.09, 2000, 0.45],
        sidearm: [0.1, 1800, 0.5],
        carbine: [0.12, 1600, 0.6],
      }[kind] ?? [0.12, 1600, 0.6];
      burst(params[0], params[1], params[2], 'lowpass', at);
      tone(140, 0.09, 0.35, 55, 'triangle', at);
    },
    distantShot(distance = 30) {
      // Volume falls off with distance; past 40 m you hear the crack only.
      const at = Math.max(0.05, 1 - distance / 48) * AUDIO.distantShotVolume * 5;
      burst(0.15, 700, 0.18, 'lowpass', at);
    },
    hit(head = false) {
      tone(1900, 0.06, 0.25, 1400, 'square');
      if (head) tone(2600, 0.09, 0.3, 2600, 'sine', 1, 0.02); // headshot ding
    },
    kill() { tone(660, 0.09, 0.3); tone(990, 0.12, 0.3, null, 'sine', 1, 0.07); },
    hurt() { tone(220, 0.15, 0.3, 110, 'sawtooth'); },
    reload() {
      tone(500, 0.05, 0.2, 300, 'square');
      tone(700, 0.05, 0.2, 420, 'square', 1, 0.35);
      tone(900, 0.04, 0.18, 600, 'square', 1, 0.7); // mag seated — the old two-click reload ended too early
    },
    dryFire() { tone(1100, 0.03, 0.15, 900, 'square'); },
    plantBeep() { tone(1200, 0.08, 0.25, 1200, 'square'); },
    defuseBeep() { tone(900, 0.08, 0.25, 900, 'square'); },
    plantTick(final = false) {
      // The spike's countdown beep accelerates as detonation nears.
      tone(final ? 1500 : 1200, 0.06, 0.22, null, 'square');
    },
    spikePickup() {
      tone(520, 0.07, 0.28, 780, 'square');
      tone(780, 0.1, 0.28, 1040, 'square', 1, 0.07);
    },
    spikeDrop() {
      // A dull metallic clatter: the spike hitting concrete.
      burst(0.12, 900, 0.4, 'bandpass');
      tone(180, 0.14, 0.3, 90, 'triangle');
    },
    grenadePin() {
      tone(1400, 0.03, 0.2, 1100, 'square');
      burst(0.05, 3000, 0.15, 'highpass');
    },
    grenadeThrow() { burst(0.08, 1200, 0.2); },
    explosion() {
      burst(0.9, 320, 1.0);
      tone(90, 0.7, 0.6, 35, 'sine');
    },
    roundStart() {
      // A short horn so the buy phase ending is audible, not just visible.
      tone(196, 0.35, 0.3, 196, 'sawtooth');
      tone(294, 0.35, 0.25, 294, 'sawtooth', 1, 0.05);
    },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 0.28, null, 'sine', 1, i * 0.11)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, 0.28, null, 'sine', 1, i * 0.12)); },
    buy() { tone(880, 0.06, 0.2, 1100, 'square'); },
    buyFail() { tone(220, 0.12, 0.25, 160, 'square'); },
    click() { tone(1000, 0.03, 0.15, 800, 'square'); },
    step(sprinting = false) {
      // Alternate feet so the rhythm stops sounding like a metronome, and
      // sprinting steps land harder.
      stepAlt = !stepAlt;
      burst(0.04, stepAlt ? 480 : 560, AUDIO.footstepVolume * (sprinting ? 1.5 : 1));
    },
    heartbeat(now) {
      // Throttled by the caller passing state.time; only fires under the
      // low-health threshold so it never nags a healthy player.
      if (now - lastHeartbeat < AUDIO.heartbeatInterval) return;
      lastHeartbeat = now;
      tone(70, 0.12, 0.4, 45, 'sine');
      tone(65, 0.1, 0.3, 40, 'sine', 1, 0.16);
    },
  };
}
