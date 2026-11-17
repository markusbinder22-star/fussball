// Alle Sounds werden live per Web Audio erzeugt – keine Audiodateien, keine Lizenzfragen.
let ctx = null;
let master = null;
let noiseBuf = null;
let crowd = null;
let muted = false;
let suppressed = false;
const level = () => (muted || suppressed ? 0 : 0.9);

function makeNoise(seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function noiseSource(loop = false) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = loop;
  return src;
}

function env(gainNode, t0, attack, peak, decay) {
  const g = gainNode.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

export const Sound = {
  init() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = level();
        master.connect(ctx.destination);
        noiseBuf = makeNoise(2);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  },

  get muted() { return muted; },
  setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
  },

  // stummschalten, solange im Hintergrund das Demo-Spiel läuft
  setSuppressed(v) {
    suppressed = v;
    if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
  },

  ok() { return ctx && ctx.state === 'running'; },

  // Ballkontakt: dumpfer Schlag + kurzes Rauschen
  kick(strength = 0.6) {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 + strength * 80, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.004, 0.5 * strength + 0.15, 0.16);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.25);

    const n = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900 + strength * 1500;
    const ng = ctx.createGain();
    env(ng, t, 0.002, 0.25 * strength + 0.05, 0.06);
    n.connect(f).connect(ng).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.1);
  },

  // leiser Ballkontakt beim Annehmen / Aufprall
  touch(v = 0.3) {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    const n = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain();
    env(g, t, 0.003, v * 0.35, 0.07);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.1);
  },

  // Schiedsrichterpfiff: kurz, lang oder Abpfiff (3x)
  whistle(type = 'short') {
    if (!this.ok()) return;
    const parts = type === 'end' ? [[0, 0.35], [0.45, 0.35], [0.9, 0.9]]
      : type === 'long' ? [[0, 0.8]] : [[0, 0.28]];
    for (const [off, dur] of parts) {
      const t = ctx.currentTime + off;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(2750, t);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 32;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 120;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.setValueAtTime(0.22, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    }
  },

  // Pfosten / Latte: metallisches Klingen
  post() {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    for (const [fr, v] of [[523, 0.25], [1187, 0.18], [1960, 0.12], [2730, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain();
      env(g, t, 0.003, v, 0.9);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 1);
    }
    this.kick(0.5);
  },

  // Torwart fängt
  catchBall() {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    const n = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 350;
    const g = ctx.createGain();
    env(g, t, 0.003, 0.6, 0.12);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.2);
  },

  click() {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = 880;
    const g = ctx.createGain();
    env(g, t, 0.002, 0.06, 0.05);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.08);
  },

  // Publikum jubelt (Tor)
  cheer(strength = 1) {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    for (const fr of [700, 1100, 1700]) {
      const n = noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(fr * 0.7, t);
      f.frequency.linearRampToValueAtTime(fr, t + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.35);
      g.gain.setValueAtTime(0.35 * strength, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      n.connect(f).connect(g).connect(master);
      n.start(t, Math.random()); n.stop(t + 3.3);
    }
  },

  // Raunen (knapp daneben / gehalten)
  ooh() {
    if (!this.ok()) return;
    const t = ctx.currentTime;
    const n = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(260, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 1.5);
  },

  // dauerhaftes Stadion-Rauschen
  crowdStart() {
    if (!this.ok() || crowd) return;
    const n = noiseSource(true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    n.connect(f).connect(g).connect(master);
    n.start(); lfo.start();
    crowd = { n, lfo, g };
  },

  crowdStop() {
    if (!crowd) return;
    try { crowd.n.stop(); crowd.lfo.stop(); } catch (e) { /* schon gestoppt */ }
    crowd = null;
  },
};
