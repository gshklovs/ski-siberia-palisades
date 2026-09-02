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
