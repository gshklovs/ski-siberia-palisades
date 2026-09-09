// Capsule-ish first person character controller.
//
// Ground: one ray straight down from (feet + stepUp). Anything the ray finds is
// standable, which is what makes shallow rocks and dune slopes free — they are
// simply "ground that moved up a bit". Walls: two horizontal probes (knee and
// chest) that start ABOVE the step height, so a 30 cm rock is a step and a
// 3 m boulder is a wall, with no separate classification pass.
//
// Gears: BOOTS (walk/sprint/jump, below) plus a registry of RIDE gears — SKIS
// (ski.js), BIKE (bike.js), the GLIDER (glider.js) and the ROCKET (rocket.js,
// whose thrust lives in boost.js) — that share the probes,
// the wall slide and the ground snap, but nothing else. updateWalk is exactly
// the code it always was, so equipping a gear cannot change how walking feels.
// Adding a gear is one GEARS entry:
//   { S, step, land, jumpVel, launch?, reset?, wipe, holdJump?, footed?,
//     judgeWipe?, spinTrick? }
// E toggles boots ↔ the world's default gear; main.js owns the key and the menu.
//
// `footed` gears (the glider, the rocket) only exist in the air: while your feet
// are down the controller runs updateWalk, so on the ground they ARE boots, and
// the gear takes the whole velocity vector the moment you leave the ground.
//
// `setBoosting` (boost.js) is the one hook an outside module has on the velocity
// here. It says "the motor owns the velocity for these frames", and the gear's
// own model — walk friction, carve, wing, coast — steps aside for exactly that
// long. Collision, the ground snap and every wipe rule keep running underneath
// it. Only the ROCKET gear ever calls it; on skis, the bike, the glider and
// boots this file is what it always was.

import { skiStep, skiLand, skiLaunch, skiCoyote, skiSnapRelease, scaleSkiTuning, resetSki } from './ski.js';
import { bikeStep, bikeLand, bikeLaunch, bikeReset, scaleBikeTuning } from './bike.js';
import { gliderStep, gliderLand, gliderJudgeWipe, gliderReset, scaleGliderTuning } from './glider.js';
import { rocketStep, rocketLand, rocketJudgeWipe, rocketReset, scaleRocketTuning } from './rocket.js';
import { sledStep, sledLand, sledReset, scaleSledTuning } from './sled.js';
import { snowmobileStep, snowmobileLand, snowmobileReset, scaleSnowmobileTuning } from './snowmobile.js';
import { BIKE_GEAR } from './flags.js';
// specs/0057 §2.3 — the hard-fall save. rail.js has no imports of its own and
// holds no reference to this module until main.js hands it one, so a world with
// no jibs boots with an empty table and `railSave()` is a single false.
import { railSave } from './rail.js';

export const TUNING = {
  eyeHeight: 1.70,      // m — standing eye
  radius: 0.36,         // m — body radius used by the wall probes
  walk: 4.5,            // m/s
  sprint: 8.0,          // m/s
  jump: 4.5,            // m/s launch
  gravity: 16.0,        // m/s^2 (game gravity: ~0.63 m apex, 0.56 s hang)
  // Quake-style: acceleration scales with the speed you are asking for, so the
  // top speed is accel/friction * target and both walk and sprint actually
  // reach their number. A fixed m/s^2 caps out at accel/friction regardless.
  accelGround: 14,      // 1/s
  accelAir: 2.5,        // 1/s
  friction: 11,         // 1/s
  stepUp: 0.55,         // m — max free climb
  maxFall: 60,          // m/s terminal
  voidDrop: 90,         // m below spawn before we respawn you
  snapDown: 0.45,       // m — stay glued to ground walking downhill
  // ---- specs/0012: the world is allowed to hurt you.
  // Trees were decor in every one of these maps — surprise.js quipped when you
  // rode THROUGH one. A trunk is now a solid vertical cylinder (solids.js) and
  // meeting it at speed is a wipeout on the same path a bad landing takes.
  treeWipeV: 4.0,       // m/s — at or above this, a trunk is a wipeout; below it
                        // you slide off and can nudge past at walking pace
  // ...and the needles around it are a SOFT hit (specs/0012 §E2). Missing the
  // trunk and taking the foliage instead does not put you down — it takes the
  // speed off you and lets you through. Both numbers are dimensionless, so
  // neither is scaled by the scene's unit.
  canopyEntry: 0.625,   // x — one cut on the frame you enter the foliage
  canopyDrag: 3.45,     // 1/s — exponential xz drag while you are inside it.
                        // Both were 0.50 / 4.0; Greg on the bench, 2026-09-01:
                        // "slow is too slow, can be 75% of slowness" ->
                        // 0.625 / 3.0; 2026-09-02 "halfway back" -> 0.56 / 3.5
                        // (specs/0031 §1), which together with a x0.80 skirt
                        // stalled the rider inside the tree.
                        //
                        // specs/0032 §1 reads "15 % more friction" against what
                        // is actually being played (main's 0.625 / 3.0), so the
                        // ENTRY cut is left alone and the drag alone goes up by
                        // 15 %: 3.0 -> 3.45. That is the number Greg asked for
                        // and it does not move again; the skirt
                        // (CANOPY_R_SCALE, solids.js) is the knob that pays for
                        // it, because after the cut the body's remaining
                        // horizontal travel is bounded at v0/drag metres and the
                        // skirt is what sets the chord it has to cross.
  canopyCarry: 0.50,    // s — THE SEAM BETWEEN §E1 AND §E2, and the one number
                        // neither of them names. A big fir's skirt reaches 3 m
                        // out at the height §E1 exists for, so a rider aimed at
                        // the trunk crosses 3 m of needles first — and the drag
                        // above takes him under `treeWipeV` before the wood.
                        // Left alone, §E2 would delete §E1 at exactly the
                        // heights Greg asked for it. So for this long after
                        // entering a tree's foliage, THAT tree's trunk is judged
                        // on the speed you carried in, not on what its own
                        // branches have already taken off you. Beyond the
                        // window you are not crashing through it any more, you
                        // are sitting in it, and a bump is a bump.
  // ...and rock is rock — but ONLY the part of it you run into. specs/0020 §2b,
  // Greg on the bench 2026-09-02: "Skiing on top of a rock should not wipe out,
  // it should throw some sparks though. Only skiing INTO a rock is wipeout
  // worthy. Same for other collideable objects."
  //
  // 0012 §B read that the other way round: the class byte under the feet plus
  // `rockWipeV 6` was the whole rule, and the 0020 RCA measured what that costs
  // — a hands-off body at the Siberia spawn (a 40.6 deg granite face) creeps to
  // 6 m/s in one second over 2.9 m of ground and is put down for it, having
  // touched nothing. So `rockWipeV` and `rockLandV` are GONE, not retuned:
  //   * ON stone is never a wipe at any speed. It is sparks (fx.js) and ski.js's
  //     rock friction, which is what the player actually feels.
  //   * INTO stone is the wipe, and it is judged by `blockedAhead()` below on
  //     the SAME floor a trunk has (`treeWipeV`) — one number for every solid,
  //     which is also what 0018's towers and buildings will read.
  //   * a hard vertical arrival is the ordinary `landing` wipe, on every surface
  //     class alike. Rock gets no threshold of its own and no exemption.
  blockAhead: 0.25,     // m — how far PAST the body radius the "am I about to
                        // run into something" probe reaches, on top of the
                        // distance this frame's velocity actually covers
};

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// collision.js's surface classes, spelled out here so this file does not import
// a constant it only compares against.
const CLASS_SNOW = 0;
const CLASS_ROCK = 1;
// ...and specs/0018's props. THE WHOLE RULE IS THIS TABLE: a class byte in it is
// a thing that puts you down when you run into its SIDE, and the value is the
// `why` the HUD prints and surprise.js quips on. A class NOT in it (snow) is
// nothing to run into. There is no second test anywhere — `solidAhead()` reads
// this map and 0020's `blockedAhead()` does the geometry for all of them.
const WIPE_WHY = {
  1: 'rock',        // CLASS_ROCK      — specs/0020 §2b
  2: 'building',    // CLASS_BUILDING
  3: 'tower',       // CLASS_TOWER     (sign posts too: a post is a thin tower)
  4: 'person',      // CLASS_PERSON
  5: 'bench',       // CLASS_BENCH
};

export function createController(THREE, collision, spawn, tuning = {}) {
  const T = { ...TUNING, ...tuning };
  // THE SCENE'S UNIT, recovered rather than passed. main.js scales a FIXED list
  // of tuning keys by unitScale before it gets here and `walk` is on that list;
  // the specs/0012 thresholds are not, and a scene where 1 unit is 4 m would
  // otherwise get metre-sized numbers. Recovering it from a length the caller
  // did scale keeps the seam where it already is instead of adding another
  // argument to a call site this spec may not touch.
  const U = (T.walk > 0 && TUNING.walk > 0) ? T.walk / TUNING.walk : 1;
  for (const k of ['treeWipeV', 'blockAhead']) {
    if (tuning[k] === undefined) T[k] = TUNING[k] * U;
  }
  // ride-gear registry — tunings already scaled by the caller
  const GEARS = {
    skis: {
      S: scaleSkiTuning(1, tuning.ski || {}),
      step: skiStep, land: skiLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // ski models bring their own pop
      launch: skiLaunch,         // lips hand back the vertical the ground snap ate
      coyote: skiCoyote,         // ...and a pop just after one is still a pop
      snapRelease: skiSnapRelease,   // ...and the snap itself lets go off a knuckle
      wipe: true,                // off-axis landings tumble (bike.js scrubs in bikeLand)
      reset: resetSki,           // the pump bank and the stivot state are not
                                 // yours across a respawn, a gear change or a teleport
    },
    // specs/0003 — `gearSet`. THIS REGISTRY IS THE FLAG: there is no separate
    // "can ride a bike" boolean anywhere in the player, so with no entry here
    // ctrl.mode can never become 'bike' — every path into it goes through GEARS.
    // bike.js still ships and is still imported above, because main.js builds
    // the fp/tp rigs from it unconditionally and inventory.js imports its
    // thumbnail painter. A registry edit, not a file deletion (D24).
    ...(BIKE_GEAR ? {
      bike: {
        S: scaleBikeTuning(1, tuning.bike || {}),
        step: bikeStep, land: bikeLand,
        jumpVel: (S) => S.hop,     // bunny hop (unused while holdJump is set)
        launch: bikeLaunch,        // lips hand back the vertical the snap ate
        reset: bikeReset,
        wipe: false,
        holdJump: true,            // SPACE is preload/pop: the gear's step owns the
                                   // jump (writes vel.y on release), so the instant
                                   // keys.jump path must not fire
      },
    } : {}),
    glider: {
      S: scaleGliderTuning(1, tuning.glider || {}),
      step: gliderStep, land: gliderLand,
      jumpVel: (S) => T.jump,    // (unreachable: footed gears jump out of updateWalk)
      reset: gliderReset,
      wipe: false,
      footed: true,              // on the ground you are simply on foot
      judgeWipe: gliderJudgeWipe,// flare or eat it — the ski off-axis rule does not apply
      spinTrick: false,          // the mouse turns you all day; barrel rolls are the trick
    },
    rocket: {
      S: scaleRocketTuning(1, tuning.rocket || {}),
      step: rocketStep, land: rocketLand,
      jumpVel: (S) => T.jump,    // (unreachable: footed gears jump out of updateWalk)
      reset: rocketReset,
      wipe: false,
      footed: true,              // boots until the motor lights
      judgeWipe: rocketJudgeWipe,// no flare to save you; the retro-burn is the landing
      spinTrick: false,          // aiming a rocket is not a 360
    },
    sled: {
      S: scaleSledTuning(1, tuning.sled || {}),
      step: sledStep, land: sledLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // you cannot really jump a sled
      reset: sledReset,
      wipe: true,                // the ski off-axis rule, with a NEGATIVE wipeTol:
                                 // a sled tumbles at ~74° where a ski shrugs at 93°
    },
    snowmobile: {
      S: scaleSnowmobileTuning(1, tuning.snowmobile || {}),
      step: snowmobileStep, land: snowmobileLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // a small pop; 400 kg does not fly
      reset: snowmobileReset,
      wipe: true,                // forgiving (wipeTol 0.30) but not immune
    },
  };
  // What tap-E toggles boots ↔. Mutable because one equipment type can be flown
  // by more than one gear: picking the rocket pack in the locker's glider tab
  // has to move the toggle target with it, or tap-E would hand you back the wing.
  let defaultGear = GEARS[tuning.defaultGear] ? tuning.defaultGear : 'skis';
  const pos = new THREE.Vector3().copy(spawn.position);      // FEET position
  const vel = new THREE.Vector3();
  let yaw = spawn.yaw || 0, pitch = spawn.pitch || 0;
  let grounded = false;
  let respawns = 0;
  let mode = 'boots';            // 'boots' | keys of GEARS
  let lean = 0;                  // rad — camera bank, ride gears only
  const home = { position: pos.clone(), yaw, pitch };

  const keys = {
    forward: false, back: false, left: false, right: false, sprint: false, jump: false,
    // SPACE level (not edge). Three consumers now: the bike's preload/pop, the
    // glider's flare, and — since 2026-08-31 — the rocket's THROTTLE, which used
    // to be its own `boost` key on G. One level input, one key, and touch.js
    // already sets it for a hold on the right half of the glass.
    //
    // specs/0057 §4.4 (B, Greg 2026-09-06) — IT IS NO LONGER THE GRAB. Space
    // held in the air used to be the grab as well; `grab` below is that input
    // now, and this level went back to meaning exactly what its three gear
    // consumers read it for.
    jumpHeld: false,
    // specs/0057 §4.4 (B, Greg 2026-09-06) — THE GRAB, on its own key at last.
    // "Can you make b the trick key instead of space": B alone is SAFETY, B with
    // a cardinal names the grab, B with an opposite pair is TRUCK DRIVER, and B
    // still held at touchdown is §5.4's wipeout. It is a LEVEL like `jumpHeld`
    // and is read by exactly one file (tricks.js); touch.js sets it from the
    // same right-half hold that sets `jumpHeld`, because a phone has no B.
    grab: false,
    spinLeft: false, spinRight: false,       // ← → : steer on the ground, trick-spin in the air
    // ↑ ↓ : EXACT aliases of W/S on the ground (ski.js reads them that way), the
    // flip axis in the air (tricks.js). Split off W/S so a flip is not a brake.
    flipFwd: false, flipBack: false,
    tuck: false,                             // SHIFT — flex/absorb in a turn, aero tuck in a line
  };
  // The rocket's motor (boost.js) is driving the velocity this frame. Every gear
  // model here tops out around 30 m/s, so a 100 m/s thrust cannot merely be added
  // to one — it has to replace it for the frames it burns. Only the velocity
  // MODEL stands down: the probes, the wall slide, the ground snap, the landing
  // judgement and the wipe rules below all still run, which is why flying into a
  // cliff is an ordinary wipe.
  let boosting = false;
  // A motor is pushing but the gear model STAYS IN CHARGE. The snowmobile takes
  // its booster this way: standing the sled's model down would take its steering
  // and its track drag with it, and a rocket sled you cannot point is a bullet.
  // The gear reads this as `thrust` in its step ctx and may relax its own limits.
  let thrusting = false;
  let crouch = 0;                // 0..1 — preload compression, from the gear's step

  // ---- air tricks. Yaw accumulated while airborne on skis; judged on landing.
  let airSpin = 0;               // rad, signed, this air
  let airTime = 0;               // s, this air
  let spinPrevYaw = yaw;
  let wipeT = 0;                 // s left of wipeout (camera tumble; speed already scrubbed)
  let lastTrick = null;          // { name, deg } — '360' | '720' | '1080' | 'wipeout'
  let trickJudge = null;         // tricks.js's landing-window verdict, if wired
  // specs/0057 §5.4 (D13) — tricks.js's GRAB verdict. A second hook and not a
  // branch of the first, because the two are asked at opposite ends of the
  // landing block: the grab is asked BEFORE the crossed rule, the rotation
  // after it. specs/0057 §4.4 (B, Greg 2026-09-06) — the input is `keys.grab`
  // now (it was `keys.jumpHeld` until B took the job); this controller sets
  // both levels the same way and reads neither.
  let grabJudge = null;
  let treeHits = 0, rockWipes = 0;   // specs/0012 counters, for the test handle
  // specs/0018 — every INTO-a-solid wipe, and the same total split by `why`.
  // `rockWipes` is left meaning exactly what 0012 and 0020 made it mean (stone
  // only), so their gates keep reading the number they were written against.
  let solidWipes = 0;
  const solidHits = { rock: 0, building: 0, tower: 0, person: 0, bench: 0 };
  // specs/0020 §2b — what is under the feet as of THIS step's ground probe, and
  // the last face the body actually ran into. Captured rather than re-queried:
  // the gear models probe the ground again on their own account, so a live read
  // from a caller running after update() is answering about somebody else's ray.
  let lastGroundCls = CLASS_SNOW;
  let lastBlock = null;
  // ---- specs/0030 §2: THE TOSS.
  //
  // Two things the scrub needs and did not have. `velPre` is the velocity the
  // frame STARTED with — the one you arrived at the trunk holding — because by
  // the time `wipeout()` runs, the wall slide and the stem push-out have both
  // already taken the closing half of it off, and a bounce computed from what is
  // left is a bounce off nothing. `wipeHit` is the contact normal the caller
  // just used, latched on the line before the wipe is spent and consumed by it,
  // so a landing you simply fluffed still takes the plain scrub and no bounce.
  const velPre = { x: 0, z: 0 };
  let wipeHit = null;                // { nx, nz } — set immediately before wipeout()
  // ---- specs/0056 — HOW HARD THAT WAS, WHAT IT COST YOU, AND HOW SNOWY YOU ARE.
  //
  // §1: the intensity I is not a new measure. `fx.js` `imFire` already sizes the
  // impact frame by `clamp((sp − V_MIN)/(V_MAX − V_MIN), 0, 1) ^ SHAPE` (specs/0030
  // §4, re-tuned by 0033 §1 and 0035 §1) and these are that expression's three
  // literals, to the digit. Same curve, same speed — `velPre`, the velocity this
  // frame ARRIVED with, which is what `IMS.prevSp` samples for the frame — so the
  // gear you lose is exactly as loud as the burst that took it and the two can
  // never disagree. If fx.js's IM moves, these move with it.
  //
  // §2: ΔS = ADD0 + ADD1·I. A light slide is 0.15, a full send 0.60, and S is
  // KEPT through the get-up — that is Greg's whole ask: gear back, snow stays.
  //
  // §3: a wipeout whose ΔS would take S past 1.0 freezes you into an ice block
  // for HOLD instead, then shatters and leaves you at AFTER. Capped after, so
  // there is never a second block until an R or a lift ride resets S.
  //
  // The visuals are fx.js's and rider.js's; this module owns the NUMBERS and the
  // sequence counters they edge-detect on, exactly as `wipeT` is the one clock
  // the impact frame and 0017's audio both read.
  const SHED = {
    I_MIN: 4.0, I_MAX: 12.0, I_SHAPE: 1.6,   // === fx.js IM.V_MIN / V_MAX / SHAPE
    T1: 0.25, T2: 0.50, T3: 0.75,            // §1's tier bounds
    RETURN_AT: 1.60,                         // s into the wipe — TUM_KF's get-up row
  };
  const SNOW = { ADD0: 0.15, ADD1: 0.45, MAX: 1.0, AFTER: 0.85 };   // specs/0056a: HOLD is gone with the freeze
  // ---- specs/0056a — THE BLOCK RIDES THE RAGDOLL'S CLOCK. Greg, 2026-09-05:
  // "The ice block shouldn't add extra freeze frames, it should just use my
  // ragdoll time. But I still ragdoll the same way."
  //
  // 0056 §3 bought its second with a `freezeT` that early-returned out of
  // update(): input dead, `vel` zeroed, `wipeT` held, gravity off. That is a
  // 3.0 s wipeout wearing a 2.0 s costume, and it is the one thing about the
  // gag Greg did not want. Both numbers below are POSITIONS INSIDE the 2.0 s
  // `WIPE.LEN` that 0015/0030/0034 already spend — the block closes mid-tumble
  // and breaks at the get-up, the body tumbles the whole way through it, and
  // `WIPE.LEN` does not move by a millisecond. There is no second clock left in
  // this module: `freezeT` is gone, not set to zero.
  //
  // AT is 0.35 and not 0: the impact frame (0033/0035/0054) owns the first third
  // of a second and a block closing on the same frame as the flash reads as one
  // event rather than two. OFF is `SHED.RETURN_AT` BY REFERENCE, not by value —
  // the shatter and the gear's flight home are the same moment ("shatters at the
  // get-up"), and if TUM_KF's get-up row ever moves, both move with it.
  const ICEW = { AT: 0.35, get OFF() { return SHED.RETURN_AT; } };
  // S and its bookkeeping. `shedSeq`/`restoreSeq`/`iceSeq`/`shatterSeq`/`resetSeq`
  // are monotonic counters, not events: a renderer that misses a frame still sees
  // the change, and `takeEvents()`'s one-shot drain stays the trick module's.
  const snow = {
    S: 0, I: 0, deltaS: 0, tier: 0, wipes: 0, frozen: false, iceT: 0,
    shedSeq: 0, restoreSeq: 0, iceSeq: 0, shatterSeq: 0, resetSeq: 0, why: '',
  };
  let gearOut = false;               // is anything shed right now?
  let getUp = false;                 // a wipe is running and has not reached RETURN_AT
  let iceArmed = false;              // this wipe ends in a block
  // §1 — the ONE reattach. Idempotent by construction: it bumps the counter only
  // when something is actually out, so calling it twice, or on a clean body, is a
  // no-op. `respawn()`, `setMode()` and `teleport()` all go through it.
  function gearReattach() {
    if (gearOut) { gearOut = false; snow.restoreSeq++; }
    getUp = false; snow.frozen = false; snow.iceT = 0; iceArmed = false;
    return snow.restoreSeq;
  }
  // §4 — the only two things that clear snow: R, and boarding a lift.
  function snowReset(why) {
    snow.S = 0; snow.why = why || 'reset'; snow.resetSeq++;
    return snow.S;
  }
  const WIPE = {
    LEN: 2.0,        // s — 0030 §1. Was 0.9.
    // WHERE THE OLD 0.30 WENT. It did two jobs at once — it made the hit hurt
    // AND it stopped the body — and the second one is what kept 0015's tumble
    // inside a metre. It is now two numbers: the hit takes almost nothing off
    // you (you are THROWN, that is the whole point), and the drag below is what
    // brings you to rest, over the second half of the slide rather than the
    // first tenth of it. Measured, on the 0015 rig: 3.79x and 4.50x.
    SCRUB: 0.95,     // what a NON-contact wipe keeps of its speed (was 0.30 flat)
    TAN: 0.72,       // ...and what a contact keeps of the TANGENTIAL half
    REST: 0.35,      // ...having bounced this much of the closing half back out
    // ...and the snow taking it off you again, so the get-up is not a body
    // sliding into its riding pose at speed. HELD, then RAMPED: the throw is the
    // first three quarters of a second and has to be allowed to happen, and the
    // stop belongs to the second half of the slide. A flat drag cannot do both —
    // strong enough to hold a body under 1.5 m/s on a 33 deg pitch at t = 1.6 s
    // is strong enough to have deleted the throw by t = 0.3 s.
    //
    // ---- specs/0034 §1: AND 75 % FARTHER ONCE YOU ARE ON THE SNOW.
    //
    // 0030 threw you 3.6-4.2x farther and then took it back off you starting at
    // 0.85 s, so the slide was over by ~1.1 s and the last half of the wipe was a
    // body lying still. 0034 gives the SLIDE the time instead of the THROW: the
    // hold runs to 1.40 s and the ramp is in by 1.50, which is 0.10 s before the
    // get-up starts, so the body is down to walking pace exactly as it begins to
    // stand rather than a second before it. Nothing about the contact moved —
    // SCRUB/TAN/REST are 0030's to the digit, and the peak speed off the hit is
    // unchanged in both cases (§3.1's table).
    //
    // DRAG0 is 0 and that is the honest number, not a disabled feature: swept, a
    // hold of 0.05/s costs case A 0.06x and puts it under §3.1's 1.55 floor. The
    // wipe adds no drag of its own while the body is being thrown; the snow under
    // the skis (ski.js's own friction, which runs underneath this) is what bleeds
    // the throw off, and DRAG1 is what stops it.
    DRAG0: 0.00,     // 1/s — while the body is still being thrown (0030: 0.25)
    DRAG_HOLD: 1.40, // s — ...for this long (0030: 0.85)
    DRAG1: 18.0,     // 1/s — and this much from DRAG_IN onward
    DRAG_IN: 1.50,   // s (0030: 1.10)
  };
  let canopyHits = 0;                // ...and §E2's, one per ENTRY into foliage
  let inCanopy = -1;                 // stem index whose canopy we are inside, -1 = out
  let canopyV = 0;                   // the speed carried into it (see T.canopyCarry)
  let canopyT = 0;                   // s since that entry
  const events = { land: 0, trick: null, wipe: null, pop: null };   // drained by main.js each frame

  const TWO_PI = Math.PI * 2;
  const wrapPi = (a) => a - TWO_PI * Math.round(a / TWO_PI);

  // specs/0051 §2.8 paths 2, 3 and 4. `main.js:1788-1789` says it verbatim: the
  // controller's own respawn does NOT go through the `ctrl.teleport` wrapper, so
  // pinning that one seam would have left R — and both void-drop nets — landing
  // the body on whatever happened to be resident. This is the pin for all three,
  // and the tag is how `__chunks.pinsByPath` says which of them actually fired.
  function respawn(path = 'respawn') {
    if (collision && collision.pinSync) collision.pinSync(home.position, path);
    pos.copy(home.position);
    vel.set(0, 0, 0);
    yaw = home.yaw; pitch = home.pitch;
    grounded = false;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0; inCanopy = -1; canopyV = 0; canopyT = 0;
    for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    // specs/0056 §1/§4 — R is one of the two things that clear snow, and the gear
    // is always back on the body afterwards whatever the wipe was in the middle of.
    gearReattach(); snowReset('respawn');
    respawns++;                  // gear is kept: respawning is not un-equipping
  }

  function setMode(m) {
    const next = GEARS[m] ? m : 'boots';
    if (next === mode) return mode;
    mode = next;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0; inCanopy = -1; canopyV = 0; canopyT = 0;
    gearReattach();               // specs/0056 §1 — never change gear with a ski on the hill
    for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    // stepping out of the bindings at 28 m/s would be a physics joke; keep a
    // little of it so the switch never feels like hitting a wall
    if (mode === 'boots') {
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > T.sprint) { const k = T.sprint / sp; vel.x *= k; vel.z *= k; }
    }
    return mode;
  }

  function look(dx, dy, sens = 0.0022) {
    // specs/0056a — THE BLOCK NO LONGER TAKES THE CAMERA EITHER. It rides the
    // ragdoll's own clock (see update()), and the ragdoll has never stopped you
    // looking around. The gate that used to stand here was the input freeze.
    yaw -= dx * sens;
    pitch = clamp(pitch - dy * sens, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  // dot(faceNormal, up) above which a face is a RAMP rather than a wall. Only
  // near-vertical surfaces are walls: a steep-but-climbable slope must not stop
  // you dead, otherwise every dune reads as a fence. Shared by the wall slide
  // and by blockedAhead() on purpose — "what stops the move" and "what the move
  // ran into" have to be the same set of faces, or a body can be halted by
  // something the wipe rule says was never there.
  const WALL_NY = 0.72;
  // ...and how squarely you have to meet one for it to count as running INTO it
  // rather than brushing along it. cos 78 deg: a traverse under a cliff at
  // 20 m/s is not a crash, a 78 deg approach is.
  const WALL_INTO = 0.20;

  // ======================================================================
  // physics/no-snag — THE RULE, AND THE FOUR THINGS THAT SERVE IT.
  //
  // Greg, 2026-09-05: "I always want things to be rideable; the only time I
  // should crash is a near-90 degree impact. Our physics are generally good at
  // this except sometimes I get caught on cliffs like the Fingers."
  //
  // Two claims in one sentence, and the second is a bug report about the
  // collision layer, not about any one rock. Getting CAUGHT is what this block
  // removes; getting put down for a glancing brush is what NOSNAG.INTO removes.
  // Everything here is general — the box chute's 83 deg slot wall, the Fingers
  // reef ribs, the KT spine, the GS Bowl bands and Poulsen's cliff are the same
  // five lines of code, and no feature is named anywhere below.
  //
  //   (a) DEPENETRATION. `slide()` projected the move and never once asked
  //       whether the body was already INSIDE something. A ray fired forward
  //       from inside a rib reports the far wall with a back-pointing normal, so
  //       the slide happily ran the body along the inside of the mountain —
  //       req-20260905-174625 measured 56 buried frames on the box chute's slot
  //       wall and closed with "slide() has no depenetration". `depenetrate()`
  //       below asks collision.js's new `nearestFace()` instead, and pushes out
  //       along the shortest way out, bounded per frame.
  //
  //   (b) SLIDE-ALONG, NEVER ZEROED. A wall projection that runs out of
  //       iterations, or a slot that hands the body two opposing normals, used
  //       to leave a move of ~0 — a body pinned to a face with the key held.
  //       The projection now keeps the tangential component explicitly and the
  //       only thing that may take speed off it is ROCK friction, as a RATE.
  //
  //   (c) THE WIPE IS NEAR-90 ONLY. `WALL_INTO` 0.20 is cos 78 deg: under the
  //       old rule ANY meeting inside 78 deg of head-on was a crash, which is
  //       12 deg off a pure graze. Greg's near-90 is 20 deg off head-on.
  //
  //   (d) NO STUCK STATE PERSISTS. If (a)-(c) somehow still park a body against
  //       a face with the input held, `UNSTICK` nudges it along the face's own
  //       downhill tangent after half a second. It is counted, and the count is
  //       an assertion: on a healthy build it stays 0.
  const NOSNAG = {
    // (c) THE THRESHOLD. `into` is cos(angle off head-on), so this is the
    // cosine of "20 deg from head-on" == "70 deg from tangential", which is
    // Greg's near-90. A brush at 30 deg off head-on now deflects.
    INTO: Math.cos(20 * Math.PI / 180),        // 0.9397
    // (a) how far out of a face one frame may push. Ordinary contact needs
    // centimetres; this only binds on a body that has been teleported or
    // launched deep into geometry, and it bounds the jump so a rescue never
    // reads as a blink.
    PUSH_MAX: 0.60,                            // m per frame
    // ...and the BURIED cap, which is a different number for a different job. A
    // body that is merely touching needs centimetres; a body that has been
    // launched THROUGH a rib at 20 m/s covers a third of a metre a frame and
    // must come out faster than it went in or the push never catches up. Still
    // bounded, so a rescue is a squeeze and not a blink.
    // ...and the PHASE-IN lift is bigger again, because the state it ends is not
    // a state worth preserving for a few frames to make the exit look gentle. A
    // body with rock between its feet and its eyes is inside the mountain, and
    // every frame it stays there is a frame the player is looking out through a
    // stump. Big enough to clear the KT spine's shells in one step.
    PHASE_LIFT: 4.0,                           // m per frame
    // ...and the sphere the push looks in. `radius` is the body; the second
    // number is the BURIED search, and it is only paid on frames where there is
    // surface over the body's own head.
    PUSH_R: 0.44,                              // m — a touch past T.radius
    // Burial widens the SEARCH so a deep body can still find the wall it is
    // beside; it never widens the need. Getting out goes UP — `phaseInRescue()`.
    BURIED_R: 5.0,                             // m
    BURIED_OVER: 1.0,                          // m of surface over the head = buried
    // (b) what a ROCK face scrapes off the tangential half, as a RATE: keep
    // WIPE.TAN of it per second of contact. Applied per second and not per
    // frame on purpose — 0.72 a frame is 4e-9 a second and would be a wall in
    // everything but name, which is the exact bug this block exists to remove.
    ROCK_TAN: 0.72,                            // x per second of rock contact
    // ...and (b)'s teeth. A projection is only a slide while something SURVIVES
    // it: meet a face dead head-on and the tangential half is zero by
    // construction, so the old code handed back a move of nothing and the body
    // parked against the wall with the key held. That is being CAUGHT, and it is
    // 402 of the 1,033 stuck frames the sweep measured on rider/v3.
    //
    // So below `KEEP_MIN` of the move surviving, the remainder is REDIRECTED
    // along the face rather than deleted: down its own downhill tangent, or the
    // way the body was already leaning if it had a tangential preference at all.
    // You scrape along a cliff instead of gluing to it, which is what a ski
    // actually does and what "I always want things to be rideable" means at 90
    // degrees.
    KEEP_MIN: 0.20,                            // x of the move — below this, redirect
    KEEP_OUT: 0.50,                            // x of the move handed along the face
    // ...with a FLOOR, and the floor is the whole of why the first cut of this
    // did nothing. A body already parked has a tiny move to redirect, so half of
    // tiny is tiny and it stays parked: depenetration takes the closing half off
    // every frame, the gear model puts it back, and the two of them hold the
    // speed at 0.15 m/s indefinitely. A face a rider is asking to move along
    // hands back walking pace whatever the move it ate was worth.
    KEEP_V: 2.20,                              // m/s — the scrape a held key always gets
    // (d) the get-unstuck net.
    STUCK_V: 0.30,                             // m/s — below this, with input held, you are stuck
    STUCK_T: 0.50,                             // s of it before the nudge fires
    NUDGE_V: 1.60,                             // m/s handed along the face's downhill tangent
  };
  // ...and its bookkeeping, published on the api for the gate to assert on.
  let depenFrames = 0, depenMax = 0, buriedFrames = 0, unstickNudges = 0, stuckT = 0, stuckFrames = 0;
  // specs/0057 §2.4 — THE ONE EXCEPTION TO (a), and it is bounded to one mesh.
  // While a rider is locked onto a jib the body is HELD to a line by rail.js,
  // so `depenetrate()` skips the `park-jibs` soup — and ONLY that soup. Every
  // other collider still pushes out: a rider who slides a rail into a tree is
  // still pushed out of the tree, the near-90 wall wipe is not suppressed
  // (rule 2), and `UNSTICK` still counts and must still read 0 (rule 3).
  const RAIL_MESH = 'park-jibs';
  let railHold = false;
  // specs/0057 §3.4 — the jump EDGES this controller has honoured. `keys.jump`
  // is edge-triggered and update() eats it on its last line, so a module that
  // runs after update() cannot see a pop at all; this counter is how rail.js
  // knows the pop off a jib fired. A counter, not an event: nothing consumes it.
  let jumpEdges = 0;
  // specs/0057 §2.3 — why the last landing was judged the way it was, including
  // 'jib' when the hard-fall save overrode the verdict. P7 asserts on it.
  let landWhy = '';
  // the wall face the body is TOUCHING at hip height as of this frame's
  // depenetration pass, push or no push — see there.
  let contact = null;
  // (d)'s dwell is measured in DISPLACEMENT and not in instantaneous speed: a
  // body pinned at a cliff foot oscillates 0.18 / 0.42 / 0.28 m/s under ski.js's
  // static friction and crosses any speed threshold twice a frame, which resets
  // a speed-based timer forever — that is why the first cut of this net fired
  // 0 times against 5,642 stuck frames. This latches WHERE the window started.
  let stuckFrom = null;
  // the face the last depenetration pushed off, for the probe's report
  let lastPush = null;

  // one horizontal probe; returns the blocking normal or null
  function probe(dx, dz, dist, height) {
    const h = collision.raycast(pos.x, pos.y + height, pos.z, dx, 0, dz, dist);
    if (!h) return null;
    if (Math.abs(h.ny) > WALL_NY) return null;
    // `cls` rides along for physics/no-snag (b): only a ROCK face scrapes the
    // tangential half, and the slide is the only thing that knows it touched one.
    return { nx: h.nx, nz: h.nz, dist: h.dist, cls: h.cls };
  }

  // ---- specs/0020 §2b: WHAT IS IN FRONT OF ME.
  //
  // The reusable half of the new rule, and the one 0018 is meant to call for
  // towers, buildings, people and benches. It answers the question the old rock
  // rule never asked: not "what am I standing on" but "is the direction I am
  // travelling blocked by the SIDE of something, and how squarely".
  //
  // Two heights, the same pair the wall slide uses — knee (`stepUp` + a bit, so
  // a kerb the step-up can climb is deliberately below it) and hip. A ground
  // step the step-up cannot climb IS a near-vertical face at knee height, so it
  // falls out of the same probe and needs no second test.
  //
  // Returns null, or { dist, nx, nz, ny, cls, mesh, into, closing } where
  // `into` is 0..1 for how head-on the meeting is and `closing` is the speed
  // actually being spent on the face. Costs at most two raycasts, and only when
  // the body is moving.
  function blockedAhead(dist) {
    const sp = Math.hypot(vel.x, vel.z);
    if (sp < 1e-4) return null;
    const dx = vel.x / sp, dz = vel.z / sp;
    const reach = (dist == null ? sp / 60 + T.radius + T.blockAhead : dist);
    let best = null;
    for (const hgt of [T.stepUp + 0.12, 1.35 * U]) {
      const h = collision.raycast(pos.x, pos.y + hgt, pos.z, dx, 0, dz, reach);
      if (!h) continue;
      if (Math.abs(h.ny) > WALL_NY) continue;
      const into = -(h.nx * dx + h.nz * dz);      // 1 = square on, <=0 = leaving it
      if (into <= WALL_INTO) continue;
      if (best && h.dist >= best.dist) continue;
      best = { dist: h.dist, nx: h.nx, ny: h.ny, nz: h.nz,
               cls: h.cls, mesh: h.mesh, into, speed: sp, closing: sp * into };
    }
    return best;
  }

  // ...and the wipe it pays for. Read BEFORE the wall slide, because the slide
  // is what removes the closing speed — measure after it and every crash reads
  // as a body that gently came to rest against a cliff.
  //
  // Same discipline as stemGuard(): the tumble suppresses the TRIGGER only (one
  // face is one wipeout, not the 108 frames spent sliding down it), the floor is
  // `treeWipeV`, and there is no push-out to lose because the wall slide already
  // owns that.
  //
  // specs/0018 widens it from stone to every solid the world names, and widens
  // NOTHING else: the geometry is 0020's `blockedAhead()` unchanged, the floor is
  // still `treeWipeV`, and the only new line is the table lookup. A tower, a
  // lodge wall, a person and a bench are the same event as a cliff — which is
  // exactly what Greg asked for, and why there is one rule and not five.
  function solidAhead(dt) {
    if (wipeT > 0) return null;
    if (Math.hypot(vel.x, vel.z) < T.treeWipeV) return null;   // nothing here can wipe
    const h = blockedAhead(Math.hypot(vel.x, vel.z) * dt + T.radius + T.blockAhead);
    if (!h || !WIPE_WHY[h.cls]) return null;
    // ---- physics/no-snag (c): A FACE WIPES ONLY WHEN YOU MEET IT NEAR-90.
    //
    // TWO conditions and both are printed by the gate, because they fail
    // differently: `into` is the GEOMETRY of the meeting and `closing` is the
    // ENERGY in it, and a rule that only reads one of them either puts you down
    // for brushing a cliff at 40 m/s (0.20, what this replaces) or lets you
    // drive head-on into one at walking pace.
    //
    //   into    >= NOSNAG.INTO (0.9397 = 20 deg off head-on, Greg's "near-90")
    //   closing >= T.treeWipeV (4.0 m/s, the same floor a trunk has had since
    //                           specs/0012 — one number for every solid)
    //
    // Anything shallower deflects: it falls through to the wall slide below,
    // which keeps the tangential half and lets you carry on. That is the whole
    // of "I always want things to be rideable".
    if (h.into < NOSNAG.INTO) return null;
    if (h.closing < T.treeWipeV) return null;
    h.why = WIPE_WHY[h.cls];
    return h;
  }

  // ...and spending it, in ONE place rather than once per update loop. The walk
  // path and the ride path both call this immediately after their slide, with
  // the verdict `solidAhead()` took BEFORE the slide — see the call sites.
  // `wipeT` is re-read by the caller because stemGuard may have just spent the
  // frame's event on a trunk, and one crash stays one crash.
  function spendSolid(h) {
    if (h.cls === CLASS_ROCK) rockWipes++;   // 0012/0020's counter keeps its meaning
    solidWipes++;
    solidHits[h.why] = (solidHits[h.why] || 0) + 1;
    lastBlock = h;
    // specs/0030 §2 — the face's own normal, handed to the scrub. `h` was taken
    // BEFORE the slide (see solidAhead), so this is the surface as the body met
    // it and not as the slide left it.
    wipeHit = { nx: h.nx, nz: h.nz };
    wipeout(h.why);
  }

  // ---- physics/no-snag (a), the half that always works: THE PHASE-IN RESCUE.
  //
  // A horizontal push can only get a body out of geometry it is BESIDE. A body
  // that is INSIDE — the KT spine's shells are where this branch met it — has a
  // surface cutting through it between the feet and the eye, and pushing away
  // from the nearest wall only moves it to the middle of the chamber.
  // req-20260905-174625 measured the mechanism exactly: the ground probe looks
  // up only `stepUp` (0.55 m) from the feet, so a surface higher than that is
  // INVISIBLE to it and the body ends up under the picture — 12.02 m of phase-in
  // on the box chute before that request landed.
  //
  // So a body with a surface cutting through it is LIFTED ONTO that surface. Up
  // is always out: the surface is by definition at the body's own (x, z), so
  // nothing horizontal has to be guessed and no direction can be wrong.
  //
  // The floor is `stepUp + 0.05` — above the free climb — so an ordinary kerb is
  // still a kerb and this can never become a silent 4 m step-up. Returns true
  // when it fired.
  function phaseInRescue() {
    const cut = collision.groundAt(pos.x, pos.z, pos.y + T.eyeHeight * U);
    if (cut === null || cut - pos.y <= (T.stepUp + 0.05) * U) return false;
    // ...AND THE BODY HAS TO BE UNDER THE MOUNTAIN, not merely in front of a
    // bump. `cut` alone fires on ordinary terrain — a 0.66 m rise at the body's
    // own (x, z) is a step, and lifting a rider onto it at 24 m/s is a teleport
    // that measured as a KT-22 descent ending in the void net. Being INSIDE
    // means the surface goes on ABOVE you: the highest thing over this (x, z)
    // is more than `BURIED_OVER` up, which no rider on open snow can produce.
    const over = collision.groundAt(pos.x, pos.z, pos.y + T.eyeHeight * U + 40 * U);
    if (over === null || over - pos.y <= NOSNAG.BURIED_OVER * U) return false;
    const lift = Math.min(cut - pos.y, NOSNAG.PHASE_LIFT * U);
    pos.y += lift;
    depenFrames++;
    if (lift > depenMax) depenMax = lift;
    lastPush = { lift: +lift.toFixed(3), to: +cut.toFixed(2), phaseIn: true };
    if (vel.y < 0) vel.y = 0;
    return true;
  }

  // ---- specs/0058 req-20260905-215906: THE VOID IS WHERE THERE IS NO WORLD,
  // NOT WHERE THE FEET FOUND NOTHING.
  //
  // 0051 §2.8 #3/#4 respawn on `gy === null && pos.y < home.y - voidDrop`. The
  // second half is an ABSOLUTE FLOOR measured from the spawn, so on a run that
  // descends further than `voidDrop` it is true for the whole bottom half of the
  // mountain — the Palisades front is 200 m under its own spawn by the second
  // knuckle. That leaves the null carrying the entire verdict, and a null from
  // the ground probe means "nothing within reach BELOW the feet", which a body
  // that tunnelled through the surface produces just as readily as the void.
  //
  // The question the rule actually wants is unsigned: IS THERE A WORLD HERE AT
  // ALL. Over the void nothing is above the body either; inside the mountain
  // something is. This is `depenetrate()`'s own burial probe, asked the same way
  // and at the same height, so "buried" means one thing in this file. It costs
  // one ray, and only on the frames the old rule was about to respawn on.
  function underTheMountain() {
    return collision.groundAt(pos.x, pos.z, pos.y + T.eyeHeight * U + 40 * U) !== null;
  }

  // ---- physics/no-snag (a): PUSH OUT BEFORE YOU INTEGRATE.
  //
  // Runs at the head of the wall slide, which is the one place in the player
  // that already owns "the body and a face are in the same metre". Two probe
  // heights, the same pair everything else on this seam uses, because a body can
  // be clear at the knee and inside at the hip (that is what a leaning slot wall
  // does) and a single height would rescue one of them and leave the other.
  //
  // WALL FACES ONLY (`WALL_NY`). The floor belongs to the ground snap, and a
  // push-out that argued with it would lift a body off the slope it is standing
  // on. The push is horizontal for the same reason: vertical is gravity's and
  // the snap's, and nothing here gets to vote on it.
  //
  // BOUNDED, and the bound is the interesting half. `PUSH_MAX` per frame means a
  // body five metres inside a rib walks out over a handful of frames rather than
  // teleporting, so a rescue looks like being squeezed out and not like a cut.
  //
  // ...and the closing half of the velocity goes with it. Without that the body
  // is pushed out on this frame and drives straight back in on the next, which
  // is a buzz rather than a fix. The TANGENTIAL half is untouched — that is (b),
  // and it is why this is a slide and not a stop.
  function depenetrate(dt) {
    if (!collision.nearestFace) return;   // a host on an older soup still plays
    // Is there surface over the body's own head? That is the cheap burial test,
    // and it is what buys the big search radius the deep case needs without
    // paying for it on the 99 % of frames that are ordinary contact.
    // ---- IS THERE SURFACE OVER THE BODY? That is the cheap burial test, and
    // it buys the big search radius the deep case needs without paying for it
    // on the 99 % of frames that are ordinary contact.
    //
    // It is deliberately the LOOSE test and not "geometry cuts through the
    // body". Measured both ways: the tight version is true only while a face is
    // between the feet and the eye, which a body that has fallen RIGHT THROUGH
    // a rib and is sitting under its underside does not satisfy — and the sweep
    // went from 0 buried frames to 263 and a respawn when it was tried. False
    // positives here cost one extra query on a body under an overhang; false
    // negatives cost a body left inside the mountain.
    let r = NOSNAG.PUSH_R;
    const over = collision.groundAt(pos.x, pos.z, pos.y + T.eyeHeight * U + 40 * U);
    const buried = over !== null && over - pos.y > NOSNAG.BURIED_OVER * U;
    if (buried) { r = NOSNAG.BURIED_R * U; buriedFrames++; }
    // ---- THE PHASE-IN RESCUE, and it is the one escape that always works.
    //
    // A horizontal push can only get a body out of geometry it is beside. A body
    // that is INSIDE — the KT spine's shells are where this branch met it — has
    // a surface cutting through it between the feet and the eye, and pushing
    // away from the nearest wall just moves it to the middle of the chamber.
    // req-20260905-174625 measured the mechanism: the ground probe looks up only
    // `stepUp` (0.55 m) from the feet, so a surface higher than that is INVISIBLE
    // to it and the body ends up under the picture — 12.02 m of phase-in on the
    // box chute before that request landed.
    //
    // So when the body is buried AND a surface is cutting through it, the body
    // is lifted ONTO that surface, bounded per frame. Up is always out: the
    // surface is by definition at the body's own (x, z), so nothing horizontal
    // has to be guessed.
    //
    // The floor is `stepUp + 0.05`, above the free climb, so an ordinary kerb is
    // still a kerb and this cannot become a silent step-up of 1.6 m.
    if (phaseInRescue()) return;
    let px = 0, pz = 0, best = 0, face = null;
    contact = null;
    for (const hgt of [T.stepUp + 0.12, 1.35 * U]) {
      const f = collision.nearestFace(pos.x, pos.y + hgt, pos.z, r, WALL_NY);
      if (!f) continue;
      // specs/0057 §2.4 rule 1 — the jib the rider is locked onto does not push
      // back. One mesh, one flag, and the flag is only ever true while rail.js
      // is holding the body to a line.
      if (railHold && f.mesh === RAIL_MESH) continue;
      // THE CONTACT, recorded whether or not a push is owed. A body standing at
      // the FOOT of a cliff on 31 deg snow is touching a wall it is not inside
      // of and is not moving into — no ray fired along a 0.2 m/s move reaches
      // it — and it is that body, told to go forward, that used to sit there
      // oscillating at 0.25 m/s forever. The slide needs a normal to redirect
      // along and this is the one it has already paid for.
      if (hgt > 1.0 * U && f.dist < (T.radius * U + 0.35 * U)) {
        const cl = Math.hypot(f.nx, f.nz);
        if (cl > 1e-6) contact = { nx: f.nx / cl, nz: f.nz / cl, cls: f.cls, mesh: f.mesh, dist: f.dist };
      }
      // how far out of THIS face the body still has to come. Inside the body
      // radius is a penetration; beyond it there is nothing to fix — AND THAT
      // IS TRUE WHEN BURIED TOO. The first cut read `r - dist` on a buried
      // frame, which saturates the cap by construction: a body 0.95 m clear of
      // a face was shoved 1.6 m sideways every frame simply because something
      // was over its head, and one of those shoves put a KT-22 descent off a
      // ledge and into the void net. Burial widens the SEARCH, never the NEED;
      // getting out of the mountain is `phaseInRescue()`'s job and it goes up.
      const need = T.radius * U - f.dist;
      if (need <= 1e-4) continue;
      const hx = f.nx, hz = f.nz;
      const hl = Math.hypot(hx, hz);
      if (hl < 1e-6) continue;            // a horizontal push has no direction here
      if (need > best) { best = need; face = { nx: hx / hl, nz: hz / hl, cls: f.cls, mesh: f.mesh, dist: f.dist }; }
    }
    if (!face) return;
    const push = Math.min(best, NOSNAG.PUSH_MAX * U);
    px = face.nx * push; pz = face.nz * push;
    pos.x += px; pos.z += pz;
    depenFrames++;
    if (push > depenMax) depenMax = push;
    lastPush = { ...face, push: +push.toFixed(3) };
    // ...and take the CLOSING half off, keeping the tangential half (b).
    const vn = vel.x * face.nx + vel.z * face.nz;
    if (vn < 0) { vel.x -= face.nx * vn; vel.z -= face.nz * vn; }
  }

  // ---- physics/no-snag (d): NOTHING MAY STAY STUCK.
  //
  // The net under (a)-(c), and its count is the assertion rather than its
  // behaviour: if the three rules above are doing their job this never fires,
  // and the sweep asserts `unstickNudges === 0`. It exists because a net that is
  // never needed still has to be there the one time the geometry is stranger
  // than the rules — and because "the body stopped and the key is held" is a
  // state the player can always see and the physics never should.
  //
  // The nudge goes along the face's own DOWNHILL TANGENT: the steepest descent
  // direction on the face plane, projected flat. On a near-vertical face that
  // is degenerate (a plumb wall has no downhill in plan), so it falls back to
  // whichever horizontal tangent best matches where the body was trying to go.
  function unstick(dt, wanted, spNow) {
    if (!collision.nearestFace) return;
    // THE SPEED THAT COUNTS IS THE ONE THE BODY WILL ACTUALLY HAVE. `vel` here is
    // still the gear model's, taken BEFORE the slide had its say — and a body
    // pinned to a face chatters between a hopeful 3 m/s of intent and 0.1 m/s of
    // motion, which resets the dwell timer every other frame and is why the
    // first cut of this net fired 3 times against 5,642 stuck frames. `spNow`
    // is the slid move over dt: what the caller is about to write back.
    const sp = spNow === undefined ? Math.hypot(vel.x, vel.z) : spNow;
    const held = keys.forward || keys.back || keys.left || keys.right || keys.flipFwd || keys.flipBack;
    // THE WINDOW IS NOT GATED ON SPEED, and that is the last of the three ways
    // this net managed to never fire. `sp` flickers above 0.3 twice a frame
    // under static friction, and any early return that resets the timer on it
    // resets the timer forever. Held + not wiping + a face is the whole of what
    // opens the window; what closes it is DISTANCE, judged once, below.
    if (!held || wipeT > 0) { stuckT = 0; stuckFrom = null; return; }
    // AGAINST A FACE, and the qualifier is load-bearing — twice over.
    //
    // A body at rest on flat snow with the key held is not stuck, it is a body
    // on a flat spot. And a body that has simply run out of momentum pointing
    // UPHILL is not stuck either: the sweep measures ~175 such frames per
    // feature on rider/v3 AND the same ~175 after, because a rider who skis at a
    // 49 deg face at 8 m/s stalls partway up it whatever the collision layer
    // does. He is standing ON that face, not held BY it, and he leaves by
    // turning round.
    //
    // The probe is therefore at the HIP and not the knee. A face you are
    // STANDING on is a body-radius away at the knee and most of a metre away at
    // the hip; a face that is HOLDING you is inside the radius at both. One
    // height is the whole discriminator and it costs nothing.
    //
    // Asked BEFORE the dwell, so `stuckFrames` counts the state the sweep
    // asserts on rather than every slow frame on the mountain.
    const f = contact || collision.nearestFace(pos.x, pos.y + 1.35 * U, pos.z, T.radius * U + 0.35 * U, WALL_NY);
    if (!f) { stuckT = 0; stuckFrom = null; return; }
    if (sp < NOSNAG.STUCK_V * U) stuckFrames++;
    if (!stuckFrom) { stuckFrom = { x: pos.x, z: pos.z }; stuckT = 0; }
    stuckT += dt;
    if (stuckT < NOSNAG.STUCK_T) return;
    // HOW FAR DID HALF A SECOND ACTUALLY BUY? Under the rule's own numbers,
    // 0.3 m/s for 0.5 s is 0.15 m of ground. Less than that, against a face,
    // with the key held, is stuck however fast the speedometer flickered.
    const moved = Math.hypot(pos.x - stuckFrom.x, pos.z - stuckFrom.z);
    stuckT = 0; stuckFrom = { x: pos.x, z: pos.z };
    if (moved >= NOSNAG.STUCK_V * NOSNAG.STUCK_T * U) return;
    const n = { x: f.nx, y: f.ny, z: f.nz };
    // steepest descent on the plane of the face, flattened
    let tx = n.x * n.y, tz = n.z * n.y;
    let tl = Math.hypot(tx, tz);
    if (tl < 0.05) {
      // plumb face: use the wish direction with the normal component removed
      const wl = Math.hypot(wanted.x, wanted.z) || 1;
      const wx = wanted.x / wl, wz = wanted.z / wl;
      const d = wx * n.x + wz * n.z;
      tx = wx - n.x * d; tz = wz - n.z * d;
      tl = Math.hypot(tx, tz);
      if (tl < 1e-4) { tx = -n.z; tz = n.x; tl = 1; }   // last resort: run the wall
    }
    vel.x = (tx / tl) * NOSNAG.NUDGE_V * U + n.x * 0.4 * U;
    vel.z = (tz / tl) * NOSNAG.NUDGE_V * U + n.z * 0.4 * U;
    unstickNudges++;
  }

  // THE WALL SLIDE. physics/no-snag (a) and (b) live in here, and the call sites
  // gained exactly one argument — `dt` — because a push-out and a friction rate
  // are both per-second quantities and a move is not.
  function slide(mx, mz, dt = 1 / 60) {
    depenetrate(dt);                          // (a) — before anything is integrated
    let len = Math.hypot(mx, mz);
    if (len < 1e-6) { unstick(dt, { x: 0, z: 0 }, 0); return [mx, mz]; }
    const len0 = len, mx0 = mx, mz0 = mz;
    let rockContact = false, last = null;
    for (let iter = 0; iter < 4 && len > 1e-6; iter++) {
      const dx = mx / len, dz = mz / len;
      let blocked = null;
      for (const hgt of [T.stepUp + 0.12, 1.35 * U]) {
        const p = probe(dx, dz, len + T.radius * U, hgt);
        if (p && (!blocked || p.dist < blocked.dist)) blocked = p;
      }
      if (!blocked) break;
      last = blocked;
      if (blocked.cls === CLASS_ROCK) rockContact = true;
      // ---- (b) PROJECT AND KEEP. The move loses its closing component and
      // keeps everything perpendicular to it; a face is a rail, never a stop.
      const d = mx * blocked.nx + mz * blocked.nz;
      if (d < 0) { mx -= blocked.nx * d; mz -= blocked.nz * d; }
      else break;
      len = Math.hypot(mx, mz);
    }
    // ---- (b) NEVER ZEROED, and this is the half that has teeth.
    //
    // The projection above is exactly right and, on a head-on meeting, exactly
    // nothing: the tangential component of a move aimed square at a face IS
    // zero, so the loop hands back a move of zero and the body glues to the wall
    // for as long as the key is held. Every one of the sweep's four-hundred-odd
    // stuck frames on the box chute was that, and no amount of push-out fixes
    // it, because the body is not inside anything — it is politely stopped.
    //
    // So the remainder is redirected rather than deleted. WHICH WAY along the
    // face is decided in the order a rider would decide it:
    //
    //   1. the way you were already leaning, if the original move had any
    //      tangential preference at all (a 10 deg approach keeps going its way);
    //   2. otherwise DOWNHILL — sample the ground a metre along each tangent and
    //      take the lower one, which is the face's own downhill in plan and
    //      needs no gradient the soup does not already answer for.
    //
    // Only while the input is HELD. A body let go of against a wall is allowed
    // to stand there; this is about a rider asking to move and being refused.
    const held = keys.forward || keys.back || keys.left || keys.right || keys.flipFwd || keys.flipBack;
    // ...and the trigger is a SPEED, not only a ratio. A ratio alone leaves the
    // body creeping: the projection can honestly retain 25 % of a move that was
    // already down to 0.8 m/s, ski.js's lateral grip (6/s) then charges that
    // survivor as a sideways ski and takes it back, and the pair of them hold a
    // body against a wall at 0.3 m/s indefinitely. So a face a rider is asking
    // to move along ALWAYS hands back at least `KEEP_V`.
    // `contact` is the fallback, and it is the half that catches the cliff FOOT:
    // a body creeping at 0.2 m/s fires a 0.6 m ray that reaches nothing, so
    // `last` is null and there is no normal to redirect along even though the
    // wall is 0.36 m from the body's hip. Depenetration already found it.
    let face = last || contact;
    // ...and if neither found one, ASK. One `nearestFace` on a frame that is
    // already too slow to matter, which is the only frame that can reach here:
    // `contact` is whatever depenetration happened to be looking at, and on a
    // buried frame it was looking five metres out. This makes the fallback a
    // fact rather than a leftover.
    if (!face && held && len0 < T.treeWipeV * dt && len < NOSNAG.KEEP_V * U * dt && collision.nearestFace) {
      const q = collision.nearestFace(pos.x, pos.y + 1.35 * U, pos.z, T.radius * U + 0.35 * U, WALL_NY);
      const ql = q ? Math.hypot(q.nx, q.nz) : 0;
      if (ql > 1e-6) face = { nx: q.nx / ql, nz: q.nz / ql, cls: q.cls };
    }
    // ---- AND ONLY BELOW THE WIPE FLOOR. This is the seam between the two
    // halves of Greg's sentence, and it is `treeWipeV` because that is already
    // the speed below which nothing in this game puts you down:
    //
    //   below it  a face may never trap you — it hands back `KEEP_V` along
    //             itself, every time, and you scrape past;
    //   above it  a face that stops you dead is a CRASH, and `solidAhead()` has
    //             already judged it one frame earlier.
    //
    // Without the seam the redirect is a rail: measured, a rider leaving the
    // KT-22 summit at 24 m/s met the spine wall, was handed half his speed
    // along it, and rode that wall 370 m west off the edge of the terrain into
    // the void net — 45.5 m of a 481 m descent, and a respawn. A rescue that
    // steers is not a rescue.
    const slow = len0 < T.treeWipeV * dt;
    if (face && held && slow && len < Math.max(len0 * NOSNAG.KEEP_MIN, NOSNAG.KEEP_V * U * dt)) {
      let tx = -face.nz, tz = face.nx;
      const tan0 = mx0 * tx + mz0 * tz;
      let s = 0;
      if (Math.abs(tan0) > 0.05 * len0) s = tan0 > 0 ? 1 : -1;
      else {
        const d = 1.0 * U;
        const gA = collision.groundAt(pos.x + tx * d, pos.z + tz * d, pos.y + T.stepUp);
        const gB = collision.groundAt(pos.x - tx * d, pos.z - tz * d, pos.y + T.stepUp);
        if (gA === null && gB === null) s = 1;
        else if (gA === null) s = -1;
        else if (gB === null) s = 1;
        else s = gB < gA ? -1 : 1;
      }
      const keep = Math.max(len0 * NOSNAG.KEEP_OUT, NOSNAG.KEEP_V * U * dt);
      // ...and A SLOT HAS TWO WAYS OUT. The first cut redirected one way,
      // re-tested it against the other wall of the notch, watched the
      // projection eat it, and gave up — which on the GS Bowl bands (a notch
      // between two cliff bands, where the export build's crop puts the anchor)
      // was 103 stuck frames of a body scraping one wall into the other. Both
      // signs are tried and the longer survivor wins; along a crease that is the
      // crease, and against a single wall the two are the same answer.
      let bx = 0, bz = 0, bl = -1;
      for (const sg of (s ? [s, -s] : [1, -1])) {
        let cx = tx * sg * keep, cz = tz * sg * keep;
        const rl = Math.hypot(cx, cz) || 1;
        for (const hgt of [T.stepUp + 0.12, 1.35 * U]) {
          const p = probe(cx / rl, cz / rl, rl + T.radius * U, hgt);
          if (!p) continue;
          const d2 = cx * p.nx + cz * p.nz;
          if (d2 < 0) { cx -= p.nx * d2; cz -= p.nz * d2; }
        }
        const cl = Math.hypot(cx, cz);
        if (cl > bl) { bl = cl; bx = cx; bz = cz; }
        // the PREFERRED sign wins outright when it survives; the other is only
        // consulted because the preferred one did not.
        if (bl >= keep * 0.9) break;
      }
      mx = bx; mz = bz;
      len = Math.hypot(mx, mz);
    }
    // ...and the ONE thing allowed to take speed off the tangential half: a rock
    // face scrapes. As a RATE (`ROCK_TAN` per second), so a long graze down a
    // granite band costs something and a single frame of contact costs 0.5 %.
    // Snow faces cost nothing at all — you are on your edges, not your hip.
    if (rockContact && len > 1e-6) {
      const f = Math.exp(Math.log(NOSNAG.ROCK_TAN) * dt);
      mx *= f; mz *= f;
    }
    // (d)'s input: WHERE THE BODY WAS TRYING TO GO this frame, taken before the
    // wall had an opinion about it — the unslid move, which is the velocity the
    // gear model handed over. Read only when the nudge actually fires.
    unstick(dt, { x: mx0 / len0, z: mz0 / len0 }, len / Math.max(1e-6, dt));
    return [mx, mz];
  }

  // THE ONE PLACE A WIPEOUT IS SPENT. Every source — skis crossed on a landing,
  // a rotation left open, a trunk, a rock band — pays exactly the same price, so
  // "you ate it" reads the same however you got there. `why` is what the HUD's
  // WIPEOUT card prints. Zeroing the air is part of the price: whatever you were
  // in the middle of is over, and it also stops a landing judged later in the
  // same frame from overwriting this verdict with its own.
  //
  // ---- specs/0028 §1: AND THE SPIN KEEPS ITS SIGN.
  //
  // `deg` is a magnitude and stays one — the HUD's WIPEOUT stamp prints it and
  // tricks.js reads it as a rotation count, and neither wants a negative. So the
  // direction rides ALONGSIDE it as `spinDir`, read here, on the line before the
  // air is zeroed, which is the last instant it exists at all: −1 or +1 for a
  // rotation left open, 0 when there was no air to spin in (every contact wipe,
  // and any landing that never left the ground).
  //
  // This is the one source. main.js's rig used to recover the sign by watching
  // `airSpinDeg` frame by frame and keeping the last one it saw over 5° — which
  // worked, but latched across accidents and needed the harness to hand it an
  // animation frame at exactly the right moment (specs/0015 §5b round 5). The
  // event carries it now.
  //
  // ---- specs/0030 §2: AND IT THROWS YOU FOUR TIMES AS FAR.
  //
  // The old price was one line — 70 % of the speed, gone, whatever hit you. That
  // is why 0015's tumble was a body that stopped and then lay down: at 12 m/s
  // into a fir you kept 3.6 m/s and the hill took that back inside a third of a
  // second, so the whole 0.9 s happened inside a metre.
  //
  // Two changes and no third. A CONTACT is split about the surface it hit: the
  // tangential half — the half that was going to carry you past the tree anyway
  // — mostly survives, and the closing half comes back out along the normal at
  // `REST`, which is the bounce. A landing you merely fluffed has no surface to
  // split about and takes the plain scrub. Both are measured off `velPre`, the
  // velocity this frame STARTED with, because the wall slide and the stem
  // push-out have already run by the time we are called and what they leave
  // behind is a body that has politely come to rest.
  //
  // The other half of the toss is `update()`'s wipe drag, which takes it back
  // off you again over the slide — see there. Without it a 4x toss is a 4x
  // toss that is still doing 6 m/s when the body stands up.
  function wipeout(why, spinDeg = 0) {
    const spinDir = airSpin > 0 ? 1 : airSpin < 0 ? -1 : 0;
    const h = wipeHit; wipeHit = null;
    if (h) {
      const vn = velPre.x * h.nx + velPre.z * h.nz;      // < 0 = still closing
      const tx = (velPre.x - h.nx * vn) * WIPE.TAN;
      const tz = (velPre.z - h.nz * vn) * WIPE.TAN;
      const b = vn < 0 ? -vn * WIPE.REST : 0;            // ...and out again
      vel.x = tx + h.nx * b; vel.z = tz + h.nz * b;
    } else {
      // the shape the old line had, with the old 0.30 opened up: a fluffed
      // landing has no surface to split about, so this stays a plain multiply on
      // the velocity the landing itself left behind
      vel.x *= WIPE.SCRUB; vel.z *= WIPE.SCRUB;
    }
    wipeT = WIPE.LEN;
    lastTrick = { name: 'wipeout', deg: Math.round(spinDeg), spinDir, why };
    events.wipe = { ...lastTrick };
    airSpin = 0; airTime = 0;
    // ---- specs/0056 §1/§2/§3, all three off ONE number, scored here because this
    // is the only place that still holds `velPre` — the pre-scrub speed. Three
    // lines up the scrub has already spent it.
    const sp = Math.hypot(velPre.x, velPre.z);
    const q = clamp((sp - SHED.I_MIN) / (SHED.I_MAX - SHED.I_MIN), 0, 1);
    snow.I = Math.pow(q, SHED.I_SHAPE);
    snow.tier = snow.I < SHED.T1 ? 0 : snow.I < SHED.T2 ? 1 : snow.I < SHED.T3 ? 2 : 3;
    snow.deltaS = SNOW.ADD0 + SNOW.ADD1 * snow.I;
    // §3 — the block is armed by the wipe that OVERFLOWS, and spent INSIDE the
    // tumble it armed (specs/0056a §A: closes at ICEW.AT, breaks at the get-up).
    // A wipe that lands on top of a running one restarts the whole sequence, so
    // the old block goes with the old clock rather than outliving its `iceArmed`.
    snow.frozen = false;
    iceArmed = snow.S + snow.deltaS > SNOW.MAX;
    snow.S = Math.min(SNOW.MAX, snow.S + snow.deltaS);
    snow.wipes++;
    getUp = true;
    if (snow.tier > 0 && !gearOut) { gearOut = true; snow.shedSeq++; }
  }

  // ---- specs/0012 §A: TREES ARE SOLID.
  //
  // A trunk is not in the triangle soup and should not be: a fir is 30 m of
  // needles around a 60 cm stem, and putting the canopy in the soup would make
  // it a floor you could stand on. solids.js keeps the stems in their own 8 m
  // hash instead, so this query is O(cell) — at most four cells read, however
  // many firs the world placed — and not O(trees).
  //
  // Run on EVERY step, grounded or airborne. Skipping it in the air would let
  // you clear a glade by hopping, which is the opposite of what a glade is.
  // ---- specs/0012 §E4: and the push-out NEVER stops running.
  //
  // This function used to return early while `wipeT > 0`. That switched off the
  // whole guard for the 2.0 s of the tumble — and the tumble is exactly when
  // the body is a ragdoll drifting sideways with no input, so it drifted into
  // the trunk it had just hit and Greg got to look out through the stump.
  //
  // The wipe TRIGGER is the only thing the tumble suppresses. Solid is solid.
  //
  // ---- specs/0051 D-20: AND A STAND IS SOLID ALL AT ONCE.
  //
  // Greg, 2026-09-06: full forest collision density. `COLLIDE_KEEP` goes to 1.0
  // and every drawn fir gets a trunk, which takes the reference stand from 144
  // to 400 stems a hectare and puts FOURTEEN trunks inside 6 m of the body.
  //
  // The loop this replaces was three passes of `stemHit`, and `stemHit` answers
  // with the DEEPEST SINGLE TRUNK: each pass pushed out of one and, as often as
  // not, into another. D-19 measured what that costs at 400 /ha — the rider sat
  // at exactly 0.00 m/s against a trunk for the last ten seconds of a
  // thirty-second run, which is Greg's "getting caught is a bug" with bark on
  // it.
  //
  // So the guard sees the WHOLE contact set and solves against it:
  //
  //   (1) POSITION. `stemContacts` gathers every overlapping trunk (O(cell),
  //       the same four cells `stemHit` reads) and `STEM.PASSES` Gauss-Seidel
  //       passes push out of them one at a time, RE-MEASURING each contact at
  //       the position the previous correction left. Sequential and not
  //       simultaneous, because two opposing normals summed at once cancel to
  //       nothing and that cancellation IS the pocket; sequential with a fresh
  //       gather each pass walks the body out along whatever gap exists and
  //       picks up the trunks the correction moved it into.
  //
  //   (2) VELOCITY. Every contact normal takes its closing component off `vel`
  //       — a one-pass sequential impulse, so the tangential remainder survives
  //       by construction instead of being zeroed by the last normal applied.
  //
  //   (3) GLIDE. What survives (2) between two trunks is nearly nothing, and a
  //       body that arrives at 18 m/s and leaves at 0.4 is caught however
  //       correct its position is. So below `STEM.GLIDE_KEEP` of the ARRIVAL
  //       speed the remainder is REDIRECTED along the best trunk tangent — the
  //       one closest to where the body was going that is not closing on any
  //       other contact — at the glide floor. That is NOSNAG's
  //       KEEP_MIN/KEEP_OUT/KEEP_V for faces, said again for trunks, and it is
  //       the same sentence: you scrape past instead of gluing on.
  //
  //   (4) EJECT, and the count is the assertion. A body still in contact after
  //       `STEM.PASSES` is in a pocket the union will not let it out of one
  //       normal at a time. It is marched out along its own velocity (or, at
  //       rest, the local downhill) and put at the first clear point inside
  //       `STEM.EJECT_MAX`. Like `unstickNudges`, `stemEjects` is 0 on a healthy
  //       build and the probe prints it.
  //
  //   (5) AND THE WIPE IS NEAR-90 ONLY, which is the one rider-feel change.
  //       A trunk used to wipe on ANY touch at or above `treeWipeV`. At 61 /ha
  //       that is a tree you skied into; at 400 /ha it is every graze in the
  //       glade, and "I always want things to be rideable" cannot survive it.
  //       So a trunk now reads the SAME rule `blockedAhead()` reads for rock and
  //       `[3c]` asserts for faces: `NOSNAG.INTO`, cos 20° off head-on = 70°
  //       off tangential. One number for every solid in the world.
  const STEM = {
    PASSES: 8,             // Gauss-Seidel passes. Fourteen trunks inside 6 m is
                           // the measured worst case and a set with a free
                           // direction converges in a handful; this is the bound
                           // a while-loop against float geometry would not be.
    RELAX: 1.0,            // full correction per contact per pass
    MAX_CONTACTS: 16,      // the same 6 m disc at 400 /ha holds fourteen
    SKIN: 1e-3,            // the extra millimetre: pushing out by exactly `pen`
                           // lands the body ON the cylinder, where float
                           // rounding leaves it inside as often as out
    GLIDE_KEEP: 0.65,      // x of the arrival speed a contact must leave you
    GLIDE_V: NOSNAG.KEEP_V,// ...with the same floor a face hands back (2.20 m/s)
    EJECT_STEP: 0.35,      // m — the march out of a pocket
    EJECT_MAX: 6.0,        // m — and how far it may ever go
  };
  const stemSet = [];                       // reused contact array: no allocation
  const _sp = { nx: 0, nz: 0 };             // reused probe output
  const stemN = new Float64Array(STEM.MAX_CONTACTS * 2);   // the FIRST set's normals
  let stemEjects = 0, stemGlides = 0, stemMaxSeen = 0, stemPassMax = 0;
  let lastStem = null;
  // the resolver's own cost, for the acceptance's p95. Off by default — two
  // performance.now() calls a step are cheap but they are not free, and a
  // profile that is always on is a measurement of itself.
  let stemProf = null, stemProfAt = 0;

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function stemProfPush(ms) {
    stemProf[stemProfAt % stemProf.length] = ms;
    stemProfAt++;
  }

  function stemGather(x, z) {
    if (collision.stemContacts)
      return collision.stemContacts(x, pos.y, z, T.radius, U, stemSet, STEM.MAX_CONTACTS);
    // a host that predates D-20 still gets the old behaviour, one trunk at a time
    const h = collision.stemHit(x, pos.y, z, T.radius, U);
    if (!h) return 0;
    stemSet[0] = h;
    return 1;
  }

  function stemPen(i, x, z) {
    if (collision.stemProbe) return collision.stemProbe(i, x, pos.y, z, T.radius, U, _sp);
    const h = collision.stemHit(x, pos.y, z, T.radius, U);
    if (!h || h.i !== i) return 0;
    _sp.nx = h.nx; _sp.nz = h.nz;
    return h.pen;
  }

  // The way out of a pocket: march along (dx, dz) until nothing is touching.
  // Returns the distance, or -1 if this direction never clears.
  function stemMarch(x, z, dx, dz) {
    for (let s = STEM.EJECT_STEP; s <= STEM.EJECT_MAX + 1e-6; s += STEM.EJECT_STEP) {
      const qx = x + dx * s, qz = z + dz * s;
      const clear = collision.stemClear
        ? collision.stemClear(qx, pos.y, qz, T.radius, U)
        : !collision.stemHit(qx, pos.y, qz, T.radius, U);
      if (clear) return s;
    }
    return -1;
  }

  function stemGuard() {
    if (!collision.stemHit) return;               // host with no stem index
    const t0 = stemProf ? nowMs() : 0;
    // `lastStem` is a PER-STEP fact — "the guard met a trunk on this step" — and
    // the probe reads it as exactly that. Left set across the steps that touch
    // nothing it would say a trunk is on the body for every frame after the last
    // one that was, which is the opposite of what it is read for.
    lastStem = null;
    // the verdict is on the speed you ARRIVED with, not on the tangential
    // remainder the push-out is about to leave you holding
    let arrival = Math.hypot(vel.x, vel.z);
    // ...and the speed the GLIDE is measured against is this one, snapshotted
    // here and never reassigned. `arrival` is substituted for `canopyV` below
    // when the last half second was this same tree's own branches (§E2's
    // canopyCarry) — that substitution is the WIPE's verdict and only the
    // wipe's. Letting the glide read it too would hand back the speed the
    // needles legitimately took, which is §E2 undone by §E1's rescue.
    const arriveV = arrival;
    const ax = arrival > 1e-6 ? vel.x / arrival : 0;
    const az = arrival > 1e-6 ? vel.z / arrival : 0;
    // THE FLOOR IS NOT CAPPED BY THE ARRIVAL SPEED, and that cap is the bug
    // NOSNAG.KEEP_V's own note is about: "a body already parked has a tiny move
    // to redirect, so half of tiny is tiny and it stays parked". Measured here
    // too — with the floor capped at `arrival` the 120° lane through the dense
    // stand spent 759 of 900 frames held by a trunk at 0.3 m/s, the glide
    // firing 235 times and handing back 0.3 m/s every time. A rider ASKING to
    // move gets walking pace off a trunk whatever the contact ate, exactly as
    // he gets it off a face. A body with no input on it is not asking, and is
    // never accelerated: it keeps the cap.
    const held = keys.forward || keys.back || keys.left || keys.right || keys.flipFwd || keys.flipBack;
    const glideFloor = () => {
      const f = Math.max(arriveV * STEM.GLIDE_KEEP, STEM.GLIDE_V * U);
      return held ? f : Math.min(arriveV, f);
    };
    let px = pos.x, pz = pos.z;
    let touched = false, touchedI = -1, n0 = 0;
    let nx0 = 0, nz0 = 0;                         // specs/0030 §2 — the bark's normal
    let n = 0, pass = 0;
    for (pass = 0; pass < STEM.PASSES; pass++) {
      n = stemGather(px, pz);
      if (!n) break;
      if (!touched) {
        // the FIRST set: the trunks that were actually touching on arrival.
        // (1) walks the body away from here, so the velocity solve and the wipe
        // both have to read the meeting and not the exit.
        touched = true;
        nx0 = stemSet[0].nx; nz0 = stemSet[0].nz; touchedI = stemSet[0].i;
        n0 = n;
        for (let k = 0; k < n; k++) { stemN[k * 2] = stemSet[k].nx; stemN[k * 2 + 1] = stemSet[k].nz; }
        if (n > stemMaxSeen) stemMaxSeen = n;
      }
      for (let k = 0; k < n; k++) {
        const pen = stemPen(stemSet[k].i, px, pz);
        if (pen <= 0) continue;
        px += _sp.nx * (pen * STEM.RELAX + STEM.SKIN);
        pz += _sp.nz * (pen * STEM.RELAX + STEM.SKIN);
      }
    }
    if (!touched) { if (stemProf) stemProfPush(nowMs() - t0); return; }
    if (pass > stemPassMax) stemPassMax = pass;

    // ---- (4) THE POCKET. Still in contact after every pass: the union has no
    // way out along any single normal. Leave along where the body was going, or
    // — at rest — down the hill, which is the way a ski would go anyway.
    let ejected = false;
    if (n) {
      let ex = ax, ez = az;
      if (arrival <= 0.5 * U) {
        const D = 1.0 * U;
        const h0 = collision.groundAt(px, pz);
        const gp = (x, z) => { const g = collision.groundAt(x, z); return g === null || g === undefined ? h0 : g; };
        const gx = gp(px + D, pz) - gp(px - D, pz);
        const gz = gp(px, pz + D) - gp(px, pz - D);
        const gl = Math.hypot(gx, gz);
        if (gl > 1e-6) { ex = -gx / gl; ez = -gz / gl; } else { ex = 1; ez = 0; }
      }
      // candidates: the way out first, then straight out of the union, then the
      // compass. The shortest march that clears wins, so an eject is the
      // smallest translation the pocket allows and never a blink.
      let sx = 0, sz = 0;
      for (let k = 0; k < n0; k++) { sx += stemN[k * 2]; sz += stemN[k * 2 + 1]; }
      const sl = Math.hypot(sx, sz);
      let bestD = -1, bx = 0, bz = 0;
      const tryDir = (dx, dz) => {
        const l = Math.hypot(dx, dz);
        if (l < 1e-6) return;
        const s = stemMarch(px, pz, dx / l, dz / l);
        if (s > 0 && (bestD < 0 || s < bestD)) { bestD = s; bx = dx / l; bz = dz / l; }
      };
      tryDir(ex, ez);
      if (sl > 1e-6) tryDir(sx / sl, sz / sl);
      if (bestD < 0) for (let a = 0; a < 8; a++) tryDir(Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4));
      if (bestD > 0) {
        px += bx * bestD; pz += bz * bestD;
        // ...and come out MOVING. A body put down at rest in a glade is the same
        // bug one frame later.
        const out = glideFloor();
        vel.x = bx * out; vel.z = bz * out;
        stemEjects++;
        ejected = true;
      }
    }
    pos.x = px; pos.z = pz;

    // ---- (2) the velocity solve, over the set that was actually touching
    if (!ejected) {
      for (let k = 0; k < n0; k++) {
        const nx = stemN[k * 2], nz = stemN[k * 2 + 1];
        const into = vel.x * nx + vel.z * nz;     // < 0 = still heading at it
        if (into < 0) { vel.x -= nx * into; vel.z -= nz * into; }
      }
    }

    // ---- (5) the wipe verdict, BEFORE the glide puts speed back on. §E4 — the
    // push-out above has already run; THIS is the part the tumble suppresses:
    // one trunk is one wipeout, and the 108 frames the body spends sliding down
    // the same trunk are not 108 more of them.
    let wiped = false;
    if (wipeT <= 0) {
      // ...unless the last three metres were this tree's own branches. §E2's drag
      // exists to make foliage feel soft, not to make the trunk behind it safe.
      if (touchedI >= 0 && touchedI === inCanopy && canopyT <= T.canopyCarry && canopyV > arrival) {
        arrival = canopyV;
      }
      treeHits++;
      // D-20 (5): near-90 only, on the controller's OWN measurement of the
      // meeting — `into` is cos(angle off head-on) against the bark's normal,
      // which is what `[3c]` prints and what `blockedAhead()` reads for rock.
      const into = -(ax * nx0 + az * nz0);
      lastStem = { i: touchedI, into: +into.toFixed(4), closing: +arrival.toFixed(2),
                   contacts: n0, passes: pass, ejected };
      if (arrival >= T.treeWipeV && into >= NOSNAG.INTO) {
        wipeHit = { nx: nx0, nz: nz0 };    // specs/0030 §2 — split about the bark
        wipeout('tree');
        wiped = true;
      }
    }

    // ---- (3) THE GLIDE. Not on a wipe (the toss owns the velocity then), and
    // not on an eject (which already handed one back along its own way out).
    if (!wiped && !ejected && arriveV > 1e-6) {
      const after = Math.hypot(vel.x, vel.z);
      const floor = glideFloor();
      if (after < floor) {
        // the best trunk tangent: closest to where the body was going, and not
        // closing on any OTHER contact — gliding out of one trunk into the next
        // is how the three-pass loop got here in the first place
        let bd = -2, bx = 0, bz = 0;
        for (let k = 0; k < n0; k++) {
          const nx = stemN[k * 2], nz = stemN[k * 2 + 1];
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            const tx = -nz * sgn, tz = nx * sgn;
            let okAll = true;
            for (let j = 0; j < n0; j++) {
              if (tx * stemN[j * 2] + tz * stemN[j * 2 + 1] < -0.10) { okAll = false; break; }
            }
            if (!okAll) continue;
            const d = tx * ax + tz * az;
            if (d > bd) { bd = d; bx = tx; bz = tz; }
          }
        }
        if (bd <= -2) {
          // no tangent clears the union: leave along the summed normal, which is
          // the shortest way out of the whole set
          let sx = 0, sz = 0;
          for (let k = 0; k < n0; k++) { sx += stemN[k * 2]; sz += stemN[k * 2 + 1]; }
          const sl = Math.hypot(sx, sz);
          if (sl > 1e-6) { bx = sx / sl; bz = sz / sl; } else { bx = ax; bz = az; }
        }
        vel.x = bx * floor; vel.z = bz * floor;
        stemGlides++;
      }
    }
    // ...and what the RESOLVER kept, measured HERE. From outside the controller
    // the speed after the step is the canopy's answer as much as the trunk's —
    // `canopyGuard()` runs on the same step and §E2's entry cut alone is x0.625
    // — so a probe that reads `P.speed()` grades the needles and calls it the
    // guard. This is the trunk's own number: what walked in, what walked out.
    if (lastStem) {
      lastStem.leave = +Math.hypot(vel.x, vel.z).toFixed(3);
      lastStem.kept = arriveV > 0.05 ? +(lastStem.leave / arriveV).toFixed(3) : 1;
      lastStem.wiped = wiped;
    }
    if (stemProf) stemProfPush(nowMs() - t0);
  }

  // ---- specs/0012 §E2: THE CANOPY IS SOFT.
  //
  // The trunk above is the hard half; this is the other one. Miss the stem and
  // take the branches and you do not go down — the needles take the speed off
  // you and you come out the far side, slower and lower. That asymmetry is the
  // whole point: the trunk punishes a line, the foliage taxes it.
  //
  // Three rules and no fourth: one cut on entry, an exponential drag while
  // inside, and NOTHING vertical. You fall through foliage; a cone that also
  // caught you would be a floor thirty metres up, which is exactly what keeping
  // the canopy out of the triangle soup was avoiding.
  //
  // Tested at the HEAD, not the feet — the needles are what the head goes
  // through — and on every gear including boots, because a fir does not care
  // what is strapped to you.
  function canopyGuard(dt) {
    if (!collision.canopyIn) return;             // host with no canopy index
    // during the tumble the body is not steering itself; a wipe already scrubbed
    // the speed and a second tax on top of it reads as being stuck in glue
    if (wipeT > 0) { inCanopy = -1; return; }
    const hy = pos.y + T.eyeHeight;
    const i = collision.canopyIn(pos.x, hy, pos.z, U);
    if (i < 0) { inCanopy = -1; return; }        // out: the entry cut re-arms
    if (i !== inCanopy) {
      // ENTRY — including crossing straight from one tree's foliage into the
      // next, which is a second tree and therefore a second entry
      inCanopy = i;
      canopyHits++;
      canopyV = Math.hypot(vel.x, vel.z);        // before the cut: see T.canopyCarry
      canopyT = 0;
      vel.x *= T.canopyEntry; vel.z *= T.canopyEntry;
      if (collision.canopyFx) collision.canopyFx.hit(i, pos.x, hy, pos.z);
    } else {
      canopyT += dt;
    }
    const k = Math.exp(-T.canopyDrag * dt);
    vel.x *= k; vel.z *= k;
  }

  function accelerate(wx, wz, target, rate, dt) {
    if (target <= 0) return;
    const cur = vel.x * wx + vel.z * wz;
    const add = clamp(target - cur, 0, rate * target * dt);
    vel.x += wx * add; vel.z += wz * add;
  }

  // A footed gear standing on the ground is boots, full stop — same walk, same
  // jump, same feel. Its own model only gets the frames where you are airborne.
  function footedNow() { const G = GEARS[mode]; return !!(G && G.footed && grounded); }

  function update(dt) {
    dt = clamp(dt, 0.0005, 0.05);
    // specs/0012 §E3 — the rustle and the falling snow age with the BODY's
    // clock, not the frame's, so a headless stepFixed() sees the same half
    // second of sway a player does. One call, here, because this is the only
    // place in the player with a dt for every step the body takes.
    if (collision.canopyFx) collision.canopyFx.update(dt);
    // specs/0030 §2 — the velocity this frame ARRIVED with, before the gear
    // model, the slide and the push-out have had it. `wipeout()` splits this
    // about the contact normal; nothing else reads it.
    velPre.x = vel.x; velPre.z = vel.z;
    // ---- specs/0056a §A — THE ICE BLOCK DOES NOT STOP THE SIM.
    //
    // 0056 §3's `freezeT` early-return stood here and took a whole second off the
    // top of the world: input dropped, `vel` zeroed, `wipeT` and gravity held.
    // It is deleted, not disabled. What is left is TWO POSITIONS INSIDE the wipe
    // that is already running, read off the SAME `wipeT` the impact frame, the
    // camera rig, 0017's audio and the gear's flight home all read — so the
    // block is a thing that happens to a tumbling body, and the body tumbles
    // exactly as 0015/0030/0034 make it tumble, for exactly `WIPE.LEN`.
    //
    // `snow.frozen` therefore no longer means "the sim is stopped" — nothing
    // stops the sim any more. It means "there is a block round you", which is
    // the only thing fx.js ever asked it (it re-fits the box every frame it is
    // true, and that re-fit is now what makes the block roll with the tumble
    // instead of holding one pose). `snow.iceT` is the ice left IN THE TUMBLE.
    if (wipeT > 0) {
      // Read BEFORE the decrement so every edge lands on the same frame every
      // run — the rule the get-up row already followed.
      const tw0 = WIPE.LEN - wipeT;
      // §A — the block CLOSES mid-tumble, one third of a second in, behind the
      // impact frame's own flash. Gated on `iceArmed`, which the overflowing
      // wipe set, so a wipe that merely made you snowier never sees this.
      if (iceArmed && !snow.frozen && tw0 >= ICEW.AT) { snow.frozen = true; snow.iceSeq++; }
      // §1 — the get-up starts at RETURN_AT and that is when the gear flies home
      // and, §A, when the ice SHATTERS: one moment, one row of TUM_KF, and the
      // rider stands up out of the shards on the same 2.0 s he always did. Gated
      // on `getUp` rather than on `gearOut` so a tier-0 wipe still spends its block.
      if (getUp && tw0 >= SHED.RETURN_AT) {
        getUp = false;
        if (gearOut) { gearOut = false; snow.restoreSeq++; }
        if (iceArmed) { iceArmed = false; snow.frozen = false; snow.S = SNOW.AFTER; snow.shatterSeq++; }
      }
      snow.iceT = snow.frozen ? Math.max(0, ICEW.OFF - tw0) : 0;
      wipeT = Math.max(0, wipeT - dt);   // decays in every mode, so a footed gear
                                         // cannot land mid-wipe and tumble forever
      // ---- specs/0030 §2: AND THE SNOW TAKES IT BACK OFF YOU.
      //
      // The toss above is the first half-second; this is the rest of the wipe.
      // specs/0034 §1: nothing at all until 1.40 s and the full 18/s by 1.50, so
      // the body is thrown, SLIDES for the whole first three quarters of the
      // wipe, and is under 1.5 m/s by the time the get-up starts at 1.6 s
      // (measured: 0.41 m/s on case A, 1.13 on case B) — rather than standing up
      // out of a 6 m/s slide, which is a body that teleports back into its
      // riding pose.
      //
      // Applied to the horizontal only, and before the gear model runs: the
      // skis' own friction still does its job underneath this, and vel.y is
      // gravity's, which a fall does not get to argue with.
      const tw = WIPE.LEN - wipeT;
      const s = clamp((tw - WIPE.DRAG_HOLD) / Math.max(1e-3, WIPE.DRAG_IN - WIPE.DRAG_HOLD), 0, 1);
      const k = WIPE.DRAG0 + (WIPE.DRAG1 - WIPE.DRAG0) * s * s * (3 - 2 * s);
      const f = Math.exp(-k * dt);
      vel.x *= f; vel.z *= f;
    }
    if (GEARS[mode] && !footedNow()) updateRide(dt);
    else {
      updateWalk(dt);
      // no wing, no bank: let any carried roll drain out while you are on foot
      if (lean) lean += (0 - lean) * Math.min(1, 8 * dt);
    }
    keys.jump = false;   // jump is edge-triggered
  }

  function updateWalk(dt) {
    // wish direction in world XZ from yaw (-Z is forward in three.js)
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    let fx = -sinY, fz = -cosY;         // forward
    let rx = cosY, rz = -sinY;          // right
    let wx = 0, wz = 0;
    // the arrows still walk in boots exactly as they always did — they are only
    // a separate axis on skis, and only in the air
    if (keys.forward || keys.flipFwd) { wx += fx; wz += fz; }
    if (keys.back || keys.flipBack) { wx -= fx; wz -= fz; }
    if (keys.right || keys.spinRight) { wx += rx; wz += rz; }   // arrows still strafe in boots
    if (keys.left || keys.spinLeft) { wx -= rx; wz -= rz; }
    const wlen = Math.hypot(wx, wz);
    if (wlen > 1e-6) { wx /= wlen; wz /= wlen; }

    const target = (keys.sprint ? T.sprint : T.walk) * (wlen > 1e-6 ? 1 : 0);

    if (grounded) {
      if (!boosting) {
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > 0) {
          const drop = Math.max(sp, 3) * T.friction * dt;
          const k = Math.max(0, sp - drop) / sp;
          vel.x *= k; vel.z *= k;
        }
        accelerate(wx, wz, target, T.accelGround, dt);
      }
      if (keys.jump) { vel.y = T.jump; grounded = false; }
    } else if (!boosting) {
      accelerate(wx, wz, target, T.accelAir, dt);
    }

    vel.y = Math.max(-T.maxFall, vel.y - T.gravity * dt);

    // ---- horizontal, with wall slide
    const intoSolid = solidAhead(dt);   // specs/0020 §2b — before the slide eats it
    let [mx, mz] = slide(vel.x * dt, vel.z * dt, dt);   // physics/no-snag — the slide owns push-out and the friction rate now
    pos.x += mx; pos.z += mz;
    if (dt > 1e-6) {
      // keep velocity consistent with what actually happened (so you do not
      // build up speed grinding along a wall)
      vel.x = mx / dt; vel.z = mz / dt;
    }

    // world edge: the collision grid is finite. Stop at it rather than letting
    // people run off into a region with no ground and get respawn-slapped.
    if (!collision.inBounds(pos.x, pos.z)) {
      const b = collision.bounds;
      pos.x = clamp(pos.x, b.x0 + 1, b.x1 - 1);
      pos.z = clamp(pos.z, b.z0 + 1, b.z1 - 1);
      vel.x = 0; vel.z = 0;
    }

    // trunks, before the ground probe — so the height we sample is the height
    // at the place the body actually ended up
    stemGuard();
    canopyGuard(dt);
    // ...and the rock face, on the same footing as the trunk: a tree wipe this
    // frame has already spent the event, so `wipeT` re-checked here is what
    // keeps one crash one crash.
    if (intoSolid && wipeT <= 0) spendSolid(intoSolid);

    // ---- vertical
    const wasGrounded = grounded;
    // specs/0058 req-20260905-215906 — THE PROBE HAS TO COVER THE STEP IT JUDGES.
    // `fell` is how far this step drops the body; see the ride branch below for
    // the trace that measured why the probe has to reach back over it.
    const fell = vel.y < 0 ? -vel.y * dt : 0;
    pos.y += vel.y * dt;

    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp + fell);
    lastGroundCls = (gy !== null && collision.groundClass) ? collision.groundClass() : CLASS_SNOW;
    if (gy !== null && pos.y <= gy + 1e-3) {
      pos.y = gy; vel.y = 0; grounded = true;
    } else if (gy !== null && wasGrounded && vel.y <= 0 && pos.y - gy <= T.snapDown) {
      pos.y = gy; vel.y = 0; grounded = true;   // stick to downhill
    } else {
      grounded = false;
    }
    // physics/no-snag — ...and once more AFTER the vertical step, because that
    // is the step that can put a body inside something: the slide runs before
    // gravity and the snap, so a body that falls into a shell this frame would
    // otherwise spend the next one in it.
    phaseInRescue();

    // specs/0051 §2.8 path 3 — void-drop respawn, walk. The tag is 2c's (it is
    // how `__chunks.pinsByPath` says which re-home fired); `underTheMountain()`
    // is req-20260905-215906's — a null from a BURIED probe is not the void.
    if (gy === null && !underTheMountain() && pos.y < home.position.y - T.voidDrop) respawn('void-walk');
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn('void-walk');
  }

  // ---------------------------------------------------------------- ride
  // Same skeleton as updateWalk — slide, bounds, gravity, ground snap — with
  // the gear module (ski.js / bike.js) doing the horizontal velocity instead
  // of the Quake accelerate(). The differences that matter: the ground normal
  // is fed to the gear model, and the downhill snap grows with speed (at
  // 28 m/s a frame covers half a metre of drop, and a fixed 45 cm snap would
  // leave you chattering).
  const gnorm = { x: 0, y: 1, z: 0 };

  function updateRide(dt) {
    const G = GEARS[mode], S = G.S;

    // the normal under our feet, sampled before we move
    let n = null;
    if (grounded) {
      const g0 = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
      if (g0 !== null) {
        const q = collision.groundNormal();
        gnorm.x = q.x; gnorm.y = q.y; gnorm.z = q.z;
        n = gnorm;
      }
    }

    // ---- specs/0030 §2: A BODY IN A TUMBLE IS NOT ON ITS EDGES.
    //
    // THE WIPE WINDOW. A contact throws you TANGENTIALLY — across the way the
    // skis are pointing — and ski.js charges a sideways ski the full lateral
    // grip (`grip: 6.0`, a 1/s bleed on the lateral component). Measured on the
    // 0015 rig: 21 m/s² off the throw, which stopped a four-times-longer toss
    // inside a quarter of a second and made every knob in §2 a rounding error.
    //
    // The pose already says the body lies along its velocity — that is what
    // `TUM_KF.align` is. This is the physics agreeing with the picture: for the
    // frames the wipe owns, the gear is handed the HEADING OF THE SLIDE instead
    // of the yaw, so the skis are running flat along the direction the body is
    // actually going and the only friction left is the flat kind. It costs one
    // value on the way in and one discarded on the way out.
    //
    // The yaw the gear hands back is DROPPED while wiping: `yaw` is the camera's
    // and the trick machine's, and a lens that snapped round to the slide
    // heading on the frame of the hit would be a cut, not a crash.
    const wiping = wipeT > 0;
    const wipeSp = Math.hypot(vel.x, vel.z);
    const rideYaw = (wiping && wipeSp > 0.5 * U) ? Math.atan2(-vel.x, -vel.z) : yaw;

    // The gear model runs unless something else owns the velocity this frame.
    const step = boosting ? null : G.step({
      vel, yaw: rideYaw, keys, grounded, normal: n, gravity: T.gravity, dt, S, lean, thrust: thrusting,
      // gears that fly rather than ride need the look pitch, where they are,
      // and the terrain itself (the glider soars off ground it can sample)
      pitch, pos, collision,
    });
    if (!step) {
      // rocket, not wing: no bank to hold and nothing to preload
      lean += (0 - lean) * Math.min(1, 6 * dt);
      crouch = 0;
    } else {
      if (!wiping) yaw = step.yaw;   // 0030 §2 — see the wipe window above
      lean = step.lean;
      crouch = step.crouch || 0;
      if (step.pop) events.pop = step.pop;   // 'perfect' — HUD stamps it
      // gears that judge their own tricks mid-air (barrel rolls) stamp here
      // rather than waiting for a landing that may never come
      if (step.trick) { lastTrick = { ...step.trick }; events.trick = { ...step.trick }; }
    }

    // holdJump gears (bike) own the jump: their step writes vel.y on release.
    //
    // `coyote` is the one hook that lets a jump edge fire while AIRBORNE, and
    // only skis have one: a pop a beat late off a lip is still that pop. It
    // cannot fire for any other gear, because no other gear declares it.
    //
    // vel.y is pinned to 0 on every grounded frame, so `vel.y +=` is bit-for-bit
    // the assignment it replaces for an ordinary jump. It only does anything on
    // the coyote path — and it must ADD to the true vel.y, sign and all. The
    // first cut wrote `Math.max(0, vel.y) + jumpVel`, which DISCARDED the fall
    // speed: pop a beat after rolling off a downhill knuckle and the −2 m/s you
    // had already picked up was deleted, so a late pop was worth MORE than an
    // on-time one and every downhill roll became a bigger jump than before.
    // Adding decays the coyote payout on its own, with no window arithmetic: at
    // the lip you get the whole jump, a tenth of a second late you get the jump
    // minus what gravity has taken, and off a real lip — where vel.y is already
    // positive — nothing changes at all.
    //
    // ...and `launch` is then given the chance to add the lip to it, exactly as
    // it is on the roll-off path below. The gear's launch is one-shot per air.
    // specs/0057 §3.4 — ...and `railHold` is the third way this edge fires: ON A
    // JIB THE JIB IS THE LIP. A body held to a rail line is standing on the rail
    // whether or not the ground probe found the top facet of a ten-sided tube
    // this frame, so the pop goes out through ski.js's ORDINARY path — jumpVel
    // then launch, with `railComp` banked (§3.2) — and the pop window/coyote
    // knobs are not consulted, exactly as the spec says they are not.
    if (keys.jump && !G.holdJump && (grounded || railHold || (G.coyote && G.coyote(S)))) {
      jumpEdges++;                          // specs/0057 §3.4 — the pop rail.js reads
      vel.y += G.jumpVel(S);
      if (G.launch) G.launch(vel, S, G.jumpVel(S));
      grounded = false;
    }

    // spin meter: every source of yaw counts — A/D, the arrows, the mouse
    // (mouse look lands between frames, which is why this diffs against the
    // yaw we last saw rather than summing torques)
    if (!grounded) {
      airSpin += wrapPi(yaw - spinPrevYaw);
      airTime += dt;
    }
    spinPrevYaw = yaw;

    vel.y = Math.max(-T.maxFall, vel.y - T.gravity * dt);

    // ---- horizontal, with wall slide
    // specs/0020 §2b — "am I about to run into the SIDE of something" is asked
    // here, before the slide takes the closing speed off the velocity. Flying
    // into a cliff is judged by this too: the probe does not ask to be grounded.
    const intoSolid = solidAhead(dt);
    let [mx, mz] = slide(vel.x * dt, vel.z * dt, dt);   // physics/no-snag — the slide owns push-out and the friction rate now
    pos.x += mx; pos.z += mz;
    if (dt > 1e-6) { vel.x = mx / dt; vel.z = mz / dt; }

    if (!collision.inBounds(pos.x, pos.z)) {
      const b = collision.bounds;
      pos.x = clamp(pos.x, b.x0 + 1, b.x1 - 1);
      pos.z = clamp(pos.z, b.z0 + 1, b.z1 - 1);
      vel.x = 0; vel.z = 0;
    }

    // trunks. Before the ground probe and before the landing is judged: a tree
    // zeroes the air, so hitting one on the way down is a TREE, not a bad
    // landing that happened to be next to one.
    stemGuard();
    canopyGuard(dt);
    // ...and a rock FACE, on exactly the same footing and for the same reason:
    // meeting a cliff on the way down is a rock, not a bad landing beside one.
    // `wipeT` re-read because stemGuard may have just spent the event.
    if (intoSolid && wipeT <= 0) spendSolid(intoSolid);

    // ---- vertical
    const wasGrounded = grounded;
    const impact = -vel.y;
    // how far this step drops the body — the reach the ground probe below needs
    // (specs/0058 req-20260905-215906)
    const fell = impact > 0 ? impact * dt : 0;
    pos.y += vel.y * dt;

    // THE DOWNHILL SNAP, and the one hook that is allowed to argue with it.
    // This distance is why a fast rider is glued to the backside of everything:
    // it GROWS with speed, so the quicker you cross a knuckle the further the
    // controller will yank you back down onto it. A gear may hand back a shorter
    // one — only skis do, and only above a speed of their own choosing — and a
    // gear that declares no `snapRelease` keeps this number exactly as computed.
    let snap = Math.max(T.snapDown, Math.hypot(vel.x, vel.z) * dt * S.snapMul);
    if (G.snapRelease) snap = G.snapRelease(S, snap);
    // ---- specs/0058 req-20260905-215906: THE PROBE HAS TO COVER THE STEP.
    //
    // `groundAt()` fires ONE RAY, STRAIGHT DOWN, from `pos.y + stepUp`. So it
    // answers "what is under the feet" only for a body that ended the step no
    // more than `stepUp` under the surface; a body that ended it deeper is
    // BEHIND the ray's origin and the answer is `null` — the same answer the
    // void gives, from solid ground.
    //
    // That is what req-20260905-215906 filed. Front side of Palisades, tick 900
    // of `prev`: 32.0 m/s with 17.8 m/s of sink, a 25 ms frame, and the slope
    // under the landing RISING. One step put the feet 0.62 m under the snow
    // (surface 202.775, body 202.153) — past `stepUp` by 7 cm. `gy` came back
    // null, the snap never ran, the landing never happened, and the void rule
    // below (0051 §2.8 #4) read the null as "off the map" and respawned a rider
    // who was standing inside the mountain. The rescue was one frame away:
    // `phaseInRescue()` needs `BURIED_OVER` = 1.0 m of surface overhead and had
    // 0.62, so the next frame would have lifted the body out. voidDrop won the
    // race, and Greg went back to spawn at 32 m/s.
    //
    // THE FALL IS EXACTLY HOW FAR THE PROBE HAS TO REACH BACK. `pos.y + fell` is
    // where the body STARTED this step, so probing from `stepUp` above THAT is a
    // swept test down the path the body actually travelled: it can only find
    // surface the body really crossed, and on every frame that did not tunnel
    // (`fell` under a centimetre at any sane speed, 0 climbing) it returns the
    // same triangle the old line did. The body then lands on what it hit, which
    // is what a 32 m/s arrival was owed in the first place.
    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp + fell);
    // ---- specs/0012 §B: WHAT IS UNDER THE FEET.
    // Read here and nowhere else, because groundClass() reports the last
    // groundAt() that HIT, exactly as groundNormal() does — and nothing between
    // this line and the landing block below probes the ground again. As of
    // specs/0020 §2b it no longer decides anything: it is stashed for
    // `groundClass()`, which fx.js reads to strike sparks off stone.
    lastGroundCls = (gy !== null && collision.groundClass) ? collision.groundClass() : CLASS_SNOW;
    if (gy !== null && pos.y <= gy + 1e-3) {
      pos.y = gy; vel.y = 0; grounded = true;
    } else if (gy !== null && wasGrounded && vel.y <= 0 && pos.y - gy <= snap) {
      pos.y = gy; vel.y = 0; grounded = true;   // stick to downhill
    } else {
      grounded = false;
    }
    // physics/no-snag — ...and once more AFTER the vertical step, because that
    // is the step that can put a body inside something: the slide runs before
    // gravity and the snap, so a body that falls into a shell this frame would
    // otherwise spend the next one in it.
    phaseInRescue();

    // ---- ROCK, and what is NOT here any more (specs/0020 §2b).
    //
    // 0012 §B judged stone from underfoot: above `rockWipeV` across it, or above
    // `rockLandV` onto it, was a wipeout. Both are gone. The 0020 RCA measured
    // what that rule actually caught — a body at the Siberia spawn that pressed
    // no key, never left the ground (600/600 grounded, `impact` 0 on every one
    // of its three wipes) and simply crept down a 40.6 deg granite face until
    // the number went past 6. It had hit nothing.
    //
    // So being on stone decides nothing here now. The wipe moved UP, to
    // `solidAhead()` before the wall slide, where it is a statement about the
    // face in front of the body rather than the floor beneath it; and a hard
    // arrival is judged by the landing block below, which does not know or care
    // what class it is landing on — a hard landing on granite is a `landing`
    // wipe, a soft one is sparks.
    if (grounded && !wasGrounded) {
      const q = collision.groundNormal();
      gnorm.x = q.x; gnorm.y = q.y; gnorm.z = q.z;

      // ---- judge the air. Micro-hops (< 0.3 s) never count either way.
      // A MAGNITUDE on purpose: tricks.js counts turns with it and the HUD
      // prints it. The direction is not lost with it any more — `wipeout()`
      // reads `airSpin`'s sign itself, off the live value, and puts it on the
      // event as `spinDir` (specs/0028 §1).
      const spinDeg = Math.abs(airSpin) * 180 / Math.PI;
      let wiped = false;
      // WHY it went wrong, so the stamp can say so. A gear that judges its own
      // landings eats the arrival; skis cross. Printing "skis crossed" over a
      // rocket that came in too hot was the tell that this was missing.
      let why = 'crossed';
      if (airTime > 0.3) {
        const spH = Math.hypot(vel.x, vel.z);
        // ---- specs/0057 §5.4 (D13): A GRAB STILL HELD AT TOUCHDOWN WIPES.
        //
        // Asked FIRST — before the crossed rule below and before the trick judge
        // under it — so a held grab wipes however square the rotation and however
        // straight the skis. It is inside the `airTime > 0.3` gate with the other
        // two verdicts, which is the micro-hop rule (§4.1): a 0.2 s hop is not an
        // air, and a hand on the ski through one is not a grab.
        //
        // The other two outcomes of the release rule never reach this line — a
        // release 0.25 s clear is clean and a release inside the window is
        // sketchy, and both are scored by the trick judge below.
        if (grabJudge) {
          const gv = grabJudge({ airTime, spinDeg, vel, yaw, impact, normal: gnorm, S, mode, keys });
          if (gv && gv.wipe) { wiped = true; why = gv.why || 'grab'; }
        }
        if (G.judgeWipe) {
          why = 'landing';
          // the gear owns the verdict (a wing cares about sink rate and what it
          // is hitting, not about which way its tips point)
          wiped = !!G.judgeWipe(vel, impact, gnorm, S, keys);
        } else if (G.wipe && spH > S.landMin) {   // landMin doubles as "fast enough to judge"
          // skis pointing >90° off the direction of travel = you eat it. How far
          // past 90° is the gear's business: a park twin forgives a quarter of a
          // turn, a 1972 straight ski forgives nothing. Default is the old 0.06.
          const velYaw = Math.atan2(-vel.x, -vel.z);
          const tol = S.wipeTol == null ? 0.06 : S.wipeTol;
          if (Math.abs(wrapPi(velYaw - yaw)) > Math.PI / 2 + tol) wiped = true;
        }
        // ---- the trick system's landing window (tricks.js, spec 0002 §3.5)
        // LAYERS on top of the rule above; it never replaces it. "Skis crossed"
        // is checked first and is orthogonal — you can close a Cork 900 exactly
        // and still land sideways, and that is still a wipeout. Only if the
        // arrival survives that does the rotation window get a say.
        if (!wiped && trickJudge) {
          const v = trickJudge({ airTime, spinDeg, vel, yaw, impact, normal: gnorm, S, mode });
          if (v && v.wipe) { wiped = true; why = v.why || 'rotation'; }
          if (v && typeof v.snapYaw === 'number') yaw = v.snapYaw;
        }
      }
      // ---- specs/0057 §2.3: A RAIL SAVES A HARD FALL (D3).
      //
      // On skis this block has exactly two verdicts — `crossed` (the skis-off-
      // travel rule above) and `rotation` (tricks.js's judge) — and a jib
      // overrides BOTH, here, before `wipeout()` is called. Landing on a jib
      // from a height that would otherwise wipe you out locks on clean instead.
      //
      // The window is `railEntry` WIDENED (rail.js): `RAIL_CATCH` 0.50
      // unchanged, `RAIL_DZ` 0.60, roll 40 deg instead of 15, no impact ceiling
      // and `RAIL_V_MIN` not applied — a dead-vertical drop onto a rail locks
      // on. The landing tiers fire no clip on a save; the slide clip takes the
      // frame (§6.2), and impact only scales the entry burst (§7.3).
      //
      // It is asked ONLY when the arrival was going to be a wipe, so a clean
      // landing that happens to be beside a rail is still a clean landing and
      // the ordinary ride-on test in rail.js gets it on the next step.
      // ...and `why !== 'grab'` is specs/0057 §5.4's last sentence, not a
      // special case: the rail save does NOT save a held grab. Landing a grab on
      // a rail with your hand still on the ski wipes, on the rail. It is the one
      // thing that can put you down on a jib, and it is an input you are holding
      // rather than anything the jib did.
      if (wiped && why !== 'grab' && mode === 'skis' && railSave()) { wiped = false; why = 'jib'; }
      landWhy = wiped ? why : (why === 'jib' ? 'jib' : 'clean');
      if (wiped) {
        wipeout(why, spinDeg);               // scrub — spins and stone have stakes
      } else if (airTime > 0.3 && G.spinTrick !== false && spinDeg >= 330) {
        const n360 = Math.min(4, Math.floor((spinDeg + 30) / 360));
        lastTrick = { name: String(n360 * 360), deg: Math.round(spinDeg) };
        events.trick = { ...lastTrick };
      }
      if (!wiped) {
        G.land(vel, impact, gnorm, S);          // land on a pitch, keep going
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > S.maxSpeed) { const k = S.maxSpeed / sp; vel.x *= k; vel.z *= k; }
      }
      if (impact > events.land) events.land = impact;
      airSpin = 0; airTime = 0;
    } else if (!grounded && wasGrounded && G.launch) {
      G.launch(vel, S);   // rolled off a lip without jumping — carry the vertical
    }

    // specs/0051 §2.8 path 4 — void-drop respawn, ski. Same rule, other branch,
    // and the same two halves: 2c's path tag and 215906's buried-probe gate.
    if (gy === null && !underTheMountain() && pos.y < home.position.y - T.voidDrop) respawn('void-ski');
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn('void-ski');
  }

  function applyToCamera(cam) {
    cam.position.set(pos.x, pos.y + T.eyeHeight, pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(pitch, yaw, GEARS[mode] ? lean : 0);
    cam.updateMatrixWorld();
  }

  const api = {
    T, keys, update, look, respawn, applyToCamera, setMode,
    // the active ride gear's tuning (skis' when in boots — callers use it for
    // "how fast could I possibly go" style normalisation)
    get S() { return (GEARS[mode] || GEARS[defaultGear]).S; },
    get defaultGear() { return defaultGear; },
    setDefaultGear(m) { if (GEARS[m]) defaultGear = m; return defaultGear; },
    get gears() { return Object.keys(GEARS); },
    // A gear's live tuning object, for callers that swap the equipment inside a
    // gear (the ski rack). Object.assign into it — the registry holds this exact
    // object, so replacing it wholesale would not take.
    gearTuning(name) { return GEARS[name] ? GEARS[name].S : null; },
    // specs/0030 §2 — the wipe's own numbers, handed out the way `gearTuning`
    // hands out a gear's: the LIVE object, so the toss rig can sweep the scrub
    // and the drag in one browser session instead of one page load per guess.
    // Read-only in every shipped path; nothing in the player writes to it.
    get wipeTuning() { return WIPE; },
    get position() { return pos; },
    get velocity() { return vel; },
    get grounded() { return grounded; },
    // true when a footed gear (the glider) is standing on the ground, i.e. the
    // walk controller is driving. Callers use it to skip the ride-gear dressing.
    get footedNow() { return footedNow(); },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get respawns() { return respawns; },
    get mode() { return mode; },
    get lean() { return lean; },
    get crouch() { return crouch; },
    get airSpinDeg() { return airSpin * 180 / Math.PI; },
    get airTime() { return airTime; },
    get wipeT() { return wipeT; },
    // ---- specs/0057. `jumpEdges` is how a module that runs AFTER update()
    // sees a pop (§3.4); `lastLandWhy` is the landing verdict including the
    // rail save's 'jib' (§2.3, P7); `setRailHold` is the one-mesh NOSNAG skip
    // (§2.4 rule 1) and is only ever written by rail.js's lock and release.
    get jumpEdges() { return jumpEdges; },
    get lastLandWhy() { return landWhy; },
    setRailHold(v) { railHold = !!v; return railHold; },
    get railHold() { return railHold; },
    get lastTrick() { return lastTrick; },
    // specs/0012 — how many trunks the body has actually touched and how many
    // rock bands have ended a run. Counters, not events: a gate asserts on the
    // delta across a stepFixed() run.
    get treeHits() { return treeHits; },
    get rockWipes() { return rockWipes; },
    // specs/0018 — the same for every solid the world names. `solidWipes` is the
    // total (rock included); `solidHits` is it broken out by `why`, which is what
    // a gate asserting "that tower, not some tower" reads.
    get solidWipes() { return solidWipes; },
    get solidHits() { return { ...solidHits }; },
    // §E2 — one per ENTRY into foliage, and which tree's foliage we are in now
    get canopyHits() { return canopyHits; },
    get canopyStem() { return inCanopy; },
    // what is under the feet as of this step's own ground probe: 0 snow,
    // 1 rock (collision.js). fx.js reads it for the sparks; nothing wipes on it.
    groundClass() { return lastGroundCls; },
    // ...and the name of the mesh that probe hit, when the host tracks names
    groundMesh() { return collision.groundMesh ? collision.groundMesh() : ''; },
    // specs/0020 §2b — "is the way ahead blocked, by what, and how squarely".
    // Public because 0018's towers, buildings, people and benches are meant to
    // ask this exact question rather than grow a rule of their own. Pass a reach
    // in metres, or nothing for the body's own one-frame lookahead.
    blockedAhead(dist) { return blockedAhead(dist); },
    // ---- physics/no-snag — THE COUNTERS THAT ARE THE ASSERTION.
    //
    // `stuckFrames` and `unstickNudges` are the two the rule is stated in:
    // nothing may stay pinned to a face with the key held, so on a healthy build
    // both are 0 and the sweep says so. `depenFrames`/`buriedFrames` are the
    // work: how many frames the push-out had something to do, and how many of
    // those had surface over the body's head. `noSnag` is the thresholds
    // themselves, so a gate prints the numbers it is asserting rather than
    // repeating them.
    get depenFrames() { return depenFrames; },
    get depenMax() { return +depenMax.toFixed(3); },
    get buriedFrames() { return buriedFrames; },
    get stuckFrames() { return stuckFrames; },
    get unstickNudges() { return unstickNudges; },
    get lastPush() { return lastPush; },
    resetSnagCounters() { depenFrames = 0; depenMax = 0; buriedFrames = 0; stuckFrames = 0; unstickNudges = 0; stuckT = 0; lastPush = null;
      // specs/0051 D-20 — the multi-trunk resolver's own counters, reset on
      // the same call the snag sweep already makes between runs
      stemEjects = 0; stemGlides = 0; stemMaxSeen = 0; stemPassMax = 0; lastStem = null; stemProfAt = 0;
      if (stemProf) stemProf.fill(0); },
    // ---- specs/0051 D-20: the stand resolver, published for the gate.
    // `stemEjects` is the assertion, not the behaviour: a pocket the solver
    // could not leave in eight passes should never happen, and the number
    // that says so is the one the probe prints.
    get stemEjects() { return stemEjects; },
    get stemGlides() { return stemGlides; },
    get stemMaxContacts() { return stemMaxSeen; },
    get stemPassMax() { return stemPassMax; },
    get lastStem() { return lastStem; },
    get stemTuning() { return STEM; },
    /** Turn the resolver's own cost profile on (a ring of `n` samples, one
     *  per step stemGuard ran) or off (`n` falsy). Off by default: two clock
     *  reads a step are cheap but a profile that is always on is a
     *  measurement of itself. */
    stemProfile(n) {
      if (!n) { stemProf = null; stemProfAt = 0; return null; }
      stemProf = new Float64Array(n); stemProfAt = 0; return n;
    },
    /** The samples taken so far, oldest first, in milliseconds. */
    stemProfile_read() {
      if (!stemProf) return [];
      const m = Math.min(stemProfAt, stemProf.length);
      const out = new Array(m);
      const base = stemProfAt > stemProf.length ? stemProfAt % stemProf.length : 0;
      for (let k = 0; k < m; k++) out[k] = stemProf[(base + k) % stemProf.length];
      return out;
    },
    noSnag: {
      ...NOSNAG,
      // the same two numbers the wipe rule is written in, spelled out in the
      // units a person reads: degrees off head-on, and metres per second.
      intoDeg: +(Math.acos(NOSNAG.INTO) * 180 / Math.PI).toFixed(2),
      closingFloor: T.treeWipeV,
      wallNy: WALL_NY,
      wallDeg: +(Math.acos(WALL_NY) * 180 / Math.PI).toFixed(2),
      // what the rule USED to be, so a report can print before -> after
      wasInto: WALL_INTO,
      wasIntoDeg: +(Math.acos(WALL_INTO) * 180 / Math.PI).toFixed(2),
    },
    // the face the last 'rock' wipeout was against — { dist, cls, mesh, into,
    // speed, closing } — or null if nothing has been run into yet
    get lastBlock() { return lastBlock; },
    // one-shot event drain: landing impact + any trick/wipe since the last call
    takeEvents() {
      const out = { land: events.land, trick: events.trick, wipe: events.wipe, pop: events.pop };
      events.land = 0; events.trick = null; events.wipe = null; events.pop = null;
      return out;
    },
    toggleMode() { return setMode(mode === 'boots' ? defaultGear : 'boots'); },
    // tricks.js only: a second opinion on a landing the wipeTol rule already
    // passed. Returns { wipe, why?, snapYaw? } or null.
    setTrickJudge(fn) { trickJudge = typeof fn === 'function' ? fn : null; },
    // specs/0057 §5.4 — the grab's verdict, wired by tricks.js beside the one
    // above. Same contract: return { wipe, why } or null.
    setGrabJudge(fn) { grabJudge = typeof fn === 'function' ? fn : null; },
    // boost.js only: "the rocket's motor owns the velocity this frame, stand the
    // gear model down". Nothing else in the player may call this.
    setBoosting(v) { boosting = !!v; return boosting; },
    get boosting() { return boosting; },
    // boost.js only, the other half of the same hook: "a motor is pushing, but
    // keep running the gear model". The gear sees it as ctx.thrust.
    setThrust(v) { thrusting = !!v; return thrusting; },
    get thrusting() { return thrusting; },
    // the surface under your feet as of the last ground probe (skis read it
    // every frame; in boots it is whatever the last update happened to sample)
    groundNormal() { return collision.groundNormal(); },
    // branch rider/air-stance — HOW LONG UNTIL THE SKIS MEET THE SNOW, ballistic.
    // rider.js §4.3a extends the air stance on this so the legs are already under
    // the body at touchdown instead of snapping down onto it. Two passes: solve the
    // arc `y(t) = y + vy·t − ½g·t²` against the ground under the body, then against
    // the ground under where that answer lands. 0 while grounded, or over a void —
    // the caller falls back to elapsed air time. The trailing probe is a RESTORE:
    // `collision.groundAt` writes the shared normal `groundNormal()` hands out, and
    // updateRide leaves it on this very ray on every airborne frame.
    airToLanding() {
      if (grounded) return 0;
      let t = 0;
      for (let i = 0; i < 2; i++) {
        const gy = collision.groundAt(pos.x + vel.x * t, pos.z + vel.z * t, pos.y + vel.y * t + 2 * U);
        if (gy === null) break;
        const d = vel.y * vel.y + 2 * T.gravity * (pos.y - gy);
        t = d <= 0 ? 0 : (vel.y + Math.sqrt(d)) / T.gravity;
      }
      collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
      return t;
    },
    // specs/0051 §2.8 path 5 — setHome moves the DESTINATION of paths 2-4, so
    // the new home is pinned here rather than at the three respawns that will
    // land on it.
    setHome(p, y, pi) {
      home.position.copy(p); home.yaw = y; home.pitch = pi || 0;
      if (collision && collision.pinSync) collision.pinSync(home.position, 'setHome');
    },
    setYaw(y) { yaw = y; },
    // tricks.js only: the PITCH half of the landing snap. A flip's rotation
    // residual belongs on the flip axis, and this is the only way that module
    // has to spend it there instead of dumping it into the heading. Clamped
    // exactly as look() clamps, so a big residual cannot flip the camera over.
    setPitch(p) { pitch = clamp(p, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02); return pitch; },
    teleport(p, y) {
      pos.copy(p); vel.set(0, 0, 0);
      if (y !== undefined) yaw = y;
      grounded = false; lean = 0; crouch = 0;
      airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0; inCanopy = -1; canopyV = 0; canopyT = 0;
      gearReattach();             // specs/0056 §1 — fast travel does not leave a ski behind
      for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
      // THE SURFACE UNDER YOUR FEET IS WHERE YOUR FEET ARE. `groundNormal()` —
      // this object's and collision.js's alike — reports the last groundAt()
      // that HIT, from any caller (updateRide, the camera, fx, the recorder).
      // Teleporting moved the body and nothing re-probed, so until the next
      // landing the normal still described the place we LEFT: `downhillYaw()`
      // (main.js) answered with the old fall line, and a harness that teleports
      // to a spawn and rides down the fall line therefore started at a yaw that
      // depended on wherever the page had last run physics. That is exactly the
      // stale-state class this line already clears — vel, grounded, lean,
      // crouch, the air spin, the wipe, the canopy and every gear — so the
      // normal is cleared with them, by RE-PROBING at the new position. One
      // ray, on a call that already costs a gear reset. If the target is over
      // the void nothing hit and `gnorm` keeps its last value, which is the
      // same answer the old code gave.
      if (collision.groundAt(pos.x, pos.z, pos.y + T.stepUp) !== null) {
        const q = collision.groundNormal();
        gnorm.x = q.x; gnorm.y = q.y; gnorm.z = q.z;
      }
    },
    speed() { return Math.hypot(vel.x, vel.z); },
    // ---- specs/0056. `snow` is the LIVE record — S, the tier, the last I, and
    // the five monotonic counters fx.js edge-detects on (a renderer that missed a
    // frame still sees the change). `__rider.snow` prints it; the HUD does not.
    get snow() { return snow; },
    // specs/0056a §A — THIS IS NOW ALWAYS FALSE, and it is kept as a literal
    // rather than deleted because it is the load-bearing statement of the fix:
    // nothing in this module stops the sim. `snow.frozen` is the block's own
    // flag and answers a different question ("is there ice round you").
    get frozen() { return false; },
    // §1 — THE ONE REATTACH, idempotent, and the only way gear comes back.
    gearReattach,
    // §4 — the only two callers are R (respawn, above) and lift.js's board.
    snowReset,
    // the harness's writer for the S = 0.3 / 0.7 / 1.0 sheets; never called in play
    setSnow(v) { snow.S = clamp(+v || 0, 0, SNOW.MAX); return snow.S; },
  };
  // Lab handle, the same convention collision.js and canopy.js already use.
  // `window.__player` is assembled in main.js and does not forward the
  // specs/0012 counters or the new specs/0020 probe, and main.js is not this
  // spec's to edit — so the controller publishes itself, read-only by
  // convention, exactly like `window.__playCollision`.
  try { if (typeof window !== 'undefined') window.__playController = api; } catch { /* not a browser */ }
  return api;
}
