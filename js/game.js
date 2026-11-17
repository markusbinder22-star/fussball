// Spiellogik: Physik, Regeln, Computergegner, Kamera und Trainingsmodi.
import * as THREE from '../vendor/three.module.min.js';
import { Sound } from './audio.js';
import { BALL_VIS_R } from './world.js';

const V3 = THREE.Vector3;
const G = 9.81;
const BR = 0.11;            // Ballradius (Physik)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hs = (v) => Math.hypot(v.x, v.z);
const faceVec = (p) => new V3(Math.cos(p.face), 0, Math.sin(p.face));
const dirOf = (team) => (team === 0 ? 1 : -1);
const angTo = (from, to) => Math.atan2(to.z - from.z, to.x - from.x);
const wrapAng = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export const TEAMS = [
  { name: 'Blau', shirt: 0x1f5fe0, shorts: 0xffffff, socks: 0x1f5fe0, gk: 0x20b35a, css: '#2f6df0' },
  { name: 'Rot', shirt: 0xd62828, shorts: 0x1a1a1a, socks: 0xd62828, gk: 0xf2c418, css: '#e03131' },
];
export const HUMAN_COLORS = [0xffe14d, 0x4de1ff];

const DIFF = {
  leicht: { speed: 0.84, tackle: 0.25, shootErr: 0.16, save: 0.55, steal: 0.45, shootRange: 0.8 },
  mittel: { speed: 0.95, tackle: 0.4, shootErr: 0.11, save: 0.7, steal: 0.85, shootRange: 1 },
  schwer: { speed: 1.04, tackle: 0.55, shootErr: 0.065, save: 0.8, steal: 1.25, shootRange: 1.1 },
};

// Anzahl Spieler pro Reihe (Abwehr, Mittelfeld, Sturm) je Anzahl Feldspieler
const LINES = { 1: [0, 0, 1], 2: [1, 0, 1], 3: [1, 1, 1], 4: [2, 1, 1], 5: [2, 2, 1], 6: [2, 3, 1], 7: [3, 3, 1], 8: [3, 3, 2], 9: [4, 3, 2], 10: [4, 4, 2] };
const LINE_U = [-0.3, -0.15, -0.04];

export function makeDims(n) {
  const L = 40 + (n - 1) * 6.5;
  const W = Math.round(L * 0.65);
  const s = clamp(L / 105, 0.45, 1);
  return {
    L, W, s,
    goalW: 7.32 * clamp(s * 1.15, 0.62, 1),
    goalH: 2.44 * clamp(s * 1.1, 0.82, 1),
    boxD: 16.5 * s, boxW: 40.3 * s,
    smallD: 5.5 * s, smallW: 18.3 * s,
    spot: 11 * s, circle: 9.15 * s,
  };
}

export class Game {
  constructor(world, input, ui) {
    this.w = world;
    this.input = input;
    this.ui = ui;
    this.players = [];
    this.cam = { yaw: Math.PI, top: 1, focus: new V3(), pos: new V3(0, 60, 40), tgt: new V3() };
    this.camFwd = new V3(1, 0, 0);
    this.camRight = new V3(0, 0, 1);
    this.paused = false;
    this.clock = 0;
  }

  // ================= Start / Aufbau =================
  start(cfg) {
    this.cfg = cfg;
    this.w.clear();
    this.players = [];
    this.train = null;
    this.clock = 0;
    this.topHold = 0;
    this.cornerT = 0;
    const n = cfg.mode === 'training' ? 11 : cfg.teamSize;
    this.d = makeDims(n);
    this.w.buildPitch(this.d);
    this.diff = [DIFF.mittel, DIFF.mittel];
    if (cfg.mode === 'match' && cfg.opponent === 'cpu') this.diff[1] = DIFF[cfg.difficulty] || DIFF.mittel;

    if (cfg.demo) this.humans = [];
    else if (cfg.mode === 'match' && cfg.opponent === 'human') this.humans = [{ team: 0, ctl: 0 }, { team: 1, ctl: 1 }];
    else this.humans = [{ team: 0, ctl: 0 }];
    for (const h of this.humans) { h.p = null; h.charge = -1; h.switchT = 0; }

    const bm = this.w.makeBall();
    this.ball = {
      pos: new V3(0, BR, 0), vel: new V3(), owner: null, lastTouch: null, lastTeam: -1,
      spin: 0, curveT: 0, curveCtl: -1, curveR: new V3(0, 0, 1), shot: false, keeperTried: false,
      intended: null, inGoal: false, mesh: bm.mesh, shadow: bm.shadow, hitWall: false,
    };
    this.markers = this.humans.map((h, i) => this.w.makeMarker(HUMAN_COLORS[i]));
    this.aimArrow = this.w.makeAimArrow();

    if (cfg.mode === 'training') {
      this.setupTraining(cfg.training, cfg.wall);
    } else {
      for (let t = 0; t < 2; t++) {
        if (n >= 2) this.addPlayer(t, true, -0.48, 0);
        const k = n >= 2 ? n - 1 : 1;
        const lines = LINES[k];
        lines.forEach((cnt, li) => {
          for (let i = 0; i < cnt; i++) {
            const v = cnt === 1 ? 0 : ((i + 0.5) / cnt - 0.5) * 0.78;
            this.addPlayer(t, false, LINE_U[li], v);
          }
        });
      }
      this.score = [0, 0];
      this.time = cfg.duration * 60;
      this.kickoff(0);
      Sound.whistle('long');
    }
    this.cam.top = cfg.mode === 'training' ? 0 : 1;
    this.cam.yaw = Math.PI;
    this.cam.focus.copy(this.ball.pos);
    this.updateCamera(1, true);
    this.ui.onStart(this);
  }

  addPlayer(team, gk, u, v) {
    const c = TEAMS[team];
    const mesh = this.w.makePlayer(gk ? c.gk : c.shirt, c.shorts, gk ? c.gk : c.socks);
    const p = {
      team, gk, home: { u, v }, pos: new V3(), vel: new V3(), want: new V3(),
      face: team === 0 ? 0 : Math.PI, stun: 0, fall: 0, kickCd: 0, tackleCd: 0, aiT: Math.random() * 0.5,
      anim: Math.random() * 6, mesh, wall: false, jump: 0, human: null, holdT: 0,
      pkTarget: null, pkDelay: 0, spot: null, id: this.players.length,
    };
    this.players.push(p);
    return p;
  }

  homeWorld(p, uOverride) {
    const d = this.d, dir = dirOf(p.team);
    const u = uOverride !== undefined ? uOverride : p.home.u;
    return new V3(u * d.L * dir, 0, p.home.v * d.W);
  }

  // ================= Steuerung der Menschen =================
  setControl(h, p) {
    if (!p || h.p === p) return;
    if (h.p) h.p.human = null;
    if (p.human && p.human !== h) p.human.p = null;
    h.p = p;
    p.human = h;
    h.charge = -1;
  }

  humanOfTeam(team) { return this.humans.find((h) => h.team === team) || null; }

  switchPlayer(h, auto = false) {
    const b = this.ball;
    const pred = b.pos.clone().addScaledVector(b.vel, 0.3);
    let best = null, bd = 1e9;
    for (const q of this.players) {
      if (q.team !== h.team || q.gk || q.wall || q === h.p || q.human) continue;
      const dd = distXZ(q.pos, pred);
      if (dd < bd) { bd = dd; best = q; }
    }
    if (best) {
      this.setControl(h, best);
      if (!auto) Sound.click();
    }
  }

  // Wohin läuft man zum Ball? Bei hohen Bällen zum Landepunkt, sonst kurz vor den Ball.
  ballTarget(lead = 0.35) {
    const b = this.ball;
    if (b.owner) return b.pos.clone().setY(0);
    if (b.pos.y > 1.2 || b.vel.y > 2) {
      const y = b.pos.y - BR, vy = b.vel.y;
      const t = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, y))) / G;
      return new V3(b.pos.x + b.vel.x * t * 0.97, 0, b.pos.z + b.vel.z * t * 0.97);
    }
    return new V3(b.pos.x + b.vel.x * lead, 0, b.pos.z + b.vel.z * lead);
  }

  camVec(mx, my) {
    return new V3(
      this.camFwd.x * my + this.camRight.x * mx, 0,
      this.camFwd.z * my + this.camRight.z * mx,
    );
  }

  updateHumans(dt) {
    const b = this.ball;
    for (const h of this.humans) {
      const c = this.input.ctrl[h.ctl];
      h.switchT -= dt;
      let p = h.p;
      if (!p) continue;

      // Effet nach dem Schuss
      if (b.curveCtl === h.ctl && b.curveT > 0 && !b.owner) b.spin = clamp(b.spin + c.mx * 20 * dt, -11, 11);

      const mv = this.camVec(c.mx, c.my);
      const mag = Math.min(1, Math.hypot(c.mx, c.my));
      const sp = this.sp;

      if (this.phase === 'setpiece' && sp.taker === p) {
        p.want.set(0, 0, 0);
        if (Math.abs(c.mx) > 0.15) {
          const r = this.camRight;
          const tang = new V3(-Math.sin(p.face), 0, Math.cos(p.face));
          const sgn = Math.sign(tang.dot(r)) || 1;
          p.face = wrapAng(p.face + c.mx * 1.25 * dt * sgn);
          this.limitAim(p);
        }
        this.handleKick(h, c, p, faceVec(p), dt);
        continue;
      }
      if (this.phase !== 'play' && this.phase !== 'setpiece') { p.want.set(0, 0, 0); continue; }
      if (this.phase === 'setpiece' && sp.type === 'kickoff') { p.want.set(0, 0, 0); continue; }
      if (this.train && this.train.res) { p.want.set(0, 0, 0); continue; }

      // Torwart wird nur beim Abstoß selbst gesteuert
      if (p.gk) { this.switchPlayer(h, true); p = h.p; if (!p) continue; }

      const speed = (c.sprint ? 8.4 : 6.5) * (b.owner === p ? 0.9 : 1);
      p.want.copy(mv).multiplyScalar(speed);
      if (mag < 0.1 && !b.owner && b.intended === p) {
        const tgt = this.ballTarget(0.25);
        const dd = distXZ(tgt, p.pos);
        if (dd > 0.5) p.want.set(tgt.x - p.pos.x, 0, tgt.z - p.pos.z).normalize().multiplyScalar(6);
      }
      const aim = mag > 0.3 ? mv.clone().normalize() : faceVec(p);

      if (b.owner === p) {
        this.handleKick(h, c, p, aim, dt);
      } else {
        h.charge = -1;
        const bd = distXZ(p.pos, b.pos);
        const loose = !b.owner;
        if (this.phase === 'play' && loose && bd < 1.6 && b.pos.y < 2.5 && p.kickCd <= 0 &&
            (c.shootPressed || c.passPressed || c.lobPressed)) {
          this.oneTouch(h, p, c, aim);
        } else if (c.swPressed) {
          const o = b.owner;
          if (o && o.team !== p.team && !o.gk && distXZ(p.pos, o.pos) < 2.4) this.tackle(p, o, 0.62);
          else if (this.cfg.mode === 'match' || (this.train && this.train.type === 'ecke')) this.switchPlayer(h);
        }
        // automatischer Wechsel, wenn der Ball weit weg ist
        if (this.cfg.mode === 'match' && h.switchT <= 0 && (!b.owner || b.owner.team !== h.team) && b.intended !== p) {
          const cur = distXZ(p.pos, b.pos);
          if (cur > 18) {
            let best = 1e9;
            for (const q of this.players) if (q.team === h.team && !q.gk && !q.human) best = Math.min(best, distXZ(q.pos, b.pos));
            if (best < cur - 9) { this.switchPlayer(h, true); h.switchT = 1.5; }
          }
        }
      }
    }
  }

  limitAim(p) {
    if (this.sp && this.sp.type === 'penalty') {
      p.face = clamp(p.face, -0.55, 0.55);
    }
  }

  handleKick(h, c, p, aim, dt) {
    if (c.shootPressed) h.charge = 0;
    if (h.charge >= 0) {
      if (c.shootHeld) h.charge = Math.min(1, h.charge + dt * 1.15);
      if (c.shootReleased || !c.shootHeld) {
        this.shoot(p, Math.max(0.12, h.charge), aim, h);
        h.charge = -1;
        return;
      }
    }
    if (c.passPressed) { h.charge = -1; this.pass(p, aim, h); }
    else if (c.lobPressed) { h.charge = -1; this.lob(p, aim, h); }
  }

  oneTouch(h, p, c, aim) {
    const b = this.ball;
    if (c.shootPressed) {
      if (Math.hypot(c.mx, c.my) < 0.3) {
        // ohne Richtungseingabe: direkt aufs Tor
        const gx = this.goalX(p.team);
        aim = new V3(gx - b.pos.x, 0, -b.pos.z).normalize();
      }
      const dir = this.aimAssist(p, aim, 0.85);
      if (b.pos.y > 1.2) {
        this.kickBall(p, dir, 15, b.pos.y > 1.8 ? -1.5 : 1.0, { shot: true, ctl: h.ctl, keepPos: true });
      } else {
        this.kickBall(p, dir, 23, 2.2 + Math.random(), { shot: true, ctl: h.ctl, keepPos: true });
      }
    } else if (c.passPressed) this.pass(p, aim, h, null, true);
    else this.lob(p, aim, h, null, true);
  }

  // ================= Schuss, Pass, Flanke =================
  goalX(team) { return dirOf(team) * this.d.L / 2; }

  aimAssist(p, dir, strength = 1) {
    const b = this.ball, d = this.d;
    const gx = this.goalX(p.team);
    const toGoal = new V3(gx - b.pos.x, 0, -b.pos.z);
    const dist = toGoal.length();
    if (dist > 42) return dir.clone();
    toGoal.normalize();
    const ang = Math.acos(clamp(dir.dot(toGoal), -1, 1));
    if (ang > 0.75 || Math.abs(dir.x) < 0.05) return dir.clone();
    const t = (gx - b.pos.x) / dir.x;
    if (t <= 0) return dir.clone();
    const zRaw = b.pos.z + dir.z * t;
    const lim = d.goalW / 2 - 0.35;
    const zc = clamp(zRaw, -lim, lim);
    const z = zc + (zRaw - zc) * 0.22;
    const nd = new V3(gx - b.pos.x, 0, z - b.pos.z).normalize();
    return dir.clone().lerp(nd, strength).normalize();
  }

  shoot(p, power, aim, h) {
    let dir = this.aimAssist(p, aim);
    const err = (Math.random() - 0.5) * 2 * (0.015 + power * power * 0.05);
    dir = rotY(dir, err);
    const speed = 14 + 19 * power;
    const vy = speed * (0.035 + 0.12 * power * power) + rand(0, 0.5);
    this.kickBall(p, dir, speed, vy, { shot: true, ctl: h ? h.ctl : -1 });
  }

  findMate(p, dir, minCos, maxD) {
    let best = null, bs = -1e9;
    for (const q of this.players) {
      if (q === p || q.team !== p.team || q.wall) continue;
      if (q.gk && !p.gk) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3 || dist > maxD) continue;
      const cos = (dx * dir.x + dz * dir.z) / dist;
      if (cos < minCos) continue;
      const blocked = this.laneBlocked(p.pos, q.pos, p.team) ? 0.5 : 0;
      const sc = cos * 2.2 - dist / 45 - blocked;
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }

  pass(p, aim, h, forced = null, keepPos = false) {
    const b = this.ball;
    const q = forced || this.findMate(p, aim, 0.5, 45);
    if (q) {
      const dist0 = distXZ(q.pos, b.pos);
      const lead = q.pos.clone().addScaledVector(q.vel, clamp(dist0 / 22, 0.2, 0.9));
      const dv = new V3(lead.x - b.pos.x, 0, lead.z - b.pos.z);
      const dist = dv.length();
      dv.normalize();
      const v0 = clamp(5 + 0.8 * dist, 8, 27);
      this.kickBall(p, dv, v0, 0.4, { target: q, keepPos });
      if (h) this.setControl(h, q);
    } else {
      this.kickBall(p, aim, 13, 0.4, { keepPos });
    }
  }

  lob(p, aim, h, forced = null, keepPos = false, landAt = null) {
    const b = this.ball;
    const q = forced || (landAt ? null : this.findMate(p, aim, 0.3, 58));
    let land;
    if (landAt) land = landAt.clone();
    else if (q) {
      const d0 = distXZ(q.pos, b.pos);
      land = q.pos.clone().addScaledVector(q.vel, 0.8 + d0 / 30);
    } else land = b.pos.clone().addScaledVector(aim, 24);
    const dv = new V3(land.x - b.pos.x, 0, land.z - b.pos.z);
    const dist = Math.max(4, dv.length());
    dv.normalize();
    const T = 0.75 + dist / 26;
    const vh = (dist / T) * 1.03;
    const vy = 0.5 * G * T;
    this.kickBall(p, dv, vh, vy, { target: q, keepPos });
    if (h && q) this.setControl(h, q);
  }

  kickBall(p, dir, speed, vy, o = {}) {
    const b = this.ball;
    if (!o.keepPos && b.owner) b.pos.y = BR;
    b.owner = null;
    b.vel.set(dir.x * speed, vy, dir.z * speed);
    b.lastTouch = p; b.lastTeam = p.team;
    p.kickCd = 0.35;
    p.face = Math.atan2(dir.z, dir.x);
    b.spin = 0;
    b.curveT = o.ctl !== undefined && o.ctl >= 0 && o.shot ? 0.9 : 0;
    b.curveCtl = o.ctl !== undefined ? o.ctl : -1;
    b.curveR.copy(this.camRight);
    b.shot = !!o.shot;
    b.keeperTried = false;
    b.intended = o.target || null;
    p.holdT = 0;
    Sound.kick(clamp(speed / 30, 0.2, 1));
    if (this.phase === 'setpiece') {
      const sp = this.sp;
      this.phase = 'play';
      this.topHold = sp.type === 'goalkick' || sp.type === 'kickoff' ? 0.4 : 0;
      if (sp.type === 'corner') this.cornerT = 4;
      if (sp.type === 'freekick') for (const w of this.players) if (w.wall) w.jump = 0.55;
      if (sp.type === 'penalty') {
        const k = this.players.find((x) => x.gk && x.team !== p.team);
        if (k) {
          const tt = (k.pos.x - b.pos.x) / (b.vel.x || 1e-6);
          const zc = b.pos.z + b.vel.z * tt;
          k.pkTarget = Math.random() < 0.38 ? clamp(zc, -3, 3) : [-2.6, -1.4, 0, 1.4, 2.6][(Math.random() * 5) | 0];
          k.pkDelay = 0.16;
        }
      }
    }
    if (this.train && p.team === 0) { this.train.kicked = true; this.train.kt = 0; }
  }

  tackle(p, o, chance) {
    p.tackleCd = 1.1;
    const lunge = new V3(o.pos.x - p.pos.x, 0, o.pos.z - p.pos.z).normalize();
    p.vel.addScaledVector(lunge, 4);
    p.face = Math.atan2(lunge.z, lunge.x);
    if (Math.random() < chance) {
      const b = this.ball;
      b.owner = null;
      b.vel.set(lunge.x * 6 + rand(-2, 2), 0.8, lunge.z * 6 + rand(-2, 2));
      b.lastTouch = p; b.lastTeam = p.team; b.shot = false; b.intended = null;
      o.stun = 0.8; o.fall = 0.8;
      p.stun = 0.25;
      Sound.kick(0.35);
    } else {
      p.stun = 0.7; p.fall = 0.7;
    }
  }

  gainBall(p, silent = false) {
    const b = this.ball;
    b.owner = p;
    b.lastTouch = p; b.lastTeam = p.team;
    b.shot = false; b.intended = null; b.spin = 0; b.curveT = 0;
    b.vel.set(0, 0, 0);
    p.holdT = 0;
    if (!p.gk) for (const h of this.humans) if (h.team === p.team) this.setControl(h, p);
    if (!silent) Sound.touch(0.4);
  }

  // ================= Standardsituationen =================
  kickoff(team) {
    const d = this.d;
    this.ball.inGoal = false;
    for (const p of this.players) {
      p.vel.set(0, 0, 0); p.stun = 0; p.fall = 0;
      const dir = dirOf(p.team);
      if (p.gk) { p.pos.set(-dir * (d.L / 2 - 1.2), 0, 0); p.face = dir > 0 ? 0 : Math.PI; continue; }
      p.pos.copy(this.homeWorld(p, Math.min(p.home.u, -0.04)));
      p.face = dir > 0 ? 0 : Math.PI;
      if (p.team !== team) {
        const r = Math.hypot(p.pos.x, p.pos.z);
        if (r < d.circle + 0.8) p.pos.multiplyScalar((d.circle + 0.8) / Math.max(0.1, r));
        if (Math.abs(p.pos.x) < 0.5) p.pos.x = -dir * (d.circle + 0.8);
      }
    }
    const mates = this.players.filter((p) => p.team === team && !p.gk);
    mates.sort((a, b) => Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z));
    const taker = mates[0];
    const dir = dirOf(team);
    if (mates[1]) mates[1].pos.set(-dir * 2.5, 0, 3);
    this.setSetpiece('kickoff', team, new V3(0, BR, 0), taker, 'Anstoß');
    taker.pos.set(-dir * 0.6, 0, 0);
    taker.face = dir > 0 ? 0 : Math.PI;
    if (mates[1]) taker.face = angTo(taker.pos, mates[1].pos);
  }

  setSetpiece(type, team, pos, taker = null, label = '') {
    const d = this.d, b = this.ball;
    this.phase = 'setpiece';
    this.sp = { type, team, pos: pos.clone(), t: 0, delay: type === 'kickoff' ? 1.3 : rand(1.1, 1.9) };
    b.owner = null; b.pos.copy(pos); b.pos.y = BR; b.vel.set(0, 0, 0);
    b.spin = 0; b.curveT = 0; b.intended = null; b.shot = false; b.inGoal = false;
    if (!taker) {
      let best = 1e9;
      const gk = this.players.find((p) => p.team === team && p.gk);
      if (type === 'goalkick' && gk) taker = gk;
      else for (const p of this.players) {
        if (p.team !== team || p.gk) continue;
        const dd = distXZ(p.pos, pos);
        if (dd < best) { best = dd; taker = p; }
      }
    }
    this.sp.taker = taker;
    const gx = this.goalX(team);
    let aimPt;
    if (type === 'corner') aimPt = new V3(gx - dirOf(team) * d.spot, 0, 0);
    else if (type === 'throwin') aimPt = new V3(pos.x + dirOf(team) * 6, 0, 0);
    else if (type === 'freekick' || type === 'penalty') aimPt = new V3(gx, 0, 0);
    else aimPt = new V3(pos.x + dirOf(team) * 20, 0, pos.z * 0.5);
    taker.face = angTo(pos, aimPt);
    const back = type === 'throwin' ? 0.35 : 0.6;
    taker.pos.set(pos.x - Math.cos(taker.face) * back, 0, pos.z - Math.sin(taker.face) * back);
    taker.vel.set(0, 0, 0); taker.stun = 0; taker.fall = 0;
    for (const h of this.humans) if (h.team === team) this.setControl(h, taker);
    const R = type === 'throwin' ? 3 : d.circle;
    for (const p of this.players) {
      if (p.team === team || p.gk || p.wall || type === 'kickoff') continue;
      const dd = distXZ(p.pos, pos);
      if (dd < R) {
        const away = new V3(p.pos.x - pos.x, 0, p.pos.z - pos.z);
        if (away.lengthSq() < 0.01) away.set(-dirOf(team), 0, 0.3);
        away.normalize();
        p.pos.set(pos.x + away.x * R, 0, pos.z + away.z * R);
      }
    }
    if (type === 'corner' && !this.train) this.assignCornerSpots(team);
    if (label) this.ui.banner(label);
  }

  assignCornerSpots(team) {
    const d = this.d, gx = this.goalX(team), dir = dirOf(team);
    const att = this.players.filter((p) => p.team === team && !p.gk && p !== this.sp.taker);
    const def = this.players.filter((p) => p.team !== team && !p.gk);
    const spot = (i) => new V3(gx - dir * (5 + (i % 3) * 3.5 + rand(0, 1.5)) * Math.max(0.6, d.s), 0,
      ((i % 4) - 1.5) * 3.2 * Math.max(0.6, d.s) + rand(-1, 1));
    att.sort((a, b) => distXZ(a.pos, this.sp.pos) - distXZ(b.pos, this.sp.pos));
    att.forEach((p, i) => { p.spot = i < 4 ? spot(i) : null; });
    def.forEach((p, i) => {
      const m = att[i];
      p.spot = m && m.spot ? m.spot.clone().add(new V3(dir * 1.2, 0, 0.6)) : null;
    });
  }

  updateSetpiece(dt) {
    const sp = this.sp, b = this.ball, t = sp.taker;
    sp.t += dt;
    b.pos.copy(sp.pos);
    b.pos.y = sp.type === 'throwin' ? 2.05 : BR;
    b.vel.set(0, 0, 0);
    const back = sp.type === 'throwin' ? 0.35 : 0.6;
    t.pos.set(sp.pos.x - Math.cos(t.face) * back, 0, sp.pos.z - Math.sin(t.face) * back);
    t.vel.set(0, 0, 0);
    if (!t.human && sp.t > sp.delay) this.aiTakeSetpiece();
  }

  aiTakeSetpiece() {
    const sp = this.sp, p = sp.taker, d = this.d;
    const dir = dirOf(p.team);
    if (sp.type === 'kickoff') {
      const q = this.players.filter((x) => x.team === p.team && x !== p && !x.gk)
        .sort((a, c) => distXZ(a.pos, p.pos) - distXZ(c.pos, p.pos))[0];
      if (q) this.pass(p, faceVec(p), null, q); else this.kickBall(p, new V3(dir, 0, 0), 10, 0.3);
    } else if (sp.type === 'corner') {
      const gx = this.goalX(p.team);
      const cands = this.players.filter((x) => x.team === p.team && !x.gk && x !== p && Math.abs(x.pos.x - gx) < d.boxD + 3);
      if (cands.length) this.lob(p, faceVec(p), null, cands[(Math.random() * cands.length) | 0]);
      else this.lob(p, faceVec(p), null, null, false, new V3(gx - dir * d.spot, 0, rand(-3, 3)));
    } else {
      const q = this.bestPassTarget(p, sp.type === 'goalkick');
      if (q) {
        const dist = distXZ(q.pos, p.pos);
        if (sp.type !== 'throwin' && (dist > 24 || this.laneBlocked(p.pos, q.pos, p.team))) this.lob(p, faceVec(p), null, q);
        else this.pass(p, faceVec(p), null, q);
      } else this.lob(p, new V3(dir, 0, 0), null, null, false, p.pos.clone().add(new V3(dir * 25, 0, -p.pos.z * 0.3)));
    }
  }

  // ================= Computer-Spieler =================
  laneBlocked(a, c, team) {
    const dx = c.x - a.x, dz = c.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1) return false;
    for (const o of this.players) {
      if (o.team === team) continue;
      const t = ((o.pos.x - a.x) * dx + (o.pos.z - a.z) * dz) / len2;
      if (t < 0.08 || t > 0.95) continue;
      const px = a.x + dx * t, pz = a.z + dz * t;
      if (Math.hypot(o.pos.x - px, o.pos.z - pz) < 1.5) return true;
    }
    return false;
  }

  nearestOpp(p, maxD) {
    let best = null, bd = maxD;
    for (const o of this.players) {
      if (o.team === p.team) continue;
      const dd = distXZ(o.pos, p.pos);
      if (dd < bd) { bd = dd; best = o; }
    }
    return best;
  }

  bestPassTarget(p, preferLong = false) {
    const dir = dirOf(p.team);
    let best = null, bs = -0.4;
    for (const q of this.players) {
      if (q === p || q.team !== p.team || q.gk || q.wall) continue;
      const dist = distXZ(q.pos, p.pos);
      if (dist < 5 || dist > 46) continue;
      const fwd = ((q.pos.x - p.pos.x) * dir) / 14;
      const opp = this.nearestOpp(q, 12);
      const open = opp ? distXZ(opp.pos, q.pos) / 5 : 2.4;
      const blocked = this.laneBlocked(p.pos, q.pos, p.team) ? 0.9 : 0;
      const sc = fwd + Math.min(open, 2.4) - blocked - Math.abs(dist - (preferLong ? 28 : 16)) / 30 + rand(0, 0.35);
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }

  arrive(p, tgt, maxSpeed) {
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) { p.want.set(0, 0, 0); return; }
    const sp = Math.min(maxSpeed, dist * 2.2);
    p.want.set(dx / dist * sp, 0, dz / dist * sp);
  }

  updateAI(dt) {
    const b = this.ball, d = this.d;
    const pred = this.ballTarget(0.35);
    pred.x = clamp(pred.x, -d.L / 2, d.L / 2);
    pred.z = clamp(pred.z, -d.W / 2, d.W / 2);

    for (let t = 0; t < 2; t++) {
      const owned = b.owner && b.owner.team === t;
      const diff = this.diff[t];
      let chaser = null;
      if (!owned && (this.phase === 'play')) {
        if (!b.owner && b.intended && b.intended.team === t && !b.intended.human) chaser = b.intended;
        else {
          let best = 1e9;
          for (const p of this.players) {
            if (p.team !== t || p.gk || p.wall || p.human || p.stun > 0) continue;
            const dd = distXZ(p.pos, pred);
            if (dd < best) { best = dd; chaser = p; }
          }
          const h = this.humanOfTeam(t);
          if (h && h.p && !b.owner && distXZ(h.p.pos, pred) < best) chaser = null;
          if (this.train && chaser && !this.train.aiChase) chaser = null;
          if (this.train && this.train.type === 'ecke' && chaser && distXZ(chaser.pos, pred) > 9) chaser = null;
        }
      }

      for (const p of this.players) {
        if (p.team !== t || p.human) continue;
        if (p.stun > 0 || p.wall) { p.want.set(0, 0, 0); continue; }
        if (this.phase === 'goal' || this.phase === 'over' || (this.train && this.train.res)) {
          p.want.multiplyScalar(0.9); continue;
        }
        if (this.phase === 'setpiece' && (this.sp.type === 'kickoff' || this.sp.taker === p)) { p.want.set(0, 0, 0); continue; }
        if (p.gk) { this.keeperAI(p, dt); continue; }
        if (b.owner === p) { this.ownerAI(p, dt); continue; }
        if (p === chaser) {
          let tgt = pred;
          const o = b.owner;
          if (o && o.team !== t) {
            tgt = o.pos.clone().addScaledVector(faceVec(o), 0.7);
            if (distXZ(p.pos, o.pos) < 1.35 && p.tackleCd <= 0 && !o.gk) this.tackle(p, o, diff.tackle);
          }
          this.arrive(p, tgt, 6.7 * diff.speed);
          continue;
        }
        this.positionalAI(p, owned, diff);
      }
    }
  }

  positionalAI(p, owned, diff) {
    const b = this.ball, d = this.d, dir = dirOf(p.team);
    if (this.train) {
      if (p.spot) this.arrive(p, p.spot, 5);
      else p.want.set(0, 0, 0);
      return;
    }
    let tgt;
    if ((this.cornerT > 0 || (this.phase === 'setpiece' && this.sp.type === 'corner')) && p.spot) {
      tgt = p.spot;
    } else {
      const bu = (b.pos.x / d.L) * dir;
      const bv = b.pos.z / d.W;
      const att = owned || (!b.owner && b.lastTeam === p.team);
      let u = p.home.u + 0.55 * bu + (att ? 0.15 : -0.02);
      if (!att && p.home.u < -0.1) u = Math.min(u, bu - 0.04);
      if (att && p.home.u > -0.1) u = Math.max(u, bu + (p.home.u > -0.08 ? 0.08 : 0.0));
      u = clamp(u, -0.46, 0.4);
      const v = p.home.v * 0.9 + bv * 0.3;
      tgt = new V3(u * d.L * dir, 0, v * d.W);
    }
    if (this.phase === 'setpiece' && p.team !== this.sp.team) {
      const R = (this.sp.type === 'throwin' ? 3 : d.circle) + 0.3;
      const dd = distXZ(tgt, this.sp.pos);
      if (dd < R) {
        const away = new V3(tgt.x - this.sp.pos.x, 0, tgt.z - this.sp.pos.z).normalize();
        tgt = this.sp.pos.clone().addScaledVector(away, R); tgt.y = 0;
      }
    }
    const far = distXZ(tgt, p.pos);
    this.arrive(p, tgt, (far > 10 ? 6.4 : 4.8) * diff.speed);
  }

  ownerAI(p, dt) {
    const b = this.ball, d = this.d, dir = dirOf(p.team), diff = this.diff[p.team];
    const gx = this.goalX(p.team);
    const toGoal = new V3(gx - p.pos.x, 0, -p.pos.z);
    const dg = toGoal.length();
    p.aiT -= dt;
    const range = Math.min(29, 12 + d.L * 0.16) * diff.shootRange;
    if (p.aiT <= 0) {
      p.aiT = rand(0.25, 0.5);
      if (dg < range && Math.abs(p.pos.z) < d.goalW / 2 + dg * 0.9 && Math.random() < 0.8) {
        const k = this.players.find((x) => x.gk && x.team !== p.team);
        const side = (k ? (k.pos.z > 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1)) * (Math.random() < 0.75 ? 1 : -1);
        const tz = side * (d.goalW / 2 - 0.55) * rand(0.55, 1);
        let aim = new V3(gx - b.pos.x, 0, tz - b.pos.z).normalize();
        aim = rotY(aim, (Math.random() - 0.5) * 2 * diff.shootErr);
        const power = clamp(0.35 + dg / 36, 0.45, 0.95);
        const speed = 14 + 19 * power;
        const vy = speed * (0.03 + 0.11 * power * power) + rand(0, 0.8);
        this.kickBall(p, aim, speed, vy, { shot: true });
        return;
      }
      const press = this.nearestOpp(p, 3.4);
      if ((press && Math.random() < 0.6) || Math.random() < 0.05) {
        const q = this.bestPassTarget(p);
        if (q) {
          const dist = distXZ(q.pos, p.pos);
          const dq = new V3(q.pos.x - p.pos.x, 0, q.pos.z - p.pos.z).normalize();
          if (this.laneBlocked(p.pos, q.pos, p.team) || dist > 28) this.lob(p, dq, null, q);
          else this.pass(p, dq, null, q);
          return;
        }
      }
    }
    const steer = toGoal.clone().normalize();
    for (const o of this.players) {
      if (o.team === p.team) continue;
      const rx = o.pos.x - p.pos.x, rz = o.pos.z - p.pos.z;
      const dist = Math.hypot(rx, rz);
      if (dist > 7 || dist < 0.01) continue;
      const ahead = (rx * steer.x + rz * steer.z) / dist;
      if (ahead < -0.2) continue;
      const w = ((7 - dist) / 7) * 1.4;
      // seitlich ausweichen
      const side = Math.sign(rx * steer.z - rz * steer.x) || 1;
      const px = steer.z * side, pz = -steer.x * side;
      steer.x += px * w * 0.8 - (rx / dist) * w * 0.3;
      steer.z += pz * w * 0.8 - (rz / dist) * w * 0.3;
    }
    if (Math.abs(p.pos.z) > d.W / 2 - 3) steer.z -= Math.sign(p.pos.z) * 0.8;
    steer.y = 0;
    steer.normalize();
    p.want.copy(steer).multiplyScalar(6.1 * diff.speed);
  }

  keeperAI(p, dt) {
    const b = this.ball, d = this.d, dir = dirOf(p.team);
    const gx = -dir * d.L / 2;
    if (b.owner === p) {
      p.want.set(0, 0, 0);
      p.holdT += dt;
      p.face = dir > 0 ? 0 : Math.PI;
      if (p.holdT > 1.2) {
        if (this.train) { p.holdT = -99; return; }
        const q = this.bestPassTarget(p, true);
        if (q) {
          const dq = new V3(q.pos.x - p.pos.x, 0, q.pos.z - p.pos.z).normalize();
          if (distXZ(q.pos, p.pos) > 22 || this.laneBlocked(p.pos, q.pos, p.team)) this.lob(p, dq, null, q);
          else this.pass(p, dq, null, q);
        } else this.lob(p, new V3(dir, 0, 0), null, null, false, new V3(gx + dir * 35 * d.s + dir * 5, 0, rand(-10, 10) * d.s));
      }
      return;
    }
    p.holdT = 0;
    let tx = gx + dir * 1.0;
    let tz = clamp(b.pos.z * 0.35, -d.goalW / 2 + 0.3, d.goalW / 2 - 0.3);
    let speed = 5.5;
    const relX = (b.pos.x - gx) * dir;
    const inBox = relX < d.boxD && Math.abs(b.pos.z) < d.boxW / 2;

    if (this.phase === 'play') {
      if (!b.owner && inBox && hs(b.vel) < 9 && b.pos.y < 1.6) {
        const opp = this.players.filter((o) => o.team !== p.team).reduce((m, o) => Math.min(m, distXZ(o.pos, b.pos)), 1e9);
        if (distXZ(p.pos, b.pos) < opp + 1.5) { tx = b.pos.x; tz = b.pos.z; speed = 7; }
      } else if (b.owner && b.owner.team !== p.team && inBox) {
        // Torwart wirft sich dem Stürmer entgegen
        const od = distXZ(p.pos, b.owner.pos);
        if (od < 1.7 && p.tackleCd <= 0) {
          p.tackleCd = 0.9;
          if (Math.random() < this.diff[p.team].save * 0.55) {
            b.owner.stun = 0.6; b.owner.fall = 0.6;
            this.gainBall(p);
            Sound.catchBall();
            return;
          }
        }
        const f = clamp(0.5 - relX / (d.boxD * 2.2), 0.15, 0.4);
        tx = gx + (b.pos.x - gx) * f;
        tz = b.pos.z * f;
        speed = 6.5;
      }
      if (!b.owner && relX < 32 && b.vel.x * dir < -4) {
        const tt = (p.pos.x - b.pos.x) / b.vel.x;
        if (tt > 0 && tt < 2.2) {
          const zc = b.pos.z + b.vel.z * tt;
          if (Math.abs(zc) < d.goalW / 2 + 1.5) {
            tz = clamp(zc, -d.goalW / 2 - 0.3, d.goalW / 2 + 0.3);
            tx = p.pos.x;
            speed = 8.5;
          }
        }
      }
    }
    if (p.pkTarget !== null) {
      tx = gx + dir * 0.4;
      if (this.phase === 'play') {
        if (p.pkDelay > 0) { p.pkDelay -= dt; tz = p.pos.z; } else { tz = p.pkTarget; speed = 8; }
      } else tz = 0;
    }
    this.arrive(p, new V3(tx, 0, tz), speed);
    if (!b.owner || b.owner !== p) p.face = angTo(p.pos, b.pos);
  }

  // ================= Bewegung & Ball =================
  movePlayers(dt) {
    const d = this.d;
    for (const p of this.players) {
      p.stun = Math.max(0, p.stun - dt);
      p.fall = Math.max(0, p.fall - dt);
      p.kickCd -= dt; p.tackleCd -= dt;
      if (p.jump > 0) p.jump -= dt;
      if (p.wall) { p.vel.set(0, 0, 0); continue; }
      const want = p.stun > 0 ? new V3() : p.want;
      const acc = 30 * dt;
      const dx = want.x - p.vel.x, dz = want.z - p.vel.z;
      const dl = Math.hypot(dx, dz);
      if (dl > acc) { p.vel.x += dx / dl * acc; p.vel.z += dz / dl * acc; } else { p.vel.x = want.x; p.vel.z = want.z; }
      p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
      p.pos.x = clamp(p.pos.x, -d.L / 2 - 3, d.L / 2 + 3);
      p.pos.z = clamp(p.pos.z, -d.W / 2 - 3, d.W / 2 + 3);
      const sp = hs(p.vel);
      const isTaker = this.phase === 'setpiece' && this.sp.taker === p;
      if (sp > 0.6 && !isTaker && p.stun <= 0) {
        const target = Math.atan2(p.vel.z, p.vel.x);
        const diffA = wrapAng(target - p.face);
        const rate = (this.ball.owner === p ? 9 : 12) * dt;
        p.face = wrapAng(p.face + clamp(diffA, -rate, rate));
      }
      p.anim += sp * dt * 1.7;
    }
    // Spieler schieben sich auseinander
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
        const dd = dx * dx + dz * dz;
        if (dd > 0.56 || dd < 1e-6) continue;
        const dist = Math.sqrt(dd);
        const push = (0.75 - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        const fixA = a.wall || (this.phase === 'setpiece' && this.sp.taker === a);
        const fixC = c.wall || (this.phase === 'setpiece' && this.sp.taker === c);
        if (!fixA) { a.pos.x -= nx * push * (fixC ? 2 : 1); a.pos.z -= nz * push * (fixC ? 2 : 1); }
        if (!fixC) { c.pos.x += nx * push * (fixA ? 2 : 1); c.pos.z += nz * push * (fixA ? 2 : 1); }
      }
    }
  }

  updateBall(dt) {
    const b = this.ball;
    if (this.phase === 'setpiece') { this.updateSetpiece(dt); return; }
    if (b.owner) {
      const p = b.owner;
      const f = faceVec(p);
      if (p.gk) {
        b.pos.set(p.pos.x + f.x * 0.4, 1.0, p.pos.z + f.z * 0.4);
      } else {
        const sp = hs(p.vel);
        const off = 0.5 + Math.min(0.35, sp * 0.04) + Math.sin(p.anim * 0.55) * 0.07 * Math.min(1, sp / 3);
        b.pos.set(p.pos.x + f.x * off, BR, p.pos.z + f.z * off);
      }
      b.vel.set(p.vel.x, 0, p.vel.z);
      this.contest(dt);
      return;
    }
    const speed = b.vel.length();
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.12));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      b.vel.y -= G * h;
      if (b.curveT > 0) b.curveT -= h;
      if (Math.abs(b.spin) > 0.01) {
        if (hs(b.vel) > 4) { b.vel.x += b.curveR.x * b.spin * h; b.vel.z += b.curveR.z * b.spin * h; }
        b.spin *= Math.exp(-0.9 * h);
      }
      const onGround = b.pos.y <= BR + 0.01 && Math.abs(b.vel.y) < 0.5;
      const k = onGround ? Math.exp(-0.8 * h) : Math.exp(-0.05 * h);
      b.vel.x *= k; b.vel.z *= k;
      if (onGround && hs(b.vel) < 0.25) { b.vel.x = 0; b.vel.z = 0; }
      b.pos.addScaledVector(b.vel, h);
      if (b.pos.y < BR) {
        b.pos.y = BR;
        if (b.vel.y < -1.3) {
          if (b.vel.y < -4) Sound.touch(clamp(-b.vel.y / 12, 0.1, 0.6));
          b.vel.y = -b.vel.y * 0.5; b.vel.x *= 0.9; b.vel.z *= 0.9;
        } else b.vel.y = 0;
      }
      this.collideGoals();
      this.collideWall();
    }
  }

  // Zweikampf ums Dribbling: Gegner direkt am Ball können ihn abluchsen
  contest(dt) {
    const b = this.ball, o = b.owner;
    if (!o || o.gk || this.phase !== 'play') return;
    for (const p of this.players) {
      if (p.team === o.team || p.stun > 0 || p.gk || p.wall) continue;
      if (distXZ(p.pos, b.pos) < 0.7) {
        const rate = p.human ? 1.6 : this.diff[p.team].steal;
        if (Math.random() < rate * dt) {
          o.stun = 0.45;
          this.gainBall(p);
          return;
        }
      }
    }
  }

  collideGoals() {
    const b = this.ball, d = this.d;
    const r = 0.06 + BR;
    for (const s of [-1, 1]) {
      const gx = s * d.L / 2;
      if (Math.abs(b.pos.x - gx) > 1.5 && !b.inGoal) continue;
      if (b.pos.y < d.goalH + r) {
        for (const t of [-1, 1]) {
          const pz = t * d.goalW / 2;
          const dx = b.pos.x - gx, dz = b.pos.z - pz;
          const dist = Math.hypot(dx, dz);
          if (dist < r && dist > 1e-4) {
            const nx = dx / dist, nz = dz / dist;
            const vn = b.vel.x * nx + b.vel.z * nz;
            if (vn < 0) {
              b.vel.x -= 1.7 * vn * nx; b.vel.z -= 1.7 * vn * nz;
              Sound.post();
              b.shot = false;
            }
            b.pos.x = gx + nx * r; b.pos.z = pz + nz * r;
          }
        }
      }
      if (Math.abs(b.pos.z) < d.goalW / 2) {
        const dx = b.pos.x - gx, dy = b.pos.y - d.goalH;
        const dist = Math.hypot(dx, dy);
        if (dist < r && dist > 1e-4) {
          const nx = dx / dist, ny = dy / dist;
          const vn = b.vel.x * nx + b.vel.y * ny;
          if (vn < 0) { b.vel.x -= 1.7 * vn * nx; b.vel.y -= 1.7 * vn * ny; Sound.post(); b.shot = false; }
          b.pos.x = gx + nx * r; b.pos.y = d.goalH + ny * r;
        }
      }
      // Netz hält den Ball fest
      if (b.inGoal && Math.sign(b.pos.x) === s) {
        const depth = Math.max(1.2, 2 * d.s);
        if (Math.abs(b.pos.x) > d.L / 2 + depth - BR) { b.pos.x = s * (d.L / 2 + depth - BR); b.vel.x *= -0.15; b.vel.z *= 0.5; }
        if (Math.abs(b.pos.z) > d.goalW / 2 - BR) { b.pos.z = Math.sign(b.pos.z) * (d.goalW / 2 - BR); b.vel.z *= -0.2; }
        if (b.pos.y > d.goalH - BR) { b.pos.y = d.goalH - BR; b.vel.y = Math.min(0, b.vel.y); }
      }
    }
  }

  collideWall() {
    const b = this.ball;
    for (const p of this.players) {
      if (!p.wall) continue;
      const jumpY = p.jump > 0 ? Math.sin(((0.55 - p.jump) / 0.55) * Math.PI) * 0.5 : 0;
      if (b.pos.y > 1.85 + jumpY || b.pos.y < jumpY) continue;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const r = 0.32 + BR;
      if (dist < r && dist > 1e-4) {
        const nx = dx / dist, nz = dz / dist;
        const vn = b.vel.x * nx + b.vel.z * nz;
        if (vn < 0) {
          b.vel.x -= 1.5 * vn * nx; b.vel.z -= 1.5 * vn * nz;
          b.vel.multiplyScalar(0.45); b.vel.y += 1.5;
          Sound.kick(0.3);
          b.shot = false; b.hitWall = true;
        }
        b.pos.x = p.pos.x + nx * r; b.pos.z = p.pos.z + nz * r;
      }
    }
  }

  checkPickups() {
    const b = this.ball, d = this.d;
    if (b.owner || this.phase !== 'play' || b.inGoal) return;
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.stun > 0 || p.kickCd > 0 || p.wall) continue;
      const dist = distXZ(p.pos, b.pos);
      if (p.gk) {
        const dir = dirOf(p.team);
        const relX = (b.pos.x - (-dir * d.L / 2)) * dir;
        const inBox = relX < d.boxD && relX > -1 && Math.abs(b.pos.z) < d.boxW / 2;
        const lat = hs(p.vel);
        const reach = 1.0 + (lat > 4 ? 1.0 : 0.35);
        if (!inBox || dist > reach || b.pos.y > 2.55) continue;
        const bs = hs(b.vel);
        if (b.lastTeam !== p.team && b.shot && bs > 8) {
          if (b.keeperTried) continue;
          b.keeperTried = true;
          let chance = this.diff[p.team].save * clamp(1.3 - bs / 34, 0.45, 1.1);
          if (dist < 0.8) chance += 0.18;
          if (dist > 1.4) chance -= 0.18;
          if (b.pos.y > 2.0) chance -= 0.12;
          chance = clamp(chance, 0.08, 0.95);
          if (Math.random() < chance) {
            if (bs > 23 && Math.random() < 0.45) {
              // abklatschen
              b.vel.x = -b.vel.x * 0.25 + dir * 2;
              b.vel.z = rand(-7, 7);
              b.vel.y = rand(1.5, 4);
              b.lastTouch = p; b.lastTeam = p.team; b.shot = false;
              p.kickCd = 0.5;
              Sound.catchBall();
              this.ui.banner('Pariert!', 900);
              Sound.ooh();
            } else {
              this.gainBall(p, true);
              Sound.catchBall();
              this.ui.banner('Gehalten!', 900);
              Sound.ooh();
            }
            return;
          }
          continue;
        }
        if (dist < bd) { bd = dist; best = p; }
        continue;
      }
      if (dist < 0.9 && b.pos.y < 1.4 && dist < bd) { bd = dist; best = p; }
    }
    if (best) {
      const bs = hs(b.vel);
      if (!best.gk && b.shot && b.lastTeam !== best.team && bs > 17 && Math.random() < 0.55) {
        b.vel.x *= -0.3; b.vel.z = b.vel.z * 0.3 + rand(-4, 4); b.vel.y = rand(1, 4);
        b.shot = false; best.kickCd = 0.3; b.lastTouch = best; b.lastTeam = best.team;
        Sound.kick(0.3);
      } else {
        if (best.gk) Sound.catchBall();
        this.gainBall(best);
      }
    }
  }

  // ================= Regeln =================
  checkRules() {
    const b = this.ball, d = this.d;
    if (this.phase !== 'play' || b.inGoal) return;
    if (Math.abs(b.pos.x) > d.L / 2 + BR) {
      const side = Math.sign(b.pos.x);
      if (Math.abs(b.pos.z) < d.goalW / 2 && b.pos.y < d.goalH) this.onGoal(side > 0 ? 0 : 1);
      else this.onGoalLineOut(side);
    } else if (Math.abs(b.pos.z) > d.W / 2 + BR) this.onSideOut();
  }

  onGoal(team) {
    const b = this.ball;
    b.inGoal = true;
    b.owner = null;
    b.vel.multiplyScalar(0.5);
    Sound.cheer(1);
    if (this.train) { this.trainResult('goal'); return; }
    Sound.whistle('short');
    this.score[team]++;
    this.phase = 'goal';
    this.goalT = 3.2;
    this.goalTeam = team;
    this.ui.banner(`TOR für ${TEAMS[team].name}!`, 2600, TEAMS[team].css);
  }

  onGoalLineOut(side) {
    const b = this.ball, d = this.d;
    if (this.train) { this.trainResult('out'); return; }
    Sound.whistle('short');
    const defending = side > 0 ? 1 : 0;
    const zs = Math.sign(b.pos.z) || 1;
    if (b.lastTeam === defending) {
      this.setSetpiece('corner', 1 - defending, new V3(side * (d.L / 2 - 0.3), BR, zs * (d.W / 2 - 0.3)), null, 'Eckball');
    } else {
      Sound.ooh();
      this.setSetpiece('goalkick', defending, new V3(side * (d.L / 2 - d.smallD * 0.9), BR, zs * d.smallW * 0.25), null, 'Abstoß');
    }
  }

  onSideOut() {
    const b = this.ball, d = this.d;
    if (this.train) { this.trainResult('out'); return; }
    Sound.whistle('short');
    const team = b.lastTeam === 0 ? 1 : 0;
    const x = clamp(b.pos.x, -d.L / 2 + 1, d.L / 2 - 1);
    this.setSetpiece('throwin', team, new V3(x, BR, Math.sign(b.pos.z) * (d.W / 2 - 0.3)), null, 'Einwurf');
  }

  // ================= Training =================
  setupTraining(type, wall) {
    const tr = this.train = {
      type, wall, shots: 0, goals: 0, res: null, resT: 0, kicked: false, kt: 0, t: 0,
      best: loadBest(type), aiChase: type === 'ecke', gates: [], mates: [], defs: [], walls: [],
    };
    const me = this.addPlayer(0, false, 0, 0);
    tr.me = me;
    this.setControl(this.humans[0], me);
    if (type !== 'dribbeln') tr.keeper = this.addPlayer(1, true, -0.48, 0);
    if (type === 'ecke') {
      for (let i = 0; i < 3; i++) tr.mates.push(this.addPlayer(0, false, 0, 0));
      for (let i = 0; i < 2; i++) tr.defs.push(this.addPlayer(1, false, 0, 0));
    }
    if (type === 'freistoss' && wall) {
      for (let i = 0; i < 5; i++) { const w = this.addPlayer(1, false, 0, 0); w.wall = true; tr.walls.push(w); }
    }
    if (type === 'dribbeln') {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const x = -32 + i * 8.5;
        const z = (i % 2 ? 1 : -1) * 6;
        tr.gates.push({ x, z, cones: [this.w.makeCone(x, z - 1.6), this.w.makeCone(x, z + 1.6)], done: false });
      }
      const fx = -32 + n * 8.5;
      tr.gates.push({ x: fx, z: 0, finish: true, cones: [this.w.makeCone(fx, -3), this.w.makeCone(fx, 3)], done: false });
    }
    this.trainReset();
  }

  trainReset() {
    const tr = this.train, d = this.d, b = this.ball, me = tr.me;
    const gx = d.L / 2;
    tr.kicked = false; tr.res = null; tr.t = 0; tr.kt = 0;
    b.inGoal = false; b.spin = 0; b.curveT = 0; b.shot = false; b.hitWall = false; b.intended = null;
    b.vel.set(0, 0, 0);
    for (const p of this.players) { p.vel.set(0, 0, 0); p.want.set(0, 0, 0); p.stun = 0; p.fall = 0; p.spot = null; p.pkTarget = null; p.kickCd = 0; }
    this.setControl(this.humans[0], me);
    if (tr.keeper) { tr.keeper.pos.set(gx - 1, 0, 0); tr.keeper.face = Math.PI; }
    switch (tr.type) {
      case 'schuss': {
        me.pos.set(gx - rand(17, 27), 0, rand(-13, 13));
        me.face = angTo(me.pos, new V3(gx, 0, 0));
        this.phase = 'play';
        b.pos.copy(me.pos);
        this.gainBall(me, true);
        break;
      }
      case 'elfmeter': {
        tr.keeper.pkTarget = 0;
        tr.keeper.pos.set(gx - 0.4, 0, 0);
        me.pos.set(gx - d.spot - 2, 0, 0);
        this.setSetpiece('penalty', 0, new V3(gx - d.spot, BR, 0), me);
        break;
      }
      case 'freistoss': {
        const dist = rand(18, 30), ang = rand(-0.7, 0.7);
        const pos = new V3(gx - Math.cos(ang) * dist, BR, Math.sin(ang) * dist);
        me.pos.copy(pos);
        this.setSetpiece('freekick', 0, pos, me);
        if (tr.wall) {
          const n = dist < 22 ? 5 : dist < 26 ? 4 : 3;
          const toGoal = new V3(gx - pos.x, 0, -pos.z).normalize();
          const perp = new V3(-toGoal.z, 0, toGoal.x);
          const nearSide = Math.sign(pos.z) || 1;
          const c = pos.clone().addScaledVector(toGoal, d.circle);
          c.addScaledVector(perp, 0.45 * nearSide * Math.sign(perp.z || 1));
          tr.walls.forEach((w, i) => {
            if (i >= n) { w.pos.set(gx + 30, 0, d.W); w.mesh.group.visible = false; return; }
            w.mesh.group.visible = true;
            w.pos.copy(c).addScaledVector(perp, (i - (n - 1) / 2) * 0.62);
            w.pos.y = 0;
            w.face = angTo(w.pos, pos);
          });
        }
        break;
      }
      case 'ecke': {
        const zs = Math.random() < 0.5 ? -1 : 1;
        const pos = new V3(gx - 0.3, BR, zs * (d.W / 2 - 0.3));
        me.pos.copy(pos);
        tr.mates.forEach((m, i) => {
          m.spot = new V3(gx - rand(6, 13), 0, (i - 1) * 4.5 + rand(-1.5, 1.5));
          m.pos.copy(m.spot).add(new V3(-rand(3, 6), 0, rand(-2, 2)));
        });
        tr.defs.forEach((p, i) => {
          const m = tr.mates[i];
          p.spot = m.spot.clone().add(new V3(1.3, 0, -zs * 0.6));
          p.pos.copy(p.spot);
        });
        this.setSetpiece('corner', 0, pos, me);
        break;
      }
      case 'dribbeln': {
        me.pos.set(-40, 0, 0);
        me.face = 0;
        this.phase = 'play';
        b.pos.copy(me.pos);
        this.gainBall(me, true);
        tr.gate = 0; tr.time = 0; tr.running = false; tr.pen = 0; tr.prevX = me.pos.x;
        for (const g of tr.gates) { g.done = false; for (const c of g.cones) c.material = this.w.mat.cone; }
        break;
      }
    }
  }

  trainResult(kind) {
    const tr = this.train;
    if (tr.res) return;
    tr.res = kind; tr.resT = 1.9;
    if (tr.type === 'dribbeln') return;
    tr.shots++;
    const b = this.ball;
    let label = 'Vorbei!';
    if (kind === 'goal') { tr.goals++; label = 'TOR!'; }
    else if (kind === 'saved') label = 'Gehalten!';
    else if (kind === 'cleared') label = 'Abgewehrt!';
    else if (kind === 'out') label = b.hitWall ? 'Abgefälscht – daneben!' : 'Daneben!';
    else if (b.hitWall) label = 'In die Mauer!';
    if (kind !== 'goal') { Sound.ooh(); if (kind !== 'saved') this.ui.banner(label, 1500); }
    else this.ui.banner(label, 1500, TEAMS[0].css);
  }

  updateTraining(dt) {
    const tr = this.train, b = this.ball, me = tr.me;
    tr.t += dt;
    if (tr.res) {
      tr.resT -= dt;
      if (tr.resT <= 0) this.trainReset();
      return;
    }
    if (tr.type === 'dribbeln') { this.updateDribble(dt); return; }
    if (tr.keeper && b.owner === tr.keeper) { this.trainResult('saved'); return; }
    if (tr.defs.includes(b.owner)) {
      const p = b.owner;
      this.lob(p, new V3(-1, 0, 0), null, null, false, p.pos.clone().add(new V3(-25, 0, rand(-8, 8))));
      this.trainResult('cleared');
      return;
    }
    if (!tr.kicked) return;
    tr.kt += dt;
    if (tr.type === 'schuss' && b.owner === me) { tr.kicked = false; return; }
    if (tr.type === 'ecke' && b.owner && b.owner.team === 0) { tr.kt = Math.min(tr.kt, 3); }
    if (!b.owner && hs(b.vel) < 0.6 && b.pos.y < 0.3 && tr.kt > 1) { this.trainResult('stopped'); return; }
    if (!b.owner && tr.kt > 1.3 && (b.hitWall || (tr.type !== 'ecke' && b.vel.x < -0.5))) { this.trainResult('stopped'); return; }
    if (tr.kt > (tr.type === 'ecke' ? 9 : 6)) this.trainResult('stopped');
  }

  updateDribble(dt) {
    const tr = this.train, me = tr.me, b = this.ball;
    if (!tr.running && hs(me.vel) > 0.5) tr.running = true;
    if (tr.running) tr.time += dt;
    const g = tr.gates[tr.gate];
    if (g && tr.prevX < g.x && me.pos.x >= g.x) {
      const ok = Math.abs(me.pos.z - g.z) < (g.finish ? 3 : 1.6);
      if (g.finish) {
        if (b.owner !== me) {
          // Ziel nur mit Ball
          me.pos.x = g.x - 0.01;
        } else {
          const total = tr.time + tr.pen;
          Sound.whistle('short');
          let txt = `Ziel! ${total.toFixed(1)} s`;
          if (!tr.best || total < tr.best) { tr.best = total; saveBest('dribbeln', total); txt += ' – neue Bestzeit!'; Sound.cheer(0.6); }
          this.ui.banner(txt, 2600, TEAMS[0].css);
          tr.res = 'finish'; tr.resT = 3;
          tr.last = total;
        }
      } else {
        g.done = true;
        for (const c of g.cones) c.material = ok ? this.w.mat.coneDone : this.w.mat.coneMiss;
        if (ok) Sound.click(); else { tr.pen += 3; this.ui.banner('Tor verpasst: +3 s', 1000); Sound.ooh(); }
        tr.gate++;
      }
    }
    // Hütchen berühren kostet 1 Sekunde
    for (const gg of tr.gates) for (const c of gg.cones) {
      if (c.userData.hit) continue;
      if (Math.hypot(me.pos.x - c.position.x, me.pos.z - c.position.z) < 0.45) {
        c.userData.hit = true; tr.pen += 1; Sound.touch(0.5);
        setTimeout(() => { c.userData.hit = false; }, 1500);
      }
    }
    tr.prevX = me.pos.x;
    // Ball verloren und weit weg -> zurücklegen
    if (!b.owner && distXZ(b.pos, me.pos) > 12) { b.pos.set(me.pos.x + 1, BR, me.pos.z); b.vel.set(0, 0, 0); }
  }

  // ================= Kamera =================
  topHeight() {
    const d = this.d;
    const tanv = Math.tan((this.w.camera.fov * Math.PI) / 360);
    const aspect = this.w.camera.aspect;
    return Math.max((d.W + 8) / 2 / tanv, (d.L + 8) / 2 / (tanv * aspect)) * 0.98;
  }

  updateCamera(dt, snap = false) {
    const c = this.cam, d = this.d, b = this.ball, cfg = this.cfg;
    let wantTop = false;
    if (!this.train) {
      if (this.phase === 'setpiece' && (this.sp.type === 'goalkick' || this.sp.type === 'kickoff')) wantTop = true;
      if (this.topHold > 0) { this.topHold -= dt; wantTop = true; }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 2.4);
    c.top += ((wantTop ? 1 : 0) - c.top) * k;
    const fo = b.owner ? b.owner.pos : b.pos;
    const kf = snap ? 1 : 1 - Math.exp(-dt * 5);
    c.focus.x += (fo.x - c.focus.x) * kf;
    c.focus.z += (fo.z - c.focus.z) * kf;

    let dir = 1;
    if (this.train) dir = 1;
    else if (cfg.camera === 'team') dir = this.humans.length ? dirOf(this.humans[0].team) : 1;
    else {
      let t = b.owner ? b.owner.team : (b.lastTeam >= 0 ? b.lastTeam : 0);
      if (this.phase === 'setpiece') t = this.sp.team;
      dir = dirOf(t);
    }
    let targetYaw = dir > 0 ? Math.PI : 0;
    // Bei Standards (Ecke, Freistoß, Einwurf …) steht die Kamera hinter der Schussrichtung
    if (this.phase === 'setpiece' && this.sp.taker && (cfg.camera === 'carrier' || this.train) &&
        this.sp.type !== 'kickoff' && this.sp.type !== 'goalkick') targetYaw = this.sp.taker.face + Math.PI;
    const ky = snap ? 1 : 1 - Math.exp(-dt * 2.0);
    c.yaw = wrapAng(c.yaw + wrapAng(targetYaw - c.yaw) * ky);

    let pos, tgt;
    if (cfg.camera === 'tv' && !this.train) {
      pos = new V3(c.focus.x * 0.85, 21 + d.s * 6, d.W / 2 + 18 + d.s * 10);
      tgt = new V3(c.focus.x * 0.92, 0, c.focus.z * 0.45);
    } else {
      // bei Standards näher über die Schulter, damit die Kamera nicht in die Tribüne fährt
      const near = this.phase === 'setpiece' && this.sp.type !== 'kickoff' && this.sp.type !== 'goalkick' ? 1 : 0;
      c.near = (c.near || 0) + (near - (c.near || 0)) * (snap ? 1 : 1 - Math.exp(-dt * 3));
      const dist = 12.5 - 6 * c.near, hgt = 7.2 - 2 * c.near, look = 7 + 5 * c.near;
      const cx = Math.cos(c.yaw), cz = Math.sin(c.yaw);
      pos = new V3(c.focus.x + cx * dist, hgt, c.focus.z + cz * dist);
      tgt = new V3(c.focus.x - cx * look, 0.5, c.focus.z - cz * look);
    }
    // nicht in die Tribüne fahren
    const cx0 = clamp(pos.x, -d.L / 2 - 3, d.L / 2 + 3);
    const cz0 = clamp(pos.z, -d.W / 2 - 3, d.W / 2 + 3);
    pos.x = cx0; pos.z = cz0;
    if (c.top > 0.001) {
      const H = this.topHeight();
      const s = c.top * c.top * (3 - 2 * c.top);
      pos.lerp(new V3(0, H, H * 0.28), s);
      tgt.lerp(new V3(0, 0, 0), s);
    }
    this.w.camera.position.copy(pos);
    this.w.camera.lookAt(tgt);
    const f = new V3(tgt.x - pos.x, 0, tgt.z - pos.z);
    if (f.lengthSq() > 1e-6) {
      f.normalize();
      this.camFwd.copy(f);
      this.camRight.set(-f.z, 0, f.x);
    }
  }

  // ================= Darstellung =================
  syncMeshes(dt) {
    const b = this.ball;
    for (const p of this.players) {
      const m = p.mesh;
      const jumpY = p.jump > 0 ? Math.sin(((0.55 - p.jump) / 0.55) * Math.PI) * 0.5 : 0;
      m.group.position.set(p.pos.x, jumpY, p.pos.z);
      m.group.rotation.y = -p.face;
      const sp = hs(p.vel);
      const sw = Math.sin(p.anim) * Math.min(0.9, sp * 0.13);
      m.legs[0].rotation.z = sw; m.legs[1].rotation.z = -sw;
      m.arms[0].rotation.z = -sw * 0.8; m.arms[1].rotation.z = sw * 0.8;
      let tiltX = 0, tiltZ = 0;
      if (p.gk) {
        const lat = hs(p.vel);
        if (lat > 4.5) {
          const right = new V3(-Math.sin(p.face), 0, Math.cos(p.face));
          const sgn = Math.sign(p.vel.x * right.x + p.vel.z * right.z);
          tiltX = sgn * clamp((lat - 4.5) / 3, 0, 1) * 1.0;
        }
        const up = b.owner === p;
        m.arms[0].rotation.x = up ? 0 : -0.3; m.arms[1].rotation.x = up ? 0 : 0.3;
        if (up) { m.arms[0].rotation.z = 1.3; m.arms[1].rotation.z = 1.3; }
      }
      if (p.wall) { m.arms[0].rotation.z = 0.3; m.arms[1].rotation.z = 0.3; }
      if (p.fall > 0) tiltZ = -Math.min(1, p.fall * 2.5) * 1.2;
      m.body.rotation.x = tiltX;
      m.body.rotation.z = tiltZ;
      if (this.phase === 'setpiece' && this.sp.taker === p && this.sp.type === 'throwin') {
        m.arms[0].rotation.z = Math.PI; m.arms[1].rotation.z = Math.PI;
      }
    }
    // Ball
    const bm = b.mesh;
    bm.parent.position.copy(b.pos);
    bm.parent.position.y = b.pos.y - BR + BALL_VIS_R;
    const v = hs(b.vel);
    if (v > 0.05) {
      const axis = new V3(b.vel.z, 0, -b.vel.x).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (v * dt) / BALL_VIS_R);
      bm.quaternion.premultiply(q);
    }
    b.shadow.position.set(b.pos.x, 0.025, b.pos.z);
    const sc = 0.45 * clamp(1 - b.pos.y / 8, 0.3, 1);
    b.shadow.scale.setScalar(sc);

    this.humans.forEach((h, i) => {
      const mk = this.markers[i];
      if (!h.p) { mk.group.visible = false; return; }
      mk.group.visible = true;
      mk.group.position.set(h.p.pos.x, 0, h.p.pos.z);
      mk.arrow.position.y = 2.4 + Math.sin(this.clock * 5) * 0.08;
      this.ui.setPower(i, h.charge);
    });

    const sp = this.sp;
    if (this.phase === 'setpiece' && sp.taker && sp.taker.human) {
      this.aimArrow.visible = true;
      this.aimArrow.position.set(sp.pos.x, 0, sp.pos.z);
      this.aimArrow.rotation.y = -sp.taker.face;
    } else this.aimArrow.visible = false;
  }

  // ================= Hauptschleife =================
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    if (this.cornerT > 0) this.cornerT -= dt;

    if (this.phase === 'goal') {
      this.goalT -= dt;
      if (this.goalT <= 0) {
        if (this.time <= 0) this.endMatch();
        else { this.kickoff(1 - this.goalTeam); Sound.whistle('short'); }
      }
    }
    if (!this.train && (this.phase === 'play' || this.phase === 'setpiece')) {
      this.time -= dt;
      if (this.time <= 0 && this.phase === 'play') this.endMatch();
    }

    this.updateHumans(dt);
    this.updateAI(dt);
    this.movePlayers(dt);
    this.updateBall(dt);
    this.checkPickups();
    this.checkRules();
    if (this.train) this.updateTraining(dt);
    this.updateCamera(dt);
    this.syncMeshes(dt);
    this.ui.update(this);
  }

  endMatch() {
    if (this.phase === 'over') return;
    this.time = 0;
    this.phase = 'over';
    Sound.whistle('end');
    this.ui.showEnd(this);
  }
}

function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new V3(v.x * c - v.z * s, 0, v.x * s + v.z * c);
}

function loadBest(type) {
  try { const v = parseFloat(localStorage.getItem('bolzplatz-best-' + type)); return isFinite(v) ? v : null; } catch (e) { return null; }
}
function saveBest(type, v) {
  try { localStorage.setItem('bolzplatz-best-' + type, String(v)); } catch (e) { /* egal */ }
}
