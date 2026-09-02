// D27 / D28 — touch. Loaded only on a coarse pointer.
//
// PROMOTED to bench source by specs/0003 (was tools/export-red-dog/templates/).
// It is ordinary player source now: edit it HERE, commit, bump the exporter pin.
//
// The whole seam is still two calls: it writes booleans into the same mutable
// object the physics reads by reference (`__player.keys`), and it calls the same
// `look()` the mouse calls. **No physics module and no gear module learns that
// touch exists.** That is the entire design, and it is why this file can be
// this small even after growing a stick.
//
// 2026-09-01 — Greg's phone playtest rewrote the left half. The old scheme was
// four invisible drag zones and the complaint was the one every invisible
// D-pad gets: you cannot feel where the middle is, so every re-grip is a new
// guess. The left half is now an ANCHORED ANALOG STICK — invisible until a
// finger lands, then planted exactly where the finger landed and drawn there
// until it lifts. The anchor is the finger, so the middle is wherever you put
// it and a re-grip cannot be wrong.
//
//   left half   finger down       plant the stick at that point, draw it
//   left half   push up           skate / tuck        keys.forward
//   left half   pull down         the signed push     keys.back
//   left half   left / right      carve               keys.left / keys.right
//                                 ...and, grounded only, a proportional
//                                 look-yaw on top of it — see ANALOG below
//   left half   lift              the stick vanishes, every move key clears
//   right half  drag              look                P.look(dx*.9, dy*.9, LOOK)
//   right half  tap               jump                keys.jump (edge)
//   right half  hold              jumpHeld            level, for the flare/pop path
//   any         double-tap        reset               P.respawn()
//   any         fast flick in the air                 spin
//   any         two-finger tap    camera              C
//
// ANALOG, and what the seam would and would not carry.
//
// ski.js consumes movement as BOOLEANS and nothing else: `keys.left` is worth
// `turn += 1` and `keys.forward` is worth one unit of signed push. There is no
// analog channel to write into, so the obvious trick is to duty-cycle the
// boolean — hold `keys.left` on for a fraction of the frames proportional to the
// stick's deflection. That was measured against what actually reads those keys
// and REJECTED: the ski's pump model scores EDGE TRANSITIONS. It low-passes the
// fall-line derivative over 0.12 s, thresholds the sign of it at ±0.02 to decide
// whether you are completing or initiating a turn, and counts the time the ski
// spends flat (`_flatT`) as the cross-under signal. A chopped steer input is a
// chopped yaw rate, and a chopped yaw rate is a stream of synthetic edge changes
// inside that filter's own band — partial stick would quietly wreck pumping,
// which is a scored mechanic. A control scheme may not pay for smoothness with
// somebody else's state machine.
//
// So the graded channel is the one that is ALREADY continuous and already on
// this file's seam: `look`. Past the carve threshold the stick's horizontal
// deflection adds a proportional look-yaw, ramping from nothing at the threshold
// to STICK_YAW rad/s hard over. ski.js's own comment says the two are meant to
// add — "the mouse still turns you as well, and the two simply add — mouse for
// the line, A/D for the lean" — so this is the documented composition, not a new
// one, and it is exactly the look-driven carving that incites stivots. A gentle
// hold is a pure boolean lean; hard over is a lean plus a sweep. GROUNDED ONLY:
// in the air `keys.left` already turns you at airSteer and tricks.js judges the
// air on accumulated yaw, so an air assist would be free rotation for a scored
// trick. Set STICK_YAW to 0 and this file is boolean again, with nothing else
// to change.

if (matchMedia('(pointer: coarse)').matches) start();

function start() {
  const P = window.__player;
  if (!P) return;

  // ---- the stick
  const RING = 58;            // px of throw from the anchor to full deflection
  const CARVE = 0.30;         // |ax| past this and the carve key is asserted
  const PITCH = 0.38;         // |ay| past this and the push key is asserted. Higher
                              // than CARVE on purpose: a hard carve must not plow.
  const STICK_YAW = 0.40;     // rad/s of look-yaw at FULL horizontal deflection,
                              // grounded, on top of the boolean carve (see ANALOG)
  // ---- taps
  const TAP_MS = 220;         // press shorter than this, and barely moved = tap
  const TAP_PX = 14;
  const DBL_MS = 320;
  const DBL_PX = 64;          // the two taps of a double must land in the same place
  const JUMP_MS = 1500;       // the LAST stop on the jump edge, for a tab that is
                              // not drawing frames at all — see the tap below
  const SPIN_MS = 400;
  const FLICK_PX = 26;        // a trick flick, per move event...
  const FLICK_V = 1.1;        // ...and it has to be FAST — px/ms. This is the whole
                              // discriminator between a trick and a look-drag, and
                              // it is a speed rather than a distance because a look
                              // that crosses the screen slowly is still a look.
  // MOUSE-EQUAL, and back where it started. `920da79` ("touch look fix") fixed
  // two things for one complaint: the real bug — `window.__player.look` was
  // declared twice in main.js and the winning definition dropped the `sens`
  // argument, so every phone drag turned at ctrl.look's own `sens = 1`, one
  // radian per pixel — and, belt-and-braces, it also cut this constant 10x. With
  // the duplicate gone the 10x is a 10x over-correction: at 0.00022 a full-screen
  // swipe on a 390 px phone turns 5°, which is what "it lost the sens I liked for
  // turning" is. The finger drags the world at the same rate the mouse does.
  const LOOK = 0.0022;
  // STICK_YAW is stated in rad/s and tick() divides it BY LOOK before handing it
  // to the same look() — so the stick's grounded look-yaw is 0.40 rad/s hard over
  // no matter what LOOK is. Changing LOOK moves the drag and nothing else.

  const K = {};               // what we are currently asserting
  const set = (k, v) => { if (K[k] !== v) { K[k] = v; P.keys({ [k]: v }); } };
  const clearMove = () => { set('left', false); set('right', false); set('forward', false); set('back', false); };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Nothing is an input while a panel owns the screen. `intro-up` is the boot
  // cards' own class (main.js clears it even if intro.js is the module that
  // failed), and `paused()` is the ESC panel. A finger on either is a finger on
  // a card, not on the mountain.
  const blocked = () => {
    if (document.body.classList.contains('intro-up')) return true;
    try { return !!P.paused(); } catch { return false; }
  };

  // ------------------------------------------------------------------ visuals
  // The stick is the ONLY thing this file has ever drawn, and it draws it the
  // way the rest of the HUD draws: the instrument plate, the accent, the same
  // hairline. It is a direct child of <body> and carries no text, which is what
  // makes it free under the two rules that matter — intro.css's structural
  // `body.intro-up > *:not(canvas)…` and `body.clean-frame > *:not(canvas)…`
  // already hide it during the boot cards and under the secret H clean frame,
  // with nothing here to remember, and a wordless element cannot put a string in
  // front of the gate's banned-string or advertisement lists.
  //
  // The CSS is injected FROM HERE rather than added to css/play.css because this
  // module is loaded only on a coarse pointer: a desktop build should not carry
  // rules for an element it can never create.
  const style = document.createElement('style');
  style.id = 'ptouch-css';
  style.textContent = `
/* A 1x1 box rather than a zero-size one: everything inside is absolutely
   positioned off it, so the size is never used for layout — but a definite box
   is what makes checkVisibility() an honest answer about whether the stick is
   on the screen, which is how the gate tells "H hid it" from "it never drew". */
.ptouch { position: fixed; left: 0; top: 0; width: 1px; height: 1px; z-index: 30; display: none; pointer-events: none; }
.ptouch.is-on { display: block; }
.ptouch__ring {
  position: absolute; left: 0; top: 0; width: ${RING * 2}px; height: ${RING * 2}px;
  margin: ${-RING}px 0 0 ${-RING}px; border-radius: 50%;
  background: rgba(23, 22, 20, .30);
  border: 1.5px solid rgba(244, 241, 234, .26);
  box-shadow: 0 0 0 1px rgba(23, 22, 20, .35), 0 2px 14px rgba(0, 0, 0, .35);
  animation: ptouch-in 140ms cubic-bezier(.2, .9, .3, 1) both;
}
.ptouch__dot {
  position: absolute; left: 0; top: 0; width: 5px; height: 5px;
  margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: rgba(244, 241, 234, .34);
}
.ptouch__nub {
  position: absolute; left: 0; top: 0; width: 30px; height: 30px;
  margin: -15px 0 0 -15px; border-radius: 50%;
  background: rgba(244, 241, 234, .90);
  box-shadow: 0 0 0 1.5px rgba(23, 22, 20, .55), 0 2px 10px rgba(0, 0, 0, .45);
  transition: background 90ms linear;
}
.ptouch.is-live .ptouch__nub { background: #ff4d00; }
@keyframes ptouch-in { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ptouch__ring { animation: none; } }
`;
  document.head.appendChild(style);

  const stickEl = document.createElement('div');
  stickEl.className = 'ptouch';
  const ringEl = document.createElement('div');
  ringEl.className = 'ptouch__ring';
  const dotEl = document.createElement('div');
  dotEl.className = 'ptouch__dot';
  const nubEl = document.createElement('div');
  nubEl.className = 'ptouch__nub';
  stickEl.append(ringEl, dotEl, nubEl);
  document.body.appendChild(stickEl);

  function draw() {
    if (!stick) return;
    stickEl.style.transform = `translate3d(${stick.x0}px, ${stick.y0}px, 0)`;
    nubEl.style.transform = `translate3d(${stick.ax * RING}px, ${stick.ay * RING}px, 0)`;
    stickEl.classList.toggle('is-live', Math.hypot(stick.ax, stick.ay) > CARVE);
  }

  // -------------------------------------------------------------------- state
  const touches = new Map();  // id -> { side, x0, y0, x, y, t0, tLast, moved, mates }
  let stick = null;           // { id, x0, y0, ax, ay } — the planted anchor
  let lastTap = null;         // { t, x, y } — for the double
  let spinTimer = null;
  let raf = 0;
  let rafLast = 0;
  let ghostsPruned = 0;       // how many dead ids reconcile() has swept — see GHOSTS

  const side = (x) => (x < innerWidth / 2 ? 'L' : 'R');

  // The level jump input is a PROPERTY OF THE MAP, never an increment: recompute
  // it from whoever is actually on the right half. Every path that adds, removes
  // or sweeps a touch ends here, so there is no way to leak a stuck `jumpHeld`.
  const syncHeld = () => set('jumpHeld', [...touches.values()].some((v) => v.side === 'R'));

  // MATES — the fix for "I cannot jump while I am holding the stick" (specs/0009
  // §2). The old gate was a single `multi` flag: ANY second finger anywhere on
  // the glass disqualified every tap for the rest of the gesture. But the left
  // thumb is on the stick for the whole run, so on a phone that flag was simply
  // always true and the jump EDGE never fired once. (`jumpHeld` did assert, which
  // is why it looked like the tap was being seen and ignored.)
  //
  // A tap is disqualified by a finger it could be HALF OF — a second finger on
  // the SAME half, i.e. a pinch or a two-finger camera toggle. A finger on the
  // other half is a different control entirely. So the flag is per touch and it
  // counts only same-half company at the moment of landing, and both the jump and
  // the double-tap reset read the same number.
  const mateCount = (id, s) => {
    let n = 0;
    for (const [k, v] of touches) if (k !== id && v.side === s) n++;
    return n;
  };

  // GHOSTS — the fix for "after I skip the tutorial, jump is dead" (specs/0009
  // §3). guide.js's skip chip sits bottom-right, is held for 900 ms and then
  // REMOVES ITSELF while the finger is still on it. Chrome dispatches that
  // finger's `touchend` to the touch's original target, and a detached node does
  // not bubble to `window`, so this file never hears the lift: the map keeps a
  // RIGHT-half entry forever, `jumpHeld` stays asserted, and every later tap is
  // rejected for having a mate that is not there.
  //
  // The cure is not to know about the skip chip. `e.touches` is the browser's own
  // list of the fingers that are DOWN RIGHT NOW, on every touch event — so any id
  // in our map that is not in it is, by definition, a finger that is up, whatever
  // swallowed its end. Reconciling on every event makes the map self-healing for
  // the next element that is removed under a thumb (pause panel, locker, boot
  // cards) with nothing to remember.
  //
  // On end/cancel the ids being ended are already out of `e.touches` and only in
  // `e.changedTouches`, so both lists count as alive for that one event.
  function reconcile(e, endLike) {
    const live = new Set();
    for (const t of e.touches) live.add(t.identifier);
    if (endLike) for (const t of e.changedTouches) live.add(t.identifier);
    let swept = 0;
    for (const id of [...touches.keys()]) {
      if (live.has(id)) continue;
      touches.delete(id);
      ghostsPruned++; swept++;
      if (stick && stick.id === id) release();
    }
    if (swept) syncHeld();
    return swept;
  }

  // --------------------------------------------------------------- the stick
  function plant(t) {
    stick = { id: t.identifier, x0: t.clientX, y0: t.clientY, ax: 0, ay: 0 };
    stickEl.classList.add('is-on');
    draw();
    if (!raf) { rafLast = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function release() {
    stick = null;
    stickEl.classList.remove('is-on', 'is-live');
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    clearMove();
  }

  function aim(t) {
    if (!stick) return;
    stick.ax = clamp((t.clientX - stick.x0) / RING, -1, 1);
    stick.ay = clamp((t.clientY - stick.y0) / RING, -1, 1);
    set('left', stick.ax < -CARVE);
    set('right', stick.ax > CARVE);
    set('back', stick.ay > PITCH);            // pull down = the signed push
    set('forward', stick.ay < -PITCH);        // push up   = skate / tuck
    draw();
  }

  // The one continuous channel (see ANALOG at the top). Runs off rAF rather than
  // off touchmove, because a stick held hard over sends no move events at all
  // and a stick you have to keep wiggling is not a stick.
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - rafLast) / 1000));
    rafLast = now;
    if (!stick) return;
    if (blocked()) { release(); return; }
    if (STICK_YAW <= 0 || !dt) return;
    let g = 0;
    try { if (!P.grounded()) return; } catch { /* no controller yet */ }
    const m = Math.abs(stick.ax);
    if (m > CARVE) g = Math.sign(stick.ax) * clamp((m - CARVE) / (1 - CARVE), 0, 1);
    if (!g) return;
    // yaw -= dx * sens, and +yaw is left, so a stick pushed RIGHT wants a
    // POSITIVE dx. Expressed in the look()'s own pixels so the one sensitivity
    // constant on this file still governs every radian it turns.
    P.look((g * STICK_YAW * dt) / LOOK, 0, LOOK);
  }

  // ----------------------------------------------------------------- listeners
  addEventListener('touchstart', (e) => {
    // BEFORE the blocked() gate: a finger that died under a removed node is dead
    // whether or not a panel is up, and the sweep is what stops the map wedging.
    reconcile(e, false);
    if (blocked()) return;
    const now = performance.now();
    for (const t of e.changedTouches) {
      const s = side(t.clientX);
      touches.set(t.identifier, {
        side: s, x0: t.clientX, y0: t.clientY,
        x: t.clientX, y: t.clientY, t0: now, tLast: now, moved: 0, mates: 0,
      });
      // first finger on the left half plants the stick where it landed
      if (s === 'L' && !stick) plant(t);
    }
    // ...and only once every finger of THIS event is in the map, so two fingers
    // that land in the same event are mates of each other.
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (s) s.mates = mateCount(t.identifier, s.side);
    }
    // hold on the right half is the level jump input (preload / flare)
    syncHeld();
    e.preventDefault();
  }, { passive: false });

  addEventListener('touchmove', (e) => {
    reconcile(e, false);
    if (blocked()) return;
    const now = performance.now();
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (!s) continue;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      const ms = Math.max(1, now - s.tLast);
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.x = t.clientX; s.y = t.clientY; s.tLast = now;

      if (s.side === 'R') {
        // look. Same call, same sensitivity shape, as the mouse.
        P.look(dx * 0.9, dy * 0.9, LOOK);
      } else if (stick && stick.id === t.identifier) {
        aim(t);
      }

      // a FAST horizontal flick while airborne is a trick, either side. Speed is
      // the discriminator: the same 40 px sideways is a look, or a carve, when it
      // is taken slowly.
      const v = Math.abs(dx) / ms;
      if (!P.grounded() && Math.abs(dx) > FLICK_PX && Math.abs(dx) > Math.abs(dy) * 2 && v > FLICK_V) {
        spin(dx < 0 ? 'spinLeft' : 'spinRight');
      }
    }
    e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    reconcile(e, true);
    const now = performance.now();
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (stick && stick.id === t.identifier) release();
      if (!s || blocked()) continue;
      // A TAP is short AND nearly motionless — and `moved` is the whole PATH,
      // not the net displacement, so a finger that went out and came back is not
      // a tap. That is the misfire guard for the double: a stick re-grip moves,
      // so it can never be half of a reset.
      const quick = now - s.t0 < TAP_MS
        && s.moved < TAP_PX
        && Math.hypot(s.x - s.x0, s.y - s.y0) < TAP_PX;
      // ...and it is disqualified only by SAME-HALF company (see MATES above).
      // The stick under the other thumb is a different control, not half of this
      // gesture, so it can no longer eat the jump or the reset.
      if (!quick || s.mates) continue;

      // DOUBLE-TAP, either half, is the reset. It is checked FIRST so the second
      // tap of a double on the right half resets instead of also jumping — one
      // gesture, one outcome.
      if (lastTap && now - lastTap.t < DBL_MS && Math.hypot(s.x - lastTap.x, s.y - lastTap.y) < DBL_PX) {
        lastTap = null;
        P.respawn();
        continue;
      }
      lastTap = { t: now, x: s.x, y: s.y };
      // tap right = jump. The RETRACTION is measured in FRAMES, not milliseconds,
      // and that is a real bug fix rather than a style choice. controller.js
      // clears this edge itself on any update that reads it (`keys.jump = false;
      // // jump is edge-triggered`, and it is outside the mode branch so every
      // gear gets it), so all this has to cover is a press that lands with no
      // update behind it. The old 90 ms timer was a GUESS AT A FRAME RATE: on
      // anything slower than 11 fps it retracted the edge before a single update
      // had seen it, and the tap silently did nothing. Two animation frames is
      // the same intent stated in the unit that actually governs it, and it is
      // correct at 120 fps and at 2. The timer stays as the last stop for the
      // case where no frame ever comes at all — a backgrounded tab — where a
      // stale edge would otherwise fire a jump on return.
      if (s.side === 'R') {
        P.keys({ jump: true });
        const drop = () => P.keys({ jump: false });
        requestAnimationFrame(() => requestAnimationFrame(drop));
        setTimeout(drop, JUMP_MS);
      }
    }
    syncHeld();
    if (!touches.size && !stick) clearMove();
    e.preventDefault();
  };
  addEventListener('touchend', end, { passive: false });
  addEventListener('touchcancel', end, { passive: false });

  // TWO FINGERS DOWN AT ONCE = camera toggle, the same call C makes — and "at
  // once" is now checked at BOTH ends of the gesture. It used to be checked only
  // at the lift ("two were down, then none were, inside 300 ms"), which is also a
  // perfect description of "the stick has been held for forty seconds, you tapped
  // the right half, and then you let go of the stick": the camera flipped every
  // time you put the joystick down after a jump. So the pair has to have LANDED
  // together too — within CAM_LAND_MS of each other — and the 300 ms window is
  // measured from the FIRST of the two landings rather than from the second.
  const CAM_LAND_MS = 120;
  const CAM_LIFT_MS = 300;
  let twoAt = 0;
  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) { twoAt = 0; return; }
    const a = touches.get(e.touches[0].identifier);
    const b = touches.get(e.touches[1].identifier);
    // Not in the map means blocked() swallowed it — a finger on a panel is not
    // half of a camera toggle either.
    twoAt = (a && b && Math.abs(a.t0 - b.t0) <= CAM_LAND_MS) ? Math.min(a.t0, b.t0) : 0;
  }, { passive: true });
  addEventListener('touchend', (e) => {
    if (e.touches.length !== 0) return;
    if (twoAt && performance.now() - twoAt < CAM_LIFT_MS) P.toggleCam();
    twoAt = 0;
  }, { passive: true });

  function spin(which) {
    if (spinTimer) return;
    P.keys({ [which]: true });
    spinTimer = setTimeout(() => { P.keys({ [which]: false }); spinTimer = null; }, SPIN_MS);
  }

  // stop the page itself from panning, zooming or bouncing under the canvas
  document.documentElement.style.overscrollBehavior = 'none';
  document.body.style.touchAction = 'none';
  addEventListener('gesturestart', (e) => e.preventDefault());
  addEventListener('dblclick', (e) => e.preventDefault());

  // The test handle, in the shape intro.js, clean.js and speedo.js all use.
  // `active` and `zones` are unchanged so the existing gate keeps its footing.
  window.__touch = {
    active: true,
    zones: 'left stick / right look',
    scheme: 'anchored-stick',
    // the stick, read out of the live state — and `visible` is read off the
    // ELEMENT, not off `stick`, so "the state cleared" and "the ring left the
    // screen" are two answers a gate can tell apart
    stick: () => (stick
      ? { on: true, x: stick.x0, y: stick.y0, ax: +stick.ax.toFixed(4), ay: +stick.ay.toFixed(4) }
      : { on: false, x: null, y: null, ax: 0, ay: 0 }),
    visible: () => stickEl.classList.contains('is-on'),
    shown: () => stickEl.classList.contains('is-on') && stickEl.checkVisibility(),
    el: () => stickEl,
    keys: () => ({ ...K }),
    blocked: () => blocked(),
    // specs/0009 §3 — the map, so a gate can tell "no finger is down" from "no
    // finger is down and this file still thinks one is". Both are FUNCTIONS: a
    // plain number would be a snapshot taken at boot and would read 0 forever.
    touches: () => touches.size,
    ghostsPruned: () => ghostsPruned,
    // specs/0009 §2 — the live fingers and their mate counts, so a gate can see
    // WHY a tap was not a jump. Never the Touch objects: this is a copy of our
    // own bookkeeping.
    live: () => [...touches.entries()].map(([id, v]) => ({ id, side: v.side, mates: v.mates })),
    consts: { RING, CARVE, PITCH, STICK_YAW, TAP_MS, TAP_PX, DBL_MS, DBL_PX, JUMP_MS, FLICK_PX, FLICK_V, LOOK, CAM_LAND_MS, CAM_LIFT_MS },
  };
}
