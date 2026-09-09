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

// ====================================================== specs/0057 §4 — JIBS
// SCORING ON A JIB, in the currency a spin's BASE 100 already sets. `BASE`,
// `SPIN_MULT` and `VARIETY` above are untouched (§0 "what stays").
//
// D8 IS THE WHOLE SHAPE OF IT: "all features same multiplier, but tricks on the
// feature add". So there is ONE base rate per second on ALL SEVEN JIBS — a 28 m
// dance floor beats a 17 m box only because you are on it longer, never because
// it is worth more per metre — and everything you DO up there is an addition on
// top of that rate. No per-feature multiplier exists anywhere below.
//
// AND THE ADDS DO NOT RAISE `mult`. Switch-ups go straight into `c.active` and
// deliberately do NOT go through `addTrick()`: at 75 points and one crossing per
// half-second a 180° yaw would walk the multiplier to `comboMaxMult` 20 in about
// four seconds, and the cap would stop being something you earn. The jib raises
// `mult` ONCE, on a clean exit, by `addTrick`'s own convention — +1 for the
// feature and +1 more the first time the family `jib` appears.
export const JIB_TUNING = {
  RATE: 60,          // points/second while `railOn`, on any jib (§4.1)
  MIN_T: 0.30,       // s — THE MICRO-HOP RULE. Under this a jib scores nothing
                     //   AND counts as nothing: no points, no name, no mult, and
                     //   it cannot start a combo. Clipping the end of a box on
                     //   the way past is not a rail trick.
  ENTRY_YAW: 40,     // per 90° of yaw at lock-on (§4.2) — sliding in sideways
  ENTRY_CAP: 80,     //   ...stopping at two units: 0° = 0, 90° = 40, 180° = 80
  SWITCHUP: 75,      // each 90° crossing (§3.1), straight into `active`
  ONOFF: 1.25,       // × the AIR'S OWN trick when it was thrown onto or off a
                     //   jib (§4.2). Once per air, never twice.
  PRESS_RATE: 45,    // points/second, grab held on a jib...
  PRESS_YAW: 30,     // ...and only within this of 0° or 180°: a 50-50 or a
                     //   switch 50-50. Near ±90° both hands are busy holding the
                     //   slide — the grab shows and pays nothing ("if the pose
                     //   allows", Greg).
};

// specs/0057 §4 — THE ONLY DOOR INTO R1's MODULE, and it is read-only: `on()`
// and `state()`, the two signatures §9 pinned before any of R1/R2/R3/F1 began.
// Defensive throughout, because a world with no park in it (the bench boots
// several) must cost this file nothing and must never throw inside the frame
// loop that scores a run.
function railNow() {
  try {
    const rl = typeof window !== 'undefined' ? window.__rail : null;
    if (!rl || typeof rl.on !== 'function' || typeof rl.state !== 'function') return null;
    const st = rl.state();
    if (!st) return null;
    return { on: !!rl.on(), id: st.jib, type: st.type || 'rail',
             yaw: Number(st.yaw) || 0, entryYaw: Number(st.entryYaw) || 0,
             sw: st.switchUps | 0, popped: !!st.popped, t: Number(st.t) || 0 };
  } catch { return null; }
}

// specs/0057 §4.2 / §5.1 — IS A GRAB BEING HELD. R3 owns the grab itself; this
// is the press's half of it and it reads the same LEVEL input §5.1 names, so the
// press works the day R3 lands and works on the level alone until then.
//
// specs/0057 §4.4 (B, Greg 2026-09-06) — that level is `keys.grab` (B) and no
// longer `keys.jumpHeld` (Space). It reads the MAPPED INPUT, never a key code:
// main.js's KEYMAP owns which key writes the bit, touch.js writes it from a
// right-half hold, and recorder.js's replay writes it from the trace, so all
// three drive this file through one door. A press on a rail is therefore B held
// across the lock — and B is free of the pop, which the jump EDGE still is
// (§3.4), so the two no longer share a finger.
function grabHeld(c) {
  try {
    const g = typeof window !== 'undefined' ? window.__grab : null;
    if (g && typeof g.held === 'function') return !!g.held();
  } catch { /* R3 has not landed */ }
  return !!(c && c.keys && c.keys.grab);
}

// §4.4 — the slide's NAME, off the one number the blend is driven by (§6.2).
// `50-50` is within 30° of EITHER pole, because a switch 50-50 is a 50-50.
function slideName(yawDeg) {
  const a = Math.abs(yawDeg);
  if (a <= 30 || a >= 150) return '50-50';
  return yawDeg > 0 ? 'FS SLIDE' : 'BS SLIDE';
}
// =================================================================== specs/0057 §5 — GRABS
//
// B HELD while airborne is a grab. specs/0057 §4.4 (B, Greg 2026-09-06): "Can
// you make b the trick key instead of space". It WAS Space (D12) and the whole
// argument for that was that Space bound no new key — but Space is also the
// bike's preload, the glider's flare and the rocket's throttle, and on skis it
// is the pop you just used to leave the lip. B costs one key and buys the grab a
// finger that is not already busy: the LEVEL `keys.grab` is the whole signal.
// WASD picks WHICH grab. The ARROWS are deliberately not read here: they are the
// air-spin keys, and a spin thrown into a grab has to keep being a spin (D12,
// 0057-DECISIONS §2). So `flipFwd`/`flipBack`/`spinLeft`/`spinRight` never reach
// this table even though ski.js treats up/down as aliases of W/S on the ground.
//
// The grab does not score as a trick of its own. It MULTIPLIES the rotation that
// is already in progress (§5.3) — which is why the whole machine lives in this
// file, next to the accumulators it multiplies, and why `addTrick`'s score line
// is the only line of the old scoring it touches.
const GRAB_TUNING = {
  GRAB_T_MAX: 1.60,      // s — the longest hold that pays. Stops a glider-height air being a free 700
  TWEAK_MULT: 1.35,      // × — the second cardinal on a diagonal (§5.1). A tweaked NOSE is still NOSE
  GRAB_MULT_MAX: 2.5,    // the ceiling on the stack multiplier
  GRAB_STACK_REF: 400,   // grabScore that buys +1.0 of multiplier
  GRAB_RELEASE: 0.25,    // s — release this far before touchdown or the landing is sketchy (D13)
  GRAB_BASE: 100,        // BASE for family `grab`. NOT added to BASE (:75) — §0 pins that line
};

// §5.1's table, verbatim, plus the leg the tweak bones out (rider.js's GRABS row
// carries the same sides). `tweak: false` is "both hands are committed" — the
// spec's own reason SAFETY and TRUCK DRIVER cannot be tweaked.
const GRABS = {
  safety: { name: 'SAFETY', base: 40, tweak: false },
  indy: { name: 'INDY', base: 90, tweak: true },
  mute: { name: 'MUTE', base: 100, tweak: true },
  tail: { name: 'TAIL', base: 110, tweak: true },
  nose: { name: 'NOSE', base: 120, tweak: true },
  truck: { name: 'TRUCK DRIVER', base: 160, tweak: false },
};
// W nose · S tail · A mute · D indy (§5.1). Opposite cardinals are TRUCK DRIVER
// and are not in this map — they are decided by the pair, below.
const GRAB_CARDS = [['forward', 'nose'], ['back', 'tail'], ['left', 'mute'], ['right', 'indy']];


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
  // ---- specs/0057 §5 — the grab, per AIR. `grab` is the segment in progress
  // ({ key, name, base, tweak, tweakable, t0, pickAt }); `grabSum` is Σ grabScore
  // for this air, which is what §5.3 divides by GRAB_STACK_REF; `grabName` is the
  // last grab flown, which is the word §4.4 appends to the trick's name;
  // `grabRel` is the S.t of the last RELEASE (null = never released this air),
  // the one number D13's 0.25 s window is measured from. `cAt` is the press time
  // of each cardinal, the same shape `hAt`/`vAt` already are, so "the cardinal
  // pressed FIRST" is answered by a comparison and not by an event queue.
  grab: null, grabSum: 0, grabName: null, grabRel: null,
  // specs/0066 §5 — EVERY grab segment this air closed, in the order it was
  // held, so "two grabs in one air" has a name and not only a summed score.
  // `grabEnd()` is the one writer; `grabPhrase()` below is the one reader.
  grabSegs: [],
  // specs/0066 §4 — THE STANCE LATCH. false = regular. It is a naming fact and
  // nothing physical reads it: the accumulators never touch `c.yaw`, so an air
  // does not turn the body round, it turns the RIDER round, and this is where
  // that is written down. Toggled by the judge on a landing, cleared by a wipe.
  stance: false,
  grabSince: Infinity,          // s from the last release to THIS touchdown (§5.4)
  grabVerdict: null,            // { verdict, name, sinceRelease, mult } — tests read it
  cAt: { forward: 0, back: 0, left: 0, right: 0 },
  cDown: { forward: false, back: false, left: false, right: false },
  // ---- combo
  combo: null,
  banked: 0,
  // ---- the board
  board: [], dot: false,
  // ---- last verdict, for tests
  last: null, lastEnd: null, wipes: 0, landed: 0,
  errors: 0,
  // ---- specs/0057 §4 — the jib ride. One rider, one jib, one ride record, and
  // every term of the score kept SEPARATELY rather than summed as it goes: the
  // whole point of D8 is that a jib score is a base rate plus named adds, and a
  // single running total cannot be read back to say which add earned what.
  jib: null,          // the live ride, or null
  jibLast: null,      // the ride just finished, with every term (state(), P6)
  jibRides: 0,
  jibPops: 0,         // switch-up events — 0048's combo-line pop counts on this
  // ---- §4.2's ONOFF_BONUS, whose whole subtlety is "once per air, never twice"
  onoff: false,       // this air LEFT a jib (a pop) — known at the judge
  onoffUsed: false,   // ...and whether the 1.25 has already been spent
  onoffT: -9,         // when the judge last banked a trick
  popArmed: false,    // the last jib exit was a pop and no air has claimed it
  lastAdd: null,      // the trick the judge just added, for the landing half
  dbg: false,             // specs/0048 §4.1 — the capture hook owns the readouts
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

// ============================================ specs/0066 — THE NAME GRAMMAR
//
//   [SWITCH] [COUNT] FAMILY [DEGREES] [GRAB(S)] [TWEAK] [TO SWITCH]
//
// Greg, 2026-09-06: "our trick names dont account for more than 2 rotations and
// dont factor in all kinds of crazy trick mixes". The old table stopped at
// `Double`/`Triple` and had no word at all for a switch takeoff, a second grab,
// a flatspin or a rodeo that went all the way over. Every word below is read off
// a fact this file ALREADY measures — `family`, `deg`, `spinAcc`, `flipAcc`, the
// grab segments and the stance latch — so `classify()`, the two accumulators,
// the rates, the tilts and the landing windows are untouched (0066 §0).
//
// ALL NAMES ARE UPPERCASE, which is the register the grab words (`NOSE`) and the
// rail words (`50-50`, `PRESS`) have always been in and the register the HUD
// renders anyway. `Cork 720` is now `CORK 720`.
const COUNT_WORDS = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD', 'QUINT', 'SEXT', 'SEPT', 'OCT'];
const round180 = (deg) => Math.max(0, Math.round(deg / 180) * 180);
// COUNT is FULL REVOLUTIONS of the whole rotation, one definition for every
// family: 720 → 2, 1080 → 3, 1440 → 4, 1800 → 5, and it keeps going.
const countOf = (deg) => Math.floor(round180(deg) / 360);
const countWord = (n) => (n < 2 ? '' : (COUNT_WORDS[n] || '×' + n));
// specs/0066 §6 — the ONE new factor on the score line. A Quad is 1.45× a single
// at the same degrees; `spinMult(deg)` (:73) does the rest and does not move.
const countMult = (n) => 1 + 0.15 * Math.max(0, n - 1);

// The family's own word, and the three renames a MEASURED fact earns:
//   D-SPIN     a cork carrying a full inversion (|flipAcc| >= 360) — 0002's rule
//   FLAT       a cork/bio that never went off axis (|flipAcc| < 180): the
//              FLATSPIN. It is reachable because the accumulators read the LIVE
//              arrows while the FAMILY stays latched — throw the diagonal, then
//              let the flip arrow go and hold the spin, and `flipAcc` freezes
//              while `spinAcc` keeps climbing. That is a flatspin, exactly.
//   RODEO FLIP a rodeo that carried a full inversion.
// The flip families are pinned at tilt PI/2 by classify(), so there is no
// low-tilt FLIP to call a flatspin and no roll accumulator to call anything a
// LINCOLN LOOP — 0066 §3 skips it rather than inventing an axis.
// THE OFF-AXIS NAME IS A PROPORTION, not an absolute, and that is forced by the
// geometry: for a pure diagonal `flipAcc / deg` is FIXED by the family's tilt —
// 0.435 for every cork and bio, 0.842 for every rodeo and misty — so an absolute
// "≥ 360° of flip" threshold is really "past 828°" and would rename every big
// cork a D-SPIN and every rodeo a RODEO FLIP, leaving CORK and RODEO with no
// rotations left to name. The ONE thing the rider can move is the ratio, by
// letting one arrow go while the family stays latched: drop the flip and the
// throw flattens out, drop the spin and it goes over. That IS the distinction
// these words have always been about, and it is measured, not invented.
const FLAT_R = 0.22;      // <= this much flip in it: a FLATSPIN
const DSPIN_R = 0.60;     // >= this much: it stopped reading as a cork
const RODEO_R = 0.90;     // ...and a rodeo that went all the way over
function famLabel(fam, deg, flipAcc) {
  const f = Math.abs(flipAcc || 0);
  const r = deg > 1e-6 ? f / deg : 0;
  if (fam === 'flip') return 'FRONT FLIP';
  if (fam === 'flipBack') return 'BACK FLIP';
  if (fam === 'underflip') return 'UNDERFLIP';
  if (fam === 'cork' || fam === 'bio') {
    if (r <= FLAT_R) return 'FLAT';
    if (r >= DSPIN_R) return 'D-SPIN';
    return fam === 'cork' ? 'CORK' : 'BIO';
  }
  if (fam === 'misty') return 'MISTY';
  if (fam === 'rodeo') return (r >= RODEO_R && f >= 360) ? 'RODEO FLIP' : 'RODEO';
  return '';
}

// The rotation half of the name, with no stance and no grab on it yet.
function coreName(fam, deg, flipAcc) {
  const round = round180(deg);
  if (fam === 'spin') return String(round || 180);
  const label = famLabel(fam, deg, flipAcc);
  // FLAT carries its own number in half-turns, the way a flatspin is counted:
  // FLAT 3 = 540, FLAT 5 = 900, FLAT 7 = 1260, FLAT 9 = 1620.
  if (label === 'FLAT') return 'FLAT ' + Math.max(1, Math.round(deg / 180));
  const cw = countWord(countOf(deg));
  const pre = cw ? cw + ' ' : '';
  // a flip's count IS its inversions and the degrees would say nothing twice
  if (fam === 'flip' || fam === 'flipBack') return pre + label;
  return pre + label + (round ? ' ' + round : '');
}

// specs/0066 §4 — SWITCH. The stance latch is toggled by the LANDING WINDOW's
// half-turn count, and only for a family that carries yaw at all: a flip or an
// underflip (tilt PI/2) puts nothing into the heading and cannot turn you round,
// which is the same reason `snapTilt` pays a flip's residual into pitch (:1090).
const YAW_FAMILY = (rule) => !!rule && rule.tilt < Math.PI / 2 - 1e-6;
const flipsStance = (rule, deg) => YAW_FAMILY(rule) && (Math.round(deg / 180) % 2 !== 0);

// The whole name, in the order §1 pins. `swIn` is the stance the air left the
// snow in, `swOut` the stance it lands in; `grab` is §5's phrase or null.
function trickName(fam, deg, flipAcc, swIn, swOut, grab) {
  let core = coreName(fam, deg, flipAcc);
  // HALF-CAB — a switch takeoff that lands regular, on the two spins that read
  // as one (Greg: "HALF-CAB for switch takeoff to regular on 180/540").
  const round = round180(deg);
  const half = fam === 'spin' && swIn && !swOut && (round === 180 || round === 540);
  if (half) core = round === 180 ? 'HALF-CAB' : 'HALF-CAB 540';
  else if (swIn) core = 'SWITCH ' + core;
  if (grab) core += ' ' + grab;
  if (swOut) core += ' TO SWITCH';
  return core;
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

// =================================================================== specs/0057 §5 — the machine
//
// A SEGMENT is one grab: one identity (name + tweak) held for a stretch of the
// air. It closes on a release, on a change of identity, or at touchdown, and its
// score is banked into `grabSum` as it closes — which is exactly §5.3's "two
// grabs in one air sum their grabScore before the divide", with no special case
// for the second one.
// `grabVerdict` is deliberately NOT cleared here: it is the last landing's
// answer, and this runs on every grounded frame. The takeoff clears it.
function grabReset() {
  S.grab = null; S.grabSum = 0; S.grabName = null; S.grabRel = null;
  S.grabSince = Infinity;
  S.grabSegs = [];                 // specs/0066 §5 — the phrase is PER AIR too
}

// §5.2 — `base × min(hold, GRAB_T_MAX) × (tweaked ? TWEAK_MULT : 1)`. The cap is
// PER GRAB, not per air: two 1.6 s grabs in one air are worth two of them.
function grabEnd() {
  const g = S.grab;
  if (!g) return 0;
  S.grab = null;
  const hold = Math.min(GRAB_TUNING.GRAB_T_MAX, Math.max(0, S.t - g.t0));
  const sc = g.base * hold * (g.tweak ? GRAB_TUNING.TWEAK_MULT : 1);
  S.grabSum += sc;
  if (g.name) S.grabName = g.name;
  // specs/0066 §5 — the segment's IDENTITY, banked beside its score and in the
  // same order. A segment closes on a release, on a change of identity or at
  // touchdown, which is exactly the list "the grabs held in this air".
  S.grabSegs.push({ name: g.name, tweak: !!g.tweak });
  return sc;
}

// specs/0066 §5 — the grab half of the name. One grab is its own word (0057
// §4.4, unchanged); two DIFFERENT grabs are joined in the order held; the SAME
// grab twice takes §2's count word. A tweak is a MODIFIER and rides at the end
// of the phrase — 0057 §5.1's "a tweaked NOSE is still NOSE" is a claim about
// the SCORE (1.35× and no new grab), and 0066 only adds the word.
function grabPhrase() {
  const segs = S.grabSegs;
  if (!segs.length) return null;
  const tweak = segs.some((s) => s.tweak);
  const names = [];
  for (const s of segs) if (s.name && names[names.length - 1] !== s.name) names.push(s.name);
  let out;
  if (!names.length) return null;
  if (names.length === 1) {
    // ...and the same grab taken twice IS a double, not a repeat of one word
    const n = segs.filter((s) => s.name === names[0]).length;
    out = n > 1 ? (countWord(Math.min(n, COUNT_WORDS.length - 1)) || '×' + n) + ' ' + names[0] : names[0];
  } else out = names.slice(0, 3).join(' + ');
  return tweak ? out + ' TWEAK' : out;
}

// §5.3 — `min(GRAB_MULT_MAX, 1 + Σ grabScore / GRAB_STACK_REF)`. 1.0 exactly when
// nothing was grabbed, so an air with no grab multiplies by nothing.
function grabMult() {
  return Math.min(GRAB_TUNING.GRAB_MULT_MAX, 1 + S.grabSum / GRAB_TUNING.GRAB_STACK_REF);
}

// Which grab the CURRENT cardinals name, and whether a tweak is on top. Returns
// { key, tweak } — `key` indexes GRABS. Opposite cardinals (W&S, or A&D) are
// TRUCK DRIVER and carry no tweak: both hands are committed (§5.1, DECISIONS §1).
// Otherwise the base is the cardinal pressed FIRST (`cAt`, tricks.js's own
// leadWindow convention) and any SECOND cardinal held with it is the tweak — so
// W+A and A+W are the same grab with the same tweak, told apart only by which
// went down first.
function grabPick(keys) {
  const held = [];
  for (const [k, g] of GRAB_CARDS) if (keys[k]) held.push([S.cAt[k] || 0, g]);
  if ((keys.forward && keys.back) || (keys.left && keys.right)) return { key: 'truck', tweak: false };
  if (!held.length) return { key: 'safety', tweak: false };
  held.sort((a, b) => a[0] - b[0]);
  const key = held[0][1];
  return { key, tweak: held.length > 1 && GRABS[key].tweak };
}

// One step of the machine, from update(), while the body is in the air on skis.
function grabStep(keys) {
  const want = S.air && !!keys.grab;   // specs/0057 §4.4 (B, Greg 2026-09-06)
  if (!want) {
    // the RELEASE: `grabRel` is the timestamp D13's window is measured from, and
    // it is stamped here and nowhere else — an identity change closes a segment
    // without ever having let go of the ski.
    if (S.grab) { grabEnd(); S.grabRel = S.t; }
    return;
  }
  const p = grabPick(keys);
  const g = S.grab;
  if (!g) {
    const row = GRABS[p.key];
    S.grab = { key: p.key, name: row.name, base: row.base, tweak: p.tweak, t0: S.t, pickAt: S.t };
    return;
  }
  if (p.key === g.key) {
    // a tweak is STICKY for the segment: it is a thing you did, not a thing you
    // are still doing, and un-tweaking mid-grab must not un-score it.
    if (p.tweak) g.tweak = true;
    return;
  }
  // Identity changed. Inside leadWindow the segment is still provisional — with
  // digital keys the second half of "B then W" always lands a frame or two
  // late, and a segment that latched on the first frame would call every one of
  // them SAFETY. That is exactly what leadWindow is for at :61, used here for the
  // same reason it is used for the cork-vs-rodeo lead.
  if (S.t - g.pickAt <= TRICK_TUNING.leadWindow) {
    const row = GRABS[p.key];
    g.key = p.key; g.name = row.name; g.base = row.base;
    g.tweak = p.tweak || (g.tweak && row.tweak);
    return;
  }
  // ...past it, this is a SECOND GRAB. Bank the first and open the next; the air
  // keeps both, and `grabRel` is untouched because the hand never came off.
  grabEnd();
  const row = GRABS[p.key];
  S.grab = { key: p.key, name: row.name, base: row.base, tweak: p.tweak, t0: S.t, pickAt: S.t };
}

// specs/0057 §5.4 (D13) — THE RELEASE RULE, asked by controller.js at touchdown
// BEFORE the crossed rule and before the trick judge. Three outcomes, no fourth:
// held = WIPEOUT, released inside 0.25 s = sketchy, released before it = clean.
// Returns { wipe, why } or null, the shape `setTrickJudge` already speaks.
function grabJudge(info) {
  try {
    if (!S.ok || !info || info.mode !== 'skis') return null;
    const keys = (S.ctrl && S.ctrl.keys) || {};
    if (S.grab) {
      if (keys.grab) {   // specs/0057 §4.4 (B, Greg 2026-09-06) — B, not Space
        // Still holding it on the deck. This wipes however square the rotation
        // and however straight the skis, and the rail save does not save it —
        // it is an input you are holding, not the jib.
        const name = S.grab.name;
        grabEnd();
        S.grabSince = 0;
        S.grabVerdict = { verdict: 'wipeout', name, sinceRelease: 0, mult: 1, sum: Math.round(S.grabSum) };
        S.wipes++; S.stance = false;                     // specs/0066 §4
        S.last = { name, family: 'grab', deg: Math.round(info.spinDeg || 0), verdict: 'wipe', why: 'grab', grab: name };
        return { wipe: true, why: 'grab' };
      }
      // Let go on the very frame of touchdown — update() has not run since, so
      // the machine has not seen it yet. Close it here at sinceRelease 0, which
      // is the sketchy end of the window and not a wipe.
      grabEnd(); S.grabRel = S.t;
    }
    S.grabSince = S.grabRel == null ? Infinity : Math.max(0, S.t - S.grabRel);
    if (S.grabSum > 0) {
      const sketchy = S.grabSince < GRAB_TUNING.GRAB_RELEASE;
      S.grabVerdict = {
        verdict: sketchy ? 'sketchy' : 'clean', name: S.grabName,
        sinceRelease: +S.grabSince.toFixed(3), sum: Math.round(S.grabSum),
        mult: +(sketchy ? grabMult() / 2 : grabMult()).toFixed(3),
      };
    } else S.grabVerdict = null;
    return null;
  } catch { S.errors++; return null; }
}

// What the landing is allowed to multiply by, and what it costs the quality.
// §5.4: clean = grabMult in full, quality unchanged; sketchy = grabMult HALVED
// and quality capped at 0.5 (which is what fires rider.js's land-stagger).
function grabLanding() {
  if (!(S.grabSum > 0)) return { mult: 1, qCap: 1, sketchy: false };
  const sketchy = S.grabSince < GRAB_TUNING.GRAB_RELEASE;
  return { mult: sketchy ? grabMult() / 2 : grabMult(), qCap: sketchy ? 0.5 : 1, sketchy };
}

// ================================================================== the combo
function startCombo() {
  if (S.combo) return S.combo;
  S.combo = {
    active: 0, mult: 1, tricks: [], names: {}, fams: {},
    deg: 0, pumps: 0, t0: S.t, graceT: 0, best: null, bestScore: 0,
    lastQ: null,                     // HUD only — specs/0048 §2
    // specs/0055 §4.6 — `tricks`' SHADOW: one verdict per name, same order, same
    // length. 0048 gave the line a single `lastQ` and the marks row could only
    // ever hollow the newest mark with it; this is the per-trick answer, and it
    // is HUD only in exactly the way `lastQ` is — nothing in the scoring reads
    // it. Written through `pushTrick()` below and nowhere else, so the two
    // lists cannot drift.
    quals: [],
  };
  return S.combo;
}

// The one place a name enters a combo's line, and therefore the one place the
// two parallel lists are appended. Returns the index, which is what `jibNames`
// keeps in its three slots. A jib line is always 'clean': §3 D5/D7 — nothing
// knocks you off a jib, so there is no sketchy slide.
function pushTrick(c, name, q) {
  c.tricks.push(name);
  c.quals.push(q || 'clean');
  return c.tricks.length - 1;
}

// `opts` carries BOTH multiplier stacks that landed on this line, and either
// form is accepted so no caller had to change shape: a bare NUMBER is the air's
// own bonus (specs/0057 §4.2's `ONOFF_BONUS` 1.25, a spin thrown onto or off a
// jib), and an OBJECT is §5.3's `{ grabMult, flat, bonus }`. Both are factors on
// the right of the line this file has always had, so an air with neither scores
// exactly what it scored before.
function addTrick(c, name, fam, deg, quality, opts) {
  const n = (c.names[name] || 0);
  const variety = VARIETY[Math.min(n, VARIETY.length - 1)];
  // specs/0057 §5.3 — THE GRAB MULTIPLIES THE AIR'S OWN TRICK. `BASE[fam] ×
  // spinMult(deg) × variety × quality` is the line this file has always had; the
  // grab and the jib on/off bonus add factors to the right of it and change
  // nothing to the left.
  //
  // `flat` is the other half of §5.3: a STRAIGHT AIR has no family to multiply,
  // so it scores `Σ grabScore` directly, through this same function with family
  // `grab` — one trick in `c.tricks`, one +1 on the multiplier, one entry in the
  // variety table. `GRAB_TUNING.GRAB_BASE` is family `grab`'s BASE and is held
  // there rather than in `BASE` (:75), which §0 pins byte-identical.
  const o = (typeof opts === 'number') ? { bonus: opts } : (opts || {});
  const gm = (o.grabMult > 0 ? o.grabMult : 1) * (o.bonus > 0 ? o.bonus : 1);
  // specs/0066 §6 — `countMult` is the ONE factor this line gained, and it sits
  // beside `spinMult` rather than replacing it: `spinMult` prices the DEGREES
  // and `countMult` prices the REVOLUTIONS, which is what the count word in the
  // name says out loud. A straight air (`o.flat`) has no rotation to count and
  // never reaches it. BASE (:72) does not move: FLAT scores as its cork/bio,
  // D-SPIN as cork, RODEO FLIP as rodeo — the count word is a factor, not a
  // family, and `c.fams[fam]` below still keys the DETECTOR's family (§6).
  const raw = o.flat != null ? o.flat
    : (BASE[fam] != null ? BASE[fam] : GRAB_TUNING.GRAB_BASE) * spinMult(deg) * countMult(countOf(deg));
  const score = Math.round(raw * variety * quality * gm);
  c.names[name] = n + 1;
  // specs/0048 — the verdict word on the live line, and the ONLY thing this
  // function gained. Nothing in the scoring reads it; `c.tricks` below is
  // already the ordered list the meter shows the tail of (`c.names` is the
  // COUNT map the variety decay keys on, and cannot double as one).
  c.lastQ = quality >= 1 ? 'clean' : 'sketchy';
  c.active += score;
  // THPS convention: +1 per landed trick, +1 more for a family not yet used
  c.mult = Math.min(TRICK_TUNING.comboMaxMult, c.mult + 1 + (c.fams[fam] ? 0 : 1));
  c.fams[fam] = true;
  pushTrick(c, name, c.lastQ);       // specs/0055 §4.6 — same verdict, per trick
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
    quals: c.quals.slice(0, 8),        // specs/0055 §4.6 — sliced with `tricks`
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

// ======================================================= specs/0057 §4 — JIBS
// The whole jib scorer, driven once per fixed step from update() AFTER
// `railStep()` has already advanced the ride (main.js:2397-2410), so every
// number below is this frame's and not last frame's.

// Points into the live combo. Fractional by nature — 60/s at 120 Hz is half a
// point a step — so the fraction is CARRIED and only whole points are banked:
// `c.active` stays the integer every other path in this file puts there, and
// 2.5 s of sliding is still exactly 150 and not 149.9999998.
function jibBank(jb, pts) {
  const c = startCombo();          // ...and this is also how a jib STARTS a combo
  jb.frac += pts;
  const whole = Math.floor(jb.frac);
  if (whole > 0) { jb.frac -= whole; c.active += whole; }
  return c;
}

// §4.4 — the names, into `c.tricks` for the combo line's tail. Three rules:
// the SLIDE name is one slot rewritten in place as you yaw (it is one trick you
// are still doing, not a new one every 90°); SWITCH-UP is ONE line that counts
// up, not N lines; PRESS appears once per ride. None of them touches `c.names`,
// so none of them decays anything through VARIETY — that map is the variety
// decay's, and a slide is not a rotation.
function jibNames(jb, c, yaw) {
  // the slots are INDICES into one combo's list, so a combo that ended under
  // the ride (a wipe from something that is not the jib) invalidates all three
  // and they are re-pushed into the new one rather than written past its end
  if (jb.c !== c) { jb.c = c; jb.slide = -1; jb.swLine = -1; jb.pressLine = -1; }
  const slide = slideName(yaw);
  if (jb.slide < 0) jb.slide = pushTrick(c, slide, 'clean');
  else if (c.tricks[jb.slide] !== slide) c.tricks[jb.slide] = slide;
  if (jb.sw > 0) {
    const s = 'SWITCH-UP ×' + jb.sw;
    if (jb.swLine < 0) jb.swLine = pushTrick(c, s, 'clean');
    else if (c.tricks[jb.swLine] !== s) c.tricks[jb.swLine] = s;
  }
  // specs/0066 §5 — A GRAB HELD THROUGH A JIB IS NAMED. The press's line was one
  // word; it is now `PRESS + MUTE`, in 0057 §4.4's own rail vocabulary. The hand
  // is on the ski but the grab MACHINE is not running (it is `S.air`-gated, and a
  // slide is not an air), so the identity comes from `grabPick()` — the same pure
  // read of the same four cardinals — and nothing about the segment bookkeeping,
  // the grabSum or the release rule is touched. Rewritten in place like the slide
  // name above, because swapping hands mid-press is one press, not two.
  if (jb.press) {
    const pn = pressName();
    if (jb.pressLine < 0) jb.pressLine = pushTrick(c, pn, 'clean');
    else if (c.tricks[jb.pressLine] !== pn) c.tricks[jb.pressLine] = pn;
  }
}

// specs/0066 §5 — the press's own name. SAFETY is "no cardinal held", which on a
// rail is just a press and takes no second word.
function pressName() {
  try {
    const keys = (S.ctrl && S.ctrl.keys) || {};
    const p = grabPick(keys);
    const row = GRABS[p.key];
    if (!row || p.key === 'safety') return 'PRESS';
    return 'PRESS + ' + row.name + (p.tweak ? ' TWEAK' : '');
  } catch { return 'PRESS'; }
}

// §4.2 — the LANDING half of ONOFF_BONUS. The judge closes the air inside
// `ctrl.update()`; rail.js reports the lock-on in `railStep()`, which is the
// next thing that runs. So a spin thrown ONTO a jib is always judged a step
// before the jib knows it caught you, and the 1.25 is applied to the trick the
// judge just banked rather than predicted before it. Bounded by `snapT` 0.12 —
// the window in which the body is still being eased square from that landing,
// which is precisely how long "this lock-on IS that landing" stays true — and
// by `onoffUsed`, which is §4.2's "once per air, never twice".
function jibOnoff() {
  const a = S.lastAdd;
  if (!a || S.onoffUsed || a.c !== S.combo) return false;
  if (S.t - S.onoffT > TRICK_TUNING.snapT) return false;
  // The grab's own multiplier (§5.3) was already in `a.score`; `a.raw` is the
  // bare line, so the retro-applied 1.25 has to carry `a.gm` with it or a jib
  // transfer would silently strip the grab off the trick it just banked.
  const full = Math.round(a.raw * JIB_TUNING.ONOFF * (a.gm > 0 ? a.gm : 1));
  a.c.active += full - a.score;
  a.score = full;
  if (full > a.c.bestScore) { a.c.bestScore = full; a.c.best = a.name; }
  if (S.last) { S.last.score = full; S.last.active = a.c.active; S.last.onoff = true; }
  S.onoffUsed = true;
  return true;
}

function jibStep(dt) {
  const R = railNow();
  const on = !!(R && R.on);
  const J = JIB_TUNING;

  // ---- THE LOCK-ON EDGE. The ride record is opened here and every term of the
  // score is zeroed; nothing is banked yet (see the micro-hop rule below).
  if (on && !S.jib) {
    S.jib = {
      id: R.id, type: R.type, t: 0, sw0: R.sw, sw: 0,
      // §4.2 — ENTRY YAW pays for sliding in sideways, at lock-on and once.
      // 0° = 0, 90° = 40, 180° = 80, stop.
      entry: Math.min(J.ENTRY_CAP, J.ENTRY_YAW * Math.abs(R.entryYaw) / 90),
      base: 0, swPts: 0, pressT: 0, pressPts: 0,
      pend: 0, frac: 0, live: false, press: false,
      c: null, slide: -1, swLine: -1, pressLine: -1,
    };
    S.popArmed = false;            // a new ride ends the last pop's claim
    jibOnoff();                    // ...and this lock-on may BE a landing (§4.2)
  }

  if (on) {
    const jb = S.jib;
    jb.t += dt; jb.id = R.id; jb.type = R.type;
    // §4.1 — the base rate. One number, all seven jibs, no per-feature anything.
    let pts = J.RATE * dt;
    jb.base += J.RATE * dt;
    // §4.2 / §3.1 — the switch-ups, counted by rail.js on the 90° lattice and
    // only READ here. Every crossing in either direction is one.
    const dsw = Math.max(0, (R.sw | 0) - jb.sw0 - jb.sw);
    if (dsw > 0) {
      jb.sw += dsw; S.jibPops += dsw;
      pts += dsw * J.SWITCHUP; jb.swPts += dsw * J.SWITCHUP;
    }
    // §4.2 — the press, and the pose gate that is the whole of Greg's "if the
    // pose allows": a 50-50 or a switch 50-50 pays, a 90° slide does not.
    const a = Math.abs(R.yaw);
    jb.press = (a <= J.PRESS_YAW || a >= 180 - J.PRESS_YAW) && grabHeld(S.ctrl);
    if (jb.press) { pts += J.PRESS_RATE * dt; jb.pressPts += J.PRESS_RATE * dt; jb.pressT += dt; }

    // §4.1 — THE MICRO-HOP RULE. Under 0.30 s nothing is banked, no combo is
    // started and no name appears; at 0.30 s the whole pending amount lands at
    // once, entry yaw included, and the ride is live from there.
    if (!jb.live) {
      jb.pend += pts;
      if (jb.t >= J.MIN_T) { jb.live = true; jibNames(jb, jibBank(jb, jb.pend + jb.entry), R.yaw); jb.pend = 0; }
    } else {
      jibNames(jb, jibBank(jb, pts), R.yaw);
    }
    return;
  }

  // ---- THE EXIT. §3.4 has two and no third, and BOTH are clean (D5/D7: nothing
  // knocks you off a jib). The only way a ride ends dirty is a wipe from
  // something that is not the jib, which rail.js clears on the frame it fires.
  if (S.jib) {
    const jb = S.jib;
    const c = S.combo;
    const clean = jb.live && !!S.ctrl && S.ctrl.wipeT === 0;
    if (clean && c) {
      // §4.2 — the jib raises the multiplier ONCE, here, on `addTrick`'s own
      // convention: +1 for the feature and +1 more the first time the family
      // `jib` appears. This is the only place a jib touches `mult`.
      c.mult = Math.min(TRICK_TUNING.comboMaxMult, c.mult + 1 + (c.fams.jib ? 0 : 1));
      c.fams.jib = true;
      c.lastQ = 'clean';
      S.jibRides++;
    }
    if (jb.live) {
      S.jibLast = {
        id: jb.id, type: jb.type, t: +jb.t.toFixed(3), clean,
        base: Math.round(jb.base), entry: Math.round(jb.entry),
        switchUps: jb.sw, switchPts: jb.swPts,
        pressT: +jb.pressT.toFixed(2), pressPts: Math.round(jb.pressPts),
        total: Math.round(jb.base + jb.entry + jb.swPts + jb.pressPts),
        mult: c ? c.mult : 1,
      };
    }
    // §7.3 / §4.2 — a POP off the jib arms the takeoff half of ONOFF_BONUS for
    // whichever air claims it next. It is consumed by the very next takeoff and
    // cleared by any new lock-on, so it cannot be carried down the run.
    if (R && R.popped) S.popArmed = true;
    S.jib = null;
  }
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
    // specs/0057 §5.4 — the grab's verdict is a SECOND hook and not a branch of
    // the first, because it has to be asked BEFORE the crossed rule while the
    // trick judge is asked after it. Same shape, same file, opposite ends of the
    // controller's landing block.
    if (S.ctrl && S.ctrl.setGrabJudge) S.ctrl.setGrabJudge(grabJudge);
    // specs/0048 §4.1 — THE ONE TEST HOOK, and it is new: this module had
    // `state()` (which main.js re-exports as `__player.trickState()`) but no
    // way to DRIVE the readouts, and the compare shot needs a live timer and a
    // two-trick combo standing still while a screenshot is taken. Landing that
    // for real means scripting a lip, a takeoff and two rotations through the
    // physics, which is a flaky way to photograph a typeface.
    //
    // It pushes synthetic frames through the SAME three hud calls the game uses
    // and touches nothing else — no accumulators, no combo, no board, no score.
    // So what the compare photographs is the real readout with a fabricated
    // input, not a mock of the readout.
    try { window.__tricks = { state, debug, tuning: TRICK_TUNING, jibTuning: JIB_TUNING }; } catch { /* no window */ }
    try { window.__tricks = { state, debug, tuning: TRICK_TUNING }; } catch { /* no window */ }
    // specs/0057 §5 — R3's handle, exactly the shape §9 pins and rider.js reads:
    // `state()` -> { grab, tweak, held, releasedAt }. B1's blend tree fires the
    // pose off `held` + `grab`, the tweak off `tweak`, and the let-go clip off
    // `releasedAt` MOVING — which is why that field is a timestamp on this
    // module's own clock and not a boolean. The extra keys past the four are
    // additive and for the harness (P8 reads `verdict` and `sinceRelease`).
    try { window.__grab = { state: grabState, tuning: GRAB_TUNING }; } catch { /* no window */ }

    S.ok = true;
  } catch { S.errors++; }
}

// { timer: seconds|null, combo: {mult, names, quality, grace}|null,
//   end: { score, mult, pb, bailed }|null } — any subset. Returns what it drove.
export function debug(f) {
  try {
    if (!S.hud || !f) return null;
    // `off` hands the readouts back to the frame loop. Without the latch,
    // update() would overwrite everything driven here on the very next frame —
    // which is the correct behaviour for the game and useless for a camera.
    if (f.off) { S.dbg = false; return { ok: true, drove: ['off'] }; }
    S.dbg = true;
    // specs/0057 §4.4 — the unit rides with the number, so the capture hook can
    // photograph the JIB clock as well as the AIR one. Defaults to `AIR`, which
    // is what every existing 0048 caller gets and what it already showed.
    if (f.timer != null && S.hud.airTimer) S.hud.airTimer({ air: true, t: f.timer, unit: f.unit || 'AIR' });
    if (f.combo && S.hud.combo) {
      S.hud.combo({
        on: true,
        mult: f.combo.mult != null ? f.combo.mult : 1,
        names: f.combo.names || [],
        quality: f.combo.quality || null,
        count: (f.combo.names || []).length,
        grace: f.combo.grace != null ? f.combo.grace : 0,
        graceMax: TRICK_TUNING.comboGraceT,
      });
    } else if (f.combo === null && S.hud.combo) S.hud.combo({ on: false });
    if (f.end && S.hud.comboEnd) S.hud.comboEnd(f.end);
    return { ok: true, drove: Object.keys(f) };
  } catch { S.errors++; return null; }
}

// specs/0057 §5.3 — the grab-only landing. Same combo, same variety table, same
// quality, and no `spinMult`: the score IS Σ grabScore, because the multiplier
// §5.3 builds out of that sum has nothing to multiply here. Returns null so the
// controller's landing path is byte-for-byte what it was for a plain straight
// air — no snap, no yaw write, nothing but a score.
function grabOnly(info, deg) {
  if (!(S.grabSum > 0)) return null;
  const gl = grabLanding();
  const quality = Math.min(1, gl.qCap);
  // specs/0066 §5 — a STRAIGHT air is named by its grabs and nothing else, so
  // it is the phrase and not just the last grab: `NOSE + TAIL`, `DOUBLE MUTE`.
  const name = grabPhrase() || S.grabName || GRABS.safety.name;
  const c = startCombo();
  const score = addTrick(c, name, 'grab', 0, quality, { flat: S.grabSum });
  S.landed++;
  S.last = {
    name, family: 'grab', deg: Math.round(deg || 0), verdict: gl.sketchy ? 'sketchy' : 'perfect',
    score, mult: c.mult, active: c.active,
    grab: name, grabScore: Math.round(S.grabSum), grabMult: 1, sinceRelease: +S.grabSince.toFixed(3),
  };
  if (S.hud && S.hud.trick) S.hud.trick({ name, deg: 0, sketchy: gl.sketchy });
  return null;
}

// The controller's second opinion on a landing it has already cleared on the
// "skis crossed" rule. Returns { wipe, why, snapYaw } or null.
function judge(info) {
  try {
    if (!S.ok || info.mode !== 'skis') return null;
    const T = TRICK_TUNING;
    const deg = Math.hypot(S.spinAcc, S.flipAcc);
    const fam = S.family;
    // no arrow-driven rotation at all: nothing to judge, the old rules stand...
    // ...unless a GRAB was flown (specs/0057 §5.3). "A straight air with no
    // family has no trick to multiply: it scores Σ grabScore flat through
    // addTrick with family `grab`" — which is what makes a grab worth doing off
    // a small jump, and it is the only new way this file can start a combo.
    if (!fam || deg < 90) { S.family = null; return grabOnly(info, deg); }
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
    // specs/0057 §2.5 — A RAIL ENTRY IS A LANDING THAT NEVER WIPES. When the
    // arrival surface is a jib this judge still runs and still scores the
    // rotation, but its two wipe returns become SKETCHY landings and the 540°
    // cork floor is not applied: a cork 360 onto a rail is worth half a cork
    // 360, not a crash. `info.jib` is the controller's landing block saying so.
    // `S.jib` is the second and usual half of that: rail.js's ordinary lock-on
    // fires while the rider is still inside `RAIL_DZ` 0.35 and BEFORE the
    // controller calls the arrival a landing (measured: the lock leads the
    // landing by 9 fixed steps on a flatbar drop-in), so by the time this judge
    // runs the ride is already open and there is nothing to predict.
    const onJib = !!info.jib || !!S.jib;
    if (fam.min && deg < fam.min && !onJib) {
      S.wipes++;
      // specs/0066 §4 — a wipe puts you back on your feet the way you started:
      // the stance latch is cleared, not toggled, on every wipe path below.
      S.stance = false;
      S.last = { name: trickName(fam.family, deg, S.flipAcc), family: fam.family, deg: Math.round(deg), verdict: 'wipe', why: 'unfinished' };
      return { wipe: true, why: 'unfinished' };
    }
    const err = landingErr(deg, fam);
    if (err === null && !onJib) { S.wipes++; S.stance = false; return { wipe: true, why: 'unfinished' }; }
    const ae = err === null ? Infinity : Math.abs(err);
    let quality = 1, verdict = 'perfect';
    if (ae > sketchTol && !onJib) {
      S.wipes++;
      S.stance = false;                                   // specs/0066 §4
      S.last = { name: trickName(fam.family, deg, S.flipAcc), family: fam.family, deg: Math.round(deg), err: +err.toFixed(1), verdict: 'wipe', why: 'rotation' };
      return { wipe: true, why: 'rotation' };
    }
    if (ae > snapTol) { quality = 0.5; verdict = 'sketchy'; }
    // specs/0057 §5.4 — the release rule's SECOND outcome lands here. A grab let
    // go inside the 0.25 s window caps the quality at 0.5 (which is what fires
    // rider.js's land-stagger, :2060) and halves the multiplier the grab earned.
    // The third outcome — still held — never reaches this function: it is a
    // wipeout, decided by grabJudge() before the crossed rule.
    const gl = grabLanding();
    if (gl.sketchy) { quality = Math.min(quality, gl.qCap); if (verdict === 'perfect') verdict = 'sketchy'; }

    // landed. Snap the body square to the window over snapT — the stumble is
    // what SKETCHY costs you, not the score alone.
    // specs/0057 §2.5 — a jib entry below the family's floor has no window to
    // be square to, so there is no residual to pay back: `snapRad` 0 and the
    // `snapRad`/`snapTilt` ease over `snapT` 0.12 still runs, on nothing.
    S.snapRad = (err === null ? 0 : -err) * D2R;
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
    // specs/0066 §4 — THE STANCE, resolved here and written back here. `swIn` is
    // the stance the air left in and `swOut` the one it lands in; the latch only
    // moves on a LANDING, so a wipe cannot leave you facing the wrong way.
    const swIn = S.stance;
    const swOut = flipsStance(fam, deg) ? !swIn : swIn;
    S.stance = swOut;
    // specs/0057 §4.4 + 0066 §5 — the grab's name is APPENDED to the air's trick
    // name, so a cork 720 flown with a nose grab announces `CORK 720 NOSE`. 0066
    // widens the appended half to the whole PHRASE — two grabs, a doubled grab,
    // and the tweak's own word — and leaves 0057's scoring of it alone.
    const withGrab = trickName(fam.family, deg, S.flipAcc, swIn, swOut, grabPhrase());
    // specs/0057 §4.2 — ONOFF_BONUS, the TAKEOFF half: this air left a jib on a
    // pop, so the spin it carried is worth 1.25×. The LANDING half (a spin
    // thrown ONTO a jib) cannot be known here — rail.js reports the lock-on one
    // step later — and is applied by jibOnoff() on the lock-on edge, guarded by
    // `onoffUsed` so a pop-to-rail transfer pays the bonus once and not twice.
    const onoff = (S.onoff || onJib) ? JIB_TUNING.ONOFF : 1;
    const raw = Math.round(BASE[fam.family] * spinMult(deg) * countMult(countOf(deg))
      * VARIETY[Math.min((c.names[withGrab] || 0), VARIETY.length - 1)] * quality);
    const score = addTrick(c, withGrab, fam.family, deg, quality, { grabMult: gl.mult, bonus: onoff });
    if (onoff > 1) S.onoffUsed = true;
    S.lastAdd = { c, name: withGrab, raw, score, gm: gl.mult };
    S.onoffT = S.t;
    S.landed++;
    S.last = {
      name: withGrab, family: fam.family, deg: Math.round(deg),   // specs/0057 §4.4
      // specs/0066 §2/§4 — the two facts the name encodes, published beside it so
      // nothing downstream has to parse the word back out of the string.
      count: countOf(deg), stance: swOut ? 'switch' : 'regular',
      swIn: swIn ? 'switch' : 'regular',
      err: err === null ? null : +err.toFixed(1),
      verdict, score, mult: c.mult, active: c.active, onoff: onoff > 1, jib: onJib,
      spin: Math.round(S.spinAcc), flip: Math.round(S.flipAcc),
      // specs/0057 §5 — what the grab was worth and what the release cost it
      grab: S.grabName, grabScore: Math.round(S.grabSum),
      grabMult: +gl.mult.toFixed(3), sinceRelease: +S.grabSince.toFixed(3),
    };
    if (S.hud && S.hud.trick) S.hud.trick({ name: withGrab, deg: Math.round(deg), sketchy: verdict === 'sketchy' });   // specs/0057 §4.4
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
    // specs/0057 §5.1 — the same latch for the four MOVEMENT cardinals, because
    // "the base grab is the cardinal pressed FIRST" needs a press time and W/A/S/D
    // never had one. Stamped every step whether or not the body is in the air, so
    // a cardinal already held on the way up is a press at takeoff and not a press
    // from the last turn.
    for (const [k] of GRAB_CARDS) {
      const d = !!keys[k];
      if (d && !S.cDown[k]) S.cAt[k] = S.t;
      S.cDown[k] = d;
    }

    // ---- specs/0057 §4 — THE JIB SCORER, and it runs HERE, before the takeoff
    // edge below, for one reason: a pop off a jib and the air it starts are the
    // SAME fixed step. rail.js releases in `railStep()` (main.js:2397-2410) and
    // the controller has already left the ground, so if the takeoff edge read
    // `popArmed` before this ran it would read the value from before the pop and
    // §4.2's ONOFF_BONUS would never fire on a spin thrown OFF a rail. It reads
    // the jib state this frame produced; the combo links below then see a ride
    // that may have started on this very step.
    jibStep(dt);

    const air = onSkis && !c.grounded;
    if (air && !S.air) {                       // takeoff
      S.air = true; S.airT = 0; S.spinAcc = 0; S.flipAcc = 0; S.family = null;
      // Press order is press order WITHIN THIS AIR. An arrow that was already
      // held on the way up is pressed "at takeoff", and two arrows already held
      // are simultaneous — otherwise a key left down from the last jump dates
      // back seconds and silently decides the family of this one.
      S.hAt = h !== 0 ? S.t : 0;
      S.vAt = v !== 0 ? S.t : 0;
      // specs/0057 §4.2 — ONOFF_BONUS is latched PER AIR, here, from the pop
      // that started it, and `onoffUsed` is reset with it: "once per air, never
      // twice" is a property of the air and this is where an air begins.
      S.onoff = S.popArmed; S.popArmed = false; S.onoffUsed = false;
      // specs/0057 §5 — the grab is PER AIR: the sum, the name and the release
      // stamp all start empty here, so a grab flown on the last jump can never
      // multiply this one or wipe this landing.
      grabReset(); S.grabVerdict = null;

    } else if (!air) {
      // On the snow there is no trick in progress, so the accumulators are zero
      // and the family is unlatched — every frame, not just on the landing edge.
      // A respawn, a teleport, a gear change and a lift ride all land here too,
      // and none of them should be able to leave 3000° of spin lying around for
      // the next jump to inherit.
      S.air = false; S.airT = 0; S.spinAcc = 0; S.flipAcc = 0; S.family = null;
      // specs/0057 §5 — and so does the grab, for the same reason: a respawn, a
      // teleport, a gear change and a lift ride all land here, and none of them
      // may leave a held grab lying around for the next landing to wipe on. The
      // landing itself has already been judged by then — controller.js asks
      // grabJudge() inside its own update(), which runs before this function.
      grabReset();
    }
    // specs/0057 §5.1 (§4.4, B, Greg 2026-09-06) — B HELD in the air, WASD picks. One call, after the
    // air flag is settled for the frame, so a grab can begin on the same step
    // the body leaves the ground.
    grabStep(keys);

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
      // specs/0057 §4.3 (D9) — A JIB EXTENDS THE COMBO THE WAY AIRTIME DOES.
      // `|| !!S.jib` is the whole of it, and it does two things at once: the
      // grace clock is held at 0 while you slide, and `comboMinSpeed` 4.0 below
      // is never reached — so a slow box slide keeps the combo, and
      // jump -> rail -> jump is ONE combo whose banked compression is spent in
      // the pop that starts the next air.
      else if (!c.grounded || !!S.jib) S.combo.graceT = 0;
      else if (c.speed() < T.comboMinSpeed) endCombo(false);
      else {
        S.combo.graceT += dt;
        if (S.combo.graceT > T.comboGraceT) endCombo(false);
      }
    }

    // ---- the two live readouts (specs/0048 §2). Both are pure REPORTS: every
    // number below already existed and was already being computed for the
    // scoring, and nothing here writes back into the state machine.
    //
    // The timer runs off `S.airT`, which is the same accumulator the landing
    // judge is measured against, so what the player watches tick and what the
    // trick was actually worth cannot disagree.
    if (S.dbg) return;                  // the 0048 capture hook owns the HUD
    // specs/0057 §4.4 — SAME CLOCK, SAME SLOT, SAME FREEZE-AND-FADE. The hero
    // number is `S.airT` in the air and the jib's own `t` on a jib; the 11-px
    // flat unit says which. No new chrome: a jib borrows the timer rather than
    // being given a second one, because they are the same read — how long have
    // you been doing this.
    if (S.hud && S.hud.airTimer) {
      S.hud.airTimer(S.jib
        ? { air: true, t: S.jib.t, unit: 'JIB' }
        : { air: S.air, t: S.airT, unit: 'AIR' });
    }
    if (S.hud && S.hud.combo) {
      S.hud.combo(S.combo
        ? {
          on: true, score: S.combo.active, mult: S.combo.mult,
          // specs/0057 §4.4 — 0048's pop (1.0 -> 1.08 -> 1.0 in 160 ms) fires on
          // each SWITCH-UP too. The pop's edge is this count, and a switch-up
          // rewrites one name in place rather than pushing a new one, so it has
          // to be counted here or the line would never breathe on a rail.
          count: S.combo.tricks.length + S.jibPops,
          names: S.combo.tricks,          // ordered; the meter shows the tail
          quality: S.combo.lastQ,         // null until the first landing
          // specs/0055 §4.6 — the PER-TRICK verdicts, one per entry of `names`,
          // same order and same length, so the marks row can hollow every
          // sketchy mark on the line and not only the newest. `quality` above is
          // unchanged and stays the whole-line answer 0048 shipped.
          quals: S.combo.quals,
          // AIRBORNE READS FULL, on purpose. `graceT` is only advanced on the
          // snow (it is zeroed every airborne frame above), so a bar driven
          // straight off it would sit full for the whole flight and then start
          // draining on touchdown — which is exactly the truth, and exactly
          // what the "2 s to link" read is.
          grace: S.combo.graceT, graceMax: T.comboGraceT,
        }
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
    // specs/0066 §4 — the stance latch, so a harness can read what the NEXT air
    // will be prefixed with without waiting for it to be named.
    stance: S.stance ? 'switch' : 'regular',
    last: S.last, lastEnd: S.lastEnd,
    landed: S.landed, wipes: S.wipes, banked: S.banked,
    grab: grabState(),          // specs/0057 §5 — one read for the whole air

    combo: S.combo
      // specs/0055 §4.6 — `quals` rides beside `tricks` here for the same reason
      // it rides beside `names` on the hud payload: it is the SAME array off the
      // same `S.combo.quals`, so a harness can read what the marks row will be
      // handed without a hud to intercept.
      ? { active: S.combo.active, mult: S.combo.mult, tricks: S.combo.tricks.slice(), quals: S.combo.quals.slice(), deg: Math.round(S.combo.deg), pumps: S.combo.pumps, graceT: +S.combo.graceT.toFixed(2), fams: Object.keys(S.combo.fams) }
      : null,
    // specs/0057 §4 — the jib, live and last, WITH EVERY TERM SEPARATE. §10's
    // score table for a scripted line is read straight off this: a jib score
    // that could only be printed as one total would be untestable against D8.
    jib: S.jib && S.jib.live
      ? { id: S.jib.id, type: S.jib.type, t: +S.jib.t.toFixed(2), sw: S.jib.sw,
          base: Math.round(S.jib.base), entry: Math.round(S.jib.entry),
          switchPts: S.jib.swPts, pressPts: Math.round(S.jib.pressPts), press: S.jib.press }
      : null,
    jibLast: S.jibLast, jibRides: S.jibRides, jibPops: S.jibPops,
    onoff: { armed: S.popArmed, air: S.onoff, used: S.onoffUsed },
    board: boardRows(), dot: S.dot,
  };
}

// specs/0057 §5 — THE GRAB HANDLE. The four fields §9 pins come first and are
// exactly what rider.js reads; everything after them is the harness's.
// `releasedAt` is null until the hand actually comes off, and then it is the
// S.t of that release — a number that only ever moves forward, which is what
// makes B1's release EDGE detectable from a poll.
export function grabState() {
  const g = S.grab;
  return {
    grab: g ? g.name : null,
    tweak: !!(g && g.tweak),
    held: !!g,
    releasedAt: S.grabRel,
    // ---- additive
    base: g ? g.base : 0,
    hold: g ? +Math.max(0, S.t - g.t0).toFixed(3) : 0,
    sum: Math.round(S.grabSum),
    name: S.grabName,
    mult: +grabMult().toFixed(3),
    sinceRelease: S.grabRel == null ? null : +Math.max(0, S.t - S.grabRel).toFixed(3),
    verdict: S.grabVerdict,
    air: S.air, t: +S.t.toFixed(3),
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
