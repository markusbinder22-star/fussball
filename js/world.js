// 3D-Darstellung: Spielfeld, Tore, Tribünen, Spieler- und Ballmodelle.
import * as THREE from '../vendor/three.module.min.js';

export const BALL_VIS_R = 0.17; // leicht vergrößert, damit der Ball gut sichtbar ist

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ec5ea);
    this.scene.fog = new THREE.Fog(0x8ec5ea, 160, 420);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 700);
    this.camera.position.set(0, 60, 40);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a6b35, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-40, 80, 30);
    this.scene.add(sun);

    this.dyn = new THREE.Group();
    this.scene.add(this.dyn);

    this.geo = {
      leg: new THREE.BoxGeometry(0.15, 0.62, 0.15).translate(0, -0.31, 0),
      arm: new THREE.BoxGeometry(0.11, 0.55, 0.11).translate(0, -0.27, 0),
      shorts: new THREE.CylinderGeometry(0.27, 0.27, 0.3, 10),
      torso: new THREE.CylinderGeometry(0.25, 0.3, 0.62, 10),
      head: new THREE.SphereGeometry(0.16, 12, 10),
      hair: new THREE.SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
      shadow: new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2),
      ball: new THREE.SphereGeometry(BALL_VIS_R, 18, 14),
      cone: new THREE.ConeGeometry(0.22, 0.55, 12).translate(0, 0.275, 0),
    };
    this.mat = {
      skin: new THREE.MeshLambertMaterial({ color: 0xe0ac7e }),
      hair: new THREE.MeshLambertMaterial({ color: 0x3b2a1e }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
      cone: new THREE.MeshLambertMaterial({ color: 0xff7a1a }),
      coneDone: new THREE.MeshLambertMaterial({ color: 0x31c75a }),
      coneMiss: new THREE.MeshLambertMaterial({ color: 0xd33 }),
      white: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    };
    this.teamMats = new Map();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const c of [...this.dyn.children]) {
      this.dyn.remove(c);
      c.traverse((o) => {
        if (o.userData.disposeGeo && o.geometry) o.geometry.dispose();
        if (o.userData.disposeMat && o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
  }

  matFor(color) {
    if (!this.teamMats.has(color)) this.teamMats.set(color, new THREE.MeshLambertMaterial({ color }));
    return this.teamMats.get(color);
  }

  // ---------- Spielfeld ----------
  buildPitch(d) {
    const margin = 6;
    const TW = d.L + margin * 2, TH = d.W + margin * 2;
    const ppm = Math.min(18, 2048 / TW);
    const cv = document.createElement('canvas');
    cv.width = Math.round(TW * ppm); cv.height = Math.round(TH * ppm);
    const g = cv.getContext('2d');
    const X = (x) => (x + TW / 2) * ppm;
    const Y = (z) => (z + TH / 2) * ppm;

    // Rasenstreifen
    const stripes = 14;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#3d9a3f' : '#368c39';
      const x0 = X(-d.L / 2 + (d.L / stripes) * i);
      g.fillRect(x0, 0, (d.L / stripes) * ppm + 1, cv.height);
    }
    g.fillStyle = '#33853a';
    g.fillRect(0, 0, X(-d.L / 2), cv.height);
    g.fillRect(X(d.L / 2), 0, cv.width, cv.height);

    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.lineWidth = Math.max(2, 0.13 * ppm);
    const rect = (x, z, w, h) => g.strokeRect(X(x), Y(z), w * ppm, h * ppm);
    const circle = (x, z, r, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(X(x), Y(z), r * ppm, a0, a1); g.stroke(); };
    const dot = (x, z) => { g.beginPath(); g.arc(X(x), Y(z), 0.25 * ppm, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); };

    rect(-d.L / 2, -d.W / 2, d.L, d.W);
    g.beginPath(); g.moveTo(X(0), Y(-d.W / 2)); g.lineTo(X(0), Y(d.W / 2)); g.stroke();
    circle(0, 0, d.circle); dot(0, 0);
    for (const s of [-1, 1]) {
      const gx = s * d.L / 2;
      const bx = s > 0 ? gx - d.boxD : gx;
      rect(bx, -d.boxW / 2, d.boxD, d.boxW);
      const sx = s > 0 ? gx - d.smallD : gx;
      rect(sx, -d.smallW / 2, d.smallD, d.smallW);
      const spotX = gx - s * d.spot;
      dot(spotX, 0);
      // Strafraumbogen
      const ang = Math.acos(Math.min(1, (d.boxD - d.spot) / d.circle));
      if (s > 0) circle(spotX, 0, d.circle, Math.PI - ang, Math.PI + ang);
      else circle(spotX, 0, d.circle, -ang, ang);
      // Eckfahnen-Viertelkreise
      for (const t of [-1, 1]) {
        const cz = t * d.W / 2;
        const a0 = s > 0 ? (t > 0 ? Math.PI : Math.PI / 2) : (t > 0 ? -Math.PI / 2 : 0);
        circle(gx, cz, 1 * d.s, a0 + (s > 0 && t < 0 ? 0 : 0), a0 + Math.PI / 2);
      }
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: tex }));
    pitch.userData.disposeGeo = true; pitch.userData.disposeMat = true;
    this.dyn.add(pitch);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x2f6e33 }));
    ground.position.y = -0.02;
    ground.userData.disposeGeo = true; ground.userData.disposeMat = true;
    this.dyn.add(ground);

    for (const s of [-1, 1]) this.buildGoal(d, s);
    this.buildStands(d, margin);
    this.buildFlags(d);
  }

  buildGoal(d, s) {
    const grp = new THREE.Group();
    const r = 0.06;
    const depth = Math.max(1.2, 2 * d.s);
    const postGeo = new THREE.CylinderGeometry(r, r, d.goalH, 10);
    for (const t of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, this.mat.white);
      post.position.set(s * d.L / 2, d.goalH / 2, t * d.goalW / 2);
      grp.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.goalW + r * 2, 10).rotateX(Math.PI / 2), this.mat.white);
    bar.position.set(s * d.L / 2, d.goalH, 0);
    grp.add(bar);

    // Netz als transparente Gitter-Textur
    const nc = document.createElement('canvas');
    nc.width = nc.height = 64;
    const ng = nc.getContext('2d');
    ng.strokeStyle = 'rgba(255,255,255,0.85)';
    ng.lineWidth = 3;
    ng.strokeRect(0, 0, 64, 64);
    const netTex = new THREE.CanvasTexture(nc);
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    const mk = (w, h) => {
      const t = netTex.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 0.25, h / 0.25);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.userData.disposeGeo = true; m.userData.disposeMat = true;
      return m;
    };
    const back = mk(d.goalW, d.goalH);
    back.rotation.y = Math.PI / 2;
    back.position.set(s * (d.L / 2 + depth), d.goalH / 2, 0);
    grp.add(back);
    const top = mk(depth, d.goalW);
    top.rotation.x = -Math.PI / 2;
    top.position.set(s * (d.L / 2 + depth / 2), d.goalH, 0);
    grp.add(top);
    for (const t of [-1, 1]) {
      const side = mk(depth, d.goalH);
      side.position.set(s * (d.L / 2 + depth / 2), d.goalH / 2, t * d.goalW / 2);
      grp.add(side);
    }
    postGeo.userData = {};
    this.dyn.add(grp);
  }

  buildStands(d, margin) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#4a4f5a'; g.fillRect(0, 0, 256, 64);
    const cols = ['#e63946', '#f1faee', '#1d3557', '#ffb703', '#2a9d8f', '#e76f51', '#8ecae6', '#ffffff'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * 256, Math.random() * 64, 2, 3);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const off = margin + 4;
    const sides = [
      { len: d.L + off * 2 + 20, x: 0, z: -(d.W / 2 + off), rot: 0 },
      { len: d.L + off * 2 + 20, x: 0, z: d.W / 2 + off, rot: Math.PI },
      { len: d.W + off * 2, x: -(d.L / 2 + off), z: 0, rot: -Math.PI / 2 },
      { len: d.W + off * 2, x: d.L / 2 + off, z: 0, rot: Math.PI / 2 },
    ];
    for (const sd of sides) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(sd.len / 20, 2);
      const stand = new THREE.Mesh(new THREE.PlaneGeometry(sd.len, 16),
        new THREE.MeshLambertMaterial({ map: t }));
      stand.userData.disposeGeo = true; stand.userData.disposeMat = true;
      const grp = new THREE.Group();
      stand.rotation.x = -Math.PI / 4.2;
      stand.position.set(0, 6, -5.5);
      grp.add(stand);
      // Bande
      const board = new THREE.Mesh(new THREE.BoxGeometry(sd.len, 1, 0.2),
        new THREE.MeshLambertMaterial({ color: 0x1b2a49 }));
      board.userData.disposeGeo = true; board.userData.disposeMat = true;
      board.position.set(0, 0.5, 0);
      grp.add(board);
      grp.position.set(sd.x, 0, sd.z);
      grp.rotation.y = sd.rot;
      this.dyn.add(grp);
    }
  }

  buildFlags(d) {
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6).translate(0, 0.75, 0);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffd400, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, this.mat.white);
      pole.position.set(sx * d.L / 2, 0, sz * d.W / 2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), flagMat);
      flag.position.set(0.2, 1.35, 0);
      flag.userData.disposeGeo = true;
      pole.add(flag);
      this.dyn.add(pole);
    }
  }

  // ---------- Figuren ----------
  makePlayer(shirt, shorts, socks) {
    const grp = new THREE.Group();
    grp.rotation.order = 'YXZ';
    const body = new THREE.Group();
    grp.add(body);
    const legs = [];
    for (const z of [-0.12, 0.12]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.7, z);
      hip.add(new THREE.Mesh(this.geo.leg, this.matFor(socks)));
      body.add(hip);
      legs.push(hip);
    }
    const sh = new THREE.Mesh(this.geo.shorts, this.matFor(shorts));
    sh.position.y = 0.82;
    body.add(sh);
    const torso = new THREE.Mesh(this.geo.torso, this.matFor(shirt));
    torso.position.y = 1.27;
    body.add(torso);
    const arms = [];
    for (const z of [-0.34, 0.34]) {
      const sho = new THREE.Group();
      sho.position.set(0, 1.52, z);
      sho.add(new THREE.Mesh(this.geo.arm, this.matFor(shirt)));
      body.add(sho);
      arms.push(sho);
    }
    const head = new THREE.Mesh(this.geo.head, this.mat.skin);
    head.position.y = 1.74;
    body.add(head);
    const hair = new THREE.Mesh(this.geo.hair, this.mat.hair);
    hair.position.y = 1.76;
    body.add(hair);
    const shadow = new THREE.Mesh(this.geo.shadow, this.mat.shadow);
    shadow.position.y = 0.02;
    grp.add(shadow);
    this.dyn.add(grp);
    return { group: grp, body, legs, arms, shadow };
  }

  makeBall() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#111';
    const spots = [[32, 20], [96, 20], [160, 20], [224, 20], [0, 64], [64, 64], [128, 64], [192, 64], [256, 64], [32, 108], [96, 108], [160, 108], [224, 108]];
    for (const [x, y] of spots) {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 11);
      }
      g.closePath(); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(this.geo.ball, new THREE.MeshLambertMaterial({ map: tex }));
    ball.userData.disposeMat = true;
    const shadow = new THREE.Mesh(this.geo.shadow, this.mat.shadow);
    shadow.scale.setScalar(0.45);
    const grp = new THREE.Group();
    grp.add(ball);
    this.dyn.add(grp);
    this.dyn.add(shadow);
    return { mesh: ball, shadow };
  }

  makeMarker(color) {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.03;
    ring.userData.disposeGeo = true; ring.userData.disposeMat = true;
    grp.add(ring);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 10).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color }));
    arrow.position.y = 2.35;
    arrow.userData.disposeGeo = true; arrow.userData.disposeMat = true;
    grp.add(arrow);
    this.dyn.add(grp);
    return { group: grp, arrow };
  }

  makeAimArrow() {
    const s = new THREE.Shape();
    s.moveTo(0, -0.18); s.lineTo(4.2, -0.18); s.lineTo(4.2, -0.5); s.lineTo(5.4, 0);
    s.lineTo(4.2, 0.5); s.lineTo(4.2, 0.18); s.lineTo(0, 0.18); s.closePath();
    const geo = new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.disposeGeo = true; m.userData.disposeMat = true;
    m.position.y = 0.04;
    const grp = new THREE.Group();
    grp.add(m);
    grp.visible = false;
    this.dyn.add(grp);
    return grp;
  }

  makeCone(x, z) {
    const c = new THREE.Mesh(this.geo.cone, this.mat.cone);
    c.position.set(x, 0, z);
    this.dyn.add(c);
    return c;
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
