// specs/0058 — THE RIDE RECORDER. A rosbag of the run you are in the middle of.
//
// specs/0004 files a PICTURE of a place that is wrong. This files a RUN that
// went wrong: every input and every state the body held between the last two
// spawns, packed at 48 bytes a tick, replayable on the bench so a builder
// watches the bug happen instead of reading about it.
//
// THREE THINGS MAKE IT CHEAP.
//   1. Records are fixed-size and packed into a DataView. No objects, no
//      per-tick allocation, nothing for the GC to walk.
//   2. The ring is a deque of 30-second BLOCKS, not one 10-minute allocation.
//      A 60 s ride holds two blocks (~345 KB), not 6.9 MB, and once the ring is
//      full the oldest block is recycled rather than freed.
//   3. Unarmed, tick() is `if (!on) return`. The public build never arms it —
//      and does not even carry this file (the exporter stubs it, exactly as it
//      stubs dev.js).
//
// AND ONE THING MAKES IT HONEST: nothing here edits controller.js. Every event
// except teleport, the fence and a lift boarding is DERIVED from counters the
// controller already publishes, so this file cannot change how the game plays.
// The three that are not derivable are one named line each in main.js.

// ---------------------------------------------------------------- constants

// THE CLOCK. `__player.stepFixed` is the only fixed step the player has
// (main.js: `stepFixed({ dt = 1 / 120 })`) and this is its dt. The live loop's
// dt is wall-clock, so the recorder does not resample onto this — it stores
// what each tick actually took, as a RATIO to this number (see DT_Q below).
export const DT_NOM = 1 / 120;
// dt is stored as round(dt / DT_NOM * DT_Q). A power of two on purpose: an
// integer divided by 4096 is exact in binary floating point, so dt == DT_NOM
// round-trips to 4096 and back to DT_NOM bit-for-bit, and dt == 1/60 round-trips
// through 8192 to DT_NOM * 2 bit-for-bit. Fixed-step captures replay EXACTLY;
// wall-clock ones are quantised at DT_NOM / 4096 = 2.03 us.
const DT_Q = 4096;
const DT_MAX_Q = 65535;               // 0.0546 s — past the controller's 0.05 clamp

export const REC_BYTES = 48;          // one tick
const BLOCK_TICKS = 3600;             // 30 s at DT_NOM
const BLOCK_BYTES = BLOCK_TICKS * REC_BYTES;    // 172,800 B
const MAX_BLOCKS = 20;                // 10 min per segment -> 3,456,000 B
const MAX_EVENTS = 4000;              // per segment; an event is not a per-tick cost

// Look deltas are stored as radians, not mouse pixels, because the sensitivity
// is the caller's and a replay must not depend on it. 1e-4 rad/unit gives
// +/-3.27 rad in a single tick — a half-turn flick fits whole, which matters
// because a harness that snaps the body round with __player.setYaw() is a
// legitimate input too (see the yaw DIFFERENCE below) — at 0.0057 deg of
// quantum, and the quantum never accumulates because the residual is carried.
const LOOK_Q = 1e-4;
const ANG_Q = Math.PI / 32768;        // absolute yaw/pitch, i16

export const DRIFT_TOL = 0.05;        // m — the determinism proof (specs/0058 3.3)
export const FALL_TOL = -1.0;         // m of gdist below which the body is INSIDE the ground

// ---- specs/0058 §1.8 · THE EQUIPMENT, and why it is in the bag.
//
// The first real trace (req-20260905-215906) replayed 7.46 m off at p50 and
// nobody could see why, because the bag recorded every input and every state
// and NOT the one thing that rewrites the physics constants underneath them:
// the ski. `ski.js` resolves `?ski=` → localStorage → default at module load and
// `scaleSkiTuning` writes slopeAccel, glideFriction, dragQuad and maxSpeed out
// of it, so two browsers with different remembered skis are two different
// simulations. The builder got the replay to land only by guessing
// `?ski=racetiger-gs` from the trajectory.
//
// So the bag records the equipment, and `LS_PHYSICS` is the list of storage
// keys it covers — one row per rack, each naming the tuning function that makes
// it physics. `LS_EXEMPT` is every other key the player stores, each with the
// reason it cannot move the body. A key in NEITHER list fails the harness check
// (harness/trace-replay.mjs), which is what stops the next rack from being
// silently un-recorded the way this one was.
export const GEAR_VERSION = 2;        // header `version`; 1 = a bag with no gear block

export const LS_PHYSICS = {
  'poi-lab.play.ski': { field: 'ski', param: 'ski', why: 'scaleSkiTuning — slopeAccel, glideFriction, dragQuad, maxSpeed, popMul, wipeTol' },
  'poi-lab.play.bike': { field: 'bike', param: 'bike', why: 'scaleBikeTuning — the whole bike model' },
  'poi-lab.play.glider': { field: 'glider', param: 'glider', why: 'scaleGliderTuning, and `rocket-pack` selects the ROCKET gear rather than the wing' },
  'poi-lab.play.sled': { field: 'sled', param: 'sled', why: 'scaleSledTuning — including wipeTol, which is negative on a sled' },
  'poi-lab.play.snowmobile': { field: 'snowmobile', param: 'snowmobile', why: 'scaleSnowmobileTuning — engine, track drag, suspension' },
  // The locker's own per-tab store. Today it holds exactly `boots`, which has no
  // per-model tuning (the controller's boots path is `T` and nothing else) — but
  // it is RECORDED rather than exempted, because "there is only one boot today"
  // is a fact about today and a second pair would arrive silently.
  'poi-lab.play.locker.': { field: 'boots', param: null, why: 'the locker per-tab store; `boots` only today, and boots has no per-model tuning — recorded so a second pair cannot arrive unnoticed' },
};

export const LS_EXEMPT = {
  'poi-lab.play.outfit': 'appearance only. The collision body is controller.js\'s `radius` and `eyeHeight`; no outfit reaches either, and rider.js never writes to ctrl.',
  'poi-lab.play.settings.': 'the clean-frame knobs (cleanSpeedLines, cleanPumpTracks). They decide what H hides, never a force.',
  // specs/0055 §5.3 (Greg 2026-09-06) — the LAB UI switch. Same namespace as the
  // row above, but flags.js spells the whole key out (the default is DEBUG_HUD,
  // which is upstream of settings.js), so the scanner sees it as a key of its
  // own and it needs a row of its own. It hides lab surfaces — the debug
  // readout, the lip/compression meter, B photos, F8 dev fly, the lab rows in
  // the pause menu — and nothing else: controller.js, ski.js and the tuning
  // scalers never read it, it is false on every shipped build (setLabUI clamps
  // to DEBUG_HUD), and F8's fly is the only thing behind it that could move a
  // body — which is a lab-only input, not a physics constant, and the trace's
  // own input bitfield would carry it if a hand used it.
  'poi-lab.play.settings.labUI': 'the LAB UI switch (specs/0055 §5.3). Shows/hides lab instruments only; no tuning scaler and no controller path reads it, and it is clamped false outside the lab.',
  'poi-lab.play.tricks': 'the trick score board. Read at display time; tricks.update() and the landing judge never open it.',
  'poi-lab.play.guide-race': 'the guided run\'s race board — scores, same store, same reason.',
  'poi-lab.play.gs-race': 'the GS race board — scores, same store, same reason.',
};

// The gear enum. Index is the byte; the order is controller.js's registry order
// and must not be reordered, only appended to.
export const MODES = ['boots', 'skis', 'bike', 'glider', 'rocket', 'sled', 'snowmobile'];
const MODE_ID = Object.fromEntries(MODES.map((m, i) => [m, i]));

// The input bitfield. Every key controller.js reads (its `keys` object) plus
// four bits of provenance, so a trace says whether the run was driven by a
// hand, a phone or a test.
export const IN = {
  forward: 1, back: 2, left: 4, right: 8, sprint: 16,
  jump: 32, jumpHeld: 64,
  spinLeft: 128, spinRight: 256,
  flipFwd: 512, flipBack: 1024,
  tuck: 2048,
  look: 4096,          // a look delta was applied this tick
  touch: 8192,         // ...and it came from touch.js
  paused: 16384,
  // specs/0057 §8 — THE GRAB BIT. §1.3 above promised "bit 13 is reserved for
  // one", and by the time a grab existed bit 13 was `touch`, which IS written
  // (look(dy, dp, touch)). The one bit in this u16 that no code path has ever
  // set is `dev` — declared in the first cut of §1.3 and never wired — so the
  // grab takes it and the 48-byte record does not move. Every trace filed
  // before this line has bit 15 clear, so every one of them still replays.
  grab: 32768,
};
// the controller keys, in bit order, so the pack and the replay cannot disagree
const KEY_BITS = [
  ['forward', IN.forward], ['back', IN.back], ['left', IN.left], ['right', IN.right],
  ['sprint', IN.sprint], ['jump', IN.jump], ['jumpHeld', IN.jumpHeld],
  ['spinLeft', IN.spinLeft], ['spinRight', IN.spinRight],
  ['flipFwd', IN.flipFwd], ['flipBack', IN.flipBack], ['tuck', IN.tuck],
];

// Event codes. 1-3 are the SEGMENT CUTS (specs/0051 2.8's re-home paths); the
// rest are recorded and indexed but do not cut.
export const EV = {
  spawn: 1, respawn: 2, teleport: 3, liftBoard: 4,
  land: 5, takeoff: 6, wipeStart: 7, wipeEnd: 8,
  fence: 9, canopy: 10, tree: 11, solid: 12,
  trick: 13, gear: 14, void: 15, file: 16,
  // specs/0057 §8 — the park. Three transitions, derived exactly the way every
  // code above is derived: off `window.__rail` and `window.__grab`, which
  // rail.js and tricks.js publish, so controller.js is still untouched (§1.5).
  // `jibOn`'s arg is the entry yaw in degrees; `jibOff`'s is the banked
  // compression it left with; `grab`'s is the grab's own base score.
  jibOn: 17, jibOff: 18, grab: 19,
};
export const EV_NAME = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));
const CUTS = new Set([EV.spawn, EV.respawn, EV.teleport]);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const i16 = (v) => clamp(Math.round(v), -32768, 32767);
const u8 = (v) => clamp(Math.round(v), 0, 255);
const i8 = (v) => clamp(Math.round(v), -128, 127);

// ------------------------------------------------------------------ segment

// A deque of fixed blocks. `push()` never allocates once the ring is full,
// because the block that falls off the front is handed back to the pool the
// next `push()` takes from.
function makeSegment(pool) {
  let blocks = [];        // [{ buf, view }]
  let count = 0;          // records in the last block
  let ticks = 0;          // total live records
  let dropped = 0;        // records the ring has thrown away
  let events = [];
  let start = null;       // { pos:[f64,f64,f64], yaw, pitch, mode, t } — see 1.6
  let origin = null;      // f64 the f32 positions are relative to

  function block() {
    const last = blocks[blocks.length - 1];
    if (last && count < BLOCK_TICKS) return last;
    if (blocks.length >= MAX_BLOCKS) {
      // the ring is full: the oldest 30 s goes back to the pool
      const old = blocks.shift();
      dropped += BLOCK_TICKS;
      pool.push(old);
    }
    const b = pool.length ? pool.pop() : { buf: new ArrayBuffer(BLOCK_BYTES), view: null };
    if (!b.view) b.view = new DataView(b.buf);
    blocks.push(b);
    count = 0;
    return b;
  }

  return {
    get ticks() { return ticks; },
    get dropped() { return dropped; },
    get events() { return events; },
    get start() { return start; },
    get origin() { return origin; },
    get bytes() { return blocks.length * BLOCK_BYTES; },
    get blocks() { return blocks; },
    setStart(s, o) { start = s; origin = o; },
    // hand back the DataView and the byte offset to write this tick into
    slot() {
      const b = block();
      const off = count * REC_BYTES;
      count++; ticks++;
      return { v: b.view, off };
    },
    addEvent(e) {
      events.push(e);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    },
    reset() {
      for (const b of blocks) pool.push(b);
      blocks = []; count = 0; ticks = 0; dropped = 0; events = []; start = null; origin = null;
    },
    // read one record back out, as an object. Only the plot, the drift check
    // and the serialiser use this — never the hot path.
    at(i) {
      if (i < 0 || i >= ticks) return null;
      const bi = Math.floor(i / BLOCK_TICKS), off = (i % BLOCK_TICKS) * REC_BYTES;
      const b = blocks[bi];
      if (!b) return null;
      return unpack(b.view, off, origin);
    },
    // one contiguous copy of every live record, for trace.bin
    bytesOut() {
      const out = new Uint8Array(ticks * REC_BYTES);
      let w = 0;
      for (let i = 0; i < blocks.length; i++) {
        const n = (i === blocks.length - 1) ? count : BLOCK_TICKS;
        out.set(new Uint8Array(blocks[i].buf, 0, n * REC_BYTES), w);
        w += n * REC_BYTES;
      }
      return out;
    },
  };
}

// THE LAYOUT, in one place, read by the packer, the reader and the header that
// ships inside trace.bin. Changing a row here changes all three.
export const LAYOUT = [
  ['px', 'f32', 0], ['py', 'f32', 4], ['pz', 'f32', 8],
  ['vx', 'f32', 12], ['vy', 'f32', 16], ['vz', 'f32', 20],
  ['dyaw', 'i16', 24], ['dpitch', 'i16', 26],
  ['yaw', 'i16', 28], ['pitch', 'i16', 30],
  ['dtq', 'u16', 32], ['input', 'u16', 34], ['gdist', 'i16', 36],
  ['flags', 'u8', 38], ['mode', 'u8', 39], ['gcls', 'u8', 40], ['evt', 'u8', 41],
  ['nx', 'i8', 42], ['ny', 'i8', 43], ['nz', 'i8', 44],
  ['evtarg', 'u8', 45], ['chunk', 'u8', 46], ['seq', 'u8', 47],
];

export const FLAG = {
  grounded: 1, wiping: 2, boosting: 4, thrusting: 8,
  footed: 16, canopy: 32, inBounds: 64, live: 128,
};

const NO_GROUND = -32768;

export function unpack(v, off, origin) {
  const o = origin || [0, 0, 0];
  const gd = v.getInt16(off + 36, true);
  return {
    x: v.getFloat32(off + 0, true) + o[0],
    y: v.getFloat32(off + 4, true) + o[1],
    z: v.getFloat32(off + 8, true) + o[2],
    vx: v.getFloat32(off + 12, true),
    vy: v.getFloat32(off + 16, true),
    vz: v.getFloat32(off + 20, true),
    dyaw: v.getInt16(off + 24, true) * LOOK_Q,
    dpitch: v.getInt16(off + 26, true) * LOOK_Q,
    yaw: v.getInt16(off + 28, true) * ANG_Q,
    pitch: v.getInt16(off + 30, true) * ANG_Q,
    dt: DT_NOM * (v.getUint16(off + 32, true) / DT_Q),
    input: v.getUint16(off + 34, true),
    gdist: gd === NO_GROUND ? null : gd / 100,
    flags: v.getUint8(off + 38),
    mode: MODES[v.getUint8(off + 39)] || 'boots',
    gcls: v.getUint8(off + 40),
    evt: v.getUint8(off + 41),
    nx: v.getInt8(off + 42) / 127, ny: v.getInt8(off + 43) / 127, nz: v.getInt8(off + 44) / 127,
    evtarg: v.getUint8(off + 45) / 4,
    chunk: v.getUint8(off + 46),
    seq: v.getUint8(off + 47),
  };
}

// ------------------------------------------------------------------ recorder

/**
 * @param ctrl        the controller (read-only: we never write to it here)
 * @param collision   collision.js, for the ground probe under the feet
 * @param cfg         window.__PLAY
 * @param hooks       { pause(v), snapshot() -> data url, view() -> {position,yaw,pitch,fov},
 *                      flash(msg), buildInfo() }
 * @param armed       boolean — false in every shipped path
 */
export function createRecorder({ ctrl, collision, cfg = {}, hooks = {}, armed = false } = {}) {
  let on = !!armed;
  const pool = [];
  let prev = null, cur = null;

  // ---- what the last tick saw, so an event can be a TRANSITION rather than a
  // poll. All of it is scalar: no allocation, no object identity to keep alive
  // except lastTrick, which the controller replaces wholesale on every trick.
  let pRespawns = -1, pWipeT = 0, pGrounded = null, pMode = null;
  let pCanopy = 0, pSolid = 0, pTree = 0, pTrick = null;
  let pVelY = 0;
  // specs/0057 §8 — the park's own transitions. `pJib` is the jib id or null,
  // `pGrab` the grab name or null; both are read through one guarded accessor
  // below so a build with no rail.js (siberia, and every world before 0057)
  // records nothing rather than throwing on every tick.
  let pJib = null, pGrab = null;
  // ...and what the ride was carrying on its last tick, because `charge` and
  // `popped` are both back to zero by the time the jib-off edge is seen.
  let jibOffCharge = 0, jibOffPopped = false;
  let seq = 0, simT = 0;

  // ---- THE HEADING INPUT, and it is a DIFFERENCE rather than a subscription.
  //
  // The obvious way to record a look is to wrap ctrl.look() and add up what it
  // applied. That is what this did first, and it is wrong for a reason worth
  // writing down: it records the yaw changes it was TOLD about, and silently
  // drops every other one. `__player.setYaw()` is a real input — the harness
  // snaps the body round with it to stage a crossed-ski landing — and a bag
  // that missed it replayed a body that sailed straight past the wipeout it
  // was filed to show. (Measured: p50 error 0.00002 m for 4,266 ticks, then
  // 477 m.)
  //
  // So the recorder asks the only question that cannot be evaded: between the
  // end of the last step and the start of this one, how much did the heading
  // move BY SOMETHING THAT WAS NOT THE PHYSICS? Everything in that window is,
  // by definition, an input — a mouse, a thumb, a stick, a test hook — and
  // nothing in it is the gear model, because the gear model only ever runs
  // inside ctrl.update(). `look()` below is now only asked WHO did it, never
  // how much.
  let postYaw = null, postPitch = null;          // heading at the end of the last step
  let dYawIn = 0, dPitchIn = 0;                  // ...and how far it moved before this one
  let lookResY = 0, lookResP = 0, lookHit = false, lookTouch = false;

  // ---- a mark() the frame is about to spend. main.js sets it just before the
  // tick that carries the event (teleport, fence, lift board).
  let pending = 0, pendingArg = 0;

  // ---- THE INPUT LATCH, and it is not an optimisation — it is the difference
  // between a bag that replays and one that does not.
  //
  // `keys.jump` is an EDGE and controller.js consumes it: the last line of
  // update() is `keys.jump = false`. A recorder that reads the key object after
  // the step therefore never sees a single jump, and a replay of a run with a
  // jump in it flies a different line from the tick the pop happened on. (It
  // did: the first acceptance ride diverged at tick 1442, which was exactly the
  // jump, while the segment with no jump in it reproduced to 2e-5 m.)
  //
  // So main.js calls pre() on the line before ctrl.update() and tick() on the
  // line after, and what is recorded is the input the tick actually CONSUMED
  // paired with the state it PRODUCED — which is the only pairing a replay can
  // use, and the one a rosbag has always meant.
  // specs/0057 §8 — the park handles, read once per call and never held. Both
  // are published by their own module on `window` (rail.js:485, tricks.js:775),
  // exactly as `__playCollision` is, and both are absent in a world with no
  // park — so every reader below takes the null.
  const railNow = () => {
    try { const R = window.__rail; return R && R.on() ? R.state() : null; } catch { return null; }
  };
  const grabNow = () => {
    try { const G = window.__grab; return G ? G.state() : null; } catch { return null; }
  };

  let latch = 0, latched = false;
  function pre() {
    if (!on) return;
    const K = ctrl.keys;
    latch = 0;
    for (let i = 0; i < KEY_BITS.length; i++) if (K[KEY_BITS[i][0]]) latch |= KEY_BITS[i][1];
    // specs/0057 §5.1 — the bit is latched from the GRAB'S OWN STATE and not
    // from a key, and it means what §5.1 means: a hand is on the ski this tick.
    // specs/0057 §4.4 (B, Greg 2026-09-06) — the grab now HAS a key (B,
    // `keys.grab`) and this line still does not read it. That is deliberate and
    // it is what keeps the bags: the bit meant "held" when Space was the grab,
    // it means "held" now, and step()'s replay reads it back into `keys.grab`.
    { const g = grabNow(); if (g && g.held) latch |= IN.grab; }
    latched = true;
    // ...and the heading input, as the difference nothing can evade (above)
    dYawIn = postYaw === null ? 0 : ctrl.yaw - postYaw;
    dPitchIn = postPitch === null ? 0 : ctrl.pitch - postPitch;
  }

  // ---- cost accounting (specs/0058 1.8). A running mean, not a log.
  let costSum = 0, costN = 0, costMax = 0;

  function segNew(evt, arg) {
    if (cur && cur.ticks) { if (prev) prev.reset(); prev = cur; }
    cur = makeSegment(pool);
    // A cut is a DISCONTINUITY, not an input. A teleport writes the yaw itself
    // and the replay's arm() re-establishes it from the segment header, so the
    // heading jump must not also be handed to the controller as a look — and
    // the residual must go with it, or a half-turn of teleport dribbles out
    // over the first ticks of the new segment.
    dYawIn = 0; dPitchIn = 0; lookResY = 0; lookResP = 0;
    const p = ctrl.position;
    cur.setStart({
      pos: [p.x, p.y, p.z], yaw: ctrl.yaw, pitch: ctrl.pitch,
      mode: ctrl.mode, t: simT, evt, evtName: EV_NAME[evt] || String(evt),
    }, [p.x, p.y, p.z]);
    cur.addEvent({ tick: 0, t: simT, code: evt, name: EV_NAME[evt] || String(evt), arg: arg || 0,
                   pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] });
    return evt;
  }

  function addEvent(code, arg) {
    if (!cur) return;
    const p = ctrl.position;
    cur.addEvent({ tick: cur.ticks, t: +simT.toFixed(4), code,
                   name: EV_NAME[code] || String(code), arg: +(arg || 0).toFixed(3),
                   pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] });
  }

  // ---- THE HOT PATH.
  function tick(dt, live = true) {
    if (!on) return;
    const t0 = (costN < 4000) ? performance.now() : 0;   // stop measuring once the mean is settled
    simT += dt;

    // ---- 1. the events that CUT, first, so the record lands in the right segment
    let evt = 0, evtArg = 0;
    const respawns = ctrl.respawns;
    if (pRespawns < 0) { evt = segNew(EV.spawn); pRespawns = respawns; }
    else if (pending && CUTS.has(pending)) { evt = segNew(pending, pendingArg); pRespawns = respawns; pending = 0; }
    else if (respawns !== pRespawns) { evt = segNew(EV.respawn); pRespawns = respawns; }

    // ---- 2. the ones that do not
    if (!evt && pending) { evt = pending; evtArg = pendingArg; addEvent(evt, evtArg); }
    pending = 0; pendingArg = 0;

    const grounded = ctrl.grounded;
    const wipeT = ctrl.wipeT;
    const mode = ctrl.mode;
    const p = ctrl.position, v = ctrl.velocity;

    // landing / takeoff, and the impact is the vertical speed the frame ARRIVED
    // with — after the snap it is zero, which is why it is latched
    if (pGrounded !== null && grounded !== pGrounded) {
      const code = grounded ? EV.land : EV.takeoff;
      const arg = grounded ? Math.max(0, -pVelY) : 0;
      if (!evt) { evt = code; evtArg = arg; }
      addEvent(code, arg);
    }
    if (wipeT > 0 && pWipeT <= 0) {
      const w = ctrl.lastTrick;
      const arg = Math.hypot(v.x, v.z);
      if (!evt) { evt = EV.wipeStart; evtArg = arg; }
      addEvent(EV.wipeStart, arg);
      const last = cur && cur.events[cur.events.length - 1];
      if (last && w) { last.why = w.why || w.name || null; last.deg = w.deg || 0; }
    } else if (wipeT <= 0 && pWipeT > 0) {
      if (!evt) evt = EV.wipeEnd;
      addEvent(EV.wipeEnd, 0);
    }
    if (ctrl.canopyHits !== pCanopy) { if (!evt) evt = EV.canopy; addEvent(EV.canopy, Math.hypot(v.x, v.z)); pCanopy = ctrl.canopyHits; }
    if (ctrl.treeHits !== pTree) { if (!evt) evt = EV.tree; addEvent(EV.tree, Math.hypot(v.x, v.z)); pTree = ctrl.treeHits; }
    if (ctrl.solidWipes !== pSolid) {
      const b = ctrl.lastBlock;
      if (!evt) evt = EV.solid;
      addEvent(EV.solid, b ? b.closing : 0);
      const last = cur && cur.events[cur.events.length - 1];
      if (last && b) { last.why = b.why || null; last.mesh = b.mesh || null; }
      pSolid = ctrl.solidWipes;
    }
    const trick = ctrl.lastTrick;
    if (trick && trick !== pTrick) {
      if (trick.name !== 'wipeout') { if (!evt) evt = EV.trick; addEvent(EV.trick, trick.deg || 0);
        const last = cur && cur.events[cur.events.length - 1];
        if (last) last.why = trick.name; }
      pTrick = trick;
    }
    if (pMode !== null && mode !== pMode) { if (!evt) evt = EV.gear; addEvent(EV.gear, MODE_ID[mode] || 0);
      const last = cur && cur.events[cur.events.length - 1];
      if (last) last.why = mode; }

    // specs/0057 §8 — THE PARK, three transitions and no polling.
    //
    // A jib ride is a state with two edges, and the id is what tells one ride
    // from the next: sliding off `deck-floor` straight onto `deck-striped`
    // without touching the snow is jib-off + jib-on on the same tick, and a
    // recorder that only watched a boolean would file one ride across two
    // features. `why` carries WHICH entry it was — 'ride' or the hard-fall
    // save's 'jib' (§2.3) — because a rail that caught a crash and a rail you
    // rode onto are the same state and not the same event.
    {
      const R = railNow();
      const id = R ? R.jib : null;
      if (id !== pJib) {
        if (pJib) {
          if (!evt) evt = EV.jibOff;
          addEvent(EV.jibOff, jibOffCharge);
          const last = cur && cur.events[cur.events.length - 1];
          if (last) { last.why = jibOffPopped ? 'pop' : 'end'; last.jib = pJib; }
        }
        if (id) {
          if (!evt) evt = EV.jibOn;
          addEvent(EV.jibOn, R.entryYaw || 0);
          const last = cur && cur.events[cur.events.length - 1];
          if (last) { last.why = R.why || null; last.jib = id; last.type = R.type || null; }
        }
        pJib = id;
      }
      // latched WHILE on, because both are zero the tick after the release
      if (R) { jibOffCharge = R.charge || 0; jibOffPopped = !!R.popped; }
    }
    // ...and the grab, on the tick the hand goes on. §5.1 binds no new key, so
    // the edge is `__grab.state().grab` becoming a name — which is also the
    // tick `input`'s bit 15 comes up, and the two are asserted against each
    // other by the PARK suite rather than derived from one another here.
    {
      const G = grabNow();
      const name = G && G.held ? G.grab : null;
      if (name !== pGrab) {
        if (name) {
          if (!evt) evt = EV.grab;
          addEvent(EV.grab, (G && G.base) || 0);
          const last = cur && cur.events[cur.events.length - 1];
          if (last) { last.why = name; last.tweak = !!(G && G.tweak); }
        }
        pGrab = name;
      }
    }

    // ---- 3. the ground probe. The SAME question the controller asks
    // (collision.js groundAt from stepUp above the feet), asked once more so a
    // fall-through is visible in the trace as a negative gdist rather than
    // inferred from a position that looks fine.
    let gy = null, nx = 0, ny = 1, nz = 0, gcls = 255;
    try {
      gy = collision.groundAt(p.x, p.z, p.y + (ctrl.T ? ctrl.T.stepUp : 0.55));
      if (gy !== null) {
        const q = collision.groundNormal ? collision.groundNormal() : null;
        if (q) { nx = q.x; ny = q.y; nz = q.z; }
        gcls = collision.groundClass ? collision.groundClass() : 0;
      }
    } catch { gy = null; }
    if (gy === null && !grounded && v.y < -1 && !evt) { evt = EV.void; addEvent(EV.void, -v.y); }

    // ---- 4. pack it
    const origin = cur.origin;
    const { v: dv, off } = cur.slot();

    dv.setFloat32(off + 0, p.x - origin[0], true);
    dv.setFloat32(off + 4, p.y - origin[1], true);
    dv.setFloat32(off + 8, p.z - origin[2], true);
    dv.setFloat32(off + 12, v.x, true);
    dv.setFloat32(off + 16, v.y, true);
    dv.setFloat32(off + 20, v.z, true);

    // the heading input, quantised with its residual carried (specs/0058 1.4)
    let qy = 0, qp = 0;
    if (dYawIn || lookResY) {
      const want = (dYawIn + lookResY) / LOOK_Q;
      qy = clamp(Math.round(want), -32768, 32767);
      lookResY = (want - qy) * LOOK_Q;
    }
    if (dPitchIn || lookResP) {
      const want = (dPitchIn + lookResP) / LOOK_Q;
      qp = clamp(Math.round(want), -32768, 32767);
      lookResP = (want - qp) * LOOK_Q;
    }
    dv.setInt16(off + 24, qy, true);
    dv.setInt16(off + 26, qp, true);
    dv.setInt16(off + 28, i16(ctrl.yaw / ANG_Q), true);
    dv.setInt16(off + 30, i16(ctrl.pitch / ANG_Q), true);
    dv.setUint16(off + 32, clamp(Math.round(dt / DT_NOM * DT_Q), 1, DT_MAX_Q), true);

    // the latch, or — for a caller that forgot pre() — the keys as they are
    // now, which is right for every level input and loses only the jump edge
    let input = latch;
    if (!latched) {
      const K = ctrl.keys;
      for (let i = 0; i < KEY_BITS.length; i++) if (K[KEY_BITS[i][0]]) input |= KEY_BITS[i][1];
      const g = grabNow(); if (g && g.held) input |= IN.grab;   // specs/0057 §8
    }
    latched = false; latch = 0;
    // `look` is DERIVED from the heading difference rather than reported by a
    // wrapper — see the note on postYaw. `touch` is only ever set by a caller
    // that says so, and nothing in the shipped player does, so it stays a
    // reserved bit rather than a lie.
    if (dYawIn || dPitchIn || lookHit) input |= IN.look;
    if (lookTouch) input |= IN.touch;
    if (!live) input |= IN.paused;
    dv.setUint16(off + 34, input, true);

    dv.setInt16(off + 36, gy === null ? NO_GROUND : i16((p.y - gy) * 100), true);

    let flags = 0;
    if (grounded) flags |= FLAG.grounded;
    if (wipeT > 0) flags |= FLAG.wiping;
    if (ctrl.boosting) flags |= FLAG.boosting;
    if (ctrl.thrusting) flags |= FLAG.thrusting;
    if (ctrl.footedNow) flags |= FLAG.footed;
    if (ctrl.canopyStem >= 0) flags |= FLAG.canopy;
    if (collision.inBounds ? collision.inBounds(p.x, p.z) : true) flags |= FLAG.inBounds;
    if (live) flags |= FLAG.live;
    dv.setUint8(off + 38, flags);
    dv.setUint8(off + 39, MODE_ID[mode] == null ? 0 : MODE_ID[mode]);
    dv.setUint8(off + 40, gcls);
    dv.setUint8(off + 41, evt);
    dv.setInt8(off + 42, i8(nx * 127));
    dv.setInt8(off + 43, i8(ny * 127));
    dv.setInt8(off + 44, i8(nz * 127));
    dv.setUint8(off + 45, u8(evtArg * 4));
    dv.setUint8(off + 46, 255);        // specs/0051's tile id; chunks.js is not merged
    dv.setUint8(off + 47, seq & 0xff);
    seq++;

    // ---- 5. carry
    pGrounded = grounded; pWipeT = wipeT; pMode = mode; pVelY = v.y;
    postYaw = ctrl.yaw; postPitch = ctrl.pitch;
    dYawIn = 0; dPitchIn = 0; lookHit = false; lookTouch = false;

    // The first few ticks are the JIT warming up and the first block being
    // allocated, and on a software rasteriser they can be two orders out. They
    // are counted in the mean (they are real) but kept out of the MAX, which
    // otherwise reports a page stall as the cost of a memcpy.
    if (t0) {
      const ms = performance.now() - t0;
      costSum += ms; costN++;
      if (costN > 10 && ms > costMax) costMax = ms;
    }
  }

  // main.js's ctrl.look wrapper reports the RADIANS it actually applied, so the
  // replay never has to know anybody's mouse sensitivity.
  // PROVENANCE ONLY. How far the head moved is the difference above; this says
  // whether a hand or a thumb moved it, which is two bits in the record and
  // nothing a replay depends on.
  function look(dyaw, dpitch, touch) {
    if (!on) return;
    if (dyaw || dpitch) lookHit = true;
    if (touch) lookTouch = true;
  }

  // the three events that are not derivable from the controller
  function mark(code, arg = 0) { if (on) { pending = code; pendingArg = arg; } }

  // ------------------------------------------------------------- serialise

  // specs/0058 §1.8 — WHAT WAS ON THE FEET. Read off the live player, never
  // back out of localStorage: `?ski=` beats storage at boot and a bag that
  // re-read storage would record the pick the URL had already overridden.
  // `hooks.gear()` is main.js's one-line accessor over the rack ids it resolved.
  function gearBlock() {
    let g = null;
    try { g = hooks.gear ? hooks.gear() : null; } catch { g = null; }
    if (!g) return null;
    const out = {};
    for (const spec of Object.values(LS_PHYSICS)) {
      out[spec.field] = (g[spec.field] == null ? null : String(g[spec.field]));
    }
    return out;
  }

  function header(note) {
    const segs = [];
    let off = 0;
    for (const [name, s] of [['prev', prev], ['cur', cur]]) {
      if (!s || !s.ticks) continue;
      const n = s.ticks * REC_BYTES;
      segs.push({
        name, ticks: s.ticks, dropped: s.dropped,
        byteOffset: off, byteLength: n,
        origin: s.origin, start: s.start,
        events: s.events.length,
      });
      off += n;
    }
    return {
      format: 'RIDE0058', version: GEAR_VERSION,
      recBytes: REC_BYTES, dtNom: DT_NOM, dtQ: DT_Q,
      lookQ: LOOK_Q, angQ: ANG_Q,
      layout: LAYOUT.map(([k, t, o]) => ({ field: k, type: t, offset: o })),
      inputBits: IN, flagBits: FLAG, modes: MODES, events: EV_NAME,
      // specs/0058 §1.8 — version 2. A v1 bag has no `gear` and replays with
      // whatever the replaying browser happens to remember, which is the bug
      // this block exists to close; parseTrace() warns and carries on.
      gear: gearBlock(),
      gearKeys: Object.fromEntries(Object.entries(LS_PHYSICS).map(([k, v]) => [k, v.field])),
      poi: cfg.poi || null, run: cfg.run || null,
      created: new Date().toISOString(),
      note: String(note || ''),
      segments: segs,
    };
  }

  // "RIDE0058" + u32 header length + JSON header + prev records + cur records
  function pack(note) {
    const h = header(note);
    const hj = new TextEncoder().encode(JSON.stringify(h));
    const body = [];
    let bodyLen = 0;
    for (const s of [prev, cur]) {
      if (!s || !s.ticks) continue;
      const b = s.bytesOut();
      body.push(b); bodyLen += b.length;
    }
    const out = new Uint8Array(12 + hj.length + bodyLen);
    out.set(new TextEncoder().encode('RIDE0058'), 0);
    new DataView(out.buffer).setUint32(8, hj.length, true);
    out.set(hj, 12);
    let w = 12 + hj.length;
    for (const b of body) { out.set(b, w); w += b.length; }
    return { bytes: out, head: h };
  }

  const B64 = (u8a) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8a.length; i += CH) s += String.fromCharCode.apply(null, u8a.subarray(i, i + CH));
    return btoa(s);
  };

  // specs/0058 §1.8 — the gear block as query parameters, in the form every
  // rack already resolves (`?ski=` → localStorage → default, ski.js:1564 and
  // its four siblings). This is what makes a spawn or replay URL land on the
  // same equipment, in a browser that remembers something else.
  // `boots` has no query parameter (`param: null`) and is skipped.
  function gearParams(g) {
    if (!g) return '';
    let q = '';
    for (const spec of Object.values(LS_PHYSICS)) {
      if (!spec.param) continue;
      const v = g[spec.field];
      if (v) q += `&${spec.param}=${encodeURIComponent(v)}`;
    }
    return q;
  }

  function spawnUrlFor(s) {
    if (!s || !s.start) return null;
    const p = s.start.pos;
    return `/play?poi=${encodeURIComponent(cfg.poi || '')}&run=${encodeURIComponent(cfg.run || '')}`
      + `&spawn=${p.map((n) => n.toFixed(1)).join(',')}`
      + `&yaw=${(s.start.yaw * 180 / Math.PI).toFixed(1)}`
      + gearParams(gearBlock());
  }

  function meta(note, head) {
    const idx = [];
    for (const [name, s] of [['prev', prev], ['cur', cur]]) {
      if (!s || !s.ticks) continue;
      for (const e of s.events) idx.push({ seg: name, ...e });
    }
    return {
      kind: 'trace', poi: cfg.poi || null, run: cfg.run || null,
      created: head.created,
      build: (hooks.buildInfo ? hooks.buildInfo() : null),
      dtNom: DT_NOM, recBytes: REC_BYTES, version: head.version,
      // specs/0058 §1.8 — the equipment, and the query string that reproduces
      // it. The server appends `gearParams` to each segment's replayUrl.
      gear: head.gear,
      gearParams: gearParams(head.gear),
      segments: head.segments.map((s) => ({
        name: s.name, ticks: s.ticks, dropped: s.dropped,
        seconds: +(s.ticks * DT_NOM).toFixed(2),
        start: s.start, spawnUrl: spawnUrlFor(s.name === 'prev' ? prev : cur),
        replayUrl: null,     // filled by the server once the id exists
      })),
      note: String(note || ''),
      events: idx,
    };
  }

  // ------------------------------------------------------------- the panel
  // Nothing below exists in the DOM until J is pressed, and all of it is removed
  // again on submit or discard — the same discipline specs/0004's annotator has.
  let ui = null, filing = false;
  const PANEL_CSS = `
.ptrace { position: fixed; inset: 0; z-index: 44; background: rgba(11,11,10,.72);
  display: grid; place-items: center; }
.ptrace__panel { width: min(560px, 94vw); display: grid; gap: 8px;
  background: rgba(23,22,20,.96); color: var(--panel); border: 1px solid var(--accent);
  border-radius: var(--r-sm); padding: 12px; box-shadow: 0 14px 40px rgba(0,0,0,.5); }
.ptrace__row { display: flex; align-items: center; gap: 6px; }
.ptrace__stat { flex: 1; text-align: right; text-transform: none; letter-spacing: .04em; }
.ptrace__note { width: 100%; box-sizing: border-box; resize: vertical;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.5; color: var(--panel);
  background: rgba(244,241,234,.08); border: 1px solid rgba(244,241,234,.3);
  border-radius: var(--r-sm); padding: 7px 8px; }
.ptrace__note:focus { outline: none; border-color: var(--accent); }
.ptrace__hint { color: #a49d90; font-size: 9px; letter-spacing: .06em; text-transform: none; }
`;
  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function summary() {
    const line = (n, s) => (s && s.ticks
      ? `${n} ${(s.ticks * DT_NOM).toFixed(1)}s · ${s.ticks} ticks · ${s.events.length} events`
      : `${n} —`);
    return `${line('prev', prev)}    ${line('cur', cur)}    ${(bytesLive() / 1024).toFixed(0)} KB`;
  }

  function openPanel() {
    if (ui || !on) return false;
    if (!cur || !cur.ticks) { if (hooks.flash) hooks.flash('nothing recorded yet'); return false; }
    let shot = null;
    try { shot = hooks.snapshot ? hooks.snapshot() : null; } catch { shot = null; }
    if (hooks.pause) hooks.pause(true);
    const style = mk('style'); style.id = 'ptrace-style'; style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    const root = mk('div', 'ptrace');
    const panel = mk('section', 'ptrace__panel');
    const head = mk('div', 'ptrace__row');
    head.append(mk('span', 'lbl lbl--accent', 'file a ride trace'), mk('span', 'spacer'),
      mk('span', 'lbl', cfg.run || ''));
    const sum = mk('div', 'ptrace__hint', summary());
    const note = mk('textarea', 'ptrace__note');
    note.rows = 4;
    note.placeholder = 'what went wrong — "fell through the ridge at the second knuckle"';
    const row = mk('div', 'ptrace__row');
    const okBtn = mk('button', 'btn btn--accent', 'file · ENTER'); okBtn.type = 'button';
    const noBtn = mk('button', 'btn btn--ghost', 'cancel · ESC'); noBtn.type = 'button';
    const stat = mk('span', 'lbl ptrace__stat', '');
    row.append(okBtn, noBtn, stat);
    panel.append(head, sum, note, row);
    root.append(panel);
    document.body.appendChild(root);
    ui = { root, style, note, okBtn, stat, shot };
    okBtn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
    noBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
    setTimeout(() => { try { note.focus(); } catch {} }, 0);
    return true;
  }

  function closePanel() {
    if (!ui) return false;
    ui.root.remove(); ui.style.remove();
    ui = null;
    if (hooks.pause) hooks.pause(false);
    return true;
  }

  async function submit() {
    if (!ui || filing) return null;
    filing = true;
    ui.okBtn.disabled = true;
    ui.stat.textContent = 'packing…';
    try {
      const text = ui.note.value.trim();
      addEvent(EV.file, 0);
      const { bytes, head } = pack(text);
      const m = meta(text, head);
      const view = hooks.view ? hooks.view() : { position: [0, 0, 0], yaw: 0, pitch: 0, fov: 72 };
      ui.stat.textContent = 'filing…';
      const r = await fetch('/api/tuning/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'trace', poi: cfg.poi, run: cfg.run,
          view, note: text,
          trace: B64(bytes), meta: m,
          snapshot: ui.shot ? String(ui.shot).replace(/^data:[^,]*,/, '') : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
      last = j;
      closePanel();
      if (hooks.flash) hooks.flash('trace · ' + j.id);
      return j;
    } catch (e) {
      if (ui) { ui.okBtn.disabled = false; ui.stat.textContent = 'failed · ' + (e.message || e); }
      console.error('[trace] file failed', e);
      return null;
    } finally { filing = false; }
  }

  let last = null;
  const FILE_KEY = 'KeyJ';

  // ---------------------------------------------------------------- replay
  // specs/0058 §3. It lives HERE and not in main.js for two reasons that are
  // the same reason: main.js SHIPS and this file does not, so every byte of it
  // put in main.js is a byte in the public build; and specs/0037's C18 locks
  // main.js's edit ranges, so a sixty-line block in it is a rider-contract
  // failure this feature has no business causing. main.js hands over the four
  // things only it can reach — the step, the gear, the camera and the pause —
  // and owns nothing else about replay.
  async function loadReplay(id, seg = 'cur') {
    if (!hooks.step) throw new Error('this build wired no replay driver');
    const run = cfg.run || '';
    const url = `/files/runs/${encodeURIComponent(run)}/tuning/${encodeURIComponent(id)}/trace.bin`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not read ${url} — HTTP ${r.status}`);
    const bag = parseTrace(new Uint8Array(await r.arrayBuffer()));
    on = false;                      // a replay is not a recording
    if (hooks.pause) hooks.pause(true);   // the frame loop must not also step the body
    const rp = createReplay({
      bag, segName: seg,
      drive: { ctrl, setMode: hooks.setMode, step: hooks.step, setGear: hooks.setGear },
    });
    const start = rp.arm();
    rp.chipTick();
    const handle = {
      ...rp, id, seg, head: () => bag.head, start: () => start,
      // wall-clock playback, for a human watching. The recorded dt is what a
      // tick is WORTH, so a 60 Hz capture plays back in real time on a 144 Hz
      // screen and the other way round.
      play: () => new Promise((res) => {
        let t = performance.now();
        const f = () => {
          const now = performance.now();
          let n = Math.min(600, Math.round(Math.min(250, now - t) / 1000 / DT_NOM));
          t = now;
          let alive = true;
          while (n-- > 0 && alive) alive = rp.step();
          if (hooks.applyCam) hooks.applyCam();
          rp.chipTick();
          if (alive) requestAnimationFrame(f); else res(rp.drift());
        };
        requestAnimationFrame(f);
      }),
      // ...and as fast as the CPU allows, for a gate
      fast: () => { rp.run(); rp.chipTick(); return rp.drift(); },
    };
    try { window.__replay = handle; } catch { /* not a browser */ }
    return { id, seg, ticks: rp.ticks, start };
  }

  // main.js and dev.js both give this first refusal; it answers true when it
  // consumed the key. Returns false for everything when unarmed, which is what
  // makes the stub's `key: () => false` an exact substitute.
  function key(code, down = true) {
    if (!on) return false;
    if (ui) {
      if (!down) return true;
      if (code === 'Escape') { closePanel(); return true; }
      if (code === 'Enter' || code === 'NumpadEnter') { submit(); return true; }
      return true;
    }
    if (!down) return false;
    if (code !== FILE_KEY) return false;
    openPanel();
    return true;
  }

  function bytesLive() { return (prev ? prev.bytes : 0) + (cur ? cur.bytes : 0) + pool.length * BLOCK_BYTES; }

  const api = {
    armed: () => on,
    setArmed: (v) => { on = !!v; return on; },
    pre, tick, look, mark, key, loadReplay,
    fileKey: () => FILE_KEY,
    open: openPanel, close: closePanel, submit,
    panelOpen: () => !!ui,
    setNote: (t) => { if (ui) ui.note.value = String(t == null ? '' : t); return ui ? ui.note.value : null; },
    lastRequest: () => last,
    EV, IN, FLAG, MODES, DT_NOM, REC_BYTES, DRIFT_TOL,
    // ---- what a gate reads
    segments: () => ({
      prev: prev && prev.ticks ? { ticks: prev.ticks, dropped: prev.dropped, events: prev.events.length, start: prev.start } : null,
      cur: cur && cur.ticks ? { ticks: cur.ticks, dropped: cur.dropped, events: cur.events.length, start: cur.start } : null,
    }),
    events: (which = 'cur') => {
      const s = which === 'prev' ? prev : cur;
      return s ? s.events.map((e) => ({ ...e })) : [];
    },
    at: (i, which = 'cur') => { const s = which === 'prev' ? prev : cur; return s ? s.at(i) : null; },
    header: (note) => header(note),
    pack: (note) => pack(note),
    meta: (note) => meta(note, header(note)),
    b64: (note) => B64(pack(note).bytes),
    // specs/0058 1.8 — the two numbers the spec promises to print
    cost: () => ({
      msPerTick: costN ? +(costSum / costN).toFixed(5) : null,
      msMax: +costMax.toFixed(4), ticks: costN,
      bytesLive: bytesLive(), bytesPerTick: REC_BYTES,
      blocks: (prev ? prev.blocks.length : 0) + (cur ? cur.blocks.length : 0),
      pooled: pool.length,
    }),
    reset: () => { if (prev) prev.reset(); if (cur) cur.reset(); prev = null; cur = null; pRespawns = -1; seq = 0;
      pJib = null; pGrab = null; jibOffCharge = 0; jibOffPopped = false; },   // specs/0057 §8
  };
  // The lab handle, on the convention controller.js and collision.js already
  // use — `window.__trace`, its own name. NOTHING is hung off `window.__player`:
  // specs/0037's C13 locks that key set against a baseline, and a debugging
  // instrument has no business spending the rider contract's budget to be
  // reachable.
  try { if (typeof window !== 'undefined') window.__trace = api; } catch { /* not a browser */ }
  // ...and `?replay=<req-id>` boots itself, so main.js carries no replay at all.
  try {
    if (cfg.qs && cfg.qs.has('replay') && hooks.step) {
      loadReplay(cfg.qs.get('replay'), cfg.qs.get('seg') || 'cur')
        .then(() => { if (hooks.flash) hooks.flash('replay armed · __replay.play()'); })
        .catch((e) => { if (hooks.flash) hooks.flash('replay failed · ' + (e.message || e)); console.error('[replay]', e); });
    }
  } catch (e) { console.error('[replay] boot', e); }
  return api;
}

// ------------------------------------------------------------------- replay
// specs/0058 3. BENCH/DEV ONLY — this whole file is stubbed out of the public
// build (tools/export-red-dog/worlds/*.json, transform "stub-module"), exactly
// as dev.js is, so none of this can reach a player.
//
// The replay is a PHYSICS reproduction, not a playback: it feeds the recorded
// inputs and the recorded dt into the same ctrl.update()/playerSystems() pair
// __player.stepFixed calls, and lets the controller produce the trajectory. If
// the two disagree, the build changed — which is the whole point.

export function parseTrace(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const magic = new TextDecoder().decode(u.subarray(0, 8));
  if (magic !== 'RIDE0058') throw new Error('not a RIDE0058 trace (magic "' + magic + '")');
  const hlen = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(u.subarray(12, 12 + hlen)));
  // specs/0058 §1.8 — a v1 bag predates the gear block, so it replays on
  // whatever equipment the replaying browser happens to remember. That is a
  // legitimate 7 m of drift and it must not look like a physics regression, so
  // it is SAID, loudly, rather than left for someone to work out from the
  // trajectory the way req-20260905-215906 had to be.
  if (!head.gear) {
    head.gearWarning = (head.version || 1) < GEAR_VERSION
      ? `RIDE0058 v${head.version || 1} bag: no gear block (added at v${GEAR_VERSION}). The replay will use whatever ski/bike/glider/sled/snowmobile THIS browser remembers, so drift is not evidence of a physics change. Pass ?ski=<id> etc. by hand if you know them.`
      : 'RIDE0058 bag carries no gear block — the recorder was armed without hooks.gear.';
    try { console.warn('[trace] ' + head.gearWarning); } catch { /* not a browser */ }
  }
  const base = 12 + hlen;
  const segs = {};
  for (const s of head.segments) {
    const view = new DataView(u.buffer, u.byteOffset + base + s.byteOffset, s.byteLength);
    segs[s.name] = {
      ...s,
      view,
      at: (i) => unpack(view, i * head.recBytes, s.origin),
    };
  }
  return { head, segs };
}

/**
 * @param bag       parseTrace()'s result
 * @param segName   'cur' | 'prev'
 * @param drive     { ctrl, step(dt), setMode(m) } — main.js supplies step() so
 *                  the replay runs the SAME playerSystems the game does
 */
export function createReplay({ bag, segName = 'cur', drive }) {
  const seg = bag.segs[segName];
  if (!seg) throw new Error('no segment "' + segName + '" in this trace');
  const { ctrl } = drive;
  let i = 0, running = false;
  const err = [];            // per-tick 3D position error
  let maxErr = 0, firstOver = -1, maxAt = -1;
  const seen = [];           // the event codes the REPLAY produced

  // specs/0058 §1.8 — THE EQUIPMENT GOES ON FIRST, before the gear is selected
  // and long before the first tick, because every rack's setter rewrites the
  // LIVE tuning object the controller's registry holds. Done here rather than
  // left to the URL so a replay lands on the recorded skis whether it was
  // opened from `replayUrl` or armed by hand in an already-booted page — which
  // is the whole of `drift p50 ≤ 0.05 m with no manual query parameter`.
  const gearApplied = {};
  function applyGear() {
    const g = bag.head && bag.head.gear;
    if (!g || !drive.setGear) return null;
    for (const [field, id] of Object.entries(g)) {
      if (!id) continue;
      try { gearApplied[field] = drive.setGear(field, id); } catch (e) { gearApplied[field] = 'FAILED: ' + (e.message || e); }
    }
    return gearApplied;
  }

  // Was this bag captured on the fixed step, or off the wall clock? One dtq for
  // every tick means stepFixed drove it and the dt round-trips exactly; anything
  // else is a person's rAF loop. Read once, from the records themselves.
  let fixedStepCache = null;
  function isFixedStep() {
    if (fixedStepCache !== null) return fixedStepCache;
    if (!seg.ticks) return (fixedStepCache = true);
    const dv = seg.view, rb = bag.head.recBytes;
    const first = dv.getUint16(32, true);
    fixedStepCache = true;
    for (let k = 1; k < seg.ticks; k++) {
      if (dv.getUint16(k * rb + 32, true) !== first) { fixedStepCache = false; break; }
    }
    return fixedStepCache;
  }

  function arm() {
    const s = seg.start;
    applyGear();
    if (drive.setMode) drive.setMode(s.mode);
    ctrl.teleport({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }, s.yaw);
    if (ctrl.setPitch) ctrl.setPitch(s.pitch);
    for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false;
    i = 0; err.length = 0; maxErr = 0; firstOver = -1; maxAt = -1; seen.length = 0;
    running = true;
    return {
      at: s.pos.slice(), yaw: s.yaw, mode: s.mode, ticks: seg.ticks,
      gear: bag.head.gear || null, gearApplied: { ...gearApplied },
      gearWarning: bag.head.gearWarning || null,
    };
  }

  // one recorded tick. Returns false at the end of the segment.
  function step() {
    if (!running || i >= seg.ticks) { running = false; return false; }
    const r = seg.at(i);
    // the look input, applied exactly as controller.js's look() applies it
    if (r.dyaw) ctrl.setYaw(ctrl.yaw + r.dyaw);
    if (r.dpitch && ctrl.setPitch) ctrl.setPitch(ctrl.pitch + r.dpitch);
    const K = ctrl.keys;
    K.forward = !!(r.input & IN.forward); K.back = !!(r.input & IN.back);
    K.left = !!(r.input & IN.left); K.right = !!(r.input & IN.right);
    K.sprint = !!(r.input & IN.sprint);
    K.jump = !!(r.input & IN.jump); K.jumpHeld = !!(r.input & IN.jumpHeld);
    K.spinLeft = !!(r.input & IN.spinLeft); K.spinRight = !!(r.input & IN.spinRight);
    K.flipFwd = !!(r.input & IN.flipFwd); K.flipBack = !!(r.input & IN.flipBack);
    K.tuck = !!(r.input & IN.tuck);
    // specs/0057 §4.4 (B, Greg 2026-09-06) — AND THE GRAB, which the replay did
    // not have to drive while the grab WAS `jumpHeld`: bit 6 carried it for
    // free. B gave the grab its own key, so bit 15 has to be handed back to
    // `keys.grab` here or a replayed air would never take a hand off the ski.
    //
    // THIS IS WHY EVERY FILED BAG STILL REPLAYS. The bit's MEANING is unchanged
    // — pre() has latched it off `__grab.state().held` ("a hand is on the ski
    // this tick") since §8, never off a key — so a trace filed when Space was
    // the grab carries exactly the same bit a trace filed today carries, and
    // this line reproduces the grab out of it without knowing which key was
    // under the finger. The replay drives INPUT BITS, not key codes.
    K.grab = !!(r.input & IN.grab);
    drive.step(r.dt);
    const p = ctrl.position;
    const d = Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z);
    err.push(d);
    if (d > maxErr) { maxErr = d; maxAt = i; }
    if (firstOver < 0 && d > DRIFT_TOL) firstOver = i;
    if (r.evt) seen.push({ tick: i, code: r.evt, name: EV_NAME[r.evt] || String(r.evt) });
    i++;
    return i < seg.ticks;
  }

  function run(n = Infinity) { let k = 0; while (k < n && step()) k++; return { tick: i, done: i >= seg.ticks }; }

  // ---- the HUD chip. It lives here rather than in hud.js because hud.js SHIPS
  // and this file does not: a chip that only ever appears on the bench belongs
  // in the module the exporter stubs.
  let chipEl = null;
  const CHIP_CSS = `
.ptrace-chip { position: fixed; left: 12px; bottom: 12px; z-index: 32;
  font-family: var(--mono, ui-monospace, monospace); font-size: 10px; letter-spacing: .1em;
  /* specs/0055 §1.1, §10.3 — cream and the signal colour by name */
  color: var(--p-cream); background: rgba(23,22,20,.86); border: 1px solid var(--p-hazard);
  border-radius: 3px; padding: 5px 8px; pointer-events: none; white-space: pre; }
.ptrace-chip b { color: var(--p-hazard); }`;
  function chip(text) {
    if (typeof document === 'undefined') return null;
    if (!chipEl) {
      const st = document.createElement('style');
      st.id = 'ptrace-chip-css'; st.textContent = CHIP_CSS;
      document.head.appendChild(st);
      chipEl = document.createElement('div');
      chipEl.className = 'ptrace-chip';
      document.body.appendChild(chipEl);
    }
    chipEl.innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'REPLAY ';
    chipEl.append(b, document.createTextNode(text));
    return chipEl;
  }
  function chipTick() {
    return chip(`${segName}  ${i}/${seg.ticks}  ${(i * DT_NOM).toFixed(1)}s  drift ${maxErr.toFixed(3)} m`);
  }

  return {
    arm, step, run, chip, chipTick,
    gear: () => (bag.head.gear || null),
    gearApplied: () => ({ ...gearApplied }),
    gearWarning: () => (bag.head.gearWarning || null),
    get tick() { return i; },
    get ticks() { return seg.ticks; },
    get running() { return running; },
    seg: () => segName,
    // THE DETERMINISM PROOF. `max` is the largest 3D error between the replayed
    // and the recorded trajectory; `first` is the tick it first went past
    // DRIFT_TOL, or -1 if it never did.
    // THE TOLERANCE MATCHES WHAT THE FORMAT CAN PROMISE (specs/0058 1.2).
    // A FIXED-STEP capture stores one dtq for every tick and reconstructs it
    // bit-for-bit, so `max` is the honest gate and 0.05 m is generous. A
    // WALL-CLOCK capture — a person riding at rAF — stores each frame's own dt
    // quantised to 2.03 us, and over a thousand ticks of a chaotic sim that
    // residual walks: measured 0.164 m of max on a 900-tick human ride whose
    // p50 was 0.0037 m. Holding a wall-clock bag to `max` would be asserting a
    // determinism the encoding never claimed, so it is gated on p50 and `max`
    // is reported beside it. Both numbers are always printed; only the gate
    // moves.
    drift: () => {
      const sorted = err.slice().sort((a, b) => a - b);
      const p50 = err.length ? +sorted[Math.floor(err.length / 2)].toFixed(5) : null;
      const p95 = err.length ? +sorted[Math.min(err.length - 1, Math.floor(err.length * 0.95))].toFixed(5) : null;
      return {
        max: +maxErr.toFixed(5), atTick: maxAt, first: firstOver,
        tol: DRIFT_TOL, n: err.length, p50, p95,
        fixedStep: isFixedStep(),
        gate: isFixedStep() ? 'max' : 'p50',
        ok: isFixedStep() ? maxErr <= DRIFT_TOL : (p50 !== null && p50 <= DRIFT_TOL),
      };
    },
    // The recorded event list vs. the one the replay walked past. Every record
    // carries its own `evt` byte, so "the same run happened" is a list compare
    // and not a re-derivation.
    eventsRecorded: () => {
      const out = [];
      for (let k = 0; k < seg.ticks; k++) {
        const r = seg.at(k);
        if (r.evt) out.push({ tick: k, code: r.evt, name: EV_NAME[r.evt] || String(r.evt) });
      }
      return out;
    },
    eventsSeen: () => seen.map((e) => ({ ...e })),
    errAt: (k) => err[k],
  };
}
