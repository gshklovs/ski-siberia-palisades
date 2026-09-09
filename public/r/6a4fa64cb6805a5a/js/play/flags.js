// The environment flags — specs/0003.
//
// ONE product, two environments. The bench is the SUPERSET (debug instruments,
// F8 dev mode, the full secret locker with the bikes in it); the shareable Red
// Dog build is the same product with those switched off. Nothing forks: every
// difference between the two is one of the four values below, read here, once,
// and read nowhere else in the player.
//
// THE DEFAULTS ARE THE LAB'S, on purpose. A new bench page that sets no flags
// at all gets the superset — the failure mode of forgetting a flag is "the lab
// shows a debug instrument", never "the public build ships one". The deploy
// strips by SAYING SO OUT LOUD in tools/export-red-dog/templates/index.html,
// where the strip is reviewable in one screen.
//
// Set by the host page before it imports main.js:
//
//   guide     true  → the guided run, its intro cards and the idle nudge
//   gearSet   'full' | 'locker' | 'skis' → what gear EXISTS, and separately
//                      what hold-E advertises. The three tiers and the reason
//                      there are three are documented at GEAR_SET below.
//   debugHud  true  → the top-left readout, the fps chip, the B reference
//                     viewer, the full ESC key reference, the bench pause row,
//                     the T fast-travel card, the [play] console dump.
//   brand     the WORDMARK on the gear, the HUD chip, the pause header and the
//                     tab title. Any non-empty string — 'RED DOG', 'SIBERIA',
//                     the next world's — and 'POI-LAB' (the lab) when unset.
//   panelApproach
//             true  → the station-approach card (specs/0055 §3.8). The ONE flag
//                     here that defaults OFF, and the reason is at its export.
//   label     bench chrome only: the name the LAB lists this world/mode under.
//                     It never reaches the game, so a bench mode that reproduces
//                     the shipped build reproduces it exactly and still shows up
//                     in the fleet under its own name. The deploy never sets it.
//
// `guide` is deliberately NOT re-derived here: main.js has owned that decision
// since before this file existed (`?guide=` beats `__PLAY.guide`, so the query
// form is an override rather than only a switch) and moving it would break the
// one seam that is already correct.

const P = (typeof window !== 'undefined' && window.__PLAY) || {};

// ------------------------------------------------------------------ gearSet
//
// THREE TIERS, because "what exists" and "what is ADVERTISED" are two different
// questions and the shipped build answers them differently. Greg, 2026-08-31:
// sneak the bikes back into the secret inventory — the SHIPPED one — without
// putting a bike anywhere a player who has not gone looking can see it.
//
//   'full'    the lab. Bike registered, bike rack in the locker, and hold-E
//             lists every gear the controller owns.
//   'locker'  the shipped build. Bike registered and the rack is in the I
//             locker for anyone who finds it — but hold-E still offers exactly
//             boots and skis, and no bike string reaches the legend, the pause
//             panel or the boot cards. Found, not advertised (D34/D44).
//   'skis'    the ski mountain with no bike in it at all. Nothing sets this
//             today; it is kept because "no bike anywhere" is a real answer and
//             deleting the tier would mean rediscovering it later.
//
// Anything unrecognised falls back to 'full' — the LAB — for the same reason
// every default in this file does: forgetting a flag must fail towards showing
// too much in the workshop, never towards shipping something unnoticed.
const TIERS = ['skis', 'locker', 'full'];
export const GEAR_SET = TIERS.includes(P.gearSet) ? P.gearSet : 'full';
// Does the bike EXIST — controller registry and locker rack. Named for what it
// means at the call site, not for the flag.
export const BIKE_GEAR = GEAR_SET !== 'skis';
// Does hold-E ADVERTISE everything, or just boots and skis.
export const FULL_GEAR_MENU = GEAR_SET === 'full';

// ----------------------------------------------------------------- debugHud
export const DEBUG_HUD = P.debugHud !== false;

// ------------------------------------------------------------------- lab UI
//
// specs/0055 §5.3 (Greg 2026-09-06: hide poi-lab UI) — "can i have a setting
// button to hide poi-lab specific ui".
//
// DEBUG_HUD above is still the BUILD gate and it does not move: it is a boot
// constant, the exporter's own contract reads it back out of this module
// (verify.mjs:1463 asserts `DEBUG_HUD === false` on the shipped build), and
// specs/0003 §A2's "never shown AND never built" only holds while the `if`s in
// hud.js stay `if (DEBUG_HUD)`. What lands here is the SECOND question, asked
// per frame instead of once: given that this build HAS a lab register, is it
// on the screen right now.
//
// So the switch can only ever TAKE AWAY. `DEBUG_HUD && stored` — on a shipped
// build nothing was constructed, so there is nothing a stored `true` could
// reveal, and the value is pinned false rather than left to a stale key in
// somebody's localStorage. That is also why setLabUI() clamps: one place says
// no, and it says it on the write rather than at twenty read sites.
//
// OFF MEANS OFF (Greg, same message): F8 does nothing, B does nothing, the
// compression bar goes with the rest. The switch itself lives in the locker,
// which is not part of the register, so nothing is lost by turning it off.
//
// STORAGE is settings.js's namespace — `poi-lab.play.settings.labUI` — because
// this IS one of the player's knobs and the locker renders it beside the other
// two. The value lives HERE rather than in settings.js only because the
// DEFAULT is DEBUG_HUD, and settings.js is downstream of this file; settings.js
// delegates its get/set for this one key back to the two functions below, so
// there is still exactly one copy of the boolean in the player (settings.js
// rule 1).
const LAB_LS = 'poi-lab.play.settings.labUI';
let LAB_UI = DEBUG_HUD;
try {
  const raw = localStorage.getItem(LAB_LS);
  if (raw !== null) LAB_UI = DEBUG_HUD && (raw === '1' || raw === 'true');
} catch { /* private mode — the default stands */ }

/** is the lab register on the screen right now. Read at render/update time. */
export function labUI() { return LAB_UI; }

/**
 * Flip it. Returns the value that stuck (never true outside the lab), and
 * fires ONE event — `play:labui`, detail = the new value — which is every
 * consumer's cue to show or hide. There is no polling and no second flag.
 */
export function setLabUI(v) {
  const next = DEBUG_HUD && !!v;
  if (next === LAB_UI) return LAB_UI;
  LAB_UI = next;
  try { localStorage.setItem(LAB_LS, next ? '1' : '0'); } catch { /* private mode */ }
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('play:labui', { detail: next }));
  } catch { /* no CustomEvent — the value still stuck */ }
  return LAB_UI;
}

// --------------------------------------------------------------- panels 0055
//
// specs/0055 §3.8 (D2, D3) — THE STATION APPROACH CARD IS BUILT AND HIDDEN.
// Greg, on the decision sheet: "Station approach: B, without the subtitle. Hide
// the approach cards for now until we find a less distracting way to present
// them. Also remove the spine on the left side."
//
// So the panel is REBUILT rather than deleted — B, subtitle-less, spine-less —
// and this flag holds it off screen while the "less distracting way" is settled
// (§11 item 4). The whole trigger behind it is untouched: `INTRO_R` 80 m, the
// .45 / 3.0 / .55 in-hold-out, the once-per-approach arm and its RESET_R
// re-arm all still run, so turning this on is the only thing between the shipped
// build and the card. Nothing else in the player reads it.
//
// It defaults FALSE, which is the one default in this file that points the other
// way from every other: everything above fails towards SHOWING too much in the
// workshop, because forgetting a flag must never ship something unnoticed. This
// one is a panel Greg has explicitly asked not to see yet, so forgetting it must
// fail towards NOT showing it. A host page that wants to look at the card sets
// `window.__PLAY.panelApproach = true` before it imports main.js, the same way
// it sets every other flag here.
export const PANEL_APPROACH = P.panelApproach === true;

// -------------------------------------------------------------------- brand
//
// BRAND IS THE WORDMARK, whatever the host page calls this world. It used to be
// a two-value enum ('RED DOG' or the lab), which was the right shape while there
// was exactly one shareable build. It stopped being right at world #2: a third
// value did not fall through to "some other product", it fell through to
// POI-LAB — the INTERNAL identity string D9 exists to keep off a screenshot —
// and it would have been painted on the ski topsheet, the toboggan deck, the
// snowmobile cowl, the boots card, the HUD chip and the pause header of a public
// site. Siberia carried that fix as tools/export-red-dog/patches/siberia/
// flags-brand.patch.mjs from 2026-09-01 until specs/0027 promoted it here.
//
// Any non-empty brand is now taken at its word. The LAB is still the only
// fallback, for this file's standing reason: forgetting a flag must fail towards
// showing the workshop, never towards shipping something unnoticed.
export const BRAND = (typeof P.brand === 'string' && P.brand.trim()) ? P.brand.trim() : 'POI-LAB';

// Still "is this a shipped build", which is what every one of its ~20 call sites
// means by it — "not the lab, take the second branch". It keeps the name it has
// had since there was one build to ship, because renaming it would touch eight
// player modules and change nothing.
export const RED_DOG = BRAND !== 'POI-LAB';

// Pick a string per brand. Two arguments in the order (lab, red) at every call
// site, so a scan of `pick(` reads as a two-column table of every user-visible
// identity string in the build — which is exactly what D9 wants to be able to
// audit.
export const pick = (lab, red) => (RED_DOG ? red : lab);

// THE SAME TABLE, ONE COLUMN PER WORLD, for the strings that are not "lab or
// shipped" but "which mountain is this". `pick(` above answers the first
// question and is still the whole of the answer for gear that is the lab's
// standard kit under a house name; `pickBrand(` answers the second, keyed on the
// wordmark itself:
//
//     pickBrand({ lab: 'Lab Standard', 'RED DOG': 'Red Dog 180', SIBERIA: 'Siberia 180' })
//
// A wordmark with no column falls back to `lab`, which is the same failure
// direction as every other default here: a world that forgets to add itself
// shows the lab's own string, and a lab string on a public site is what the
// D9 audit and the gate's banned-string check are both looking for.
//
// Together `grep -n "pick(\|pickBrand("` is still the complete table of every
// user-visible identity string in the player — the audit 0003/D9 asked for,
// widened by a column rather than replaced (specs/0027).
export const pickBrand = (table) => (
  Object.prototype.hasOwnProperty.call(table, BRAND) ? table[BRAND] : table.lab
);

// -------------------------------------------------------------------- label
export const LABEL = (typeof P.label === 'string' && P.label) ? P.label : null;
