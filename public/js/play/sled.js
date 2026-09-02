// Sledding. A wooden toboggan, and the whole point is that you are not driving.
//
// Same module shape as ski.js / bike.js so the controller wiring is one more
// GEARS entry: SLED_TUNING / scaleSledTuning / sledStep / sledLand, a rack
// (SLED_MODELS) the locker can grow, and the two rigs the visuals need.
//
// Four ideas, and only one of them is yours:
//
//   1. GRAVITY DOWN THE FALL LINE — the same term ski.js uses (the ground
//      normal's horizontal part is the fall line, its length is sinθ). On a
//      toboggan it is the ONLY engine there is: there is no skate, no pedal, no
//      throttle. W does nothing. You point it and the hill decides.
//   2. LEAN STEER — you shift your weight and the runners argue about it. Half
//      a ski's steering authority, a third of its grip, and what grip there is
//      lets go early, so the back end comes round and stays round. Drifty by
//      construction, not by accident.
//   3. LOW DRAG ON A PITCH — a hardwood deck on steel runners is faster than
//      skis once it is pointed downhill: 1.02× fall-line gravity against a
//      quadratic drag well under the skis'. On a 25° face this arrives at the
//      31 m/s cap while a lab-standard ski settles around 26.
//   4. ...AND THE BILL. Everything above is bought with `flatFriction`: on
//      ground flatter than `flatSin` (~9°) the runners plough, and below
//      `stallSpeed` they bite outright. A toboggan that has run out onto a flat
//      is furniture. Get off and walk (tap E) — that is the joke, and it is why
//      the acceleration on the steep is worth anything.
//
// Sketchy at speed is a single number: `wipeTol` is NEGATIVE, so the landing
// that a ski forgives at 93° off-axis tumbles a sled at 74°. Airborne it is a
// brick — almost no air steer, almost no spin — which is exactly right: a sled
// flies straight, lands straight, or does not land at all.
//
// Boots physics live in controller.js and never come through here.

import { BRAND, pick } from './flags.js';

export const SLED_TUNING = {
  // ---- contract with the controller's ride path
  maxSpeed: 31,          // m/s — hard backstop; the drag below normally caps you
                         // just under it on anything steeper than ~24°
  snapMul: 2.2,          // × (speed·dt) — how hard we stay glued going downhill

  // ---- the hill does the work
  slopeAccel: 1.02,      // × gravity·sinθ along the fall line (skis: 0.92)
  glideFriction: 0.30,   // m/s² — constant snow drag while it is running free
  dragQuad: 0.0058,      // 1/m — quadratic drag; ~31 m/s on a 25° pitch

  // ---- the flats, which is where a sled dies
  flatSin: 0.16,         // sinθ (≈9.2°) at or above which the runners run free
  flatFriction: 5.0,     // m/s² — ploughing, at full flatness, tapering to 0 at flatSin
  stallSpeed: 2.2,       // m/s — below this, on flat ground, the runners bite
  stallFriction: 7.0,    // m/s² — extra decel at a standstill, ramping in from stallSpeed
                         // (both of these are gated by flatness, so a steep start
                         // from a standstill is never sticky)

  // ---- steering: weight shift, not edges
  grip: 3.4,             // 1/s — lateral bleed at a standstill (skis: 6.0)
  gripAtMax: 0.26,       // fraction of grip left at maxSpeed — the tail lets go early
  carveRecover: 0.22,    // share of scrubbed lateral speed handed back forward
  steer: 1.25,           // rad/s from A/D at a standstill (skis: 2.0)
  steerAtMax: 0.30,      // fraction of steer left at maxSpeed
  airSteer: 0.22,        // rad/s from A/D while airborne — a brick, on purpose
  spinTorque: 1.5,       // rad/s from ← → while airborne (skis: 6.4). No 360s.

  // ---- the only brake you have is your heels (S / SHIFT)
  brake: 5.0,            // m/s² — feeble next to a snowplow's 13
  brakeGrip: 2.2,        // × grip while dragging (lets you scrub the tail round)

  airDrag: 0.0016,       // 1/m — quadratic drag while airborne
  landBoost: 0.46,       // share of impact speed converted along the fall line
  landMin: 3.0,          // m/s — impacts softer than this convert nothing
                         // (also the floor under which a landing is not judged)

  // ---- camera bank (presentation; the physics never reads these)
  maxRoll: 0.30,         // rad — camera bank at full lateral load
  rollPerLateral: 0.055, // rad per m/s of across-the-sled velocity
  rollRate: 7,           // 1/s — bank smoothing
  deckRoll: 0.34,        // rad — how far the deck itself rocks onto a runner
  deckRollRate: 6.0,     // 1/s — deck roll smoothing

  // ---- per-model handles, all inert at their defaults
  popMul: 0.55,          // × the controller's jump velocity — you cannot really
                         // jump a sled, you can only leave the ground
  wipeTol: -0.28,        // rad PAST 90° before a landing is a wipeout. Negative:
                         // a sled tumbles at ~74° off-axis where a ski shrugs.
};

// Lengths/speeds/accelerations scale with the scene's unit; rates (1/s) and
// pure ratios do not; the quadratic drag coefficients are 1/length.
export function scaleSledTuning(u, over = {}) {
  const S = { ...SLED_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'glideFriction', 'flatFriction', 'stallSpeed',
    'stallFriction', 'brake', 'landMin']) S[k] *= u;
  for (const k of ['dragQuad', 'airDrag', 'rollPerLateral']) S[k] /= u;
  return S;
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrapPi = (a) => { const m = (a + Math.PI) % (2 * Math.PI); return (m < 0 ? m + 2 * Math.PI : m) - Math.PI; };

// One rider per page, so module state — the same trade ski.js and bike.js make.
// `flat` and `stall` are the two numbers that explain why you are not moving,
// so the HUD and the tests can read them; `deck` is the visual runner roll.
const st = {
  speed: 0, flat: 0, stall: 0, air: 0, deck: 0, roll: 0, prevYaw: 0, yaw: 0,
};

export function sledReset() {
  st.speed = 0; st.flat = 0; st.stall = 0; st.air = 0; st.deck = 0; st.roll = 0;
}

// Live snapshot for the HUD and the tests.
export function sledState() {
  return {
    speed: st.speed,
    flat: st.flat,           // 0..1 — how flat the ground under you reads
    stall: st.stall,         // 0..1 — how far into the stall band you are
    stalled: st.stall > 0.55 && st.flat > 0.4,
    airTime: st.air,
    deckRoll: st.deck,       // rad — the deck up on one runner
    deckRollDeg: st.deck * 180 / Math.PI,
    yaw: st.yaw,
  };
}

// One step of sled dynamics. Mutates ctx.vel (XZ only — the controller owns Y,
// gravity and ground contact) and returns the new yaw, camera bank and crouch.
//
// `crouch: 1` is not an animation flag: it is how the module says "you are
// sitting down". The camera rig sinks the eye by 0.30 m with it, which is the
// entire first-person difference between standing on skis and sitting on a
// plank, and it costs no wiring at all.
//
// ctx: { vel, yaw, keys, grounded, normal|null, gravity, dt, S, lean }
export function sledStep(ctx) {
  const { vel, keys, dt, S } = ctx;
  const drag = !!(keys.back || keys.sprint);        // heels down
  let yaw = ctx.yaw;

  const sp0 = Math.hypot(vel.x, vel.z);
  const fast = Math.min(1, sp0 / S.maxSpeed);

  // ---- steer. A/D and the arrows both just lean you; the mouse turns you as
  // well and the two add, exactly as on skis — there is simply much less of it.
  let turn = 0;
  if (keys.left) turn += 1;
  if (keys.right) turn -= 1;                        // +yaw is left (forward is -Z)
  let spin = 0;
  if (keys.spinLeft) spin += 1;
  if (keys.spinRight) spin -= 1;
  if (ctx.grounded) {
    const rate = S.steer * (1 - (1 - S.steerAtMax) * fast);
    yaw += (turn + spin) * rate * dt;
    st.air = 0;
  } else {
    // airborne: the arrows are the trick handles everywhere else. Here they are
    // a rounding error, because a sled in the air is a thrown brick.
    yaw += turn * S.airSteer * dt + spin * S.spinTorque * dt;
    st.air += dt;
  }

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // along the sled
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // across it

  if (ctx.grounded) {
    const n = ctx.normal;
    let nh = 0;

    // ---- 1. fall line
    if (n) {
      nh = Math.hypot(n.x, n.z);                    // = sinθ for a unit normal
      if (nh > 1e-4) {
        const a = ctx.gravity * Math.min(1, nh) * S.slopeAccel * dt;
        vel.x += (n.x / nh) * a;
        vel.z += (n.z / nh) * a;
      }
    }
    // how flat is this: 1 on the level, 0 on anything steeper than flatSin
    st.flat = S.flatSin > 1e-6 ? clamp01(1 - nh / S.flatSin) : 0;

    let vf = vel.x * fx + vel.z * fz;
    let vr = vel.x * rx + vel.z * rz;

    // ---- 2. runners. Same exponential bleed the ski edges use, with a third
    // of the authority and a much earlier let-go, which is the drift.
    let g = S.grip * (1 - (1 - S.gripAtMax) * fast);
    if (drag) g *= S.brakeGrip;
    const keep = Math.exp(-g * dt);
    const scrub = Math.abs(vr) * (1 - keep);
    vr *= keep;
    if (!drag && vf > 0.5) vf += scrub * S.carveRecover;

    // ---- 3. friction: free on a pitch, ruinous on the flat
    let sp = Math.hypot(vf, vr);
    st.stall = sp < S.stallSpeed ? clamp01(1 - sp / S.stallSpeed) : 0;
    if (sp > 1e-5) {
      let dec = (S.glideFriction + S.dragQuad * sp * sp) * dt;
      // The ploughing term and the stall bite are BOTH gated by flatness. That
      // gate is load-bearing: ungated, the stall friction at a standstill would
      // exceed fall-line gravity and a sled parked on a 25° face would never
      // start moving at all.
      if (st.flat > 0) dec += (S.flatFriction + S.stallFriction * st.stall) * st.flat * dt;
      if (drag) dec += S.brake * dt;
      const k = Math.max(0, sp - dec) / sp;
      vf *= k; vr *= k;
    }

    vel.x = fx * vf + rx * vr;
    vel.z = fz * vf + rz * vr;
  } else if (sp0 > 1e-5) {
    // airborne: momentum is yours, minus a little air
    const k = Math.max(0, sp0 - S.airDrag * sp0 * sp0 * dt) / sp0;
    vel.x *= k; vel.z *= k;
    st.stall = 0;
  }

  const sp = Math.hypot(vel.x, vel.z);
  if (sp > S.maxSpeed) {
    const k = S.maxSpeed / sp;
    vel.x *= k; vel.z *= k;
  }
  st.speed = sp;
  st.yaw = yaw;

  // ---- camera bank, from the lateral load actually being carried
  const load = vel.x * rx + vel.z * rz;
  const want = clamp(-load * S.rollPerLateral, -S.maxRoll, S.maxRoll);
  const lean = ctx.lean + (want - ctx.lean) * Math.min(1, S.rollRate * dt);
  st.roll = lean;

  // ---- DECK ROLL. Presentation only, and read by main.js off sledState():
  // the deck tips onto the inside runner in a turn. Command is the steering you
  // are actually asking for, including the mouse (measured the way ski.js
  // measures it), times how fast you are going.
  const dMouse = wrapPi(ctx.yaw - st.prevYaw);
  const mouseCmd = (dt > 1e-6 && Math.abs(dMouse) < 0.6)
    ? clamp(dMouse / dt / Math.max(0.5, S.steer), -1, 1) : 0;
  const cmd = clamp(turn + spin + mouseCmd, -1, 1);
  const wantDeck = cmd * clamp01(sp / S.maxSpeed / 0.55) * S.deckRoll * (ctx.grounded ? 1 : 0.35);
  st.deck += (wantDeck - st.deck) * Math.min(1, S.deckRollRate * dt);
  st.prevYaw = yaw;

  return { yaw, lean, crouch: 1, roll: st.deck };
}

// Landing on a pitch should send you on your way. Identical in shape to
// skiLand — a slice of the impact becomes speed down the fall line — with a
// slightly greedier share, because a toboggan has nothing to absorb it with.
export function sledLand(vel, impact, normal, S) {
  st.air = 0;
  if (!normal || impact < S.landMin) return;
  const nh = Math.hypot(normal.x, normal.z);
  if (nh < 1e-4) return;
  const add = Math.min(impact, 30) * S.landBoost * Math.min(1, nh);
  vel.x += (normal.x / nh) * add;
  vel.z += (normal.z / nh) * add;
}

// ============================================================== THE SLED RACK
//
// Data, exactly like the ski rack: the physics reads `tune` and nothing else,
// the visuals read `look` / `len` / `width`, the locker reads the derived stats.
// One entry today; the shape is here so the next three are one object each.
//
// `lab-toboggan` overrides NOTHING, so the numbers documented above are the
// numbers that run.

export const SLED_REF = { len: 165, width: 42 };    // geometry of lab-toboggan, cm

export const SLED_MODELS = [
  {
    id: 'lab-toboggan', name: pick('Lab Toboggan', 'House Toboggan'), brand: BRAND,
    disc: 'toboggan', group: 'lab', len: 165, width: 42,
    blurb: 'Ash slats, steel-shod runners, one hemp rope and no brakes worth the name. Faster than skis the moment it is pointed downhill and completely helpless the moment it is not.',
    look: {
      wood: '#b98a4a', grain: '#7a4f1e', ink: '#2a1e12',
      accent: '#ff4d00', rope: '#d9cdb4', pattern: 'lab',
    },
    spec: {
      length: '165 cm', width: '42 cm', deck: 'steamed ash', runners: 'steel-shod hardwood',
      rope: '8 mm hemp', mass: '6.8 kg',
    },
    tune: {},
  },
];

export const SLED_BY_ID = Object.fromEntries(SLED_MODELS.map((m) => [m.id, m]));
export const SLED_DEFAULT = 'lab-toboggan';

export function getSledModel(id) { return SLED_BY_ID[id] || SLED_BY_ID[SLED_DEFAULT]; }

// The tuning a given sled actually plays with, already scaled to the scene unit.
export function sledTuningFor(id, u = 1) { return scaleSledTuning(u, getSledModel(id).tune); }

// ---- the four bars in the locker, derived from the numbers rather than
// authored, so a card can never advertise something the physics does not do.
export function sledStats(m) {
  const T = { ...SLED_TUNING, ...(m.tune || {}) };
  // terminal speed on a 30° pitch (g = 16, sinθ = .5), capped by maxSpeed
  const drive = 16 * 0.5 * T.slopeAccel - T.glideFriction;
  const term = Math.min(T.maxSpeed, Math.sqrt(Math.max(0, drive) / T.dragQuad));
  return {
    turn: clamp01(T.steer / 4.0),
    speed: clamp01((term - 16) / 20),
    // stability is what a sled trades away: it is the wipe tolerance and the
    // grip that is left up top, and both are deliberately poor
    stab: clamp01(0.45 + T.wipeTol * 1.2) * clamp01(0.35 + T.gripAtMax),
    pop: clamp01(clamp01((T.popMul - 0.4) / 0.9) * 0.7 + clamp01(T.spinTorque / 12) * 0.3),
    // raw numbers the detail strip quotes
    term, steer: T.steer, spinTorque: T.spinTorque, popMul: T.popMul,
    wipeTol: T.wipeTol, flatFriction: T.flatFriction, stallSpeed: T.stallSpeed,
  };
}
for (const m of SLED_MODELS) m.stats = sledStats(m);

// ---- which sled you are on. ?sled=<id> beats the remembered pick beats the
// house toboggan; a URL override is deliberately NOT written back to storage.
const LS_KEY = 'poi-lab.play.sled';
export function resolveSledId(qs) {
  const q = qs && qs.get ? qs.get('sled') : null;
  if (q && SLED_BY_ID[q]) return q;
  try { const s = localStorage.getItem(LS_KEY); if (s && SLED_BY_ID[s]) return s; } catch { /* private mode */ }
  return SLED_DEFAULT;
}
export function rememberSledId(id) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
}

// ================================================================ the wood
// One painter, two consumers: a 128×512 deck strip that becomes the
// CanvasTexture on the 3D sled, and a side silhouette for the locker card.
// Both cached per model id. Painted NOSE-FIRST — y = 0 is the curl, y = H is
// the tail — so a painter reads down the length of the deck the way the ski
// topsheets read down a ski. Deterministic canvas 2D; nothing is ever loaded.

const _decks = new Map(), _thumbs = new Map();
const DECK_W = 128, DECK_H = 512;
const SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';

// a small deterministic PRNG so the grain is the same every load
function seeded(s) {
  let a = s >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

function tracked(x, s, size, track) {
  x.font = `700 ${size}px ${SANS}`;
  let w = 0;
  for (const ch of s) w += x.measureText(ch).width + track;
  return w - track;
}

function drawTracked(x, s, cx, cy, size, track, colour) {
  const w = tracked(x, s, size, track);
  let px = cx - w / 2;
  x.fillStyle = colour;
  x.font = `700 ${size}px ${SANS}`;
  x.textBaseline = 'middle';
  for (const ch of s) { x.fillText(ch, px, cy); px += x.measureText(ch).width + track; }
}

const PAINTERS = {
  // The house toboggan: seven ash slats running the length, the grain drawn
  // rather than noised (a noise field at this size reads as dirt), two knots,
  // and one orange lab band across the tail so it is findable at chase distance.
  lab(x, W, H, L) {
    x.fillStyle = L.wood;
    x.fillRect(0, 0, W, H);

    // ---- grain: long wavering strokes down the length
    const rnd = seeded(0x51ed);
    for (let i = 0; i < 90; i++) {
      const px = rnd() * W;
      const a = 0.06 + rnd() * 0.16;
      x.strokeStyle = L.grain;
      x.globalAlpha = a;
      x.lineWidth = 0.6 + rnd() * 1.6;
      x.beginPath();
      x.moveTo(px, -10);
      const bend = (rnd() - 0.5) * 26;
      x.bezierCurveTo(px + bend, H * 0.33, px - bend, H * 0.66, px + bend * 0.4, H + 10);
      x.stroke();
    }
    x.globalAlpha = 1;

    // ---- two knots, because one is an accident and three is a plank
    for (const [kx, ky, kr] of [[W * 0.31, H * 0.24, 7], [W * 0.68, H * 0.71, 5.5]]) {
      for (let r = kr * 2.6; r > 0.8; r -= 1.7) {
        x.strokeStyle = L.grain;
        x.globalAlpha = 0.45;
        x.lineWidth = 1.1;
        x.beginPath();
        x.ellipse(kx, ky, r, r * 0.62, 0.4, 0, Math.PI * 2);
        x.stroke();
      }
      x.globalAlpha = 1;
      x.fillStyle = L.ink;
      x.beginPath();
      x.ellipse(kx, ky, 2.4, 1.5, 0.4, 0, Math.PI * 2);
      x.fill();
    }

    // ---- the slat gaps: seven boards down the width
    x.fillStyle = 'rgba(42,30,18,.55)';
    for (let i = 1; i < 7; i++) x.fillRect(Math.round(W * i / 7) - 1, 0, 2, H);
    // and the cross battens the slats are pinned to
    x.fillStyle = 'rgba(42,30,18,.30)';
    for (const t of [0.16, 0.52, 0.88]) x.fillRect(0, Math.round(H * t), W, 5);
    // brass pins along them
    x.fillStyle = 'rgba(246,226,178,.55)';
    for (const t of [0.16, 0.52, 0.88]) {
      for (let i = 0; i < 7; i++) {
        x.beginPath();
        x.arc(W * (i + 0.5) / 7, H * t + 2.5, 1.8, 0, Math.PI * 2);
        x.fill();
      }
    }

    // ---- the lab band across the tail, and the mark on it
    x.fillStyle = L.accent;
    x.fillRect(0, H - 96, W, 34);
    x.save();
    x.translate(W / 2, H - 79);
    x.rotate(-Math.PI / 2);
    drawTracked(x, BRAND, 0, 0, 17, 4.5, L.ink);   // painted on the deck, so it is on screen in third person
    x.restore();
    // a hairline of the same orange up at the nose, so the curl reads as painted
    x.fillStyle = L.accent;
    x.fillRect(0, 26, W, 7);
  },
};

function paintDeck(m) {
  const c = document.createElement('canvas');
  c.width = DECK_W; c.height = DECK_H;
  const x = c.getContext('2d');
  const p = PAINTERS[m.look.pattern] || PAINTERS.lab;
  p(x, DECK_W, DECK_H, m.look);
  return c;
}

export function sledDeck(m) {
  const model = typeof m === 'string' ? getSledModel(m) : m;
  if (!_decks.has(model.id)) _decks.set(model.id, paintDeck(model));
  return _decks.get(model.id);
}

// ---- the locker thumbnail: a side view, nose (and its curl) to the right,
// drawn from the same length the 3D rig uses.
function paintThumb(m) {
  const W = 300, H = 92;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const L = m.look;
  const x0 = 18, x1 = W - 26;                 // tail → where the curl begins
  const deckY = H * 0.62, th = 9;

  // ---- the deck, with the wood strip drawn along it
  x.save();
  x.beginPath();
  x.moveTo(x0, deckY);
  x.lineTo(x1, deckY);
  x.quadraticCurveTo(x1 + 30, deckY, x1 + 20, deckY - 34);   // the curl
  x.lineTo(x1 + 9, deckY - 33);
  x.quadraticCurveTo(x1 + 18, deckY - 4, x1 - 2, deckY + th);
  x.lineTo(x0, deckY + th);
  x.closePath();
  x.clip();
  // the deck strip runs nose-first, so draw it rotated with y=0 at the right
  x.translate(x1 + 26, deckY - 40);
  x.rotate(Math.PI / 2);
  x.drawImage(sledDeck(m), 0, 0, 84, x1 - x0 + 46);
  x.restore();

  // ---- outline
  x.strokeStyle = 'rgba(23,22,20,.85)';
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(x0, deckY);
  x.lineTo(x1, deckY);
  x.quadraticCurveTo(x1 + 30, deckY, x1 + 20, deckY - 34);
  x.stroke();

  // ---- runners under it, and the two stanchions
  x.fillStyle = L.ink;
  x.fillRect(x0 + 4, deckY + th + 5, x1 - x0 - 4, 5);
  for (const t of [0.22, 0.72]) {
    const px = x0 + (x1 - x0) * t;
    x.fillRect(px, deckY + th, 6, 6);
  }

  // ---- the rope, hanging off the curl
  x.strokeStyle = L.rope;
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(x1 + 18, deckY - 30);
  x.quadraticCurveTo(x1 - 44, deckY - 46, x0 + 66, deckY - 12);
  x.stroke();

  return c;
}

export function sledThumbURL(m) {
  const model = typeof m === 'string' ? getSledModel(m) : m;
  if (!_thumbs.has(model.id)) _thumbs.set(model.id, paintThumb(model).toDataURL('image/png'));
  return _thumbs.get(model.id);
}

// ============================================================== the 3D sled
// Origin is the FEET — the same frame every body part in main.js uses — with
// -Z forward, so the rig drops into the third-person model group unchanged.
// Low-poly boxes and one canvas texture, matching the ski and bike rigs.

const _texes = new Map(), _rigs = new WeakMap();

function deckTexture(THREE, m) {
  if (!_texes.has(m.id)) {
    const t = new THREE.CanvasTexture(sledDeck(m));
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    _texes.set(m.id, t);
  }
  return _texes.get(m.id);
}

const hexDim = (hex, k) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return (r << 16) | (g << 8) | b;
};

const lamb = (THREE, c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e });

// point a box's -Z down `d`, the same helper main.js uses for the glider ribs
function aimAlong(mesh, d) {
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = Math.atan2(-d[0], -d[2]);
  mesh.rotation.x = Math.asin(Math.max(-1, Math.min(1, d[1] / (Math.hypot(d[0], d[1], d[2]) || 1))));
}

function strut(THREE, a, b, w, mat, u) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * u, w * u, len * u), mat);
  m.position.set((a[0] + b[0]) / 2 * u, (a[1] + b[1]) / 2 * u, (a[2] + b[2]) / 2 * u);
  aimAlong(m, d);
  return m;
}

// The curl. Four short deck segments walked round a quarter turn from the front
// of the deck, each one picking up where the last one ended — which is why it
// reads as bent wood rather than as four boxes at four angles.
function curlSegments(THREE, deckMat, u, { z0, y0, w, th, seg = 0.115, n = 4, a0 = 0.34, a1 = 1.48 }) {
  const out = [];
  let z = z0, y = y0, prev = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1));
    const mid = (prev + a) / 2;
    const cz = z - Math.cos(mid) * seg / 2, cy = y + Math.sin(mid) * seg / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * u, th * u, seg * 1.06 * u), deckMat);
    m.position.set(0, cy * u, cz * u);
    m.rotation.x = -mid;
    out.push(m);
    z -= Math.cos(mid) * seg; y += Math.sin(mid) * seg;
    prev = a;
  }
  return out;
}

// The rider, seated: legs forward along the deck, hands on the rope, torso
// upright and leaning back into the hill. Same palette as the skier in main.js
// so the person on the sled is recognisably the person who was on the skis.
function buildRider(THREE, u) {
  const jacket = lamb(THREE, 0xff4d00, 0x7a2500);
  const dark = lamb(THREE, 0x26231f, 0x12110f);
  const cream = lamb(THREE, 0xf4f1ea, 0x6b675f);
  const g = new THREE.Group();

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34 * u, 0.18 * u, 0.30 * u), dark);
  hips.position.set(0, 0.20 * u, 0.24 * u);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38 * u, 0.48 * u, 0.24 * u), jacket);
  torso.position.set(0, 0.51 * u, 0.27 * u);
  torso.rotation.x = -0.16;                        // leaning back a touch

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14 * u, 10, 8), cream);
  head.position.set(0, 0.88 * u, 0.22 * u);

  g.add(hips, torso, head);

  // legs: out front along the deck, knees a little up, boots braced on the curl
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.145 * u, 0.145 * u, 0.44 * u), dark);
    thigh.position.set(side * 0.105 * u, 0.165 * u, -0.06 * u);
    thigh.rotation.x = 0.10;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13 * u, 0.13 * u, 0.42 * u), dark);
    shin.position.set(side * 0.105 * u, 0.135 * u, -0.48 * u);
    shin.rotation.x = -0.06;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14 * u, 0.12 * u, 0.20 * u), lamb(THREE, 0x17161a, 0x0b0a09));
    boot.position.set(side * 0.105 * u, 0.15 * u, -0.72 * u);
    g.add(thigh, shin, boot);
  }

  // arms: down and forward onto the rope, which is the only control there is
  for (const side of [-1, 1]) {
    const sho = [side * 0.20, 0.66, 0.24], hand = [side * 0.19, 0.36, -0.20];
    g.add(strut(THREE, sho, hand, 0.095, jacket, u));
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.10 * u, 0.12 * u), cream);
    glove.position.set(hand[0] * u, hand[1] * u, hand[2] * u);
    g.add(glove);
  }
  return g;
}

// The whole vehicle. `rider: false` gives the bare sled (the locker's preview
// puts its own body on it); the default carries the seated rider.
export function makeSledRig(THREE, u = 1, opts = {}) {
  const g = new THREE.Group();
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x4a2f14 });
  const ink = lamb(THREE, 0x2a1e12, 0x140e08);
  const steel = lamb(THREE, 0x9aa0a6, 0x3d4045);
  const rope = lamb(THREE, 0xd9cdb4, 0x6a6153);

  const W = 0.42, TH = 0.045, LEN = 1.42;
  const deckY = 0.105, z0 = -0.60;                 // front edge of the flat deck

  // the deck itself, and the curl walked off the front of it
  const board = new THREE.Group();
  const flat = new THREE.Mesh(new THREE.BoxGeometry(W * u, TH * u, LEN * u), deckMat);
  flat.position.set(0, deckY * u, (z0 + LEN / 2) * u);
  board.add(flat);
  for (const s of curlSegments(THREE, deckMat, u, { z0, y0: deckY, w: W * 0.97, th: TH })) board.add(s);

  // side rails — two thin strips running the length, the thing your hands find
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035 * u, 0.075 * u, 1.16 * u), ink);
    rail.position.set(side * (W / 2 - 0.02) * u, (deckY + 0.06) * u, (z0 + 0.72) * u);
    board.add(rail);
    // two little stanchions holding each rail off the deck
    for (const z of [z0 + 0.28, z0 + 1.16]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.035 * u, 0.06 * u, 0.05 * u), ink);
      p.position.set(side * (W / 2 - 0.02) * u, (deckY + 0.01) * u, z * u);
      board.add(p);
    }
  }

  // steel-shod runners under the deck
  for (const side of [-1, 1]) {
    const run = new THREE.Mesh(new THREE.BoxGeometry(0.05 * u, 0.055 * u, 1.30 * u), steel);
    run.position.set(side * 0.155 * u, 0.035 * u, (z0 + 0.68) * u);
    board.add(run);
  }

  // the rope: off the curl, back to where the hands are
  const knot = [0, deckY + 0.30, z0 - 0.20];
  const hand = [0, 0.36, -0.20];
  const r1 = strut(THREE, knot, hand, 0.022, rope, u);
  board.add(r1);

  g.add(board);
  if (opts.rider !== false) g.add(buildRider(THREE, u));

  _rigs.set(g, { deckMat, board });
  return g;
}

export function styleSledRig(THREE, rig, m) {
  const r = _rigs.get(rig);
  if (!r) return;
  const model = typeof m === 'string' ? getSledModel(m) : (m || getSledModel(SLED_DEFAULT));
  r.deckMat.map = deckTexture(THREE, model);
  r.deckMat.emissive.setHex(hexDim(model.look.wood, 0.42));
  r.deckMat.needsUpdate = true;
}

// The deck's own roll, applied by the renderer: the board rocks onto the inside
// runner in a turn. Kept here so main.js asks for a pose and never has to know
// how the number was arrived at — the same deal rollSkiRigs makes.
// (No-op on the first-person rig, which has no board to roll — the camera does
// that job there.)
export function rollSledRig(rig, k = 1) {
  const r = _rigs.get(rig);
  if (r && r.board) r.board.rotation.z = st.deck * k;
  return st.deck * k;
}

// First person: you are sitting on the thing, so what you get is the deck
// running away from you, the rails either side and the curl standing up at the
// end of it — mounted on the camera like the fp skis, at hood height rather
// than at its true position, which would be entirely below a 72° gaze.
export function makeSledFP(THREE, u = 1, m) {
  const model = typeof m === 'string' ? getSledModel(m) : (m || getSledModel(SLED_DEFAULT));
  const g = new THREE.Group();
  const deckMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, emissive: hexDim(model.look.wood, 0.5), map: deckTexture(THREE, model),
  });
  const ink = lamb(THREE, 0x2a1e12, 0x171009);
  const rope = lamb(THREE, 0xd9cdb4, 0x8a8172);
  const cream = lamb(THREE, 0xf4f1ea, 0x8a877f);
  const jacket = lamb(THREE, 0xff4d00, 0x8a2c00);

  const Y = -0.92, Z = -1.10;                       // where the deck hangs off the eye
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.42 * u, 0.045 * u, 1.05 * u), deckMat);
  deck.position.set(0, Y * u, Z * u);
  g.add(deck);
  for (const s of curlSegments(THREE, deckMat, u, {
    z0: Z - 0.52, y0: Y, w: 0.41, th: 0.045, seg: 0.12, n: 4, a0: 0.36, a1: 1.5,
  })) g.add(s);

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035 * u, 0.075 * u, 0.95 * u), ink);
    rail.position.set(side * 0.195 * u, (Y + 0.055) * u, Z * u);
    g.add(rail);
  }

  // Your own gloves on the rope, and the rope running up to the knot on the
  // curl — the one thing that says you are holding on rather than watching.
  //
  // They sit FORWARD, not beside the lens. The first pass put the fists at
  // 0.76 m and they read as two orange slabs filling the bottom corners: a box
  // that close subtends more of the frame than the entire sled does. Pushed out
  // to a real arm's length they become hands, and the deck stays the subject.
  const knot = [0, Y + 0.30, Z - 0.62];
  for (const side of [-1, 1]) {
    const hand = [side * 0.185, Y + 0.34, Z + 0.06];
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.095 * u, 0.085 * u, 0.12 * u), cream);
    glove.position.set(hand[0] * u, hand[1] * u, hand[2] * u);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.09 * u, 0.15 * u), jacket);
    cuff.position.set(hand[0] * u, hand[1] * u, (hand[2] + 0.14) * u);
    g.add(glove, cuff, strut(THREE, hand, knot, 0.022, rope, u));
  }
  g.frustumCulled = false;
  // registered like the third-person rig (minus a board to roll) so one call to
  // styleSledRig repaints whichever of the two you hand it
  _rigs.set(g, { deckMat, board: null });
  return g;
}
