import * as THREE from 'three';
import { BUILD, TITLE, PREP_TIME, ACTION_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIME, INTERMISSION, EYE } from './config.js?v=iv-3.6.2';
import { loadSettings, saveSettings } from './settings.js?v=iv-3.6.2';
import { Gfx } from './gfx.js?v=iv-3.6.2';
import { unlock as unlockAudio, sfx } from './audio.js?v=iv-3.6.2';
import { Input } from './input.js?v=iv-3.6.2';
import { UI } from './ui.js?v=iv-3.6.2';
import { World } from './world.js?v=iv-3.6.2';
import { Nav } from './nav.js?v=iv-3.6.2';
import { getOp } from './operators.js?v=iv-3.6.2';
import { makeLoadout, instWeapon, UTIL, WEAPONS } from './weapons.js?v=iv-3.6.2';
import { createPlayer, updatePlayer, updateCamera, startRappel as doStartRappel, detachRappel as doDetach, setStance as doSetStance, buildVm, opticScreenPos as doOptic, colH, updateRappel as doUpdateRappel, clearAdsToggle } from './player.js?v=iv-3.6.2';
import { Gadgets } from './gadgets.js?v=iv-3.6.2';
import * as combat from './combat.js?v=iv-3.6.2';
import { spawnBots, updateBots, readyBots } from './bots.js?v=iv-3.6.2';
import { DroneSys } from './drone.js?v=iv-3.6.2';
import { MAP, SITE_PAIRS, floorY } from './map.js?v=iv-3.6.2';
import { buildHuman, measure } from './characters.js?v=iv-3.6.2';
import { createFirstPersonViewmodel, initModelLoaders, updateOperatorLod, preloadKnown, preloadWeapon, prefetchOtherWeapons, resetWeaponInstances } from './models.js?v=iv-3.6.2';
import { MenuScene } from './menu/MenuScene.js?v=iv-3.6.2';

export class Game {
  get charges(){ return this.gadgets.charges; }

  constructor() {
    this.settings = loadSettings();
    // Bind menu listeners before WebGL / input so a later throw cannot
    // leave TAP TO START or PLAY sitting dead on iOS.
    this.ui = new UI(this);
    try {
      this.gfx = new Gfx(document.getElementById('game'));
      this.camera = this.gfx.camera;
      this.input = new Input(this, this.settings);
      this.gadgets = new Gadgets(this);
      this.sys = this;
      this._combat = combat;
      this.running = false;
      this.ended = false;
      this.inMenu = true;
      this.time = 0;
      this.godMode = false;
      this.bots = [];
      this.round = null;
      this.player = createPlayer(this);
      this.applyCrosshair();
      this.gfx.setQuality(this.settings.quality);
      this.gfx.setupLights();
      this._bindPrompt();
    } catch (e) {
      console.error('Game init failed', e);
      if (window.__ivShowError) window.__ivShowError(e && (e.stack || e.message) || e);
    }
  }

  async boot() {
    if (this._booting) return;
    this._booting = true;
    try {
      if (this.ui) { this.ui.show('main'); this.inMenu = true; }
      unlockAudio().catch(() => {});
      this._checkVersion().catch(() => {});
      if (!this._assets && this.gfx) {
        this._showLoad(true, 'Loading assets');
        try {
          await this.gfx.loadAssets((m, p) => this._loadMsg(m, p * 0.4));
          this._assets = true;
          await initModelLoaders(this.gfx);
          await preloadKnown([]);
        } catch (e) {
          console.warn('asset load failed', e);
          if (window.__ivShowError) window.__ivShowError(e && (e.stack || e.message) || e);
        } finally {
          this._showLoad(false);
        }
      }
      await this._ensureMenu();
    } finally {
      this._booting = false;
    }
  }

  async _ensureMenu() {
    if (!this.gfx) return;
    if (!this.menu) {
      try { this.menu = new MenuScene(this); } catch (e) { console.warn('MenuScene', e); }
    }
    if (this.menu) { this.menu.resume(); this.menu.setMode('street'); }
    if (!this._looping) { this._looping = true; this._last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  }

  async _checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.build && j.build !== BUILD) {
        const u = new URL(location.href);
        if (u.searchParams.get('v') !== j.build) {
          u.searchParams.set('v', j.build);
          location.replace(u.toString());
          return;
        }
      }
    } catch {}
  }

  pickOp(id) {
    const side = this.settings.side;
    this.settings.operator[side] = id;
    saveSettings(this.settings);
  }

  async deploy() {
    const cfg = {
      mode: 'bomb',
      side: this.settings.side,
      difficulty: this.settings.difficulty,
      bestOf: this.settings.bestOf,
      map: 'halcyon',
      prepTime: PREP_TIME,
    };
    await this.start(cfg);
  }

  async start(cfg = {}) {
    this._showLoad(true, 'Building Halcyon Press');
    if (this.running) this.quit(false);
    if (!this._assets) {
      await this.gfx.loadAssets((m, p) => this._loadMsg(m, p * 0.35));
      this._assets = true;
    }
    await initModelLoaders(this.gfx);
    this.cfg = {
      mode: 'bomb', side: 'attack', difficulty: 'veteran', bestOf: 3,
      map: 'halcyon', prepTime: PREP_TIME, ...cfg,
    };
    this.ended = false;
    this.godMode = !!cfg.godMode || this.godMode;
    // world
    if (this.world) this.world.dispose();
    this.world = new World(this.gfx);
    await this.world.build((msg, p) => this._loadMsg(msg, 0.4 + p * 0.5));
    this.nav = new Nav(this.world);
    this.world.nav = this.nav;
    await this.nav.ready;
    this.gadgets.reset();
    this.droneSys = new DroneSys(this);
    this.inDrone = false; this.inCams = false;

    const pair = this.cfg.sitePair
      ? SITE_PAIRS.find(p => p.id === this.cfg.sitePair) || SITE_PAIRS[0]
      : SITE_PAIRS[Math.random() * SITE_PAIRS.length | 0];
    this.round = {
      pair, siteIds: pair.sites, scoreAtk: 0, scoreDef: 0, need: Math.ceil((this.cfg.bestOf || 3) / 2),
      n: 0, phase: 'prep', t: this.cfg.prepTime || PREP_TIME, planted: false, plantPos: null, plantProgress: 0, defuseProgress: 0,
      winner: null, swapped: false,
    };

    const side = this.cfg.side || 'attack';
    const op = getOp(this.cfg.atkOp || this.cfg.defOp || this.settings.operator[side], side);
    this.player = createPlayer(this);
    this.player.team = side;
    this.player.op = op; this.player.opId = op.id;
    this.player.speed = op.speed; this.player.armor = op.armor;
    this.player.kills = 0; this.player.deaths = 0;
    const lo = makeLoadout(op, this.settings.loadout[op.id] || this.cfg.loadout || {});
    this.loadout = lo;
    this.weapon = instWeapon(lo.primary, lo);
    this.weaponSlot = 'primary';
    this.secWeapon = instWeapon(lo.secondary, lo);
    this.util = { ...(UTIL[lo.util] || UTIL.breach), left: (UTIL[lo.util] || UTIL.breach).count };
    this.sig = { ...op.gadget, left: op.gadget.count };
    this._spawnPlayer(side);
    buildVm(this);
    await preloadWeapon(this.weapon?.id).catch(() => {});
    if (this.secWeapon?.id && this.secWeapon.id !== this.weapon?.id) {
      await preloadWeapon(this.secWeapon.id).catch(() => {});
    }
    await this._tryAuthoredWeapon();
    /* iv-2.1 floor snap */
    {
      const p = this.player;
      const gy = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 1.0);
      if (Number.isFinite(gy) && Math.abs(gy - p.pos.y) <= 0.5) p.pos.y = gy;
      this.camera.position.set(p.pos.x, p.pos.y + (p.eye || 1.5), p.pos.z);
    }
    this.applyCrosshair();

    this.bots.forEach(b => b.mesh && this.gfx.scene.remove(b.mesh));
    this.bots = spawnBots(this);
    await readyBots(this.bots);

    this.running = true; this.inMenu = false;
    if (this.menu) this.menu.pause();
    this.ui.hide();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touch').classList.remove('hidden');
    this.input.applyLayout();
    this._showLoad(false);
    this._last = performance.now();
    if (!this._looping) { this._looping = true; requestAnimationFrame(t => this.loop(t)); }
    this.updateAmmo();
    this._setPhase('prep', this.cfg.prepTime || PREP_TIME);
    this.toast(side === 'attack' ? 'Drone the building. Prepare an entry.' : 'Reinforce, barricade, and place your gadgets.');
    // Lazy-load the rest of the arsenal after the first frame so the
    // official 1K FP set stays off the critical path.
    const hold = [this.weapon?.id, this.secWeapon?.id];
    queueMicrotask(() => prefetchOtherWeapons(hold).catch(() => {}));
    return this;
  }

  _spawnPlayer(side) {
    const w = this.world;
    if (side === 'attack') {
      const s = w.spawns.attack[Math.random() * w.spawns.attack.length | 0];
      this.player.pos.set(s.x, 0, s.z); this.player.yaw = s.yaw || 0;
    } else {
      const site = w.sites[this.round.pair.sites[0]];
      const roomY = floorY(site.plant.floor || site.floor || '1');
      const tries = [];
      for (let r = 0.9; r <= 2.6; r += 0.4) {
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4;
          tries.push([Math.cos(ang) * r, Math.sin(ang) * r]);
        }
      }
      tries.push([0, 0]);
      let sx = site.plant.x, sz = site.plant.z, sy = roomY, found = false;
      for (const [dx, dz] of tries) {
        const x = site.plant.x + dx, z = site.plant.z + dz;
        const y = w.groundAt(x, z, roomY + 0.8);
        if (Math.abs(y - roomY) > 0.22) continue;
        if (w.pointInSolid(x, y + 0.2, z, 0.22, 1.3)) continue;
        sx = x; sz = z; sy = y; found = true; break;
      }
      this.player.pos.set(sx, sy, sz); this.player.yaw = 0;
      if (found && w.pointInSolid(sx, sy + 0.2, sz, 0.2, 1.2)) {
        this.player.pos.x += 0.4;
      }
    }
  }

  quit(showMenu = true) {
    this.running = false;
    this.gadgets.reset();
    if (this.world) this.world.dispose();
    this._botGen = (this._botGen || 0) + 1;
    for (const b of this.bots) {
      b._dead = true;
      if (b.mesh?.parent) b.mesh.parent.remove(b.mesh);
    }
    // Sweep any leaked operator meshes from a late load after a previous quit.
    if (this.gfx?.scene) {
      for (const o of [...this.gfx.scene.children]) {
        if (o.name && o.name.indexOf('op-') === 0) this.gfx.scene.remove(o);
      }
    }
    this.bots = [];
    this.inDrone = false; this.inCams = false;
    this.hideViewmodel = false;
    this.viewMode = 'fp';
    if (this.vm) this.vm.visible = false;
    resetWeaponInstances();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch').classList.add('hidden');
    document.getElementById('drone-ov')?.classList.add('hidden');
    document.getElementById('cctv-ov')?.classList.add('hidden');
    if (showMenu) {
      this.inMenu = true;
      this.ui.show('main');
      this.menu?.resume();
      this.menu?.setMode('street');
    }
  }

  quitToMenu() { this.quit(true); }
  resume() { this.inMenu = false; this.ui.hide(); document.getElementById('hud').classList.remove('hidden'); document.getElementById('touch').classList.remove('hidden'); }
  closeScore() { this.inMenu = false; this.ui.hide(); }

  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(0.05, (t - (this._last || t)) / 1000);
    this._last = t;
    if (!this.running || this.inMenu) {
      if (document.hidden) return;
      this.ui?.pollOpsPad?.(dt);
      if (this.menu) this.menu.tick(dt);
      else this.gfx.render();
      return;
    }
    this.time += dt;
    this.input.pollPad();
    this.tick(dt);
    this.gfx.tickAuto(dt);
    this.gfx.render();
  }

  tick(dt) {
    const inp = this.input, p = this.player;
    if (this.leanHoldApplies()) p.leanT = inp.leanHold || p.leanT;
    if (inp.leanHold) p.leanT = inp.leanHold;

    if (inp.consume('pause')) { this.inMenu = true; this.ui.show('pause'); return; }
    if (inp.consume('score')) { this.inMenu = true; this.ui.show('score'); return; }

    if (this.droneSys.active) {
      if (this.vm) this.vm.visible = false;
      if (inp.consume('drone') || inp.consume('interact')) this.exitDrone();
      else this.droneSys.update(dt);
      this._tickRound(dt);
      return;
    }
    if (this.droneSys.camsOn) {
      if (this.vm) this.vm.visible = false;
      if (inp.consume('cams') || inp.consume('interact')) this.exitCams();
      if (inp.consume('gadget')) this.droneSys.cycle(-1);
      if (inp.consume('gadget2')) this.droneSys.cycle(1);
      this.droneSys.update(dt);
      this._tickRound(dt);
      return;
    }

    if (inp.consume('drone')) { if (p.team === 'attack') this.enterDrone(); else this.enterCams(); }
    if (inp.consume('cams')) this.enterCams();

    updatePlayer(this, dt);
    combat.applyAimAssist(this, dt);
    updateCamera(this, dt);
    this.world.cull?.(this.camera);
    this._cullBots();
    if (this.gfx.quality === 'high') this.gfx.limitShadows?.(this.camera);

    if (inp.fire && p.alive) combat.fireWeapon(this);
    if (inp.consume('reload')) combat.beginReload(this);
    combat.finishReload(this);

    if (inp.consume('swap')) this.swapWeapon();
    if (inp.consume('gadget')) this.useGadget();
    if (inp.consume('gadget2')) this.useUtil();
    if (inp.consume('detonate')) this.gadgets.detonate('selected');
    if (inp.consume('ping')) this.ping();
    if (inp.consume('melee')) combat.melee(this);
    if (inp.consume('rappel')) this.tryRappelOrVault();
    if (inp.consume('interact')) this.activatePrompt();
    else if (inp.held.has('interact')) this.interact(dt, true);

    this._updateInteractPrompt();
    this.gadgets.update(dt);
    this.world.updateDoors(dt);
    this.world.updateFx?.(dt);
    if (!this._freezeBots) updateBots(this, dt);
    const camPos = this.camera.position;
    const q = this.gfx.quality;
    for (const b of this.bots) if (b.visual) updateOperatorLod(b.visual, camPos, q);
    this._tickRound(dt);
    this._updateHud();
    // fire-on-aim optional
    if (this.settings.fireOnAim !== 'off' && p.alive) {
      const ok = this.settings.fireOnAim === 'always' || (this.settings.fireOnAim === 'hip' && p.ads < 0.4);
      if (ok && combat.aimAssistTarget(this) && !inp.fire) { /* dwell skipped in v1 if not already firing */ }
    }
  }

  leanHoldApplies() { return this.input.leanIsHold(); }

  setStance(st, opts) { return doSetStance(this, st, opts); }
  startRappel(spot) { return doStartRappel(this, spot); }
  detachRappel(reason, opts) { return doDetach(this, reason, opts); }
  updateRappel(dt) { return doUpdateRappel(this, dt); }
  updatePlayer(dt) { return updatePlayer(this, dt); }
  updateCamera(dt) { return updateCamera(this, dt); }
  opticScreenPos() { return doOptic(this); }
  buildVm() { return buildVm(this); }
  isHostile(t) { return combat.isHostile(this, t); }

  tryRappelOrVault() {
    const p = this.player, w = this.world;
    if (p.rappelling) {
      const win = w.alignedWindow(p.rappelling, 0.75);
      if (win) return this._enterWindow(win);
      // drop off at ground
      if (p.rappelling.y < 0.6) this.detachRappel('drop');
      return;
    }
    const spot = w.findRappelSpot(p.pos, p.yaw, 2.4);
    if (spot) { sfx.rappel(); return this.startRappel(spot); }
    // vault low obstacle
    return this._vault();
  }

  _enterWindow(win) {
    if (win.state === 'barricaded' || win.state === 'reinforced') {
      this.toast('Breach the window first');
      return false;
    }
    if (win.state === 'intact' || win.state === 'cracked') this.world.damageWindow(win, 99);
    const rp = this.player.rappelling;
    const inward = { x: win.x - win.nx * 1.15, z: win.z - win.nz * 1.15 };
    this.player.pos.set(inward.x, win.y, inward.z);
    const gnd = this.world.groundAt(inward.x, inward.z, win.y + 1.2);
    this.player.pos.y = gnd;
    this.world.resolve(this.player.pos, 0.32, colH(this.player));
    this.detachRappel('enter', { keepPos: true });
    this.toast('Entered');
    return true;
  }

  _vault() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nx = p.pos.x + fx * 1.0, nz = p.pos.z + fz * 1.0;
    const g1 = this.world.groundAt(nx, nz, p.pos.y + 1);
    if (g1 > p.pos.y + 0.15 && g1 < p.pos.y + 0.9) {
      p.pos.x = nx; p.pos.z = nz; p.pos.y = g1;
      this.world.resolve(p.pos, 0.32, colH(p));
      return true;
    }
    return false;
  }

  interactTap() { return this.interact(0.2, false); }

  interact(dt, holding) {
    const p = this.player, w = this.world;
    // door
    const door = w.nearestDoor(p.pos, 1.5);
    if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) {
      if (!holding || dt) w.toggleDoor(door), sfx.door();
      return true;
    }
    // plant / defuse
    if (this.round.phase === 'action' || this.round.planted) {
      const site = this._nearPlant();
      if (this.player.team === 'attack' && site && !this.round.planted) {
        if (holding) this._plant(dt, site);
        return true;
      }
      if (this.player.team === 'defend' && this.round.planted && this._nearDefuser()) {
        if (holding) this._defuse(dt);
        return true;
      }
    }
    // reinforce in prep
    if (this.round.phase === 'prep' && p.team === 'defend') {
      const ch = w.chunks.find(c => !c.destroyed && !c.reinforced && Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 1.6);
      if (ch && holding) { w.reinforceChunk(ch); this.toast('Reinforced'); return true; }
      const win = w.windows.find(wi => Math.hypot(wi.x - p.pos.x, wi.z - p.pos.z) < 1.6);
      if (win && holding) { w.barricadeWindow(win); this.toast('Barricaded'); return true; }
    }
    return false;
  }

  _nearPlant() {
    for (const id of this.round.pair.sites) {
      const s = this.world.sites[id];
      const y = this.world.groundAt(s.plant.x, s.plant.z, this.player.pos.y + 2);
      if (Math.hypot(s.plant.x - this.player.pos.x, s.plant.z - this.player.pos.z) < 1.4 && Math.abs(this.player.pos.y - y) < 1.2) return s;
    }
    return null;
  }
  _nearDefuser() {
    const p = this.round.plantPos; if (!p) return false;
    return Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) < 1.4;
  }
  _plant(dt, site) {
    this.round.plantProgress += dt;
    this.toast(`Planting ${(this.round.plantProgress / PLANT_TIME * 100)|0}%`);
    if (this.round.plantProgress >= PLANT_TIME) {
      this.round.planted = true;
      this.round.plantPos = { x: site.plant.x, y: this.player.pos.y, z: site.plant.z, site: site.id };
      this.round.t = BOMB_TIME;
      this.round.plantProgress = 0;
      this.toast('Defuser planted');
      sfx.plant();
    }
  }
  _defuse(dt) {
    this.round.defuseProgress += dt;
    this.toast(`Defusing ${(this.round.defuseProgress / DEFUSE_TIME * 100)|0}%`);
    if (this.round.defuseProgress >= DEFUSE_TIME) this._endRound('defend', 'defuse');
  }

  useGadget() {
    const g = this.sig;
    if (!g || g.left <= 0) { this.toast('No signature gadget left'); return; }
    clearAdsToggle(this);
    this._gadgetBusy = true;
    // Placement itself is immediate; the busy flag is so fire can cancel back to ready in ≤0.2s.
    setTimeout(() => { this._gadgetBusy = false; }, 80);
    const kind = g.id === 'hearthlance' ? 'hearthlance'
      : g.id === 'nulldisc' ? 'nulldisc'
      : g.id === 'needleburst' ? 'needleburst'
      : g.id === 'staindart' ? 'staindart'
      : g.id;
    if (kind === 'staindart') { this.enterDrone(); return; }
    if (kind === 'afterstep') { this.toast('Footsteps projected'); g.left--; sfx.step(); return; }
    if (kind === 'blindwell') {
      this.gadgets.utility.push({ kind: 'blindwell', pos: this.player.pos.clone(), r: 4.5, live: true });
      g.left--; this.toast('Blindwell planted'); return;
    }
    if (kind === 'portcullis') { this.toast('Portcullis set'); g.left--; return; }
    if (kind === 'bramble') { this.toast('Bramble line set'); g.left--; return; }
    const ch = this.gadgets.tryPlace(kind);
    if (ch) g.left--;
  }
  useUtil() {
    const u = this.util;
    if (!u || u.left <= 0) return;
    clearAdsToggle(this);
    if (u.kind === 'explosive' || u.remote) {
      const ch = this.gadgets.tryPlace(u.id);
      if (ch) u.left--;
    } else {
      this.toast(u.name + ' used'); u.left--;
    }
  }

  jammedAt(pos) {
    return this.gadgets.utility.some(u => u.kind === 'blindwell' && u.live && pos.distanceTo(u.pos) < (u.r || 4));
  }

  swapWeapon() {
    this.swapT = this.player.stanceT >= 1.8 ? 0.9 : 0.45;
    if (this.weaponSlot === 'primary') {
      this._stash = this.weapon; this.weapon = this.secWeapon; this.weaponSlot = 'secondary';
    } else {
      this.weapon = this._stash || instWeapon(this.loadout.primary, this.loadout); this.weaponSlot = 'primary';
    }
    this.buildVm(); this.updateAmmo();
  }

  ping() {
    sfx.ping();
    this.toast('Ping');
    this._marks = this._marks || [];
    this._marks.push({ pos: this.player.pos.clone(), t: this.time });
  }

  enterDrone() { this.inDrone = this.droneSys.enterDrone(); }
  exitDrone() { this.droneSys.exitDrone(); this.inDrone = false; }
  enterCams() { this.inCams = this.droneSys.enterCams(); }
  exitCams() { this.droneSys.exitCams(); this.inCams = false; }

  hurt(who, dmg, from, head, info) {
    if (!who || !who.alive) return;
    if (who === this.player && this.godMode) return;
    const mul = 1 - (who.armor || 0) * 0.12;
    who.hp -= dmg * mul;
    if (who === this.player) {
      const fl = document.getElementById('damage-flash');
      if (fl) { fl.style.opacity = 0.6; setTimeout(() => fl.style.opacity = 0, 120); }
      this.updateAmmo();
    }
    if (who.hp <= 0) {
      who.hp = 0; who.alive = false; who.deaths = (who.deaths || 0) + 1;
      if (info?.who) info.who.kills = (info.who.kills || 0) + 1;
      if (who === this.player) {
        this.toast('You are down');
        clearAdsToggle(this);
      }
      this._checkElim();
    }
  }

  _checkElim() {
    const atk = [this.player, ...this.bots].filter(b => b.team === 'attack' && b.alive).length;
    const def = [this.player, ...this.bots].filter(b => b.team === 'defend' && b.alive).length;
    if (atk === 0) this._endRound('defend', 'elim');
    else if (def === 0 && !this.round.planted) this._endRound('attack', 'elim');
    else if (def === 0 && this.round.planted) { /* attackers can still lose on timer? they already planted — they win */ this._endRound('attack', 'elim'); }
  }

  _setPhase(ph, t) {
    this.round.phase = ph; this.round.t = t;
    document.getElementById('hud-phase').textContent = ph.toUpperCase();
  }

  _tickRound(dt) {
    this.round.t -= dt;
    if (this.round.phase === 'prep' && this.round.t <= 0) {
      this._setPhase('action', ACTION_TIME);
      this.toast('Action phase');
    } else if (this.round.phase === 'action' && this.round.t <= 0) {
      if (this.round.planted) this._endRound('attack', 'timeout');
      else this._endRound('defend', 'timeout');
    } else if (this.round.phase === 'intermission' && this.round.t <= 0) {
      this._nextRound();
    }
    const t = Math.max(0, this.round.t);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    document.getElementById('hud-timer').textContent = m + ':' + String(s).padStart(2, '0');
    document.getElementById('hud-score-atk').textContent = this.round.scoreAtk;
    document.getElementById('hud-score-def').textContent = this.round.scoreDef;
  }

  _endRound(winner, why) {
    if (this.round.phase === 'intermission' || this.ended) return;
    if (winner === 'attack') this.round.scoreAtk++; else this.round.scoreDef++;
    this.toast((winner === 'attack' ? 'Attack' : 'Defense') + ' wins the round (' + why + ')');
    if (this.round.scoreAtk >= this.round.need || this.round.scoreDef >= this.round.need) {
      this.round.winner = this.round.scoreAtk > this.round.scoreDef ? 'attack' : 'defend';
      this.ended = true;
      this.inMenu = true;
      this.ui.show('end');
      return;
    }
    this._setPhase('intermission', INTERMISSION);
  }

  async _nextRound() {
    this.round.n++;
    const mid = Math.ceil((this.cfg.bestOf || 3) / 2);
    if (this.round.n === mid && !this.round.swapped) {
      this.round.swapped = true;
      this.player.team = this.player.team === 'attack' ? 'defend' : 'attack';
      this.cfg.side = this.player.team;
      this.toast('Sides swapped');
    }
    this.round.planted = false; this.round.plantPos = null; this.round.plantProgress = 0; this.round.defuseProgress = 0;
    // reset pawns
    this.player.alive = true; this.player.hp = 100; this.player.rappelling = null;
    this._spawnPlayer(this.player.team);
    for (const b of this.bots) { b.alive = true; b.hp = 100; }
    this._setPhase('prep', this.cfg.prepTime || PREP_TIME);
  }

  _bindPrompt() {
    const el = document.getElementById('hud-prompt');
    if (!el || el._ivBound) return;
    el._ivBound = true;
    const fire = (e) => {
      if (el.classList.contains('hidden')) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      const now = performance.now();
      if (now - (this._promptAct || 0) < 250) return;
      this._promptAct = now;
      this.activatePrompt();
    };
    el.addEventListener('pointerup', fire);
    el.addEventListener('click', fire);
  }

  /** Same action as the ACTION / interact button, plus rappel / vault / window. */
  activatePrompt() {
    const p = this.player, w = this.world;
    if (!p?.alive) return false;
    if (p.rappelling) return this.tryRappelOrVault() ?? true;
    const door = w.nearestDoor(p.pos, 1.5);
    if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) return this.interact(0.2, false);
    const spot = w.findRappelSpot(p.pos, p.yaw, 2.4);
    if (spot) return this.tryRappelOrVault();
    if (this._canVault()) return this._vault();
    return this.interact(0.2, false);
  }

  _canVault() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nx = p.pos.x + fx * 1.0, nz = p.pos.z + fz * 1.0;
    const g1 = this.world.groundAt(nx, nz, p.pos.y + 1);
    return g1 > p.pos.y + 0.15 && g1 < p.pos.y + 0.9;
  }

  _updateInteractPrompt() {
    const el = document.getElementById('hud-prompt');
    const rap = document.getElementById('tb-rappel');
    const p = this.player, w = this.world;
    let msg = '';
    let action = '';
    if (p.rappelling) {
      const win = w.alignedWindow(p.rappelling, 0.75);
      if (win) {
        if (win.state === 'barricaded' || win.state === 'reinforced') { msg = 'BREACH WINDOW FIRST'; action = 'breach'; }
        else if (win.state === 'intact' || win.state === 'cracked') { msg = 'SMASH AND ENTER'; action = 'enter'; }
        else { msg = 'ENTER WINDOW'; action = 'enter'; }
      } else if (p.rappelling.y < 0.6) { msg = 'DROP'; action = 'drop'; }
      else { msg = 'RAPPEL — move freely, or drop at the ground'; action = 'rappel'; }
      rap?.classList.remove('hidden');
    } else {
      const spot = w.findRappelSpot(p.pos, p.yaw, 2.2);
      rap?.classList.toggle('hidden', !spot);
      if (spot) { msg = 'RAPPEL'; action = 'rappel'; }
      const door = w.nearestDoor(p.pos, 1.4);
      if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) {
        msg = door.state === 'open' ? 'CLOSE DOOR' : 'OPEN DOOR';
        action = 'door';
      }
      if (this._canVault() && action !== 'door') { msg = 'VAULT'; action = 'vault'; }
      const site = this._nearPlant();
      if (site && p.team === 'attack' && !this.round.planted && this.round.phase === 'action') { msg = 'HOLD TO PLANT'; action = 'plant'; }
      if (this.round.planted && p.team === 'defend' && this._nearDefuser()) { msg = 'HOLD TO DEFUSE'; action = 'defuse'; }
    }
    if (p.outOfBounds) { msg = 'Return to the operation area'; action = ''; }
    this.promptAction = action;
    if (msg && el) {
      const glyph = this.input?.interactGlyph?.() || '';
      el.textContent = msg + glyph;
      el.classList.remove('hidden');
    } else {
      el?.classList.add('hidden');
    }
  }

  _updateHud() {
    document.getElementById('hp-fill').style.width = Math.max(0, this.player.hp) + '%';
    document.getElementById('hp-n').textContent = Math.max(0, this.player.hp)|0;
    const obj = document.getElementById('hud-obj');
    if (this.round.planted) obj.textContent = this.player.team === 'defend' ? 'Defuse the defuser.' : 'Hold the site. Defend the defuser.';
    else if (this.round.phase === 'prep') obj.textContent = this.player.team === 'attack' ? 'Prep — drone and choose an entry.' : 'Prep — reinforce, barricade, set gadgets.';
    else obj.textContent = this.player.team === 'attack' ? 'Plant the defuser at a site, or eliminate the defense.' : 'Stop the plant. Hold the sites.';
    const ch = document.getElementById('crosshair');
    if (ch) ch.classList.toggle('hidden', this.player.ads > 0.55);
  }

  updateAmmo() {
    const w = this.weapon;
    document.getElementById('ammo-clip').textContent = w?.clip ?? 0;
    document.getElementById('ammo-res').textContent = '/ ' + (w?.reserve ?? 0);
    document.getElementById('ammo-wpn').textContent = (w?.name || '').toUpperCase();
    document.getElementById('hp-fill').style.width = Math.max(0, this.player.hp) + '%';
  }

  applyCrosshair() {
    const s = this.settings.crosshair;
    const el = document.getElementById('crosshair');
    if (!el) return;
    el.className = 'ch-' + (s.style || 'cross');
    el.style.setProperty('--ch-color', s.color || '#ffffff');
    el.style.setProperty('--ch-size', (s.size || 18) + 'px');
    el.style.setProperty('--ch-thick', (s.thick || 2) + 'px');
    el.style.setProperty('--ch-gap', (s.gap || 5) + 'px');
    el.style.setProperty('--ch-outline', (s.outline || 2) + 'px');
    el.style.setProperty('--ch-opacity', s.opacity ?? 0.95);
    el.style.color = s.color;
  }

  toast(msg) {
    this._msg = msg;
    const el = document.getElementById('hud-toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 1600);
  }

  _showLoad(on, title) {
    const el = document.getElementById('loading');
    el.classList.toggle('hidden', !on);
    if (title) document.getElementById('load-title').textContent = title;
    if (!on) document.getElementById('load-fill').style.width = '100%';
  }
  _loadMsg(msg, p) {
    document.getElementById('load-msg').textContent = msg;
    document.getElementById('load-fill').style.width = Math.round((p || 0) * 100) + '%';
  }

  _cullBots() {
    const b = this.world?.constructor ? null : null;
    const bounds = (this.world && (globalThis.BOUNDS)) || null;
    const box = this.world?.bounds || null;
    // Use map building AABB: hide operators well inside when the camera is outside.
    const B = { x0: -11, x1: 11, z0: -9, z1: 11 };
    const c = this.camera.position;
    const outside = c.x < B.x0 - 1.2 || c.x > B.x1 + 1.2 || c.z < B.z0 - 1.2 || c.z > B.z1 + 1.2;
    for (const bot of this.bots || []) {
      if (!bot.mesh) continue;
      if (!outside) { bot.mesh.visible = true; continue; }
      const p = bot.pos || bot.mesh.position;
      const inside = p.x > B.x0 + 0.8 && p.x < B.x1 - 0.8 && p.z > B.z0 + 0.8 && p.z < B.z1 - 0.8;
      const dx = p.x - c.x, dz = p.z - c.z;
      bot.mesh.visible = !inside && Math.hypot(dx, dz) < 8;
    }
  }

  spawnBurst(pos) { /* particle stub */ }
  spawnDecal() {}


  async _tryAuthoredWeapon() {
    try {
      const vis = await createFirstPersonViewmodel(this.weapon || {});
      if (!vis) return;
      this.gfx.setViewmodel(vis);
      this.vm = vis;
    } catch (e) { console.warn('authored vm failed', e); }
  }

  // test helpers
  inspectLoad() {
    const p = this.player, w = this.world;
    const gy = w.groundAt(p.pos.x, p.pos.z, p.pos.y + 2);
    const groups = this.gfx.scene.children.filter(c => c.name === 'world').length;
    return {
      ok: this.running, layout: w.layoutId, boxes: w.boxes.length,
      py: p.pos.y, gy, floorDelta: Math.abs(p.pos.y - gy),
      solid: !!w.pointInSolid(p.pos.x, p.pos.y + 0.2, p.pos.z, 0.2, 1.2),
      worldGroups: groups,
      mem: this.gfx.info(),
    };
  }
}

export { BUILD, TITLE, measure, buildHuman, EYE };
