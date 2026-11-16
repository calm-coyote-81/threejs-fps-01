// Procedural sound: every effect is synthesised with WebAudio, so the game
// ships no audio assets and makes no network request. Created lazily on the
// first user gesture, as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;

  const ensure = () => {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  };

  const noiseBuffer = (dur) => {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  const burst = (dur, filterFreq, gain, type = 'lowpass') => {
    if (!ensure()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(master);
    src.start();
    src.stop(ctx.currentTime + dur);
  };

  const tone = (freq, dur, gain, slideTo = null, type = 'sine') => {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  };

  return {
    unlock() { ensure(); },
    shot(kind) {
      // Rifle crack: short noise burst plus a low thump.
      burst(kind === 'dmr' ? 0.22 : 0.12, kind === 'dmr' ? 900 : 1600, kind === 'dmr' ? 0.9 : 0.6);
      tone(140, 0.09, 0.35, 55, 'triangle');
    },
    distantShot() { burst(0.15, 700, 0.18); },
    hit() { tone(1900, 0.06, 0.25, 1400, 'square'); },
    kill() { tone(660, 0.09, 0.3); setTimeout(() => tone(990, 0.12, 0.3), 70); },
    hurt() { tone(220, 0.15, 0.3, 110, 'sawtooth'); },
    reload() {
      tone(500, 0.05, 0.2, 300, 'square');
      setTimeout(() => tone(700, 0.05, 0.2, 420, 'square'), 350);
    },
    dryFire() { tone(1100, 0.03, 0.15, 900, 'square'); },
    plantBeep() { tone(1200, 0.08, 0.25, 1200, 'square'); },
    defuseBeep() { tone(900, 0.08, 0.25, 900, 'square'); },
    explosion() {
      burst(0.9, 320, 1.0);
      tone(90, 0.7, 0.6, 35, 'sine');
    },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.28), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.28), i * 120)); },
    buy() { tone(880, 0.06, 0.2, 1100, 'square'); },
    step() { burst(0.04, 500, 0.06); },
  };
}
