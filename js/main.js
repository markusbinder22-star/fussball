// Menüs, HUD, Legende und Hauptschleife.
import { World } from './world.js';
import { Input, TouchPad } from './input.js';
import { Game, TEAMS } from './game.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);

// ---------- Einstellungen (werden im Browser gespeichert) ----------
const DEFAULTS = {
  sound: true, camera: 'carrier', opponent: 'cpu', teamSize: 5, duration: 5,
  difficulty: 'mittel', wall: true,
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bolzplatz-settings') || '{}') }; } catch (e) { /* egal */ }
const saveSettings = () => { try { localStorage.setItem('bolzplatz-settings', JSON.stringify(settings)); } catch (e) { /* egal */ } };
Sound.setMuted(!settings.sound);

const CAMERAS = { carrier: 'Hinter Ballführendem', team: 'Hinter meinem Team', tv: 'TV-Kamera (seitlich)' };
const TRAININGS = {
  schuss: { name: 'Torschuss', icon: '🥅', text: 'Aus wechselnden Positionen aufs Tor schießen.' },
  dribbeln: { name: 'Dribbeln', icon: '🔶', text: 'Hütchen-Parcours auf Zeit. Durch jedes Tor laufen!' },
  elfmeter: { name: 'Elfmeter', icon: '⚪', text: 'Zielen, Schussstärke wählen, verwandeln.' },
  freistoss: { name: 'Freistoß', icon: '🧱', text: 'Mit oder ohne Mauer. Effet nach dem Schuss!' },
  ecke: { name: 'Eckball', icon: '🚩', text: 'Flanke in den Strafraum, dann per Kopf oder Volley abschließen.' },
};

// ---------- Grundobjekte ----------
const world = new World($('#c'));
const input = new Input();
const touch = new TouchPad($('#touch'), input);
let game = null;
let demo = true;
let overlay = null;   // 'pause' | 'legend' | 'end' | null
let legendReturn = null;
let lastCfg = null;
let installEvt = null;

window.addEventListener('resize', () => world.resize());
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!game || demo) showMain(); });

const isTouch = () => input.lastDevice === 'touch';

// ---------- UI-Schnittstelle für das Spiel ----------
let bannerTimer = null;
const ui = {
  onStart(g) {
    const isMatch = g.cfg.mode === 'match';
    $('#score').classList.toggle('hidden', !isMatch || g.cfg.demo);
    $('#trainInfo').classList.toggle('hidden', isMatch);
    $('#mini').classList.toggle('hidden', !isMatch || g.cfg.demo);
    this.miniCtx = $('#mini').getContext('2d');
  },
  banner(text, ms = 1400, color = null) {
    if (demo) return;
    const b = $('#banner');
    b.textContent = text;
    b.style.color = color || '#fff';
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  },
  setPower(i, charge) {
    const el = document.querySelector(`.pw${i}`);
    if (!el) return;
    el.classList.toggle('on', charge >= 0 && !demo);
    el.firstElementChild.style.width = `${Math.max(0, charge) * 100}%`;
  },
  update(g) {
    if (demo) return;
    if (g.cfg.mode === 'match') {
      $('#sc').textContent = `${g.score[0]} : ${g.score[1]}`;
      const t = Math.max(0, Math.ceil(g.time));
      $('#clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      this.drawMini(g);
    } else {
      const tr = g.train;
      const info = TRAININGS[tr.type];
      let stats;
      if (tr.type === 'dribbeln') {
        const cur = (tr.time + tr.pen).toFixed(1);
        stats = `Zeit ${cur} s · Tor ${Math.min(tr.gate + 1, tr.gates.length)}/${tr.gates.length}` +
          (tr.best ? ` · Bestzeit ${tr.best.toFixed(1)} s` : '');
      } else {
        const q = tr.shots ? Math.round((tr.goals / tr.shots) * 100) : 0;
        stats = `Tore ${tr.goals} / ${tr.shots} Versuche (${q} %)`;
        if (tr.type === 'freistoss') stats += tr.wall ? ' · mit Mauer' : ' · ohne Mauer';
      }
      $('#trainInfo').innerHTML = `<b>${info.icon} ${info.name}</b><span>${stats}</span>`;
    }
  },
  drawMini(g) {
    const cv = $('#mini');
    const d = g.d;
    const W = cv.width, H = cv.height;
    const c = this.miniCtx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,90,40,0.85)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1;
    const pad = 4;
    const sx = (x) => pad + ((x + d.L / 2) / d.L) * (W - pad * 2);
    const sz = (z) => pad + ((z + d.W / 2) / d.W) * (H - pad * 2);
    c.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    c.beginPath(); c.moveTo(W / 2, pad); c.lineTo(W / 2, H - pad); c.stroke();
    c.strokeRect(pad - 2, sz(-d.goalW / 2), 2, sz(d.goalW / 2) - sz(-d.goalW / 2));
    c.strokeRect(W - pad, sz(-d.goalW / 2), 2, sz(d.goalW / 2) - sz(-d.goalW / 2));
    for (const p of g.players) {
      c.fillStyle = p.gk ? (p.team === 0 ? '#20b35a' : '#f2c418') : TEAMS[p.team].css;
      c.beginPath(); c.arc(sx(p.pos.x), sz(p.pos.z), p.human ? 4 : 3, 0, Math.PI * 2); c.fill();
      if (p.human) { c.strokeStyle = p.human.ctl === 0 ? '#ffe14d' : '#4de1ff'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1; }
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(sx(g.ball.pos.x), sz(g.ball.pos.z), 2.5, 0, Math.PI * 2); c.fill();
  },
  showEnd(g) {
    if (demo) { startDemo(); return; }
    const [a, b] = g.score;
    const txt = a === b ? 'Unentschieden!' : `${TEAMS[a > b ? 0 : 1].name} gewinnt!`;
    showOverlay('end', `
      <h2>Abpfiff</h2>
      <div class="endscore"><span style="color:${TEAMS[0].css}">${TEAMS[0].name}</span> ${a} : ${b} <span style="color:${TEAMS[1].css}">${TEAMS[1].name}</span></div>
      <p class="big">${txt}</p>
      <div class="row"><button class="btn primary" data-act="again">Revanche</button><button class="btn" data-act="menu">Hauptmenü</button></div>`);
  },
};

// ---------- Legende (Steuerung) ----------
function legendHTML(tab) {
  const two = lastCfg && lastCfg.mode === 'match' && lastCfg.opponent === 'human';
  const k = (s) => s.split('+').map((x) => `<kbd>${x}</kbd>`).join(' ');
  const rows = (list) => `<table>${list.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  let body = '';
  if (tab === 'keyboard') {
    if (two) {
      body = `<div class="cols">
        <div><h3 style="color:${TEAMS[0].css}">Spieler 1 (Blau)</h3>${rows([
          [k('W+A+S+D'), 'Laufen / beim Standard zielen'], [k('F'), 'Schießen (halten = fester)'], [k('G'), 'Flacher Pass'],
          [k('T'), 'Flanke / Heber'], [k('V'), 'Spieler wechseln, am Gegner: Grätsche'], [k('Shift links'), 'Sprinten']])}</div>
        <div><h3 style="color:${TEAMS[1].css}">Spieler 2 (Rot)</h3>${rows([
          [k('↑+←+↓+→'), 'Laufen / beim Standard zielen'], [k('K'), 'Schießen (halten = fester)'], [k('L'), 'Flacher Pass'],
          [k('O'), 'Flanke / Heber'], [k('M'), 'Spieler wechseln, am Gegner: Grätsche'], [k('Shift rechts'), 'Sprinten']])}</div></div>`;
    } else {
      body = rows([
        [k('↑+←+↓+→'), 'Laufen (beim Standard: ← → zielen)'],
        [`${k('D')} oder ${k('Leertaste')}`, 'Schießen – gedrückt halten = fester'],
        [k('S'), 'Flacher Pass zum Mitspieler'],
        [k('A'), 'Flanke / Heber'],
        [k('Q'), 'Spieler wechseln, direkt am Gegner: Grätsche'],
        [`${k('E')} oder ${k('Shift')}`, 'Sprinten'],
        ['nach dem Schuss ' + k('←+→'), 'Effet (Ball anschneiden)'],
      ]);
    }
    body = body.replace('</table>', `<tr><td>${k('P')} oder ${k('Esc')}</td><td>Pause</td></tr><tr><td>${k('H')}</td><td>Diese Legende ein/aus</td></tr></table>`);
    if (two) body += `<table><tr><td>${k('P')} oder ${k('Esc')}</td><td>Pause</td></tr><tr><td>${k('H')}</td><td>Diese Legende ein/aus</td></tr></table>`;
  } else if (tab === 'touch') {
    body = rows([
      ['🕹️ linke Seite', 'Daumen auflegen und ziehen = laufen' + (two ? ' (ganz ausschlagen = sprinten)' : '')],
      ['<span class="tk shoot">Schuss</span>', 'Gedrückt halten = fester, loslassen = Schuss'],
      ['<span class="tk">Pass</span>', 'Flacher Pass in Laufrichtung'],
      ['<span class="tk">Flanke</span>', 'Hoher Ball / Heber'],
      ['<span class="tk">Wechsel</span>', 'Spieler wechseln, am Gegner: Grätsche'],
      ...(two ? [] : [['<span class="tk">Sprint</span>', 'Gedrückt halten = schneller laufen']]),
      ['nach dem Schuss 🕹️ links/rechts', 'Effet (Ball anschneiden)'],
      ['Beim Standard', 'Joystick links/rechts = zielen'],
      ['II / ?', 'Pause / diese Legende'],
    ]);
    if (two) body = '<p>Zwei Spieler am Tablet: Spieler 1 links, Spieler 2 rechts – jeder hat Joystick und Buttons auf seiner Seite.</p>' + body;
  } else {
    body = rows([
      ['Linker Stick / Steuerkreuz', 'Laufen / beim Standard zielen'],
      [k('B'), 'Schießen (halten = fester)'], [k('A'), 'Flacher Pass'], [k('X'), 'Flanke / Heber'],
      [`${k('Y')} oder ${k('LB')}`, 'Spieler wechseln / Grätsche'], [`${k('RB')} oder ${k('RT')}`, 'Sprinten'],
      [k('Start'), 'Pause'],
    ]);
    body = `<p>Xbox-Belegung. Bei 2 Spielern: Controller 1 = Blau, Controller 2 = Rot.</p>` + body;
  }
  const tabs = [['keyboard', '⌨️ Tastatur'], ['touch', '👆 Touch'], ['gamepad', '🎮 Controller']]
    .map(([id, l]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('');
  return `<h2>Steuerung</h2><div class="tabs">${tabs}</div><div class="legend-body">${body}</div>
    <p class="note">Gelber Ring = dein Spieler${two ? ', blauer Ring = Spieler 2' : ''}. Beim Anstoß und Abstoß zeigt die Kamera das Feld von oben.</p>
    <div class="row"><button class="btn primary" data-act="closeLegend">Weiter</button></div>`;
}

function deviceTab() {
  if (input.lastDevice === 'gamepad') return 'gamepad';
  return isTouch() ? 'touch' : 'keyboard';
}

function showLegend(tab = deviceTab()) {
  if (overlay !== 'legend') legendReturn = overlay;
  if (game && !demo) game.paused = true;
  showOverlay('legend', legendHTML(tab));
}

// ---------- Overlays ----------
function showOverlay(kind, html) {
  overlay = kind;
  const o = $('#overlay');
  o.innerHTML = `<div class="panel">${html}</div>`;
  o.classList.remove('hidden');
}
function hideOverlay() {
  overlay = null;
  $('#overlay').classList.add('hidden');
  if (game && !demo) game.paused = false;
}

function pauseMenu() {
  if (!game || demo || overlay === 'end') return;
  game.paused = true;
  showOverlay('pause', `
    <h2>Pause</h2>
    <div class="col">
      <button class="btn primary" data-act="resume">Weiter spielen</button>
      <button class="btn" data-act="legend">Steuerung anzeigen</button>
      <button class="btn" data-act="sound">Ton: ${settings.sound ? 'an' : 'aus'}</button>
      ${game.cfg.mode === 'match' ? `<button class="btn" data-act="camera">Kamera: ${CAMERAS[settings.camera]}</button>` : ''}
      <button class="btn" data-act="again">Neu starten</button>
      <button class="btn" data-act="menu">Hauptmenü</button>
    </div>`);
}

$('#overlay').addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) return;
  Sound.init(); Sound.click();
  if (t.dataset.tab) { showOverlay('legend', legendHTML(t.dataset.tab)); return; }
  const act = t.dataset.act;
  if (act === 'resume') hideOverlay();
  else if (act === 'legend') showLegend();
  else if (act === 'closeLegend') {
    if (legendReturn === 'pause') pauseMenu();
    else if (game && !demo) hideOverlay();
    else { hideOverlay(); showMain(); }
  } else if (act === 'sound') { settings.sound = !settings.sound; Sound.setMuted(!settings.sound); saveSettings(); pauseMenu(); }
  else if (act === 'camera') {
    const keys = Object.keys(CAMERAS);
    settings.camera = keys[(keys.indexOf(settings.camera) + 1) % keys.length];
    game.cfg.camera = settings.camera; saveSettings(); pauseMenu();
  } else if (act === 'again') { hideOverlay(); startGame(lastCfg); }
  else if (act === 'menu') { hideOverlay(); startDemo(); }
});

// ---------- Menüs ----------
function setMenu(html) {
  const m = $('#menu');
  m.innerHTML = `<div class="panel">${html}</div>`;
  m.classList.remove('hidden');
}

function showMain() {
  setMenu(`
    <h1>⚽ Bolzplatz</h1>
    <p class="sub">Einfaches 3D-Fußballspiel – am PC, Handy und Tablet</p>
    <div class="col">
      <button class="btn primary big" data-go="setup">Spielen</button>
      <button class="btn big" data-go="training">Training</button>
      <button class="btn" data-go="legend">Steuerung (Legende)</button>
      <button class="btn" data-go="settings">Einstellungen</button>
      ${installEvt ? '<button class="btn install" data-go="install">📲 Als App installieren</button>' : ''}
    </div>`);
}

function seg(name, options, value) {
  return `<div class="seg" data-name="${name}">${options.map(([v, l]) =>
    `<button class="${String(v) === String(value) ? 'on' : ''}" data-val="${v}">${l}</button>`).join('')}</div>`;
}

function showSetup() {
  const s = settings;
  setMenu(`
    <h2>Spiel einrichten</h2>
    <label>Gegner</label>${seg('opponent', [['cpu', '🤖 Computer'], ['human', '👥 2 Spieler (lokal)']], s.opponent)}
    <label>Teamgröße</label>
    <div class="stepper"><button data-step="-1">−</button><span id="tsize">${s.teamSize} gegen ${s.teamSize}</span><button data-step="1">+</button></div>
    <label>Spielzeit</label>${seg('duration', [[2, '2 Min.'], [5, '5 Min.'], [10, '10 Min.']], s.duration)}
    <div id="diffRow" class="${s.opponent === 'human' ? 'hidden' : ''}"><label>Schwierigkeit</label>${seg('difficulty', [['leicht', 'Leicht'], ['mittel', 'Mittel'], ['schwer', 'Schwer']], s.difficulty)}</div>
    <label>Kamera</label>${seg('camera', Object.entries(CAMERAS), s.camera)}
    <div class="row"><button class="btn" data-go="main">Zurück</button><button class="btn primary" data-go="kickoff">Anpfiff!</button></div>`);
}

function showTraining() {
  setMenu(`
    <h2>Training</h2>
    <div class="grid">${Object.entries(TRAININGS).map(([id, t]) =>
      `<button class="tile" data-train="${id}"><span class="ic">${t.icon}</span><b>${t.name}</b><small>${t.text}</small></button>`).join('')}</div>
    <label>Freistoß</label>${seg('wall', [['true', '🧱 mit Mauer'], ['false', 'ohne Mauer']], s(settings.wall))}
    <div class="row"><button class="btn" data-go="main">Zurück</button></div>`);
  function s(v) { return String(v); }
}

function showSettings() {
  setMenu(`
    <h2>Einstellungen</h2>
    <label>Ton</label>${seg('sound', [['true', '🔊 an'], ['false', '🔇 aus']], String(settings.sound))}
    <label>Kamera im Spiel</label>${seg('camera', Object.entries(CAMERAS), settings.camera)}
    <p class="note">„Hinter Ballführendem“ schwenkt bei jedem Ballbesitzwechsel. Wem das zu unruhig ist: „Hinter meinem Team“.</p>
    <div class="row"><button class="btn" data-go="fullscreen">Vollbild</button><button class="btn primary" data-go="main">Fertig</button></div>`);
}

$('#menu').addEventListener('click', (e) => {
  Sound.init();
  const t = e.target.closest('button');
  if (!t) return;
  Sound.click();
  const segEl = t.closest('.seg');
  if (segEl) {
    const name = segEl.dataset.name;
    let v = t.dataset.val;
    if (name === 'duration') v = Number(v);
    if (name === 'wall' || name === 'sound') v = v === 'true';
    settings[name] = v;
    if (name === 'sound') Sound.setMuted(!v);
    saveSettings();
    segEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t));
    if (name === 'opponent') $('#diffRow').classList.toggle('hidden', v === 'human');
    return;
  }
  if (t.dataset.step) {
    settings.teamSize = Math.min(11, Math.max(1, settings.teamSize + Number(t.dataset.step)));
    $('#tsize').textContent = `${settings.teamSize} gegen ${settings.teamSize}`;
    saveSettings();
    return;
  }
  if (t.dataset.train) {
    startGame({ mode: 'training', training: t.dataset.train, wall: settings.wall, camera: 'carrier' });
    return;
  }
  const go = t.dataset.go;
  if (go === 'setup') showSetup();
  else if (go === 'training') showTraining();
  else if (go === 'settings') showSettings();
  else if (go === 'main') showMain();
  else if (go === 'legend') { lastCfg = lastCfg || { mode: 'match', opponent: 'cpu' }; $('#menu').classList.add('hidden'); showLegend(); }
  else if (go === 'fullscreen') goFullscreen();
  else if (go === 'install' && installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; showMain(); }); }
  else if (go === 'kickoff') {
    startGame({
      mode: 'match', opponent: settings.opponent, teamSize: settings.teamSize, duration: settings.duration,
      difficulty: settings.difficulty, camera: settings.camera,
    });
  }
});

function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    Promise.resolve(req.call(el)).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }
}

// ---------- Spielstart ----------
let shownLegendOnce = false;
function startGame(cfg) {
  Sound.init();
  Sound.setSuppressed(false);
  Sound.crowdStart();
  demo = false;
  lastCfg = cfg;
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  document.body.classList.add('ingame');
  const players = cfg.mode === 'match' && cfg.opponent === 'human' ? 2 : 1;
  input.setMode(players === 2 ? 'two' : 'single');
  touch.build(players);
  touch.reset();
  if (isTouch()) goFullscreen();
  game = game || new Game(world, input, ui);
  game.paused = false;
  game.start(cfg);
  const hint = cfg.mode === 'training' ? TRAININGS[cfg.training].text : 'Viel Spaß!';
  showHint(`${hint} · ${isTouch() ? '„?“' : 'H'} = Steuerung`);
  if (!shownLegendOnce) { shownLegendOnce = true; showLegend(); }
}

function startDemo() {
  demo = true;
  overlay = null;
  $('#overlay').classList.add('hidden');
  $('#hud').classList.add('hidden');
  document.body.classList.remove('ingame');
  $('#touch').innerHTML = '';
  Sound.setSuppressed(true);
  Sound.crowdStop();
  game = game || new Game(world, input, ui);
  game.paused = false;
  game.start({ mode: 'match', opponent: 'cpu', teamSize: 7, duration: 99, difficulty: 'mittel', camera: 'carrier', demo: true });
  showMain();
}

let hintTimer = null;
function showHint(text) {
  const h = $('#hint');
  h.textContent = text;
  h.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => h.classList.remove('show'), 6000);
}

// ---------- HUD-Buttons & Tasten ----------
$('#bPause').addEventListener('click', () => { Sound.click(); pauseMenu(); });
$('#bLegend').addEventListener('click', () => { Sound.click(); showLegend(); });
$('#bFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else goFullscreen();
});

input.onGlobalKey = (code) => {
  Sound.init();
  if (demo) return;
  if (code === 'Escape' || code === 'KeyP') {
    if (overlay === 'pause' || overlay === 'legend') hideOverlay(); else pauseMenu();
  } else if (code === 'KeyH') {
    if (overlay === 'legend') { if (legendReturn === 'pause') pauseMenu(); else hideOverlay(); } else showLegend();
  }
};

// ---------- Hauptschleife ----------
let last = performance.now();
let padStartPrev = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.update();
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const start = pads.some((p) => p.buttons[9] && p.buttons[9].pressed);
  if (start && !padStartPrev && !demo) { if (overlay) hideOverlay(); else pauseMenu(); }
  padStartPrev = start;
  if (game) game.update(dt);
  world.render();
  requestAnimationFrame(frame);
}

// Test-Hilfe: ?demo=1 lässt Computer gegen Computer spielen
window.__bolzplatz = { get game() { return game; }, startGame, startDemo };

startDemo();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
