// Nishir Daak — synthesised sound effects (Web Audio API, no files, no dependencies).
// Usage: sfx.unlock() from the first user gesture, then sfx.play('hit'), sfx.ambient(true) ...
// Nothing here ever throws: without an AudioContext (or before unlock) every call is a no-op.
// Set window.ND_SFX_DEBUG = true to get swallowed errors logged with console.warn.

const W = typeof window !== 'undefined' ? window : null;
const MASTER = 0.5, MAX_VOICES = 12, MIN_GAP_MS = 40, STUCK_MS = 5000, EPS = 0.0001;

let ctx = null, master = null, noiseBuf = null, failed = false;
let muted = false, ambOn = false, amb = null;
const voices = new Set(), lastPlayed = Object.create(null);
try { muted = !!W && W.localStorage.getItem('nd_muted') === '1'; } catch (e) { /* storage blocked */ }

const noop = () => {};
const dbg = (what, e) => { try { if (W && W.ND_SFX_DEBUG) console.warn('[sfx]', what, e); } catch (_) { /* ignore */ } };
const num = (v, def, lo, hi) => (v == null || !Number.isFinite(+v) ? def : Math.min(hi, Math.max(lo, +v)));
const hz = (f, p) => Math.min(16000, Math.max(20, f * (p || 1)));
// A-minor pentatonic degree -> Hz (0 = A3, 5 = A4, 10 = A5 ...), so overlapping sounds stay consonant.
const PENTA = [0, 3, 5, 7, 10];
const n = (i) => 220 * 2 ** (Math.floor(i / 5) + PENTA[((i % 5) + 5) % 5] / 12);

function ensure() {
  if (ctx || failed || !W) return ctx;
  try {
    const AC = W.AudioContext || W.webkitAudioContext;
    if (!AC) { failed = true; return null; }
    const c = new AC();
    master = c.createGain();
    master.gain.value = muted ? 0 : MASTER;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(c.destination);
    const len = Math.floor(c.sampleRate * 2);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const b = c.createBufferSource();             // silent blip: unlocks older iOS inside the gesture
    b.buffer = c.createBuffer(1, 1, c.sampleRate); b.connect(c.destination); b.start(0);
    ctx = c;
    ctx.onstatechange = syncAmb;
    document.addEventListener('visibilitychange', () => { wake(); syncAmb(); });
  } catch (e) { dbg('init', e); ctx = null; failed = true; }
  return ctx;
}

function wake() {
  try {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || document.hidden) return;
    const p = ctx.resume();
    if (p && p.catch) p.catch(noop);
  } catch (e) { dbg('resume', e); }
}

function hold(param, t) {           // freeze an AudioParam at its current value before re-automating it
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
}

// ---------- helpers: every source stops itself and disconnects its nodes when it ends ----------
function drop(s) { if (voices.delete(s)) { try { s.out.disconnect(); } catch (e) { /* gone */ } } }

function finish(s, src, nodes, end) {
  s.n++;
  src.onended = () => {
    for (const x of nodes) { try { x.disconnect(); } catch (e) { /* gone */ } }
    if (--s.n <= 0 && s.voice) drop(s);
  };
  src.stop(end + 0.03);
}

function env(g, t, o) {             // linear attack -> optional hold -> exponential release; returns end time
  const a = o.a || 0.005, v = Math.max(o.v || 0.15, EPS * 2), end = t + a + (o.h || 0) + o.d;
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  if (o.h) g.gain.setValueAtTime(v, t + a + o.h);
  g.gain.exponentialRampToValueAtTime(EPS, end);
  return end;
}

// tone: { f, to?, gl? (glide secs), type?, a?, h?, d, v?, det? (cents), vib? [rateHz, depthHz], lp? (lowpass Hz) }
function tone(s, t, o) {
  const osc = ctx.createOscillator(), g = ctx.createGain(), nodes = [osc, g];
  const end = env(g, t, o);
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(hz(o.f, s.p), t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(hz(o.to, s.p), t + (o.gl || end - t));
  if (o.det) osc.detune.value = o.det;
  if (o.vib) {
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1] * s.p;
    l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end + 0.03);
    nodes.push(l, lg);
  }
  let head = osc;
  if (o.lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass'; fl.Q.value = 2;
    fl.frequency.setValueAtTime(hz(o.lp, s.p), t);
    fl.frequency.exponentialRampToValueAtTime(hz(o.lp * 0.2, s.p), end);
    osc.connect(fl); head = fl; nodes.push(fl);
  }
  head.connect(g); g.connect(s.out);
  osc.start(t);
  finish(s, osc, nodes, end);
}

// noise: { f, to? (sweep target Hz), type? (biquad type), q?, a?, h?, d, v? }
function noise(s, t, o) {
  const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  const end = env(g, t, o);
  src.buffer = noiseBuf; src.loop = true;
  fl.type = o.type || 'bandpass'; fl.Q.value = o.q || 1;
  fl.frequency.setValueAtTime(hz(o.f, s.p), t);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(hz(o.to, s.p), end);
  src.connect(fl); fl.connect(g); g.connect(s.out);
  src.start(t, Math.random() * 1.5);
  finish(s, src, [src, fl, g], end);
}

// seq: pentatonic degrees played `step` seconds apart with a shared tone recipe
function seq(s, t, degs, step, o) { degs.forEach((d, i) => tone(s, t + i * step, { ...o, f: n(d) })); }

const BELL = [[1, 1, 1], [2.01, 0.4, 0.7], [2.76, 0.22, 0.5], [5.4, 0.1, 0.3]];   // [ratio, gain, decay]
function bell(s, t, f, d, v) { for (const [m, g, k] of BELL) tone(s, t, { f: f * m, a: 0.003, d: d * k, v: v * g }); }

function pluck(s, t, f, d, v) {
  tone(s, t, { f, type: 'triangle', a: 0.003, d, v });
  tone(s, t, { f: f * 2, a: 0.002, d: d * 0.5, v: v * 0.3 });
}

// ---------- recipes ----------
const R = {
  __proto__: null,
  tap(s, t) {
    tone(s, t, { f: 1100, to: 700, type: 'triangle', a: 0.001, d: 0.04, v: 0.22 });
    noise(s, t, { f: 2400, q: 2, a: 0.001, d: 0.02, v: 0.12 });
  },
  select(s, t) { pluck(s, t, n(5), 0.16, 0.18); pluck(s, t + 0.07, n(8), 0.2, 0.18); },
  deny(s, t) {
    for (const dt of [0, 0.11]) {
      tone(s, t + dt, { f: 185, to: 105, type: 'triangle', a: 0.002, d: 0.09, v: 0.32 });
      noise(s, t + dt, { type: 'lowpass', f: 420, a: 0.002, d: 0.05, v: 0.25 });
    }
  },
  draw(s, t) { noise(s, t, { f: 1200, to: 5200, q: 1.2, a: 0.02, d: 0.13, v: 0.2 }); },
  play(s, t) {
    noise(s, t, { type: 'lowpass', f: 1100, a: 0.001, d: 0.05, v: 0.4 });
    tone(s, t, { f: 230, to: 120, type: 'triangle', a: 0.001, d: 0.06, v: 0.25 });
    noise(s, t + 0.02, { f: 600, to: 2600, q: 1.1, a: 0.05, d: 0.17, v: 0.12 });
  },
  summon(s, t) {
    noise(s, t, { f: 300, to: 3400, q: 1.5, a: 0.28, d: 0.4, v: 0.16 });
    tone(s, t, { f: n(3), to: n(8), gl: 0.5, a: 0.25, d: 0.42, v: 0.07 });
    for (const det of [-14, 14]) tone(s, t + 0.08, { f: n(8), det, a: 0.3, d: 0.32, v: 0.06, vib: [6, 7] });
    tone(s, t + 0.2, { f: n(10), det: 9, a: 0.25, d: 0.25, v: 0.04 });
  },
  charm(s, t) {
    seq(s, t, [10, 12, 13, 15, 16], 0.06, { a: 0.003, d: 0.24, v: 0.1 });
    seq(s, t + 0.03, [15, 17], 0.12, { a: 0.003, d: 0.1, v: 0.03 });
  },
  fire(s, t) {
    noise(s, t, { f: 400, to: 1900, q: 0.8, a: 0.05, d: 0.36, v: 0.24 });
    noise(s, t, { type: 'lowpass', f: 500, to: 180, a: 0.03, d: 0.3, v: 0.2 });
    for (let i = 0; i < 6; i++) {
      noise(s, t + 0.03 + Math.random() * 0.36, { type: 'highpass', f: 2800 + Math.random() * 2500, a: 0.001, d: 0.014, v: 0.2 });
    }
  },
  skill(s, t) {
    tone(s, t, { f: n(5) * 0.92, to: n(5) * 1.1, gl: 0.11, type: 'sawtooth', lp: 4200, a: 0.002, d: 0.34, v: 0.16 });
    tone(s, t, { f: n(5) * 1.84, to: n(5) * 2.2, gl: 0.11, type: 'triangle', a: 0.002, d: 0.14, v: 0.07 });
    tone(s, t, { f: n(0), type: 'triangle', a: 0.004, d: 0.3, v: 0.07 });
  },
  lunge(s, t) { noise(s, t, { f: 500, to: 3000, q: 1.4, a: 0.035, d: 0.12, v: 0.26 }); },
  hit(s, t) {
    tone(s, t, { f: 190, to: 60, gl: 0.1, a: 0.001, d: 0.14, v: 0.5 });
    tone(s, t, { f: 250, to: 90, type: 'triangle', a: 0.001, d: 0.1, v: 0.25 });
    noise(s, t, { type: 'lowpass', f: 2400, to: 500, a: 0.001, d: 0.07, v: 0.36 });
  },
  bighit(s, t) {
    tone(s, t, { f: 140, to: 38, a: 0.001, d: 0.34, v: 0.6 });
    tone(s, t, { f: 210, to: 60, type: 'triangle', a: 0.001, d: 0.2, v: 0.36 });
    noise(s, t, { type: 'lowpass', f: 1700, to: 240, a: 0.001, d: 0.17, v: 0.46 });
  },
  block(s, t) {
    bell(s, t, n(15), 0.4, 0.14);
    tone(s, t, { f: n(15) * 1.004, a: 0.003, d: 0.3, v: 0.05 });
    noise(s, t, { type: 'highpass', f: 5000, a: 0.001, d: 0.02, v: 0.12 });
  },
  heal(s, t) {
    seq(s, t, [6, 8, 9], 0.09, { type: 'triangle', a: 0.012, d: 0.3, v: 0.13 });
    seq(s, t, [1, 3, 4], 0.09, { a: 0.02, d: 0.34, v: 0.1 });
  },
  buff(s, t) {
    tone(s, t, { f: n(3), to: n(10), gl: 0.16, type: 'triangle', a: 0.006, d: 0.2, v: 0.16 });
    tone(s, t + 0.14, { f: n(13), a: 0.003, d: 0.12, v: 0.06 });
  },
  debuff(s, t) {
    tone(s, t, { f: n(8), to: n(0), type: 'triangle', a: 0.006, d: 0.27, v: 0.16 });
    tone(s, t, { f: n(8) * 1.04, to: n(0) * 1.04, a: 0.006, d: 0.27, v: 0.07 });
  },
  stun(s, t) {
    tone(s, t, { f: n(10), to: n(4), a: 0.01, d: 0.5, v: 0.15, vib: [14, 42] });
    tone(s, t, { f: n(5), to: n(-1), type: 'triangle', a: 0.01, d: 0.45, v: 0.07, vib: [14, 20] });
  },
  poison(s, t) {
    noise(s, t, { type: 'highpass', f: 3400, to: 6200, q: 0.7, a: 0.03, d: 0.36, v: 0.17 });
    for (const dt of [0.08, 0.2]) tone(s, t + dt, { f: 300, to: 540, a: 0.004, d: 0.06, v: 0.09 });
  },
  die(s, t) {
    tone(s, t, { f: n(7), to: n(0), a: 0.04, d: 0.62, v: 0.18, vib: [7, 12] });
    tone(s, t, { f: n(7), to: n(0), type: 'triangle', det: 18, a: 0.04, d: 0.55, v: 0.07 });
    noise(s, t + 0.25, { f: 2600, to: 500, q: 0.9, a: 0.25, d: 0.3, v: 0.13 });
  },
  firefly(s, t) {
    const f = n(10 + Math.floor(Math.random() * 6));
    tone(s, t, { f, a: 0.004, d: 0.15, v: 0.07 });
    tone(s, t + 0.02, { f: f * 2, a: 0.003, d: 0.07, v: 0.025 });
  },
  steal(s, t) {
    tone(s, t, { f: n(8), to: n(4), type: 'triangle', a: 0.004, d: 0.09, v: 0.14 });
    tone(s, t + 0.08, { f: n(4), to: n(10), type: 'triangle', a: 0.006, d: 0.13, v: 0.14 });
  },
  bounce(s, t) { tone(s, t, { f: 160, to: 340, gl: 0.26, type: 'triangle', a: 0.004, d: 0.3, v: 0.22, vib: [27, 38] }); },
  speak(s, t) { tone(s, t, { f: 300, to: 420, gl: 0.04, a: 0.004, d: 0.06, v: 0.15 }); },
  turn(s, t) { bell(s, t, n(8), 0.36, 0.13); bell(s, t + 0.16, n(10), 0.42, 0.13); },
  endturn(s, t) {
    bell(s, t, n(0), 0.55, 0.22);
    tone(s, t, { f: n(0) * 1.006, to: n(0) * 0.985, a: 0.006, d: 0.5, v: 0.1 });
    noise(s, t, { type: 'lowpass', f: 600, a: 0.003, d: 0.06, v: 0.12 });
  },
  tick(s, t) {
    tone(s, t, { f: 1900, to: 1650, type: 'triangle', a: 0.001, d: 0.025, v: 0.15 });
    noise(s, t, { type: 'highpass', f: 4200, a: 0.001, d: 0.012, v: 0.1 });
  },
  levelup(s, t) {
    seq(s, t, [6, 8, 9, 11, 13], 0.1, { type: 'triangle', a: 0.004, d: 0.17, v: 0.14 });
    bell(s, t + 0.4, n(13), 0.48, 0.1);
    tone(s, t + 0.4, { f: n(11), type: 'triangle', a: 0.01, h: 0.15, d: 0.32, v: 0.07 });
  },
  ko(s, t) {
    tone(s, t, { f: 125, to: 40, a: 0.001, d: 0.42, v: 0.6 });
    tone(s, t, { f: 180, to: 55, type: 'triangle', a: 0.001, d: 0.26, v: 0.3 });
    noise(s, t, { type: 'lowpass', f: 1000, to: 200, a: 0.001, d: 0.16, v: 0.42 });
    tone(s, t + 0.08, { f: n(5), to: n(-3), type: 'triangle', a: 0.02, d: 0.78, v: 0.13, vib: [5, 4] });
  },
  revive(s, t) {
    seq(s, t, [3, 5, 8, 10, 13], 0.07, { a: 0.01, d: 0.3, v: 0.08, det: 8 });
    tone(s, t, { f: n(5), to: n(10), gl: 0.42, det: -10, a: 0.2, d: 0.36, v: 0.07 });
    noise(s, t, { f: 1000, to: 6000, q: 1.3, a: 0.32, d: 0.22, v: 0.06 });
  },
  win(s, t) {
    seq(s, t, [4, 6, 8, 9], 0.13, { type: 'triangle', a: 0.004, d: 0.2, v: 0.16 });
    seq(s, t, [-1, 1, 3, 4], 0.13, { a: 0.004, d: 0.18, v: 0.07 });
    [6, 8, 9, 11].forEach((d, i) => tone(s, t + 0.56 + i * 0.012, { f: n(d), type: 'triangle', a: 0.01, h: 0.35, d: 0.65, v: 0.1 }));
    bell(s, t + 0.56, n(11), 1.0, 0.1);
    noise(s, t + 0.56, { type: 'highpass', f: 6000, a: 0.01, d: 0.5, v: 0.03 });
  },
  lose(s, t) {
    seq(s, t, [8, 7, 6], 0.22, { type: 'triangle', a: 0.02, d: 0.32, v: 0.14 });
    tone(s, t + 0.66, { f: n(5), to: n(5) * 0.94, type: 'triangle', a: 0.02, h: 0.1, d: 0.6, v: 0.14, vib: [5, 3] });
    tone(s, t + 0.66, { f: n(0), to: n(0) * 0.94, a: 0.03, h: 0.1, d: 0.6, v: 0.1 });
  },
  start(s, t) {
    noise(s, t, { f: 250, to: 1900, q: 1.2, a: 0.55, d: 0.2, v: 0.13 });
    tone(s, t, { f: n(0), to: n(3), gl: 0.7, det: -10, a: 0.55, d: 0.2, v: 0.1 });
    tone(s, t, { f: n(0), to: n(3), gl: 0.7, det: 10, type: 'triangle', a: 0.55, d: 0.2, v: 0.05 });
    bell(s, t + 0.68, n(8), 0.5, 0.16);
    bell(s, t + 0.68, n(5), 0.5, 0.07);
  },
  emote(s, t) { tone(s, t, { f: 420, to: 990, gl: 0.05, a: 0.003, d: 0.07, v: 0.2 }); },
  join(s, t) { seq(s, t, [6, 9], 0.07, { a: 0.004, d: 0.1, v: 0.15 }); },
};

// ---------- ambience: band-passed noise wind with a slow LFO + sparse cricket chirps ----------
function syncAmb() {
  try {
    const want = ambOn && !muted && !!ctx && ctx.state === 'running' && !document.hidden;
    if (want && !amb) startAmb(); else if (!want && amb) stopAmb();
  } catch (e) { dbg('ambient', e); }
}

function startAmb() {
  const t = ctx.currentTime, out = ctx.createGain();
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), wind = ctx.createGain();
  const lfo = ctx.createOscillator(), lfoF = ctx.createGain(), lfoG = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 3);
  src.buffer = noiseBuf; src.loop = true;
  bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.8;
  wind.gain.value = 0.16;
  lfo.frequency.value = 0.07; lfoF.gain.value = 190; lfoG.gain.value = 0.07;
  lfo.connect(lfoF); lfoF.connect(bp.frequency); lfo.connect(lfoG); lfoG.connect(wind.gain);
  src.connect(bp); bp.connect(wind); wind.connect(out); out.connect(master);
  src.start(t); lfo.start(t);
  amb = { out, p: 1, n: 0, srcs: [src, lfo], timer: setTimeout(chirp, 1500 + Math.random() * 3000) };
}

function chirp() {
  const a = amb;
  if (!a || !ctx) return;
  try {
    const t = ctx.currentTime + 0.05, f = 4200 + Math.random() * 700, count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) tone(a, t + i * 0.07, { f, a: 0.008, d: 0.045, v: 0.02 });
  } catch (e) { dbg('chirp', e); }
  a.timer = setTimeout(chirp, 3000 + Math.random() * 6000);
}

function stopAmb() {
  const a = amb, t = ctx.currentTime;
  amb = null;
  clearTimeout(a.timer);
  try {
    a.srcs[0].onended = () => { try { a.out.disconnect(); } catch (e) { /* gone */ } };
    hold(a.out.gain, t);
    a.out.gain.setTargetAtTime(0, t, 0.25);
    for (const x of a.srcs) x.stop(t + 1.5);
  } catch (e) { dbg('ambient-stop', e); try { a.out.disconnect(); } catch (_) { /* gone */ } }
}

// ---------- public API ----------
export const sfx = {
  unlock() {
    try { if (ensure()) { wake(); syncAmb(); } } catch (e) { dbg('unlock', e); }
  },

  play(name, opts) {
    try {
      const recipe = typeof name === 'string' ? R[name] : null;
      if (!recipe || muted || !ctx || ctx.state !== 'running') return;
      const now = Date.now(), o = opts || {};
      if (now - (lastPlayed[name] || 0) < MIN_GAP_MS) return;
      for (const v of voices) if (now - v.born > STUCK_MS) drop(v);
      if (voices.size >= MAX_VOICES) return;
      const vol = num(o.vol, 1, 0, 1);
      if (vol <= 0) return;
      lastPlayed[name] = now;
      const out = ctx.createGain();
      out.gain.value = vol;
      out.connect(master);
      const s = { out, p: num(o.pitch, 1, 0.25, 4), n: 0, born: now, voice: true };
      voices.add(s);
      try { recipe(s, ctx.currentTime + 0.005); } catch (e) { dbg(name, e); }
      if (!s.n) drop(s);
    } catch (e) { dbg(name, e); }
  },

  setMuted(on) {
    muted = !!on;
    try { if (W) W.localStorage.setItem('nd_muted', muted ? '1' : '0'); } catch (e) { /* storage blocked */ }
    try {
      if (ctx && master) {
        const t = ctx.currentTime;
        hold(master.gain, t);
        master.gain.setTargetAtTime(muted ? 0 : MASTER, t, 0.03);
      }
    } catch (e) { dbg('mute', e); }
    syncAmb();
  },

  get muted() { return muted; },

  ambient(on) {
    ambOn = !!on;
    syncAmb();
  },
};
