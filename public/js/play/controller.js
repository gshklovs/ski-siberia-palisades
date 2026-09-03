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
    jumpHeld: false,
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

  function respawn() {
    pos.copy(home.position);
    vel.set(0, 0, 0);
    yaw = home.yaw; pitch = home.pitch;
    grounded = false;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0; inCanopy = -1; canopyV = 0; canopyT = 0;
    for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    respawns++;                  // gear is kept: respawning is not un-equipping
  }

  function setMode(m) {
    const next = GEARS[m] ? m : 'boots';
    if (next === mode) return mode;
    mode = next;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0; inCanopy = -1; canopyV = 0; canopyT = 0;
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

  // one horizontal probe; returns the blocking normal or null
  function probe(dx, dz, dist, height) {
    const h = collision.raycast(pos.x, pos.y + height, pos.z, dx, 0, dz, dist);
    if (!h) return null;
    if (Math.abs(h.ny) > WALL_NY) return null;
    return { nx: h.nx, nz: h.nz, dist: h.dist };
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

  function slide(mx, mz) {
    let len = Math.hypot(mx, mz);
    if (len < 1e-6) return [mx, mz];
    for (let iter = 0; iter < 3 && len > 1e-6; iter++) {
      const dx = mx / len, dz = mz / len;
      let blocked = null;
      for (const hgt of [T.stepUp + 0.12, 1.35]) {
        const p = probe(dx, dz, len + T.radius, hgt);
        if (p && (!blocked || p.dist < blocked.dist)) blocked = p;
      }
      if (!blocked) break;
      // project the move onto the wall plane, then re-test
      const d = mx * blocked.nx + mz * blocked.nz;
      if (d < 0) { mx -= blocked.nx * d; mz -= blocked.nz * d; }
      else break;
      len = Math.hypot(mx, mz);
    }
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
  function stemGuard() {
    if (!collision.stemHit) return;               // host with no stem index
    // Up to three passes. `stemHit` answers with the DEEPEST overlap, and in a
    // tight glade two trunks can hold you at once — pushing out of one can put
    // you into the other, and a body left standing inside a trunk is the one
    // state there is no way back out of. Three is enough for any real placement
    // and is bounded, which a while-loop against float geometry would not be.
    // the verdict is on the speed you ARRIVED with, not on the tangential
    // remainder the push-out is about to leave you holding
    let arrival = Math.hypot(vel.x, vel.z);
    let touched = false, touchedI = -1;
    let nx0 = 0, nz0 = 0;                         // specs/0030 §2 — the bark's normal
    for (let pass = 0; pass < 3; pass++) {
      const h = collision.stemHit(pos.x, pos.y, pos.z, T.radius, U);
      if (!h) break;
      if (!touched) { nx0 = h.nx; nz0 = h.nz; }   // the FIRST trunk: the one you hit
      touched = true;
      if (touchedI < 0) touchedI = h.i;
      // the extra millimetre is not decoration: pushing out by exactly `pen`
      // lands the body ON the cylinder, where float rounding leaves it inside
      // as often as out, and "outside the trunk" has to be true every time
      pos.x += h.nx * (h.pen + 1e-3); pos.z += h.nz * (h.pen + 1e-3);
      // ...and stop driving into the wood. Below the wipe speed this IS the
      // whole event: you slide off, and can nudge past a tree at a walk.
      const into = vel.x * h.nx + vel.z * h.nz;   // < 0 = still heading at it
      if (into < 0) { vel.x -= h.nx * into; vel.z -= h.nz * into; }
    }
    if (!touched) return;
    // §E4 — the push-out above has already run. THIS is the part the tumble
    // suppresses: one trunk is one wipeout, and the 108 frames the body spends
    // sliding down the same trunk are not 108 more of them.
    if (wipeT > 0) return;
    // ...unless the last three metres were this tree's own branches. §E2's drag
    // exists to make foliage feel soft, not to make the trunk behind it safe.
    if (touchedI >= 0 && touchedI === inCanopy && canopyT <= T.canopyCarry && canopyV > arrival) {
      arrival = canopyV;
    }
    treeHits++;
    if (arrival >= T.treeWipeV) {
      wipeHit = { nx: nx0, nz: nz0 };    // specs/0030 §2 — split about the bark
      wipeout('tree');
    }
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
    if (wipeT > 0) {
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
    let [mx, mz] = slide(vel.x * dt, vel.z * dt);
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
    pos.y += vel.y * dt;

    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
    lastGroundCls = (gy !== null && collision.groundClass) ? collision.groundClass() : CLASS_SNOW;
    if (gy !== null && pos.y <= gy + 1e-3) {
      pos.y = gy; vel.y = 0; grounded = true;
    } else if (gy !== null && wasGrounded && vel.y <= 0 && pos.y - gy <= T.snapDown) {
      pos.y = gy; vel.y = 0; grounded = true;   // stick to downhill
    } else {
      grounded = false;
    }

    if (gy === null && pos.y < home.position.y - T.voidDrop) respawn();
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn();
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
    if (keys.jump && !G.holdJump && (grounded || (G.coyote && G.coyote(S)))) {
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
    let [mx, mz] = slide(vel.x * dt, vel.z * dt);
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
    pos.y += vel.y * dt;

    // THE DOWNHILL SNAP, and the one hook that is allowed to argue with it.
    // This distance is why a fast rider is glued to the backside of everything:
    // it GROWS with speed, so the quicker you cross a knuckle the further the
    // controller will yank you back down onto it. A gear may hand back a shorter
    // one — only skis do, and only above a speed of their own choosing — and a
    // gear that declares no `snapRelease` keeps this number exactly as computed.
    let snap = Math.max(T.snapDown, Math.hypot(vel.x, vel.z) * dt * S.snapMul);
    if (G.snapRelease) snap = G.snapRelease(S, snap);
    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
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

    if (gy === null && pos.y < home.position.y - T.voidDrop) respawn();
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn();
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
    setHome(p, y, pi) { home.position.copy(p); home.yaw = y; home.pitch = pi || 0; },
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
      for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    },
    speed() { return Math.hypot(vel.x, vel.z); },
  };
  // Lab handle, the same convention collision.js and canopy.js already use.
  // `window.__player` is assembled in main.js and does not forward the
  // specs/0012 counters or the new specs/0020 probe, and main.js is not this
  // spec's to edit — so the controller publishes itself, read-only by
  // convention, exactly like `window.__playCollision`.
  try { if (typeof window !== 'undefined') window.__playController = api; } catch { /* not a browser */ }
  return api;
}
