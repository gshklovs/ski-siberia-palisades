// The snowmobile. The one gear on the mountain with an engine in it.
//
// Same module shape as ski.js / bike.js / sled.js, so the controller wiring is
// one more GEARS entry: SNOWMOBILE_TUNING / scaleSnowmobileTuning /
// snowmobileStep / snowmobileLand, a rack (SNOWMOBILE_MODELS), and the rigs.
//
// What makes it different from everything else in the player: it is the only
// gear that can go UP. Every other model here is gravity plus a way of spending
// it. This one has a track, and a track pushes.
//
//   1. THROTTLE (W) — `driveAccel` tapering toward `driveTop`, so it punches
//      off the line and settles around 24 m/s on the flat: between the bike's
//      22 and a downhill ski's 34. Nothing else in the rack accelerates on
//      level ground at all.
//   2. CLIMBING — the fall-line gravity term is the same one the skis use, and
//      pointed uphill it is a decelerating force. A realistic track loses that
//      argument at about 24°, which on this mountain is most of the mountain:
//      ordinary Palisades pitches are 20°+ and the faces worth riding are 25–45°,
//      so a real machine bogged on nearly every slope and the gear was no fun.
//      So the track is now geared for the terrain. `climbAssist` cancels most of
//      the along-the-machine gravity component while you are on the throttle and
//      pointed uphill — grade compensation, the thing a low gear does — which
//      leaves the ordinary drive taper to set the speed. The result is that a
//      20° face is ridden at nearly flat-ground speed and a 30° face still pulls
//      20 m/s. What eventually stops it is bite, not power: `climbSlip0` /
//      `climbSlipSpan` bleed traction away from 28° to 58°, cutting the drive AND
//      the assist together and loosening the skis sideways (`climbSpinGrip`), so
//      past ~38° it sputters and past ~41° the track spins and the machine washes
//      out and slides back. Failure is a spin-out, not a wall. All of it is
//      scaled by how squarely you are attacking the fall line, so traversing is
//      still the answer to a face you cannot take head-on.
//   3. BRAKE AND REVERSE (S) — a real brake, 12 m/s², and once you are stopped
//      the same key backs you out at up to 5 m/s. The only gear here that can
//      undo a mistake without respawning. SHIFT used to be a second brake key;
//      it is the booster now (below), so the brake is S alone.
//   3b. THE BOOSTER (SHIFT, or G) — the rocket pack's motor, bolted to the
//      tunnel: same tank, same 6 s, same fuel bar. boost.js pushes the machine
//      along its own heading and, unlike the pack, leaves this model running, so
//      the sled still steers and its own drag still decides how fast it ends up
//      going. All this file does about it is read `ctx.thrust` and open the
//      speed ceiling (`boostMaxSpeed`) while swapping in a much heavier drag
//      (`boostDrag`), which lands the terminal near 50 m/s — twice the flat
//      cruise — instead of the pack's 100. The ceiling then closes gradually
//      (`boostCeilFall`) so letting go is a coast, not a wall.
//      That 50 is the ON-THE-SNOW terminal, and it is only half the story: the
//      heavy drag lives in the grounded branch, so every frame the machine is
//      airborne it coasts on `airDrag` instead — 0.0018 against 0.014, near
//      eight times lighter — while the motor keeps pushing. At boost speed over
//      real terrain the sled flies about a quarter to a third of the time, so
//      the ceiling is not a formality: it is what actually catches a boosted
//      run across broken ground. Measured on palisades-front: a burn that
//      stayed 100% grounded peaked at 48.5 m/s (the drag terminal), while runs
//      at 67–77% grounded were still gaining at 58 m/s and sat on the 60.
//   4. SKID STEER, WITH MASS — the yaw rate you ask for is not the yaw rate you
//      get: `steerLag` eases into it, so the machine takes a beat to change its
//      mind. Steering authority falls off with speed and the lateral grip goes
//      with it, so the turn widens and the back end steps out — at 20 m/s you
//      are pointing it, not placing it. Overshooting a corner on a steep face
//      is the whole danger, and it is a mass problem, not a grip problem.
//   5. SUSPENSION — `snowmobileLand` converts the impact into a compression
//      (`crouch`, 0..1, decaying at `squashRecover`). The camera rig already
//      sinks the eye with crouch and the rig squats on it, so a big landing
//      reads as 300 mm of travel being used rather than as a bump.
//
// Boots physics live in controller.js and never come through here.

import { BRAND, pick } from './flags.js';

export const SNOWMOBILE_TUNING = {
  // ---- contract with the controller's ride path
  maxSpeed: 30,          // m/s — hard backstop. Only ever reached downhill;
                         // the powered flat cruise is ~24 (see driveTop below).
  snapMul: 2.2,          // × (speed·dt) — downhill ground snap
  landMin: 5.0,          // m/s — below this a landing is not judged at all

  // ---- the engine
  driveAccel: 13.0,      // m/s² — thrust at a standstill (W)
  driveTop: 32,          // m/s — reference the thrust tapers toward; with the
                         // drag below this settles the flat top speed at ~24.3
  driveFloor: 0.05,      // fraction of driveAccel still there at driveTop
  reverseAccel: 5.0,     // m/s² — backing up (S once stopped)
  reverseMax: 5.0,       // m/s — how fast you may go backwards
  brake: 12.0,           // m/s² — S while rolling forward
                         // (`brakeGripMul` lived here and modified the SHIFT
                         //  brake alone; SHIFT is the booster now, so it went
                         //  with it. The S brake is untouched.)

  // ---- resistance
  rollFriction: 0.50,    // m/s² — track and skis on snow
  dragQuad: 0.0045,      // 1/m — quadratic air drag
  airDrag: 0.0018,       // 1/m — quadratic drag while airborne
  slopeAccel: 0.95,      // × gravity·sinθ along the fall line

  // ---- under the booster (boost.js pushes; these decide where it tops out)
  boostMaxSpeed: 60,     // m/s — the ceiling while the motor burns. On the snow
                         // boostDrag settles it near 50 well before this; in the
                         // air it does not, because airDrag applies there
                         // instead, so this is the working limit of a boosted
                         // run over broken ground, not a formality. Deliberately
                         // left where it is: boostCeilFall makes it a soft top.
  boostDrag: 0.014,      // 1/m — quadratic drag under thrust. 35 m/s² of motor
                         // against this is ~50 m/s on the flat: rocket-fast for
                         // a machine that cruises at 24, and still steerable.
                         // The pack's own 100 m/s cap never comes into it.
                         // Do not raise this to stop the ceiling being touched —
                         // the touches happen on airborne frames, which this
                         // constant never sees. It would only slow the machine
                         // where it is already correct.
  boostCeilFall: 8.0,    // m/s per second the raised ceiling closes after you
                         // let go, so release is a coast rather than a wall

  // ---- what stops it climbing everything
  climbAssist: 0.80,     // share of the along-the-machine gravity component the
                         // track cancels on the throttle — the low gear. Below 1
                         // by design: every climb still costs you something, and
                         // an uphill can never be quicker than the flat.
  climbSlip0: 0.47,      // sinθ (≈28°) where the track starts to slip
  climbSlipSpan: 0.38,   // sinθ span over which bite falls to nothing (≈58°)
                         // → straight up: full bite to 28°, holds ~22 m/s at 20°
                         //   and ~20 at 30°, sputters from 38°, spins out at ~41°
  climbSpinGrip: 0.45,   // share of lateral grip lost at full slip while on the
                         // throttle — a spinning track does not hold a line,
                         // so the steep failure washes out sideways

  // ---- steering
  grip: 3.0,             // 1/s — lateral bleed at a standstill
  gripAtMax: 0.34,       // fraction left at maxSpeed — the back end steps out
  carveRecover: 0.25,    // share of scrubbed lateral speed handed back forward
  steer: 2.3,            // rad/s asked for by A/D at a standstill
  steerAtMax: 0.26,      // fraction of steer left at maxSpeed — the turn widens
  steerLag: 5.5,         // 1/s — how fast the machine adopts the yaw rate you
                         // asked for. This is the mass, and it is the feel.
  airSteer: 0.7,         // rad/s from A/D while airborne
  spinTorque: 3.2,       // rad/s from ← → while airborne — 400 kg does not spin

  // ---- arrivals
  landBoost: 0.38,       // share of impact speed converted down the fall line
  landSquash: 0.075,     // compression per m/s of impact (13 m/s = fully compressed)
  squashRecover: 3.0,    // 1/s — how fast the suspension comes back up
  landScrubMisalign: 0.55, // fraction of speed kept landing badly off-axis

  // ---- camera bank (presentation; the physics never reads these)
  maxRoll: 0.20,         // rad
  rollPerLateral: 0.030, // rad per m/s of across-the-machine velocity
  rollRate: 7,           // 1/s

  // ---- per-model handles, inert at their defaults
  popMul: 0.85,          // × the controller's jump velocity — a small pop
  wipeTol: 0.30,         // rad of slop past 90° before a landing is a wipeout
};

// Lengths/speeds/accelerations scale with the scene's unit; rates (1/s), times
// and pure ratios do not; the quadratic drags are 1/length.
export function scaleSnowmobileTuning(u, over = {}) {
  const S = { ...SNOWMOBILE_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'driveAccel', 'driveTop', 'reverseAccel', 'reverseMax',
    'brake', 'rollFriction', 'landMin', 'boostMaxSpeed', 'boostCeilFall']) S[k] *= u;
  for (const k of ['dragQuad', 'airDrag', 'rollPerLateral', 'landSquash', 'boostDrag']) S[k] /= u;
  return S;
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// One machine per page, so module state — the same trade every other gear
// module makes. `yawRate` is the mass; `squash` is the suspension; `track` is
// the belt's phase, which only the renderer reads.
const st = {
  yawRate: 0, squash: 0, track: 0, speed: 0, vf: 0, throttle: 0,
  drive: 0, assist: 0, climb: 0, slip: 0, reverse: false, air: 0, steerVis: 0, yaw: 0,
  boost: false, ceil: 0,
};

export function snowmobileReset() {
  st.yawRate = 0; st.squash = 0; st.track = 0; st.speed = 0; st.vf = 0;
  st.throttle = 0; st.drive = 0; st.assist = 0; st.climb = 0; st.slip = 0;
  st.reverse = false; st.air = 0; st.steerVis = 0;
  st.boost = false; st.ceil = 0;
}

// Live snapshot for the HUD and the tests.
export function snowmobileState() {
  return {
    speed: st.speed,
    forward: st.vf,          // signed along-the-machine speed (negative = reverse)
    throttle: st.throttle,   // 0..1 — W held
    drive: st.drive,         // m/s² actually being delivered to the snow
    assist: st.assist,       // m/s² of that which is grade compensation
    climb: st.climb,         // 0..1 — how squarely you are pointed uphill
    slip: st.slip,           // 0..1 — how much of the drive the slope is eating
    reverse: st.reverse,
    boost: st.boost,         // the booster is burning (boost.js owns the fuel)
    ceiling: st.ceil,        // m/s — the speed limit in force right now
    squash: st.squash,       // 0..1 — suspension compression
    airTime: st.air,
    track: st.track,
    yaw: st.yaw,
  };
}

// One step of snowmobile dynamics. Mutates ctx.vel (XZ only — the controller
// owns Y, gravity and ground contact) and returns yaw, camera bank and the
// suspension compression.
//
// ctx: { vel, yaw, keys, grounded, normal|null, gravity, dt, S, lean }
export function snowmobileStep(ctx) {
  const { vel, keys, dt, S } = ctx;
  let yaw = ctx.yaw;

  const sp0 = Math.hypot(vel.x, vel.z);
  const fast = Math.min(1, sp0 / S.maxSpeed);

  // ---- steer, through the machine's inertia. The command is A/D (and the
  // arrows, which on the ground are simply more steer); what you get is a yaw
  // rate that eases toward it, which is the whole heavy-machine feel.
  let turn = 0;
  if (keys.left) turn += 1;
  if (keys.right) turn -= 1;                        // +yaw is left (forward is -Z)
  let spin = 0;
  if (keys.spinLeft) spin += 1;
  if (keys.spinRight) spin -= 1;

  if (ctx.grounded) {
    const want = clamp(turn + spin, -1, 1) * S.steer * (1 - (1 - S.steerAtMax) * fast);
    st.yawRate += (want - st.yawRate) * Math.min(1, S.steerLag * dt);
    yaw += st.yawRate * dt;
    st.air = 0;
  } else {
    // in the air the skis have nothing to bite, so the bars only bank you a
    // little; the arrows are the trick handles, such as they are
    st.yawRate += (0 - st.yawRate) * Math.min(1, S.steerLag * dt);
    yaw += turn * S.airSteer * dt + spin * S.spinTorque * dt;
    st.air += dt;
  }
  st.steerVis += (clamp(turn + spin, -1, 1) - st.steerVis) * Math.min(1, 8 * dt);

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // along the machine
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // across it

  const throttle = keys.forward ? 1 : 0;
  st.throttle = throttle;
  // S is the brake. SHIFT is not: boost.js has it, and the velocity it adds has
  // already been written by the time we get here — all we see is `ctx.thrust`.
  const braking = !!keys.back;
  const boosting = !!ctx.thrust;
  st.boost = boosting;

  if (ctx.grounded) {
    const n = ctx.normal;
    let nh = 0, fallX = 0, fallZ = 0, gravA = 0;

    // ---- fall line, exactly as the skis compute it
    if (n) {
      nh = Math.hypot(n.x, n.z);                    // = sinθ for a unit normal
      if (nh > 1e-4) {
        fallX = n.x / nh; fallZ = n.z / nh;         // points downhill
        gravA = ctx.gravity * Math.min(1, nh) * S.slopeAccel;
        vel.x += fallX * gravA * dt;
        vel.z += fallZ * gravA * dt;
      }
    }

    let vf = vel.x * fx + vel.z * fz;
    let vr = vel.x * rx + vel.z * rz;

    // ---- traction. How squarely are we pointed uphill (1 = straight up the
    // fall line), and how much of the drive does that cost us on this pitch?
    const climb = nh > 1e-4 ? clamp01(-(fx * fallX + fz * fallZ)) : 0;
    const slip = climb * clamp01((nh - S.climbSlip0) / (S.climbSlipSpan || 1));
    const bite = 1 - slip;                          // what the track still holds
    st.climb = climb; st.slip = slip;

    // ---- drive: throttle, tapered toward driveTop and cut by the slip, plus
    // the grade compensation. `assist` gives back a fixed share of the gravity
    // the machine is actually fighting — climb·gravA is the along-the-machine
    // component of the fall-line term applied above — so it is exactly zero on
    // the flat, zero pointed downhill, zero across the hill, and it goes away
    // with the bite on a face too steep to hold. What it buys is a climb whose
    // speed is set by the engine rather than by the pitch.
    let drive = 0, assist = 0;
    if (throttle && !braking) {
      const taper = Math.max(S.driveFloor, 1 - Math.max(0, vf) / S.driveTop);
      drive = S.driveAccel * taper * bite;
      assist = S.climbAssist * bite * climb * gravA;
      vf += (drive + assist) * dt;
    }
    st.drive = drive + assist;
    st.assist = assist;

    // ---- brake / reverse. S brakes while you are rolling forward and backs
    // you out once you have stopped; SHIFT is brake only.
    st.reverse = false;
    if (braking) {
      if (vf > 0.25 * (S.landMin / 5)) {            // still rolling forward
        vf = Math.max(0, vf - S.brake * dt);
      } else {
        st.reverse = true;
        vf = Math.max(-S.reverseMax, vf - S.reverseAccel * dt);
      }
    }

    // ---- skis and track bite sideways, the same exponential bleed as edges
    let g = S.grip * (1 - (1 - S.gripAtMax) * fast);
    // a track that is spinning is not holding a line either: on a face steep
    // enough to slip, throttle costs you sideways bite too, so the machine
    // washes out and slides instead of simply stopping. Zero everywhere else —
    // slip is zero on the flat, downhill, across the hill and off the throttle.
    if (throttle && !braking && slip > 0) g *= 1 - S.climbSpinGrip * slip;
    const keep = Math.exp(-g * dt);
    const scrub = Math.abs(vr) * (1 - keep);
    vr *= keep;
    if (!braking && vf > 0.5) vf += scrub * S.carveRecover;

    // ---- resistance
    const sp = Math.hypot(vf, vr);
    if (sp > 1e-5) {
      // under thrust the machine is being driven far past what it was geared
      // for, and it is this drag — not the motor's own cap — that decides where
      // a boosted sled tops out on snow
      const dec = (S.rollFriction + (boosting ? S.boostDrag : S.dragQuad) * sp * sp) * dt;
      const k = Math.max(0, sp - dec) / sp;
      vf *= k; vr *= k;
    }

    vel.x = fx * vf + rx * vr;
    vel.z = fz * vf + rz * vr;
    st.vf = vf;
  } else if (sp0 > 1e-5) {
    const k = Math.max(0, sp0 - S.airDrag * sp0 * sp0 * dt) / sp0;
    vel.x *= k; vel.z *= k;
    st.vf = vel.x * fx + vel.z * fz;
    st.drive = 0; st.assist = 0; st.climb = 0; st.slip = 0; st.reverse = false;
  }

  // ---- the ceiling. Normally maxSpeed; the booster raises it, and afterwards
  // it closes at boostCeilFall rather than snapping, so releasing at 50 m/s is a
  // long coast down instead of 20 m/s deleted in one frame. (Drag usually beats
  // the ceiling down anyway — it only matters on a steep descent.)
  st.ceil = boosting
    ? S.boostMaxSpeed
    : Math.max(S.maxSpeed, (st.ceil || S.maxSpeed) - S.boostCeilFall * dt);
  const sp = Math.hypot(vel.x, vel.z);
  if (sp > st.ceil) {
    const k = st.ceil / sp;
    vel.x *= k; vel.z *= k;
  }
  st.speed = sp;
  st.yaw = yaw;
  // the belt runs with the machine (renderer only)
  st.track = (st.track + st.vf * dt * 1.6) % 1000;

  // ---- suspension comes back up
  st.squash += (0 - st.squash) * Math.min(1, S.squashRecover * dt);

  // ---- camera bank, from the lateral load actually being carried
  const load = vel.x * rx + vel.z * rz;
  const want = clamp(-load * S.rollPerLateral, -S.maxRoll, S.maxRoll);
  const lean = ctx.lean + (want - ctx.lean) * Math.min(1, S.rollRate * dt);

  return { yaw, lean, crouch: st.squash };
}

// Contact with the ground. Two jobs: convert some of the impact into speed down
// the fall line (an aligned landing on a pitch should send you on), and load the
// suspension so the arrival reads as travel being used.
export function snowmobileLand(vel, impact, normal, S) {
  st.air = 0;
  st.squash = clamp01(Math.max(st.squash, impact * S.landSquash));
  if (!normal || impact < S.landMin) return;
  const nh = Math.hypot(normal.x, normal.z);
  const sp = Math.hypot(vel.x, vel.z);

  // landing sideways at speed costs you: the skis are pointed one way and 400 kg
  // is going another, and the snow settles the argument
  if (sp > 1e-4) {
    const velYaw = Math.atan2(-vel.x, -vel.z);
    let d = velYaw - st.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.9) {
      const k = S.landScrubMisalign;
      vel.x *= k; vel.z *= k;
      return;
    }
  }
  if (nh < 1e-4) return;
  const add = Math.min(impact, 30) * S.landBoost * Math.min(1, nh);
  vel.x += (normal.x / nh) * add;
  vel.z += (normal.z / nh) * add;
}

// ======================================================== THE SNOWMOBILE RACK
//
// Data, exactly like the ski and bike racks: the physics reads `tune` and
// nothing else, the visuals read `look` / `geo`, the locker reads the derived
// stats. One entry today, structured so the next ones are one object each.
//
// `lab-sled-machine` overrides NOTHING, so the numbers documented above are the
// numbers that run.

export const SNOWMOBILE_MODELS = [
  {
    id: 'lab-sno-1', name: pick('Lab Sno-1', 'Patrol Sno-1'), brand: BRAND,
    disc: 'trail sled', group: 'lab',
    blurb: 'Six hundred cc of house-built trail machine in lab orange, geared for a mountain that is mostly uphill. Takes a thirty-degree face at twenty metres a second, spins its track out somewhere past forty, reverses out of whatever it could not climb, and weighs enough that corners are a decision you make early.',
    look: {
      body: '#ff4d00', ink: '#17161a', accent: '#f4f1ea', trim: '#2f3237',
      glass: '#a9c6d8', pattern: 'lab',
    },
    spec: {
      engine: '600 cc twin', track: '381 × 3800 mm', ski: '2 × front',
      mass: '218 kg', suspension: '300 mm rear travel',
    },
    geo: { len: 2.55, width: 1.06, seatH: 0.78, barH: 1.06, skiSpread: 0.52 },
    tune: {},
  },
];

export const SNOWMOBILE_BY_ID = Object.fromEntries(SNOWMOBILE_MODELS.map((m) => [m.id, m]));
export const SNOWMOBILE_DEFAULT = 'lab-sno-1';

export function getSnowmobileModel(id) {
  return SNOWMOBILE_BY_ID[id] || SNOWMOBILE_BY_ID[SNOWMOBILE_DEFAULT];
}

export function snowmobileTuningFor(id, u = 1) {
  return scaleSnowmobileTuning(u, getSnowmobileModel(id).tune);
}

// The steepest slope this machine can actually drive up, in degrees, solved
// from the same three numbers the step uses. The locker quotes it, and the
// tests check it — which means the card cannot lie about the one thing that
// makes this gear different from every other one.
export function climbLimitDeg(T) {
  for (let d = 60; d >= 0; d -= 0.1) {
    const s = Math.sin(d * Math.PI / 180);
    const slip = clamp01((s - T.climbSlip0) / (T.climbSlipSpan || 1));
    const bite = 1 - slip;
    const grav = 16 * s * T.slopeAccel;             // controller gravity is 16
    // low speed: the taper is ~1, so this is thrust plus grade compensation
    // against gravity and the track's own friction
    const push = T.driveAccel * bite + T.climbAssist * bite * grav;
    if (push > grav + T.rollFriction) return d;
  }
  return 0;
}

// ---- the four bars in the locker, derived from the numbers rather than authored
export function snowmobileStats(m) {
  const T = { ...SNOWMOBILE_TUNING, ...(m.tune || {}) };
  // powered terminal on the flat: drive taper balanced against the drag
  let term = 0;
  for (let v = 0; v <= T.maxSpeed; v += 0.1) {
    const drive = T.driveAccel * Math.max(T.driveFloor, 1 - v / T.driveTop);
    if (drive <= T.rollFriction + T.dragQuad * v * v) { term = v; break; }
    term = v;
  }
  return {
    turn: clamp01(T.steer / 4.0) * clamp01(1 - (T.steerLag < 8 ? 0.25 : 0)),
    speed: clamp01((term - 8) / 22),
    stab: clamp01(0.45 + T.wipeTol * 0.9 + 0.2 * clamp01(T.gripAtMax)),
    pop: clamp01(clamp01((T.popMul - 0.4) / 0.9) * 0.6 + clamp01(T.spinTorque / 12) * 0.4),
    // raw numbers the detail strip quotes
    term, climbDeg: climbLimitDeg(T), driveAccel: T.driveAccel,
    reverseMax: T.reverseMax, brake: T.brake, steer: T.steer, popMul: T.popMul,
  };
}
for (const m of SNOWMOBILE_MODELS) m.stats = snowmobileStats(m);

// ---- which machine you are on. ?snowmobile=<id> beats the remembered pick
// beats the house machine; a URL override is not written back to storage.
const LS_KEY = 'poi-lab.play.snowmobile';
export function resolveSnowmobileId(qs) {
  const q = qs && qs.get ? qs.get('snowmobile') : null;
  if (q && SNOWMOBILE_BY_ID[q]) return q;
  try { const s = localStorage.getItem(LS_KEY); if (s && SNOWMOBILE_BY_ID[s]) return s; } catch { /* private mode */ }
  return SNOWMOBILE_DEFAULT;
}
export function rememberSnowmobileId(id) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
}

// ================================================================ the livery
// A 512×256 panel laid along both flanks of the tunnel and across the hood: the
// machine's number, a swept flash and the lab wordmark. Cached per model id,
// deterministic canvas 2D, nothing loaded at runtime.

const _liveries = new Map(), _thumbs = new Map();
const SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';

function drawTracked(x, s, cx, cy, size, track, colour, align = 'center') {
  x.font = `800 ${size}px ${SANS}`;
  let w = -track;
  for (const ch of s) w += x.measureText(ch).width + track;
  let px = align === 'left' ? cx : cx - w / 2;
  x.fillStyle = colour;
  x.textBaseline = 'middle';
  for (const ch of s) { x.fillText(ch, px, cy); px += x.measureText(ch).width + track; }
  return w;
}

const LIVERY = {
  lab(x, W, H, L) {
    x.fillStyle = L.body;
    x.fillRect(0, 0, W, H);

    // the flash: one swept dark wedge running back from the nose, the shape
    // every trail sled in the world has had since about 1998
    x.fillStyle = L.ink;
    x.beginPath();
    x.moveTo(0, H * 0.30);
    x.lineTo(W * 0.62, H * 0.06);
    x.lineTo(W * 0.98, H * 0.20);
    x.lineTo(W, H * 0.62);
    x.lineTo(W * 0.30, H * 0.86);
    x.lineTo(0, H * 0.74);
    x.closePath();
    x.fill();

    // a cream hairline riding the top edge of the wedge
    x.strokeStyle = L.accent;
    x.lineWidth = 5;
    x.beginPath();
    x.moveTo(0, H * 0.34);
    x.lineTo(W * 0.62, H * 0.10);
    x.lineTo(W * 0.98, H * 0.24);
    x.stroke();

    // the number, big, on the flank
    drawTracked(x, '07', W * 0.20, H * 0.50, 96, 6, L.body);
    // and the wordmark behind it
    drawTracked(x, BRAND, W * 0.62, H * 0.46, 42, 10, L.accent);   // painted on the cowl
    drawTracked(x, 'SNO-1', W * 0.62, H * 0.66, 22, 8, L.body);

    // vent louvres at the tail
    x.fillStyle = 'rgba(23,22,26,.55)';
    for (let i = 0; i < 5; i++) x.fillRect(W * 0.06 + i * 14, H * 0.90, 8, H * 0.07);
  },
};

function paintLivery(m) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  (LIVERY[m.look.pattern] || LIVERY.lab)(x, 512, 256, m.look);
  return c;
}

export function snowmobileLivery(m) {
  const model = typeof m === 'string' ? getSnowmobileModel(m) : m;
  if (!_liveries.has(model.id)) _liveries.set(model.id, paintLivery(model));
  return _liveries.get(model.id);
}

// ---- the locker thumbnail: a side view drawn from the same geo the rig uses,
// nose to the right, so the card and the machine agree about its proportions.
function paintThumb(m) {
  const W = 300, H = 120;
  const c = document.createElement('canvas');
  const L = m.look;
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const ground = H - 16;
  const sc = (W - 40) / m.geo.len;                  // px per metre

  // ---- track and rear suspension
  x.fillStyle = L.ink;
  x.beginPath();
  x.roundRect(26, ground - 26, sc * 1.30, 26, 8);
  x.fill();
  x.strokeStyle = 'rgba(244,241,234,.35)';
  x.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const px = 32 + i * (sc * 1.30 - 12) / 8;
    x.beginPath(); x.moveTo(px, ground - 25); x.lineTo(px, ground - 1); x.stroke();
  }

  // ---- tunnel + hood, carrying the livery
  x.save();
  x.beginPath();
  x.moveTo(26, ground - 26);
  x.lineTo(26, ground - 46);
  x.lineTo(sc * 1.05, ground - 52);                 // seat top
  x.lineTo(sc * 1.55, ground - 44);
  x.quadraticCurveTo(sc * 2.05, ground - 42, sc * 2.12, ground - 20);
  x.lineTo(sc * 1.75, ground - 14);
  x.lineTo(26, ground - 20);
  x.closePath();
  x.clip();
  x.drawImage(snowmobileLivery(m), 16, ground - 58, W - 20, 52);
  x.restore();

  // ---- windshield + bars
  x.strokeStyle = L.glass;
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(sc * 1.62, ground - 46);
  x.quadraticCurveTo(sc * 1.80, ground - 78, sc * 1.98, ground - 74);
  x.stroke();
  x.strokeStyle = L.ink;
  x.lineWidth = 3.5;
  x.beginPath();
  x.moveTo(sc * 1.42, ground - 52);
  x.lineTo(sc * 1.56, ground - 74);
  x.stroke();
  x.beginPath();
  x.arc(sc * 1.56, ground - 74, 5, 0, Math.PI * 2);
  x.fill();

  // ---- front ski
  x.fillStyle = L.accent;
  x.beginPath();
  x.moveTo(sc * 1.66, ground - 2);
  x.lineTo(sc * 2.28, ground - 2);
  x.quadraticCurveTo(sc * 2.42, ground - 4, sc * 2.36, ground - 18);
  x.lineTo(sc * 2.26, ground - 17);
  x.quadraticCurveTo(sc * 2.30, ground - 7, sc * 1.66, ground - 8);
  x.closePath();
  x.fill();
  // the strut down to it
  x.strokeStyle = L.trim;
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(sc * 1.92, ground - 24);
  x.lineTo(sc * 2.02, ground - 6);
  x.stroke();

  return c;
}

export function snowmobileThumbURL(m) {
  const model = typeof m === 'string' ? getSnowmobileModel(m) : m;
  if (!_thumbs.has(model.id)) _thumbs.set(model.id, paintThumb(model).toDataURL('image/png'));
  return _thumbs.get(model.id);
}

// =========================================================== the 3D machine
// Origin is the FEET — the same frame every body part in main.js uses — with
// -Z forward, so the rig drops into the third-person model group unchanged.
// Chunky low-poly boxes plus the livery texture, in the language of the ski and
// bike rigs: a tunnel, a track under it, twin front skis on struts, a cowl, a
// windshield and a bar.

const _rigs = new WeakMap();
const lamb = (THREE, c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
const hexDim = (hex, k) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return (r << 16) | (g << 8) | b;
};

const _liveryTex = new Map();
function liveryTexture(THREE, m) {
  const key = m.id;
  if (!_liveryTex.has(key)) {
    const t = new THREE.CanvasTexture(snowmobileLivery(m));
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    _liveryTex.set(key, t);
  }
  return _liveryTex.get(key);
}

// one front ski, origin at its own pivot, running down -Z with a curled tip
function makeSki(THREE, u, mat, hard) {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.16 * u, 0.035 * u, 1.02 * u), mat);
  deck.position.set(0, 0.03 * u, -0.06 * u);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.15 * u, 0.032 * u, 0.24 * u), mat);
  tip.position.set(0, 0.10 * u, -0.62 * u);
  tip.rotation.x = 0.62;
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.035 * u, 0.045 * u, 0.80 * u), hard);
  keel.position.set(0, 0.005 * u, -0.06 * u);
  g.add(deck, tip, keel);
  return g;
}

// The rider: up off the seat, knees bent on the running boards, hands on the
// bars, torso pitched forward — the way anyone rides one of these anywhere
// worth riding it. Same palette as the skier in main.js.
function buildRider(THREE, u, G) {
  const jacket = lamb(THREE, 0xff4d00, 0x7a2500);
  const dark = lamb(THREE, 0x26231f, 0x12110f);
  const cream = lamb(THREE, 0xf4f1ea, 0x6b675f);
  const boot = lamb(THREE, 0x17161a, 0x0b0a09);
  const g = new THREE.Group();

  const footY = 0.30, hipY = footY + 0.62, shoY = hipY + 0.44;
  const hipZ = 0.30, shoZ = 0.10, handZ = -0.30, handY = G.barH;

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34 * u, 0.20 * u, 0.30 * u), dark);
  hips.position.set(0, hipY * u, hipZ * u);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.40 * u, 0.52 * u, 0.26 * u), jacket);
  torso.position.set(0, (hipY + 0.26) * u, (hipZ - 0.10) * u);
  torso.rotation.x = 0.42;                          // pitched forward over the bars
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145 * u, 10, 8), cream);
  head.position.set(0, (shoY + 0.20) * u, (shoZ - 0.14) * u);
  g.add(hips, torso, head);

  for (const side of [-1, 1]) {
    // legs: knees bent, boots on the running boards either side of the tunnel
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15 * u, 0.15 * u, 0.42 * u), dark);
    thigh.position.set(side * 0.14 * u, (hipY - 0.14) * u, (hipZ - 0.06) * u);
    thigh.rotation.x = 0.85;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14 * u, 0.42 * u, 0.15 * u), dark);
    shin.position.set(side * 0.20 * u, (footY + 0.22) * u, (hipZ + 0.08) * u);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(0.15 * u, 0.10 * u, 0.30 * u), boot);
    bt.position.set(side * 0.21 * u, footY * u, (hipZ + 0.10) * u);
    // arms: shoulders to the grips
    const sho = [side * 0.21, shoY, shoZ], hand = [side * 0.30, handY, handZ];
    const d = [hand[0] - sho[0], hand[1] - sho[1], hand[2] - sho[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.10 * u, len * u), jacket);
    arm.position.set((sho[0] + hand[0]) / 2 * u, (sho[1] + hand[1]) / 2 * u, (sho[2] + hand[2]) / 2 * u);
    arm.rotation.order = 'YXZ';
    arm.rotation.y = Math.atan2(-d[0], -d[2]);
    arm.rotation.x = Math.asin(Math.max(-1, Math.min(1, d[1] / (len || 1))));
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11 * u, 0.11 * u, 0.12 * u), cream);
    glove.position.set(hand[0] * u, hand[1] * u, hand[2] * u);
    g.add(thigh, shin, bt, arm, glove);
  }
  return g;
}

export function makeSnowmobileRig(THREE, u = 1, opts = {}) {
  const model = getSnowmobileModel(opts.model);
  const G = model.geo;
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, emissive: hexDim(model.look.body, 0.40), map: liveryTexture(THREE, model),
  });
  const hard = lamb(THREE, 0x17161a, 0x0b0a09);
  const trim = lamb(THREE, 0x2f3237, 0x141618);
  const steel = lamb(THREE, 0x9aa0a6, 0x3d4045);
  const glass = new THREE.MeshLambertMaterial({
    color: 0xa9c6d8, emissive: 0x2d4250, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
  });

  const chassis = new THREE.Group();

  // ---- the tunnel: the long box everything else is bolted to
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.60 * u, 0.30 * u, 1.55 * u), bodyMat);
  tunnel.position.set(0, 0.50 * u, 0.42 * u);
  chassis.add(tunnel);

  // ---- the track: a dark box under the tunnel with bogie wheels and cleats
  const track = new THREE.Mesh(new THREE.BoxGeometry(0.48 * u, 0.26 * u, 1.62 * u), hard);
  track.position.set(0, 0.17 * u, 0.44 * u);
  chassis.add(track);
  for (let i = 0; i < 5; i++) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.50 * u, 0.03 * u, 0.06 * u), trim);
    cleat.position.set(0, 0.045 * u, (-0.24 + i * 0.34) * u);
    chassis.add(cleat);
  }
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.16 * u, 0.035 * u, 0.86 * u), trim);
    board.position.set(side * 0.35 * u, 0.30 * u, 0.46 * u);
    chassis.add(board);
  }

  // ---- seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42 * u, 0.20 * u, 0.86 * u), hard);
  seat.position.set(0, 0.74 * u, 0.56 * u);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42 * u, 0.26 * u, 0.12 * u), hard);
  back.position.set(0, 0.86 * u, 1.02 * u);
  chassis.add(seat, back);

  // ---- the cowl: hood over the engine, tapering forward and down
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.66 * u, 0.42 * u, 0.72 * u), bodyMat);
  hood.position.set(0, 0.60 * u, -0.48 * u);
  hood.rotation.x = -0.16;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.52 * u, 0.24 * u, 0.34 * u), bodyMat);
  nose.position.set(0, 0.44 * u, -0.92 * u);
  nose.rotation.x = -0.30;
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * u, 0.028 * u, 0.46 * u, 6), steel);
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(0, 0.34 * u, -1.06 * u);
  chassis.add(hood, nose, bumper);

  // ---- windshield and bar
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.50 * u, 0.34 * u, 0.02 * u), glass);
  shield.position.set(0, 0.98 * u, -0.30 * u);
  shield.rotation.x = 0.34;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * u, 0.03 * u, 0.34 * u, 6), trim);
  post.position.set(0, 0.90 * u, -0.24 * u);
  post.rotation.x = -0.25;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * u, 0.024 * u, 0.66 * u, 6), hard);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, G.barH * u, -0.30 * u);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032 * u, 0.032 * u, 0.14 * u, 6), trim);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.28 * u, G.barH * u, -0.30 * u);
    chassis.add(grip);
  }
  chassis.add(shield, post, bar);

  // ---- twin front skis, each on its own pivot so the pair can steer, with the
  // A-arm drawn in CHASSIS space (a strut that turned with the ski would read
  // as a broken suspension the first time you countersteered)
  const skis = [];
  const skiMat = lamb(THREE, 0xf4f1ea, 0x6b675f);
  for (const side of [-1, 1]) {
    const hubX = side * (G.skiSpread / 2), hubZ = -0.86;
    const pivot = new THREE.Group();
    pivot.position.set(hubX * u, 0, hubZ * u);
    pivot.add(makeSki(THREE, u, skiMat, hard));
    skis.push(pivot);

    const a = [side * 0.16, 0.46, -0.60];           // where it hangs off the chassis
    const b = [hubX, 0.10, hubZ];                   // the ski's own hub
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const armM = new THREE.Mesh(new THREE.BoxGeometry(0.05 * u, 0.05 * u, len * u), trim);
    armM.position.set((a[0] + b[0]) / 2 * u, (a[1] + b[1]) / 2 * u, (a[2] + b[2]) / 2 * u);
    armM.rotation.order = 'YXZ';
    armM.rotation.y = Math.atan2(-d[0], -d[2]);
    armM.rotation.x = Math.asin(Math.max(-1, Math.min(1, d[1] / (len || 1))));
    chassis.add(pivot, armM);
  }

  g.add(chassis);
  if (opts.rider !== false) g.add(buildRider(THREE, u, G));

  _rigs.set(g, { chassis, skis, bodyMat, u });
  return g;
}

export function styleSnowmobileRig(THREE, rig, m) {
  const r = _rigs.get(rig);
  if (!r) return;
  const model = typeof m === 'string' ? getSnowmobileModel(m) : (m || getSnowmobileModel(SNOWMOBILE_DEFAULT));
  r.bodyMat.map = liveryTexture(THREE, model);
  r.bodyMat.emissive.setHex(hexDim(model.look.body, 0.40));
  r.bodyMat.needsUpdate = true;
}

// The renderer's half of the machine: the front skis turn with the bars and the
// whole chassis squats on the suspension. Both numbers come from the module
// state above, so main.js asks for a pose and never has to know how the
// numbers were arrived at — the deal rollSkiRigs makes.
export function poseSnowmobileRig(rig, k = 1) {
  const r = _rigs.get(rig);
  if (!r || !r.chassis) return 0;                 // no-op on the first-person rig
  const turn = st.steerVis * 0.42 * k;
  for (const s of r.skis) s.rotation.y = turn;
  r.chassis.position.y = -0.10 * r.u * st.squash;
  r.chassis.rotation.x = -0.05 * st.squash;
  return turn;
}

// First person: hands, bars, the top of the windshield and the two ski tips out
// ahead. Mounted on the camera, at hood height rather than at its true position
// — the whole machine sits below a level 72° gaze, exactly as a bike does, so
// the grips are placed just inside the bottom of the frame and the rest hangs
// off them.
export function makeSnowmobileFP(THREE, u = 1, m) {
  const model = typeof m === 'string' ? getSnowmobileModel(m) : (m || getSnowmobileModel(SNOWMOBILE_DEFAULT));
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, emissive: hexDim(model.look.body, 0.5), map: liveryTexture(THREE, model),
  });
  const hard = lamb(THREE, 0x1c1b1f, 0x0e0d10);
  const trim = lamb(THREE, 0x3a3d42, 0x1b1d20);
  const cream = lamb(THREE, 0xf4f1ea, 0x8a877f);
  const jacket = lamb(THREE, 0xff4d00, 0x8a2c00);
  const glass = new THREE.MeshLambertMaterial({
    color: 0xa9c6d8, emissive: 0x3a5464, transparent: true, opacity: 0.30, side: THREE.DoubleSide,
  });

  const BAR = { y: -0.34, z: -0.72 };

  // ---- the bar, its grips and your gloves on them
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.026 * u, 0.026 * u, 0.72 * u, 8), hard);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, BAR.y * u, BAR.z * u);
  g.add(bar);
  // The gloves go ON the grips and the sleeves stop there. Everything in a
  // first-person rig is a question of how much of the frame a box eats: the
  // first pass had 12 cm fists 50 cm from the lens and they read as two orange
  // walls in the bottom corners, wider on screen than the machine itself.
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032 * u, 0.032 * u, 0.15 * u, 8), trim);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.30 * u, BAR.y * u, BAR.z * u);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.10 * u, 0.12 * u), cream);
    glove.position.set(side * 0.30 * u, (BAR.y + 0.01) * u, (BAR.z + 0.01) * u);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.095 * u, 0.095 * u, 0.16 * u), jacket);
    cuff.position.set(side * 0.305 * u, (BAR.y + 0.015) * u, (BAR.z + 0.16) * u);
    g.add(grip, glove, cuff);
  }

  // ---- the hood in front of the bars, and the windshield standing off it.
  // Pushed further out and cut down: at 1.34 m a 0.78 m hood put the livery
  // across a third of the screen, which is a decal you read rather than a
  // machine you sit on.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.68 * u, 0.30 * u, 0.72 * u), bodyMat);
  hood.position.set(0, -0.74 * u, -1.62 * u);
  hood.rotation.x = -0.20;
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.56 * u, 0.34 * u, 0.02 * u), glass);
  shield.position.set(0, -0.40 * u, -1.24 * u);
  shield.rotation.x = 0.32;
  g.add(hood, shield);

  // ---- the two front skis, out ahead and angled in, with their tips curled.
  // Narrow, because a ski seen from behind is a line, not a plank.
  for (const side of [-1, 1]) {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.15 * u, 0.04 * u, 0.78 * u), bodyMat);
    ski.position.set(side * 0.48 * u, -1.12 * u, -2.35 * u);
    ski.rotation.y = side * 0.03;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14 * u, 0.035 * u, 0.26 * u), bodyMat);
    tip.position.set(side * 0.48 * u, -1.04 * u, -2.78 * u);
    tip.rotation.x = 0.6;
    // the strut each one hangs from, so they are attached to something
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05 * u, 0.34 * u, 0.05 * u), trim);
    leg.position.set(side * 0.48 * u, -0.94 * u, -2.20 * u);
    g.add(ski, tip, leg);
  }

  g.frustumCulled = false;
  // registered like the third-person rig (minus a chassis to squat) so one call
  // to styleSnowmobileRig repaints whichever of the two you hand it
  _rigs.set(g, { chassis: null, skis: [], bodyMat, u });
  return g;
}
