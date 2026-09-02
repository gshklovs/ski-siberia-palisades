// Skiing. An arcade carve model, not a simulator — Tribes/SSX-lite.
//
// The whole thing is three ideas layered on the XZ velocity the controller
// already integrates:
//
//   1. GRAVITY DOWN THE FALL LINE. The ground triangle's normal gives both the
//      steepness (sinθ is just the horizontal length of the unit normal) and the
//      fall-line direction (normalize(n.x, n.z) — the normal leans uphill, so its
//      horizontal part points down). Accelerate along it. Nothing else drives you.
//   2. EDGES. Velocity is split into along-the-skis and across-the-skis. The
//      across component is bled off exponentially — that is the edge biting — and
//      a slice of what was bled off is handed back as forward speed, which is
//      what makes a carve feel like it pumps you along instead of scrubbing you.
//      Grip falls away with speed, so at 25 m/s the tails let go and you drift.
//   3. FRICTION. A small constant (snow) plus a quadratic (air). Together they
//      set the terminal speed on a pitch; the hard cap is only a backstop.
//
// ...and one more that only exists because there is now a ski RACK (below):
//
//   4. CHATTER. Every ski has a speed above which it stops holding: the tails
//      start to shimmy, the edge lets go, and the extra vibration eats speed.
//      A slalom ski hits that at 20 m/s and a downhill ski never does, which is
//      the whole reason you would ever choose the long ones. Default is
//      `chatterSpeed: Infinity` — i.e. the model below behaves exactly as it
//      always did until a ski model says otherwise.
//
// Boots physics live in controller.js and never come through here.

import { BRAND, pick, pickBrand } from './flags.js';

export const SKI_TUNING = {
  maxSpeed: 29,          // m/s — hard backstop; drag normally caps you below it
  slopeAccel: 0.92,      // × gravity·sinθ along the fall line
  glideFriction: 0.45,   // m/s² — constant snow drag
  dragQuad: 0.0085,      // 1/m — quadratic drag; ~28 m/s terminal on a 30° pitch
  // ---- STATIC FRICTION (spec 0021 §1). Real skis hold on a slope until the
  // skier lets them go; the three numbers below are the whole of that. `muS*`
  // is tanθ at the hold angle, so `atan(muSnow)` = 30° (a standing skier holds
  // a black run and does NOT hold a 40° cliff band) and `atan(muRock)` = 20°
  // (skis on stone hold worse than skis on snow, not better). `holdV` is the
  // speed below which the body counts as STANDING rather than sliding — above
  // it the kinetic model below is untouched, so nothing about a run changes.
  muSnow: 0.5774,        // tan 30°
  muRock: 0.3640,        // tan 20°
  holdV: 0.6,            // m/s — the standing/sliding line
  grip: 6.0,             // 1/s — lateral bleed rate at a standstill
  gripAtMax: 0.30,       // fraction of grip left at maxSpeed (drifty up top)
  carveRecover: 0.55,    // share of scrubbed lateral speed handed back forward
  steer: 2.0,            // rad/s from A/D at a standstill
  pivotRate: 2.9,        // rad/s from the ARROWS on the snow — a throw, not a carve.
                         // Must sit above `stivotRate` or the detector never fires.
  steerAtMax: 0.34,      // fraction of steer left at maxSpeed
  airSteer: 1.1,         // rad/s from A/D while airborne
  spinTorque: 6.4,       // rad/s from ← → while airborne — a 360 in ~1 s of air
  brake: 13,             // m/s² — snowplow deceleration (S / SHIFT)
  brakeGrip: 3.0,        // × grip while snowplowing (lets you scrub sideways)
  skate: 5.5,            // m/s² — pole/skate push (W)
  skateMax: 5.5,         // m/s — above this W does nothing; flats settle at ~5
  airDrag: 0.0028,       // 1/m — quadratic drag while airborne (2026-09-01: 0.0022 → 0.0028, Greg: shorter carry)
  landBoost: 0.40,       // share of impact speed converted along the fall line
  landMin: 3.0,          // m/s — impacts softer than this convert nothing
  maxRoll: 0.26,         // rad — camera bank at full edge load (15°)
  rollPerLateral: 0.05,  // rad per m/s of across-the-skis velocity
  rollRate: 8,           // 1/s — bank smoothing
  // ---- carve roll. PRESENTATION ONLY — see the block at the end of skiStep.
  // The skis themselves roll onto their edges, into the turn, hard at speed and
  // hardly at all at walking pace. Nothing below is ever read by the physics.
  carveRoll: 0.68,       // rad — edge angle at a fully committed carve (39°)
  carveRollV0: 0.08,     // × maxSpeed — below this the skis stay flat
  carveRollSpan: 0.52,   // × maxSpeed — span over which the roll reaches full
  carveRollRate: 7.0,    // 1/s — roll smoothing, in and out
  carveRollAir: 0.55,    // × the roll while airborne (nothing to edge against)
  carveRollChat: 0.075,  // rad — shimmy amplitude laid on top at full chatter
  snapMul: 2.0,          // × (speed·dt) — how hard we stay glued going downhill
  // ---- per-model handles. Every one of these is inert at its default, so a
  // ski that overrides none of them is the ski this file has always described.
  chatterSpeed: Infinity,// m/s — above this the ski starts to let go
  chatterSpan: 6,        // m/s — band over which chatter ramps 0 → 1
  chatterGrip: 0,        // fraction of grip lost at full chatter
  chatterYaw: 0,         // rad/s — yaw shimmy amplitude at full chatter
  chatterDrag: 0,        // m/s² — extra drag at full chatter
  popMul: 1,             // × the controller's jump velocity (read by controller.js)
  wipeTol: 0.06,         // rad of slop past 90° before a landing is a wipeout

  // ---- PUMP (spec 0002 §1). Speed does not come from carving; it comes from
  // doing work against a loaded edge through the completion of a turn and
  // spending it back into the fall line at the edge change. Every number here
  // is inert at 0 / 1 — `pumpCharge: 0` and `pumpLoadK: 0` give you back, bit
  // for bit, the model above this line.
  pumpRadius: 18,        // m — sidecut radius; skiTuningFor() overwrites it per model
  // ---- CALIBRATED, and the four numbers below are not the spec's starting
  // values. Spec 0002 §1.9 offers them as starting values and §5 says to turn
  // them on and calibrate; measured on a 6.8 deg / 324 m line in palisades-front
  // (20 s legs, fixed dt, pump on vs pump off — the only difference between the
  // two runs), the spec's own set made a WELL-timed carve a net LOSS of 0.18 m/s,
  // because pumpLoadK's weight ran ahead of what the bank ever paid back. That
  // contradicts §1.0's "a run of well-timed turns is a net speed gain", so:
  //   pumpCharge 3.2 → 6.4   the bank is zeroed at every transition anyway, so
  //                          the per-turn charge is all there ever is
  //   pumpDecay  1.6 → 0.6   1.6/s taxed a normal 0.8 s turn by ~70% ON TOP of
  //                          the zeroing; hoarding is already impossible
  //                          (pumpMax caps it, the transition empties it)
  //   pumpLoadK  3.0 → 1.5   the tax that was outrunning the payout
  //   pumpVr0/Span 1.2/4.5 → 0.6/2.5   the real one: a CARVE has vr → 0 by
  //                          definition, so the spec's thresholds (full
  //                          engagement at 5.7 m/s of slip) only ever rewarded
  //                          SKIDDING, which is the opposite of the brief. At
  //                          0.6/2.5 a real carve engages and a straight-line
  //                          traverse still gives exactly zero.
  // Every anti-exploit guarantee in §1.7 is structural, not a function of these
  // numbers, and all of them still hold — see the measurements in the report.
  pumpCharge: 6.4,       // m/s of bank per second at 1 g of EXCESS load, full edge
  pumpMax: 4.0,          // m/s — bank ceiling
  pumpDecay: 0.6,        // 1/s — bank bleed
  pumpLoadK: 1.5,        // m/s² — the "increasing gravity uphill" weight
  pumpEtaMin: 0.35,      // a sloppy transition returns a third of the bank
  pumpEtaMax: 1.45,      // a clean one returns 145% — break-even sits at 0.59 execution
  pumpWindow: 0.22,      // s — half-width of the good-timing window around peak load
  pumpMinSweep: 0.35,    // rad — a turn must actually BE a turn (anti-wiggle)
  pumpMinTurnT: 0.25,    // s — ...and must take time (anti-wiggle)
  pumpReleaseT: 0.35,    // s — the payout is spread, not a kick
  pumpFlatK: 0.60,       // extra payout fraction on a true flat
  pumpCrossT: 0.25,      // s — flat-dwell at the edge change past which it is a stand-up
  pumpEdge0: 0.12,       // rad — edge angle below which nothing engages
  pumpEdgeSpan: 0.40,    // rad — span to full engagement
  pumpVr0: 0.6,          // m/s — lateral load below which nothing engages
  pumpVrSpan: 2.5,       // m/s — span to full engagement
  pumpFlatEps: 0.04,     // sinθ below which the fall line is latched, not measured
  pumpRadK: 1.0,         // sidecut calibration
  pumpTuckMul: 1.35,     // × charge while SHIFT (tuck) is held in a turn
  tuckDrag: 0.72,        // × dragQuad while SHIFT is held in a straight line
  pumpAirT: 0.30,        // s of air after which the bank is thrown away
  // ---- THE BANK GOES UP AT A TAKEOFF (spec 0008). Greg: "the no pump jumps
  // are usually good, but the compression ones are long but not as high as i
  // expect", and the model said exactly that: `_pumpQ` pays out as `vf += add`
  // and NOTHING ELSE, so pumping into a lip only ever raised the forward speed
  // the lip's own vertical was multiplied against. Longer, never higher.
  //
  // So at the instant the ski leaves the snow, whatever the bank still holds is
  // spent as an impulse ALONG THE GROUND NORMAL instead — which is the honest
  // direction for a leg extension and gives all three cases for free:
  //   * flat ground  → n = up, pure height, which is the complaint;
  //   * a ramp       → n leans back uphill, so height plus a little braking;
  //   * an uphill face taken fast → n points against travel and you BOUNCE OFF.
  // The third one is not a bug to clamp away (Greg: "that would mean popping on
  // too much vertical goes against u cuz u bounce off"); `pumpLaunchMax` is the
  // only guard, and it is a ceiling on the impulse, not on its direction.
  //
  // `pumpLaunchK: 0` is the off switch and it is exact: no impulse, no drain,
  // and skiLaunch writes the bytes it wrote before this block existed.
  pumpLaunchK: 0.85,     // share of the un-spent bank spent along the normal at takeoff
  pumpLaunchMax: 5.0,    // m/s — ceiling on that impulse

  // ---- STIVOT / STOP (spec 0002 §2). Also inert at 1 / 0.
  stivotAng: 0.55,       // rad — slip angle that counts as thrown sideways
  stivotVr: 3.0,         // m/s — ...with real lateral speed behind it
  stivotRate: 1.6,       // rad/s — ...thrown, not drifted into
  stivotShortT: 0.45,    // s — under this it is a stivot, over it a scrub
  stivotGrip: 0.35,      // × grip while sideways (sideways skis slide)
  stivotHook: 1.55,      // × carveRecover on exit — the edge hooks up
  stivotHookT: 0.30,     // s the hook lasts
  hockeyMul: 1.6,        // × brake when the stop is sideways rather than a plow
  plowSplay: 0.22,       // rad — per-ski yaw in the pizza (presentation)
  plowRoll: 0.18,        // rad — inside edges in the pizza (presentation)
  hockeyRoll: 0.55,      // rad — hard uphill edges in a hockey stop (presentation)

  // ---- MOMENTUM CARRY AND THE LIP. Three effects, and every one of them is
  // inert at 0 — `carryMax: 0, lipK: 0, lipCompK: 0` gives back, bit for bit,
  // the file above this block.
  //
  //   1. CARRY (`carry*`). Redirecting speed uphill costs what it costs — the
  //      fall line still points behind you and still decelerates you — but a
  //      fast skier pays LESS of it than a slow one. It only ever scales the
  //      half of the fall-line term that OPPOSES travel, so the downhill half
  //      is untouched and terminal speed is unchanged BY CONSTRUCTION, not by
  //      calibration.
  //
  //   2. THE LIP (`lip*`). The controller zeroes vel.y on every grounded frame,
  //      so a ski leaving a RISING lip has always left it flat: the direction
  //      the ramp was sending you was thrown away at the edge, and every
  //      takeoff in this world was a horizontal one. `lipK` hands that
  //      direction back, and `lipCompK` hands back the COMPRESSION on top of
  //      it — how much more upward the surface is sending you now than it was a
  //      third of a second ago, which is exactly what the transition out of a
  //      gully wall or the back of a big roller does to you.
  //
  //   3. THE POP (`pop*`). A jump edge inside a window around the lip — shortly
  //      before it, at it, or inside a coyote window just after you have left —
  //      adds a bonus along the launch direction. The bonus is a fraction OF the
  //      lip's own vertical, so a pop with no lip under it is arithmetically
  //      untouched: no lip, no bonus, and a flat-ground jump is the jump it
  //      always was.
  carryMax: 0.35,        // share of the uphill fall-line decel a fast skier stops paying
  carryV0: 10,           // m/s — at and below this the carry is exactly zero
  carrySpan: 16,         // m/s — span from carryV0 to the full carry
  // CALIBRATED, and the ceiling is the number to reach for first. Apex goes as
  // vy², so at game gravity (16 m/s²) `lipMax` alone reads as lipMax²/32 metres
  // of extra height — 6.5 is 1.3 m, and the 9.0 this started at was 2.5 m on
  // every roller on the mountain, which is a different game rather than a feel
  // change. `lipMin` is the other guard and it matters as much: below it the
  // launch is not scaled down, it is skipped, so small terrain rolls leave the
  // ground exactly as flat as they always did. Measured over a 4536-line sweep
  // of the world at 25 m/s, 97% of takeoffs charge nothing at all.
  // ...and the COMPRESSION HALF IS CAPPED SEPARATELY (spec 0008 §3.2). One
  // shared `lipMax` meant that on any ramp worth jumping the ramp term alone
  // reached the ceiling and the compression was arithmetically deleted — which
  // is the second half of "the compression ones are long but not as high".
  // `min(lipMax, ramp) + min(lipCompMax, comp)` keeps the ramp's own ceiling
  // exactly where it was, so A PURE RAMP JUMP IS UNCHANGED TO THE METRE, and
  // gives what you loaded into it its own, smaller headroom on top.
  // `lipCompK: 0` reduces the two forms to each other exactly.
  //
  // ---- `lipCompK` STAYS AT 0.25, and that IS a deviation from spec 0008 §3.2,
  // which asks for 0.50 (and popCompK 0.35). Measured on park.mjs's jump-2 —
  // the same ramp, the same entry, the same scripted line, before and after:
  //
  //     case A (no pump, ramp only)   apex 0.582 m -> 1.036 m   +78 %
  //
  // The spec's own §4 row A is "apex and distance within 2 % of before", and
  // §3.2 justifies the bump with "a pure ramp jump is therefore unchanged". It
  // is not: a BUILT kick has a transition scooped into it, so an unpumped run
  // down it carries a real compression, and doubling `lipCompK` lands on every
  // no-pump jump in the park — against Greg's own "the no pump jumps are usually
  // good". At 0.25 case A is unchanged TO THE FLOAT and case B still gains
  // +82 % of apex, so §3.2's actual complaint is answered by `lipCompMax` and
  // `pumpLaunchK` without touching the unpumped jump. Same call, and the same
  // reasoning, as the pump block above: the spec offers a number, the ramp
  // decides it. `{ lipCompK: 0.50, popCompK: 0.35 }` restores the spec's set.
  lipK: 0.55,            // share of the ramp's own vertical rate carried off the lip (2026-09-01: 0.45 → 0.55, Greg: more air when earned)
  lipCompK: 0.25,        // ...and of the compression that built up into it
  lipMax: 7.5,           // m/s — ceiling on the ramp-given vertical (1.75 m of apex; was 6.5)
  lipCompMax: 3.0,       // m/s — the compression's OWN ceiling, added after that one
  lipMin: 1.6,           // m/s — under this the lip gave nothing, and nothing is added
  lipFloorT: 0.35,       // s — how fast the compression reference creeps back up
  lipSmoothT: 0.05,      // s — low-pass on the surface rate (a triangulated mesh has edges)
  lipHoldT: 0.20,        // s — the charge is held at its recent PEAK for this long
  popWindow: 0.16,       // s — a pop this long BEFORE the lip still counts
  popCoyote: 0.14,       // s — ...and this long after leaving it (coyote time)
  popLipK: 0.35,         // × the lip's vertical, as the well-timed pop's bonus
  popLipMax: 2.2,        // m/s — ceiling on that bonus
  // ---- POP OUT OF A COMPRESSION (Greg, playtest 2): "I don't get the
  // expected upward lift when I jump with it". Correct, and by construction:
  // `lipCompK` only pays where the RAMP TERM IS POSITIVE, because paying it on
  // descending ground was the free-height bug. So a deliberate pop out of a
  // deep compression on flat or fall-line snow got plain jumpVel — the loaded
  // skis gave nothing, which is the opposite of what loading a ski is for.
  //
  // This is that payout, and the thing that makes it safe is the thing that
  // makes it right: IT REQUIRES THE JUMP INPUT. The anomaly was free height
  // with no input; this is a pump, and a pump is a thing you do. It is also
  // mutually exclusive with `lipCompK` — where the lip already pays the
  // compression, this pays nothing — so compression is never banked twice.
  // ...and this one stays at 0.18 for the same measured reason `lipCompK` does
  // (see the note there): it is the flat-ground twin of the same term, and 0008
  // §4's case C is already +218 % of apex without it.
  popCompK: 0.18,        // × the compression the ski is carrying, as pop lift
  popCompMax: 3.0,       // m/s — ceiling on it

  //   4. THE DROP-AWAY (`drop*`). The OTHER half of a knuckle, and the opposite
  //      mechanism to the lip: the lip ADDS vertical, this one REMOVES GLUE.
  //
  //      The controller keeps you stuck to ground that is falling away by
  //      snapping you back down to it — `max(snapDown, speed·dt·snapMul)` — and
  //      because that snap grows with speed, the faster you go the harder the
  //      backside of a roller holds you: at 25 m/s a knuckle can drop 0.83 m in
  //      a single frame (a 63° break) and you are still on the snow. That is
  //      "glued down the backside", and it is why bombing a rolling pitch never
  //      sends you anywhere.
  //
  //      So the snap LETS GO, by an amount speed and load decide: a ski carrying
  //      real speed and a real compression comes off a knuckle, a mellow slow one
  //      stays stuck exactly as it always did. Nothing is added to the velocity —
  //      you simply keep the flat momentum you already had, which is the whole of
  //      what Greg asked for. `dropRelease: 0` is the old snap, unconditionally.
  //
  //      These are DELIBERATELY separate knobs from the lip set: knuckle-sends
  //      and lip-launches are two different complaints and have to be dialled
  //      apart.
  //      WHAT LETS GO IS THE MARGIN, not the snap. The snap is not only knuckle
  //      glue: because vel.y is zeroed on every grounded frame, it is also the
  //      only thing re-attaching you to ordinary downhill at all, and a 40 deg
  //      chute at 25 m/s genuinely needs 0.35 m of it per frame just to be
  //      skiable. So the floor is not a constant here — it is what the surface
  //      you are ON is already demanding — and only the SLACK above that is up
  //      for release. A steep chute keeps everything it needs; a roller on a
  //      mellow pitch keeps almost nothing, and that difference is the feature.
  dropRelease: 0.88,     // share of the SLACK above the surface's own demand that lets go (was 0.80)
  dropV0: 11,            // m/s — at and below this the snap is exactly today's (was 13: rollers let go a bit sooner)
  dropSpan: 12,          // m/s — span from dropV0 to the full release
  dropCompRef: 8.0,      // m/s of compression that counts as fully loaded
  dropLoadMin: 0.45,     // share of the release an UNLOADED ski still gets at speed
  dropMargin: 1.25,      // × what the reference surface demands, as the hold-down floor
  dropRefT: 0.30,        // s — how slowly that reference follows the ground STEEPENING
  dropFloor: 0.18,       // m — absolute floor under all of it (anti-chatter on flats)
};

// Lengths/speeds/accelerations scale with the scene's unit; rates (1/s) and
// pure ratios do not; the quadratic drag coefficients are 1/length.
export function scaleSkiTuning(u, over = {}) {
  const S = { ...SKI_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'glideFriction', 'brake', 'skate', 'skateMax', 'landMin',
    'chatterSpeed', 'chatterSpan', 'chatterDrag',
    // pump: a bank is a speed, the load weight an acceleration, the engagement
    // thresholds speeds, and the sidecut radius a length. Rates (1/s), ratios
    // and radians are unitless and stay put.
    'pumpMax', 'pumpLoadK', 'pumpVr0', 'pumpVrSpan', 'pumpCharge', 'pumpRadius',
    // carry/lip: the thresholds and the ceilings are speeds; the K's are shares
    // and the windows are times, so neither scales.
    'carryV0', 'carrySpan', 'lipMax', 'lipMin', 'popLipMax', 'lipCompMax',
    'dropV0', 'dropSpan', 'dropCompRef', 'dropFloor', 'popCompMax',
    // the takeoff impulse is a speed; its share of the bank is a ratio
    'pumpLaunchMax',
    // the standing/sliding line is a speed; the two mu's are tangents of an
    // angle and are unitless, so they must NOT scale
    'holdV',
    'stivotVr']) S[k] *= u;
  for (const k of ['dragQuad', 'airDrag', 'rollPerLateral']) S[k] /= u;
  return S;
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrapPi = (a) => { const m = (a + Math.PI) % (2 * Math.PI); return (m < 0 ? m + 2 * Math.PI : m) - Math.PI; };

// Chatter is the only stateful thing in this module: an oscillator phase, and
// the amount of it currently being carried (read by the HUD and by tests).
// ...plus the carve roll, which is stateful for the same reason a camera bank
// is: it eases toward what the turn is asking for rather than snapping to it.
// `_roll` is the smoothed carve; `_rollOut` is that with the chatter shimmy
// laid on top, and is the number the renderer actually uses.
let _chatT = 0, _chatter = 0;
let _roll = 0, _rollOut = 0, _prevYaw = 0;

// ---- static friction, for the HUD and the tests. `_hold` is 1 on a frame the
// edges took the whole of gravity (the body is parked), 0.5 on a frame they took
// as much as they could and the slope still won (a slow slide down something
// past the hold angle), 0 whenever the model is kinetic — which is every frame
// with a hand on the controls and every frame above `holdV`. `_holdMu` is the
// coefficient that frame used, so "why did it not hold" is one number.
const CLASS_ROCK = 1;
let _hold = 0, _holdMu = 0;

// Which coefficient the surface under the feet is worth. controller.js samples
// `groundAt` at our position on the line above the call into this module, so
// `groundClass()` is already the class under THESE feet — no second probe, and
// nothing here writes to the collision soup. A caller that hands us no soup
// (the rig previews, any future harness) gets snow, which is the safe answer:
// snow holds better, so a missing class can only ever park a body that stone
// would have let slide, never the other way round.
function _muFor(ctx, S) {
  const C = ctx.collision;
  const cls = (C && typeof C.groundClass === 'function') ? C.groundClass() : 0;
  return cls === CLASS_ROCK ? S.muRock : S.muSnow;
}

// Coulomb friction spending a budget of `dv` m/s against the XZ velocity. It
// stops a body; it never reverses one, so the scale is clamped at zero.
function _arrest(vel, dv) {
  if (!(dv > 0)) return;
  const sp = Math.hypot(vel.x, vel.z);
  if (sp <= 1e-9) { vel.x = 0; vel.z = 0; return; }
  const k = Math.max(0, sp - dv) / sp;
  vel.x *= k; vel.z *= k;
}

// ---- pump state. The bank itself, which half of the turn we are in, the peak
// engagement and when it happened (the two things the transition is graded on),
// how far the turn has actually swept and how long it has lasted (the two
// anti-wiggle gates), and the payout currently being spread out.
let _pumpQ = 0, _pumpPhase = 0, _pumpEPeak = 0, _pumpTPeak = 0;
let _pumpSweep = 0, _pumpTurnT = 0, _pumpRelLeft = 0, _pumpRelT = 0, _pumpPay = 0;
let _pumpEta = 0, _pumpLoad = 1, _pumpE = 0, _pumpA = 0;
let _aPrev = 0, _aHave = false, _daSm = 0, _rollSign = 0;
let _latchX = 0, _latchZ = 0, _latched = false;
let _airT = 0, _rollAdd = 0, _burst = 0, _pumpLPeak = 0;
// the last edge change, itemised. The HUD colours the arc by `eta`; the tests
// read the whole breakdown, because "the pump feels weak" is four different bugs
// and this is the one number set that tells them apart.
let _pumpN = 0, _pumpPaidN = 0, _flatT = 0;
// lifetime ledger, in m/s actually written to vf and actually taken back out of
// it. "Does the pump do anything" is otherwise unanswerable: on real terrain the
// speed trace is dominated by what the ground did, and a 0.1 m/s effect is
// invisible in it. These two numbers are exact and attributable.
let _given = 0, _cost = 0;
let _last = { q: 0, eta: 0, retention: 0, timing: 0, sweep: 0, turnT: 0, headroom: 0, flat: 0, payout: 0, ok: false };
// ---- stivot / stop state
let _stivT = -1, _hookT = 0, _hookK = 1, _slip = 0, _stopMode = 0;   // _stopMode 0 none, 1 plow, 2 hockey
// ---- what the two ski rigs are actually doing, resolved here so the renderer
// never has to know whether it is looking at a carve, a pizza or a hockey stop
let _splay = 0, _edgeL = 0, _edgeR = 0;
// ---- the lip. `_vyS` is the vertical velocity the SURFACE is imparting (the
// contact constraint v·n = 0 solved for the vertical), low-passed; `_vyFloor`
// is the compression reference it is measured against; `_lipVy` is what the
// last grounded frame would hand a takeoff, and the two `Paid` flags make the
// launch and the pop bonus one-shot per air. `_popT` is the last jump edge, on
// `_chatT`'s clock — the one monotonic sim time this module already keeps.
let _vyS = 0, _vyFloor = 0, _lipVy = 0, _lipHold = 0;
let _lipPaid = true, _popPaid = true, _popT = -1e9, _popVy = 0, _wasGnd = false;
// ...and the two halves of the charge kept apart, PRE-clamp and signed, purely
// so the lab meter can say WHY there is or is not a launch. `_lipRamp` is what
// the surface itself is worth and goes negative on descending ground; `_lipComp`
// is what the compression is worth and never does. Their clamped sum is the
// charge. `_launchLog` is the one-shot record of the last takeoff.
let _lipRamp = 0, _lipComp = 0, _launchLog = null;
// ---- the last GROUNDED normal, and the one-shot that keeps the bank's takeoff
// impulse to one payment per air (spec 0008 §3.1). The launch can resolve a
// frame after the last contact — the controller fires it on the jump edge and
// again on the grounded→air edge — so the direction has to be remembered rather
// than read from a ctx that no longer has one. It starts as UP, which is what
// flat ground and a cold start both are.
// `_lnP*` is the normal of the face the LIP CHARGE PEAKED on — the face that
// actually loaded the ski — and it is what the bank is spent along wherever
// there is a charge; `_ln*` is the plain last-grounded normal and is what a
// flat pop or a chargeless roll-off gets.
let _lnx = 0, _lny = 1, _lnz = 0, _pumpNPaid = true;
let _lnPx = 0, _lnPy = 1, _lnPz = 0, _lnPeak = false;
// ---- the drop-away. `_dVyS` is how fast the SURFACE is changing our vertical
// velocity (m/s per second, negative when the ground is falling away); compared
// against gravity it is the honest 'is this steeper than a ballistic path'
// test, and it is what distinguishes a knuckle release from an ordinary
// roll-off in the meter. `_dropK` is how much of the snap is currently let go,
// and `_dropFull`/`_dropCut` are the two snap distances the meter prints.
let _dVyS = 0, _dropK = 0, _dropFull = 0, _dropCut = 0, _lastSp = 0, _lastDt = 1 / 60, _grav = 16;
// the surface the HOLD is sized against. It follows the ground getting mellower
// instantly and the ground getting steeper only over `dropRefT`, which is the
// whole trick: sized against the live surface instead, a knuckle buys its own
// glue — the steeper it breaks the more snap it justifies — and the release can
// never fire. Lagged, the slack that appears when the ground suddenly steepens
// is exactly what gets let go.
let _vyRef = 0;

const SIN25 = Math.sin(25 * Math.PI / 180);

// Everything stateful in this module, back to a cold start. controller.js calls
// it wherever it clears wipeT — respawn, gear change, teleport — because a bank
// charged on the pitch you just left is not yours on the one you arrived at.
export function resetSki() {
  _pumpQ = 0; _pumpPhase = 0; _pumpEPeak = 0; _pumpTPeak = 0;
  _pumpSweep = 0; _pumpTurnT = 0; _pumpRelLeft = 0; _pumpRelT = 0; _pumpPay = 0;
  _pumpEta = 0; _pumpLoad = 1; _pumpE = 0; _pumpA = 0; _pumpLPeak = 0;
  _aPrev = 0; _aHave = false; _daSm = 0; _rollSign = 0;
  _latched = false; _airT = 0; _rollAdd = 0; _burst = 0;
  _pumpN = 0; _pumpPaidN = 0; _flatT = 0; _given = 0; _cost = 0;
  _last = { q: 0, eta: 0, retention: 0, timing: 0, sweep: 0, turnT: 0, headroom: 0, flat: 0, payout: 0, ok: false };
  _stivT = -1; _hookT = 0; _hookK = 1; _slip = 0; _stopMode = 0;
  _splay = 0; _edgeL = 0; _edgeR = 0;
  _vyS = 0; _vyFloor = 0; _lipVy = 0; _lipHold = 0;
  _lipPaid = true; _popPaid = true; _popT = -1e9; _popVy = 0; _wasGnd = false;
  _lipRamp = 0; _lipComp = 0; _launchLog = null;
  _lnx = 0; _lny = 1; _lnz = 0; _pumpNPaid = true;
  _lnPx = 0; _lnPy = 1; _lnPz = 0; _lnPeak = false;
  _dVyS = 0; _dropK = 0; _dropFull = 0; _dropCut = 0; _lastSp = 0; _vyRef = 0;
  _hold = 0; _holdMu = 0;
}

export function skiState() {
  return {
    chatter: _chatter, roll: _rollOut, carveRoll: _roll, rollDeg: _rollOut * 180 / Math.PI,
    // ---- the pump, for the HUD arc, the FX burst and the tests
    pumpQ: _pumpQ, pumpEta: _pumpEta, pumpPhase: _pumpPhase,
    load: _pumpLoad, edge: _pumpE, fall: _pumpA,
    releasing: _pumpRelT > 0, payout: _pumpPay,
    turns: _pumpN, paid: _pumpPaidN, last: _last, given: _given, cost: _cost,
    // ---- the stop/stivot machine
    stivot: _stivT >= 0 ? _stivT : 0, stivoting: _stivT >= 0,
    hook: _hookT > 0, slip: _slip, stop: _stopMode,
    // ---- the lip, for the tests: what the surface is doing to the vertical,
    // what the compression has built to, and what a takeoff would be handed
    // right now. "the lip feels weak" is three different numbers.
    surfVy: _vyS, vyFloor: _vyFloor, comp: Math.max(0, _vyS - _vyFloor),
    lipRamp: _lipRamp, lipComp: _lipComp, lipVy: _lipVy,
    lipPaid: _lipPaid, popPaid: _popPaid, airT: _airT,
    // seconds since the last jump edge, on the same clock the pop window uses.
    // The meter compares it against popWindow/popCoyote itself — this module
    // does not decide what a HUD calls "at the lip".
    sincePop: _chatT - _popT,
    // ---- the drop-away: the surface's own vertical acceleration against
    // gravity, how much of the snap is being let go, and the two distances.
    dVyS: _dVyS, gravity: _grav, dropK: _dropK, snapFull: _dropFull, snapCut: _dropCut,
    // ---- static friction: 1 = parked, 0.5 = holding as hard as it can and
    // still losing, 0 = kinetic. `holdMu` is the coefficient of the surface.
    hold: _hold, holdMu: _holdMu,
  };
}

// One-shot drains for the presentation layers: the release burst (FX) is worth
// exactly one read, and so is the extra leg extension laid on the ski roll.
export function takeSkiBurst() { const b = _burst; _burst = 0; return b; }

// ------------------------------------------------------- THE BANK, READ-ONLY
// specs/0006. The jump-power aura wants ONE number — "how much jump is stored
// right now, 0..1" — and it must not be able to move it. Everything below is a
// pure read: no writes, no drains, no clocks. Delete the aura and this file
// behaves identically, which is the whole point of it being separate from
// skiState() (which the HUD, the FX plume and the tests already share).
//
// THE TWO HALVES ARE MAXED, NEVER SUMMED (spec §2.1). The carve bank `_pumpQ`
// is horizontal m/s waiting to be handed back at the next transition; the lip
// charge `_lipVy` is vertical m/s waiting to be handed to a takeoff. They are
// different currencies, and adding them would let a half-full bank plus a
// half-charged lip paint a full flame, which is not what either of them is.
//
// `launch` is handed back BY REFERENCE and is the takeoff EDGE TOKEN: skiLaunch
// builds a fresh record object per takeoff, so a consumer that remembers the
// object it last saw sees the edge without draining anything. That matters —
// takeSkiLaunch() is a one-shot the lab meter already owns, and two readers of
// one drain is a bug where one of them silently never fires.
export function bankState(S) {
  const T = S || SKI_TUNING;
  const bankMax = T.pumpMax || 1;
  const chargeMax = T.lipMax || 1;
  const bankNorm = clamp01(_pumpQ / bankMax);
  const chargeNorm = clamp01(_lipVy / chargeMax);
  return {
    bank: _pumpQ, bankMax, bankNorm,
    charge: _lipVy, chargeMax, chargeNorm,
    p: bankNorm > chargeNorm ? bankNorm : chargeNorm,
    // what the last takeoff actually added to vel.y, and the record it came from
    launch: _launchLog,
    launchTotal: _launchLog ? (_launchLog.total || 0) : 0,
  };
}

// One step of ski dynamics. Mutates ctx.vel (XZ only — the controller owns Y,
// gravity and ground contact) and returns the new yaw and camera bank.
//
// ctx: { vel, yaw, keys, grounded, normal|null, gravity, dt, S, lean }
export function skiStep(ctx) {
  const { vel, keys, dt, S } = ctx;
  let yaw = ctx.yaw;

  // ---- W/S are a SIGNED PUSH along the ski axis, and "stop" is emergent from
  // it (spec §2.1). A push that opposes travel is the brake; a push that agrees
  // with it is the skate; from a standstill it is simply which way you shove.
  // Moving backward, S therefore drives and W stops, and no switch-detection
  // special case is needed — sign(vf) IS the switch detector.
  //
  // On the snow the arrows are EXACT aliases of W/S: arrow-up still skates and
  // arrow-down still plows. They only become the trick axis once you leave the
  // ground (spec §3.1), so nothing about skiing changes.
  const pushF = !!(keys.forward || (ctx.grounded && keys.flipFwd));
  const pushB = !!(keys.back || (ctx.grounded && keys.flipBack));
  const push = (pushF ? 1 : 0) + (pushB ? -1 : 0);
  // SHIFT DOES NOTHING ON SKIS. The tuck/absorb job it briefly held is
  // withdrawn — see the two sites below, which are now a constant 1 and the
  // plain dragQuad. `keys.tuck` is no longer set by anything and no longer read
  // here, so a run with SHIFT held is bit-for-bit the run without it.
  // `pumpTuckMul` and `tuckDrag` stay in the tuning table as dead numbers rather
  // than being deleted: every ski model overrides that table BY NAME, and
  // removing a key would silently change what those models override.

  const sp0 = Math.hypot(vel.x, vel.z);
  const fast = Math.min(1, sp0 / S.maxSpeed);

  // ---- chatter. Only on the snow — in the air there is nothing to shimmy
  // against — and only above this ski's threshold.
  _chatT += dt;
  // ...and `_chatT` doubles as the module's monotonic sim clock, which is all
  // the pop window needs. The jump edge is stamped here, BEFORE the controller
  // acts on it, so a pop the ramp then swallowed (press SPACE hard into a
  // compression and the rising ground re-grounds you inside the same frame) is
  // still on the record when the real lip arrives a tenth of a second later.
  if (keys.jump) _popT = _chatT;
  const ch = _chatter = (ctx.grounded && S.chatterSpeed < Infinity && sp0 > S.chatterSpeed)
    ? Math.min(1, (sp0 - S.chatterSpeed) / (S.chatterSpan || 6))
    : 0;

  // ---- steer. A/D rotate the skis; the mouse still turns you as well, and the
  // two simply add — mouse for the line, A/D for the lean. On the ground the
  // arrow keys are just more steer; in the air they are the trick handles and
  // wind you round hard enough to close a 360 inside a second of hang time.
  let turn = 0;
  if (keys.left) turn += 1;
  if (keys.right) turn -= 1;                     // +yaw is left (forward is -Z)
  let spin = 0;
  if (keys.spinLeft) spin += 1;
  if (keys.spinRight) spin -= 1;
  if (ctx.grounded) {
    const rate = S.steer * (1 - (1 - S.steerAtMax) * fast);
    // A/D CARVE. The arrows PIVOT (Greg: "arrow keys while on ground should be
    // stivot not carve"). They used to be a second pair of carve keys, which is
    // a thing A/D already were, and — more to the point — the carve steer can
    // never throw the skis hard enough to trigger anything: at 20 m/s it is
    // 1.09 rad/s against a `stivotRate` entry threshold of 1.6, so no key on the
    // board could ever start a stivot and only the mouse could. `pivotRate` is
    // above that threshold on purpose: holding an arrow THROWS the skis across
    // the direction of travel, the slip angle and the lateral speed build, and
    // §2.2's detector picks it up as the pivot-slip it already knows how to run.
    //
    // The seam is deliberately this one line. `keys.spinLeft/spinRight` keep
    // their names and their bindings, main.js's KEYMAP is untouched, the air
    // branch below is byte-identical, and touch.js only ever sets these two
    // while AIRBORNE — so mobile cannot reach this and nothing else has to move.
    // `pivotRate: 0` falls back to the carve rate, which IS the old line —
    // `(turn + spin) * rate` — so this knob is inert at zero like every other
    // one in the table and the change is provable against the old build.
    yaw += turn * rate * dt + spin * (S.pivotRate > 0 ? S.pivotRate : rate) * dt;
    // the shimmy: two incommensurate sines so it never settles into a rhythm
    if (ch > 0 && S.chatterYaw > 0) {
      yaw += (Math.sin(_chatT * 31.7) + Math.sin(_chatT * 19.3)) * 0.5 * S.chatterYaw * ch * dt;
    }
  } else {
    yaw += turn * S.airSteer * dt + spin * S.spinTorque * dt;
  }

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);     // along the skis
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // across the skis

  if (ctx.grounded) {
    _airT = 0;
    // still on the snow one frame after a launch = the ground ate it
    if (_launchLog && _launchLog.pending) { _launchLog.eaten = true; _launchLog.pending = false; }
    const n = ctx.normal;
    // the direction the snow is pushing, remembered for the takeoff impulse
    if (n) { _lnx = n.x; _lny = n.y; _lnz = n.z; }

    // ---- 1. fall line
    let nh = 0, dfx = 0, dfz = 0;
    // HANDS OFF: no W/S (nor their grounded arrow aliases), no A/D, no arrows,
    // no jump. `boosting` never reaches here at all — controller.js skips the
    // gear model outright on a boosted frame — but `thrust` is checked anyway so
    // this reads as the spec wrote it rather than as a fact about a caller.
    const hands = push === 0 && turn === 0 && spin === 0 && !keys.jump && !ctx.thrust;
    _hold = 0; _holdMu = 0;
    if (n) {
      nh = Math.hypot(n.x, n.z);                      // = sinθ for a unit normal
      if (nh > 1e-4) {
        let a = ctx.gravity * Math.min(1, nh) * S.slopeAccel * dt;
        dfx = n.x / nh; dfz = n.z / nh;               // ...and that IS the fall-line direction
        // ---- MOMENTUM CARRY. The fall line is the only thing that ever costs
        // you speed for going up, and at 25 m/s it costs the same as it does at
        // 10 — which is why redirecting real speed onto rising ground scrubs so
        // much of it. Take a speed-scaled bite out of the term, and ONLY where
        // it opposes travel: `along` is +1 pointed straight down the fall line
        // and −1 straight up it, and the carry is gated on `along < 0`. So the
        // downhill half of this line is arithmetically identical to what it has
        // always been, and terminal speed cannot move.
        if (S.carryMax > 0 && sp0 > 1e-3) {
          const along = (dfx * vel.x + dfz * vel.z) / sp0;
          if (along < 0) {
            const k = S.carryMax * (-along)
              * clamp01((sp0 - S.carryV0) / (S.carrySpan || 1));
            a *= 1 - k;
          }
        }
        // ---- STATIC FRICTION (spec 0021 §1). Up to `mu * g * cosθ` of the
        // along-slope pull is simply cancelled by the edges — so the body holds
        // on anything up to `atan(mu)` and, past that, gets only the SURPLUS.
        // `slopeAccel` multiplies both sides, which is what makes the hold angle
        // exactly `atan(mu)` on every ski in the rack rather than a number that
        // drifts with each model's own slope gain.
        if (hands && sp0 < S.holdV) {
          _holdMu = _muFor(ctx, S);
          const cap = _holdMu * ctx.gravity * Math.abs(n.y) * S.slopeAccel * dt;
          if (cap >= a) {
            // parked. The pull is gone entirely, and what is LEFT of the edges'
            // budget arrests whatever creep the body still carries — clamped at
            // zero, because friction stops a body, it never reverses one.
            _hold = 1;
            _arrest(vel, cap - a);
            a = 0;
          } else {
            _hold = 0.5;                              // past the hold angle: slides, slower
            a -= cap;
          }
        }
        vel.x += dfx * a;
        vel.z += dfz * a;
      }
    }
    // ...and the same rule on ground too flat to HAVE a fall line: a standing
    // body on the village square keeps nothing.
    if (n && nh <= 1e-4 && hands && sp0 < S.holdV) {
      _hold = 1; _holdMu = _muFor(ctx, S);
      _arrest(vel, _holdMu * ctx.gravity * Math.abs(n.y) * S.slopeAccel * dt);
    }

    let vf = vel.x * fx + vel.z * fz;
    let vr = vel.x * rx + vel.z * rz;

    // The signed-push table: BRAKE is a push that opposes the way you are going.
    //
    // The case the table does not spell out, and the one the hockey stop needs:
    // SIDEWAYS. Read on the ski axis alone, a skier scrubbing across the hill has
    // `vf` near zero (or negative past 90 deg of slip, tails leading), so the rule
    // says "neither brake nor drive" — or worse, "drive" — at exactly the attitude
    // where a skier is scrubbing hardest, and S would do nothing in the one place
    // you most want it. A ski is symmetric: sideways at 114 deg is sideways at
    // 66 deg with the tails first, and you stop on it either way.
    //
    // What separates SIDEWAYS from genuinely REVERSING is which component is
    // bigger. |vr| > |vf| is the 45..135 deg band — sideways, and S brakes.
    // Outside it the spec's two rows decide it outright, exactly as written.
    const spT = Math.hypot(vf, vr);
    const sideways = spT > 1.0 && Math.abs(vr) > Math.abs(vf);
    const dir = sideways ? 1 : (vf > 0.5 ? 1 : (vf < -0.5 ? -1 : (spT > 1.0 ? 1 : 0)));
    const brake = push * dir < 0;

    // ---- STIVOT (§2.2). A pivot-slip is a DETECTED state, not a key: the skis
    // get thrown across the direction of travel, slide, and re-engage. Entering
    // takes all three of a big slip angle, real lateral speed, and the skis
    // having been THROWN there rather than having drifted.
    const dYaw = wrapPi(yaw - _prevYaw);
    const yawRate = (dt > 1e-6 && Math.abs(dYaw) < 0.6) ? dYaw / dt : 0;
    _slip = Math.abs(Math.atan2(vr, vf));
    let stivGrip = 1;
    if (_stivT >= 0) {
      _stivT += dt;
      // a long slide is a scrub, not a stivot: the grip ramps back over 0.4 s
      // and the exit hook decays with it
      const over = clamp01((_stivT - S.stivotShortT) / 0.4);
      stivGrip = S.stivotGrip + (1 - S.stivotGrip) * over;
      if (_slip < 0.30 || !ctx.grounded) {
        _hookK = 1 + (S.stivotHook - 1) * (1 - over);
        _hookT = S.stivotHookT;
        _stivT = -1;
      }
    } else if (_slip > S.stivotAng && Math.abs(vr) > S.stivotVr && Math.abs(yawRate) > S.stivotRate) {
      _stivT = 0;
    }
    if (brake && _stivT >= 0) _stivT = -1;            // braking out of a slide is a hockey stop
    if (_hookT > 0) _hookT = Math.max(0, _hookT - dt);
    // pizza vs hockey is decided by slip angle, not by which key you pressed
    _stopMode = brake ? (_slip >= S.stivotAng ? 2 : 1) : 0;
    const hookK = _hookT > 0 ? _hookK : 1;

    // ---- 2. edges
    let g = S.grip * (1 - (1 - S.gripAtMax) * fast);
    if (brake) g *= S.brakeGrip;
    if (_stivT >= 0) g *= stivGrip;                   // sideways skis slide, they do not bite
    if (ch > 0) g *= (1 - S.chatterGrip * ch);        // the tails let go
    const keep = Math.exp(-g * dt);
    const scrub = Math.abs(vr) * (1 - keep);
    vr *= keep;
    if (!brake && vf > 0.5) vf += scrub * (S.carveRecover * hookK);

    // ---- 2b. THE PUMP (§1). Additive and self-disabling: at `pumpCharge: 0`
    // and `pumpLoadK: 0` nothing below writes vf, vr or dec, and the four
    // stages either side of it are the code they have always been.
    //
    // `_roll` is the PREVIOUS frame's smoothed edge angle. That one frame of lag
    // is free — the value is an ease anyway — and it is the only signal in the
    // file that already folds in mouse-yaw, A/D and speed, which is exactly the
    // "how committed is this carve" number the bank needs.
    const phi = Math.abs(_roll);
    const nhc = Math.min(1, nh);
    const cth = Math.sqrt(Math.max(0, 1 - nhc * nhc));         // cosθ of the pitch
    // edge angle and sidecut set the turn radius, and the radius sets the load:
    // R = R_sidecut·cos φ is the ideal-carving relation, so an 11 m slalom ski
    // loads up at 15 m/s where a 50 m downhill ski barely loads at all.
    const Rturn = Math.max(1e-3, S.pumpRadius * S.pumpRadK * Math.cos(phi));
    const spP = Math.hypot(vf, vr);
    const gLoad = ctx.gravity > 1e-6
      ? Math.hypot(ctx.gravity * cth, spP * spP / Rturn) / ctx.gravity : 1;
    // two factors, both required: you must be ASKING for the turn (roll) and
    // actually carrying lateral load (vr). A flat ski and a straight-line
    // traverse each give 0 on their own and the bank is completely inert.
    const ePress = clamp01((Math.abs(vr) - S.pumpVr0) / (S.pumpVrSpan || 1));
    const eEng = clamp01((phi - S.pumpEdge0) / (S.pumpEdgeSpan || 1)) * ePress;
    _pumpLoad = gLoad; _pumpE = eEng;

    // turn phase, from the derivative of how well the heading lines up with the
    // fall line. On a true flat there is no fall line to measure against, so the
    // reference is latched to the heading this turn cycle started on — which is
    // what makes pumping a cat track work at all, and it is the case Greg cares
    // most about.
    let ldx = dfx, ldz = dfz;
    if (nh < S.pumpFlatEps || (dfx === 0 && dfz === 0)) {
      if (!_latched) { _latchX = fx; _latchZ = fz; _latched = true; }
      ldx = _latchX; ldz = _latchZ;
    } else _latched = false;
    const aFall = fx * ldx + fz * ldz;      // −1 straight up the hill .. +1 straight down
    _pumpA = aFall;
    // same flick rejection the carve roll uses on the mouse: a jump in alignment
    // that large is a teleport or a snap, not a turn.
    //
    // ...and the raw derivative is then LOW-PASSED. `a` is read off the ground
    // normal, which on a triangulated mesh changes every time you cross an edge,
    // and the unfiltered sign chatters between completion and initiation several
    // times a second on ground that is simply bumpy. A turn takes half a second
    // or more, so a 0.12 s filter cannot hide one — it only removes the mesh.
    const daRaw = (_aHave && dt > 1e-6 && Math.abs(aFall - _aPrev) < 0.6) ? (aFall - _aPrev) / dt : 0;
    _daSm += (daRaw - _daSm) * Math.min(1, dt / 0.12);
    _aPrev = aFall; _aHave = true;
    // da < 0 → COMPLETION, heading rotating away from the fall line, load
    // building, charge here. da > 0 → INITIATION, coming back down, release here.
    _pumpPhase = _daSm < -0.02 ? -1 : (_daSm > 0.02 ? 1 : 0);

    _pumpTurnT += dt;
    _pumpSweep += Math.min(Math.abs(dYaw), 0.6);
    if (ePress > _pumpEPeak) _pumpEPeak = ePress;
    // how long the ski has been sitting FLAT. This is the cross-under signal:
    // snap edge to edge and it stays near zero; stand up, go flat and drift and
    // it grows. Reset the moment there is a real edge angle again either way.
    if (phi < S.pumpEdge0) _flatT += dt; else _flatT = 0;
    const loadNow = Math.max(0, gLoad - 1) * eEng;
    if (loadNow > _pumpLPeak) { _pumpLPeak = loadNow; _pumpTPeak = _pumpTurnT; }

    // CHARGE — only through the completion of the turn, grounded, off the brakes
    if (_pumpPhase < 0 && !brake && eEng > 0) {
      _pumpQ = Math.min(S.pumpMax,
        // ...× 1: the tuck multiplier is withdrawn (SHIFT does nothing on skis)
        _pumpQ + S.pumpCharge * Math.max(0, gLoad - 1) * eEng * dt);
    }
    if (_pumpQ > 0) _pumpQ *= Math.exp(-S.pumpDecay * dt);      // continuous bleed
    if (brake) _pumpQ = 0;                                      // no brake-pump farming

    // TRANSITION — the edge change is the scoring instant
    const rs = _roll > 0.02 ? 1 : (_roll < -0.02 ? -1 : 0);
    if (rs !== 0 && _rollSign !== 0 && rs !== _rollSign) {
      // ANTI-WIGGLE, the exploit that matters: a "turn" that did not sweep far
      // enough or last long enough does not pay, and the bank is DISCARDED
      // rather than carried. Mashing A/D at 20 Hz is not a speed exploit — it is
      // a way to throw away everything you charged.
      _pumpN++;
      _last = { q: _pumpQ, eta: 0, retention: 0, timing: 0, sweep: _pumpSweep, turnT: _pumpTurnT, headroom: 0, flat: 0, payout: 0, ok: false };
      if (_pumpSweep >= S.pumpMinSweep && _pumpTurnT >= S.pumpMinTurnT && _pumpQ > 1e-9) {
        // Did you hold the edge THROUGH the change (cross-under), or stand up,
        // go flat and drift?
        //
        // The spec writes this as `eAtTransition / ePeak`, and that term is
        // identically zero in this model: a transition IS a sign flip of the
        // roll, so at the scoring instant the edge angle is zero BY DEFINITION,
        // and `vr` is crossing zero with it. Measured that way every transition
        // — crisp or lazy — grades 0, which caps eta at 0.90 and means the pump
        // can never break even. Measured instead: HOW LONG THE SKI DWELT FLAT.
        // A cross-under snaps through the dead band in ~50 ms; standing up and
        // drifting sits flat for a third of a second. Same distinction, same
        // technique being rewarded, and it is even more visible on screen.
        // And did you change edges near peak load?
        const retention = clamp01(1 - _flatT / (S.pumpCrossT || 1));
        const timing = clamp01(1 - Math.abs(_pumpTurnT - _pumpTPeak) / (S.pumpWindow || 1));
        const eta = S.pumpEtaMin + (S.pumpEtaMax - S.pumpEtaMin) * (0.5 * retention + 0.5 * timing);
        // headroom SQUARED: real work at 8 m/s, essentially nothing at 27. The
        // pump builds speed; it can never raise terminal speed.
        const hr = Math.max(0, 1 - spP / S.maxSpeed);
        const flat = 1 + S.pumpFlatK * (1 - clamp01(nh / SIN25));
        const payout = eta * _pumpQ * hr * hr * flat;
        _pumpEta = eta;
        _last = { q: _pumpQ, eta, retention, timing, sweep: _pumpSweep, turnT: _pumpTurnT, headroom: hr * hr, flat, payout, ok: true };
        if (payout > 1e-9) {
          _pumpPaidN++;
          _pumpPay = payout; _pumpRelLeft = payout; _pumpRelT = S.pumpReleaseT;
          _burst = payout; _rollAdd = 0.10;
        }
      } else _pumpEta = 0;
      _pumpQ = 0; _pumpEPeak = 0; _pumpLPeak = 0; _pumpTPeak = 0;
      _pumpSweep = 0; _pumpTurnT = 0; _latched = false;
    }
    if (rs !== 0) _rollSign = rs;

    // RELEASE — paid out over pumpReleaseT. An instant add reads as a teleport,
    // and it is not what extending your legs feels like either.
    if (_pumpRelT > 0) {
      if (brake) { _pumpRelT = 0; _pumpRelLeft = 0; }
      else {
        const add = Math.min(_pumpPay * dt / (S.pumpReleaseT || 1), _pumpRelLeft);
        if (add > 0) { vf += add; _given += add; }
        _pumpRelLeft -= add; _pumpRelT -= dt;
      }
    }

    // ---- 3. friction
    let sp = Math.hypot(vf, vr);
    if (sp > 1e-5) {
      // the aero tuck is withdrawn with the rest of SHIFT: one drag figure,
      // whatever is held down
      const dq = S.dragQuad;
      let dec = (S.glideFriction + dq * sp * sp) * dt;
      if (brake) dec += S.brake * (_stopMode === 2 ? S.hockeyMul : 1) * dt;
      if (ch > 0) dec += S.chatterDrag * ch * dt;     // a shimmying ski is slow
      // "INCREASING GRAVITY UPHILL": the felt cost of the load. Zero pointing
      // down the fall line, maximal pointing straight up it, and it applies
      // whether or not you are charging well — which is what makes a lazy
      // skidded traverse heavy and expensive. Charging is never free.
      const wgt = S.pumpLoadK * Math.max(0, gLoad - 1) * eEng * clamp01(-aFall);
      if (wgt > 0) { dec += wgt * dt; _cost += wgt * dt; }
      const k = Math.max(0, sp - dec) / sp;
      vf *= k; vr *= k;
    }

    // ---- skate/pole push: only ever gets you moving, never gets you going fast
    if (push !== 0 && !brake && Math.abs(vf) < S.skateMax) {
      const room = 1 - Math.max(0, Math.abs(vf)) / S.skateMax;
      vf += push * S.skate * room * dt;
    }

    vel.x = fx * vf + rx * vr;
    vel.z = fz * vf + rz * vr;

    // ---- THE LIP. What the SURFACE is doing to our vertical velocity, from the
    // contact constraint v·n = 0 solved for the vertical component. Positive on
    // a rising face — a gully wall, the front of a roller, the exit of a
    // compression — and negative running downhill. The controller pins vel.y to
    // 0 for every frame you are on the snow, so this is the only record the ski
    // keeps of the direction the ground was actually sending it.
    const ny = n ? Math.max(0.25, n.y) : 1;
    const vyRaw = n ? -(vel.x * n.x + vel.z * n.z) / ny : 0;
    const vyWas = _vyS;
    if (!_wasGnd) { _vyS = vyRaw; _vyFloor = vyRaw; _vyRef = vyRaw; _dVyS = 0; }   // touchdown starts the clock
    else {
      _vyS += (vyRaw - _vyS) * Math.min(1, dt / (S.lipSmoothT || 0.05));
      // how hard the SURFACE is pulling our vertical velocity around. Below
      // −gravity the ground is dropping away faster than a thrown object and
      // there is physically nothing left to stand on — which is exactly the
      // moment the ground snap has always overruled and pinned us back down.
      const dv = dt > 1e-6 ? (_vyS - vyWas) / dt : 0;
      _dVyS += (dv - _dVyS) * Math.min(1, dt / (S.lipSmoothT || 0.05));
    }
    _grav = ctx.gravity;
    if (_vyS > _vyRef) _vyRef = _vyS;
    else _vyRef += (_vyS - _vyRef) * Math.min(1, dt / (S.dropRefT || 0.3));
    // The compression reference is a running MINIMUM that creeps back up, and
    // the rise above it is the compression: how much more upward the ground is
    // sending you now than it was `lipFloorT` ago. A running minimum rather than
    // an integral of the positive increments ON PURPOSE — an integral rectifies
    // mesh noise into a charge that only ever grows, and this cannot: noise the
    // floor can follow contributes nothing.
    if (_vyS < _vyFloor) _vyFloor = _vyS;
    else _vyFloor += (_vyS - _vyFloor) * Math.min(1, dt / (S.lipFloorT || 0.35));
    // ...and seeding the floor at touchdown is what stops a landing from being a
    // trampoline: land on a rising face and the ramp rate is large immediately,
    // but there was no compression under it, so there is nothing to pay out.
    // THE RAMP TERM IS SIGNED, and that is the whole difference between this
    // launching you off things that go up and launching you off everything.
    // Clamping it at zero — which is how this shipped first — left the
    // compression term completely unopposed on a DESCENDING surface, and a
    // census of 255 fall-line downhill runs found that 100% of the charges it
    // produced were on ground that was sending the rider DOWN: at (-125, 285)
    // the surface was pushing −11.3 m/s and the ski was handed +4.96 m/s of
    // upward launch for it, no pop required. Greg played it and reported
    // "jumping higher than usual on downhills", which is exactly that.
    // Signed, a falling surface has to be OUT-COMPRESSED before it pays, and
    // the gully-wall and roller cases — where the surface really is rising —
    // are untouched because both terms are positive there.
    _lipRamp = _vyS * S.lipK;
    _lipComp = Math.max(0, _vyS - _vyFloor) * S.lipCompK;
    // ...and the charge is then HELD at its recent peak, decaying to nothing
    // over `lipHoldT`. Without the hold the value read at the takeoff frame is a
    // one-frame lottery: the ramp rate collapses across the crest, so a pop
    // landing on the frame before the edge and a pop landing on the edge itself
    // came out 2:1 apart, and a COYOTE pop — which reads the charge that was
    // banked a beat earlier — beat both of them. The peak is the honest number:
    // it is what the ramp did to you, not what the last triangle did.
    // ...and THE TWO HALVES ARE CAPPED APART (spec 0008 §3.2). Under one shared
    // ceiling the ramp term alone reached `lipMax` on any ramp worth jumping and
    // the compression the rider had actually loaded contributed nothing — the
    // arithmetic behind "the compression ones are long but not as high". The
    // ramp keeps its own ceiling untouched, so a pure ramp jump (comp = 0) is
    // the jump it always was, and the compression gets its own smaller headroom
    // stacked on it. `lipCompK: 0` reduces this to the old single-cap form
    // exactly — `lipCompMax` does not, because the two differ precisely where
    // the old shared ceiling was binding, which is the case being fixed.
    const lipNow = Math.max(0,
      Math.min(S.lipMax, _lipRamp) + Math.min(S.lipCompMax, _lipComp));
    // ...and THE NORMAL IS HELD AT THE SAME PEAK, for the same reason the charge
    // is (spec 0008 §3.1). A tabletop's crest is a 74 deg edge, so the LAST
    // grounded triangle at a roll-off is already the back face, whose normal
    // points down-track: spend the bank along that and a pumped jump comes out
    // both higher AND 21 % longer, which is half of Greg's complaint restored.
    // The face that actually loaded the ski is the face the charge peaked on,
    // and its normal leans back-uphill — height, and a little braking, which is
    // what §3.1 describes. One line, the same peak, no second clock.
    const decayed = _wasGnd ? _lipHold - (S.lipMax / (S.lipHoldT || 0.2)) * dt : -Infinity;
    if (lipNow >= decayed) {
      _lipHold = lipNow;
      if (n) { _lnPx = n.x; _lnPy = n.y; _lnPz = n.z; _lnPeak = true; }
    } else _lipHold = decayed;
    _lipVy = _lipHold >= S.lipMin ? _lipHold : 0;
    _lipPaid = false; _popPaid = false; _pumpNPaid = false;
    _wasGnd = true;
  } else {
    // airborne: momentum is yours, minus a little air. A bank charged on the
    // snow is not something you can carry through a jump.
    _airT += dt;
    _wasGnd = false;
    if (_launchLog && _launchLog.pending) _launchLog.pending = false;   // it took
    _popVy = 0;                  // a pop that flew is spent; only a swallowed one
                                 // is still owed anything (see skiLaunch)
    if (_stivT >= 0) _stivT = -1;
    _stopMode = 0;
    if (_airT > S.pumpAirT) { _pumpQ = 0; _pumpRelT = 0; _pumpRelLeft = 0; }
    if (sp0 > 1e-5) {
      const k = Math.max(0, sp0 - S.airDrag * sp0 * sp0 * dt) / sp0;
      vel.x *= k; vel.z *= k;
    }
  }

  const sp = Math.hypot(vel.x, vel.z);
  _lastSp = Math.min(sp, S.maxSpeed);      // what the drop-away release scales with
  _lastDt = dt;
  if (sp > S.maxSpeed) {
    const k = S.maxSpeed / sp;
    vel.x *= k; vel.z *= k;
  }

  // ---- bank into the carve, from the edge load actually being carried
  const load = vel.x * rx + vel.z * rz;
  const want = clamp(-load * S.rollPerLateral, -S.maxRoll, S.maxRoll);
  const lean = ctx.lean + (want - ctx.lean) * Math.min(1, S.rollRate * dt);

  // ---- CARVE ROLL. Presentation only: the skis go up on the edge INTO the
  // turn — left edge in a left turn, right edge in a right turn — and come back
  // flat when the line goes straight. Nothing below writes vel, yaw or lean; it
  // is a number skiState() hands the renderer and the physics never reads.
  //
  // The command is the steering you are actually asking for. A/D and the arrows
  // are the obvious half; the other half is the mouse, which turns you outside
  // this function entirely — so we measure how far it moved us since the last
  // step and scale that against this ski's steer authority, and a mouse carve
  // then rolls exactly like a keyed one. A flick past 0.6 rad in a frame is a
  // look, not a carve, and is thrown away.
  const dMouse = wrapPi(ctx.yaw - _prevYaw);
  const mouseCmd = (dt > 1e-6 && Math.abs(dMouse) < 0.6)
    ? clamp(dMouse / dt / Math.max(0.5, S.steer), -1, 1) : 0;
  const cmd = clamp(turn + spin + mouseCmd, -1, 1);
  // ...times speed. At a walk the skis are all but flat; the full 39° is a
  // committed carve well up the ski's range, and it never goes past that.
  const rollK = clamp01((sp / S.maxSpeed - S.carveRollV0) / S.carveRollSpan);
  const wantRoll = cmd * rollK * S.carveRoll * (ctx.grounded ? 1 : S.carveRollAir);
  _roll += (wantRoll - _roll) * Math.min(1, S.carveRollRate * dt);
  // the shimmy rides ON TOP, unsmoothed and on its own two incommensurate
  // sines, so a ski that is letting go still buzzes while it is on edge instead
  // of being averaged flat by the ease above
  _rollOut = _roll + ((ch > 0 && S.carveRollChat > 0)
    ? (Math.sin(_chatT * 27.3) + Math.sin(_chatT * 41.1)) * 0.5 * S.carveRollChat * ch
    : 0);
  // the release adds a touch of extra edge — the visual extension of the legs
  // out of the transition. Presentation only, exactly as the rest of _rollOut is.
  if (_rollAdd > 0) {
    _rollOut += (_roll < 0 ? -_rollAdd : _rollAdd);
    _rollAdd = Math.max(0, _rollAdd - dt * 0.10 / (S.pumpReleaseT || 1));
  }
  // ...and what the two rigs are each doing, resolved once here (§2.3): a pizza
  // is tips-in on the INSIDE edges, a hockey stop is parallel skis across the
  // travel on hard uphill edges, and everything else is the carve.
  if (_stopMode === 1) { _splay = S.plowSplay; _edgeL = -S.plowRoll; _edgeR = S.plowRoll; }
  else if (_stopMode === 2) {
    const s = _slip > 0 && vel.x * rx + vel.z * rz > 0 ? -1 : 1;
    _splay = 0; _edgeL = _edgeR = S.hockeyRoll * s;
  } else { _splay = 0; _edgeL = _edgeR = _rollOut; }
  _prevYaw = yaw;

  return { yaw, lean, roll: _rollOut };
}

// The renderer's half of the carve roll: roll each ski group about its own long
// axis (the origin is the binding, the ski runs down ±Z, so rotation.z IS the
// edge angle). Kept here so main.js only ever asks for the pose it wants and
// never has to know how the number was arrived at.
// ...and the pizza needs a per-ski YAW as well, so the rigs also get a splay:
// tips converge, tails apart. `rigs` is [left, right]; a hockey stop and a
// carve both come through with splay 0 and the two edges equal, so the caller
// never has to know which of the three it is looking at.
export function rollSkiRigs(rigs, k = 1) {
  for (let i = 0; i < rigs.length; i++) {
    const g = rigs[i];
    if (!g) continue;
    g.rotation.z = (i === 0 ? _edgeL : _edgeR) * k;
    const y = i === 0 ? -_splay : _splay;
    if (y !== 0 || g.rotation.y !== 0) g.rotation.y = y;
  }
  return _rollOut * k;
}

// LEAVING the ground, which is the other half of skiLand and used to be nobody's
// job on skis at all. The controller calls this at the two — and only two —
// moments a ski can leave the snow:
//
//   G.launch(vel, S)          rolled off a lip without jumping
//   G.launch(vel, S, jumpVel) the jump edge fired — on the snow at the lip, or
//                             in the coyote window just after it (skiCoyote).
//                             The controller has ALREADY added that jumpVel to
//                             vel.y; it is passed so this file knows what a pop
//                             is worth on the gear being ridden, which it has
//                             no other way to learn.
//
// It is the ONLY place this module writes vel.y, and the two one-shot flags mean
// a single air can collect the ramp launch once and the pop bonus once, however
// many times the controller asks.
//
// With `lipK: 0` and `lipCompK: 0`, `_lipVy` is 0 and every branch below is a
// no-op — a ski tuned that way leaves the ground exactly as flat as it always
// did, and so does a ski leaving flat ground or the edge of a cliff, where the
// ramp gave nothing to hand back.
// WHAT A POP IS WORTH RIGHT NOW, in one place. skiLaunch applies exactly what
// this returns and the lab meter prints exactly what this returns, so the
// prediction on screen cannot drift away from the physics: there is no second
// copy of the arithmetic to drift.
//
// The two compression payouts are MUTUALLY EXCLUSIVE. Where the lip is charged
// (`_lipVy > 0`) the compression has already been banked into that charge by
// `lipCompK`, and the pop adds its percentage bonus on top. Where it is not —
// flat ground, a fall line, anywhere the ramp term came out negative — the pop
// converts the compression directly instead. One or the other, never both, so
// no compression is ever paid for twice.
//
// `gate` is the diagnosis when the answer is small: it names the thing that ate
// it rather than leaving the player to guess.
function popPay(S) {
  const comp = Math.max(0, _vyS - _vyFloor);
  if (_lipVy > 0) {
    return { lip: _lipVy, comp: 0, bonus: Math.min(S.popLipMax, _lipVy * S.popLipK),
             gate: 'lip charged' };
  }
  const sum = _lipRamp + _lipComp;
  const gate = comp <= 1e-6 ? 'no compression'
    : (sum <= 0 ? 'ramp negative' : (sum < S.lipMin ? 'under lipMin' : 'no charge'));
  return { lip: 0, comp: Math.min(S.popCompMax, comp * (S.popCompK || 0)), bonus: 0, gate };
}

// The lab meter's forward look: what SPACE would add to vel.y this instant,
// including the gear's own jump, and what is limiting it. `jumpVel` is the
// controller's number — this module has no way to know it otherwise.
export function skiPopPreview(S, jumpVel = 0) {
  const p = popPay(S);
  const add = p.lip + p.comp + p.bonus;
  return { ...p, add, total: jumpVel + add, jumpVel,
           compRaw: Math.max(0, _vyS - _vyFloor),
           airborne: !_wasGnd, coyote: skiCoyote(S) };
}

export function skiLaunch(vel, S, popVy) {
  // the lab meter's record of this takeoff, itemised. Written on the way through
  // rather than reconstructed after, because "the lip felt like nothing" is four
  // different answers — no charge, charge but no pop, pop outside the window, or
  // a charge the cap ate — and only the itemisation tells them apart.
  // A takeoff is a DROP-AWAY when the release was doing something AND the ground
  // was falling away faster than free fall — the second half is the definition,
  // not a guess: below −gravity there is nothing left to stand on and only the
  // snap was holding us there.
  const drop = _dropK > 0 && _dVyS < -_grav;
  // WHICH FACE THE BANK IS SPENT ALONG (spec 0008 §3.1). Where there is a lip
  // charge, it is the face that charge PEAKED on — the face that actually loaded
  // the ski — because the last grounded triangle at a tabletop roll-off is the
  // 74 deg back edge and its normal points down-track. Where there is no charge
  // (a flat pop, a chargeless roll-off) the last grounded normal is the honest
  // answer and is the one used, which is why case C is untouched by this.
  const peakN = _lipVy > 0 && _lnPeak;
  const nlx = peakN ? _lnPx : _lnx, nly = peakN ? _lnPy : _lny, nlz = peakN ? _lnPz : _lnz;
  _launchLog = { vy0: vel.y, lip: 0, ramp: _lipRamp, comp: _lipComp, charge: _lipVy,
                 drop, dropK: _dropK, dVyS: _dVyS, grav: _grav,
                 snapFull: _dropFull, snapCut: _dropCut,
                 pop: 0, restored: 0, total: 0, src: drop ? 'drop-away' : 'none',
                 // "did it actually take?" — a pop into a rising ramp is added to
                 // vel.y and taken straight back out by the ground snap, and a
                 // meter that cannot say so is a meter that lies about the one
                 // case the player is complaining about. skiStep answers it on
                 // the next frame, whichever branch it lands in.
                 // ---- specs/0008. What the BANK was worth at this takeoff, the
                 // direction it was spent in, and the bank either side of it.
                 pumpN: 0, normal: { x: nlx, y: nly, z: nlz }, normalPeak: peakN,
                 bankBefore: 0, bankAfter: 0,
                 eaten: false, pending: true, taken: false };
  // ---- THE BANK IS SPENT ALONG THE GROUND NORMAL (spec 0008 §3.1). Everything
  // the carve bank still holds — the payout not yet released PLUS anything
  // charged but never triggered — leaves the snow as a velocity impulse in the
  // direction the snow is pushing, instead of waiting to become forward speed
  // on a hill the ski has already left.
  //
  // IT IS DRAINED IN THE SAME BREATH, in proportion to what was actually spent.
  // The speed release below and this are the same energy, and paying it twice
  // would make a pump into a lip both higher AND faster, which is a free lunch
  // rather than a redirection.
  //
  // n.x/n.z are added as well as n.y, deliberately: on a ramp the normal leans
  // back uphill, so a big pop off a steep face costs a little forward speed, and
  // on a face taken fast enough that the normal opposes travel outright you
  // bounce off it. That IS the mechanic, and only `pumpLaunchMax` limits it.
  const bank0 = _pumpRelLeft + _pumpQ;
  _launchLog.bankBefore = bank0;
  const plK = S.pumpLaunchK || 0;
  if (!_pumpNPaid && plK > 0 && bank0 > 1e-9) {
    const spend = Math.min(S.pumpLaunchMax, plK * bank0);
    const f = Math.min(1, spend / plK / bank0);        // share of the bank consumed
    _pumpRelLeft -= _pumpRelLeft * f;
    _pumpQ -= _pumpQ * f;
    vel.x += nlx * spend; vel.y += nly * spend; vel.z += nlz * spend;
    _launchLog.pumpN = spend;
  }
  _pumpNPaid = true;
  _launchLog.bankAfter = _pumpRelLeft + _pumpQ;
  if (!_lipPaid) {
    _lipPaid = true;
    if (_lipVy > 0) { vel.y += _lipVy; _launchLog.lip = _lipVy; }
  }
  if (popVy > 0) _popVy = popVy;          // what a pop is worth on this gear
  const pay = popPay(S);
  // the bank's impulse is named in `src` wherever it fired, because "the pump
  // did nothing" and "the pump fired and the lip was flat" look identical on the
  // stopwatch and are different bugs.
  const bankTag = () => (_launchLog.pumpN > 0 ? ' + bank' : '');
  const done = () => { _launchLog.total = vel.y - _launchLog.vy0;
    _launchLog.src = (_launchLog.lip > 0 ? 'lip' : (drop ? 'drop-away' : (_launchLog.pumpN > 0 ? 'bank' : 'none')))
      + (_launchLog.lip > 0 || drop ? bankTag() : ''); };
  // Nothing under the skis and nothing owed: a pop over flat, uncompressed
  // ground is arithmetically the jump it always was, and it leaves here without
  // touching vel.y or closing the window.
  if (_popPaid || (pay.lip <= 0 && pay.comp <= 0 && pay.bonus <= 0)) { done(); return; }
  // The pop window has three parts. `popVy > 0` is the pop firing right now —
  // on the snow at the lip, or in the coyote window via skiCoyote(). The other
  // is `_chatT - _popT`: a pop shortly BEFORE the lip.
  const late = _chatT - _popT;
  if (!(popVy > 0) && !(late <= (S.popWindow || 0))) { done(); return; }
  _popPaid = true;
  // ...and that third case needs its jump handed back, because the ramp ATE it.
  // Press SPACE into a compression and the controller adds the jump to vel.y and
  // the ground snap takes it straight back out on the same frame, still on the
  // rising face — so the best-timed pop on the mountain was the one that did the
  // least, and a lazy coyote pop a tenth of a second later beat it 2:1. Hand it
  // back at the lip it was aimed at. Once: `_popPaid` closes the window.
  // (`_popVy` is cleared the moment you are actually airborne — see the air
  // branch of skiStep — so a pop that DID take flight can never be paid twice,
  // and only one the ground swallowed is still on the books to restore.)
  if (!(popVy > 0) && _popVy > 0) { vel.y += _popVy; _launchLog.restored = _popVy; _popVy = 0; }
  vel.y += pay.bonus + pay.comp;
  _launchLog.pop = pay.bonus + pay.comp;
  _launchLog.popComp = pay.comp;
  _launchLog.gate = pay.gate;
  _launchLog.total = vel.y - _launchLog.vy0;
  const how = popVy > 0 ? '' : (_launchLog.restored > 0 ? ' (restored)' : ' (pre)');
  _launchLog.src = (pay.lip > 0 ? 'lip + pop' : 'pump + pop') + how + bankTag();
}

// One-shot drain for the lab meter: the last takeoff, itemised, or null. Read by
// hud.js under DEBUG_HUD and by the headless probes; nothing in the shipping
// build ever calls it.
export function takeSkiLaunch() {
  if (!_launchLog || _launchLog.taken) return null;
  _launchLog.taken = true;
  return { ..._launchLog };
}

// THE DROP-AWAY RELEASE. The controller works out how far it is willing to snap
// us back down to ground that is falling away, and then hands that distance here
// to be argued with. Returning `snap` unchanged is the old behaviour, and that
// is what a slow ski gets, every time.
//
// Two factors, and both have to mean something before anything lets go:
//   SPEED — under `dropV0` this returns `snap` on the first line and the whole
//     rule is off. Mellow terrain at walking pace is untouched by construction,
//     not by tuning.
//   LOAD — a ski that has just been compressed comes off a knuckle more easily
//     than a light one, which is both what Greg asked for and what actually
//     happens: the legs are already extending. `dropLoadMin` is what an
//     uncompressed ski still gets, so speed alone does something.
//
// Nothing here writes velocity. The skier leaves the ground with the flat
// momentum they already had — that IS the effect, and it is why this rule needs
// no launch term and cannot interact with the lip's.
export function skiSnapRelease(S, snap) {
  _dropFull = snap;
  _dropK = 0;
  if (!(S.dropRelease > 0)) { _dropCut = snap; return snap; }
  const spd = clamp01((_lastSp - S.dropV0) / (S.dropSpan || 1));
  if (spd <= 0) { _dropCut = snap; return snap; }
  const load = S.dropLoadMin + (1 - S.dropLoadMin)
    * clamp01(Math.max(0, _vyS - _vyFloor) / (S.dropCompRef || 1));
  _dropK = S.dropRelease * spd * load;
  // What the surface under us is already asking for: it falls `-vyS` metres of
  // vertical per second, so it needs that much snap per frame just to be skied.
  // Keeping it (plus a margin) is what stops this from ejecting people off steep
  // chutes, and releasing the SLACK above it is what sends them off knuckles.
  const hold = Math.max(S.dropFloor, Math.max(0, -_vyRef) * _lastDt * S.dropMargin);
  _dropCut = hold + Math.max(0, snap - hold) * (1 - _dropK);
  return _dropCut;
}

// "A pop this late still counts." The controller asks this before honouring a
// jump edge while AIRBORNE, which no ski could ever do before; nothing else may
// call it. Both gates are load-bearing: `_lipVy > 0` means there was a lip to be
// late for (a pop over flat ground or off a cliff edge is refused, exactly as it
// always was), and `_popPaid` means one air buys one bonus.
export function skiCoyote(S) {
  return !_popPaid && _lipVy > 0 && _airT > 0 && _airT <= (S.popCoyote || 0);
}

// Landing on a pitch should send you on your way, not stop you dead: a slice of
// the impact speed becomes speed down the fall line. Mutates vel.
export function skiLand(vel, impact, normal, S) {
  if (!normal || impact < S.landMin) return;
  const nh = Math.hypot(normal.x, normal.z);
  if (nh < 1e-4) return;
  const add = Math.min(impact, 30) * S.landBoost * Math.min(1, nh);
  vel.x += (normal.x / nh) * add;
  vel.z += (normal.z / nh) * add;
}

// ============================================================== THE SKI RACK
//
// Everything below is inventory: a list of skis, the numbers each one overrides
// above, and how to paint one. It is deliberately data — the physics reads
// `tune` and nothing else, the visuals read `look`/`len`/`waist` and nothing
// else, and the UI reads the derived stats. Adding a ski is one entry.
//
// `lab-standard` overrides NOTHING, so the default play session is numerically
// the session that existed before this file grew a rack.

export const SKI_REF = { len: 180, waist: 88 };   // the geometry of lab-standard

export const SKI_MODELS = [
  {
    id: 'lab-standard', name: pickBrand({ lab: 'Lab Standard', 'RED DOG': 'Red Dog 180', SIBERIA: 'Siberia 180' }), brand: BRAND,
    disc: 'lab', group: 'lab', len: 180, waist: 88, radius: 18,
    blurb: 'The house ski. Every number in ski.js exactly as written — the ruler the rest of the rack is measured against.',
    look: { base: '#ff4d00', ink: '#17161a', accent: '#f4f1ea', pattern: 'lab' },
    tune: {},
  },

  // ------------------------------------------------------------------ race
  {
    id: 'redster-s9', name: 'Atomic Redster S9', brand: 'ATOMIC',
    disc: 'slalom', group: 'race', len: 157, waist: 68, radius: 11,
    blurb: 'Nervous, vicious, brilliant. Fastest edge-to-edge in the rack and the smallest turn radius; straightline it past 20 m/s and the tails shimmy themselves loose.',
    look: { base: '#e2001a', ink: '#17161a', accent: '#ff2a90', pattern: 'redster-s9' },
    tune: {
      maxSpeed: 24, dragQuad: 0.0135, slopeAccel: 0.90,
      grip: 9.5, gripAtMax: 0.55, carveRecover: 0.72,
      steer: 3.6, steerAtMax: 0.55, rollPerLateral: 0.062,
      chatterSpeed: 20, chatterSpan: 5, chatterGrip: 0.65, chatterYaw: 0.95, chatterDrag: 2.2,
      spinTorque: 6.0, popMul: 0.95, landBoost: 0.32, landMin: 2.6, wipeTol: 0.02,
      pumpCharge: 8.0,     // the best pump in the rack: 11 m sidecut, huge grip
    },
  },
  {
    id: 'firebird-sl', name: 'Blizzard Firebird SL', brand: 'BLIZZARD',
    disc: 'slalom', group: 'race', len: 162, waist: 69, radius: 12,
    blurb: 'The slalom ski that lets you breathe. A touch longer and a touch damper than the Redster — nearly the same bite, two more metres per second before it complains.',
    look: { base: '#ff5a00', ink: '#141416', accent: '#ff5a00', pattern: 'firebird' },
    tune: {
      maxSpeed: 25, dragQuad: 0.0125, slopeAccel: 0.91,
      grip: 9.0, gripAtMax: 0.52, carveRecover: 0.70,
      steer: 3.25, steerAtMax: 0.52, rollPerLateral: 0.060,
      chatterSpeed: 22, chatterSpan: 6, chatterGrip: 0.55, chatterYaw: 0.7, chatterDrag: 1.8,
      spinTorque: 6.0, popMul: 1.0, landBoost: 0.34, landMin: 2.8, wipeTol: 0.04,
    },
  },
  {
    id: 'redster-g9', name: 'Atomic Redster G9', brand: 'ATOMIC',
    disc: 'giant slalom', group: 'race', len: 183, waist: 70, radius: 27,
    blurb: 'Mid radius, huge grip, and a top end the slalom skis can only watch. The one that makes a long open pitch feel like it was built for you.',
    look: { base: '#e2001a', ink: '#17161a', accent: '#f5197e', pattern: 'redster-g9' },
    tune: {
      maxSpeed: 28.5, dragQuad: 0.0092, slopeAccel: 0.96,
      grip: 8.2, gripAtMax: 0.48, carveRecover: 0.66,
      steer: 2.1, steerAtMax: 0.36,
      chatterSpeed: 27, chatterSpan: 6, chatterGrip: 0.30, chatterYaw: 0.30, chatterDrag: 1.0,
      spinTorque: 5.6, popMul: 1.0, landBoost: 0.42, wipeTol: 0.07,
      pumpCharge: 7.2,
    },
  },
  {
    id: 'racetiger-gs', name: 'Völkl Racetiger GS', brand: 'VÖLKL',
    disc: 'giant slalom', group: 'race', len: 188, waist: 68, radius: 30,
    blurb: 'Yellow and white and utterly composed. Trades a sliver of the G9\'s bite for a longer, calmer arc and a couple more m/s at the bottom of the run.',
    look: { base: '#f5e600', ink: '#131316', accent: '#e8271c', pattern: 'racetiger-gs' },
    tune: {
      maxSpeed: 29, dragQuad: 0.0089, slopeAccel: 0.97,
      grip: 7.8, gripAtMax: 0.46, carveRecover: 0.63,
      steer: 1.95, steerAtMax: 0.34,
      chatterSpeed: 28.5, chatterSpan: 6, chatterGrip: 0.25, chatterYaw: 0.25, chatterDrag: 0.8,
      spinTorque: 5.4, popMul: 1.0, landBoost: 0.44, wipeTol: 0.08, snapMul: 2.2,
    },
  },
  {
    id: 'racetiger-sg', name: 'Völkl Racetiger Super-G', brand: 'VÖLKL',
    disc: 'super-g', group: 'race', len: 205, waist: 66, radius: 40,
    blurb: 'Long radius, no chatter anywhere in the envelope, and a commitment problem: it takes about a second to change your mind about where you are going.',
    look: { base: '#f5342a', ink: '#141416', accent: '#f4f1ea', pattern: 'racetiger-sg' },
    tune: {
      maxSpeed: 31, dragQuad: 0.0072, slopeAccel: 1.00, glideFriction: 0.40,
      grip: 6.8, gripAtMax: 0.42, carveRecover: 0.58,
      steer: 1.35, steerAtMax: 0.26, airSteer: 0.85,
      spinTorque: 4.6, popMul: 0.95, landBoost: 0.48, landMin: 3.2, wipeTol: 0.11, snapMul: 2.4,
      pumpCharge: 5.2,
    },
  },
  {
    id: 'redster-dh', name: 'Atomic Redster Downhill', brand: 'ATOMIC',
    disc: 'downhill', group: 'race', len: 218, waist: 65, radius: 50,
    blurb: '218 cm of glorious terror. Fastest thing on the mountain, absolutely unshakeable, and it turns like a freight train — pick your line at the top and live with it.',
    look: { base: '#c11a24', ink: '#1a181c', accent: '#c9cacc', pattern: 'redster-dh' },
    tune: {
      maxSpeed: 34, dragQuad: 0.0056, slopeAccel: 1.05, glideFriction: 0.34, airDrag: 0.0016,
      grip: 5.6, gripAtMax: 0.40, carveRecover: 0.50,
      steer: 1.00, steerAtMax: 0.20, airSteer: 0.70,
      spinTorque: 3.8, popMul: 0.90, landBoost: 0.52, landMin: 3.6, wipeTol: 0.15, snapMul: 2.6,
      pumpCharge: 4.0,     // 50 m sidecut — it barely loads, and that is correct
    },
  },

  // ------------------------------------------------------------- freeride
  {
    id: 'enforcer', name: 'Blizzard Enforcer 100', brand: 'BLIZZARD',
    disc: 'all-mountain', group: 'freeride', len: 177, waist: 100, radius: 18,
    blurb: 'Good everywhere, master of nothing. Carves well enough, floats well enough, jumps well enough — the ski you grab when you do not know what the day is.',
    look: { base: '#34302f', ink: '#1c1a19', accent: '#a8331f', pattern: 'enforcer' },
    tune: {
      maxSpeed: 28, dragQuad: 0.0095, slopeAccel: 0.94,
      grip: 6.8, gripAtMax: 0.36, carveRecover: 0.58,
      steer: 2.4, steerAtMax: 0.38,
      chatterSpeed: 26, chatterSpan: 7, chatterGrip: 0.25, chatterYaw: 0.30, chatterDrag: 0.9,
      spinTorque: 7.0, popMul: 1.15, landBoost: 0.42, landMin: 3.6, wipeTol: 0.13,
    },
  },
  {
    id: 'revolt', name: 'Völkl Revolt 104', brand: 'VÖLKL',
    disc: 'freeride park', group: 'freeride', len: 179, waist: 104, radius: 20,
    blurb: 'Best pop of the freeride skis and a spin rate the race skis cannot touch. Lands sideways without complaining, which is exactly why you brought it.',
    look: { base: '#bcdde4', ink: '#15161a', accent: '#2f8e8e', pattern: 'revolt' },
    tune: {
      maxSpeed: 27, dragQuad: 0.0105, slopeAccel: 0.92,
      grip: 5.6, gripAtMax: 0.34, carveRecover: 0.50,
      steer: 2.7, steerAtMax: 0.42, airSteer: 1.5,
      chatterSpeed: 25, chatterSpan: 7, chatterGrip: 0.30, chatterYaw: 0.35, chatterDrag: 1.1,
      spinTorque: 9.4, popMul: 1.35, landBoost: 0.46, landMin: 4.5, wipeTol: 0.34,
    },
  },

  // ------------------------------------------------------------------- fun
  {
    id: 'arv-84', name: 'Armada ARV 84', brand: 'ARMADA',
    disc: 'park twin', group: 'fun', len: 171, waist: 84, radius: 17,
    blurb: 'Pure park. Highest pop and the fastest spin in the building — a 1080 fits inside one ordinary jump — and it will forgive a landing 25° off axis. Do not point it down anything long.',
    look: { base: '#a02a6e', ink: '#26102e', accent: '#f0949f', pattern: 'arv-84' },
    tune: {
      maxSpeed: 24, dragQuad: 0.0145, slopeAccel: 0.90,
      grip: 4.6, gripAtMax: 0.30, carveRecover: 0.42,
      steer: 3.0, steerAtMax: 0.46, airSteer: 1.7,
      chatterSpeed: 21, chatterSpan: 6, chatterGrip: 0.50, chatterYaw: 0.80, chatterDrag: 1.6,
      spinTorque: 11.0, popMul: 1.50, landBoost: 0.40, landMin: 5.0, wipeTol: 0.45,
      pumpCharge: 4.8,
    },
  },
  {
    id: 'lotus-124', name: 'DPS Lotus 124', brand: 'DPS',
    disc: 'powder', group: 'fun', len: 192, waist: 124, radius: 22,
    blurb: 'Surf, not carve. Barely notices snow drag, has no edge worth speaking of, and turns a bad landing into a soft one. Off-piste it is the only ski here that is enjoying itself.',
    look: { base: '#d8342b', ink: '#1d3f9c', accent: '#f4f1ea', pattern: 'lotus' },
    tune: {
      maxSpeed: 27, dragQuad: 0.0080, slopeAccel: 0.95, glideFriction: 0.26,
      grip: 4.2, gripAtMax: 0.42, carveRecover: 0.40,
      steer: 2.2, steerAtMax: 0.40,
      spinTorque: 6.6, popMul: 1.05, landBoost: 0.50, landMin: 6.0, wipeTol: 0.40, snapMul: 2.2,
      pumpCharge: 3.2,     // no edge to push against
    },
  },
  {
    id: 'rebels-x', name: 'Head Rebels X-Cross', brand: 'HEAD',
    disc: 'ski cross', group: 'fun', len: 190, waist: 78, radius: 25,
    blurb: 'A GS ski that has been to jump school. Race speed and race grip, but it pops off rollers and lands like a freeride ski — the best all-round tool in the rack.',
    look: { base: '#f7f7f5', ink: '#17161a', accent: '#ffd400', pattern: 'rebels' },
    tune: {
      maxSpeed: 30, dragQuad: 0.0080, slopeAccel: 0.98,
      grip: 7.2, gripAtMax: 0.44, carveRecover: 0.62,
      steer: 2.5, steerAtMax: 0.40,
      chatterSpeed: 29, chatterSpan: 7, chatterGrip: 0.22, chatterYaw: 0.25, chatterDrag: 0.8,
      spinTorque: 7.4, popMul: 1.25, landBoost: 0.50, landMin: 4.2, wipeTol: 0.20, snapMul: 2.3,
    },
  },
  {
    id: 'white-star-210', name: 'Kneissl White Star 210', brand: 'KNEISSL',
    disc: 'vintage straight', group: 'fun', len: 210, waist: 62, radius: 90,
    blurb: '1972 wants its skis back. Straight, wooden, terrifyingly fast, and it starts hunting at 16 m/s and never stops. Turning is a suggestion. A comedy instrument.',
    look: { base: '#f0ece1', ink: '#2a1e12', accent: '#c9302c', pattern: 'white-star' },
    tune: {
      maxSpeed: 32, dragQuad: 0.0060, slopeAccel: 1.02, glideFriction: 0.30, brake: 9,
      grip: 3.2, gripAtMax: 0.22, carveRecover: 0.28,
      steer: 0.85, steerAtMax: 0.18, airSteer: 0.60,
      chatterSpeed: 16, chatterSpan: 9, chatterGrip: 0.70, chatterYaw: 1.7, chatterDrag: 1.1,
      spinTorque: 4.2, popMul: 0.90, landBoost: 0.30, landMin: 2.5, wipeTol: 0.00, snapMul: 1.8,
      pumpCharge: 1.6,     // grip 3.2: it cannot hold anything, comedy included
    },
  },
];

export const SKI_BY_ID = Object.fromEntries(SKI_MODELS.map((m) => [m.id, m]));
export const SKI_DEFAULT = 'lab-standard';

export function getSkiModel(id) { return SKI_BY_ID[id] || SKI_BY_ID[SKI_DEFAULT]; }

// ---- ONE FLAME COLOUR PER SKI (specs/0006 §2.1).
//
// The rack already carries two colours per model — `look.base` (the topsheet)
// and `look.accent` (the graphic) — and NEITHER of them alone is "the colour of
// the ski that is equipped". Three accents in the rack are the off-white a real
// topsheet prints its wordmark in (#f4f1ea), and two of the BASES are near-white
// too (the Rebels X-Cross is white with a yellow mark; the White Star is cream
// with a red one). Picking either field blind gives a rack where a third of the
// skis burn the same colourless flame.
//
// So the flame takes whichever of the two actually CARRIES CHROMA — saturation
// times value, base winning a tie — and that one rule lands on Redster red,
// Racetiger yellow, Enforcer rust, Revolt teal, ARV magenta and Rebels yellow
// without a single hand-authored entry. Cached per model id; the derivation is
// deterministic, so this is a lookup after the first call.
const _accents = new Map();
function chroma(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return (mx <= 0 ? 0 : (mx - mn) / mx) * mx;
}
export function skiAccent(id) {
  const m = getSkiModel(id);
  if (!_accents.has(m.id)) {
    const L = m.look || {};
    const base = L.base || '#fff0e0';
    const acc = L.accent || base;
    const hex = chroma(acc) > chroma(base) ? acc : base;
    const n = parseInt(String(hex).replace('#', ''), 16);
    _accents.set(m.id, Number.isFinite(n) ? n : 0xfff0e0);
  }
  return _accents.get(m.id);
}

// The tuning a given ski actually plays with, already scaled to the scene unit.
//
// `radius` on the card stops being decoration here: it is spliced in as
// `pumpRadius`, which is what makes the pump differentiate the whole rack for
// free — the 11 m Redster S9 loads up at 15 m/s, the 50 m Redster DH barely
// loads at all, and neither needed a hand-authored pump number to say so. A
// model's own `tune` still wins, so a ski can override it outright.
export function skiTuningFor(id, u = 1) {
  const m = getSkiModel(id);
  return scaleSkiTuning(u, { pumpRadius: m.radius, ...m.tune });
}

// ---- the four bars in the UI, derived from the numbers rather than authored,
// so a card can never advertise something the physics does not do.
export function skiStats(m) {
  const T = { ...SKI_TUNING, ...(m.tune || {}) };
  // terminal speed on a 30° pitch (g = 16, sinθ = .5), capped by maxSpeed
  const drive = 16 * 0.5 * T.slopeAccel - T.glideFriction;
  const term = Math.min(T.maxSpeed, Math.sqrt(Math.max(0, drive) / T.dragQuad));
  const chat = Math.min(34, T.chatterSpeed === Infinity ? 34 : T.chatterSpeed);
  return {
    turn: clamp01(T.steer / 4.0),
    speed: clamp01((term - 16) / 20),
    // where it starts to let go, how violently it lets go, and how twitchy it is
    stab: clamp01((chat / 34) * 0.72 + (1 - clamp01(T.steer / 4.0)) * 0.28)
      * (1 - 0.35 * clamp01(T.chatterYaw / 1.7)),
    pop: clamp01(clamp01((T.popMul - 0.85) / 0.75) * 0.6 + clamp01(T.spinTorque / 12) * 0.4),
    // the raw numbers the detail strip quotes
    term, chatterSpeed: T.chatterSpeed, steer: T.steer, spinTorque: T.spinTorque, popMul: T.popMul,
  };
}
for (const m of SKI_MODELS) m.stats = skiStats(m);

// ---- which ski we are on. ?ski=<id> beats the remembered pick beats the lab
// standard; a URL override is deliberately NOT written back to storage.
const LS_KEY = 'poi-lab.play.ski';
export function resolveSkiId(qs) {
  const q = qs && qs.get ? qs.get('ski') : null;
  if (q && SKI_BY_ID[q]) return q;
  try { const s = localStorage.getItem(LS_KEY); if (s && SKI_BY_ID[s]) return s; } catch { /* private mode */ }
  return SKI_DEFAULT;
}
export function rememberSkiId(id) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
}

// ============================================================ topsheet art
// One painter, two consumers: a 96×768 strip that becomes the CanvasTexture on
// the 3D ski, and a horizontal silhouette for the inventory card. Both are
// cached per model id — a rack of 13 skis is 26 small canvases, once.
//
// The strip is painted TIP-FIRST: y = 0 is the very tip of the ski and y = H is
// the tail, which is the orientation both consumers expect (the thumbnail
// rotates the same canvas a quarter turn and puts the tip on the right). Every
// painter below therefore reads as a real topsheet does — top of the file is
// the shovel, bottom of the file is the tail.
//
// Each ski has its OWN painter, keyed by model id, because the whole point is
// that a Redster does not look like a Racetiger. They are approximations of the
// real design language — the colour break, where the graphic sits along the
// length, how the tip and tail are treated, roughly where the name is printed —
// drawn from reference photos in `_ref-skis/`. No logos are reproduced; the
// marks are simplified geometry in the spirit of the original.
//
// Everything is deterministic canvas 2D. No image is ever loaded at runtime.

const _tops = new Map(), _thumbs = new Map();

const TOP_W = 96, TOP_H = 768;
const SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';

// ---- painting helpers. All of them take the strip context and work in strip
// pixels, so a painter reads as a list of zones down the length of the ski.

// a full-width band between two length fractions
function band(x, c, a, b, W = TOP_W, H = TOP_H) {
  x.fillStyle = c; x.fillRect(0, H * a, W, H * (b - a));
}

// a vertical gradient down the length; stops are [lengthFraction, colour]
function lengthGrad(x, stops, a = 0, b = 1, W = TOP_W, H = TOP_H) {
  const g = x.createLinearGradient(0, H * a, 0, H * b);
  for (const [t, c] of stops) g.addColorStop(t, c);
  x.fillStyle = g; x.fillRect(0, H * a, W, H * (b - a));
}

// letters drawn one at a time so tracking is ours and not the font's — race
// topsheets print their wordmarks wide, and canvas letterSpacing is not
// universally supported.
function tracked(x, s, size, track) {
  let w = 0;
  const widths = [];
  for (const ch of s) { const cw = x.measureText(ch).width; widths.push(cw); w += cw + track; }
  return { w: w - track, widths };
}
function drawTracked(x, s, cx, cy, size, track, align) {
  const { w, widths } = tracked(x, s, size, track);
  let px = align === 'center' ? cx - w / 2 : (align === 'right' ? cx - w : cx);
  let i = 0;
  for (const ch of s) { x.fillText(ch, px, cy); px += widths[i++] + track; }
  return w;
}

// text that reads UP the ski, the way a brand name is printed alongside the
// binding. `at` is the length fraction of the text's centre.
function runText(x, s, cx, at, size, colour, o = {}) {
  x.save();
  x.translate(cx, TOP_H * at); x.rotate(-Math.PI / 2);
  x.fillStyle = colour;
  x.font = `${o.weight || 700} ${size}px ${o.font || SANS}`;
  x.textBaseline = 'middle';
  drawTracked(x, s, 0, 0, size, o.track == null ? size * 0.34 : o.track, 'center');
  x.restore();
}

// text that reads ACROSS the ski, the way a model badge is printed
function crossText(x, s, cx, at, size, colour, o = {}) {
  x.save();
  x.fillStyle = colour;
  x.font = `${o.weight || 700} ${size}px ${o.font || SANS}`;
  x.textBaseline = 'middle';
  const w = drawTracked(x, s, cx, TOP_H * at, size, o.track == null ? size * 0.06 : o.track, o.align || 'center');
  x.restore();
  return w;
}

// the Atomic mark: an arrowhead pointing at the tip, wings swept back, with a
// short spine dropping between them. One shape, three Redsters.
function atomicDart(x, cx, at, h, colour, W = TOP_W) {
  const y = TOP_H * at, w = h * 0.46;
  x.fillStyle = colour;
  x.beginPath();
  x.moveTo(cx, y);
  x.quadraticCurveTo(cx + w * 0.34, y + h * 0.62, cx + w, y + h);
  x.lineTo(cx + w * 0.20, y + h * 0.80);
  x.lineTo(cx, y + h * 1.04);
  x.lineTo(cx - w * 0.20, y + h * 0.80);
  x.lineTo(cx - w, y + h);
  x.quadraticCurveTo(cx - w * 0.34, y + h * 0.62, cx, y);
  x.closePath(); x.fill();
}

// the ladder of pale plate covers down the middle of a Redster's rail
function rungs(x, cx, a, b, w, n, colour) {
  const h = (TOP_H * (b - a)) / n;
  x.fillStyle = colour;
  for (let i = 0; i < n; i++) x.fillRect(cx - w / 2, TOP_H * a + i * h, w, h * 0.72);
}

// rows of little screw holes, the visual signature of an integrated race rail
function screwRows(x, cx, a, b, n, spread, colour) {
  const step = (TOP_H * (b - a)) / (n - 1 || 1);
  x.fillStyle = colour;
  for (let i = 0; i < n; i++) {
    const y = TOP_H * a + i * step;
    x.beginPath(); x.arc(cx - spread, y, 1.6, 0, 7); x.fill();
    x.beginPath(); x.arc(cx + spread, y, 1.6, 0, 7); x.fill();
  }
}

// fine diagonal hatch inside the current clip — the woven plate texture
function hatch(x, x0, y0, w, h, gap, colour, lw = 1) {
  x.save();
  x.beginPath(); x.rect(x0, y0, w, h); x.clip();
  x.strokeStyle = colour; x.lineWidth = lw;
  for (let i = -h; i < w + h; i += gap) {
    x.beginPath(); x.moveTo(x0 + i, y0 + h); x.lineTo(x0 + i + h, y0); x.stroke();
  }
  x.restore();
}

// a halftone dot fade — Völkl's race topsheets change colour through one of
// these rather than across a hard line. Dots grow toward `b`.
function dither(x, a, b, colour, rMax = 3.9, rows = 30, cols = 11) {
  x.fillStyle = colour;
  const y0 = TOP_H * a, span = TOP_H * (b - a), cw = TOP_W / cols;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1), y = y0 + span * t, rad = 0.25 + t * rMax;
    for (let c = 0; c < cols; c++) {
      const px = (c + 0.5) * cw + (r % 2 ? cw * 0.5 : 0);
      x.beginPath(); x.arc(px, y, rad, 0, 7); x.fill();
    }
  }
}

// the claw-rake: a column of chevrons growing as it runs down the ski.
// `point` is +1 for tips aimed at the tail, -1 for tips aimed at the shovel.
function chevStack(x, cx, a, b, n, w0, w1, th, colour, point) {
  x.strokeStyle = colour; x.lineCap = 'butt'; x.lineJoin = 'miter';
  const y0 = TOP_H * a, step = (TOP_H * (b - a)) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1), w = w0 + (w1 - w0) * t, y = y0 + i * step;
    x.lineWidth = th * (0.55 + 0.75 * t);
    x.beginPath();
    x.moveTo(cx - w, y); x.lineTo(cx, y + point * step * 0.62); x.lineTo(cx + w, y);
    x.stroke();
  }
}

// a jagged silhouette from [xFraction, lengthFraction] pairs, closed downhill
function ridge(x, pts, colour, closeAt) {
  x.fillStyle = colour;
  x.beginPath();
  x.moveTo(TOP_W * pts[0][0], TOP_H * pts[0][1]);
  for (const [px, py] of pts.slice(1)) x.lineTo(TOP_W * px, TOP_H * py);
  x.lineTo(TOP_W * pts[pts.length - 1][0], TOP_H * closeAt);
  x.lineTo(TOP_W * pts[0][0], TOP_H * closeAt);
  x.closePath(); x.fill();
}

// deterministic noise — a topsheet must paint the same on every machine
function seeded(s) {
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---- the marks. Simplified geometry in the spirit of each brand, not a trace.

// Völkl: two interlocking angular Vs reading as a doubled X
function volklMark(x, cx, at, w, colour) {
  const y = TOP_H * at, h = w * 0.66;
  x.strokeStyle = colour; x.lineWidth = w * 0.15;
  x.lineJoin = 'miter'; x.lineCap = 'butt';
  for (const s of [-1, 1]) {
    const ox = cx + s * w * 0.26;
    x.beginPath(); x.moveTo(ox - w * 0.26, y); x.lineTo(ox, y + h / 2); x.lineTo(ox + w * 0.26, y); x.stroke();
    x.beginPath(); x.moveTo(ox - w * 0.26, y + h); x.lineTo(ox, y + h / 2); x.lineTo(ox + w * 0.26, y + h); x.stroke();
  }
}

// Blizzard: a bolt knocked out of a disc
function blizzardMark(x, cx, at, w, ink, hole) {
  const y = TOP_H * at, r = w / 2;
  x.fillStyle = ink;
  x.beginPath(); x.arc(cx, y + r, r, 0, 7); x.fill();
  x.fillStyle = hole;
  x.beginPath();
  x.moveTo(cx + r * 0.34, y + r * 0.34); x.lineTo(cx - r * 0.30, y + r * 1.02);
  x.lineTo(cx + r * 0.06, y + r * 1.02); x.lineTo(cx - r * 0.30, y + r * 1.68);
  x.lineTo(cx + r * 0.38, y + r * 0.92); x.lineTo(cx - r * 0.02, y + r * 0.92);
  x.closePath(); x.fill();
}

// DPS: a bare tree standing on two rules
function dpsMark(x, cx, at, w, colour) {
  const y = TOP_H * at, h = w * 0.78;
  x.strokeStyle = colour; x.lineWidth = Math.max(1.6, w * 0.075); x.lineCap = 'butt';
  x.beginPath(); x.moveTo(cx, y); x.lineTo(cx, y + h * 0.72); x.stroke();
  for (let i = 0; i < 3; i++) {
    const yy = y + h * (0.06 + i * 0.20), sp = w * (0.44 - i * 0.10);
    x.beginPath(); x.moveTo(cx - sp, yy - h * 0.14); x.lineTo(cx, yy + h * 0.08); x.lineTo(cx + sp, yy - h * 0.14); x.stroke();
  }
  x.fillStyle = colour;
  x.fillRect(cx - w * 0.5, y + h * 0.76, w, h * 0.10);
  x.fillRect(cx - w * 0.5, y + h * 0.94, w, h * 0.08);
}

// Kneissl: the five-pointed star that gave the ski its name
function star5(x, cx, at, r, colour, tilt = -Math.PI / 2) {
  const y = TOP_H * at;
  x.fillStyle = colour;
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = tilt + i * Math.PI / 5, rr = i % 2 ? r * 0.40 : r;
    const px = cx + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 1.6;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath(); x.fill();
}

// Head: the peaked-roof chevron
function headMark(x, cx, at, w, colour) {
  const y = TOP_H * at;
  x.strokeStyle = colour; x.lineWidth = w * 0.17; x.lineJoin = 'miter'; x.lineCap = 'butt';
  x.beginPath();
  x.moveTo(cx - w / 2, y + w * 0.42); x.lineTo(cx, y); x.lineTo(cx + w / 2, y + w * 0.42);
  x.stroke();
}

// Armada: the bracket square
function armadaMark(x, cx, at, w, colour) {
  const y = TOP_H * at;
  x.strokeStyle = colour; x.lineWidth = Math.max(1.2, w * 0.07);
  x.strokeRect(cx - w / 2, y, w, w);
  x.fillStyle = colour;
  x.fillRect(cx - w * 0.28, y + w * 0.24, w * 0.20, w * 0.52);
  x.fillRect(cx + w * 0.06, y + w * 0.24, w * 0.22, w * 0.30);
}

// ------------------------------------------------------------ the painters
// One entry per ski. Signature is (ctx, W, H, look).

const PAINTERS = {

  // ---------------------------------------------------------------- lab
  // The house ski keeps the deck it always had: TE orange, ink blocks at both
  // ends, and the row of hairlines under the boot.
  'lab-standard'(x, W, H, L) {
    x.fillStyle = L.base; x.fillRect(0, 0, W, H);
    x.fillStyle = L.ink;
    x.fillRect(0, 0, W, H * 0.10);
    x.fillRect(0, H * 0.93, W, H * 0.07);
    x.fillStyle = 'rgba(244,241,234,.55)';
    for (let i = 0; i < 8; i++) x.fillRect(W * 0.22, H * 0.34 + i * 36, W * 0.56, 3);
    // D9/D36 — the topsheet painter does NOT read `brand`/`name`, it paints
    // string literals, which is why the metadata above is not enough on its own:
    // this wordmark is legible across the tip in first person on EVERY frame.
    crossText(x, BRAND, W / 2, 0.055, 11, L.base, { track: 2 });
    runText(x, pick('LAB STANDARD', 'PALISADES 180'), W * 0.5, 0.24, 10, 'rgba(23,22,26,.85)');
  },

  // ------------------------------------------------------------- Redsters
  // Atomic's race room, three ways. All three are the same grammar: a red
  // shovel, the dart mark high on the tip, REDSTER printed small and running
  // up the ski, a black integrated rail through the middle, and the model
  // number big near the tail. What separates them is the second colour and
  // what the rail is doing.

  // S9 — the slalom ski. Red shovel washing into hot magenta, then one long
  // black deck from the waist most of the way to the tail. (redster-s9-1/2.jpg)
  'redster-s9'(x, W, H, L) {
    lengthGrad(x, [[0, '#e2001a'], [0.44, '#e5122f'], [0.82, '#f5197e'], [1, '#ff2a90']], 0, 0.34);
    band(x, '#ff2a90', 0.34, 1.0);
    band(x, '#141118', 0, 0.028);                    // the moulded tip cap
    atomicDart(x, W / 2, 0.085, H * 0.062, '#17161a');
    runText(x, 'REDSTER', W * 0.5, 0.285, 8.5, '#1b1016', { track: 3.4 });

    band(x, '#17161a', 0.34, 0.815);                 // the plate deck
    crossText(x, 'S9', W * 0.5, 0.372, 26, '#ff2a90', { track: 0 });
    x.fillStyle = '#ff2a90'; x.fillRect(W * 0.30, H * 0.398, W * 0.40, 2.5);
    x.fillStyle = '#26242b'; x.fillRect(W * 0.30, H * 0.43, W * 0.40, H * 0.36);
    rungs(x, W / 2, 0.435, 0.505, W * 0.24, 6, '#e9e7e2');
    screwRows(x, W / 2, 0.53, 0.78, 11, W * 0.13, '#0b0a0d');
    screwRows(x, W / 2, 0.545, 0.765, 6, W * 0.04, '#5b5762');

    x.fillStyle = '#e9e7e2'; x.fillRect(W * 0.40, H * 0.833, W * 0.20, H * 0.022);
    crossText(x, 'S9', W * 0.5, 0.885, 22, '#17161a', { track: 0 });
    crossText(x, 'ATOMIC', W * 0.5, 0.955, 8, '#17161a', { track: 1.6 });
    band(x, '#141118', 0.975, 1.0);
  },

  // G9 — the GS ski. Almost no graphic at all: flat red that only turns
  // magenta past halfway, and a narrow black rail with a ladder of white plate
  // covers running down the centreline. (redster-g9-1/2.jpg)
  'redster-g9'(x, W, H, L) {
    lengthGrad(x, [[0, '#e2001a'], [0.60, '#e60f2e'], [1, '#f5197e']], 0, 0.46);
    band(x, '#f5197e', 0.46, 1.0);
    atomicDart(x, W / 2, 0.072, H * 0.058, '#17161a');
    runText(x, 'REDSTER', W * 0.30, 0.305, 8, '#20141a', { track: 3.2 });

    const rw = W * 0.26;
    x.fillStyle = '#17161a';
    x.beginPath();
    x.moveTo(W / 2 - rw / 2, H * 0.20); x.lineTo(W / 2 + rw / 2, H * 0.20);
    x.lineTo(W / 2 + rw / 2, H * 0.775); x.lineTo(W / 2 - rw / 2, H * 0.775);
    x.closePath(); x.fill();
    x.beginPath(); x.ellipse(W / 2, H * 0.20, rw / 2, H * 0.012, 0, 0, 7); x.fill();
    rungs(x, W / 2, 0.208, 0.435, rw * 0.72, 15, '#f2f0eb');

    x.fillStyle = '#232128'; x.fillRect(W / 2 - rw / 2, H * 0.445, rw, H * 0.33);
    hatch(x, W / 2 - rw / 2, H * 0.445, rw, H * 0.045, 5, 'rgba(200,200,205,.30)');
    x.fillStyle = '#f5197e';
    for (const t of [0.505, 0.585, 0.665, 0.735]) {
      x.fillRect(W / 2 - rw * 0.42, H * t, rw * 0.20, H * 0.010);
      x.fillRect(W / 2 + rw * 0.22, H * t, rw * 0.20, H * 0.010);
    }
    screwRows(x, W / 2, 0.47, 0.76, 13, rw * 0.16, 'rgba(245,25,126,.85)');

    x.fillStyle = '#e9e7e2'; x.fillRect(W * 0.42, H * 0.805, W * 0.16, H * 0.018);
    crossText(x, 'G9', W * 0.5, 0.875, 24, '#17161a', { track: 0 });
    crossText(x, 'ATOMIC', W * 0.5, 0.962, 8, '#17161a', { track: 1.6 });
    band(x, '#141118', 0.985, 1.0);
  },

  // Downhill — the speed-room graphic. Red shovel with ATOMIC printed huge and
  // running up it, a stack of pale hatched plate shards behind, the whole thing
  // sinking into oxblood, and a bright silver tail block.
  // (redster-dh-1/2.jpg — the Redster SG, the closest speed ski photographed.)
  'redster-dh'(x, W, H, L) {
    lengthGrad(x, [[0, '#e2001a'], [0.55, '#c4142c'], [1, '#57182c']], 0, 0.34);
    band(x, '#57182c', 0.34, 1.0);
    runText(x, 'ATOMIC', W * 0.5, 0.125, 21, '#1b1016', { track: 5 });

    // the shard ladder — pale hatched plate segments stepping down the shovel
    for (let i = 0; i < 6; i++) {
      const y = H * (0.222 + i * 0.029);
      const bx = i % 2 === 0 ? W * 0.14 : W * 0.42, bw = W * 0.38, bh = H * 0.023;
      x.fillStyle = '#c9cacc'; x.fillRect(bx, y, bw, bh);
      hatch(x, bx, y, bw, bh, 4, 'rgba(255,255,255,.75)');
      x.fillStyle = '#8f9095'; x.fillRect(bx + bw * 0.34, y + bh * 0.22, bw * 0.30, bh * 0.56);
    }
    runText(x, 'REDSTER', W * 0.74, 0.425, 8, '#c9adb4', { track: 3.2 });

    band(x, '#1a181c', 0.465, 0.775);                // the speed plate
    x.fillStyle = '#2a272e'; x.fillRect(W * 0.26, H * 0.475, W * 0.48, H * 0.29);
    screwRows(x, W / 2, 0.49, 0.755, 13, W * 0.16, '#0a090c');
    x.fillStyle = '#7a2434';
    for (const t of [0.50, 0.60, 0.70]) {
      x.fillRect(W * 0.30, H * t, W * 0.08, H * 0.011);
      x.fillRect(W * 0.62, H * t, W * 0.08, H * 0.011);
    }
    x.fillStyle = '#c9cacc'; x.fillRect(W * 0.42, H * 0.795, W * 0.16, H * 0.018);
    crossText(x, '218', W * 0.5, 0.836, 11, '#c98b96', { track: 1 });
    crossText(x, 'DH', W * 0.5, 0.888, 22, '#e6dcd0', { track: 0 });
    band(x, '#dcdcde', 0.925, 1.0);                  // the silver tail block
    crossText(x, 'ATOMIC', W * 0.5, 0.955, 8, '#3a2028', { track: 1.6 });
  },

  // ------------------------------------------------------------- Blizzard
  // Firebird SL — safety orange over the shovel, matte black from the waist
  // down, and the same wordmark twice with the figure and ground swapped:
  // BLIZZARD black-on-orange above the seam, FIREBIRD orange-on-black below.
  // The seam itself ratchets across in a run of diamonds. (firebird-sl-1.jpg)
  'firebird-sl'(x, W, H, L) {
    band(x, '#ff5a00', 0, 0.378);
    band(x, '#141416', 0.378, 1.0);
    band(x, '#141416', 0, 0.038);                    // the moulded tip
    blizzardMark(x, W / 2, 0.052, W * 0.36, '#141416', '#ff5a00');
    runText(x, 'BLIZZARD', W * 0.5, 0.215, 19, '#141416', { track: 2.6 });

    // the diamond ratchet into the black
    x.fillStyle = '#141416';
    for (let r = 0; r < 3; r++) {
      const y = H * (0.316 + r * 0.022), n = 3 + r, s = W * (0.055 + r * 0.012);
      for (let i = 0; i < n; i++) {
        const cx = W / 2 + (i - (n - 1) / 2) * W * 0.20;
        x.beginPath();
        x.moveTo(cx, y - s); x.lineTo(cx + s, y); x.lineTo(cx, y + s); x.lineTo(cx - s, y);
        x.closePath(); x.fill();
      }
    }
    x.fillStyle = '#ff5a00'; x.fillRect(W * 0.30, H * 0.392, W * 0.40, H * 0.020);
    crossText(x, 'SL', W * 0.5, 0.402, 10, '#141416', { track: 1 });
    crossText(x, 'FIS', W * 0.5, 0.428, 8, '#ff5a00', { track: 1 });

    x.fillStyle = '#242428'; x.fillRect(W * 0.26, H * 0.46, W * 0.48, H * 0.32);
    screwRows(x, W / 2, 0.475, 0.775, 12, W * 0.17, '#0a0a0c');
    x.fillStyle = '#e9e7e2'; x.fillRect(W * 0.40, H * 0.795, W * 0.20, H * 0.020);
    crossText(x, '162', W * 0.5, 0.838, 12, '#ff5a00', { track: 1 });
    runText(x, 'FIREBIRD', W * 0.5, 0.905, 19, '#ff5a00', { track: 2.6 });
    crossText(x, 'SL FIS', W * 0.5, 0.972, 8, '#ff5a00', { track: 1.2 });
  },

  // Enforcer 100 — the odd one out of the rack: not a colour block but an
  // illustration. A charcoal wood-grain deck, a rust-red sky behind a grey
  // faceted peak on the shovel, a steel-blue icefall under it strung with thin
  // survey lines, and a pale ridge rising out of the tail. (enforcer-1.jpg)
  'enforcer'(x, W, H, L) {
    band(x, '#34302f', 0, 1);
    const rn = seeded(20250829);
    x.strokeStyle = 'rgba(18,16,16,.42)'; x.lineWidth = 1;      // the wood grain
    for (let i = 0; i < 120; i++) {
      const px = rn() * W, y0 = rn() * H, len = H * (0.04 + rn() * 0.16);
      x.beginPath(); x.moveTo(px, y0); x.lineTo(px + (rn() - 0.5) * 3, y0 + len); x.stroke();
    }
    // the rust sky, cut off underneath by the peak line
    x.save();
    x.beginPath();
    x.moveTo(0, H * 0.055); x.lineTo(W, H * 0.055);
    x.lineTo(W, H * 0.235); x.lineTo(W * 0.62, H * 0.135); x.lineTo(W * 0.44, H * 0.30);
    x.lineTo(W * 0.20, H * 0.20); x.lineTo(0, H * 0.29);
    x.closePath(); x.clip();
    x.fillStyle = '#a8331f'; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(60,26,20,.35)';
    for (let i = 0; i < 40; i++) x.fillRect(rn() * W, H * (0.05 + rn() * 0.25), 2 + rn() * 7, 2 + rn() * 5);
    x.restore();

    ridge(x, [[0, 0.30], [0.18, 0.195], [0.30, 0.245], [0.44, 0.125],
      [0.56, 0.205], [0.70, 0.165], [0.84, 0.255], [1, 0.215]], '#6b6a6b', 0.52);
    ridge(x, [[0, 0.365], [0.22, 0.31], [0.38, 0.35], [0.52, 0.275],
      [0.72, 0.345], [1, 0.30]], '#4a494b', 0.52);
    // the icefall
    x.fillStyle = '#6f97c6';
    for (let i = 0; i < 26; i++) {
      const px = W * (0.10 + rn() * 0.80), y = H * (0.315 + rn() * 0.145);
      x.beginPath();
      x.moveTo(px, y); x.lineTo(px + W * 0.10, y + H * 0.016);
      x.lineTo(px + W * 0.03, y + H * 0.030); x.closePath(); x.fill();
    }
    x.strokeStyle = 'rgba(140,180,225,.60)'; x.lineWidth = 0.9;  // survey lines
    for (const [a, b, c, d] of [[0.30, 0.245, 0.62, 0.34], [0.62, 0.34, 0.44, 0.42],
      [0.44, 0.42, 0.30, 0.245], [0.62, 0.34, 0.86, 0.28], [0.86, 0.28, 0.74, 0.40]]) {
      x.beginPath(); x.moveTo(W * a, H * b); x.lineTo(W * c, H * d); x.stroke();
    }
    runText(x, 'ENFORCER', W * 0.5, 0.245, 13, '#e6e3dd', { track: 1.6 });

    // the badge, then the pale ridge out of the tail
    x.strokeStyle = '#c2492e'; x.lineWidth = 1.6;
    x.beginPath();
    x.moveTo(W * 0.22, H * 0.700); x.lineTo(W * 0.78, H * 0.700);
    x.lineTo(W * 0.78, H * 0.735); x.lineTo(W * 0.50, H * 0.762); x.lineTo(W * 0.22, H * 0.735);
    x.closePath(); x.stroke();
    crossText(x, '177', W * 0.5, 0.714, 9, '#c2492e', { track: 0.8 });
    crossText(x, 'ENFORCER', W * 0.5, 0.736, 7, '#c2492e', { track: 0.8 });
    ridge(x, [[0, 0.955], [0.24, 0.855], [0.42, 0.905], [0.62, 0.795],
      [0.80, 0.875], [1, 0.830]], '#7d7f80', 1.0);
    ridge(x, [[0, 1.0], [0.30, 0.925], [0.56, 0.965], [0.78, 0.900], [1, 0.945]], '#5a5b5d', 1.0);
    runText(x, '100 ALL-MOUNTAIN', W * 0.42, 0.885, 10, '#cfd2d4', { track: 1.2 });
    x.fillStyle = '#8f2a1c';                          // the red pinstripe edges
    x.fillRect(5, 0, 2, H); x.fillRect(W - 7, 0, 2, H);
  },

  // ------------------------------------------------------------- Racetigers
  // GS — Völkl's yellow. VÖLKL printed enormous up the shovel, and the yellow
  // does not stop at a line, it dissolves into the black through a halftone
  // dot fade. The tail comes back to yellow the same way, and carries the turn
  // radius. (racetiger-gs-1/2.jpg)
  'racetiger-gs'(x, W, H, L) {
    band(x, '#f5e600', 0, 0.375);
    band(x, '#131316', 0.375, 0.845);
    dither(x, 0.255, 0.375, '#131316');
    band(x, '#f5e600', 0.905, 1.0);
    dither(x, 0.845, 0.905, '#f5e600');
    volklMark(x, W / 2, 0.028, W * 0.36, '#131316');
    runText(x, 'VÖLKL', W * 0.5, 0.175, 24, '#131316', { track: 1.4 });

    crossText(x, 'RACE', W * 0.5, 0.400, 10, '#e8271c', { track: 0.8 });
    crossText(x, 'TIGER', W * 0.5, 0.421, 10, '#e8271c', { track: 0.8 });
    crossText(x, 'WORLD CUP', W * 0.5, 0.441, 6.5, '#e9e7e2', { track: 0.8 });
    x.fillStyle = '#26262a'; x.fillRect(W * 0.26, H * 0.475, W * 0.48, H * 0.31);
    screwRows(x, W / 2, 0.49, 0.775, 12, W * 0.17, '#08080a');
    x.fillStyle = '#e9e7e2'; x.fillRect(W * 0.40, H * 0.795, W * 0.20, H * 0.020);
    crossText(x, '188', W * 0.5, 0.828, 10, '#e8271c', { track: 0.8 });
    crossText(x, '30', W * 0.5, 0.945, 28, '#131316', { track: 0 });
    crossText(x, 'GS', W * 0.5, 0.984, 10, '#e8271c', { track: 1 });
  },

  // Super-G — same race room, the speed colour. Red shovel and red tail with a
  // black column of claw chevrons raking down each of them, one white chevron
  // marking the end of the run, and the RACE / TIGER / SG stack sitting right
  // on the seam. (racetiger-sg-1.jpg)
  'racetiger-sg'(x, W, H, L) {
    band(x, '#f5342a', 0, 0.475);
    band(x, '#141416', 0.475, 0.855);
    band(x, '#f5342a', 0.855, 1.0);
    volklMark(x, W / 2, 0.035, W * 0.30, '#141416');
    crossText(x, 'Völkl', W * 0.5, 0.088, 12, '#141416', { track: 0.4 });
    chevStack(x, W / 2, 0.205, 0.410, 14, W * 0.10, W * 0.28, 3.4, '#141416', 1);
    chevStack(x, W / 2, 0.425, 0.445, 1, W * 0.30, W * 0.30, 7, '#f4f1ea', 1);
    crossText(x, 'RACE', W * 0.5, 0.468, 10, '#f5342a', { track: 0.8 });
    crossText(x, 'TIGER', W * 0.5, 0.488, 10, '#f5342a', { track: 0.8 });
    crossText(x, 'SG', W * 0.5, 0.516, 15, '#f4f1ea', { track: 0.5 });
    crossText(x, 'MADE IN GERMANY', W * 0.5, 0.541, 5, '#8d8d90', { track: 0.4 });
    x.fillStyle = '#1d1d21'; x.fillRect(W * 0.24, H * 0.575, W * 0.52, H * 0.24);
    screwRows(x, W / 2, 0.59, 0.805, 10, W * 0.18, '#0a0a0c');
    x.fillStyle = '#e9e7e2'; x.fillRect(W * 0.40, H * 0.760, W * 0.20, H * 0.020);
    chevStack(x, W / 2, 0.875, 0.945, 6, W * 0.24, W * 0.10, 4.2, '#141416', 1);
    crossText(x, '45', W * 0.5, 0.968, 20, '#f4f1ea', { track: 0 });
    crossText(x, 'RACING', W * 0.5, 0.990, 6, '#f4f1ea', { track: 1 });
  },

  // ------------------------------------------------------------- freeride
  // Revolt 104 — the loud one. Pale ice-blue ground, a black sunburst fanning
  // off the shovel into a field of vertical hatch lines, and a teal serpent
  // banded in magenta coiling the whole length of the ski. Woodcut, not
  // airbrush. (revolt-104-1.jpg)
  'revolt'(x, W, H, L) {
    band(x, '#bcdde4', 0, 1);
    const ox = W / 2, oy = -H * 0.055;
    x.strokeStyle = '#15161a';
    for (let i = 0; i < 46; i++) {                    // the sunburst
      const a = -1.36 + i * (2.72 / 45);
      x.lineWidth = 0.9 + (i % 3) * 0.55;
      const r0 = H * 0.035, r1 = H * (0.27 + (i % 5) * 0.022);
      x.beginPath();
      x.moveTo(ox + Math.sin(a) * r0, oy + Math.cos(a) * r0);
      x.lineTo(ox + Math.sin(a) * r1, oy + Math.cos(a) * r1);
      x.stroke();
    }
    for (let i = 0; i < 19; i++) {                    // the hatch field
      const px = 6 + i * ((W - 12) / 18);
      x.lineWidth = 0.6 + (i % 3) * 0.35;
      x.beginPath();
      x.moveTo(px, H * (0.245 + (i % 7) * 0.013));
      x.lineTo(px, H * (0.945 - (i % 5) * 0.020));
      x.stroke();
    }
    // the serpent, laid down as four passes over one path
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const t = i / 72;
      pts.push([W / 2 + Math.sin(0.5 + t * Math.PI * 2.7) * W * 0.28, H * (0.115 + t * 0.83)]);
    }
    const pass = (lw, col, dash) => {
      x.strokeStyle = col; x.lineWidth = lw; x.lineCap = 'round'; x.lineJoin = 'round';
      x.setLineDash(dash || []);
      x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) x.lineTo(px, py);
      x.stroke(); x.setLineDash([]);
    };
    pass(W * 0.27, '#15161a');
    pass(W * 0.185, '#2f8e8e');
    pass(W * 0.185, '#e0459c', [7, 46]);
    pass(W * 0.185, 'rgba(18,60,62,.34)', [2, 8]);
    // the hood and head, sat over the top of the coil
    x.fillStyle = '#15161a';
    x.beginPath(); x.ellipse(pts[0][0], H * 0.115, W * 0.21, H * 0.055, 0, 0, 7); x.fill();
    x.fillStyle = '#2f8e8e';
    x.beginPath(); x.ellipse(pts[0][0], H * 0.115, W * 0.165, H * 0.043, 0, 0, 7); x.fill();
    x.fillStyle = '#bcdde4';
    x.beginPath(); x.ellipse(pts[0][0], H * 0.118, W * 0.055, H * 0.026, 0, 0, 7); x.fill();
    x.strokeStyle = '#e0459c'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(pts[0][0], H * 0.078); x.lineTo(pts[0][0], H * 0.058); x.stroke();

    x.fillStyle = '#15161a'; x.fillRect(W * 0.14, H * 0.892, W * 0.72, H * 0.098);
    volklMark(x, W * 0.5, 0.903, W * 0.32, '#f4f1ea');
    crossText(x, 'völkl', W * 0.5, 0.952, 11, '#f4f1ea', { track: 0.6 });
    crossText(x, 'REVOLT 104', W * 0.5, 0.976, 6.5, '#f4f1ea', { track: 0.8 });
  },

  // ------------------------------------------------------------------- fun
  // ARV 84 — Armada's park twin is a painting every year, and the one in the
  // rack is the surreal purple sunset: eyes across the shovel, a saucer over a
  // burning horizon, a ridge line, and the artist's name scrawled by the tail.
  // (arv-84-2.jpg)
  'arv-84'(x, W, H, L) {
    lengthGrad(x, [[0, '#320d38'], [0.13, '#5c1550'], [0.25, '#8e2469'],
      [0.33, '#c8407d'], [0.40, '#f0949f'], [0.50, '#c3387a'],
      [0.66, '#7d1f5c'], [0.82, '#4a1348'], [1, '#26102e']], 0, 1);
    const rn = seeded(84084);
    for (let i = 0; i < 46; i++) {                    // painterly cloud
      const px = rn() * W, y = H * (0.16 + rn() * 0.70);
      x.fillStyle = `rgba(${180 + rn() * 60 | 0},${40 + rn() * 60 | 0},${120 + rn() * 70 | 0},.13)`;
      x.beginPath(); x.ellipse(px, y, W * (0.14 + rn() * 0.36), H * (0.008 + rn() * 0.024), 0, 0, 7);
      x.fill();
    }
    armadaMark(x, W / 2, 0.088, W * 0.20, 'rgba(244,241,234,.85)');

    // the eyes, twice — once under the shovel and once above the tail
    const eyes = (at, s) => {
      for (const side of [-1, 1]) {
        const cx = W / 2 + side * W * 0.19;
        x.fillStyle = '#f0e7de';
        x.beginPath(); x.ellipse(cx, H * at, W * 0.13 * s, H * 0.010 * s, 0, 0, 7); x.fill();
        x.fillStyle = '#2f6b5e';
        x.beginPath(); x.arc(cx, H * at, W * 0.052 * s, 0, 7); x.fill();
        x.fillStyle = '#17161a';
        x.beginPath(); x.arc(cx, H * at, W * 0.024 * s, 0, 7); x.fill();
        x.strokeStyle = '#241026'; x.lineWidth = 2 * s;
        x.beginPath(); x.moveTo(cx - W * 0.14 * s, H * (at - 0.016 * s));
        x.lineTo(cx + W * 0.13 * s, H * (at - 0.021 * s)); x.stroke();
      }
    };
    eyes(0.168, 1);
    crossText(x, 'ARV 84', W * 0.5, 0.196, 11, '#f4f1ea', { track: 1.2 });

    // the glowing horizon and the saucer over it
    const gl = x.createRadialGradient(W / 2, H * 0.325, 0, W / 2, H * 0.325, W * 0.62);
    gl.addColorStop(0, 'rgba(255,240,228,.92)'); gl.addColorStop(0.35, 'rgba(255,208,196,.45)');
    gl.addColorStop(1, 'rgba(255,180,180,0)');
    x.save(); x.fillStyle = gl;
    x.translate(W / 2, H * 0.325); x.scale(1, 0.055); x.translate(-W / 2, -H * 0.325);
    x.fillRect(-W, H * 0.325 - W, W * 3, W * 2); x.restore();
    x.fillStyle = '#2a1030';
    x.beginPath(); x.ellipse(W * 0.46, H * 0.352, W * 0.26, H * 0.011, 0, 0, 7); x.fill();
    x.fillStyle = '#3d1a42';
    x.beginPath(); x.ellipse(W * 0.46, H * 0.344, W * 0.11, H * 0.010, 0, 0, 7); x.fill();
    x.fillStyle = '#1d0c22'; x.fillRect(W * 0.52, H * 0.372, 1.5, H * 0.022);
    x.fillRect(W * 0.49, H * 0.372, W * 0.07, 1.5);

    x.fillStyle = 'rgba(244,241,234,.75)'; x.fillRect(W * 0.42, H * 0.455, W * 0.16, H * 0.016);
    ridge(x, [[0, 0.685], [0.22, 0.635], [0.40, 0.672], [0.58, 0.612],
      [0.78, 0.668], [1, 0.640]], '#2c1030', 0.745);
    crossText(x, 'ARV 84', W * 0.5, 0.760, 11, '#f4f1ea', { track: 1.2 });
    eyes(0.792, 0.8);
    crossText(x, '"MADSTEEZ"', W * 0.5, 0.822, 8.5, '#e8dcea', { track: 0.6 });
    crossText(x, '171 CM', W * 0.5, 0.848, 7, '#e8dcea', { track: 0.6 });
    crossText(x, '117-84-109', W * 0.5, 0.868, 5.5, '#c8a8cc', { track: 0.4 });
    x.fillStyle = 'rgba(255,150,160,.55)';
    x.beginPath(); x.ellipse(W / 2, H * 0.905, W * 0.42, H * 0.012, 0, 0, 7); x.fill();
    x.fillStyle = '#170a1e'; x.fillRect(W * 0.47, H * 0.930, 1.5, H * 0.040);
    x.fillRect(W * 0.42, H * 0.932, W * 0.12, 1.5);
  },

  // Lotus 124 — DPS never illustrates. One colour block sinking from cobalt
  // into red, the tree mark high on the shovel in white, and a small pinwheel
  // crest above the tail. Nothing else. (lotus-124-1.jpg)
  'lotus-124'(x, W, H, L) {
    lengthGrad(x, [[0, '#1d3f9c'], [0.36, '#2f45a4'], [0.62, '#8d3a70'], [1, '#d8342b']], 0, 0.42);
    band(x, '#d8342b', 0.42, 1.0);
    dpsMark(x, W / 2, 0.100, W * 0.42, '#f4f1ea');
    x.fillStyle = '#d8342b'; x.fillRect(W * 0.30, H * 0.152, W * 0.20, 2.5);

    x.fillStyle = '#f4f1ea'; x.fillRect(W * 0.34, H * 0.598, W * 0.32, H * 0.024);
    crossText(x, 'dps', W * 0.5, 0.610, 12, '#1d3f9c', { track: 0.4 });
    crossText(x, 'LOTUS F124', W * 0.5, 0.638, 6.5, '#f4f1ea', { track: 0.8 });
    crossText(x, '192', W * 0.5, 0.656, 5.5, '#f0b4ae', { track: 0.6 });
    x.fillStyle = 'rgba(244,241,234,.55)'; x.fillRect(W * 0.36, H * 0.676, W * 0.28, 1.2);

    // the pinwheel crest
    const cy = H * 0.905, r = W * 0.19;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      x.fillStyle = i % 2 ? '#f4f1ea' : '#1d3f9c';
      x.beginPath();
      x.ellipse(W / 2 + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.42, r * 0.26, a, 0, 7);
      x.fill();
    }
    x.fillStyle = '#f4f1ea'; x.beginPath(); x.arc(W / 2, cy, r * 0.36, 0, 7); x.fill();
    x.fillStyle = '#1d3f9c'; x.beginPath(); x.arc(W / 2, cy, r * 0.20, 0, 7); x.fill();
    crossText(x, 'FOUNDATION', W * 0.5, 0.952, 7, '#f4f1ea', { track: 1 });
    x.fillStyle = 'rgba(244,241,234,.5)'; x.fillRect(W * 0.28, H * 0.966, W * 0.44, 1.2);
  },

  // Rebels — Head's race room is white, not red: a clean white ski with HEAD
  // set enormous down the shovel in black, a long black technical panel through
  // the boot with one yellow accent line, and a black tail block carrying the
  // WORLD CUP REBELS stack under a crossed-skis mark. (rebels-x-1/2.jpg)
  'rebels-x'(x, W, H, L) {
    band(x, '#f7f7f5', 0, 1);
    headMark(x, W / 2, 0.022, W * 0.34, '#17161a');
    runText(x, 'HEAD', W * 0.5, 0.165, 30, '#17161a', { track: 2.2 });
    headMark(x, W / 2, 0.336, W * 0.16, '#17161a');
    crossText(x, 'X-CROSS', W * 0.5, 0.362, 6, '#17161a', { track: 0.8 });

    x.fillStyle = '#17161a';                          // the hex badge
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const px = W / 2 + Math.cos(a) * W * 0.11, py = H * 0.392 + Math.sin(a) * H * 0.016;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath(); x.fill();

    band(x, '#232227', 0.418, 0.815);                 // the technical panel
    x.fillStyle = '#17161a'; x.fillRect(W * 0.20, H * 0.418, W * 0.60, H * 0.397);
    x.fillStyle = '#ffd400'; x.fillRect(W * 0.485, H * 0.428, 2.5, H * 0.026);
    screwRows(x, W / 2, 0.445, 0.80, 14, W * 0.16, '#4a4850');
    runText(x, 'RP WCR 14', W * 0.5, 0.565, 9, '#8e8c94', { track: 1.4 });
    x.fillStyle = '#ffd400'; x.fillRect(W * 0.36, H * 0.762, W * 0.28, H * 0.026);
    x.fillStyle = '#17161a'; x.fillRect(W * 0.42, H * 0.768, W * 0.16, H * 0.014);

    x.strokeStyle = '#17161a'; x.lineWidth = 4; x.lineCap = 'butt';   // the crossed skis
    x.beginPath();
    x.moveTo(W * 0.28, H * 0.868); x.lineTo(W * 0.72, H * 0.912);
    x.moveTo(W * 0.72, H * 0.868); x.lineTo(W * 0.28, H * 0.912);
    x.stroke();
    band(x, '#17161a', 0.925, 1.0);
    crossText(x, 'WORLD', W * 0.5, 0.941, 9, '#f4f1ea', { track: 0.8 });
    crossText(x, 'CUP', W * 0.5, 0.962, 12, '#f4f1ea', { track: 0.8 });
    crossText(x, 'REBELS', W * 0.5, 0.985, 9, '#f4f1ea', { track: 0.8 });
  },

  // White Star — the oldest graphic in the rack and the quietest. A cream deck
  // that has gone a little yellow, a black pinstripe following the edge, the
  // brushed metal band Kneissl ran down the middle, the red five-pointed star
  // high on the shovel, and kneissl set small in lowercase. Nothing else,
  // because in 1972 nothing else was printed. (white-star-1/2.jpg)
  'white-star-210'(x, W, H, L) {
    band(x, '#f0ece1', 0, 1);
    const rn = seeded(1972);
    x.strokeStyle = 'rgba(150,132,102,.20)'; x.lineWidth = 1;    // the ageing
    for (let i = 0; i < 70; i++) {
      const px = rn() * W, y0 = rn() * H;
      x.beginPath(); x.moveTo(px, y0); x.lineTo(px + (rn() - 0.5) * 2, y0 + H * (0.03 + rn() * 0.10)); x.stroke();
    }
    // the brushed band down the centre — across the ski, not along it
    const g = x.createLinearGradient(W * 0.29, 0, W * 0.71, 0);
    g.addColorStop(0, '#a7a49b'); g.addColorStop(0.32, '#e6e4de');
    g.addColorStop(0.62, '#96938b'); g.addColorStop(1, '#c6c3ba');
    x.fillStyle = g; x.fillRect(W * 0.29, H * 0.155, W * 0.42, H * 0.72);
    x.strokeStyle = 'rgba(96,92,84,.38)'; x.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const y = H * (0.16 + i * 0.030);
      x.beginPath(); x.moveTo(W * 0.29, y); x.lineTo(W * 0.71, y); x.stroke();
    }

    star5(x, W / 2, 0.088, W * 0.26, '#c9302c');
    runText(x, 'KNEISSL', W * 0.5, 0.300, 16, '#c9302c', { track: 2.2 });
    crossText(x, 'WHITE STAR', W * 0.5, 0.400, 8, '#3a2a18', { track: 1.2 });
    crossText(x, '210', W * 0.5, 0.424, 7, '#8a7358', { track: 1 });
    runText(x, 'kneissl', W * 0.5, 0.690, 15, '#2a1e12', { track: 1.2, weight: 800 });
    star5(x, W / 2, 0.815, W * 0.16, '#2a1e12');
    crossText(x, 'AUSTRIA', W * 0.5, 0.905, 7, '#3a2a18', { track: 1.6 });
    band(x, '#241a10', 0.955, 1.0);                   // the black tail cap
    x.fillStyle = '#1d1712';                          // the pinstripe edge
    x.fillRect(6, 0, 2, H); x.fillRect(W - 8, 0, 2, H);
  },

};

// Anything without a painter of its own still gets the old pattern deck, so a
// ski added to the rack without art is never a blank.
function paintFallback(x, W, H, L) {
  x.fillStyle = L.base; x.fillRect(0, 0, W, H);
  const P = L.pattern, s = H / 512;
  if (P === 'race' || P === 'chev') {
    x.fillStyle = L.accent;
    const n = P === 'chev' ? 7 : 5, step = H * 0.62 / n;
    for (let i = 0; i < n; i++) {
      const y = H * 0.16 + i * step;
      x.beginPath();
      x.moveTo(W / 2, y); x.lineTo(W - 9, y + 33 * s); x.lineTo(W - 9, y + 48 * s);
      x.lineTo(W / 2, y + 15 * s); x.lineTo(9, y + 48 * s); x.lineTo(9, y + 33 * s);
      x.closePath(); x.fill();
    }
    x.fillStyle = L.ink;
    x.fillRect(0, 0, W, H * 0.11);
    x.fillRect(0, H * 0.90, W, H * 0.10);
  } else if (P === 'stripe') {
    x.fillStyle = L.ink; x.fillRect(W * 0.40, 0, W * 0.20, H);
    x.fillStyle = L.accent;
    x.fillRect(W * 0.22, 0, W * 0.10, H);
    x.fillRect(W * 0.68, 0, W * 0.10, H);
    x.fillStyle = L.ink; x.fillRect(0, 0, W, H * 0.09);
  } else if (P === 'flame') {
    x.fillStyle = L.ink;
    for (let i = 0; i < 6; i++) {
      const y = H * 0.10 + i * H * 0.135;
      x.beginPath();
      x.moveTo(0, y); x.quadraticCurveTo(W * 0.75, y + 27 * s, W, y + 6 * s);
      x.lineTo(W, y + 33 * s); x.quadraticCurveTo(W * 0.75, y + 54 * s, 0, y + 39 * s);
      x.closePath(); x.fill();
    }
  } else if (P === 'block') {
    x.fillStyle = L.accent; x.fillRect(0, H * 0.05, W, H * 0.16);
    x.fillStyle = L.ink; x.fillRect(0, H * 0.24, W, H * 0.06);
    x.fillStyle = L.accent; x.fillRect(W * 0.34, H * 0.36, W * 0.32, H * 0.44);
  } else if (P === 'park') {
    for (let i = -6; i < 24; i++) {
      x.fillStyle = i % 2 ? L.accent : L.ink;
      x.beginPath();
      x.moveTo(0, i * 57); x.lineTo(W, i * 57 - 69);
      x.lineTo(W, i * 57 - 39); x.lineTo(0, i * 57 + 30);
      x.closePath(); x.fill();
    }
  } else if (P === 'pow') {
    lengthGrad(x, [[0, L.accent], [0.42, L.base], [1, L.base]], 0, 1, W, H);
    x.fillStyle = L.ink;
    x.fillRect(W * 0.46, H * 0.30, W * 0.08, H * 0.58);
  } else if (P === 'retro') {
    const bands = [L.accent, '#e8a33d', '#2f6b78', L.ink];
    for (let i = 0; i < 12; i++) {
      x.fillStyle = bands[i % bands.length];
      x.fillRect(0, H * 0.14 + i * 24, W, 13);
    }
    x.fillStyle = L.ink; x.fillRect(0, 0, W, H * 0.09);
  }
}

function paintTopsheet(m) {
  const W = TOP_W, H = TOP_H, L = m.look;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = L.base; x.fillRect(0, 0, W, H);
  (PAINTERS[m.id] || paintFallback)(x, W, H, L);

  // edges — a thin dark line down each side gives the box something to read as
  x.fillStyle = 'rgba(10,10,12,.72)';
  x.fillRect(0, 0, 4, H); x.fillRect(W - 4, 0, 4, H);
  return c;
}

export function skiTopsheet(m) {
  const model = typeof m === 'string' ? getSkiModel(m) : m;
  if (!_tops.has(model.id)) _tops.set(model.id, paintTopsheet(model));
  return _tops.get(model.id);
}

// horizontal ski silhouette for the inventory card — tip to the right, relative
// length and waist honoured so the rack reads at a glance
function paintThumb(m) {
  const W = 300, H = 58;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const lenK = 0.60 + 0.40 * ((m.len - 155) / 60);          // 155 → .60, 215 → 1.0
  const L0 = 14, L1 = 14 + (W - 28) * Math.min(1, Math.max(0.4, lenK));
  const cy = H / 2;
  const hMax = H * 0.40 * Math.min(1.15, 0.72 + 0.42 * (m.waist / 100));
  const hW = hMax * 0.70;

  const path = () => {
    x.beginPath();
    x.moveTo(L0 + 4, cy - hMax * 0.86);
    x.quadraticCurveTo(L0 + (L1 - L0) * 0.45, cy - hW, L1 - 34, cy - hMax);
    x.quadraticCurveTo(L1 - 6, cy - hMax * 0.94, L1, cy - hMax * 0.30);
    x.quadraticCurveTo(L1 + 3, cy, L1, cy + hMax * 0.30);
    x.quadraticCurveTo(L1 - 6, cy + hMax * 0.94, L1 - 34, cy + hMax);
    x.quadraticCurveTo(L0 + (L1 - L0) * 0.45, cy + hW, L0 + 4, cy + hMax * 0.86);
    x.quadraticCurveTo(L0 - 4, cy, L0 + 4, cy - hMax * 0.86);
    x.closePath();
  };

  x.save();
  path(); x.clip();
  x.translate(L1, 0); x.rotate(Math.PI / 2);
  x.drawImage(skiTopsheet(m), 0, 0, H, L1 - L0 + 6);
  x.restore();

  x.strokeStyle = 'rgba(23,22,20,.85)'; x.lineWidth = 1.4;
  path(); x.stroke();
  // binding block, so it reads as a ski and not a surfboard
  x.fillStyle = 'rgba(23,22,20,.82)';
  x.fillRect(L0 + (L1 - L0) * 0.44, cy - hMax * 0.55, 22, hMax * 1.1);
  return c;
}

export function skiThumbURL(m) {
  const model = typeof m === 'string' ? getSkiModel(m) : m;
  if (!_thumbs.has(model.id)) _thumbs.set(model.id, paintThumb(model).toDataURL('image/png'));
  return _thumbs.get(model.id);
}

// ============================================================== the 3D ski
// One ~1.8 m ski; origin at the binding, tip pointing -Z and curling up. The
// deck and the tip live in a `blade` group so a model's length and waist are one
// scale, not a geometry rebuild — restyling is free every frame if it wants to be.

const _texes = new Map(), _rigs = new WeakMap();
function topsheetTexture(THREE, m) {
  if (!_texes.has(m.id)) {
    const t = new THREE.CanvasTexture(skiTopsheet(m));
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

export function makeSkiRig(THREE, u) {
  const g = new THREE.Group();
  const W = 0.13 * u, TH = 0.035 * u;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6b2000 });
  const hard = new THREE.MeshLambertMaterial({ color: 0x17161a, emissive: 0x0b0a09 });
  const blade = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, TH, 1.58 * u), mat);
  deck.position.z = -0.17 * u;                       // 0.62 m tail, 0.96 m nose
  const tip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, TH * 0.8, 0.26 * u), mat);
  tip.position.set(0, 0.05 * u, -1.05 * u);
  tip.rotation.x = 0.5;
  blade.add(deck, tip);
  const binding = new THREE.Mesh(new THREE.BoxGeometry(0.09 * u, 0.07 * u, 0.32 * u), hard);
  binding.position.y = 0.05 * u;
  g.add(blade, binding);
  // NOT userData: THREE deep-copies userData through JSON on clone(), and an
  // Object3D reference in there turns any clone of the skier into a circular
  // -structure throw. A WeakMap keeps the handle off the object entirely.
  _rigs.set(g, { blade, mat });
  return g;
}

export function styleSkiRig(THREE, rig, m) {
  const r = _rigs.get(rig);
  if (!r) return;
  const model = typeof m === 'string' ? getSkiModel(m) : (m || getSkiModel(SKI_DEFAULT));
  r.blade.scale.set(
    Math.max(0.55, model.waist / SKI_REF.waist),
    1,
    model.len / SKI_REF.len,
  );
  r.mat.map = topsheetTexture(THREE, model);
  r.mat.emissive.setHex(hexDim(model.look.base, 0.52));   // matches the old deck material
  r.mat.needsUpdate = true;
}
