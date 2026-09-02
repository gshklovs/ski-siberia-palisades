// Mountain bike / dirt jump. Arcade pump-track feel — Descenders/PumpedBMX,
// not a sim. Same module shape as ski.js so the controller wiring is a copy of
// the ski branch: BIKE_TUNING / scaleBikeTuning / bikeStep / bikeLand, plus one
// extra hook, bikeLaunch, for lip takeoffs (the controller zeroes vel.y while
// grounded, so rolling off a lip needs the vertical carry handed back).
//
// Five ideas layered on the XZ velocity the controller integrates:
//
//   1. GRAVITY DOWN THE FALL LINE — identical to ski.js: the ground normal's
//      horizontal part is the fall line, sinθ is its length. This is the only
//      thing that ever makes you fast downhill.
//   2. PUMP — the signature mechanic. Hold S (crouch/preload). The slope under
//      you *along your direction of travel* is low-pass filtered; while pumping,
//      the fall-line gravity term is scaled UP on down-faces (you are weighting
//      the backside) and DOWN on up-faces (you unweight the front side), and the
//      rate of change of the filtered slope — positive when the surface is
//      curving concave, i.e. the bottom transition of a roller or berm — feeds a
//      "pop" acceleration. Rhythm on rollers therefore adds net speed each lap;
//      pumping on a constant pitch adds almost nothing beyond the down-face
//      weighting. Energy from nowhere, tuned so a pump track can be lapped
//      without pedaling once the rhythm is right.
//   3. EDGES/TIRES — velocity split along/across the bike. The across component
//      bleeds exponentially (grip). Grip is LOW on flat ground and scales up
//      hard with the lateral tilt of the surface under you — a berm is a wall
//      of grip, a flat corner washes. Slip beyond washAngle at speed on flat
//      ground = front wash: grip collapses and speed scrubs hard.
//   4. DRIVE — W pedals: strong punch off the line, tapering as you approach
//      pedalMax; above pedalMax the legs can't spin faster and W does nothing.
//   5. FRICTION — small rolling constant + quadratic air drag; SHIFT is both
//      brakes (strong, with a slight rear-skid grip cut).
//   6. PRELOAD/POP — SPACE is held, not tapped. Holding compresses (charge
//      builds over preloadTime; while it builds you also accelerate into the
//      compression, then it stales); releasing boots you up, scaled by the
//      charge — full charge ≈ 2× the plain bunny hop. Release it on a lip
//      (the filtered slope reads climbing) or within perfectWindow of leaving
//      the ground and it is a PERFECT POP: extra vertical and raised carry
//      caps for that launch, on top of the natural lip launch. A flat-ground
//      release is just an ordinary hop. The controller stays out of it: the
//      bike gear sets holdJump so the instant-jump path never fires, and
//      bikeStep writes vel.y itself on release — rising through the ground
//      check is what flips `grounded`, exactly like a real takeoff.
//
// Boots physics live in controller.js and never come through here.

import { BRAND, pickBrand } from './flags.js';

export const BIKE_TUNING = {
  maxSpeed: 22,          // m/s — hard backstop (downhill + gravity territory)
  pedalMax: 11,          // m/s — cranks spin out here; W does nothing above it
  pedalAccel: 7.0,       // m/s² — pedal punch at a standstill
  pedalFloor: 0.35,      // fraction of pedalAccel still there just under pedalMax
  slopeAccel: 0.88,      // × gravity·sinθ along the fall line
  rollFriction: 0.30,    // m/s² — constant rolling resistance (coast is cheap)
  dragQuad: 0.0080,      // 1/m — quadratic air drag; terminal ≈ maxSpeed on a steep pitch
  airDrag: 0.0020,       // 1/m — quadratic drag while airborne
  brake: 10.0,           // m/s² — both brakes (SHIFT)
  brakeGripMul: 0.55,    // × grip while braking — the slight skid
  grip: 3.2,             // 1/s — lateral bleed at a standstill on FLAT ground
  gripAtMax: 0.40,       // fraction of grip left at maxSpeed
  bermGripGain: 7.0,     // grip multiplier per unit lateral surface tilt (a 30° berm ≈ ×4.5)
  carveRecover: 0.30,    // share of scrubbed lateral speed handed back forward (flat)
  bermRecoverGain: 0.55, // extra recover share at full berm tilt — the berm slingshot
  steer: 2.3,            // rad/s from A/D at a standstill
  steerAtMax: 0.22,      // fraction of steer left at maxSpeed
  airSteer: 1.5,         // rad/s from A/D while airborne (whips)
  washAngle: 0.35,       // rad — slip angle beyond which the front washes on flat
  washSpeed: 8.0,        // m/s — below this you can square off corners freely
  washScrub: 9.0,        // m/s² — speed scrubbed while washing
  washTiltExempt: 0.25,  // lateral tilt above this counts as a berm — no wash
  hop: 2.5,              // m/s — uncharged hop; also the floor of a charged pop
  popFull: 5.0,          // m/s — pop at full charge (≈ 2× the plain hop)
  preloadTime: 0.5,      // s of holding SPACE to reach full charge
  preloadAccel: 3.5,     // m/s² forward while the charge builds (stales when full)
  perfectSlope: 0.12,    // filtered climb (dh/m) that reads as "on a lip"
  perfectWindow: 0.15,   // s after takeoff a release still counts as on the lip
  perfectVyMul: 1.3,     // × pop vertical on a perfect pop
  perfectCarryTime: 0.35,// s the raised carry caps stay armed after a perfect pop
  pumpDownGain: 0.50,    // extra fall-line gravity while pumping a down-face
  pumpUpRelief: 0.25,    // fall-line decel removed while pumping up a face
  pumpPop: 3.0,          // m/s per unit filtered-slope/s — the bottom-transition pop
  pumpPopMax: 2.5,       // m/s² — cap on the pop acceleration
  pumpMinSpeed: 2.0,     // m/s — below this pumping does nothing (no standstill cheats)
  slopeTau: 0.12,        // s — slope low-pass; turns faceted terrain into smooth transitions
  lipCarry: 1.0,         // share of the surface's vertical rate kept off a lip (full carry)
  lipMaxVy: 9.5,         // m/s — vertical launch cap from lips
  lipDetach: 0.8,        // m/s — how far terrain-following may fall behind ballistic
                         // flight before a crest throws you (smaller = jumpier crests)
  lipCarryPerfect: 1.15, // carry share while a perfect pop is armed
  lipMaxVyPerfect: 13.0, // m/s — launch cap while a perfect pop is armed
  landBoost: 0.35,       // share of impact speed converted down the fall line (aligned)
  landMin: 2.5,          // m/s — impacts softer than this convert (and scrub) nothing
  landBonusCap: 0.10,    // aligned downslope landing bonus caps at +10% of speed
  landMisalign: 1.05,    // rad (~60°) — beyond this the landing is a heavy scrub
  landScrubHard: 0.40,   // fraction of horizontal speed kept in a >60° misaligned landing
  flatLandScrub: 0.012,  // per m/s of impact — flat landings sting a little
  maxRoll: 0.18,         // rad — camera bank at full lean (~10°)
  rollPerLateral: 0.030, // rad per m/s of across-the-bike velocity
  rollRate: 8,           // 1/s — bank smoothing
  snapMul: 2.0,          // × (speed·dt) — downhill ground snap, same as skis
  // ---- the one per-model handle that used to be a literal. 6.4 rad/s is what
  // the airborne ← → branch has always used, so a bike that overrides nothing
  // spins exactly as this file always did. A 20" BMX overrides it a lot.
  spinTorque: 6.4,       // rad/s from ← → while airborne
};

// Lengths/speeds/accelerations scale with the scene's unit; rates (1/s) and
// pure ratios do not; the quadratic drags and flatLandScrub are 1/length.
export function scaleBikeTuning(u, over = {}) {
  const S = { ...BIKE_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'pedalMax', 'pedalAccel', 'rollFriction', 'brake',
    'washSpeed', 'washScrub', 'hop', 'popFull', 'preloadAccel', 'pumpPop',
    'pumpPopMax', 'pumpMinSpeed', 'lipMaxVy', 'lipMaxVyPerfect', 'lipDetach',
    'landMin']) S[k] *= u;
  for (const k of ['dragQuad', 'airDrag', 'rollPerLateral', 'flatLandScrub']) S[k] /= u;
  return S;
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

// Per-rider memory the step keeps between frames: the filtered slope under the
// wheels, the surface's vertical rate (for lip takeoffs) and the last yaw (for
// landing alignment). One player per page, so module state — same trade the
// collision grid makes with its scratch normals.
const st = {
  slope: 0, hasSlope: false, surfVy: 0, yaw: 0,
  charge: 0,       // 0..1 — preload compression (SPACE held)
  held: false,     // SPACE state last frame, for release edge detection
  airT: 0,         // s since takeoff, for the perfect-pop window
  perfectArm: 0,   // s left of raised carry caps after a perfect release
  vyBall: 0,       // m/s — ballistic vertical reference for crest detach
};

// Call on respawn / mode switch if you want a clean slate; everything here also
// self-heals within a couple of frames, so this is optional.
export function bikeReset() {
  st.slope = 0; st.hasSlope = false; st.surfVy = 0;
  st.charge = 0; st.held = false; st.airT = 0; st.perfectArm = 0; st.vyBall = 0;
}

// One step of bike dynamics. Mutates ctx.vel (XZ only — the controller owns Y,
// gravity and ground contact) and returns the new yaw and camera bank.
//
// ctx: { vel, yaw, keys, grounded, normal|null, gravity, dt, S, lean }
// (dt may also be passed as a second argument; ctx.dt wins.)
export function bikeStep(ctx, dtArg) {
  const { vel, keys, S } = ctx;
  const dt = ctx.dt !== undefined ? ctx.dt : dtArg;
  const brake = !!keys.sprint;                      // SHIFT — both brakes
  const pump = !!keys.back && !brake;               // S — crouch/preload
  let yaw = ctx.yaw;

  const sp0 = Math.hypot(vel.x, vel.z);
  const fast = Math.min(1, sp0 / S.maxSpeed);

  // ---- steer. A/D lean the bike; mouse still turns you and the two add.
  let turn = 0;
  if (keys.left) turn += 1;
  if (keys.right) turn -= 1;                        // +yaw is left (forward is -Z)
  let spin = 0;                                     // ← → hard spin, parity with ski.js
  if (keys.spinLeft) spin += 1;
  if (keys.spinRight) spin -= 1;
  if (turn || spin) {
    const rate = ctx.grounded ? S.steer * (1 - (1 - S.steerAtMax) * fast) : S.airSteer;
    yaw += (turn + (ctx.grounded ? spin : 0)) * rate * dt + (ctx.grounded ? 0 : spin * S.spinTorque * dt);
  }

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // along the bike
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // across the bike

  if (ctx.grounded && ctx.normal) {
    const n = ctx.normal;
    const ny = Math.max(0.2, n.y);
    const nh = Math.hypot(n.x, n.z);                // = sinθ for a unit normal

    // slope of the surface along the direction of travel, in dh per metre:
    // negative = descending. (dh/dt = -(n·t)/n.y for horizontal unit t.)
    let tx = fx, tz = fz;
    if (sp0 > 0.5) { tx = vel.x / sp0; tz = vel.z / sp0; }
    const slopeRaw = -(n.x * tx + n.z * tz) / ny;
    const hadSlope = st.hasSlope;
    if (!hadSlope) { st.slope = slopeRaw; st.hasSlope = true; }
    const prev = st.slope;
    st.slope += (slopeRaw - st.slope) * Math.min(1, dt / S.slopeTau);
    const slopeRate = dt > 1e-6 ? (st.slope - prev) / dt : 0;  // + = concave transition

    // ---- 1+2. fall line, weighted by the pump
    if (nh > 1e-4) {
      let mul = S.slopeAccel;
      if (pump && sp0 > S.pumpMinSpeed) {
        if (st.slope < -0.02) mul *= 1 + S.pumpDownGain;       // weight the backside
        else if (st.slope > 0.02) mul *= 1 - S.pumpUpRelief;   // unweight the face
      }
      const a = ctx.gravity * Math.min(1, nh) * mul * dt;
      vel.x += (n.x / nh) * a;
      vel.z += (n.z / nh) * a;
    }

    let vf = vel.x * fx + vel.z * fz;
    let vr = vel.x * rx + vel.z * rz;

    // ---- 2b. the pop: pumping through a bottom transition converts the
    // preload into forward speed. slopeRate > 0 is exactly "the down-face is
    // flattening out under me" — the moment a real pump happens.
    if (pump && sp0 > S.pumpMinSpeed && slopeRate > 0 && vf > 0.5) {
      vf += Math.min(S.pumpPop * slopeRate, S.pumpPopMax) * dt;
    }

    // ---- 3. tires: grip from the surface, wash on flat corners
    const latTilt = Math.abs(n.x * rx + n.z * rz);  // 0 flat … sin(bank) in a berm
    let g = S.grip * (1 - (1 - S.gripAtMax) * fast);
    g *= 1 + S.bermGripGain * latTilt;
    if (brake) g *= S.brakeGripMul;
    const slip = Math.abs(Math.atan2(vr, Math.abs(vf) + 1e-6));
    const wash = latTilt < S.washTiltExempt && sp0 > S.washSpeed && slip > S.washAngle;
    if (wash) g *= 0.35;                            // the front lets go
    const keep = Math.exp(-g * dt);
    const scrub = Math.abs(vr) * (1 - keep);
    vr *= keep;
    if (!brake && !wash && vf > 0.5) {
      vf += scrub * (S.carveRecover + S.bermRecoverGain * Math.min(1, latTilt * 2));
    }

    // ---- 5. friction / brakes / wash scrub
    let sp = Math.hypot(vf, vr);
    if (sp > 1e-5) {
      let dec = (S.rollFriction + S.dragQuad * sp * sp) * dt;
      if (brake) dec += S.brake * dt;
      if (wash) dec += S.washScrub * dt;
      const k = Math.max(0, sp - dec) / sp;
      vf *= k; vr *= k;
    }

    // ---- 4. pedal: punch off the line, taper into the spin-out
    if (keys.forward && !brake && vf < S.pedalMax) {
      const room = Math.max(0, 1 - Math.max(0, vf) / S.pedalMax);
      const a = S.pedalAccel * (S.pedalFloor + (1 - S.pedalFloor) * room);
      vf = Math.min(S.pedalMax, vf + a * dt);
    }

    // ---- 6. preload (SPACE held): compress, and drive into the compression
    // while the charge builds; once full it stales and the drive stops
    if (keys.jumpHeld && st.charge < 1) {
      st.charge = Math.min(1, st.charge + dt / S.preloadTime);
      if (vf < S.pedalMax) vf += S.preloadAccel * dt;   // like a crank stroke: always forward
    }

    vel.x = fx * vf + rx * vr;
    vel.z = fz * vf + rz * vr;

    // surface vertical rate — what a lip is about to owe us
    const spNew = Math.hypot(vel.x, vel.z);
    st.surfVy = spNew * st.slope;                   // + while climbing a face

    // ---- crest detach. The controller's downhill snap glues the wheels to
    // any backside shallower than snapMul (63°!), so a mesh jump would swallow
    // the launch entirely — you would ride the whole shape glued. Track the
    // ballistic vertical speed (what free flight would give, decaying at
    // gravity) against what terrain-following demands; the moment the terrain
    // falls away faster than gravity could take you, physics says you are off
    // the lip — so take the launch NOW, with the carry caps (the perfect
    // pop's raised ones while armed). The rising vel.y then breaks the ground
    // check on its own, exactly like a real takeoff.
    const vyFollow = spNew * slopeRaw;
    if (!hadSlope) st.vyBall = vyFollow;            // fresh contact — no stale reference
    st.vyBall = Math.max(st.vyBall - ctx.gravity * dt, vyFollow);
    if (st.vyBall - vyFollow > S.lipDetach) {
      const perfect = st.perfectArm > 0;
      const carry = perfect ? S.lipCarryPerfect : S.lipCarry;
      const cap = perfect ? S.lipMaxVyPerfect : S.lipMaxVy;
      const vy = Math.min(st.vyBall * carry, cap);
      // fire only when the launch actually beats the terrain — a launch weaker
      // than the climb rate would just be snapped back onto the face. If it
      // cannot escape yet, keep the reference and re-check next frame.
      if (vy > 0.25 && vy > vyFollow + 0.2) {
        vel.y = Math.max(vel.y, 0) + vy;
        st.surfVy = 0; st.perfectArm = 0; st.vyBall = 0;   // launch consumed
      }
    }
  } else {
    st.hasSlope = false;                            // reseed the filter on landing
    st.vyBall = 0;
    if (sp0 > 1e-5) {
      // airborne: momentum is yours, minus a little air
      const k = Math.max(0, sp0 - S.airDrag * sp0 * sp0 * dt) / sp0;
      vel.x *= k; vel.z *= k;
    }
  }

  const sp = Math.hypot(vel.x, vel.z);
  if (sp > S.maxSpeed) {
    const k = S.maxSpeed / sp;
    vel.x *= k; vel.z *= k;
  }

  // ---- 6b. pop (SPACE released): boot off, scaled by the charge. Writing
  // vel.y here is what launches — the controller's ground check sees the rise
  // and flips grounded, then its launch hook adds the natural lip carry ON TOP.
  const held = !!keys.jumpHeld;
  if (!ctx.grounded) st.airT += dt; else st.airT = 0;
  if (st.perfectArm > 0) st.perfectArm = Math.max(0, st.perfectArm - dt);
  let pop = null;
  if (st.held && !held && st.charge > 0) {
    if (ctx.grounded || st.airT < S.perfectWindow) {
      let vy = S.hop + (S.popFull - S.hop) * st.charge;
      if (st.slope > S.perfectSlope) {          // released on a lip — the timing bonus
        vy *= S.perfectVyMul;
        st.perfectArm = S.perfectCarryTime;     // raised carry caps for this launch
        pop = 'perfect';
      }
      vel.y = Math.max(vel.y, 0) + vy;
    }
    st.charge = 0;                              // out-of-window releases just fizzle
  }
  st.held = held;

  // ---- bank into the lean, from the lateral load actually carried
  const load = vel.x * rx + vel.z * rz;
  const want = clamp(-load * S.rollPerLateral, -S.maxRoll, S.maxRoll);
  const lean = ctx.lean + (want - ctx.lean) * Math.min(1, S.rollRate * dt);

  st.yaw = yaw;
  return { yaw, lean, crouch: st.charge, pop };
}

// Rolling off a lip. The controller keeps vel.y = 0 while grounded (it follows
// the terrain by snapping), so the vertical speed a lip should give you has to
// be handed back the frame contact is lost. The controller's ride loop calls
// this whenever grounded flips true→false without a jump. ADDITIVE on top of
// any pop the release already banked (for a plain roll-off vel.y is ~0, so it
// degrades to the old behaviour); a perfect pop arms raised carry caps. Only
// ever adds upward speed — rolling off a downhill crest changes nothing.
export function bikeLaunch(vel, S) {
  if (st.surfVy > 0.2) {
    const perfect = st.perfectArm > 0;
    const carry = perfect ? S.lipCarryPerfect : S.lipCarry;
    const cap = perfect ? S.lipMaxVyPerfect : S.lipMaxVy;
    vel.y = Math.max(vel.y, 0) + Math.min(st.surfVy * carry, cap);
  }
  st.surfVy = 0;
  st.perfectArm = 0;
}

// Landing. Aligned with your direction of travel: keep everything, plus a
// fall-line bonus on downslope landings capped at landBonusCap of your speed.
// More than ~60° sideways: heavy scrub. Dead-flat slaps sting a little on big
// impacts. Mutates vel. (Alignment uses the yaw bikeStep saw last frame.)
export function bikeLand(vel, impact, normal, S) {
  if (impact < S.landMin) return;
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 0.3) return;
  const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
  const mis = Math.acos(clamp((vel.x * fx + vel.z * fz) / sp, -1, 1));
  if (mis > S.landMisalign) {
    vel.x *= S.landScrubHard; vel.z *= S.landScrubHard;
    return;
  }
  const nh = normal ? Math.hypot(normal.x, normal.z) : 0;
  if (nh > 1e-4) {
    const add = Math.min(Math.min(impact, 30) * S.landBoost * Math.min(1, nh),
      sp * S.landBonusCap);
    vel.x += (normal.x / nh) * add;
    vel.z += (normal.z / nh) * add;
  } else {
    const k = Math.max(0.7, 1 - impact * S.flatLandScrub);
    vel.x *= k; vel.z *= k;
  }
}

// ============================================================== THE BIKE RACK
//
// Same deal as the ski rack in ski.js: a list of bikes, the numbers each one
// overrides above, and the geometry to draw it with. Deliberately data — the
// physics reads `tune` and nothing else, the visuals read `geo`/`look` and
// nothing else, and the UI reads stats derived from the numbers rather than
// authored, so a card cannot advertise something the physics does not do.
//
// `lab-standard` overrides NOTHING, so a session that never opens the locker is
// numerically the session that existed before this file grew a rack.
//
// HOW REAL BIKES BECOME NUMBERS. Every override traces to a spec:
//
//   travel (mm)         → landMisalign / landScrubHard / flatLandScrub / landMin
//                         200 mm forgives a 83° sideways landing; a rigid BMX
//                         forgives 46° and stings on flat.
//   head angle          → steer / steerAtMax / airSteer. 62.5° (V10) turns like
//                         a barge; 75° (BMX) turns like a thought.
//   wheelbase           → the same pair, and washAngle: long is calm, short bites.
//   weight + gearing    → pedalAccel / pedalMax. A 9.4 kg XC hardtail with a
//                         12-speed cassette out-accelerates everything; a 16 kg
//                         DH bike on a 7-speed block spins out at walking pace.
//   suspension          → pump. Travel absorbs the rider's input, so a rigid DJ
//                         hardtail is the best pump tool here and the V10 the
//                         worst — and the same 200 mm is why the V10 lands
//                         anything. That trade is the whole rack.
//   tyre width/casing   → grip, bermGripGain, rollFriction, dragQuad.
//   mass + aero         → maxSpeed / slopeAccel / dragQuad — how fast gravity
//                         can make you and how much the air takes back.

// Every geometry number below is the manufacturer's published figure for the
// size-L (or the only) frame, converted to metres; `mass` is the published
// claimed weight of the build named in the blurb. The two exceptions are called
// out where they sit: `lab-standard`, which is fictional because it is the house
// bike, and the Repack klunker, whose angles are Joe Breeze's measurement of his
// own 1941 Schwinn (he built Breezer #1 to them) because no 1930s Schwinn
// balloon cruiser ever shipped with a geometry table.
export const BIKE_MODELS = [
  {
    // D9  14 this WAS dead data: the bike had no gear and no locker tab, so its
    // wordmark was unreachable. The bikes are back in the shipped locker as of
    // 2026-08-31, which makes both strings below reachable and therefore
    // scrubbable  14 the brand on the card, and `mark` painted on the down tube,
    // which is on screen in third person the whole time you ride it.
    id: 'lab-standard', name: pickBrand({ lab: 'Lab Standard Bike', 'RED DOG': 'Red Dog Trail', SIBERIA: 'Siberia Traverse' }), brand: BRAND,
    disc: 'dirt jump', group: 'lab',
    spec: { travel: '100 / 0 mm', head: 69.0, wb: 1080, mass: '11.4 kg', wheel: '26 × 2.3"' },
    blurb: 'The house bike. Every number in bike.js exactly as written — the ruler the rest of the rack is measured against, and the bike both parks were shaped around. Nothing you equip changes how this one feels.',
    look: { front: '#ff4d00', rear: '#17161a', fork: '#17161a', ink: '#17161a', accent: '#f4f1ea', link: '#3a3a42', rim: '#1b1b1f', word: '#f4f1ea', panel: null, deco: 'plain', face: 'mono', mark: BRAND },
    geo: { wheelR: 0.337, tyre: 58, wb: 1.080, cs: 0.395, bb: 0.313, ac: 0.480,
      head: 69.0, ht: 0.11, riser: 0.09, barW: 0.74, seat: 0.62, fork: 'single',
      rear: false, bar: 'riser' },
    tune: {},
  },

  // ------------------------------------------------------------------- jump
  {
    id: 'stitched-360', name: 'Canyon Stitched 360', brand: 'CANYON',
    disc: 'dirt jump', group: 'jump',
    spec: { travel: '100 / 0 mm', head: 69.0, wb: 1066, mass: '11.6 kg', wheel: '26 × 2.3"' },
    blurb: 'The dirt jumper: 100 mm up front, nothing at all out back, and 382 mm chainstays - the shortest rear end in the rack and the reason it whips. Best pump and best pop here, and it will tell you about every rock on the way down. Painted in Sundown Session, which is the only colour Canyon sells it in.',
    look: { front: '#e6e0be', rear: '#e6e0be', fork: '#17161a', ink: '#17161a', accent: '#b9bdc0', link: '#3a3a42', rim: '#17161a', word: '#9a8442', panel: '#e6e0be', deco: 'plain', face: 'canyon', mark: 'CANYON' },
    geo: { wheelR: 0.337, tyre: 58, wb: 1.066, cs: 0.382, bb: 0.316, ac: 0.470,
      head: 69.0, ht: 0.11, riser: 0.10, barW: 0.76, seat: 0.60, fork: 'single',
      rear: false, bar: 'riser' },
    tune: {
      maxSpeed: 21.5, slopeAccel: 0.88, rollFriction: 0.34, dragQuad: 0.0092,
      pedalMax: 11.0, pedalAccel: 7.6, brake: 8.0,
      steer: 2.85, steerAtMax: 0.26, airSteer: 1.95, spinTorque: 9.8,
      grip: 3.0, bermGripGain: 7.2, washAngle: 0.38, washSpeed: 8.5,
      hop: 3.0, popFull: 6.1, preloadTime: 0.42, preloadAccel: 4.0,
      pumpDownGain: 0.58, pumpPop: 3.4, pumpPopMax: 2.8,
      lipDetach: 0.70, lipMaxVy: 10.5, lipMaxVyPerfect: 14.0,
      landMisalign: 1.00, landScrubHard: 0.36, flatLandScrub: 0.016, landMin: 2.3,
    },
  },
  {
    id: 'ticket-dj', name: 'Trek Ticket DJ', brand: 'TREK',
    disc: 'slopestyle', group: 'jump',
    spec: { travel: '100 / 0 mm', head: 70.0, wb: 1049, mass: '2.7 kg frame', wheel: '26 × 2.3"' },
    blurb: 'A degree steeper than the Stitched and 17 mm longer in the back, which is exactly the difference between a whip bike and a jump-line bike: quicker into the turn, calmer once you are sideways. Sold as a frameset, so the weight quoted is the frame.',
    look: { front: '#1f5e4a', rear: '#2e4a7a', fork: '#101418', ink: '#101418', accent: '#f4f1ea', link: '#3a3a42', rim: '#17161a', word: '#f4f1ea', panel: '#17303c', deco: 'fade', face: 'block', mark: 'TREK' },
    geo: { wheelR: 0.337, tyre: 58, wb: 1.049, cs: 0.399, bb: 0.312, ac: 0.470,
      head: 70.0, ht: 0.11, riser: 0.09, barW: 0.75, seat: 0.61, fork: 'single',
      rear: false, bar: 'riser' },
    tune: {
      maxSpeed: 21.0, slopeAccel: 0.875, rollFriction: 0.35, dragQuad: 0.0095,
      pedalMax: 10.5, pedalAccel: 7.4, brake: 8.4,
      steer: 3.00, steerAtMax: 0.27, airSteer: 1.85, spinTorque: 8.8,
      grip: 3.1, bermGripGain: 7.2, washAngle: 0.36, washSpeed: 8.4,
      hop: 2.9, popFull: 5.9, preloadTime: 0.44, preloadAccel: 3.9,
      pumpDownGain: 0.56, pumpPop: 3.3, pumpPopMax: 2.7,
      lipDetach: 0.72, lipMaxVy: 10.2, lipMaxVyPerfect: 13.6,
      landMisalign: 1.06, landScrubHard: 0.39, flatLandScrub: 0.015, landMin: 2.4,
    },
  },

  // ------------------------------------------------------------------- race
  {
    id: 'v10', name: 'Santa Cruz V10.8', brand: 'SANTA CRUZ',
    disc: 'downhill', group: 'race',
    spec: { travel: '200 / 208 mm', head: 63.0, wb: 1302, mass: '16.8 kg', wheel: 'MX 29 / 27.5"' },
    blurb: 'A dual crown, 208 mm out back, and a bike that only makes sense pointing down — Syndicate World Cup runs average 42–44 km/h and trap at 81. Fastest thing in the rack and it forgives landings nothing else survives. It also pedals like a filing cabinet: the suspension that saves you eats every pump you put in.',
    look: { front: '#1b2a63', rear: '#1b2a63', fork: '#141418', ink: '#141418', accent: '#f4f1ea', link: '#c9ccd4', rim: '#141418', word: '#f4f1ea', panel: null, deco: 'plain', face: 'sc', mark: 'SANTA CRUZ' },
    geo: { wheelR: 0.372, tyre: 64, wb: 1.302, cs: 0.443, bb: 0.350, ac: 0.600,
      head: 63.0, ht: 0.115, riser: 0.04, barW: 0.80, seat: 0.72, fork: 'dual',
      rear: true, bar: 'flat' },
    tune: {
      maxSpeed: 29.0, slopeAccel: 0.96, rollFriction: 0.26, dragQuad: 0.0068,
      airDrag: 0.0017,
      pedalMax: 8.5, pedalAccel: 4.2, brake: 13.5,
      steer: 1.55, steerAtMax: 0.15, airSteer: 1.00, spinTorque: 4.4,
      grip: 4.4, gripAtMax: 0.48, bermGripGain: 8.5, washAngle: 0.45, washSpeed: 10.0,
      carveRecover: 0.34, bermRecoverGain: 0.62,
      hop: 1.9, popFull: 4.0, preloadTime: 0.60, preloadAccel: 2.6,
      pumpDownGain: 0.30, pumpPop: 1.8, pumpPopMax: 1.6,
      lipDetach: 1.05, lipMaxVy: 10.5, lipMaxVyPerfect: 13.5, lipCarry: 0.95,
      landMisalign: 1.45, landScrubHard: 0.62, flatLandScrub: 0.005, landMin: 3.4,
      landBoost: 0.42, snapMul: 2.3,
    },
  },
  {
    id: 'epic-ht', name: 'Specialized Epic Hardtail', brand: 'SPECIALIZED',
    disc: 'xc race', group: 'race',
    spec: { travel: '100 / 0 mm', head: 68.5, wb: 1148, mass: '10.4 kg', wheel: '29 × 2.25"' },
    blurb: 'A 915 g carbon frame with one job: go up. Best pedal punch and much the highest cruising gear here — an XC World Cup is ridden at about 20 km/h for two hours — on race tyres that let go early and a rigid rear end that turns any real landing into a decision you regret.',
    look: { front: '#e0457b', rear: '#17161a', fork: '#17161a', ink: '#17161a', accent: '#f4f1ea', link: '#3a3a42', rim: '#17161a', word: '#f4f1ea', panel: '#17161a', deco: 'stripe', face: 'block', mark: 'SPECIALIZED' },
    geo: { wheelR: 0.372, tyre: 57, wb: 1.148, cs: 0.430, bb: 0.315, ac: 0.515,
      head: 68.5, ht: 0.10, riser: 0.02, barW: 0.74, seat: 0.90, fork: 'single',
      rear: false, bar: 'flat' },
    tune: {
      maxSpeed: 23.0, slopeAccel: 0.86, rollFriction: 0.22, dragQuad: 0.0062,
      pedalMax: 15.0, pedalAccel: 11.0, pedalFloor: 0.42, brake: 9.5,
      steer: 2.6, steerAtMax: 0.24, airSteer: 1.50, spinTorque: 6.2,
      grip: 2.4, gripAtMax: 0.34, bermGripGain: 6.0, washAngle: 0.26, washSpeed: 6.5,
      hop: 2.3, popFull: 4.4, preloadTime: 0.48, preloadAccel: 4.2,
      pumpDownGain: 0.50, pumpPop: 2.8, pumpPopMax: 2.4,
      lipDetach: 0.75, lipMaxVy: 9.2,
      landMisalign: 0.85, landScrubHard: 0.28, flatLandScrub: 0.022, landMin: 2.1,
    },
  },

  // ------------------------------------------------------------------ trail
  {
    id: 'nomad', name: 'Santa Cruz Nomad 7', brand: 'SANTA CRUZ',
    disc: 'enduro', group: 'trail',
    spec: { travel: '170 / 170 mm', head: 63.3, wb: 1274, mass: '15.3 kg', wheel: 'MX 29 / 27.5"' },
    blurb: 'A downhill bike that agreed to pedal. 170 mm both ends, 63.3° at the head, and enough tyre to hold a line the trail bikes are already sliding off — second-fastest way down the hill and the only one on this half of the rack you could also ride back up it.',
    look: { front: '#4fd5f7', rear: '#4fd5f7', fork: '#141418', ink: '#0b1a1c', accent: '#e4197e', link: '#c9ccd4', rim: '#141418', word: '#e4197e', panel: null, deco: 'plain', face: 'sc', mark: 'SANTA CRUZ' },
    geo: { wheelR: 0.360, tyre: 62, wb: 1.274, cs: 0.445, bb: 0.343, ac: 0.570,
      head: 63.3, ht: 0.115, riser: 0.03, barW: 0.78, seat: 0.86, fork: 'single',
      rear: true, bar: 'riser' },
    tune: {
      maxSpeed: 26.0, slopeAccel: 0.93, rollFriction: 0.30, dragQuad: 0.0078,
      pedalMax: 11.5, pedalAccel: 7.0, brake: 12.0,
      steer: 1.95, steerAtMax: 0.19, airSteer: 1.25, spinTorque: 5.8,
      grip: 3.9, gripAtMax: 0.44, bermGripGain: 8.0, washAngle: 0.42, washSpeed: 9.4,
      carveRecover: 0.32, bermRecoverGain: 0.58,
      hop: 2.2, popFull: 4.5, preloadTime: 0.55, preloadAccel: 3.0,
      pumpDownGain: 0.42, pumpPop: 2.5, pumpPopMax: 2.1,
      lipDetach: 0.92, lipMaxVy: 9.8, lipMaxVyPerfect: 13.0,
      landMisalign: 1.30, landScrubHard: 0.55, flatLandScrub: 0.007, landMin: 3.0,
      landBoost: 0.38,
    },
  },
  {
    id: 'bronson', name: 'Santa Cruz Bronson 5', brand: 'SANTA CRUZ',
    disc: 'all-mountain', group: 'trail',
    spec: { travel: '160 / 150 mm', head: 64.2, wb: 1267, mass: '14.7 kg', wheel: 'MX 29 / 27.5\"' },
    blurb: 'The cheerful one. Ten millimetres less travel than the Nomad, a degree steeper, and shorter everywhere, and every one of those differences goes the same way: it wants to leave the ground. Poppiest full-suspension bike in the rack, with a small 27.5 rear wheel that tucks under you in the air. This one is in Kalimotxo, which is a drink.',
    look: { front: '#9b2461', rear: '#9b2461', fork: '#141418', ink: '#160a12', accent: '#f4f1ea', link: '#c9a227', rim: '#141418', word: '#f2d64b', panel: null, deco: 'plain', face: 'sc', mark: 'SANTA CRUZ' },
    geo: { wheelR: 0.360, tyre: 61, wb: 1.267, cs: 0.442, bb: 0.344, ac: 0.565,
      head: 64.2, ht: 0.112, riser: 0.03, barW: 0.78, seat: 0.87, fork: 'single',
      rear: true, bar: 'riser' },
    tune: {
      maxSpeed: 25.0, slopeAccel: 0.915, rollFriction: 0.285, dragQuad: 0.0076,
      pedalMax: 12.0, pedalAccel: 7.6, brake: 11.5,
      steer: 2.25, steerAtMax: 0.215, airSteer: 1.45, spinTorque: 7.0,
      grip: 3.6, bermGripGain: 7.8, washAngle: 0.38, washSpeed: 8.9,
      hop: 2.5, popFull: 5.1, preloadTime: 0.50, preloadAccel: 3.5,
      pumpDownGain: 0.48, pumpPop: 2.85, pumpPopMax: 2.4,
      lipDetach: 0.82, lipMaxVy: 9.9, lipMaxVyPerfect: 13.2,
      landMisalign: 1.20, landScrubHard: 0.50, flatLandScrub: 0.009, landMin: 2.8,
    },
  },
  {
    id: 'spectral', name: 'Canyon Spectral CF', brand: 'CANYON',
    disc: 'trail', group: 'trail',
    spec: { travel: '150 / 140 mm', head: 64.0, wb: 1272, mass: '15.1 kg', wheel: 'MX 29 / 27.5\"' },
    blurb: 'Bone-white front triangle, raw black carbon out back: the one bike in the rack whose paint really is two colours, because that is how Canyon builds the carbon Spectral. Rides like the number it is — 150 up front, 140 behind, 64 degrees — which is to say it will do anything you ask and complain about none of it.',
    look: { front: '#ede7dc', rear: '#1b1b1e', fork: '#141418', ink: '#141418', accent: '#c9ccd4', link: '#c9ccd4', rim: '#141418', word: '#8a8375', panel: '#ede7dc', deco: 'plain', face: 'canyon', mark: 'CANYON' },
    geo: { wheelR: 0.366, tyre: 62, wb: 1.272, cs: 0.429, bb: 0.342, ac: 0.560,
      head: 64.0, ht: 0.112, riser: 0.03, barW: 0.78, seat: 0.88, fork: 'single',
      rear: true, bar: 'riser' },
    tune: {
      maxSpeed: 24.8, slopeAccel: 0.905, rollFriction: 0.285, dragQuad: 0.0075,
      pedalMax: 12.4, pedalAccel: 8.2, brake: 11.2,
      steer: 2.15, steerAtMax: 0.205, airSteer: 1.38, spinTorque: 6.5,
      grip: 3.5, bermGripGain: 7.6, washAngle: 0.38, washSpeed: 8.8,
      hop: 2.4, popFull: 4.9, preloadTime: 0.50, preloadAccel: 3.7,
      pumpDownGain: 0.46, pumpPop: 2.75, pumpPopMax: 2.3,
      lipDetach: 0.86, lipMaxVy: 9.7,
      landMisalign: 1.18, landScrubHard: 0.48, flatLandScrub: 0.009, landMin: 2.75,
    },
  },
  {
    id: 'fuel-ex', name: 'Trek Fuel EX Gen 7', brand: 'TREK',
    disc: 'trail', group: 'trail',
    spec: { travel: '150 / 145 mm', head: 64.5, wb: 1262, mass: '14.1 kg', wheel: '29 × 2.4"' },
    blurb: 'The bike you own if you own one bike. Nothing here is the best at anything and nothing here is bad at anything — it pedals, it pumps, it lands, and it will get round any line in either park without having an opinion about it.',
    look: { front: '#2e8b57', rear: '#17161a', fork: '#17161a', ink: '#12140f', accent: '#f4f1ea', link: '#c9ccd4', rim: '#17161a', word: '#f4f1ea', panel: '#17161a', deco: 'fade', face: 'block', mark: 'TREK' },
    geo: { wheelR: 0.372, tyre: 60, wb: 1.262, cs: 0.442, bb: 0.340, ac: 0.550,
      head: 64.5, ht: 0.11, riser: 0.03, barW: 0.78, seat: 0.88, fork: 'single',
      rear: true, bar: 'riser' },
    tune: {
      maxSpeed: 24.5, slopeAccel: 0.90, rollFriction: 0.28, dragQuad: 0.0074,
      pedalMax: 12.5, pedalAccel: 8.0, brake: 11.0,
      steer: 2.2, steerAtMax: 0.21, airSteer: 1.40, spinTorque: 6.6,
      grip: 3.4, bermGripGain: 7.4, washAngle: 0.36, washSpeed: 8.6,
      hop: 2.4, popFull: 4.8, preloadTime: 0.50, preloadAccel: 3.6,
      pumpDownGain: 0.46, pumpPop: 2.7, pumpPopMax: 2.3,
      lipDetach: 0.85, lipMaxVy: 9.6,
      landMisalign: 1.15, landScrubHard: 0.46, flatLandScrub: 0.010, landMin: 2.7,
    },
  },

  // -------------------------------------------------------------------- fun
  {
    id: 'bmx-park', name: 'Sunday Soundwave', brand: 'SUNDAY',
    disc: 'bmx', group: 'fun',
    spec: { travel: 'rigid', head: 75.0, wb: 1000, mass: '10.6 kg', wheel: '20 × 2.4"' },
    blurb: 'Twenty-inch wheels, one gear, and a seat you will never sit on. A 75° head angle and 335 mm stays spin it more than twice as fast as anything else in the rack — a 720 fits in the jump the dirt bike gets a 360 out of — and then it rolls out like a shopping trolley. Pump track, not mountain.',
    look: { front: '#f2c300', rear: '#f2c300', fork: '#17161a', ink: '#17161a', accent: '#7a2ecb', link: '#3a3a42', rim: '#f4f1ea', word: '#17161a', panel: '#f2c300', deco: 'splat', face: 'sticker', mark: 'SUNDAY' },
    geo: { wheelR: 0.257, tyre: 58, wb: 1.000, cs: 0.339, bb: 0.292, ac: 0.345,
      head: 75.0, ht: 0.11, riser: 0.24, barW: 0.74, seat: 0.55, fork: 'rigid',
      rear: false, bar: 'riser', pegs: true },
    tune: {
      maxSpeed: 16.0, slopeAccel: 0.80, rollFriction: 0.52, dragQuad: 0.0165,
      pedalMax: 8.5, pedalAccel: 9.5, pedalFloor: 0.30, brake: 6.5,
      steer: 3.6, steerAtMax: 0.34, airSteer: 2.4, spinTorque: 15.0,
      grip: 2.6, gripAtMax: 0.36, bermGripGain: 6.4, washAngle: 0.42, washSpeed: 7.0,
      hop: 3.1, popFull: 6.4, preloadTime: 0.38, preloadAccel: 4.2,
      pumpDownGain: 0.60, pumpPop: 3.5, pumpPopMax: 2.9, pumpMinSpeed: 1.4,
      lipDetach: 0.65, lipMaxVy: 10.0, lipMaxVyPerfect: 13.5,
      landMisalign: 0.80, landScrubHard: 0.30, flatLandScrub: 0.026, landMin: 2.0,
      maxRoll: 0.22, rollPerLateral: 0.038,
    },
  },
  {
    id: 'klunker', name: 'Schwinn Excelsior Klunker', brand: 'REPACK 1976',
    disc: 'klunker', group: 'fun',
    spec: { travel: 'rigid', head: 67.5, wb: 1130, mass: '20.4 kg', wheel: '26 × 2.125"' },
    blurb: 'Forty-five pounds of pre-war Schwinn paperboy bike with motorcycle levers bolted on. The coaster brake cooks its own grease on a long descent — that is literally why the race was called Repack — and Gary Fisher still took it down the hill at a 46 km/h average in 1976. Gravity does not care what you are riding.',
    look: { front: '#c41e28', rear: '#7d1218', fork: '#2b1c10', ink: '#2b1c10', accent: '#f0e6d2', link: '#3a3a42', rim: '#cfc6b4', word: '#f0e6d2', panel: '#7d1218', deco: 'retro', face: 'classic', mark: 'SCHWINN' },
    geo: { wheelR: 0.343, tyre: 56, wb: 1.130, cs: 0.485, bb: 0.290, ac: 0.430,
      head: 67.5, ht: 0.11, riser: 0.13, barW: 0.66, seat: 0.86, fork: 'rigid',
      rear: false, bar: 'swept', cantilever: true, fender: true },
    tune: {
      maxSpeed: 19.0, slopeAccel: 0.94, rollFriction: 0.62, dragQuad: 0.0110,
      pedalMax: 7.5, pedalAccel: 3.2, brake: 4.5, brakeGripMul: 0.40,
      steer: 1.70, steerAtMax: 0.20, airSteer: 0.90, spinTorque: 3.4,
      grip: 2.2, gripAtMax: 0.30, bermGripGain: 5.2, washAngle: 0.30, washSpeed: 6.0,
      washScrub: 11.0,
      hop: 1.5, popFull: 3.0, preloadTime: 0.70, preloadAccel: 2.0,
      pumpDownGain: 0.34, pumpPop: 2.0, pumpPopMax: 1.7,
      lipDetach: 0.90, lipMaxVy: 8.6, lipMaxVyPerfect: 11.0,
      landMisalign: 0.90, landScrubHard: 0.25, flatLandScrub: 0.020, landMin: 2.2,
      maxRoll: 0.14,
    },
  },
  {
    id: 'ice-cream-truck', name: 'Surly Ice Cream Truck', brand: 'SURLY',
    disc: 'fat bike', group: 'fun',
    spec: { travel: 'rigid', head: 68.0, wb: 1157, mass: '15.7 kg', wheel: '26 × 4.8"' },
    blurb: 'Four-point-eight inches of tyre on 77 mm rims at single-digit pressures. Slow, vague, and completely indifferent to what the surface is — snow, sand, or a landing you got badly wrong. The tyres are the suspension and they are much better at it than they look.',
    look: { front: '#f2b01e', rear: '#f2b01e', fork: '#b8790a', ink: '#17161a', accent: '#17161a', link: '#3a3a42', rim: '#17161a', word: '#17161a', panel: '#f2b01e', deco: 'plain', face: 'block', mark: 'SURLY' },
    geo: { wheelR: 0.404, tyre: 122, wb: 1.157, cs: 0.440, bb: 0.320, ac: 0.470,
      head: 68.0, ht: 0.11, riser: 0.06, barW: 0.76, seat: 0.90, fork: 'rigid',
      rear: false, bar: 'riser' },
    tune: {
      maxSpeed: 20.0, slopeAccel: 0.90, rollFriction: 0.66, dragQuad: 0.0135,
      pedalMax: 9.5, pedalAccel: 4.6, brake: 10.0,
      steer: 1.80, steerAtMax: 0.22, airSteer: 1.00, spinTorque: 4.0,
      grip: 4.8, gripAtMax: 0.50, bermGripGain: 6.0, washAngle: 0.52, washSpeed: 11.0,
      hop: 1.8, popFull: 3.6, preloadTime: 0.62, preloadAccel: 2.4,
      pumpDownGain: 0.32, pumpPop: 1.9, pumpPopMax: 1.7,
      lipDetach: 0.88, lipMaxVy: 9.0, lipMaxVyPerfect: 11.6,
      landMisalign: 1.20, landScrubHard: 0.50, flatLandScrub: 0.009, landMin: 2.8,
    },
  },
];

export const BIKE_BY_ID = Object.fromEntries(BIKE_MODELS.map((m) => [m.id, m]));
export const BIKE_DEFAULT = 'lab-standard';

export function getBikeModel(id) { return BIKE_BY_ID[id] || BIKE_BY_ID[BIKE_DEFAULT]; }

// The tuning a given bike actually plays with, already scaled to the scene unit.
export function bikeTuningFor(id, u = 1) { return scaleBikeTuning(u, getBikeModel(id).tune); }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- the four bars in the UI, derived from the numbers rather than authored.
// `term` is the honest terminal speed on a 20° pitch — shallow enough that the
// drag and the rolling resistance still bind, so a fat bike and a DH bike do not
// both simply read "maxSpeed".
export function bikeStats(m) {
  const T = { ...BIKE_TUNING, ...(m.tune || {}) };
  const drive = 16 * 0.342 * T.slopeAccel - T.rollFriction;      // 20° pitch
  const term = Math.min(T.maxSpeed, Math.sqrt(Math.max(0, drive) / T.dragQuad));
  return {
    // how fast it changes its mind, on the ground and in the air
    turn: clamp01(T.steer / 4.0) * 0.6 + clamp01(T.airSteer / 2.5) * 0.4,
    speed: clamp01((term - 14) / 16),
    // landing forgiveness, calm at speed, and grip — what keeps you upright
    stab: clamp01(clamp01((T.landMisalign - 0.70) / 0.80) * 0.5
      + (1 - clamp01(T.steer / 4.0)) * 0.25
      + clamp01(T.grip / 5.0) * 0.25),
    pop: clamp01(clamp01((T.popFull - 2.8) / 3.8) * 0.5 + clamp01(T.spinTorque / 15) * 0.5),
    // the raw numbers the detail strip quotes
    term, pedalMax: T.pedalMax, pedalAccel: T.pedalAccel, steer: T.steer,
    spinTorque: T.spinTorque, popFull: T.popFull, brake: T.brake,
    landMisalign: T.landMisalign, pumpPop: T.pumpPop,
  };
}
for (const m of BIKE_MODELS) m.stats = bikeStats(m);

// ---- which bike is under you. ?bike=<id> beats the remembered pick beats the
// lab standard; a URL override is deliberately NOT written back to storage.
const BIKE_LS_KEY = 'poi-lab.play.bike';
export function resolveBikeId(qs) {
  const q = qs && qs.get ? qs.get('bike') : null;
  if (q && BIKE_BY_ID[q]) return q;
  try { const s = localStorage.getItem(BIKE_LS_KEY); if (s && BIKE_BY_ID[s]) return s; } catch { /* private mode */ }
  return BIKE_DEFAULT;
}
export function rememberBikeId(id) {
  try { localStorage.setItem(BIKE_LS_KEY, id); } catch { /* private mode */ }
}

// ========================================================== the side profile
// One function turns a model's `geo` into the handful of points a bike actually
// is, in metres, ground at y = 0, front wheel toward -Z. BOTH consumers use it —
// the 3D rig and the inventory thumbnail — so the picture on the card is drawn
// from the same head angle and wheelbase the physics was derived from, and a
// slack bike looks slack for the same reason it steers slowly.

export function bikeProfile(m) {
  const g = m.geo;
  const R = g.wheelR;
  const fz = -g.wb / 2, rz = g.wb / 2;              // hub z
  const fh = [R, fz], rh = [R, rz];                 // hubs [y, z]
  // the fork runs up and back from the front axle along the head angle
  const hr = g.head * Math.PI / 180;
  const ht0 = [R + g.ac * Math.sin(hr), fz + g.ac * Math.cos(hr)];   // head tube bottom
  const ht1 = [ht0[0] + g.ht * Math.sin(hr), ht0[1] + g.ht * Math.cos(hr)];
  const bb = [g.bb, rz - g.cs];                     // bottom bracket
  const st = [g.seat, bb[1] + 0.14];                // seat/saddle top, laid back
  // bars: stem forward off the head tube top, then the rise
  const bar = [ht1[0] + g.riser, ht1[1] - 0.06];
  return { R, tyre: (g.tyre || 58) / 1000, fh, rh, ht0, ht1, bb, st, bar, g };
}

// ---- where the rider goes. Derived from the SAME profile, which is the whole
// point: hands land on this bike's grips, feet land on this bike's pedals, and
// the hips sit over this bike's bottom bracket. A 20" BMX therefore folds the
// rider up and a 29" XC bike stretches them out, for free.
//
// The pose is the attack position — standing on level cranks, hips back, torso
// pitched about 40° forward — because that is how every one of these bikes is
// ridden anywhere you would ride one in this game.
export function bikeRider(m) {
  const P = bikeProfile(m), G = m.geo;
  const sweep = G.bar === 'swept' ? 0.10 : 0.02;
  const hand = [P.bar[0], P.bar[1] + sweep];
  const handX = Math.max(0.20, G.barW / 2 - 0.06);
  const pedZ = [P.bb[1] - 0.175, P.bb[1] + 0.175];      // level cranks, L fore R aft
  const footY = P.bb[0] + 0.02;
  // The rider is the same 1.8 m person on every bike — only the bike changes
  // size underneath them, which is the entire joke of the 20" BMX. Hips 0.72 m
  // above the pedals is a leg bent into the attack position (0.85 straight);
  // the shoulders then sit most of the way along the hip→grip line and lifted,
  // so the torso pitch falls out of where THIS bike puts its bars instead of
  // being an angle someone typed in.
  const hip = [footY + 0.72, P.bb[1] + 0.16];
  const sho = [hip[0] + 0.62 * (hand[0] - hip[0]) + 0.30,
    hip[1] + 0.62 * (hand[1] - hip[1])];
  const head = [sho[0] + 0.235, sho[1] - 0.105];
  return { P, hip, sho, head, hand, handX, pedZ, footY, shoX: 0.17, hipX: 0.105, footX: 0.095 };
}

// ============================================================== the paint
// A bike's paint is not one colour and it is not a texture wrapped round a
// cylinder — it is a FRONT TRIANGLE, a REAR TRIANGLE, fork lowers, rims, and a
// wordmark down the down tube, each its own colour. That is how you tell a
// Bronson from a Nomad across a car park, so that is how the rack paints them:
// solid per-tube materials for the blocking, plus one 512x72 decal panel laid
// along both sides of the down tube carrying the brand mark. Cached per id.

const _decals = new Map(), _bthumbs = new Map();

// Approximations of house lettering — never the logos themselves. Checked
// against the studio shots in _ref-bikes/. The two brands that matter most here
// are opposites and the panel has to say so: Santa Cruz shouts (one heavy
// italic line running most of the down tube, in a colour picked to clash with
// the paint — yellow on Kalimotxo, magenta on Aqua, white on Liquid Blue),
// Canyon whispers (a small thin condensed mark tucked down near the bottom
// bracket, a shade or two off the frame colour).
const FACES = {
  block: { font: '900 46px "Arial Narrow", "Haettenschweiler", Impact, sans-serif', track: '6px', at: 0.52, fit: 0.88, sy: 1.45 },
  sc: { font: 'italic 900 42px "Arial Narrow", "Haettenschweiler", Impact, sans-serif', track: '1px', at: 0.50, fit: 0.90, sy: 1.35 },
  canyon: { font: '700 26px "Arial Narrow", Arial, sans-serif', track: '5px', at: 0.24, fit: 0.34, sy: 1.15 },
  mono: { font: '700 34px ui-monospace, "SFMono-Regular", Menlo, monospace', track: '3px', at: 0.5, fit: 0.62, sy: 1.2 },
  classic: { font: 'italic 700 40px "Palatino Linotype", Georgia, serif', track: '1px', at: 0.5, fit: 0.72, sy: 1.25 },
  sticker: { font: '900 42px "Arial Black", Arial, sans-serif', track: '1px', at: 0.5, fit: 0.80, sy: 1.3 },
};

function paintDecal(m) {
  const W = 512, H = 72, L = m.look;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const base = L.panel || L.front;
  x.fillStyle = base; x.fillRect(0, 0, W, H);

  // the panel's own decoration, under the lettering
  const deco = L.deco || 'plain';
  if (deco === 'fade') {
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, L.rear); g.addColorStop(0.55, base); g.addColorStop(1, base);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else if (deco === 'splat') {
    x.fillStyle = L.accent;
    for (let i = 0; i < 30; i++) {
      x.beginPath(); x.arc((i * 71) % W, (i * 43) % H, 3 + (i * 11) % 8, 0, 7); x.fill();
    }
  } else if (deco === 'retro') {
    x.fillStyle = L.accent;
    x.fillRect(0, H * 0.12, W, 4); x.fillRect(0, H * 0.82, W, 4);   // the pinstripes
    x.fillStyle = 'rgba(43,28,16,.22)';
    for (let i = 0; i < 26; i++) x.fillRect((i * 97) % W, (i * 29) % H, 5, 4);
  } else if (deco === 'stripe') {
    x.fillStyle = L.accent;
    x.fillRect(0, H * 0.06, W, 6); x.fillRect(0, H * 0.86, W, 6);
  }

  // tube shading: a highlight along the crown and a shadow along the underside,
  // so a flat plate still reads as the side of a round tube
  const sh = x.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(255,255,255,.20)');
  sh.addColorStop(0.42, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(0,0,0,.30)');
  x.fillStyle = sh; x.fillRect(0, 0, W, H);

  // the wordmark
  const mark = L.mark || m.brand;
  const F = FACES[L.face] || FACES.block;
  const lines = F.stack ? mark.split(' ') : [mark];
  x.font = F.font;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (x.letterSpacing !== undefined) x.letterSpacing = F.track;
  let wide = 0;
  for (const t of lines) wide = Math.max(wide, x.measureText(t).width);
  const sx = Math.min(2.3, (W * F.fit) / Math.max(1, wide));
  x.save();
  x.translate(W * F.at, H * 0.52);
  x.scale(sx, F.sy);
  const step = lines.length > 1 ? 24 : 0;
  for (let i = 0; i < lines.length; i++) {
    const dy = (i - (lines.length - 1) / 2) * step;
    x.fillStyle = 'rgba(0,0,0,.28)';
    x.fillText(lines[i], 2, dy + 2);
    x.fillStyle = L.word;
    x.fillText(lines[i], 0, dy);
  }
  x.restore();
  return c;
}

export function bikeDecal(m) {
  const model = typeof m === 'string' ? getBikeModel(m) : m;
  if (!_decals.has(model.id)) _decals.set(model.id, paintDecal(model));
  return _decals.get(model.id);
}

// ---- the inventory thumbnail: a side view drawn straight off bikeProfile, so
// a 20" BMX really is small in its frame and the V10's dual crown really is a
// dual crown. Front to the right, ground on the bottom rule.
function paintBikeThumb(m) {
  const W = 300, H = 172;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const P = bikeProfile(m), L = m.look;
  // ONE scale for the whole rack, set by the longest bike in it (the V10, at
  // 1.30 m of wheelbase plus two 29" wheels ≈ 2.05 m tip to tip). Everything
  // else is drawn at that same px/m, so the 20" BMX really is small in its frame
  // and the fat bike's tyres really are that much of the bike.
  const K = (W - 26) / 2.10;
  const cx = W / 2, gy = H - 14;
  const X = (z) => cx - z * K;                  // -Z (front) goes right
  const Y = (y) => gy - y * K;

  const tube = (a, b, w, col) => {
    x.strokeStyle = col; x.lineWidth = w * K; x.lineCap = 'round';
    x.beginPath(); x.moveTo(X(a[1]), Y(a[0])); x.lineTo(X(b[1]), Y(b[0])); x.stroke();
  };
  const wheel = (h) => {
    const px = X(h[1]), py = Y(h[0]);
    x.strokeStyle = '#15151a'; x.lineWidth = Math.max(3, P.tyre * K);
    x.beginPath(); x.arc(px, py, P.R * K, 0, 7); x.stroke();
    x.strokeStyle = L.rim; x.lineWidth = 2;
    x.beginPath(); x.arc(px, py, P.R * K * 0.80, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(200,200,210,.55)'; x.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * P.R * K * 0.80, py + Math.sin(a) * P.R * K * 0.80);
      x.stroke();
    }
  };

  wheel(P.fh); wheel(P.rh);

  if (m.geo.fender) {                            // klunker fenders, over the top
    for (const h of [P.fh, P.rh]) {
      for (const [col, w] of [[L.ink, 8], [L.accent, 5]]) {
        x.strokeStyle = col; x.lineWidth = w;
        x.beginPath();
        x.arc(X(h[1]), Y(h[0]), P.R * K * 1.14, Math.PI * 1.12, Math.PI * 1.96);
        x.stroke();
      }
    }
  }

  // the fork: a dual crown gets fat legs and two visible crown plates, which is
  // how you tell a downhill bike from everything else at a glance
  const dual = m.geo.fork === 'dual';
  tube(P.ht0, P.fh, dual ? 0.058 : 0.034, L.fork);
  if (dual) {
    for (const y of [P.ht0[0], P.ht1[0] + 0.055]) {
      const dz = 0.058 * Math.cos(m.geo.head * Math.PI / 180);
      const az = P.ht0[1] + (y - P.ht0[0]) / Math.tan(m.geo.head * Math.PI / 180);
      tube([y, az + 0.075 - dz], [y, az - 0.075 - dz], 0.055, L.fork);
    }
  }

  // FRONT TRIANGLE in one colour, REAR TRIANGLE in another — the blocking that
  // actually distinguishes one manufacturer's paint from another's
  const fw = 0.052;                              // frame tube width, metres
  tube(P.bb, P.ht0, fw * 1.15, L.front);         // down tube — the fat one
  tube(P.ht1, P.st, fw, L.front);                // top tube
  tube(P.bb, P.st, fw, L.front);                 // seat tube
  tube(P.bb, P.rh, fw * 0.85, L.rear);           // chainstay
  tube(P.st, P.rh, fw * 0.72, L.rear);           // seatstay
  if (m.geo.rear) {                              // the shock, BB-ish to top tube
    const a = [P.bb[0] + 0.10, P.bb[1] - 0.02];
    const b = [(P.ht1[0] + P.st[0]) / 2 - 0.02, (P.ht1[1] + P.st[1]) / 2];
    tube(a, b, 0.052, '#3a3a42');
    tube([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, 0.030, '#c9ccd4');   // the shaft
  }
  if (m.geo.cantilever) {
    // the 1938 Schwinn cantilever: a curved twin tube from the head tube over
    // the top and down to the rear axle. It is the only thing that makes a
    // klunker look like a klunker and not like a tall hardtail.
    x.strokeStyle = L.front; x.lineWidth = fw * 0.9 * K; x.lineCap = 'round';
    x.beginPath();
    x.moveTo(X(P.ht1[1]), Y(P.ht1[0]));
    x.quadraticCurveTo(X(P.bb[1] + 0.10), Y(P.st[0] + 0.02), X(P.rh[1]), Y(P.rh[0] + 0.02));
    x.stroke();
  }
  // the down tube decal, drawn along the tube so the card shows the same
  // wordmark the 3D bike carries
  {
    const a = P.bb, b = P.ht0;
    const ax = X(a[1]), ay = Y(a[0]), bx = X(b[1]), by = Y(b[0]);
    const len = Math.hypot(bx - ax, by - ay);
    x.save();
    x.translate((ax + bx) / 2, (ay + by) / 2);
    x.rotate(Math.atan2(by - ay, bx - ax));
    const dw = len * 0.74, dh = fw * 1.02 * K;
    x.drawImage(bikeDecal(m), -dw / 2, -dh / 2, dw, dh);
    x.restore();
  }
  tube(P.ht0, P.ht1, 0.06, L.ink);               // head tube
  tube(P.ht1, P.bar, 0.028, L.ink);              // stem + riser
  // saddle: a wedge over the seat top, nose forward
  {
    const sx = X(P.st[1]), sy = Y(P.st[0]);
    x.fillStyle = L.ink;
    x.beginPath();
    x.moveTo(sx + 20, sy - 4); x.lineTo(sx - 10, sy - 5);
    x.lineTo(sx - 13, sy + 2); x.lineTo(sx + 20, sy + 1);
    x.closePath(); x.fill();
  }
  // the bar, side-on: the grip end plus a sweep back, so a swept klunker bar and
  // a BMX riser are two different shapes and not two identical dots
  {
    const sweep = m.geo.bar === 'swept' ? 0.10 : 0.02;
    tube(P.bar, [P.bar[0], P.bar[1] + sweep], 0.034, L.ink);
    x.fillStyle = L.accent;
    x.beginPath(); x.arc(X(P.bar[1] + sweep), Y(P.bar[0]), 6, 0, 7); x.fill();
  }
  // cranks
  x.strokeStyle = '#9a9aa4'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(X(P.bb[1]), Y(P.bb[0]));
  x.lineTo(X(P.bb[1] - 0.06), Y(P.bb[0] - 0.16)); x.stroke();
  x.strokeStyle = 'rgba(154,154,164,.8)'; x.lineWidth = 2;
  x.beginPath(); x.arc(X(P.bb[1]), Y(P.bb[0]), 0.10 * K, 0, 7); x.stroke();

  // ground rule, so the wheel-size differences have something to sit on
  x.strokeStyle = 'rgba(23,22,26,.35)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(10, gy + 1); x.lineTo(W - 10, gy + 1); x.stroke();
  return c;
}

export function bikeThumbURL(m) {
  const model = typeof m === 'string' ? getBikeModel(m) : m;
  if (!_bthumbs.has(model.id)) _bthumbs.set(model.id, paintBikeThumb(model).toDataURL('image/png'));
  return _bthumbs.get(model.id);
}

// ============================================================= the 3D bike
// Built from bikeProfile too, which is why the dual crown, the 20" wheels and
// the fat tyres all just happen. Cheap: ~30 boxes/cylinders/tori per bike, and
// only three exist (the first-person bike, the third-person bike, the locker's
// preview). Restyling REBUILDS — a bike's silhouette is not a scale of another
// bike's, and equipping happens once, not every frame.

const _rigs = new WeakMap(), _texes = new Map();

// the down-tube decal, twice: once as painted and once mirrored, because the
// right-hand side of the tube sees the panel from behind and a backwards
// wordmark is the first thing anyone notices
function decalTexture(THREE, m, flip) {
  const k = m.id + (flip ? ':r' : ':l');
  if (!_texes.has(k)) {
    const t = new THREE.CanvasTexture(bikeDecal(m));
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    if (flip) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
    _texes.set(k, t);
  }
  return _texes.get(k);
}

const hexDim = (hex, k) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return (r << 16) | (g << 8) | b;
};

export function makeBikeRig(THREE, u) {
  const g = new THREE.Group();
  _rigs.set(g, { u, built: null });
  return g;
}

// Tear the old bike out without leaking its geometry OR its materials. The
// materials are per-rebuild (they carry this model's colours), so unlike the
// canvases and textures — which are cached per id and shared — they have to go
// with the meshes or every equip strands another eight of them on the GPU.
function clearRig(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // the decal materials own no texture of their own — the map is the cached
      // one from decalTexture — so dispose the material and leave the map alone
      if (o.material) for (const mt of [].concat(o.material)) mt.dispose();
    });
  }
}

// `rider` is 'tp' (the whole body, for the third-person bike), 'fp' (forearms,
// hands and legs only — a torso in front of the lens reads as a bug, the same
// lesson the glider's first-person rig learned) or null (the locker preview's
// bare bike).
export function styleBikeRig(THREE, rig, m, opts = {}) {
  const r = _rigs.get(rig);
  if (!r) return;
  const model = typeof m === 'string' ? getBikeModel(m) : (m || getBikeModel(BIKE_DEFAULT));
  const rider = opts.rider || null;
  const key = model.id + '/' + rider;
  if (r.built === key) return;
  r.built = key;
  clearRig(rig);

  const u = r.u, L = model.look, P = bikeProfile(model), G = model.geo;
  const lamb = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  // Solid colours per tube group, not a texture wrapped round a cylinder: the
  // emissive floor is what keeps a dark frame from going to silhouette in a
  // shaded forest, exactly as the skis do it.
  const frontMat = lamb(L.front, hexDim(L.front, 0.42));
  const rearMat = lamb(L.rear, hexDim(L.rear, 0.42));
  const forkMat = lamb(L.fork, hexDim(L.fork, 0.55));
  const inkMat = lamb(L.ink, hexDim(L.ink, 0.7));
  const accMat = lamb(L.accent, hexDim(L.accent, 0.35));
  const linkMat = lamb(L.link, hexDim(L.link, 0.45));
  const rubber = lamb(0x1a1a1e, 0x0a0a0c);
  const metal = lamb(0xb9b9c2, 0x4a4a52);
  const rimMat = lamb(L.rim, hexDim(L.rim, 0.5));

  // ---- a tube from a to b, both [y, z] in metres
  const tube = (a, b, rad, mat) => {
    const dy = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dy, dz);
    if (len < 1e-4) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad * u, rad * u, len * u, 7), mat);
    mesh.position.set(0, (a[0] + b[0]) / 2 * u, (a[1] + b[1]) / 2 * u);
    mesh.rotation.x = Math.atan2(dz, dy);       // cylinder runs along +Y by default
    rig.add(mesh);
    return mesh;
  };
  // a pair of tubes, one each side (chainstays, seatstays, fork legs)
  const pair = (a, b, rad, mat, dx) => {
    for (const s of [-1, 1]) { const t = tube(a, b, rad, mat); if (t) t.position.x = s * dx * u; }
  };
  // a flat decal panel laid along a tube, one plate per side facing outward.
  // Box length runs along local +Z, so Rx(atan2(-dy, dz)) aims it down the tube
  // and leaves local +Y pointing round the tube's crown — which is what keeps
  // the lettering upright and tilted with the down tube, like a real one.
  const decal = (a, b, wide, off) => {
    const dy = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dy, dz);
    if (len < 1e-4) return;
    for (const s of [-1, 1]) {
      const mat = new THREE.MeshLambertMaterial({
        color: 0xffffff, emissive: hexDim(L.panel || L.front, 0.40),
        map: decalTexture(THREE, model, s > 0),
      });
      const pl = new THREE.Mesh(
        new THREE.BoxGeometry(0.004 * u, wide * u, len * 0.80 * u), mat);
      pl.position.set(s * off * u, (a[0] + b[0]) / 2 * u, (a[1] + b[1]) / 2 * u);
      pl.rotation.x = Math.atan2(-dy, dz);
      rig.add(pl);
    }
  };

  // ---- wheels
  const tyreR = P.tyre / 2;
  for (const h of [P.fh, P.rh]) {
    const w = new THREE.Group();
    w.position.set(0, h[0] * u, h[1] * u);
    const tg = new THREE.TorusGeometry((P.R - tyreR) * u, tyreR * u, 6, 20);
    tg.rotateY(Math.PI / 2);
    w.add(new THREE.Mesh(tg, rubber));
    const rg = new THREE.CylinderGeometry(P.R * 0.80 * u, P.R * 0.80 * u, 0.022 * u, 18, 1, true);
    rg.rotateZ(Math.PI / 2);
    w.add(new THREE.Mesh(rg, rimMat));
    const hg = new THREE.CylinderGeometry(0.028 * u, 0.028 * u, 0.11 * u, 8);
    hg.rotateZ(Math.PI / 2);
    w.add(new THREE.Mesh(hg, metal));
    for (let i = 0; i < 6; i++) {               // spokes: enough to read as a wheel
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.006 * u, P.R * 1.55 * u, 0.006 * u), metal);
      s.rotation.x = i * Math.PI / 6;
      w.add(s);
    }
    rig.add(w);
  }

  // ---- fork. A dual crown gets a second crown plate and visibly fatter legs;
  // that silhouette is the whole reason you can tell a DH bike at 40 m.
  const dual = G.fork === 'dual';
  const legR = dual ? 0.026 : (G.fork === 'rigid' ? 0.015 : 0.020);
  pair(P.ht0, P.fh, legR, forkMat, 0.055);
  if (dual) {
    for (const y of [P.ht0, [P.ht1[0] + 0.05, P.ht1[1] + 0.02]]) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.20 * u, 0.035 * u, 0.09 * u), forkMat);
      cr.position.set(0, y[0] * u, y[1] * u);
      rig.add(cr);
    }
  }

  // ---- frame: front triangle in one colour, rear triangle in the other
  const fw = 0.030;
  tube(P.bb, P.ht0, fw * 1.20, frontMat);        // down tube
  tube(P.ht1, P.st, fw, frontMat);               // top tube
  tube(P.bb, P.st, fw * 0.95, frontMat);         // seat tube
  pair(P.bb, P.rh, fw * 0.72, rearMat, 0.055);   // chainstays
  pair(P.st, P.rh, fw * 0.58, rearMat, 0.045);   // seatstays
  decal(P.bb, P.ht0, fw * 2.05, fw * 1.20 + 0.003);   // the wordmark, both sides
  if (G.rear) {                                  // the shock
    tube([P.bb[0] + 0.10, P.bb[1] - 0.02],
      [(P.ht1[0] + P.st[0]) / 2 - 0.02, (P.ht1[1] + P.st[1]) / 2], 0.028, linkMat);
  }
  tube(P.ht0, P.ht1, 0.036, inkMat);             // head tube
  tube(P.ht1, P.bar, 0.018, inkMat);             // stem + riser

  // ---- bars. A swept klunker bar and a BMX riser are different animals.
  {
    const sweep = G.bar === 'swept' ? 0.10 : 0.02;
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016 * u, 0.016 * u, G.barW * u, 7), inkMat);
    b.rotation.z = Math.PI / 2;
    b.position.set(0, P.bar[0] * u, (P.bar[1] + sweep) * u);
    rig.add(b);
    for (const s of [-1, 1]) {                   // grips
      const gp = new THREE.Mesh(new THREE.CylinderGeometry(0.019 * u, 0.019 * u, 0.12 * u, 7), accMat);
      gp.rotation.z = Math.PI / 2;
      gp.position.set(s * (G.barW / 2 - 0.06) * u, P.bar[0] * u, (P.bar[1] + sweep) * u);
      rig.add(gp);
    }
  }

  // ---- saddle + post
  {
    const sd = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.04 * u, 0.26 * u), inkMat);
    sd.position.set(0, (P.st[0] + 0.03) * u, (P.st[1] + 0.02) * u);
    rig.add(sd);
  }

  // ---- cranks + chainring. LEVEL, one arm forward one back, because that is
  // where the cranks are for every second of the attack position the rider
  // below is posed in — and the rider's feet are placed off exactly these.
  {
    const cg = new THREE.CylinderGeometry(0.10 * u, 0.10 * u, 0.008 * u, 14);
    cg.rotateZ(Math.PI / 2);
    const ring = new THREE.Mesh(cg, metal);
    ring.position.set(0.035 * u, P.bb[0] * u, P.bb[1] * u);
    rig.add(ring);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.020 * u, 0.026 * u, 0.175 * u), metal);
      arm.position.set(s * 0.075 * u, P.bb[0] * u, (P.bb[1] - s * 0.087) * u);
      rig.add(arm);
      const pd = new THREE.Mesh(new THREE.BoxGeometry(0.09 * u, 0.016 * u, 0.078 * u), inkMat);
      pd.position.set(s * 0.095 * u, (P.bb[0] - 0.02) * u, (P.bb[1] - s * 0.175) * u);
      rig.add(pd);
    }
  }

  // ---- the cantilever twin top tube (klunker). Six chords round a quadratic
  // from the head tube to the rear axle — the curve is the whole silhouette.
  if (G.cantilever) {
    const c0 = P.ht1, c1 = [P.st[0] + 0.02, P.bb[1] + 0.10], c2 = [P.rh[0] + 0.02, P.rh[1]];
    const canti = frontMat;
    const at = (t) => [
      (1 - t) * (1 - t) * c0[0] + 2 * (1 - t) * t * c1[0] + t * t * c2[0],
      (1 - t) * (1 - t) * c0[1] + 2 * (1 - t) * t * c1[1] + t * t * c2[1],
    ];
    for (let i = 0; i < 6; i++) pair(at(i / 6), at((i + 1) / 6), fw * 0.55, canti, 0.038);
  }

  // ---- fenders (klunker). Six plates round the top of each wheel; a curve is
  // not worth a lathe here, and at any real distance six is a fender.
  if (G.fender) {
    for (const h of [P.fh, P.rh]) {
      for (let i = 0; i < 6; i++) {
        const a = -1.05 + i * 0.42;
        const pl = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.012 * u, 0.14 * u), accMat);
        pl.position.set(0, (h[0] + Math.cos(a) * (P.R + 0.045)) * u,
          (h[1] + Math.sin(a) * (P.R + 0.045)) * u);
        pl.rotation.x = -a;
        rig.add(pl);
      }
    }
  }

  // ---- pegs (BMX)
  if (G.pegs) {
    for (const h of [P.fh, P.rh]) {
      for (const s of [-1, 1]) {
        const pg = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * u, 0.022 * u, 0.10 * u, 7), metal);
        pg.rotation.z = Math.PI / 2;
        pg.position.set(s * 0.11 * u, h[0] * u, h[1] * u);
        rig.add(pg);
      }
    }
  }

  // ---- the rider, posed off bikeRider(). Hands land on THIS bike's grips and
  // feet on THIS bike's pedals, so equipping a 20" BMX folds the rider up and a
  // 29" enduro bike stretches them out without a single extra number.
  if (rider) rig.add(buildRider(THREE, u, model, rider));
}

// The colours match the skier in main.js — same person, different equipment.
const RIDER = { jacket: 0xff4d00, jacketE: 0x7a2500, dark: 0x26231f, darkE: 0x12110f,
  skin: 0xf4f1ea, skinE: 0x6b675f, lid: 0x1b1b1f, lidE: 0x0c0c0e };

function buildRider(THREE, u, model, mode) {
  const R = bikeRider(model);
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: RIDER.jacket, emissive: RIDER.jacketE });
  const dark = new THREE.MeshLambertMaterial({ color: RIDER.dark, emissive: RIDER.darkE });
  const skin = new THREE.MeshLambertMaterial({ color: RIDER.skin, emissive: RIDER.skinE });
  const lid = new THREE.MeshLambertMaterial({ color: RIDER.lid, emissive: RIDER.lidE });

  // a limb segment from a to b, both [x, y, z] in metres. The box runs along its
  // own +Z and Object3D.lookAt points +Z at the target, so one call aims it.
  const limb = (a, b, w, mat, h = w) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-4) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * u, h * u, len * u), mat);
    m.position.set((a[0] + b[0]) / 2 * u, (a[1] + b[1]) / 2 * u, (a[2] + b[2]) / 2 * u);
    m.lookAt(new THREE.Vector3(b[0] * u, b[1] * u, b[2] * u));
    g.add(m);
    return m;
  };

  const full = mode === 'tp';
  const hip = (s) => [s * R.hipX, R.hip[0], R.hip[1]];
  const sho = (s) => [s * R.shoX, R.sho[0], R.sho[1]];
  const hand = (s) => [s * R.handX, R.hand[0], R.hand[1]];
  const foot = (s) => [s * R.footX, R.footY, R.pedZ[s < 0 ? 0 : 1]];

  if (full) {
    // torso: hips to shoulders, pitched forward by the geometry, not by a guess
    limb([0, R.hip[0], R.hip[1]], [0, R.sho[0], R.sho[1]], 0.32, jacket, 0.19);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115 * u, 10, 8), skin);
    head.position.set(0, R.head[0] * u, R.head[1] * u);
    g.add(head);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.133 * u, 10, 6, 0, 6.3, 0, 1.6), lid);
    helm.position.set(0, (R.head[0] + 0.012) * u, R.head[1] * u);
    g.add(helm);
  }

  for (const s of [-1, 1]) {
    const S0 = sho(s), H = hand(s);
    // one elbow, bent out and down — a straight stick from shoulder to grip is
    // the single thing that makes a low-poly rider read as a mannequin
    // Third person gets the whole arm from the shoulder. First person gets ONLY
    // a forearm, and a short one pinned to the grip — the upper arm and shoulder
    // belong behind the lens, and anything that starts near the eye reads as a
    // fin across the screen rather than a limb. (The glider's fp rig learned
    // exactly this, twice.)
    const el = full
      ? [(S0[0] + H[0]) / 2 + s * 0.070, (S0[1] + H[1]) / 2 - 0.060, (S0[2] + H[2]) / 2 + 0.03]
      : [H[0] + s * 0.16, H[1] - 0.22, H[2] + 0.34];
    if (full) limb(S0, el, 0.090, jacket);
    limb(el, H, full ? 0.078 : 0.062, full ? jacket : dark);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.070 * u, 0.070 * u, 0.09 * u), dark);
    gl.position.set(H[0] * u, H[1] * u, H[2] * u);
    g.add(gl);

    const HP = hip(s), F = foot(s);
    // knee forward of the hip–foot line: the bent-leg attack stance
    const kn = [(HP[0] + F[0]) / 2 + s * 0.020, (HP[1] + F[1]) / 2 + 0.035, (HP[2] + F[2]) / 2 - 0.155];
    limb(HP, kn, 0.115, dark);
    limb(kn, F, 0.095, dark);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.095 * u, 0.055 * u, 0.23 * u), lid);
    sh.position.set(F[0] * u, (F[1] + 0.03) * u, F[2] * u);
    g.add(sh);
  }
  return g;
}
