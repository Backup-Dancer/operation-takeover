/** Round stingers, score popups, match-start card, and room callouts.
 *  Layout follows a Siege-Mobile-like flow; wording and art stay original. */

export const SCORE = {
  barricade: { pts: 10, label: 'BARRICADE SET' },
  reinforce: { pts: 10, label: 'SHUTTER SET' },
  marked: { pts: 25, label: 'POSITION MARKED' },
  scoutDown: { pts: 20, label: 'SCOUT DOWN' },
  elim: { pts: 110, label: 'HOSTILE DOWNED' },
  headshot: { pts: 250, label: 'HEADSHOT' },
  roundWin: { pts: 200, label: 'ROUND WIN' },
};

export function roomCallout(world, pos) {
  if (!world || !pos) return '';
  if (world.isOutside?.(pos.x, pos.z, pos.y || 0)) return 'EXTERIOR';
  const floors = world.floors || [];
  const y = pos.y || 0;
  let fl = null;
  for (const f of floors) {
    if (y >= f.y - 0.45 && y < f.y + f.h + 0.05) {
      if (!fl || f.y >= fl.y) fl = f;
    }
  }
  if (!fl) fl = floors[1];
  const room = world._roomAt?.(pos.x, pos.z, fl?.id);
  if (!room) return fl ? ((fl.id === 'B' ? 'B' : fl.id + 'F') + ' ' + (fl.name || '').toUpperCase()) : '';
  const tag = room.floor === 'B' ? 'B' : room.floor + 'F';
  return tag + ' ' + String(room.name || '').toUpperCase();
}

export function camLabel(cam, world) {
  if (!cam) return 'CAM';
  if (world) {
    const call = roomCallout(world, { x: cam.x, y: cam.y, z: cam.z });
    if (call) return call;
  }
  const tag = cam.floor === 'B' ? 'B' : (cam.floor ? cam.floor + 'F' : '');
  return (tag ? tag + ' · ' : '') + (cam.name || 'CAM');
}

export function scorePopup(game, kind) {
  const rec = typeof kind === 'string' ? SCORE[kind] : kind;
  if (!rec) return;
  const box = document.getElementById('hud-scorepops');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.innerHTML = `<b>+${rec.pts}</b> <span>${rec.label}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 1100);
  game._scorePts = (game._scorePts || 0) + rec.pts;
}

export function showScanning(on, text) {
  const el = document.getElementById('hud-scanning');
  if (!el) return;
  if (on) {
    el.textContent = text || 'SCANNING…';
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function showWon(game, why, opts = {}) {
  const el = document.getElementById('hud-won');
  if (!el) return;
  const n = (game.round?.n || 0) + 1;
  const clutch = !!opts.clutch;
  el.innerHTML = `
    <div class="won-slam">${clutch ? 'CLUTCH WIN' : 'WON'}</div>
    <div class="won-why">${why || ''}</div>
    <div class="won-pts">+${SCORE.roundWin.pts} ${SCORE.roundWin.label}</div>
    <div class="won-round">ROUND ${n} WON</div>`;
  el.classList.remove('hidden', 'out');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.classList.add('hidden'), 500); }, 2600);
  scorePopup(game, 'roundWin');
}

export function showEliminated(game, killer) {
  const el = document.getElementById('hud-elim');
  if (!el) return;
  const name = (killer?.op?.name || killer?.opId || 'UNKNOWN').toString().toUpperCase();
  const gun = (killer?.weapon?.name || '').toString().toUpperCase();
  const hp = Math.max(0, Math.round(killer?.hp ?? 0));
  el.innerHTML = `
    <div class="elim-x">✕</div>
    <div class="elim-by">ELIMINATED BY</div>
    <div class="elim-name">${name}</div>
    <div class="elim-gun">${gun}</div>
    ${killer ? `<div class="elim-hp">${hp} HP</div>` : ''}`;
  el.classList.remove('hidden', 'out');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.classList.add('hidden'), 400); }, 2800);
}

export function showMatchCard(game) {
  const el = document.getElementById('hud-matchcard');
  if (!el) return;
  const map = game.world?.layoutId === 'halcyon' ? 'HALCYON PRESS' : (game.cfg?.map || 'HALCYON PRESS').toUpperCase();
  const bo = game.cfg?.bestOf || 3;
  const atk = [game.player, ...(game.bots || [])].filter(o => o && o.team === 'attack');
  const def = [game.player, ...(game.bots || [])].filter(o => o && o.team === 'defend');
  const row = (list) => list.map(o => {
    const you = o === game.player ? ' you' : '';
    const id = (o.opId || o.op?.id || 'op').toLowerCase();
    const name = (o.op?.name || o.opId || 'OP').toString().toUpperCase();
    return `<li class="${o.team}${you}"><i data-op="${id}"></i><span>${name}</span></li>`;
  }).join('');
  el.innerHTML = `
    <div class="mc-map">${map}</div>
    <div class="mc-mode">SECURE THE DEFUSER · BEST OF ${bo}</div>
    <div class="mc-score"><b>${game.round?.scoreAtk ?? 0}</b><span>–</span><b>${game.round?.scoreDef ?? 0}</b></div>
    <div class="mc-lineups">
      <ul class="atk">${row(atk)}</ul>
      <ul class="def">${row(def)}</ul>
    </div>`;
  el.classList.remove('hidden', 'out');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.classList.add('hidden'), 450); }, 2800);
}

export function hideMatchOverlays() {
  for (const id of ['hud-won', 'hud-elim', 'hud-matchcard', 'hud-scanning']) {
    document.getElementById(id)?.classList.add('hidden');
  }
}

export function updateCompass(yaw) {
  const el = document.getElementById('hud-compass');
  if (!el) return;
  // yaw 0 looks +Z (south of Halcyon Press street). N is -Z, yaw = π.
  const deg = ((Math.PI - (yaw || 0)) * 180 / Math.PI + 360) % 360;
  el.style.setProperty('--hdg', String(deg));
  const letter = el.querySelector('.hdg-letter');
  if (letter) {
    const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    letter.textContent = pts[Math.round(deg / 45) % 8];
  }
}

export function updateSquad(game) {
  const el = document.getElementById('hud-squad');
  if (!el) return;
  const pip = (o, i) => {
    const dead = o && o.alive === false;
    const you = o === game.player ? ' you' : '';
    return `<i class="pip ${o?.team || ''}${you}${dead ? ' dead' : ''}" title="${o?.opId || ''}"></i>`;
  };
  const atk = [game.player, ...(game.bots || [])].filter(o => o && o.team === 'attack').slice(0, 5);
  const def = [game.player, ...(game.bots || [])].filter(o => o && o.team === 'defend').slice(0, 5);
  el.innerHTML = `<span class="atk">${atk.map(pip).join('')}</span><span class="def">${def.map(pip).join('')}</span>`;
}

export function setReinforceRing(frac) {
  const el = document.getElementById('hud-ring');
  if (!el) return;
  if (frac == null || frac <= 0) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const pct = Math.max(0, Math.min(1, frac));
  el.style.setProperty('--p', String(pct));
  const n = el.querySelector('b');
  if (n) n.textContent = Math.ceil((1 - pct) * 4) || 1;
}
