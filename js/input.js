// Eingabe: Tastatur, Touch-Buttons und Gamecontroller werden zu einem einheitlichen
// "Controller" pro Spieler zusammengeführt.

export const KEYMAPS = {
  // Allein-Modus: Pfeiltasten + linke Hand auf A S D Q E
  single: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    shoot: ['KeyD', 'Space'], pass: ['KeyS'], lob: ['KeyA'], sw: ['KeyQ'],
    sprint: ['KeyE', 'ShiftLeft', 'ShiftRight'],
  },
  // 2 Spieler an einer Tastatur
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    shoot: ['KeyF'], pass: ['KeyG'], lob: ['KeyT'], sw: ['KeyV'], sprint: ['ShiftLeft'],
  },
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    shoot: ['KeyK'], pass: ['KeyL'], lob: ['KeyO'], sw: ['KeyM'], sprint: ['ShiftRight'],
  },
};

const ACTIONS = ['shoot', 'pass', 'lob', 'sw', 'sprint'];

function emptyCtrl() {
  return {
    mx: 0, my: 0, sprint: false,
    shootHeld: false, shootPressed: false, shootReleased: false,
    passPressed: false, lobPressed: false, swPressed: false,
  };
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set();       // in diesem Frame gedrückt (auch wenn schon wieder losgelassen)
    this.mode = 'single';
    this.ctrl = [emptyCtrl(), emptyCtrl()];
    this.prev = [{}, {}];
    this.touchState = [this.emptyTouch(), this.emptyTouch()];
    this.touchTaps = [new Set(), new Set()];
    this.lastDevice = (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) ? 'touch' : 'keyboard';
    this.onGlobalKey = null;
    this.onDeviceChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.tapped.add(e.code);
        if (this.onGlobalKey) this.onGlobalKey(e.code);
      }
      this.keys.add(e.code);
      this.setDevice('keyboard');
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    window.addEventListener('touchstart', () => this.setDevice('touch'), { passive: true });
  }

  emptyTouch() { return { mx: 0, my: 0, shoot: false, pass: false, lob: false, sw: false, sprint: false }; }

  setDevice(d) {
    if (this.lastDevice !== d) {
      this.lastDevice = d;
      if (this.onDeviceChange) this.onDeviceChange(d);
    }
  }

  setMode(m) { this.mode = m; }

  touchTap(i, action) { this.touchTaps[i].add(action); }

  readKeyboard(map) {
    const k = this.keys;
    const any = (codes) => codes.some((c) => k.has(c));
    const tap = (codes) => codes.some((c) => this.tapped.has(c));
    const r = {
      mx: (any(map.right) ? 1 : 0) - (any(map.left) ? 1 : 0),
      my: (any(map.up) ? 1 : 0) - (any(map.down) ? 1 : 0),
    };
    for (const a of ACTIONS) { r[a] = any(map[a]); r[a + 'Tap'] = tap(map[a]); }
    return r;
  }

  readGamepad(index) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const list = [];
    for (const p of pads) if (p && p.connected) list.push(p);
    const gp = list[index];
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    let mx = dz(gp.axes[0] || 0);
    let my = -dz(gp.axes[1] || 0);
    if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) my = 1; if (b(13)) my = -1;
    const r = {
      mx, my,
      pass: b(0), shoot: b(1), lob: b(2), sw: b(3) || b(4), sprint: b(5) || b(7) || b(6),
      start: b(9),
    };
    if (mx || my || r.pass || r.shoot || r.lob || r.sw) this.setDevice('gamepad');
    return r;
  }

  update() {
    const two = this.mode === 'two';
    for (let i = 0; i < 2; i++) {
      const src = [];
      if (two) src.push(this.readKeyboard(i === 0 ? KEYMAPS.p1 : KEYMAPS.p2));
      else if (i === 0) src.push(this.readKeyboard(KEYMAPS.single));
      const gp = this.readGamepad(two ? i : (i === 0 ? 0 : 99));
      if (gp) src.push(gp);
      const t = this.touchState[i];
      const tt = this.touchTaps[i];
      src.push({
        mx: t.mx, my: t.my, sprint: t.sprint,
        shoot: t.shoot, pass: t.pass, lob: t.lob, sw: t.sw,
        shootTap: tt.has('shoot'), passTap: tt.has('pass'), lobTap: tt.has('lob'), swTap: tt.has('sw'),
      });

      let mx = 0, my = 0;
      const held = {}; const tap = {};
      for (const s of src) {
        mx += s.mx || 0; my += s.my || 0;
        for (const a of ACTIONS) {
          held[a] = held[a] || !!s[a];
          tap[a] = tap[a] || !!s[a + 'Tap'];
        }
      }
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }

      const prev = this.prev[i];
      const c = this.ctrl[i];
      c.mx = mx; c.my = my;
      c.sprint = held.sprint;
      c.shootHeld = held.shoot;
      c.shootPressed = (held.shoot && !prev.shoot) || tap.shoot;
      c.shootReleased = (!held.shoot && (prev.shoot || tap.shoot));
      c.passPressed = (held.pass && !prev.pass) || tap.pass;
      c.lobPressed = (held.lob && !prev.lob) || tap.lob;
      c.swPressed = (held.sw && !prev.sw) || tap.sw;
      this.prev[i] = held;
      tt.clear();
    }
    this.tapped.clear();
  }
}

// ---------- Touch-Steuerung (virtueller Joystick + Buttons) ----------
export class TouchPad {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.sticks = [];
  }

  build(players) {
    this.root.innerHTML = '';
    this.root.className = players === 2 ? 'two' : 'one';
    this.sticks = [];
    for (let i = 0; i < players; i++) {
      const side = players === 2 ? (i === 0 ? 'left' : 'right') : 'single';
      const pad = document.createElement('div');
      pad.className = `pad pad-${side} pad-p${i + 1}`;
      pad.innerHTML = `
        <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
        <div class="btns">
          <button class="tbtn b-shoot" data-a="shoot">Schuss</button>
          <button class="tbtn b-pass" data-a="pass">Pass</button>
          <button class="tbtn b-lob" data-a="lob">Flanke</button>
          <button class="tbtn b-sw" data-a="sw">Wechsel</button>
          ${players === 1 ? '<button class="tbtn b-sprint" data-a="sprint">Sprint</button>' : ''}
        </div>`;
      this.root.appendChild(pad);
      this.bindStick(i, pad.querySelector('.stick-zone'), pad.querySelector('.stick-base'), pad.querySelector('.stick-knob'), players === 2);
      pad.querySelectorAll('.tbtn').forEach((b) => this.bindButton(i, b));
    }
  }

  bindStick(i, zone, base, knob, autoSprint) {
    const st = this.input.touchState[i];
    let id = null, ox = 0, oy = 0;
    const R = 55;
    const reset = () => {
      id = null; st.mx = 0; st.my = 0; if (autoSprint) st.sprint = false;
      knob.style.transform = 'translate(-50%,-50%)';
      base.classList.remove('active');
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      base.style.left = (ox - r.left) + 'px';
      base.style.top = (oy - r.top) + 'px';
      base.classList.add('active');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      st.mx = dx / R; st.my = -dy / R;
      if (autoSprint) st.sprint = len > R * 0.95;
    });
    const end = (e) => { if (e.pointerId === id) reset(); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  bindButton(i, btn) {
    const st = this.input.touchState[i];
    const a = btn.dataset.a;
    const down = (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      st[a] = true;
      this.input.touchTap(i, a);
      btn.classList.add('down');
    };
    const up = () => { st[a] = false; btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    for (const st of this.input.touchState) Object.assign(st, this.input.emptyTouch());
  }
}
