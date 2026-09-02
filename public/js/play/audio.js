// Procedural sound for the first-person player. WebAudio only — no assets.
//
// Self-contained — touches no other module. main.js wires it with:
//   import './audio.js'      (module attaches window.__playAudio at load)
//   window.__playAudio.init({ THREE, scene, camera, renderer, ctrl, hud })
//   window.__playAudio.update(dt)       // once per frame
//
// Layers (all from one shared looped noise buffer + oscillators):
//   wind rush     two decorrelated noise paths, lowpassed, panned L/R —
//                 volume + brightness follow speed, a bit louder airborne
//   carve hiss    band-passed noise gated by lateral edge load, panned toward
//                 the carving edge
//   edge chatter  amplitude-modulated band noise on steep ground at speed
//   pump hiss     band noise whose level and cutoff follow edge x load, so a
//                 committed carve is audibly brighter than a lazy one
//   pump whump    a short low thump when a charged turn pays its bank out
//   landing       lowpassed noise burst + pitch-dropping sine, ~ impact
//   jump whoosh   band-sweep noise on leaving the ground
//   crash         a body arriving on the snow — noise burst + a sine dropping
//                 110->45 Hz + a scrape. Stone adds chatter clicks, a trunk
//                 adds a crack and the shimmy below. specs/0017
//   shimmy        the needles: tremolo'd band noise, one per canopy ENTRY
//   trick ding    window.__playAudio.trick() — small bell for trick hooks
//   rocket        window.__playAudio.rocket(0..1) — boost.js sets the throttle
//                 each frame; a low roar + crackle band + a sub sine
//   footsteps     faint crunch bursts, boots only, stride paced by speed
//   glide wind    the same wind pair, driven by the glider's AIRSPEED instead
//                 of ground speed; the flare/stall borrows the carve band
//
// Resume-safe: the AudioContext is created lazily and resumed on the first
// user gesture (pointerdown/keydown). Every continuous parameter moves through
// setTargetAtTime, one-shots use ramped envelopes — no clicks. All wrapped in
// try/catch: a broken audio stack must never break the game.

import { gliderState } from './glider.js';
import { skiState } from './ski.js';

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

const A = {
  ok: false,            // graph built
  ctx: null,            // AudioContext
  ctrl: null, hud: null,
  u: 1,
  master: null, comp: null, analyser: null,
  noiseBuf: null,
  wind: null,           // { l:{filt,gain}, r:{...}, gain }
  carve: null,          // { filt, gain, pan }
  chat: null,           // { filt, gain, depth, lfo, lfoGain }
  rock: null,           // { roar, roarG, crack, crackG, sub, subG } — the rocket
  pump: null,           // { filt, gain } — the edge hiss of a loaded carve
  // per-frame state
  prevGrounded: true, prevVy: 0, stepDist: 0, stepSide: 1,
  rocketV: 0,           // 0..1 throttle, pushed in by boost.js each frame
  prevReleasing: false, // last frame's skiState().releasing, for the whump edge
  hissV: 0, whumps: 0,  // current hiss level and how many whumps have fired
  // ---- specs/0017. The crash reads the controller the way the landing edge
  // does, so main.js needs no wiring: wipeT rising is the wipe, canopyStem
  // changing to a new tree is the entry.
  prevWipeT: 0,         // last frame's ctrl.wipeT, for the rising edge
  prevStem: -1,         // last frame's ctrl.canopyStem
  prevSpeed: 0,         // last frame's speed in m/s — see wipe() below
  prevLat: 1,           // last frame's lateral velocity SIGN, for the shimmy pan
  panV: 0,              // the pan the wind/carve layers are sitting at
  shimCd: 0,            // s left of the shimmy cooldown
  wipes: 0, shimmies: 0, lastWhy: null,
  errors: 0,
};

// ------------------------------------------------------------------ context
function makeNoise(ctx) {
  const len = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function noiseSource(loop = true, offset = 0) {
  const src = A.ctx.createBufferSource();
  src.buffer = A.noiseBuf;
  src.loop = loop;
  src.start(0, offset % 2);
  return src;
}

function buildGraph() {
  const ctx = A.ctx;
  A.noiseBuf = makeNoise(ctx);

  A.master = ctx.createGain();
  A.master.gain.value = 0.75;                      // modest master
  A.comp = ctx.createDynamicsCompressor();
  A.comp.threshold.value = -18; A.comp.knee.value = 18; A.comp.ratio.value = 6;
  A.analyser = ctx.createAnalyser();
  A.analyser.fftSize = 2048;
  A.master.connect(A.comp);
  A.comp.connect(A.analyser);
  A.analyser.connect(ctx.destination);

  // ---- wind: two decorrelated noise paths for stereo width
  const mkWindSide = (pan, offset, detune) => {
    const src = noiseSource(true, offset);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 260 + detune; filt.Q.value = 0.4;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    const g = ctx.createGain(); g.gain.value = 1;
    src.connect(filt); filt.connect(g);
    if (p) { g.connect(p); return { filt, out: p }; }
    return { filt, out: g };
  };
  const wGain = ctx.createGain(); wGain.gain.value = 0;
  const wl = mkWindSide(-0.6, 0.31, 0);
  const wr = mkWindSide(0.6, 1.17, 55);
  wl.out.connect(wGain); wr.out.connect(wGain);
  wGain.connect(A.master);
  A.wind = { l: wl, r: wr, gain: wGain };

  // ---- carve hiss
  const cSrc = noiseSource(true, 0.77);
  const cFilt = ctx.createBiquadFilter();
  cFilt.type = 'bandpass'; cFilt.frequency.value = 2400; cFilt.Q.value = 0.75;
  const cGain = ctx.createGain(); cGain.gain.value = 0;
  const cPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  cSrc.connect(cFilt); cFilt.connect(cGain);
  if (cPan) { cGain.connect(cPan); cPan.connect(A.master); }
  else cGain.connect(A.master);
  A.carve = { filt: cFilt, gain: cGain, pan: cPan };

  // ---- edge chatter: band noise, amplitude-modulated by an LFO
  const hSrc = noiseSource(true, 1.53);
  const hFilt = ctx.createBiquadFilter();
  hFilt.type = 'bandpass'; hFilt.frequency.value = 1300; hFilt.Q.value = 1.6;
  const hGain = ctx.createGain(); hGain.gain.value = 0;       // centre = depth
  const lfo = ctx.createOscillator();
  lfo.type = 'square'; lfo.frequency.value = 28; lfo.start();
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;   // +/- depth
  lfo.connect(lfoGain); lfoGain.connect(hGain.gain);
  hSrc.connect(hFilt); hFilt.connect(hGain); hGain.connect(A.master);
  A.chat = { filt: hFilt, gain: hGain, lfo, lfoGain };

  // ---- rocket: three voices on one throttle. A lowpassed roar carries the
  // weight, a bandpass crackle sits on top of it so it reads as combustion
  // rather than as more wind, and a sub sine underneath is the part you feel.
  const rSrc = noiseSource(true, 0.19);
  const rFilt = ctx.createBiquadFilter();
  rFilt.type = 'lowpass'; rFilt.frequency.value = 300; rFilt.Q.value = 1.1;
  const rGain = ctx.createGain(); rGain.gain.value = 0;
  rSrc.connect(rFilt); rFilt.connect(rGain); rGain.connect(A.master);

  const kSrc = noiseSource(true, 1.91);
  const kFilt = ctx.createBiquadFilter();
  kFilt.type = 'bandpass'; kFilt.frequency.value = 1750; kFilt.Q.value = 0.7;
  const kGain = ctx.createGain(); kGain.gain.value = 0;
  kSrc.connect(kFilt); kFilt.connect(kGain); kGain.connect(A.master);

  const sOsc = ctx.createOscillator();
  sOsc.type = 'sawtooth'; sOsc.frequency.value = 46; sOsc.start();
  const sFilt = ctx.createBiquadFilter();
  sFilt.type = 'lowpass'; sFilt.frequency.value = 140; sFilt.Q.value = 0.7;
  const sGain = ctx.createGain(); sGain.gain.value = 0;
  sOsc.connect(sFilt); sFilt.connect(sGain); sGain.connect(A.master);

  A.rock = { roar: rFilt, roarG: rGain, crack: kFilt, crackG: kGain, sub: sOsc, subG: sGain };

  // ---- pump edge hiss: the sound of a ski that is actually gripping, as
  // opposed to the carve layer above, which only ever hears sideways speed and
  // so hisses just as loudly at a skid. This one is off the same shared noise
  // buffer, band-passed above the carve so the two stack instead of masking
  // each other, and it costs exactly one gain and one biquad.
  const pSrc = noiseSource(true, 1.31);
  const pFilt = ctx.createBiquadFilter();
  pFilt.type = 'bandpass'; pFilt.frequency.value = 2600; pFilt.Q.value = 0.85;
  const pGain = ctx.createGain(); pGain.gain.value = 0;
  pSrc.connect(pFilt); pFilt.connect(pGain); pGain.connect(A.master);
  A.pump = { filt: pFilt, gain: pGain };

  A.ok = true;
}

function ensureCtx() {
  if (A.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    A.ctx = new AC();
    buildGraph();
  } catch { A.errors++; A.ctx = null; }
}

function armResume() {
  const kick = () => {
    try {
      ensureCtx();
      if (A.ctx && A.ctx.state !== 'running') A.ctx.resume().catch(() => {});
    } catch { A.errors++; }
  };
  addEventListener('pointerdown', kick, { capture: true });
  addEventListener('keydown', kick, { capture: true });
}

// ------------------------------------------------------------------ one-shots
function running() { return A.ok && A.ctx && A.ctx.state === 'running'; }

function thump(impact) {
  if (!running()) return;
  const ctx = A.ctx, t = ctx.currentTime, u = A.u;
  const v = clamp(impact / (22 * u), 0.08, 1) * 0.9;
  // body: lowpassed noise burst
  const n = noiseSource(false, Math.random());
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 190; lp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  n.connect(lp); lp.connect(g); g.connect(A.master);
  n.stop(t + 0.45);
  // weight: pitch-dropping sine
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(92, t);
  o.frequency.exponentialRampToValueAtTime(36, t + 0.16);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(v * 0.7, t + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(og); og.connect(A.master);
  o.start(t); o.stop(t + 0.35);
}

// The pump paying out. Built like thump() but pitched an octave under it and
// less than half as long, because this is a shove out of the turn rather than
// a body arriving on the snow. A typical payout is 0.02-0.3 m/s and a very
// good one is about 1.0, so that is the range the amplitude is mapped over.
function whump(payout) {
  if (!running()) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const v = clamp(payout / 0.4, 0.05, 1) * 0.42;
  // body: a short, very dark noise burst — the ski unloading into the snow
  const n = noiseSource(false, Math.random());
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 120; lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v * 0.65, t + 0.010);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  n.connect(lp); lp.connect(g); g.connect(A.master);
  n.stop(t + 0.22);
  // weight: the part you feel, dropping fast so it never rings as a note
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(58, t);
  o.frequency.exponentialRampToValueAtTime(26, t + 0.09);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(v, t + 0.008);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  o.connect(og); og.connect(A.master);
  o.start(t); o.stop(t + 0.22);
}

function whoosh() {
  if (!running()) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const n = noiseSource(false, Math.random());
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.exponentialRampToValueAtTime(1900, t + 0.34);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  n.connect(bp); bp.connect(g); g.connect(A.master);
  n.stop(t + 0.5);
}

function trick() {
  try {
    if (!running()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    for (const [freq, vol] of [[1318.5, 0.12], [2637, 0.05]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g); g.connect(A.master);
      o.start(t); o.stop(t + 0.6);
    }
  } catch { A.errors++; }
}

function footstep(speedN) {
  if (!running()) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const n = noiseSource(false, Math.random());
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 950 + Math.random() * 350; bp.Q.value = 0.9;
  const g = ctx.createGain();
  const v = 0.028 + 0.05 * clamp(speedN / 8, 0, 1);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  A.stepSide = -A.stepSide;
  n.connect(bp); bp.connect(g);
  if (p) { p.pan.value = 0.22 * A.stepSide; g.connect(p); p.connect(A.master); }
  else g.connect(A.master);
  n.stop(t + 0.12);
}

// ------------------------------------------------------- specs/0017: crashes
//
// One normalisation for both one-shots: nothing below 4 m/s is a crash worth
// hearing and 20 m/s is as loud as it gets. A walking-pace `crossed` comes out
// a soft flump, a 20 m/s trunk is the full hit.
const CRASH_N = (spd) => clamp(((Number(spd) || 0) - 4) / 16, 0, 1);

// Somewhere to hang every voice of one crash so they share a pan and a level.
// Returns { bus, v } — `v` is the peak the noise body is allowed, which is the
// same number thump() reaches on its loudest landing: a crash must never be
// quieter than an arrival.
function crashBus(n01, pan) {
  const ctx = A.ctx;
  const g = ctx.createGain();
  g.gain.value = 1;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = clamp(pan, -0.85, 0.85); g.connect(p); p.connect(A.master); }
  else g.connect(A.master);
  return { bus: g, v: 0.9 * (0.22 + 0.78 * n01) };
}

// A short burst of band-limited noise on a bus. The clicks, the crack and the
// scrape are all this shape with different filters, so they share the code.
function burst(bus, { type, freq, q, at, rise, dur, gain }) {
  const ctx = A.ctx, t = ctx.currentTime + at;
  const n = noiseSource(false, Math.random());
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + rise);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(bus);
  n.stop(t + dur + 0.05);
}

// The needles. Band noise up where a fir actually is (2.5-5 kHz), chopped by a
// 6 Hz tremolo so it reads as a branch shaking rather than as more hiss, with a
// quieter 900 Hz copy underneath for the weight of the branch itself. Panned by
// the LAST frame's lateral velocity — the stem's position is not exposed, but
// where the body was going is where the tree it just hit is.
export function shimmy(strength) {
  try {
    A.shimmies++;
    if (!running()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const n01 = clamp(Number(strength) || 0, 0, 1);
    // ~0.5 of a crash ON THE ANALYSER, which is what §2 asks for and is not the
    // same as half its gain: the crash body is lowpassed at 120-400 Hz and this
    // is a narrow band four octaves up, so the same number would read a third as
    // loud. Measured against the trunk case and set from there.
    const v = 1.25 * (0.25 + 0.75 * n01);
    const { bus } = crashBus(n01, 0.5 * (A.prevLat >= 0 ? 1 : -1));

    // tremolo: one LFO drives the depth of both copies
    const trem = ctx.createGain();
    trem.gain.setValueAtTime(1 - 0.6 / 2, t);  // centre, so the swing is +/-0.3
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 6;
    const lg = ctx.createGain(); lg.gain.value = 0.6 / 2;
    lfo.connect(lg); lg.connect(trem.gain);
    lfo.start(t); lfo.stop(t + 0.85);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(v, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    trem.connect(env); env.connect(bus);

    for (const [freq, q, mul] of [[3200, 0.7, 1], [900, 0.9, 0.6]]) {
      const n = noiseSource(false, Math.random());
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = mul;
      n.connect(f); f.connect(g); g.connect(trem);
      n.stop(t + 0.8);
    }
  } catch { A.errors++; }
}

// The general crash: a body hitting snow at speed. Every `why` gets this much —
// 'landing', 'crossed', 'rotation', 'rock', 'tree' — and stone and wood each add
// their own top layer on it, so however you ate it, it reads as the same fall.
export function wipe(why, speedN) {
  try {
    A.wipes++;
    A.lastWhy = why == null ? null : String(why);
    if (!running()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const n01 = clamp(Number(speedN) || 0, 0, 1);
    const { bus, v } = crashBus(n01, A.panV);

    // body: a lowpassed noise burst whose cutoff falls away under it
    const n = noiseSource(false, Math.random());
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    n.connect(lp); lp.connect(g); g.connect(bus);
    n.stop(t + 0.25);

    // weight: the sine that makes it a body and not a gust
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v * 0.72, t + 0.010);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(og); og.connect(bus);
    o.start(t); o.stop(t + 0.32);

    // scrape: what is left of you sliding. Length is the speed — a flump stops
    // dead, a 20 m/s hit keeps going for most of half a second. Stone scrapes
    // through a tighter, lower band, which is what makes granite sound like
    // granite and not like a snowbank.
    const stone = why === 'rock';
    burst(bus, {
      type: 'bandpass', freq: stone ? 600 : 900, q: stone ? 2 : 0.8,
      at: 0.02, rise: 0.05, dur: 0.18 + 0.27 * n01, gain: v * 0.34,
    });

    if (stone) {
      // stone chatter: a handful of hard little clicks bouncing off the slab
      const clicks = 3 + (n01 > 0.5 ? 1 : 0);
      for (let i = 0; i < clicks; i++) {
        burst(bus, {
          type: 'highpass', freq: 2000, q: 0.9,
          at: 0.02 + (i / clicks) * 0.2 + Math.random() * 0.02,
          rise: 0.002, dur: 0.012, gain: v * 0.30,
        });
      }
    }

    if (why === 'tree') {
      // the crack: two short splinters at the peak, 45 ms apart
      burst(bus, { type: 'highpass', freq: 1800, q: 1.5, at: 0, rise: 0.003, dur: 0.025, gain: v * 0.55 });
      burst(bus, { type: 'highpass', freq: 1800, q: 1.5, at: 0.045, rise: 0.003, dur: 0.025, gain: v * 0.45 });
      shimmy(1);                                // the whole tree gets it
    }
  } catch { A.errors++; }
}

// ------------------------------------------------------------------- public
export function init(ctx) {
  try {
    if (A.ctrl && ctx && ctx.ctrl === A.ctrl) return;
    A.ctrl = ctx && ctx.ctrl || null;
    A.hud = ctx && ctx.hud || null;
    A.u = (A.ctrl && A.ctrl.T && A.ctrl.T.eyeHeight) ? A.ctrl.T.eyeHeight / 1.70 : 1;
    armResume();
    ensureCtx();               // may start suspended; the first gesture resumes it
    if (A.ctx && A.ctx.state !== 'running') A.ctx.resume().catch(() => {});
  } catch { A.errors++; }
}

export function update(dt) {
  if (!A.ok || !A.ctx) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    const c = A.ctrl, u = A.u, t = A.ctx.currentTime;
    const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, t, tc);
    if (!c) return;

    const paused = A.hud && A.hud.isPaused && A.hud.isPaused();
    const v = c.velocity;
    const s = c.speed();
    const sn = s / u;                             // normalized m/s
    const ski = c.mode === 'skis';
    const glide = c.mode === 'glider' && !c.grounded;
    const grounded = c.grounded;

    // ---- edges: landing / takeoff (skis; boots landings stay silent-ish)
    if (!paused) {
      if (grounded && !A.prevGrounded && (ski || c.mode === 'glider')) {
        const impact = Math.max(0, -A.prevVy);
        if (impact > 2.2 * u) thump(impact);
      }
      if (!grounded && A.prevGrounded && v && v.y > 1.2 * u) whoosh();
    }
    A.prevGrounded = grounded;
    A.prevVy = v ? v.y : 0;

    // ---- specs/0017: the crash and the canopy, read straight off the controller
    //
    // The wipe edge is wipeT rising. By the time it shows, the controller has
    // already scrubbed the velocity — the speed that tells you how hard the fall
    // was is the one measured on the PREVIOUS frame, so that is the number the
    // loudness comes from. wipeT sits above 0.5 for all but the last half-second
    // of the 2.0 s tumble (specs/0030 §1 lengthened it from 0.9), so a tumble
    // can only ever fire once: the edge needs it back at 0 first, and only a
    // fresh wipeout() can put it back up. None of the crash layers below is
    // timed off the span — the longest of them is 0.45 s — so 0030 moves this
    // comment and nothing else in this file.
    const wipeT = (c.wipeT || 0);
    if (A.prevWipeT <= 0 && wipeT > 0.5) {
      const why = (c.lastTrick || {}).why;
      wipe(why, CRASH_N(A.prevSpeed));
    }
    A.prevWipeT = wipeT;

    // The canopy edge is the stem index changing to a NEW tree — including
    // straight from one fir's foliage into the next, which is two entries.
    // canopyGuard parks it at -1 for the whole tumble, so a wipe cannot also
    // ring the needles; the cooldown is only there for a body threading a tight
    // glade faster than the ear can separate.
    A.shimCd = Math.max(0, A.shimCd - dt);
    const stem = (typeof c.canopyStem === 'number') ? c.canopyStem : -1;
    if (stem >= 0 && stem !== A.prevStem && A.shimCd <= 0) {
      A.shimCd = 0.25;
      shimmy(CRASH_N(A.prevSpeed));
    }
    A.prevStem = stem;

    // ...and the two numbers those two read next frame. The lateral sign is the
    // shimmy's pan: it is where the body was going, which is where the tree it
    // just went into is.
    A.prevSpeed = sn;
    if (v) {
      const lat = v.x * Math.cos(c.yaw) + v.z * -Math.sin(c.yaw);
      if (Math.abs(lat) > 1e-4) A.prevLat = lat >= 0 ? 1 : -1;
    }

    // ski.js keeps the pump state, so read it once a frame and only while the
    // skis are actually on — in any other gear it is stale and must not be
    // allowed to make a sound.
    const k = ski ? skiState() : null;

    // ---- continuous layers (skis only; everything ramps smoothly to 0)
    let windV = 0, windF = 260, carveV = 0, carveF = 2200, carveP = 0;
    let chatD = 0, chatF = 26;
    let hissV = 0, hissF = 2600;
    if (ski && !paused) {
      windV = 0.44 * Math.pow(clamp(sn / 30, 0, 1), 1.7) * (grounded ? 1 : 1.3);
      windF = 240 + 3000 * Math.pow(clamp(sn / 32, 0, 1), 1.4);

      if (grounded && s > 1e-3) {
        const yaw = c.yaw;
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const vr = v.x * rx + v.z * rz;           // lateral edge load
        const vrn = Math.abs(vr) / u;
        const keys = c.keys || {};
        const brake = !!(keys.back || keys.sprint);
        carveV = 0.5 * clamp(vrn / 7, 0, 1) * clamp(sn / 9, 0, 1);
        if (brake) carveV = Math.max(carveV, 0.42 * clamp(sn / 12, 0, 1));
        carveF = 1800 + 1300 * clamp(sn / 28, 0, 1);
        carveP = clamp(vr / (8 * u), -0.65, 0.65);

        // chatter: steep ground + speed
        const n = c.groundNormal ? c.groundNormal() : null;
        const slope = n ? Math.hypot(n.x, n.z) : 0;
        chatD = 0.30 * clamp((sn - 13) / 12, 0, 1) * clamp((slope - 0.25) / 0.35, 0, 1);
        chatF = 22 + sn * 0.55;

        // pump hiss: edge engagement times how hard the ski is being pressed.
        // Edge is the gate, so a flat ski and a straight-line traverse are both
        // silent no matter how fast they are; load is 1 g flat and about 2 g in
        // a committed carve, which is where the layer reaches full brightness.
        // Speed scales it too, otherwise a ski edged at a standstill hisses.
        if (k) {
          const grip = clamp(k.edge, 0, 1) * clamp((k.load - 0.9) / 1.1, 0, 1);
          hissV = 0.26 * grip * clamp(sn / 8, 0, 1);
          hissF = 2400 + 4200 * grip;
        }
      }
    }

    // ---- glider: the wing has one continuous voice and it is the wind over it.
    // Airspeed drives both level and brightness, hard (^1.8) so the difference
    // between a 14 m/s cruise and a 30 m/s dive is unmistakable with your eyes
    // shut. The flare adds a band of hiss — the membrane loading up.
    if (glide && !paused) {
      const g = gliderState();
      const an = g.airspeed / u;
      windV = 0.52 * Math.pow(clamp(an / 30, 0, 1), 1.8);
      windF = 220 + 3400 * Math.pow(clamp(an / 30, 0, 1), 1.3);
      if (g.flare || g.stall > 0.3) {
        carveV = 0.30 * clamp(an / 14, 0, 1);
        carveF = 900 + 700 * clamp(an / 24, 0, 1);
        carveP = 0;
      }
    }

    set(A.wind.gain.gain, windV, 0.09);
    set(A.wind.l.filt.frequency, windF, 0.08);
    set(A.wind.r.filt.frequency, windF * 1.13 + 40, 0.08);

    set(A.carve.gain.gain, carveV, 0.05);
    set(A.carve.filt.frequency, carveF, 0.06);
    if (A.carve.pan) set(A.carve.pan.pan, carveP, 0.08);
    A.panV = carveP;                              // where a crash lands in the field

    // ---- pump release: a payout starts on the frame releasing goes false to
    // true, and the whump is that instant. The one-shot drain ski.js exposes
    // belongs to the FX layer and can only be read once, so this watches the
    // edge itself and takes its size from the payout being spread.
    const rel = !!(ski && grounded && !paused && k && k.releasing);
    if (rel && !A.prevReleasing) { A.whumps++; whump(k.payout || 0); }
    A.prevReleasing = rel;

    A.hissV = hissV;
    set(A.pump.gain.gain, hissV, 0.05);
    set(A.pump.filt.frequency, hissF, 0.07);

    set(A.chat.gain.gain, chatD, 0.06);           // centre level
    set(A.chat.lfoGain.gain, chatD * 0.85, 0.06); // +/- swing around it
    set(A.chat.lfo.frequency, chatF, 0.1);

    // ---- rocket: the throttle boost.js pushed in, with the roar brightening
    // and the sub climbing as it comes up so ignition has a lift to it
    const rk = paused ? 0 : clamp(A.rocketV, 0, 1);
    set(A.rock.roarG.gain, 0.30 * rk, 0.05);
    set(A.rock.roar.frequency, 240 + 260 * rk, 0.08);
    set(A.rock.crackG.gain, 0.085 * rk, 0.05);
    set(A.rock.crack.frequency, 1500 + 900 * rk, 0.08);
    set(A.rock.subG.gain, 0.075 * rk, 0.06);
    set(A.rock.sub.frequency, 40 + 16 * rk, 0.12);

    // ---- footsteps: boots, on the ground, actually moving
    if (!ski && grounded && sn > 0.6 && !paused) {
      A.stepDist += s * dt;
      const stride = 1.55 * u * (0.85 + 0.45 * clamp(sn / 8, 0, 1));
      if (A.stepDist >= stride) { A.stepDist = 0; footstep(sn); }
    } else {
      A.stepDist = 0;
    }
  } catch { A.errors++; }
}

// RMS level off the analyser — used by headless tests (no speakers there)
export function level() {
  if (!A.analyser) return 0;
  const buf = new Uint8Array(A.analyser.fftSize);
  A.analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
  return Math.sqrt(sum / buf.length);
}

// boost.js pushes its throttle in here every frame (0 = motor out, 1 = full).
// A setter rather than a poll so audio.js keeps its "touches no other module"
// property — it never has to know boost.js exists.
export function rocket(v) {
  A.rocketV = clamp(Number(v) || 0, 0, 1);
}

export function state() {
  return {
    ok: A.ok, ctx: A.ctx ? A.ctx.state : 'none', errors: A.errors, unit: A.u, rocket: A.rocketV,
    pump: { hiss: A.hissV, whumps: A.whumps },
    // specs/0017 — counters, not events: a gate asserts on the delta across a run
    wipes: A.wipes, shimmies: A.shimmies, lastWhy: A.lastWhy,
  };
}

window.__playAudio = { init, update, trick, rocket, level, state, wipe, shimmy };
export default init;
