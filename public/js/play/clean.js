// Clean-frame mode. One undocumented key takes every piece of chrome off the
// screen — and the signs out of the world — so the mountain can be filmed.
//
// PROMOTED to bench source by specs/0003 (was tools/export-red-dog/templates/).
// It is ordinary player source now: edit it HERE, commit, bump the exporter pin.
//
// WHY IT EXISTS. Greg records this build. A screen recording with a legend
// strip, a speedometer, a guide banner and four floating waypoint signs in it is
// a recording of a UI; what he wants to post is a recording of a mountain. So
// H empties the frame, H fills it again, and nothing about the game changes in
// between — the physics, the guide's own clock and the lift you are riding all
// carry on exactly as they were, because this hides things, it does not pause
// them. A clean frame that is also a different simulation is not the same shot.
//
// IT IS SECRET, and secret here means what it means for the locker (I), fast
// travel (T) and the gear menu (E) under D34/D44: the feature works, and nothing
// on the screen ever says it exists. It is not on the intro controls card, not
// in the ESC panel, not a chip on the legend strip. This file therefore creates
// NO DOM AND NO TEXT — it toggles one class and one boolean — so it cannot put a
// string in front of the gate's banned-string or advertisement lists even by
// accident. That is a property of the implementation, not a promise about it.
//
// TWO WAYS BACK, which is the whole safety story for an invisible toggle:
//   H   the way in is the way out
//   R   the key that already means "I am stuck, put me back". Someone who has
//       forgotten they pressed H, or who pressed it by accident, reaches for R
//       long before they reach for anything else — and R is on the intro card,
//       the pause panel AND the legend strip, so it is the one key this build
//       can be sure the player knows. It restores the chrome and respawns in the
//       same press.
//
// WHAT GOES:
//   · every fixed overlay the page owns — the instrument HUD and its legend and
//     prompts, the speedometer, the idle nudge, the guide's banners and race
//     readout, the marker card and the teleport flash. Structurally, by the same
//     `> *:not(canvas)` rule intro.css uses for the boot screen, so anything a
//     later re-bake adds is covered without anyone remembering to come back here
//   · the waypoint signs THEMSELVES, in 3D — markers.js keeps both meshes under
//     one group and already exposes `setVisible` for its own pixel tests, so the
//     signs leave the world rather than merely losing their card. Hiding the
//     card and leaving four lit billboards on the ridge would have missed the
//     entire point of the request.
// WHAT STAYS: the canvas, and the two failure cards (`.pfail`, `.pboot`). An
// invisible toggle must never be able to hide the message that says why the game
// did not start.

const CLASS = 'clean-frame';
const KEY = 'KeyH';

let on = false;

// markers.js attaches `window.__playMarkers` on import and keeps the sign card
// and its halo in one THREE.Group; `_test.setVisible` flips that group's
// `.visible`. It is the module's own hook for photographing a frame with and
// without the signs, which is precisely this feature, so it is used rather than
// duplicated.
function signs(v) {
  try { window.__playMarkers._test.setVisible(v); } catch { /* a world with no markers */ }
}

function apply() {
  document.body.classList.toggle(CLASS, on);
  signs(!on);
}

// Never while a panel owns the keyboard. The locker and the gear menu both read
// raw keydowns, and hiding the HUD out from under an open locker would leave the
// player looking at a mountain with their inventory still holding the input.
function busy() {
  const t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return true;
  const P = window.__player;
  if (!P) return true;
  try { if (P.inventoryOpen()) return true; } catch { /* no locker */ }
  try { if (P.gearMenuOpen()) return true; } catch { /* no gear menu */ }
  return false;
}

addEventListener('keydown', (e) => {
  if (e.code === KEY) {
    if (busy()) return;
    on = !on;
    apply();
    return;
  }
  // R is the way back for anyone who does not know the way back. It does not
  // swallow the event — main.js's own respawn handler still runs — so one press
  // both restores the chrome and puts you on the run.
  if (e.code === 'KeyR' && on) { on = false; apply(); }
}, { capture: true });

// The test handle, in the shape intro.js, idle.js and speedo.js all use. `on`
// and the two things it is supposed to have done are reported separately, so the
// gate can tell "the class went on" apart from "the signs actually left".
window.__clean = {
  on: () => on,
  key: KEY,
  toggle: () => { on = !on; apply(); return on; },
  set: (v) => { on = !!v; apply(); return on; },
  // press H exactly the way a player does, guards and all
  press: (code) => { dispatchEvent(new KeyboardEvent('keydown', { code: code || KEY, bubbles: true })); return on; },
  bodyClass: () => document.body.classList.contains(CLASS),
  // Read out of the SCENE GRAPH, not out of this module's own bookkeeping, and
  // not by calling setVisible() again — `setVisible` has no read mode (passing
  // it nothing would set `.visible = false` and the probe would cause the state
  // it claims to report). markers.js names the group 'pmk:markers'.
  signsVisible: () => {
    try {
      const g = window.__player.sceneRoot().getObjectByName('pmk:markers');
      return g ? !!g.visible : null;
    } catch { return null; }
  },
};
