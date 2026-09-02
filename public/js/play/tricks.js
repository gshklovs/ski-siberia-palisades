// Tricks, combos and the personal leaderboard. Spec 0002 §3 and §4.
//
// Three ideas, and everything else is bookkeeping:
//
//   1. A TRICK IS TWO PROJECTED ACCUMULATORS, not a quaternion. The arrows drive
//      a spin accumulator and a flip accumulator, projected onto a tilted axis;
//      `hypot(spinAcc, flipAcc)` is the number the big text shows. Which axis, and
//      therefore which FAMILY of trick you are doing, is decided by WHICH KEY YOU
//      PRESSED FIRST — press order is the direction you throw it, which is what
//      the real distinction between a cork and a rodeo actually is.
//
//   2. THE FAMILY SETS THE LANDING RULE. A spin lands every 180°, a flip every
//      360°, a cork/bio only past 540° and then every 180°, and a misty/rodeo
//      only on 540° multiples. The inverted family used to run at ×0.80, and the
//      slower rate — +25 % hangtime to close the same angle — plus a narrower
//      window was what made it the high-risk branch rather than a free upgrade.
//      Greg asked for "diagonal rotations 20 % faster" on 2026-09-01, and BOTH
//      diagonals took the ×1.20: cork/bio ×1.12 → ×1.344, misty/rodeo
//      ×0.80 → ×0.96. So the inverted branch now costs +4 % hangtime (1/0.96),
//      not +25 %, and what still makes it the risky one is the 540° floor and
//      the 540°-only window rather than the rate. The windows themselves are in
//      DEGREES, so a faster rate reaches them sooner without moving them.
//
//      A pure vertical throw splits by the sign of v: ↑ is `flip` (front) and
//      ↓ is `flipBack` (back), two families that are identical in every number —
//      same tilt, rate, window, floor and BASE score — and differ only in the
//      name they announce. Same v < 0 convention as the cork/rodeo rows.
//
//   3. THE COMBO IS SSX-SHAPED. An unbanked active score and a multiplier; a
//      clean landing banks and raises the multiplier; a bail loses only the
//      unbanked part. Repeating a trick decays its value, which is the whole
//      reason there are eight families and not one.
//
// The landing verdict LAYERS on the controller's existing "skis crossed" rule
// (controller.js's wipeTol test) — that is checked first and is orthogonal, and
// this module is only ever a second opinion. See controller.setTrickJudge.
//
// main.js wires it:
//   import * as tricks from './tricks.js'
//   tricks.init({ ctrl, hud, poi, run, skiId: () => skiId, trail: () => '...' })
//   tricks.update(dt, live)        // once per frame
//   tricks.key(code)               // returns true when the key was consumed

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const TWO_PI = Math.PI * 2;
const wrapPi = (a) => a - TWO_PI * Math.round(a / TWO_PI);

export const TRICK_TUNING = {
  snapTolDeg: 25,        // ° to the nearest landing window that still counts as PERFECT
  sketchTolDeg: 55,      // ...and as SKETCHY: landed, half score, combo survives
  snapT: 0.12,           // s over which the yaw is eased onto the window
  comboGraceT: 2.0,      // s on the ground a combo survives...
  comboMinSpeed: 4.0,    // ...provided you are still moving this fast
  comboMaxMult: 20,
  // Both DIAGONAL rates carry Greg's 2026-09-01 "20 % faster" ×1.20.
  diagBonus: 1.344,      // × rate — cork/bio, the snappy diagonal (was 1.12)
  invertedRate: 0.96,    // × rate — misty/rodeo (was 0.80, the "+25% hangtime"
                         //   rule; at 0.96 the same angle costs only +4 %)
  underflipRate: 0.95,
  leadWindow: 0.25,      // s — after the first arrow, how long a second still counts as "also held"
  corkTilt: 0.45,        // rad — shallow tilt: the flip merges into the spin
  invTilt: 1.00,         // rad — steep tilt: the head passes under the skis
  pumpLinkEta: 1.20,     // a pump transition this clean links a combo...
  pumpLinkScore: 50,     // ...and is worth this, plus one multiplier
};

// BASE score per family, and the THPS3 rotation table — the one with the steep
// top end, so a 1080 is worth a great deal more than three 360s.
// `flipBack` scores exactly what `flip` scores: it is the same trick thrown the
// other way, not a harder one, and the only thing that differs is its name.
const BASE = { spin: 100, flip: 150, flipBack: 150, cork: 220, bio: 220, underflip: 260, misty: 300, rodeo: 300 };
const SPIN_MULT = [[180, 1.5], [360, 2], [540, 3], [720, 4], [900, 6], [1080, 8], [1260, 10], [1440, 13]];
// THPS3's variety decay, keyed on how many times this NAME has already appeared
// in THIS combo. Doing a Cork 720 four times is worth less than doing it once.
const VARIETY = [1.00, 0.75, 0.50, 0.25, 0.10];

function spinMult(deg) {
  let m = 1;
  for (const [d, v] of SPIN_MULT) { if (deg + 1e-6 >= d) m = v; else break; }
  // past the table, keep climbing rather than flat-lining a Triple Cork
  if (deg > 1440) m = 13 + (deg - 1440) / 180 * 3;
  return m;
}

const S = {
  ok: false, ctrl: null, hud: null, poi: '', run: '',
  skiId: () => '', trail: () => null,
  // ---- input, latched at takeoff and held for the airtime
  hDown: 0, vDown: 0,                 // -1/0/+1, live key state
  hAt: 0, vAt: 0,                     // when each axis was first pressed (s)
  t: 0,
  // ---- the air currently being flown
  air: false, airT: 0, spinAcc: 0, flipAcc: 0, firstAt: 0,
  family: null, tilt: 0, rate: 1, lead: null,
  // ---- landing snap
  snapLeft: 0, snapRad: 0, snapTilt: 0,
  // ---- combo
  combo: null,
  banked: 0,
  // ---- the board
  board: [], dot: false,
  // ---- last verdict, for tests
  last: null, lastEnd: null, wipes: 0, landed: 0,
  errors: 0,
};

// ---------------------------------------------------------------- the table
// `lead` is which axis was pressed FIRST; `h` is spinLeft−spinRight and `v` is
// flipFwd−flipBack (↑ = +1 = front). Spec §3.3, one row per line of that table.
function classify(h, v, lead) {
  const T = TRICK_TUNING;
  if (h === 0 && v === 0) return null;
  if (h !== 0 && v === 0) return { family: 'spin', tilt: 0, rate: 1.00, land: 180, min: 0 };
  // Pure vertical, and the SIGN OF v picks which way it went — the same v < 0
  // convention the cork/rodeo rows below use. ↓ (flipBack, v = −1) drives
  // flipAcc negative, main.js renders the flip as fpRig.rotateX(−flipAcc), and
  // a negative flipAcc therefore takes the ski TIPS UP and the rider over his
  // tails: that is the backward flip. ↑ is the front one. Every other number in
  // the two rows is identical, so `flipBack` is `flip` under a different name.
  if (h === 0 && v !== 0) {
    return { family: v < 0 ? 'flipBack' : 'flip', tilt: Math.PI / 2, rate: 1.00, land: 360, min: 0 };
  }
  // both axes. Underflip is the odd one out: ↓ and ↑ together, no horizontal.
  if (lead === 'spin') {
    // spin-led: shallow tilt, non-inverted, the flip merges into the spin
    return v < 0
      ? { family: 'cork', tilt: T.corkTilt, rate: T.diagBonus, land: 180, min: 540 }
      : { family: 'bio', tilt: T.corkTilt, rate: T.diagBonus, land: 180, min: 540 };
  }
  // flip-led: steep tilt, fully inverted, and it only lands on 540 multiples
  return v < 0
    ? { family: 'rodeo', tilt: T.invTilt, rate: T.invertedRate, land: 540, min: 540 }
    : { family: 'misty', tilt: T.invTilt, rate: T.invertedRate, land: 540, min: 540 };
}

// Prefix by rotation count, so a 1260 on the cork axis reads `Double Cork 1260`.
function trickName(fam, deg) {
  const round = Math.max(0, Math.round(deg / 180) * 180);
  if (fam === 'spin') return String(round || 180);
  if (fam === 'flip') return round >= 720 ? 'Double Front Flip' : 'Front Flip';
  if (fam === 'flipBack') return round >= 720 ? 'Double Back Flip' : 'Back Flip';
  if (fam === 'underflip') return 'Underflip' + (round ? ' ' + round : '');
  const pre = round >= 1080 ? 'Triple ' : (round >= 720 ? 'Double ' : '');
  const label = fam === 'cork' ? 'Cork' : fam === 'bio' ? 'Bio' : fam === 'misty' ? 'Misty' : 'Rodeo';
  return pre + label + ' ' + round;
}

// D-Spin is a cork thrown with so much flip in it that it stops reading as a
// cork — RR's own distinction, and it costs nothing to honour.
function displayName(v) {
  if (v.family === 'cork' && Math.abs(v.flipAcc) >= 360) {
    const round = Math.round(v.deg / 180) * 180;
    const pre = round >= 1080 ? 'Triple ' : (round >= 720 ? 'Double ' : '');
    return pre + 'D-Spin ' + round;
  }
  return v.name;
}

// ---- how far the rotation is from a valid landing window, signed, in degrees.
// `land` is the window spacing and `min` the floor below which nothing counts.
function landingErr(deg, rule) {
  if (rule.min && deg < rule.min - 1e-6) return null;    // below the floor: no window exists
  const base = rule.min && rule.land === 540 ? rule.land : rule.land;
  const k = Math.round(deg / base);
  const target = Math.max(rule.min || base, k * base);
  return deg - target;
}

// ============================================================ the leaderboard
const LS_KEY = 'poi-lab.play.tricks';

// A top-N score board in localStorage, and the ONE implementation of it. The
// guided run's race board (guide.js) is the same shape on a different key —
// same read/sort/cut/write, same failure modes (private mode, quota, somebody
// else's JSON on the key), so it is the same code with the key passed in
// rather than a second copy that drifts.
export function boardStore(key, limit = 10) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch { return []; }      // private mode, quota, or somebody else's JSON
  };
  const write = (a) => {
    try { localStorage.setItem(key, JSON.stringify(a)); } catch { /* private mode */ }
  };
  // one array for every run ever, filtered at display time, so a panel can show
  // both "best here" and "best anywhere" without a second key
  const save = (rec) => {
    const all = read();
    all.push(rec);
    all.sort((a, b) => (b.score || 0) - (a.score || 0));
    const rows = all.slice(0, limit);
    write(rows);
    return { rows, rank: rows.indexOf(rec) };    // rank −1 = did not make it
  };
  const clear = () => { try { localStorage.removeItem(key); } catch { /* private mode */ } };
  return { key, limit, read, write, save, clear };
}

const BOARD = boardStore(LS_KEY);

const readBoard = () => BOARD.read();

function saveRun(rec) {
  try {
    const { rows, rank } = BOARD.save(rec);
    S.board = rows;
    return rank;
  } catch { S.errors++; return -1; }
}

const AGO = [[86400000 * 365, 'y'], [86400000 * 30, 'mo'], [86400000, 'd'], [3600000, 'h'], [60000, 'm']];
export function ago(t) {
  const d = Date.now() - (t || 0);
  if (d < 60000) return 'just now';
  for (const [ms, u] of AGO) if (d >= ms) return Math.floor(d / ms) + u + ' ago';
  return 'just now';
}

function boardRows() {
  return S.board.map((r, i) => ({
    rank: i + 1, score: r.score, mult: r.mult, best: r.best,
    ski: r.ski, trail: r.trail || r.run || null, when: ago(r.t),
    you: !!(S.lastEnd && r === S.lastEnd.rec),
  }));
}

// ================================================================== the combo
function startCombo() {
  if (S.combo) return S.combo;
  S.combo = {
    active: 0, mult: 1, tricks: [], names: {}, fams: {},
    deg: 0, pumps: 0, t0: S.t, graceT: 0, best: null, bestScore: 0,
  };
  return S.combo;
}

function addTrick(c, name, fam, deg, quality) {
  const n = (c.names[name] || 0);
  const variety = VARIETY[Math.min(n, VARIETY.length - 1)];
  const score = Math.round(BASE[fam] * spinMult(deg) * variety * quality);
  c.names[name] = n + 1;
  c.active += score;
  // THPS convention: +1 per landed trick, +1 more for a family not yet used
  c.mult = Math.min(TRICK_TUNING.comboMaxMult, c.mult + 1 + (c.fams[fam] ? 0 : 1));
  c.fams[fam] = true;
  c.tricks.push(name);
  c.deg += deg;
  if (score > c.bestScore) { c.bestScore = score; c.best = name; }
  return score;
}

function endCombo(bailed) {
  const c = S.combo;
  S.combo = null;
  if (!c || (!c.tricks.length && !c.pumps)) return null;
  if (bailed) {
    // a bail loses the UNBANKED portion only, which is the whole of it here —
    // the multiplier was never spent
    S.lastEnd = { score: 0, mult: c.mult, tricks: c.tricks, bailed: true, deg: c.deg, pumps: c.pumps };
    if (S.hud && S.hud.comboEnd) S.hud.comboEnd({ score: 0, mult: c.mult, tricks: c.tricks, best: c.best, deg: Math.round(c.deg), pb: false, bailed: true });
    return S.lastEnd;
  }
  const total = Math.round(c.active * c.mult);
  S.banked += total;
  const rec = {
    score: total, mult: c.mult, best: c.best, tricks: c.tricks.slice(0, 8),
    deg: Math.round(c.deg), poi: S.poi, run: S.run, trail: S.trail(),
    ski: S.skiId(), pumps: c.pumps, t: Date.now(),
    dur: +(S.t - c.t0).toFixed(1),
  };
  const rank = total > 0 ? saveRun(rec) : -1;
  const pb = rank === 0;
  S.lastEnd = { ...rec, rank, pb, rec };
  if (rank >= 0 && S.hud && S.hud.setBoardDot) { S.dot = true; S.hud.setBoardDot(true); }
  if (S.hud && S.hud.comboEnd) {
    S.hud.comboEnd({ score: total, mult: c.mult, tricks: c.tricks, best: c.best, deg: Math.round(c.deg), pb });
  }
  return S.lastEnd;
}

// ==================================================================== public
export function init(ctx) {
  try {
    if (S.ok || !ctx) return;
    S.ctrl = ctx.ctrl; S.hud = ctx.hud;
    S.poi = ctx.poi || ''; S.run = ctx.run || '';
    if (ctx.skiId) S.skiId = ctx.skiId;
    if (ctx.trail) S.trail = ctx.trail;
    S.board = readBoard();
    S.dot = S.board.length > 0;
    if (S.hud && S.hud.setBoardDot) S.hud.setBoardDot(S.dot);
    if (S.ctrl && S.ctrl.setTrickJudge) S.ctrl.setTrickJudge(judge);
    S.ok = true;
  } catch { S.errors++; }
}

// The controller's second opinion on a landing it has already cleared on the
// "skis crossed" rule. Returns { wipe, why, snapYaw } or null.
function judge(info) {
  try {
    if (!S.ok || info.mode !== 'skis') return null;
    const T = TRICK_TUNING;
    const deg = Math.hypot(S.spinAcc, S.flipAcc);
    const fam = S.family;
    // no arrow-driven rotation at all: nothing to judge, the old rules stand
    if (!fam || deg < 90) { S.family = null; return null; }
    // tolerances scale with the ski's own forgiveness, exactly as the rack
    // already scales everything else: the ARV 84 will forgive almost anything
    // and the White Star 210 will forgive nothing.
    // ...but CAPPED against the family's own window. The spec's bare
    // 25 deg x (1 + wipeTol/0.06) hands the ARV 84 (wipeTol 0.45) a 212 deg
    // tolerance, which is wider than the 180 deg window it is being measured
    // against — every landing would be perfect and the whole rotation rule would
    // be dead on the one ski most likely to be doing tricks. Forgiveness has to
    // stop short of the window meaning nothing.
    const wt = info.S && info.S.wipeTol != null ? info.S.wipeTol : 0.06;
    const forgive = 1 + wt / 0.06;
    const win = fam.land;
    const snapTol = Math.min(T.snapTolDeg * forgive, win * 0.30);
    const sketchTol = Math.max(snapTol, Math.min(T.sketchTolDeg * forgive, win * 0.48));

    // Cork and bio under 540° are ALWAYS a wipeout, however square the landing —
    // you are still corked over. This is what stops the cork family from being a
    // strictly better spin.
    if (fam.min && deg < fam.min) {
      S.wipes++;
      S.last = { name: trickName(fam.family, deg), family: fam.family, deg: Math.round(deg), verdict: 'wipe', why: 'unfinished' };
      return { wipe: true, why: 'unfinished' };
    }
    const err = landingErr(deg, fam);
    if (err === null) { S.wipes++; return { wipe: true, why: 'unfinished' }; }
    const ae = Math.abs(err);
    let quality = 1, verdict = 'perfect';
    if (ae > sketchTol) {
      S.wipes++;
      S.last = { name: trickName(fam.family, deg), family: fam.family, deg: Math.round(deg), err: +err.toFixed(1), verdict: 'wipe', why: 'rotation' };
      return { wipe: true, why: 'rotation' };
    }
    if (ae > snapTol) { quality = 0.5; verdict = 'sketchy'; }

    // landed. Snap the body square to the window over snapT — the stumble is
    // what SKETCHY costs you, not the score alone.
    S.snapRad = -err * D2R;
    // ...ON THE AXIS THE ROTATION WAS THROWN ON. `err` is the residual of
    // `hypot(spinAcc, flipAcc)`, which for a pure flip is entirely flipAcc — and
    // this used to be spent entirely on YAW regardless, so an under-rotated
    // front OR back flip turned the rider up to 48 deg sideways on landing
    // (90 deg on a double) for a rotation that never touched the heading. Greg:
    // "some of my front flip landings turn me kind of sideways for no reason."
    // `flipBack` carries the same tilt (PI/2) as `flip`, so it gets the same
    // fix — the axis is the family's, and both flip families fly the same axis.
    S.snapTilt = fam.tilt;
    S.snapLeft = T.snapT;

    const c = startCombo();
    // The family already knows which way the flip went (classify() picked
    // `flipBack` off the sign of v at takeoff), so the name comes straight off
    // it. This used to re-derive the direction from S.vDown — the LIVE key state
    // at touchdown — which reads 0 for anybody who lets go of the arrow before
    // landing, i.e. every back flip that was not still being thrown on impact.
    const name = trickName(fam.family, deg);
    const shown = displayName({ family: fam.family, flipAcc: S.flipAcc, deg, name });
    const score = addTrick(c, shown, fam.family, deg, quality);
    S.landed++;
    S.last = {
      name: shown, family: fam.family, deg: Math.round(deg), err: +err.toFixed(1),
      verdict, score, mult: c.mult, active: c.active,
      spin: Math.round(S.spinAcc), flip: Math.round(S.flipAcc),
    };
    if (S.hud && S.hud.trick) S.hud.trick({ name: shown, deg: Math.round(deg), sketchy: verdict === 'sketchy' });
    return { wipe: false, snapYaw: info.yaw };     // the ease is applied in update()
  } catch { S.errors++; return null; }
}

export function update(dt, live) {
  if (!S.ok) return;
  try {
    if (!live) return;
    dt = Math.min(0.05, Math.max(0.0005, dt || 0.016));
    S.t += dt;
    const c = S.ctrl, keys = c.keys;
    const T = TRICK_TUNING;
    const onSkis = c.mode === 'skis';

    // ---- press order. `lead` is whichever axis went down first, latched inside
    // leadWindow and then held for the whole airtime: press order IS the throw.
    const h = (keys.spinLeft ? 1 : 0) + (keys.spinRight ? -1 : 0);
    const v = (keys.flipFwd ? 1 : 0) + (keys.flipBack ? -1 : 0);
    if (h !== 0 && S.hDown === 0) S.hAt = S.t;
    if (v !== 0 && S.vDown === 0) S.vAt = S.t;
    S.hDown = h; S.vDown = v;

    const air = onSkis && !c.grounded;
    if (air && !S.air) {                       // takeoff
      S.air = true; S.airT = 0; S.spinAcc = 0; S.flipAcc = 0; S.family = null;
      // Press order is press order WITHIN THIS AIR. An arrow that was already
      // held on the way up is pressed "at takeoff", and two arrows already held
      // are simultaneous — otherwise a key left down from the last jump dates
      // back seconds and silently decides the family of this one.
      S.hAt = h !== 0 ? S.t : 0;
      S.vAt = v !== 0 ? S.t : 0;
    } else if (!air) {
      // On the snow there is no trick in progress, so the accumulators are zero
      // and the family is unlatched — every frame, not just on the landing edge.
      // A respawn, a teleport, a gear change and a lift ride all land here too,
      // and none of them should be able to leave 3000° of spin lying around for
      // the next jump to inherit.
      S.air = false; S.airT = 0; S.spinAcc = 0; S.flipAcc = 0; S.family = null;
    }

    if (S.air) {
      S.airT += dt;
      // ↓ and ↑ together with no horizontal is the on-axis underflip, and an
      // auto-180 of spin rides along with it
      const under = keys.flipFwd && keys.flipBack && h === 0;
      let rule;
      if (under) rule = { family: 'underflip', tilt: Math.PI / 2, rate: T.underflipRate, land: 360, min: 0 };
      else {
        const lead = (h !== 0 && v !== 0)
          ? (Math.abs(S.hAt - S.vAt) <= T.leadWindow ? (S.hAt <= S.vAt ? 'spin' : 'flip') : (S.hAt < S.vAt ? 'spin' : 'flip'))
          : null;
        rule = classify(h, v, lead);
      }
      // The family is LATCHED for the airtime — letting go of one arrow mid-cork
      // does not turn it into a spin halfway through — but not INSTANTLY. With
      // digital keys the second half of a diagonal always lands a frame or two
      // after the first, so latching on the very first key would make every
      // diagonal a plain spin or a plain flip. leadWindow is exactly the grace
      // for that: inside it the family can still be upgraded, and the press order
      // inside it is what picks cork-vs-rodeo.
      if (rule) {
        if (!S.family) { S.family = rule; S.firstAt = S.t; }
        else if (S.t - S.firstAt <= T.leadWindow) S.family = rule;
      }
      const R = S.family || rule;
      if (R && (h !== 0 || v !== 0 || under)) {
        // normalize so a diagonal is not 1.41× as fast as an axis
        const m = Math.max(1, Math.hypot(h, under ? 1 : v));
        const torque = (c.S && c.S.spinTorque ? c.S.spinTorque : 6.4) * R.rate;
        const hv = under ? 0.5 : h / m;         // the underflip's auto-180
        const vv = under ? 1 : v / m;
        S.spinAcc += torque * hv * Math.cos(R.tilt) * dt * R2D;
        S.flipAcc += torque * vv * Math.sin(R.tilt) * dt * R2D;
      }
    }

    // ---- the landing snap: ease the body square onto the window over snapT
    if (S.snapLeft > 0) {
      const k = Math.min(1, dt / S.snapLeft);
      const step = S.snapRad * k;
      // Decomposed exactly the way the accumulators were composed a few lines
      // up — `spinAcc += ... cos(tilt)`, `flipAcc += ... sin(tilt)` — so the
      // residual is paid back onto the same two axes it was earned on. A spin
      // (tilt 0) is bit-for-bit the yaw-only snap this has always been; a flip
      // (tilt PI/2) puts nothing at all into the heading; a cork or a rodeo
      // splits it the way it split the rotation.
      const tl = S.snapTilt || 0;
      c.setYaw(c.yaw + step * Math.cos(tl));
      if (c.setPitch) c.setPitch(c.pitch + step * Math.sin(tl));
      S.snapRad -= step;
      S.snapLeft -= dt;
      if (S.snapLeft <= 0) { S.snapRad = 0; S.snapLeft = 0; }
    }

    // ---- combo links. Airborne always; on the ground only while you are still
    // moving, and only for the grace window.
    if (S.combo) {
      const wiped = c.wipeT > 0;
      if (wiped) endCombo(true);
      else if (!onSkis) endCombo(false);
      else if (!c.grounded) S.combo.graceT = 0;
      else if (c.speed() < T.comboMinSpeed) endCombo(false);
      else {
        S.combo.graceT += dt;
        if (S.combo.graceT > T.comboGraceT) endCombo(false);
      }
    }

    if (S.hud && S.hud.combo) {
      S.hud.combo(S.combo
        ? { on: true, score: S.combo.active, mult: S.combo.mult, count: S.combo.tricks.length }
        : { on: false });
    }
  } catch { S.errors++; }
}

// A pump transition clean enough to count welds §1 to §3: it links a combo
// across flat ground, so a trick line can be carried by carving well. main.js
// calls this from the frame loop with the ski's own eta.
export function pumpLink(eta) {
  try {
    if (!S.ok || !(eta >= TRICK_TUNING.pumpLinkEta)) return false;
    const c = startCombo();
    c.graceT = 0;
    c.active += TRICK_TUNING.pumpLinkScore;
    c.mult = Math.min(TRICK_TUNING.comboMaxMult, c.mult + 1);
    c.pumps++;
    return true;
  } catch { S.errors++; return false; }
}

// double-tap L opens the board. main.js routes the key here; nothing about it
// is in the pause panel, which is exactly what makes it secret (§4.3).
let _lAt = 0;
export function key(code) {
  if (!S.ok) return false;
  try {
    if (code === 'Escape' && S.hud && S.hud.boardOpen && S.hud.boardOpen()) { S.hud.board(null); return true; }
    if (code !== 'KeyL') return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (S.hud && S.hud.boardOpen && S.hud.boardOpen()) { S.hud.board(null); _lAt = 0; return true; }
    if (now - _lAt < 400) { _lAt = 0; if (S.hud && S.hud.board) S.hud.board(boardRows()); return true; }
    _lAt = now;
    return false;
  } catch { S.errors++; return false; }
}

export function state() {
  return {
    ok: S.ok, errors: S.errors,
    air: S.air, airT: +S.airT.toFixed(2),
    spinAcc: Math.round(S.spinAcc), flipAcc: Math.round(S.flipAcc),
    deg: Math.round(Math.hypot(S.spinAcc, S.flipAcc)),
    family: S.family ? S.family.family : null,
    tilt: S.family ? S.family.tilt : 0,
    last: S.last, lastEnd: S.lastEnd,
    landed: S.landed, wipes: S.wipes, banked: S.banked,
    combo: S.combo
      ? { active: S.combo.active, mult: S.combo.mult, tricks: S.combo.tricks.slice(), deg: Math.round(S.combo.deg), pumps: S.combo.pumps, graceT: +S.combo.graceT.toFixed(2) }
      : null,
    board: boardRows(), dot: S.dot,
  };
}

// tests only: wipe the saved board so a run starts from nothing
export function clearBoard() {
  BOARD.clear();
  S.board = []; S.dot = false;
  if (S.hud && S.hud.setBoardDot) S.hud.setBoardDot(false);
  return true;
}

// the blended rotation axis, for the renderer: normalize(up·(h/m)·cos τ + right·(v/m)·sin τ)
export function trickPose() {
  if (!S.air || !S.family) return null;
  return { spin: S.spinAcc * D2R, flip: S.flipAcc * D2R, tilt: S.family.tilt, family: S.family.family };
}

export default init;
