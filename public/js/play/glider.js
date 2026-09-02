// Aang's glider. A point-mass sailplane — arcade-honest, not a simulator.
//
// Unlike skis and the bike, this gear does nothing on the ground: the registry
// entry sets `footed`, so while your feet are down the controller runs the plain
// boots walk. Leave the ground (jump, or run off a lip) and this takes over the
// whole velocity vector, Y included.
//
// Five ideas, and every satisfying thing the glider does falls out of them:
//
//   1. AIRSPEED ⇄ ALTITUDE. Gravity is applied by the controller to vel.y, which
//      for a 3D velocity is exactly right: point the nose down and the component
//      of gravity along the flight path speeds you up; point it up and it slows
//      you down while you climb. We never add or remove energy for that trade —
//      it is just gravity acting on a velocity that has a direction.
//   2. LIFT ∝ AIRSPEED². Lift acts perpendicular to the flight path, and its
//      size is `g · (v/vTrim)² · cl`. At v = vTrim with the wing trimmed
//      (cl = 1) it exactly balances gravity, which is what "trim speed" means.
//      cl comes from angle of attack: the difference between where the nose
//      points (your look pitch) and where you are actually going. Pull the nose
//      above the flight path and the wing bites harder — that is the pull-up.
//   3. DRAG SETS BOTH ENDS. A small constant + a profile term (v²) + induced
//      drag (∝ L²/v², so hard turns and hard pull-ups cost speed) fix the cruise
//      sink at ~1.5 m/s. A separate knee above `vSoft` — the airframe starting
//      to complain — is what stops a dive at ~30 m/s instead of 60; plain
//      quadratic drag cannot give a 10:1 glide AND a sane terminal at the same
//      time under this game's 16 m/s² gravity.
//   4. BANK, NOT YAW. The mouse does not turn the glider. It sets where you WANT
//      to be going; the error between that and your actual track commands a bank
//      angle, the bank rolls in over ~0.3 s, and the tilted lift vector is what
//      carves the turn. So every turn has roll-lag on the way in and a real
//      radius, and the tighter you bank the more speed the induced drag eats.
//   5. RIDGE LIFT. Terrain is sampled under you and one probe-length ahead along
//      your track. Ground rising ahead, close enough below you, is an air mass
//      moving up: it enters as `wAir` and every aerodynamic quantity is computed
//      against velocity RELATIVE to that air. Steady state is then
//      `wAir − sink`, so a face steep enough beats the 1.5 m/s sink and you
//      climb. Getting more than a few m/s of it means flying close to the rock.
//
// The stall is deliberately a speed rule rather than an AoA rule: below
// `stallSpeed` the lift fades out and the nose sags, you fall, the fall buys
// back airspeed, and the wing catches. Mushy, and always recoverable by pointing
// down.

import { BRAND, pick } from './flags.js';

export const GLIDER_TUNING = {
  // ---- envelope
  maxSpeed: 32,          // m/s — hard 3D backstop; drag normally caps you below
  vTrim: 16,             // m/s — trimmed lift equals gravity here (cruise)
  gLimit: 4.0,           // × gravity — structural cap on lift, keeps pull-ups sane
  stallSpeed: 6.0,       // m/s — below this the wing quits
  stallFade: 2.2,        // m/s — band above stallSpeed over which lift comes back
  stallSag: 0.55,        // rad — nose-down the wing takes on its own while stalled

  // ---- the wing
  alphaGain: 3.2,        // dcl/dα (1/rad) around the trimmed cl = 1
  alphaMax: 0.42,        // rad (~24°) — the buffet; you cannot ask for more
  alphaMin: -0.40,       // rad — push-over limit
  clMax: 2.4,            // lift coefficient ceiling
  clMin: -0.35,          // negative lift when you shove the nose down
  noseMax: 1.15,         // rad (~66°) — pitch command clamp
  noseAssist: 0.30,      // rad — W (nose down) / S (nose up) trim on the look pitch

  // ---- drag
  dragBase: 0.20,        // m/s² — parasitic
  dragQuad: 0.0030,      // 1/m — profile drag
  dragInduced: 0.55,     // m/s² — induced drag AT TRIM; scales as (L/g)²·(vTrim/v)²
  vSoft: 20,             // m/s — above here the airframe starts to complain
  dragOver: 0.11,        // 1/m — high-speed knee; sets the ~30 m/s dive terminal

  // ---- bank and turn
  bankMax: 1.15,         // rad (~66°) — bank ceiling
  bankPerErr: 2.4,       // rad of bank commanded per rad of heading error
  bankKeys: 0.85,        // rad of bank A / D add on top
  rollRate: 3.4,         // 1/s — roll-lag; τ ≈ 0.3 s to the commanded bank
  rollSpin: 7.0,         // rad/s — ← → barrel roll (a full turn in ~0.9 s)
  rollRecover: 3.0,      // 1/s — how fast a barrel roll unwinds when you let go
  rollVisual: 0.55,      // share of the wing's bank the camera actually takes

  // ---- ridge / slope lift
  ridgeProbe: 14,        // m ahead along the track the terrain is sampled
  ridgeRange: 45,        // m AGL over which slope lift decays to nothing
  ridgeGain: 0.55,       // share of (groundspeed × upslope) that becomes updraft
  ridgeMaxSlope: 1.0,    // dh/m cap on the sampled rise (45°)
  ridgeMax: 9.0,         // m/s cap on the updraft

  // ---- ground skim
  skimHeight: 2.2,       // m AGL where the ground-effect cushion starts
  skimLift: 0.35,        // extra share of cl at zero AGL
  skimSpeed: 8.0,        // m/s — below this a skim is just a landing

  // ---- flare and touchdown
  flareAlpha: 0.30,      // rad extra AoA while SPACE is held airborne
  flareDrag: 3.2,        // m/s² extra drag while flaring
  landVy: 6.5,           // m/s — sinking faster than this on contact = wipe
  landSpeed: 13.0,       // m/s — horizontal faster than this on contact = wipe
  landSteep: 0.62,       // sinθ above which the surface is a wall, not a field
  landScrub: 0.55,       // fraction of horizontal speed kept on a clean touchdown
  landRun: 9.0,          // m/s — hardest you can be running when you stand up

  // ---- contract parity
  maxRoll: 1.15,         // rad — camera bank cap (main.js multiplies lean)
  landMin: 3.0,          // m/s — unused; judgeWipe owns the landing verdict
  snapMul: 1.0,          // × (speed·dt) — never reached: footed gears land once
};

// Lengths / speeds / accelerations scale with the scene's unit; rates (1/s),
// angles and pure ratios do not; the drag coefficients are 1/length.
export function scaleGliderTuning(u, over = {}) {
  const S = { ...GLIDER_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'vTrim', 'stallSpeed', 'stallFade', 'dragBase', 'dragInduced',
    'vSoft', 'ridgeProbe', 'ridgeRange', 'ridgeMax', 'skimHeight', 'skimSpeed',
    'flareDrag', 'landVy', 'landSpeed', 'landRun', 'landMin']) S[k] *= u;
  for (const k of ['dragQuad', 'dragOver']) S[k] /= u;
  return S;
}

// ======================================================== the glider rack
// The GLIDER is an equipment type, and like the skis it has a rack: two ways to
// stay off the ground, chosen in the locker's glider tab. They are ONE gear as
// far as the player is concerned — one row in the hold-E menu, one tab in the
// locker — and two different physics modules underneath, which is why each entry
// names the controller gear that flies it.
//
// The pair is deliberate. Both are boots on the ground and both own the whole
// velocity vector in the air; they differ in what pays for the flight. The wing
// pays with altitude and can soar a rising face forever. The pack pays with
// fuel and does not care what the terrain is doing.
export const GLIDER_MODELS = [
  {
    id: 'aang', gear: 'glider', name: "Aang's Glider", brand: 'AIR NOMAD',
    tag: 'sailplane', group: 'lab', glyph: 'wing', preview: 'wing',
    blurb: 'A staff first and a wing second. Nothing on the ground — you walk until your feet leave it, then the whole velocity vector is the wing\'s. Dive for speed, pull for height, and soar the rising faces.',
    stats: { turn: 0.34, speed: 0.72, stab: 0.80, pop: 0.30 },
    facts: [['trim', '16 m/s'], ['top speed', '32 m/s'], ['sink', '~1.5 m/s'], ['ridge lift', 'yes']],
  },
  {
    id: 'rocket-pack', gear: 'rocket', name: pick('Lab Rocket Pack', 'Alpine Rocket Pack'), brand: BRAND,
    tag: 'rocket pack', group: 'lab', glyph: 'rocket', preview: 'pack',
    blurb: 'Two tanks and one look-vector. On the ground you are simply wearing it — walk, sprint and jump are the boots you already know. Hold G and it throws you where you are aiming at 35 m/s² until the sky runs out around 100. Let go and there is no wing under you: burn back down the way you came, or arrive the way a falling body does.',
    stats: { turn: 0.90, speed: 1.00, stab: 0.28, pop: 1.00 },
    facts: [
      ['thrust', '35 m/s²'], ['top speed', '~100 m/s'], ['tank', '6.0 s'],
      ['refill', '1× real time'], ['wing', 'none'], ['landing', 'retro-burn under 16 m/s'],
    ],
  },
];
export const GLIDER_DEFAULT = 'aang';
const GLIDER_BY_ID = Object.fromEntries(GLIDER_MODELS.map((m) => [m.id, m]));
export function getGliderModel(id) { return GLIDER_BY_ID[id] || GLIDER_BY_ID[GLIDER_DEFAULT]; }
// which flight model is in the glider slot. ?glider=<id> beats the remembered
// pick beats the wing; a URL override is deliberately not written back.
const LS_GLIDER = 'poi-lab.play.glider';
export function resolveGliderId(qs) {
  const q = qs && qs.get ? qs.get('glider') : null;
  if (q && GLIDER_BY_ID[q]) return q;
  try { const s = localStorage.getItem(LS_GLIDER); if (s && GLIDER_BY_ID[s]) return s; } catch { /* private mode */ }
  return GLIDER_DEFAULT;
}
export function rememberGliderId(id) {
  try { localStorage.setItem(LS_GLIDER, id); } catch { /* private mode */ }
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const TWO_PI = Math.PI * 2;
const wrapPi = (a) => a - TWO_PI * Math.round(a / TWO_PI);

// Per-pilot memory between frames. One player per page, so module state — the
// same trade bike.js makes with its filtered slope.
const st = {
  roll: 0,        // rad — aerodynamic bank; + is left wing down, i.e. turning left
  rollFree: 0,    // rad — barrel-roll rotation, visual only (never tilts the lift)
  barrel: 0,      // rad of barrel roll banked toward the next stamp
  barrelN: 0,     // rolls stamped this air
  airT: 0,        // s since we left the ground
  // readouts — the HUD, the fx layer and the tests all pull these
  wAir: 0, agl: Infinity, v: 0, alpha: 0, cl: 0, stallK: 1,
  gamma: 0, nose: 0, flare: false, skim: 0,
};

export function gliderReset() {
  st.roll = 0; st.rollFree = 0; st.barrel = 0; st.barrelN = 0; st.airT = 0;
  stowed();
}

// The wing is folded away: nothing is flying, so nothing aerodynamic is true.
// Both ways down — a landing and a wipe — go through here, because a readout
// left frozen at the last airborne frame is a lie the HUD would happily print.
function stowed() {
  st.wAir = 0; st.agl = Infinity; st.v = 0; st.alpha = 0; st.cl = 0; st.stallK = 1;
  st.gamma = 0; st.nose = 0; st.flare = false; st.skim = 0;
}

// Live snapshot for the HUD / fx / tests. Copy it if you need to keep it.
export function gliderState() {
  return {
    airspeed: st.v, alpha: st.alpha, cl: st.cl, stall: 1 - st.stallK,
    updraft: st.wAir, agl: st.agl, roll: st.roll, spin: st.rollFree,
    gamma: st.gamma, nose: st.nose, flare: st.flare, skim: st.skim,
    airTime: st.airT, rolls: st.barrelN,
  };
}

// One step of glider dynamics. Mutates ctx.vel — ALL THREE components, unlike
// ski/bike — and returns { yaw, lean, trick? }. The controller still applies
// gravity to vel.y after this returns, which is where the airspeed/altitude
// trade actually happens.
//
// ctx: { vel, pos, yaw, pitch, keys, grounded, normal|null, gravity, dt, S,
//        lean, collision }
export function gliderStep(ctx) {
  const { vel, keys, dt, S, gravity } = ctx;
  const yaw = ctx.yaw;                       // the look is a command, never a torque

  // With `footed` set the controller runs the boots walk while your feet are
  // down and never calls us grounded, so in the shipped wiring this branch does
  // not run: it is here so the model stays correct if the flag is ever off.
  if (ctx.grounded) {
    st.airT = 0; st.barrel = 0; st.barrelN = 0;
    stowed();
    st.roll += (0 - st.roll) * Math.min(1, S.rollRate * dt);
    st.rollFree += (0 - st.rollFree) * Math.min(1, S.rollRecover * dt);
    return { yaw, lean: st.roll * S.rollVisual + st.rollFree };
  }
  st.airT += dt;

  // ------------------------------------------------------------- ridge lift
  // Terrain under us, and terrain one probe ahead along the track. Ground
  // rising ahead is an air mass going up; how much of it reaches the wing falls
  // off with height above ground, which is what keeps ridge soaring a
  // hug-the-rock game rather than a free altitude button.
  let wAir = 0, agl = Infinity;
  const col = ctx.collision, p = ctx.pos;
  const spH0 = Math.hypot(vel.x, vel.z);
  if (col && p) {
    const h0 = col.groundAt(p.x, p.z, p.y + 1);
    if (h0 !== null) {
      agl = p.y - h0;
      if (agl > -1 && agl < S.ridgeRange && spH0 > 0.5) {
        const d = S.ridgeProbe;
        const tx = vel.x / spH0, tz = vel.z / spH0;
        // look from high enough that a face climbing steeply ahead is not missed
        const h1 = col.groundAt(p.x + tx * d, p.z + tz * d, p.y + 1 + d);
        if (h1 !== null) {
          const rise = clamp((h1 - h0) / d, 0, S.ridgeMaxSlope);
          const near = clamp(1 - agl / S.ridgeRange, 0, 1);
          wAir = Math.min(S.ridgeMax, S.ridgeGain * rise * spH0 * near);
        }
      }
    }
  }
  st.wAir = wAir; st.agl = agl;

  // --------------------------------------------------------- the air we fly in
  // Everything aerodynamic is measured against the AIR, not the ground. That is
  // the whole trick behind ridge lift: the forces do not change, the frame does.
  const rvx = vel.x, rvy = vel.y - wAir, rvz = vel.z;
  let v = Math.hypot(rvx, rvy, rvz);
  if (v < 0.05) v = 0.05;
  const vhx = rvx / v, vhy = rvy / v, vhz = rvz / v;
  const gamma = Math.asin(clamp(vhy, -1, 1));       // flight path angle, + = climbing
  st.v = v; st.gamma = gamma;

  const stallK = smooth01((v - S.stallSpeed) / S.stallFade);
  st.stallK = stallK;

  // ------------------------------------------------------------------ the nose
  // Where you look is where the nose points. W noses down, S noses up — the
  // same keys that push and pull on every other gear, doing the same thing to a
  // wing. A stalled wing sags whatever you ask of it.
  let nose = ctx.pitch;
  if (keys.forward) nose -= S.noseAssist;
  if (keys.back) nose += S.noseAssist;
  const flare = !!keys.jumpHeld;
  if (flare) nose += S.flareAlpha;
  nose = clamp(nose, -S.noseMax, S.noseMax) - S.stallSag * (1 - stallK);
  st.nose = nose; st.flare = flare;

  // ----------------------------------------------------------------- the wing
  // The commanded angle of attack is CLAMPED at the break rather than allowed
  // past it. A modelled high-alpha stall was tried and thrown out: hauling the
  // nose up from a dive put alpha straight past the break, the wing let go, and
  // the pull-out simply did not happen — the player's clearest input produced
  // mush. A pilot flies the buffet by feel, so the wing gives them the most it
  // has and no more, and the ONE way to lose it is running out of airspeed.
  const alpha = clamp(nose - gamma, S.alphaMin, S.alphaMax);
  st.alpha = alpha;
  let cl = clamp(1 + S.alphaGain * alpha, S.clMin, S.clMax) * stallK;

  // ground effect: a cushion in the last couple of metres, which is what makes
  // skimming a slope at speed feel like it is holding you up
  let skim = 0;
  if (agl >= 0 && agl < S.skimHeight && spH0 > S.skimSpeed) {
    skim = 1 - agl / S.skimHeight;
    cl *= 1 + S.skimLift * skim;
  }
  st.skim = skim; st.cl = cl;

  let Lacc = gravity * (v / S.vTrim) * (v / S.vTrim) * cl;
  Lacc = clamp(Lacc, -S.gLimit * gravity, S.gLimit * gravity);

  // ------------------------------------------------------------ bank and turn
  // The heading error between where the look points and where we are actually
  // going commands a bank; the bank rolls in with lag; the banked lift vector
  // does the turning. Nothing writes yaw, so there is no instant snap anywhere.
  const track = spH0 > 0.2 ? Math.atan2(-vel.x, -vel.z) : yaw;
  const err = wrapPi(yaw - track);                    // + = we need to go left
  let bankCmd = err * S.bankPerErr;
  if (keys.left) bankCmd += S.bankKeys;
  if (keys.right) bankCmd -= S.bankKeys;
  bankCmd = clamp(bankCmd, -S.bankMax, S.bankMax);
  st.roll += (bankCmd - st.roll) * Math.min(1, S.rollRate * dt);

  // ← → barrel roll. Free rotation layered on top of the bank for the look of
  // it; the lift vector keeps using the aerodynamic bank, exactly as a real
  // barrel roll keeps positive g on the wing. Stamps like a ski spin.
  let spin = 0;
  if (keys.spinLeft) spin += 1;
  if (keys.spinRight) spin -= 1;
  let trick = null;
  if (spin) {
    const d = spin * S.rollSpin * dt;
    st.rollFree += d;
    st.barrel += d;
    if (Math.abs(st.barrel) >= TWO_PI) {
      st.barrel -= Math.sign(st.barrel) * TWO_PI;
      st.barrelN++;
      trick = {
        name: st.barrelN > 1 ? 'barrel roll ×' + st.barrelN : 'barrel roll',
        deg: 360 * st.barrelN,
      };
    }
  } else {
    st.rollFree += (0 - st.rollFree) * Math.min(1, S.rollRecover * dt);
    st.barrel *= Math.max(0, 1 - 2 * dt);
  }

  // ----------------------------------------------------------- forces on the air
  // Lift is perpendicular to the flight path, rolled by the bank. Build the
  // frame off the velocity rather than off yaw so a dive gets a lift vector
  // that actually points where a wing's would.
  let sx = -vhz, sz = vhx;                            // vhat × up  =  "right"
  let sl = Math.hypot(sx, sz);
  if (sl < 1e-4) { sx = Math.cos(yaw); sz = -Math.sin(yaw); sl = 1; }  // straight up/down
  sx /= sl; sz /= sl;
  // upPerp = side × vhat
  const ux = -sz * vhy, uy = sz * vhx - sx * vhz, uz = sx * vhy;
  const cr = Math.cos(st.roll), sr = Math.sin(st.roll);
  const lx = ux * cr - sx * sr, ly = uy * cr, lz = uz * cr - sz * sr;

  vel.x += lx * Lacc * dt;
  vel.y += ly * Lacc * dt;
  vel.z += lz * Lacc * dt;

  // Drag, straight back along the relative wind. The induced term is the one
  // that gives turns and pull-ups a price: it goes as L² / v².
  const gl = Lacc / gravity;
  const vr = S.vTrim / Math.max(v, 4);
  let D = S.dragBase + S.dragQuad * v * v + S.dragInduced * gl * gl * vr * vr;
  if (v > S.vSoft) { const o = v - S.vSoft; D += S.dragOver * o * o; }
  if (flare) D += S.flareDrag;
  const dv = Math.min(D * dt, v * 0.9);               // never reverse the flow
  vel.x -= vhx * dv;
  vel.y -= vhy * dv;
  vel.z -= vhz * dv;

  // 3D backstop — the glider owns vel.y, so the controller's horizontal-only
  // cap would not see a vertical runaway
  const sp3 = Math.hypot(vel.x, vel.y, vel.z);
  if (sp3 > S.maxSpeed) {
    const k = S.maxSpeed / sp3;
    vel.x *= k; vel.y *= k; vel.z *= k;
  }

  const lean = clamp(st.roll * S.rollVisual, -S.maxRoll, S.maxRoll) + st.rollFree;
  return { yaw, lean, trick };
}

// Contact with the ground. Fast, sinking hard, or into anything steep enough to
// be a wall rather than a field: you eat it. Everything else is a landing.
// Either verdict ends the flight, so either verdict stows the wing.
export function gliderJudgeWipe(vel, impact, normal, S) {
  const spH = Math.hypot(vel.x, vel.z);
  const nh = normal ? Math.hypot(normal.x, normal.z) : 0;
  stowed();
  if (impact > S.landVy) return true;
  if (spH > S.landSpeed) return true;
  if (nh > S.landSteep && spH > S.landSpeed * 0.6) return true;
  return false;
}

// A clean touchdown. You are back on your feet, not on edges, so most of the
// airspeed goes away — but keep enough that a good flare rolls out into a run
// instead of stopping dead on the spot.
export function gliderLand(vel, impact, normal, S) {
  st.roll = 0; st.rollFree = 0; st.barrel = 0; st.barrelN = 0; st.airT = 0;
  stowed();
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 1e-4) return;
  let k = S.landScrub;
  if (sp * k > S.landRun) k = S.landRun / sp;
  vel.x *= k; vel.z *= k;
}
