// HUD: every DOM element the player sees. It reads the simulation state and
// writes the DOM; it never writes back into the simulation except through
// the callbacks main.js hands it (play, buy, restart).
import { WEAPONS, GRENADE, ROUND } from './config.js';

function el(id) {
  return document.getElementById(id);
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function createHud(state, callbacks) {
  const cache = { lastPhase: null, buyClosed: false };
  const setText = (id, value) => {
    if (cache[id] !== value) {
      cache[id] = value;
      const n = el(id);
      if (n) n.textContent = value;
    }
  };
  const setStyle = (id, prop, value) => {
    const key = `${id}:${prop}`;
    if (cache[key] !== value) {
      cache[key] = value;
      const n = el(id);
      if (n) n.style[prop] = value;
    }
  };

  // --- buy menu ------------------------------------------------------------
  const buyList = el('buy-list');
  const buyItems = [];
  for (const weapon of Object.values(WEAPONS)) {
    if (weapon.id === 'sidearm') continue;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'buy-card';
    card.innerHTML = `<b>${weapon.name}</b><span>$${weapon.price} · ${weapon.mag} rnd mag</span>`;
    card.addEventListener('click', () => callbacks.onBuyWeapon(weapon.id));
    buyList.appendChild(card);
    buyItems.push({ weapon, card });
  }
  const grenadeCard = document.createElement('button');
  grenadeCard.type = 'button';
  grenadeCard.className = 'buy-card';
  grenadeCard.innerHTML = `<b>Spark Grenade</b><span>$${GRENADE.price} · throw with G</span>`;
  grenadeCard.addEventListener('click', () => callbacks.onBuyGrenade());
  buyList.appendChild(grenadeCard);
  const ammoCard = document.createElement('button');
  ammoCard.type = 'button';
  ammoCard.className = 'buy-card';
  ammoCard.innerHTML = `<b>Reserve Ammo</b><span>$100 per weapon · refills reserves</span>`;
  ammoCard.addEventListener('click', () => callbacks.onBuyAmmo());
  buyList.appendChild(ammoCard);

  el('play').addEventListener('click', () => callbacks.onPlay());
  el('resume').addEventListener('click', () => callbacks.onResume());
  el('restart').addEventListener('click', () => callbacks.onRestart());
  el('close-buy').addEventListener('click', () => callbacks.onCloseBuy());

  // --- minimap ---------------------------------------------------------------
  const map = el('minimap');
  const mctx = map.getContext('2d');

  function drawMinimap() {
    const W = map.width;
    const H = map.height;
    const sx = (x) => ((x + 28) / 56) * W;
    const sz = (z) => ((z + 20) / 40) * H;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = 'rgba(20,22,26,0.72)';
    mctx.fillRect(0, 0, W, H);
    mctx.strokeStyle = '#6b6f75';
    mctx.lineWidth = 2;
    mctx.strokeRect(1, 1, W - 2, H - 2);
    for (const b of state.world.colliders) {
      if (Math.abs(b.maxX - b.minX) > 50 || Math.abs(b.maxZ - b.minZ) > 38) continue; // walls
      mctx.fillStyle = b.top > 2 ? '#8a6f4d' : '#5c5648';
      mctx.fillRect(sx(b.minX), sz(b.minZ), sx(b.maxX) - sx(b.minX), sz(b.maxZ) - sz(b.minZ));
    }
    for (const site of Object.values(state.world.sites)) {
      mctx.fillStyle = site.id === 'A' ? '#2e6f6a' : '#9a5a2e';
      mctx.beginPath();
      mctx.arc(sx(site.x), sz(site.z), 7, 0, Math.PI * 2);
      mctx.fill();
      mctx.fillStyle = '#e9e6df';
      mctx.font = 'bold 9px sans-serif';
      mctx.textAlign = 'center';
      mctx.fillText(site.id, sx(site.x), sz(site.z) + 3);
    }
    if (state.spike.planted) {
      mctx.strokeStyle = '#f0a830';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(sx(state.spike.x), sz(state.spike.z), 10 + Math.sin(state.time * 6) * 2, 0, Math.PI * 2);
      mctx.stroke();
    }
    const dot = (x, z, color, r = 3) => {
      mctx.fillStyle = color;
      mctx.beginPath();
      mctx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      mctx.fill();
    };
    for (const bot of state.bots) {
      if (!bot.alive) continue;
      if (bot.team === 'ally') dot(bot.pos.x, bot.pos.z, '#57b981');
      else if (state.world.hasLineOfSight(state.player.pos.x, state.player.pos.z, state.player.pos.y + 1.5, bot.pos.x, bot.pos.z, bot.pos.y + 1.5)) {
        dot(bot.pos.x, bot.pos.z, '#e0533d');
      }
    }
    // Player arrow.
    const px = sx(state.player.pos.x);
    const pz = sz(state.player.pos.z);
    mctx.save();
    mctx.translate(px, pz);
    mctx.rotate(Math.atan2(-Math.sin(state.player.yaw), -Math.cos(state.player.yaw)) + Math.PI / 2);
    mctx.fillStyle = '#e9e6df';
    mctx.beginPath();
    mctx.moveTo(0, -6);
    mctx.lineTo(4, 5);
    mctx.lineTo(-4, 5);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  // --- per-frame update ------------------------------------------------------
  function update() {
    const p = state.player;
    const phase = state.roundPhase;
    // A new buy phase always re-opens the menu: closing it once with B must
    // not hide it for every later round of the match.
    if (phase === 'buy' && cache.lastPhase !== 'buy') cache.buyClosed = false;
    cache.lastPhase = phase;

    setText('health-value', String(Math.ceil(p.health)));
    setStyle('health-bar', 'width', `${Math.max(0, p.health)}%`);
    setText('armor-value', String(Math.ceil(p.armor)));
    setStyle('armor-bar', 'width', `${Math.max(0, p.armor * 2)}%`);
    setText('money-value', `$${p.money}`);
    setText('score-value', `${state.score.us} — ${state.score.them}`);
    setText('round-value', `Round ${Math.min(state.round, ROUND.maxRounds)}/${ROUND.maxRounds}`);
    if (phase === 'buy') {
      setText('timer-value', `BUY ${fmtTime(state.buyTimer)}`);
      el('timer-value').classList.add('buy');
      el('timer-value').classList.remove('low');
    } else if (phase === 'live' && state.spike.planted) {
      // Once the spike is live the detonation clock is the one that matters.
      setText('timer-value', `SPIKE ${fmtTime(state.spike.timer)}`);
      el('timer-value').classList.remove('buy');
      el('timer-value').classList.toggle('low', state.spike.timer < 10);
    } else if (phase === 'live') {
      setText('timer-value', fmtTime(state.roundTimer));
      el('timer-value').classList.toggle('low', state.roundTimer < 15);
      el('timer-value').classList.remove('buy');
    } else {
      setText('timer-value', state.roundReason || '');
      el('timer-value').classList.remove('buy', 'low');
    }
    // Ammo and weapon slots.
    const weapon = WEAPONS[p.weapons[p.weaponIndex]];
    const ammo = p.ammo[weapon.id];
    setText('ammo-mag', String(ammo.mag));
    setText('ammo-reserve', `/ ${ammo.reserve}`);
    el('ammo').classList.toggle('empty', ammo.mag === 0);
    setText('weapon-name', weapon.name);
    setText('grenade-count', `G × ${p.grenades}`);
    setText('weapon-slots', p.weapons.map((id, i) => `${i + 1} ${WEAPONS[id].name.split(' ').pop()}`).join(' · '));
    // Crosshair spread follows the simulation's spread.
    const gap = 3 + p.spread * 260 + p.recoil * 30;
    setStyle('crosshair', '--gap', `${gap.toFixed(1)}px`);
    // Hitmarker.
    const hm = el('hitmarker');
    const showHm = state.hitmarker && state.time - state.hitmarker.t < 0.25;
    hm.classList.toggle('on', !!showHm);
    hm.classList.toggle('kill', !!(showHm && state.hitmarker.kill));
    // Damage vignette and direction.
    const dmg = el('damage');
    const recent = state.time - state.damageFlash < 0.6;
    dmg.classList.toggle('on', recent);
    if (recent) {
      const rel = state.damageFrom - p.yaw;
      setStyle('damage-dir', 'transform', `rotate(${(-rel * 180) / Math.PI}deg)`);
    }
    // Plant / spike banners, including a defuse warning: an enemy on the
    // spike is the most urgent thing the HUD can say.
    const plant = el('plant-bar');
    const defuser = state.spike.planted ? state.spike.defuser : null;
    if (defuser) {
      plant.hidden = false;
      setStyle('plant-fill', 'width', `${(defuser.defusing / ROUND.defuseTime) * 100}%`);
      setText('plant-label', `${defuser.name} is defusing the spike — stop them!`);
    } else if (p.planting > 0 && !state.spike.planted) {
      plant.hidden = false;
      setStyle('plant-fill', 'width', `${(p.planting / ROUND.plantTime) * 100}%`);
      setText('plant-label', 'Planting spike… hold E');
    } else if (state.spike.planted) {
      plant.hidden = false;
      setStyle('plant-fill', 'width', `${(state.spike.timer / ROUND.detonateTime) * 100}%`);
      setText('plant-label', `Spike live — detonation in ${Math.ceil(state.spike.timer)}s`);
    } else {
      plant.hidden = true;
    }
    // Kill feed.
    const feed = el('feed');
    const recentFeed = state.feed.slice(-4);
    const html = recentFeed.map((f) => `<div class="feed-${f.kind}">${f.text}</div>`).join('');
    if (cache.feedHtml !== html) {
      cache.feedHtml = html;
      feed.innerHTML = html;
    }
    // Round banner (hidden once the match-end screen takes over).
    const banner = el('banner');
    if (phase === 'over' && !state.matchOver) {
      banner.hidden = false;
      const won = state.feed.length > 0 && state.feed[state.feed.length - 1].kind === 'win';
      setText('banner-title', won ? 'ROUND WON' : 'ROUND LOST');
      setText('banner-sub', state.roundReason);
      banner.classList.toggle('won', won);
    } else {
      banner.hidden = true;
    }
    // Buy menu visibility and affordability.
    const buy = el('buy-menu');
    const showBuy = phase === 'buy' && !state.matchOver && !state.suppressBuy;
    buy.hidden = !showBuy || cache.buyClosed === true;
    if (showBuy) {
      for (const { weapon: w, card } of buyItems) {
        const owned = p.weapons.includes(w.id);
        card.classList.toggle('owned', owned);
        card.classList.toggle('cant', !owned && p.money < w.price);
        card.disabled = owned;
      }
      grenadeCard.classList.toggle('cant', p.money < GRENADE.price || p.grenades >= 2);
      setText('buy-money', `$${p.money}`);
      setText('buy-timer', `Buy phase ends in ${Math.ceil(state.buyTimer)}s — press B to hide`);
    }
    // Match end overlay.
    const end = el('end-screen');
    if (state.matchOver) {
      end.hidden = false;
      const won = state.matchWinner === 'us';
      setText('end-title', won ? 'VICTORY' : state.matchWinner === 'draw' ? 'DRAW' : 'DEFEAT');
      const acc = state.stats.shots > 0 ? Math.round((state.stats.hits / state.stats.shots) * 100) : 0;
      setText('end-stats', `Final score ${state.score.us} — ${state.score.them} · ${p.kills} eliminations · ${acc}% accuracy · ${state.stats.plants} plants`);
      end.classList.toggle('won', won);
    } else {
      end.hidden = true;
    }
    drawMinimap();
  }

  return {
    update,
    showStart() {
      el('start-screen').hidden = false;
      el('pause-screen').hidden = true;
    },
    hideStart() {
      el('start-screen').hidden = true;
    },
    showPause(show) {
      el('pause-screen').hidden = !show;
    },
    closeBuy() {
      cache.buyClosed = true;
      el('buy-menu').hidden = true;
    },
    reopenBuy() {
      cache.buyClosed = false;
    },
  };
}
