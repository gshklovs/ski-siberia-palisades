// The idle nudge: one quiet line that offers R to anyone who has stopped.
//
// PROMOTED to bench source by specs/0003 (was tools/export-red-dog/templates/).
// It is ordinary player source now: edit it HERE, commit, bump the exporter pin.
//
// WHY IT EXISTS. R is on the intro controls card, on the ESC panel and (since
// 2026-08-30) on the bottom-left legend strip, and a player who is stuck has
// read none of the three: they are wedged in a tree well four hundred metres
// off the run, they have stopped moving, and the thing they need is the one
// thing they are not currently looking at. So the game says it, once, at the
// moment it is true — the same policy the F boarding prompt already follows.
//
// WHAT IT IS NOT. It is not a tutorial beat and it does not belong to guide.js:
// the guide teaches a course, this catches a player who has fallen off any part
// of it, including the parts the guide is done with. It is not a modal, it
// takes no input, and it never covers the crosshair.
//
// THE DISCIPLINE, and it is the whole design:
//   · it costs nothing to dismiss — it is gone on the first key, the first
//     touch, the first metre travelled, with no fade-out to sit through
//   · it re-arms, so stopping again offers it again, and it never nags while
//     you are moving
//   · `hidden` is the real switch, not opacity. document.body.innerText
//     INCLUDES opacity:0 text (that is how the fast-travel card once hid from
//     this repo's own audit), so a banner parked at opacity 0 would still be
//     "on the screen" to every text assertion in the gate — and to a screen
//     reader. display:none is the honest state; the opacity is only the fade IN.

const IDLE_MS = 7000;          // how long "stopped" has to last before the offer
const STOPPED_MPS = 0.5;       // ...and what counts as stopped
const POLL_MS = 200;

// A POLL, not a rAF loop, on purpose. Under swiftshader this scene renders at a
// handful of frames per second, so a rAF-driven timer would make "seven
// seconds" mean seven seconds only on fast hardware. setInterval is not tied to
// the renderer, and this is a state question, not a drawing one.

const root = document.createElement('div');
root.className = 'pidle';
root.hidden = true;
root.setAttribute('role', 'status');
root.setAttribute('aria-live', 'polite');
const cap = document.createElement('b');
cap.textContent = 'R';
root.append(cap, document.createTextNode(' — back to the run'));
document.body.appendChild(root);

let since = null;              // when the player last became idle, or null
let shown = false;

function anyKeyHeld(P) {
  let k = null;
  try { k = P.keys(); } catch { return false; }
  if (!k) return false;
  for (const v of Object.values(k)) if (v) return true;
  return false;
}

// Every reason the offer must not be on the screen, in one place.
function suppressed(P) {
  // the boot cards own the screen, and `intro-up` display:none's everything
  // that is not the canvas or the card anyway — but arming behind them would
  // mean the banner is already 7 s old the instant the intro leaves.
  if (document.body.classList.contains('intro-up')) return true;
  if (document.querySelector('.intro')) return true;
  try { if (P.paused()) return true; } catch { return true; }
  // Riding a chair is the one kind of "not moving" that is not being stuck: you
  // are being carried, and offering to teleport you off the lift you just chose
  // to board is the opposite of helpful. The ride itself is an instantaneous
  // teleport in lift.js, so what this actually reads is "standing on a boarding
  // circle with the F offer up" — the whole of the window in which a player is
  // deliberately stationary at a lift.
  try { if (P.liftPrompt()) return true; } catch { /* no lifts in this world */ }
  return false;
}

function stopped(P) {
  try {
    if (!P.grounded()) return false;                 // falling is not idling
    if (P.speed() >= STOPPED_MPS) return false;
  } catch { return false; }
  return !anyKeyHeld(P);
}

function show() {
  if (shown) return;
  shown = true;
  root.hidden = false;
  // one frame between display and opacity, or the transition never runs
  requestAnimationFrame(() => { if (shown) root.classList.add('is-on'); });
}

// INSTANT, and with no fade-out. A dismissal animation on a hint means the hint
// is still on the screen — and still in innerText — after the player has
// answered it.
function hide() {
  if (!shown) return;
  shown = false;
  root.classList.remove('is-on');
  root.hidden = true;
}

// Any real input at all re-arms the clock. This is the belt to the poll's
// braces: the poll catches movement and held keys, these catch the player who
// pressed something that did not move them (looked around, opened the panel,
// tapped and thought better of it).
function bump() {
  since = null;
  hide();
}
for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'mousedown']) {
  addEventListener(ev, bump, { capture: true, passive: true });
}

setInterval(() => {
  const P = window.__player;
  if (!P) return;
  if (suppressed(P) || !stopped(P)) { since = null; hide(); return; }
  const now = performance.now();
  if (since === null) since = now;
  else if (now - since >= IDLE_MS) show();
}, POLL_MS);

// the same test handle intro.js exposes, for the same reason
window.__idle = {
  visible: () => !root.hidden,
  text: () => root.innerText,
  idleMs: () => (since === null ? 0 : performance.now() - since),
  threshold: IDLE_MS,
};
