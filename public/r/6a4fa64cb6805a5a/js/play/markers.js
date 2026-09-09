// Floating POI markers — the "what is interesting and where is it" layer.
//
// Self-contained. main.js wires it exactly the way it wires fx.js and
// surprise.js:
//   import './markers.js'            (module attaches window.__playMarkers)
//   window.__playMarkers.init({ THREE, scene, camera, ..., markers, upAxis })
//   window.__playMarkers.update(dt)  // once per frame
//
// WHAT IT DOES
//
// Every place worth going to in a world gets a glowing sign hung 128–236 m in
// the AIR above it. The signs always face the camera, they bob, their halo
// pulses, and because they are high up they do not sit in front of the thing
// you are trying to ski — you tip your head back, read the sky, and now you
// know the map. That height IS the anti-clutter mechanism.
//
// They are DEPTH-TESTED against the world: a ridge or a building in front of a
// sign hides it, and a ridge cutting across one clips it along the skyline. A
// sign you can see is a place you have line of sight to, which is the whole
// reason the height matters — it is what gets a sign over its own ridge.
//
// Walk toward one and a card fades in along the bottom third with the name and
// a line about the place; get within 25 m — you are AT it — and the sign itself
// fades to nothing so the view is clean. Leave and it comes back.
//
// At rest the signs sit at half brightness — present, legible, but behind the
// mountain in your attention. Put the crosshair on one and it eases up to full
// over 150 ms, halo and all, and the offer to go there appears under it: press T
// and you are set down three metres short of the anchor, on the real floor,
// facing the place, in whatever gear you were already wearing.
//
// WHERE THE MARKERS COME FROM (two sources, same shape)
//
//   1. `world.markers` from the PLAYABLE.md contract, for worlds built after
//      this module. See harness/PLAYABLE.md § Markers.
//   2. A baked per-world registry below (REG), mined from each run's
//      layout.mjs anchors / REPORT.md and settled onto the real floor with
//      collision.groundAt() at init. Finished worlds predate the contract.
//
// Both are `{ id, name, kind, pos:[x,y,z], tier, line }` in the PLAYER frame
// (Y-up metres). A z-up world's contract markers are tipped here, exactly the
// way main.js tips its `lifts` — `(x, y, z)_ENU -> (x, z, -y)_three`. The baked
// registry is already stored tipped, so nothing converts it twice.
//
// BUDGET
//
// Two draw calls, total, for every sign in the world: one camera-facing quad
// mesh for the cards (all of them sharing a single 2048×1024 canvas atlas
// painted once at init) and one additive quad mesh for the halos (one shared
// 160² radial texture, tinted per instance). No canvas is redrawn after init;
// the per-frame work is one loop over ≤20 rows writing three small typed arrays
// plus an O(n·6) screen-box declutter, plus — only when the crosshair is on a
// sign, and only every 100 ms — one 56-sample ground-profile walk for the
// fast-travel occlusion gate. Three DOM overlays (approach card, aim prompt,
// teleport flash) and one <style>, like surprise.js. Measured in the bench:
// 2 draw calls added, in every world.
//
// The camera belongs to main.js — this module never writes to it.

import { DEBUG_HUD, PANEL_APPROACH, labUI } from './flags.js';
import { WAYPOINT_SPAWNS } from './lift.js';
// specs/0055 §1.2 — the boards read the HUD's type instead of declaring their
// own. The private `FAM` that used to live at :354 made every card in the sky a
// SECOND fallback chain from the HUD's, which is one voice too many for a system
// with one type scale. hud.js imports nothing from here, so this adds an edge
// and not a cycle.
import { hudType } from './hud.js';

// specs/0055 §3.1 (as built, 2026-09-06) — THE CELL IS 128 TALL, NOT 192.
// A is a trail blade: a plate, one or two lines, a mounting rule. The 192 px
// cell was cut for the rounded card's THREE lines (name, kind strip, prose
// one-liner) and leaves a blade floating in a third of a cell of dead alpha —
// which reads on screen as a sign smaller than the quad it is drawn on, because
// `r.ah` is the CELL's aspect and not the sign's. DESIGN-0055:106 called this
// out in advance: "the atlas cell is fixed ... so the atlas may need re-tiling
// (still one draw call)". 1024 / 128 = 8 rows, so the same 2048 × 1024 canvas
// now holds 32 cells instead of 20 — more headroom than any world needs, the
// same one draw call, the same bytes.
const CARD_W = 512, CARD_H = 128;      // atlas cell, px
const ATLAS_W = 2048, ATLAS_H = 1024;  // 4 × 8 = 32 cells
const COLS = ATLAS_W / CARD_W, ROWS = ATLAS_H / CARD_H | 0;
const MAX_MARKERS = COLS * ROWS;       // 32 — more than any world declares

const AT_R = 25;        // m — inside this you are AT the poi: the sign gets out of the way
const INTRO_R = 80;     // m — the approach card fades in here
const RESET_R = 200;    // m — leave by this much and the intro re-arms
const LIT_MAX = 6;      // simultaneously fully-lit signs (screen-space declutter)
const FAR_D = 900;      // m — beyond this the card fades out and only the halo dot is left
const FAR_GONE = 1400;  // m — beyond this the halo goes too

// The station-approach answer Greg picked over the card (decision sheet,
// "approach-cards: sign grows"): rather than a panel arriving at the bottom of
// the frame, the SIGN ITSELF grows as you close on it, so the thing that tells
// you where you are is the thing you were already looking at. The card is still
// built, and still hidden behind PANEL_APPROACH (§3.8).
//
// Monotone over the whole approach, and CLAMPED: the sign reaches 1.6x at 30 m
// and stops, because past that the AT_R fade (25 m) is already taking it out of
// the view and a card still growing into a fade reads as a bug. 120 m is chosen
// to sit outside INTRO_R (80 m) so the growth has begun before the approach
// event it replaces would have fired.
const GROW_FAR = 120, GROW_NEAR = 30, GROW_MAX = 1.6;   // m, m, x

// specs/0055 §6, and the lookbook's motion list for `sign-board-in-world` —
// WIPE in, HOLD live, FALL out, plus the overlap rule.
//
//   WIPE, enter: "crossing the draw-distance boundary: plate draws, board
//   unmasks from it. 110 + 260 ms." One left-to-right mask cursor at two rates:
//   it covers the plate's own width in 110 ms and the rest of the board in 260.
//
//   HOLD, live: constant angular size, unchanged — that is what the
//   angular-constant sizing block below already does, and occlusion is the
//   depth test taking opacity away and never scale. Nothing to add.
//
//   FALL, exit / the overlap rule: "when two signs overlap, the lower-rank one
//   loses its board and keeps its plate — the mark outlives the name." The same
//   cursor runs backwards to the plate's edge in 160 ms and stops there.
//
// It rides the SAME quad, the SAME atlas and the SAME draw call as the alpha
// and scale hooks §3.8 and §3.6 already use: one more per-instance float and
// one `discard` in the card fragment shader. There is no second system.
const WIPE_PLATE_T = 0.110, WIPE_BOARD_T = 0.260, WIPE_FALL_T = 0.160;   // s

// specs/0055 §3.6 — WHERE THE POST STACK STANDS, THE FLOATING SIGN STANDS DOWN.
// A fork now carries a physical bracket with the run names on it (world.mjs), so
// a mid-tier billboard hanging 176 m over the same junction is the same news
// told twice, in two voices, one of which is in the sky. Inside this radius of a
// fork centre a `mid` card is drawn at alpha 0.
//
// ONLY `mid`. `major` is a lift station or a summit — a place, not a run choice,
// and the stack does not name it. `minor` is already faint enough to read as a
// breadcrumb rather than a second sign. A mid card further out than this is
// untouched: the stack is only legible from about this far, so this is the
// distance at which the two would actually be competing.
const FORK_HIDE_R = 45;  // m, plan view

const IN_T = 0.45, HOLD_T = 3.0, OUT_T = 0.55;   // intro card timing, seconds
const ANG = 0.21;       // card width as a fraction of its distance (~12° of a 72° fov)

// A sign must hang in AIR. Tier height is measured off the settled ground point,
// but a marker under an overhang — a cliff face rising behind it, a serac wall,
// a lift shed's roof — can have its tier height land inside rock. At init the
// column above every anchor is probed and the sign is pushed up to clear it by
// this margin. RAISE_MAX stops a marker at the foot of a 900 m wall from being
// flung into the stratosphere: past that it stays where the tier put it.
const CLEAR_M = 22;     // m of daylight demanded between a sign and anything above the anchor
const RAISE_MAX = 2.4;  // × tier height — the most a clearance probe may add

// ---- fast travel (T)
// T is free. The player's bound keys, swept across every module that listens:
//   main.js  W A S D · arrows · Shift · Space · E · I · R · C · F · G · F8 · Esc
//   hud.js   B · [ ]
//   inventory.js (only while the locker is up) Q E F Tab Enter Space digits, WASD/arrows, Esc I
//   dev.js   owns the whole keyboard while F8 mode is active — we bail out there
// Nothing claims KeyT, in any of them.
const TRAVEL_KEY = 'KeyT', TRAVEL_KEY_CAP = 'T';
// The aim box. A card is drawn about 12° wide and 3.0° tall (specs/0055 §3.1 as
// built: the blade cell is 512 × 128, so the quad is 4:1 where the old rounded
// card's was 2.67:1), which is already an
// enormous target next to a crosshair — padding that by half again, as the first
// cut did, left a sign TEN DEGREES off the crosshair still "aimed at", and let
// two neighbouring signs both answer. So: pad, then CAP. The pad earns its keep
// on the thin vertical axis and on demoted cards that have shrunk to 0.42; the
// caps keep the offer honest at ±6.6° across and ±5.2° up.
const AIM_PAD_H = 1.20, AIM_PAD_V = 2.00;
const AIM_MAX_H = 0.115, AIM_MAX_V = 0.090;   // radians, half-extent
const AIM_MIN_A = 0.06; // a sign faded to a ghost is not a target
const AIM_MIN_DOT = 0.20;
// Two signs land nearly in line — a near lift station in front of a far venue —
// and BOTH answer the aim test. Picking the nearer one is wrong: it hands the
// offer, and the hover ease with it, to a sign the crosshair is nowhere near,
// which is the "wrong one lights up" bug. The offer goes to the sign the
// crosshair is most deeply INSIDE (see aimMiss), and only a genuine tie falls
// through to nearest. AIM_STICK is how much more centred a challenger must be to
// take the offer off the sign that already holds it: without it a slow sweep
// across the gap between two overlapping cards flips the offer every frame around
// the crossover, which reads as two signs flickering rather than one lighting up.
const AIM_STICK = 0.12;
const AIM_HZ = 0.10;    // s — how often the (expensive) occlusion probe re-runs
// ---- tap to travel (touch)
// A finger is not a crosshair. It names a sign by LANDING on it, anywhere on the
// screen, so the touch path needs two things the keyboard path never did: a
// screen-space hit test (signAt) and somewhere to keep its answer while the
// second tap of the double is still on its way (touchAim → S.aimHold).
// TOUCH_AIM_MS is that window — comfortably longer than touch.js's DBL_MS, so the
// offer is still standing when the second tap lands. TOUCH_MIN_PX floors the hit
// box: a demoted chip is drawn at 0.42 of a card and can be a dozen pixels
// across, and a thumb is a thumb.
const TOUCH_AIM_MS = 900;
const TOUCH_MIN_PX = 44;
const OCC_STEPS = 56;   // samples along the camera→sign line
const TRAVEL_OFF = 3;   // m — land beside the anchor, not inside whatever is on it
const LAND_TOL = 4;     // m — a landing spot whose floor is this close to the
                        // anchor's own floor is on the same shelf, not over its edge
// specs/0055 §3.10 — TELEPORT: A. The picked cell (lookbook.html
// `#k-teleport-flash`) publishes its own motion table, and these four numbers
// ARE that table: white CUT 0→.90 in 60 ms · board WIPE in from screen-left
// 180 ms · HOLD 220 ms · FALL, board and white together, 340 ms. 800 ms total,
// "all of it inside the frames the world is rebuilding". The old flash was a
// bare 300 ms white; the extra 500 ms buys the frames the destination's name is
// legible in, which is the whole content of the pick.
//
// Wall clock, not dt: dt is clamped to 50 ms a frame, so on a 6 fps headless run
// a dt-driven flash would hang about for a second and a half.
const FLASH_IN = 60, FLASH_WIPE = 180, FLASH_HOLD = 220, FLASH_OUT = 340;
const FLASH_MS = FLASH_IN + FLASH_WIPE + FLASH_HOLD + FLASH_OUT;   // 800
// MEASURED off the cell, not read off its prose. The cell's motion table says
// the white goes to .9; the cell's stage DRAWS .82, and the stage is what was
// picked. Solved from two 1:1 renders of #k-teleport-flash's A stage, the wash
// on and the wash off, over 133,668 pixels of its top band —
// alpha = (observed - under) / (255 - under) — - median .814, mean .818.
const FLASH_PEAK = 0.82;

// ---- resting vs hovered
// At rest a sign is a HALF-PRESENT thing: still legible from across a valley,
// still obviously a place, but no longer competing with the mountain for the
// front of your attention. Put the crosshair on one and it comes all the way up.
// The card floor is 0.50 — the atlas paints a drop shadow and a hard border into
// every cell, which is what keeps a 50 % card off a bright snowfield. The halo
// floor sits a little higher: it is additive, so half of it against lit snow is
// most of the way to nothing, and the halo is what tells you a sign is over
// there before you can read it.
const REST_CARD = 0.50, REST_HALO = 0.55;
const HOVER_IN = 0.150, HOVER_OUT = 0.300;   // seconds, wall clock — see FLASH_MS

const S = {
  ok: false,
  THREE: null, scene: null, camera: null, ctrl: null, hud: null, collision: null,
  poi: '', run: '', key: '', source: '',
  u: 1, t: 0, farD: FAR_D, farGone: FAR_GONE, maxW: 96, settled: 0,
  rows: [],                 // the markers
  group: null, card: null, halo: null, fwd: null,
  atlas: null, haloTex: null,
  root: null, cardEl: null, iconEl: null, nameEl: null,
  intro: null,              // { row, phase, t }
  iconUrl: {},              // kind -> dataURL for the DOM card
  nearest: null, visible: 0, lit: 0, litRows: [],
  errors: 0,
  // ---- fast travel
  aim: null, aimT: 0, aimBlocked: false, aimEl: null, aimKeyEl: null, aimNameEl: null,
  aimHold: 0,               // wall-clock instant a tapped sign stops holding the offer
  hoverWall: 0,
  flashEl: null, flash: 0, travels: 0, lastTravel: null, wired: false,
  // specs/0055 §3.10 — the board the flash carries
  flashSignEl: null, flashIcoEl: null, flashNameEl: null,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smooth = (k) => k * k * (3 - 2 * k);   // ease in-out on a 0..1 ramp

// ===========================================================================
// kinds — one design system, five venue dialects
// ===========================================================================

// specs/0055 §1.7, §10.3 — KINDS IS EXPORTED. It was a private lookup, which is
// why every DOM panel that wanted a kind colour typed the hex again; after this
// the atlas and the DOM read the same six constants and no panel types a colour.
// This is DESIGN-0055's "single highest-leverage change in the list".
export const KINDS = {
  'ski-run': {
    label: 'SKI RUN',
    panel: '#f4f1ea', ink: '#171614', sub: '#726c60', border: '#171614',
    plate: '#171614', glow: '#cfe0ff',
  },
  lift: {
    label: 'CHAIRLIFT',
    panel: '#171614', ink: '#f6f3ec', sub: '#a49c8d', border: '#ff4d00',
    plate: '#ff4d00', glow: '#ff6a1f',
  },
  'bike-trail': {
    label: 'TRAIL',
    panel: '#171c15', ink: '#eff5e6', sub: '#9aa88a', border: '#8ec63f',
    plate: '#8ec63f', glow: '#9fe04a',
  },
  landmark: {
    label: 'LANDMARK',
    panel: '#0e2a33', ink: '#eaf7fb', sub: '#83a9b4', border: '#7fd4e8',
    plate: '#7fd4e8', glow: '#7fd4e8',
  },
  venue: {
    label: 'VENUE',
    panel: '#ffab00', ink: '#171614', sub: '#6b4a06', border: '#171614',
    plate: '#171614', glow: '#ffc44d',
  },
};
const kindOf = (k) => KINDS[k] || KINDS.landmark;

// specs/0055 §3.9 (Greg 2026-09-06) — WHICH INK A GLYPH TAKES ON A KIND PLATE.
// "Black run fast travel indicator looks bad, the T needs to be white for that
// one." The fast-travel key cap paints its glyph in a fixed near-ink on a plate
// filled with `KINDS[kind].plate`, and for `ski-run` that plate IS the near-ink
// (#171614) — so the T vanished. It is not a black-diamond problem: every ski
// run and every venue shares that plate, so the T was gone on all of them.
//
// KINDS.ink is NOT the answer, because `ink` is the contrast partner of `panel`
// (the board), not of `plate`. On a lift, panel is ink and ink is cream, but the
// plate is orange — cream on orange is the worse of the two choices.
//
// The rule that already exists for this exact question is the one the in-world
// sign board uses: `drawIcon` paints the plate's mark in cream (#f6f3ec) on the
// ink plates of ski-run, and in a near-ink on every light plate — #171614 on the
// lift's orange, #171c15 on the bike trail's green, #0e2a33 on the landmark's
// cyan. That is a contrast rule with five worked examples, so it is reproduced
// here rather than re-typed: pick whichever of the file's two existing type
// colours has the higher WCAG contrast against the plate. It agrees with
// `drawIcon` on all five kinds. (A flat luminance split at 0.35 would not — it
// would hand the lift a cream T at 2.95:1 where the chair on that same plate is
// drawn dark at 5.44:1.)
//
// NO NEW HEX (§10.3): both candidates are read out of KINDS, and the CSS keeps
// the same two literals it already carried, now as var() fallbacks.
const PLATE_INK_LIGHT = KINDS['ski-run'].panel;   // #f4f1ea — the cream .is-hit already flashes
const PLATE_INK_DARK = KINDS['ski-run'].ink;      // #171614 — the near-ink the key cap had fixed
function srgbLinear(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
// WCAG relative luminance of a #rgb / #rrggbb string
function relLuminance(h) {
  const s = String(h || '').replace('#', '');
  const n = s.length < 6 ? s.slice(0, 3).replace(/./g, (c) => c + c) : s.slice(0, 6);
  const v = parseInt(n, 16) || 0;
  return 0.2126 * srgbLinear(((v >> 16) & 255) / 255)
    + 0.7152 * srgbLinear(((v >> 8) & 255) / 255)
    + 0.0722 * srgbLinear((v & 255) / 255);
}
function contrastRatio(a, b) {
  const x = relLuminance(a), y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// the glyph colour for a plate: whichever of the two reads on it
export function plateInk(plate) {
  return contrastRatio(plate, PLATE_INK_LIGHT) >= contrastRatio(plate, PLATE_INK_DARK)
    ? PLATE_INK_LIGHT : PLATE_INK_DARK;
}

// specs/0055 §3.9 (Greg 2026-09-06) — and the DESTINATION NAME, which is a
// different question because it has no plate under it. §3.9's one variable is
// the kind colour and it is worth keeping wherever it survives: on the lift's
// orange, the trail's green and the landmark's cyan the name is tinted exactly
// as it shipped. The rule only fires where the accent IS the ink — ski runs and
// the venue, luminance 0.0081 — because a near-black word under a near-black
// shadow is fine against sky and gone against the trees, which is the frame
// OLYMPIC VILLAGE lands in. There the name falls back to the cream .pmk-aim__txt
// beside it already uses. 0.2 is Greg's line, and nothing in KINDS sits near it:
// the plates are 0.008 or 0.27 and up.
const NAME_DARK_L = 0.2;
export function plateName(plate) {
  return relLuminance(plate) < NAME_DARK_L ? PLATE_INK_LIGHT : plate;
}

// tier -> how high it hangs, how big the card is, how bright, and how hard it
// fights for screen space when two signs land on top of each other
// Heights are DOUBLE what they first shipped as (118/88/64): the signs read as
// sky furniture rather than as things standing on the hill, and — now that they
// are depth-tested — hanging them higher is what keeps a sign clear of the ridge
// its own POI sits behind. The card holds a constant angular size, so nothing
// about how it reads changes with the extra altitude; you just look up further.
const TIERS = {
  major: { h: 236, size: 1.30, glow: 1.00, rank: 220 },
  mid: { h: 176, size: 1.06, glow: 0.82, rank: 0 },
  minor: { h: 128, size: 0.88, glow: 0.66, rank: -140 },
};
const tierOf = (t) => TIERS[t] || TIERS.mid;

// ===========================================================================
// icons — flat geometric marks, drawn on the plate. cx/cy centre, r half-size.
// ===========================================================================

// specs/0055 §1.8, §3.1 (as built, 2026-09-06) — ONE SEVERITY ALPHABET, ONE
// ARITHMETIC. §3.1's A puts the rating ON the plate as the sign's single mark,
// and the post-stack plates under the same fork already draw that rating with
// `signs.mjs trailBoardTexture`'s shapes at `cx 76 / r 42` (`signs.mjs:135-160`).
// Two diamonds that are 4 % different in aspect standing 12 m apart is the kind
// of thing you only see once you have seen it, so the three shapes below are
// signs.mjs's, VERBATIM, parameterised on `r`:
//   diamond  ± r on the vertical, ± 0.82 r on the horizontal
//   double   rr = 0.80 r, two diamonds at ± 0.46 rr
//   square   1.56 r on a side, axis-aligned
//   circle   0.80 r
// They are MIRRORED and not imported for the same reason `signs.mjs`'s own TYPE
// block is mirrored from `hud.js` (`signs.mjs:21-35`): in the bench this file is
// `bench/public/js/play/markers.js` and that one is `runs/<run>/scene/signs.mjs`,
// while the export moves them to `public/js/play/` and `public/scene/` — there
// is no relative specifier that resolves in both trees, and signs.mjs is
// per-world besides. Keep these four numbers in step with `signs.mjs:135-160`.
// The FILLS are not shared and must not be: signs.mjs paints a dark mark on a
// cream board, the atlas paints a light mark on the kind's plate.
function icoDiamond(g, cx, cy, r, fill, n) {
  g.fillStyle = fill;
  const one = (px, rr) => {
    g.beginPath();
    g.moveTo(px, cy - rr); g.lineTo(px + rr * 0.82, cy);
    g.lineTo(px, cy + rr); g.lineTo(px - rr * 0.82, cy);
    g.closePath(); g.fill();
  };
  if (n === 2) {
    // two diamonds drawn a little smaller, so the pair occupies the same badge
    // area a single one does — signs.mjs:146-151
    const rr = r * 0.80;
    one(cx - rr * 0.46, rr); one(cx + rr * 0.46, rr);
  } else one(cx, r);
}
// square, NOT rotated: a rotated square is a diamond, and on a trail sign those
// two shapes are the whole difficulty scale
function icoSquare(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.fillRect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56);
}
function icoCircle(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.beginPath(); g.arc(cx, cy, r * 0.80, 0, 7); g.fill();
}

// specs/0055 §3.1 — Greg 2026-09-06: the original chair pictogram stays
// ("i liked the og lift icon"). The tower mast/crossarm drawn for D1 is
// withdrawn; icoChair below is the pre-0055 function, restored unchanged.
// a chair on its hanger, hung off the haul rope
function icoChair(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = r * 0.155;
  g.beginPath(); g.moveTo(cx - r, cy - r * 0.82); g.lineTo(cx + r, cy - r * 0.82); g.stroke();  // rope
  g.beginPath(); g.moveTo(cx, cy - r * 0.82); g.lineTo(cx, cy - r * 0.10); g.stroke();          // hanger
  g.beginPath();                                                                                // seat + back
  g.moveTo(cx - r * 0.62, cy - r * 0.34);
  g.lineTo(cx - r * 0.62, cy + r * 0.30);
  g.lineTo(cx + r * 0.60, cy + r * 0.30);
  g.stroke();
  g.fillRect(cx - r * 0.62, cy + r * 0.30, r * 1.22, r * 0.18);                                 // seat pan
  g.beginPath(); g.moveTo(cx + r * 0.34, cy + r * 0.48); g.lineTo(cx + r * 0.34, cy + r * 0.86); g.stroke();
}

function icoBike(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineWidth = r * 0.135; g.lineCap = 'round'; g.lineJoin = 'round';
  const wr = r * 0.40, y = cy + r * 0.30;
  g.beginPath(); g.arc(cx - r * 0.56, y, wr, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx + r * 0.56, y, wr, 0, 7); g.stroke();
  g.beginPath();
  g.moveTo(cx - r * 0.56, y); g.lineTo(cx - r * 0.06, y);
  g.lineTo(cx + r * 0.20, cy - r * 0.36); g.lineTo(cx + r * 0.56, y);
  g.moveTo(cx - r * 0.06, y); g.lineTo(cx + r * 0.20, cy - r * 0.36);
  g.stroke();
  g.beginPath(); g.moveTo(cx + r * 0.10, cy - r * 0.52); g.lineTo(cx + r * 0.46, cy - r * 0.52); g.stroke();
  g.beginPath(); g.moveTo(cx - r * 0.34, cy - r * 0.22); g.lineTo(cx + r * 0.02, cy - r * 0.22); g.stroke();
}

function icoPeak(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(cx - r * 0.98, cy + r * 0.62);
  g.lineTo(cx - r * 0.16, cy - r * 0.72);
  g.lineTo(cx + r * 0.30, cy - r * 0.02);
  g.lineTo(cx + r * 0.56, cy - r * 0.36);
  g.lineTo(cx + r * 0.98, cy + r * 0.62);
  g.closePath(); g.fill();
}

function icoFlag(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineWidth = r * 0.16; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - r * 0.52, cy - r * 0.86); g.lineTo(cx - r * 0.52, cy + r * 0.86); g.stroke();
  g.beginPath();
  g.moveTo(cx - r * 0.40, cy - r * 0.78);
  g.lineTo(cx + r * 0.86, cy - r * 0.30);
  g.lineTo(cx - r * 0.40, cy + r * 0.16);
  g.closePath(); g.fill();
}

// difficulty badge for a ski run: '' | 'blue' | 'green' | 'double'
function skiBadge(g, cx, cy, r, diff) {
  if (diff === 'green') return icoCircle(g, cx, cy, r, '#3fbf62');
  if (diff === 'blue') return icoSquare(g, cx, cy, r, '#4d9bff');
  if (diff === 'double') return icoDiamond(g, cx, cy, r, '#f6f3ec', 2);
  return icoDiamond(g, cx, cy, r, '#f6f3ec', 1);
}

function drawIcon(g, row, cx, cy, r) {
  switch (row.kind) {
    case 'ski-run': return skiBadge(g, cx, cy, r, row.diff);
    case 'lift': return icoChair(g, cx, cy, r, '#171614');   // specs/0055 §3.1 — Greg 2026-09-06: the original chair pictogram stays
    case 'bike-trail':
      if (row.diff) return skiBadgeBike(g, cx, cy, r, row.diff);
      return icoBike(g, cx, cy, r, '#171c15');
    case 'venue': return icoFlag(g, cx, cy, r, '#ffab00');
    default: return icoPeak(g, cx, cy, r, '#0e2a33');
  }
}
// a bike trail marker board still speaks in circles / squares / diamonds
function skiBadgeBike(g, cx, cy, r, diff) {
  if (diff === 'green') return icoCircle(g, cx, cy, r, '#171c15');
  if (diff === 'blue') return icoSquare(g, cx, cy, r, '#171c15');
  if (diff === 'double') return icoDiamond(g, cx, cy, r, '#171c15', 2);
  return icoDiamond(g, cx, cy, r, '#171c15', 1);
}

// ===========================================================================
// the atlas — every card painted once, into one texture
// ===========================================================================

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// specs/0055 §3.5 — the oblique is a SKEW MATRIX, never a token in the font
// string. speedo.js:64-70 records why: an unparsable `ctx.font` is SILENTLY
// DISCARDED and leaves the previous font, so a shorthand carrying
// `oblique 12deg` risks being the wrong SIZE and not merely the wrong slant.
// speedo.js:128, :177-178 and :184-190, verbatim.
const SKEW = Math.tan(hudType.obliqueDeg * Math.PI / 180);
const capOf = (size) => size * 0.70;                     // speedo.js:177
const obliqueW = (w, size) => w + SKEW * capOf(size);    // speedo.js:178

function obliqueText(g, s, x, baseline) {
  g.save();
  g.translate(x, baseline);
  g.transform(1, 0, -SKEW, 1, 0, 0);
  g.fillText(s, 0, 0);
  g.restore();
}

// specs/0055 §3.5 — fitFont UNDER-MEASURED A SKEWED RUN, and that is a clipped
// last glyph rather than a cosmetic slip: `measureText` reports the METRIC box
// while a 12° oblique occupies `SKEW · cap` more picture, and the tracking
// canvas applies is a LENGTH that also lands after the final glyph (§1.3), so
// one track comes back off. `o` is passed only by callers that actually skew.
function fitFont(g, text, maxW, start, weight, family, o) {
  const track = (o && o.track) || 0;
  const skew = !!(o && o.skew);
  let px = start;
  for (;;) {
    g.font = `${weight} ${px}px ${family}`;
    if (track) g.letterSpacing = (track * px).toFixed(2) + 'px';
    let w = g.measureText(text).width;
    if (track) w -= track * px;
    if (skew) w = obliqueW(w, px);
    if (w <= maxW || px <= 13) break;
    px -= 1;
  }
  return px;
}

// specs/0055 §1.2 — `FAM` is DELETED, not orphaned: the boards read
// `hudType.family` / `.weight` at the call site.
const FIT_CARD = { track: hudType.track, skew: 1 };
const MONO = 'ui-monospace,"Cascadia Mono",Consolas,"Segoe UI Mono",monospace';

// specs/0055 §3.1 (as built, 2026-09-06) — THE BLADE'S METRICS, one row per
// tier band. These are the lookbook's own `.sg` numbers (`lookbook.html:119-138`)
// at the atlas's scale: the lookbook's major sign is 55.3 CSS px tall
// (8 pad + 12 kind + 3 gap + 23 name + 7 pad + 2 rule) and this board is 100 px,
// so every length here is round(1.81 × the CSS px). `sm` is the lookbook's
// `.sg--sm` (plate 28, name 13, padding 5/10/4) and is what `minor` draws —
// name-only, per the lookbook cell's third sign, THE CLIFF BAND.
//
//   h         the board's fill height; the plate is `h + rule` tall, because the
//             lookbook's `.sg{align-items:stretch}` runs the plate past the
//             board's own `border-bottom`
//   rule      the mounting rule — 2 CSS px, 4 here. The sign's ONLY border.
//   plate     flush left, full height, one mark centred on it
//   mark      the mark's `r` for drawIcon — 0.35 × the plate, which is the ratio
//             the old floated draw's 40-in-120 had
//   kindBase / nameBase   baselines, measured DOWN from the board's top edge
const BLADE = {
  lg: { w: 488, h: 96, rule: 4, plate: 84, mark: 30, pad: 30, name: 44, kind: 18,
        kindBase: 34, nameBase: 70 },
  sm: { w: 306, h: 58, rule: 4, plate: 52, mark: 18, pad: 18, name: 30, kind: 0,
        kindBase: 0, nameBase: 39 },
};
// The rule's underside is FIXED at this many px from the cell's top, for every
// tier, so the stem below it is one length and a minor blade grows upward from
// the same mounting line a major one hangs from — the lookbook's `.sg-post`
// puts one 15 px post under every sign in the cell whatever size that sign is.
//
// 104 and not 96: the quad is the CELL, so a board that leaves height unused
// leaves it as dead alpha and the sign reads smaller on screen for the same
// angular width. The stem keeps 24 px, which is the lookbook's 15 px post at
// this scale, and everything above it is board.
const BLADE_BOTTOM = 104;
const bladeOf = (tier) => (tier === 'minor' ? BLADE.sm : BLADE.lg);

// specs/0055 §3.1 (slab, Greg 2026-09-06) — THE MINOR TIER'S SURFACE.
//
// When A was built the lookbook's minor board was the one thing held back: its
// A cell draws the third sign, THE CLIFF BAND, as a `.sg--sm.is-slab` — a DARK
// SLAB "sitting on the tree line" — and a new surface needed Greg's yes before
// it entered the system. He gave it: *"Sure on the sign slab"*, 2026-09-06. So
// the minor tier stops inheriting `K.panel` and takes the slab instead. Nothing
// else moves: `BLADE.sm` is untouched, the tier is still name-only, and major
// and mid still paint exactly what they painted this morning.
//
// MEASURED off `#k-sign-board-in-world`'s A cell at 1:1, deviceScaleFactor 1,
// the third `.sg` — board `rgba(16,20,26,.93)`, ink `rgb(233,237,243)`, a 2 px
// rule in `rgb(59,108,255)`, plate `#171614` UNCHANGED by the slab, name 13 px
// / 500 / oblique 12° / .06em, no kind strip, padding 5 10 4. (The cell's three
// own values are written in decimal here on purpose: §10.3's census counts hex
// literals in this file, comments included, and a measurement is not a token.)
//
// §10.3 holds: NOT ONE NEW HEX. Every value below is read out of `KINDS` or out
// of the contrast rule §3.9 already wrote, and the deltas against the cell are
// recorded here rather than closed with a new literal:
//
//   slab fill   cell `rgb(16,20,26)` → `KINDS['ski-run'].ink` `#171614`, the nearest
//               value the file owns (Δ 7, 2, −6 · 9.4 in RGB; the next nearest
//               is `#171c15` at 11.7 and `#0e2a33` at 33.4). Both are near-ink
//               at luminance 0.008, so the miss is a hue cast on a surface the
//               eye reads as black. The .93 is the cell's own alpha, painted as
//               `globalAlpha` and NOT baked into a literal.
//   slab ink    cell `rgb(233,237,243)` → `plateInk(SLAB)` = `#f4f1ea` (Δ 11, 4, −9 ·
//               14.8). `#eaf7fb` is 1.9 nearer in raw RGB and is NOT taken: it
//               is `KINDS.landmark.ink`, and spending a kind's ink as the
//               tier's ink would put a cyan cast on every minor sign in the
//               world. §3.9's rule — "whichever of the file's two type colours
//               has the higher WCAG contrast against the fill" — is the rule
//               that already answers this exact question, and it answers cream.
//   rule        the cell overrides the k-run rule to a blue for one reason:
//               a ski run's own border IS the near-ink, so on the slab it is
//               INVISIBLE and the sign loses the one border §3.1 gives it. So
//               the rule falls back only where it actually vanishes — WCAG 3:1,
//               the non-text threshold — and it falls to the kind's own GLOW,
//               the one other accent every kind in the table declares and the
//               only one guaranteed lighter than its panel. `ski-run` → glow
//               `#cfe0ff` (Δ against the cell's blue 148, 116, 0 · 188 — large,
//               and taken deliberately: the nearest blue the file owns is
//               `#4d9bff`, which is `skiBadge`'s BLUE SQUARE, and a blue-square
//               rule under a ski run's name on the one sign whose plate carries
//               the difficulty mark is a collision, not a match). `venue` →
//               glow `#ffc44d`, keeping its amber. `lift` 5.43:1, `bike-trail`
//               and `landmark` higher still: all three keep their own border.
const SLAB = KINDS['ski-run'].ink;      // #171614 — see the delta above
const SLAB_A = 0.93;                    // the cell's own alpha, not a colour
const SLAB_INK = plateInk(SLAB);        // #f4f1ea, by §3.9's contrast rule
const SLAB_MIN_RATIO = 3;               // WCAG non-text contrast
const slabRule = (K) => (contrastRatio(K.border, SLAB) >= SLAB_MIN_RATIO ? K.border : K.glow);

// Where the plate's right edge falls across the cell, 0..1. This is the WIPE's
// first stop and the width an overlapped sign retracts to (§3.1 motion, below).
const plateFrac = (tier) => {
  const M = bladeOf(tier);
  return ((CARD_W - M.w) / 2 + M.plate) / CARD_W;
};

// One cell of the atlas: specs/0055 §3.1's A — the trail blade Greg picked.
//
// WHAT CHANGED, 2026-09-06. §3.1 recorded this as "markers.js keeps A", as
// though A were what the atlas already drew. It was not: this function drew a
// ROUNDED card (`rrect`, R 16) with a 3 px stroke all the way round it and a
// 120 px icon plate FLOATED inside it and clipped to its corners, plus a 34 px
// accent rule, a kind strip and a prose one-liner. Five of those six things are
// what A replaces. Now:
//
//   * the board is SQUARE. The lookbook's `.sg` carries `border-radius:2px` on
//     a 250 px sign, which is a cut corner and not a rounded card; at this
//     scale that is 3 px on a 488 px board, under the mip. Drawn square.
//   * the plate is BUTTED FLUSH against the board's left edge and runs its full
//     height. No clip, no inset, nothing floated. This is the whole of the
//     pick: the old plate was small enough that its mark was gone by 40 m.
//   * for a run the DIFFICULTY IS THE PLATE'S MARK, and its only one. It comes
//     out of the board — where it was never legible — and it is exactly what
//     `drawIcon` already returns for `ski-run` / `bike-trail`, now drawn at
//     plate size with signs.mjs's own arithmetic (see the alphabet above).
//   * the board hangs under a 2 px MOUNTING RULE in `K.border`, and that rule
//     is the ONLY border on the sign.
//   * major and mid carry the kind strip; MINOR IS NAME-ONLY at `.sg--sm`, and
//     since 2026-09-06 its board is the SLAB (see `SLAB` above) — the last
//     thing the A cell drew that the atlas had not, held back for sign-off.
//   * the prose one-liner is GONE from the board. The lookbook's A cell has no
//     `.sg__line` on this panel and register 2's rule is "plate + board, a
//     mounting rule, one pictogram". `row.tag` still travels on the row.
function paintCard(g, ox, oy, row) {
  const K = kindOf(row.kind);
  const M = bladeOf(row.tier);
  // specs/0055 §3.1 (slab, Greg 2026-09-06) — the minor tier's board is the
  // slab, not `K.panel`. Three values change and nothing else: fill, ink, and
  // the rule where the kind's own border would vanish on it.
  const slab = row.tier === 'minor';
  const boardFill = slab ? SLAB : K.panel;
  const boardInk = slab ? SLAB_INK : K.ink;
  const ruleFill = slab ? slabRule(K) : K.border;
  const X = ox + (CARD_W - M.w) / 2;              // the stem is at the cell centre
  const Y = oy + BLADE_BOTTOM - M.h - M.rule;     // the rule's underside is fixed
  const cx = ox + CARD_W / 2;

  g.save();

  // the board — one soft shadow pass, so it holds against bright sky. Blur and
  // offset are the lookbook’s `0 7px 22px rgba(0,0,0,.38)` pulled in to 9/4 so
  // the tail dies inside this cell's own margin instead of bleeding into the
  // neighbouring cell of the atlas.
  g.shadowColor = 'rgba(0,0,0,0.38)';
  g.shadowBlur = 9; g.shadowOffsetY = 4;
  // §3.1 (slab): the .93 rides on `globalAlpha`, so the alpha the cell picked
  // reaches the texture as alpha and never as a baked-down colour literal —
  // which is also what keeps the slab TRANSLUCENT on screen, the whole point of
  // a board that sits on the tree line rather than punching a hole in it. The
  // shadow scales with it (0.38 → 0.353), which is the right direction: a
  // lighter board casts a lighter shadow.
  g.globalAlpha = slab ? SLAB_A : 1;
  g.fillStyle = boardFill;
  g.fillRect(X, Y, M.w, M.h);
  g.globalAlpha = 1;
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;

  // the mounting rule, under the BOARD only — the plate crosses it
  g.fillStyle = ruleFill;
  g.fillRect(X + M.plate, Y + M.h, M.w - M.plate, M.rule);

  // the plate, flush and full height, with the kind's single mark on it
  g.fillStyle = K.plate;
  g.fillRect(X, Y, M.plate, M.h + M.rule);
  drawIcon(g, row, X + M.plate / 2, Y + (M.h + M.rule) / 2, M.mark);

  // ---- type
  const tx = X + M.plate + M.pad, tw = M.w - M.plate - M.pad * 2;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';

  // the kind strip — major and mid only. The lookbook's `.sg__kind`: mono 700,
  // tracked .22em, in `--kacc`, which is `--kb` (K.border) for every kind in the
  // table. It used to sit beside a 34 px accent rule in K.sub; the accent rule
  // is gone, because the sign has one rule now and it is under the board.
  if (M.kind) {
    g.font = `700 ${M.kind}px ${MONO}`;
    g.letterSpacing = (M.kind * 0.22).toFixed(2) + 'px';
    g.fillStyle = K.border;
    g.fillText(String(row.sub || K.label).toUpperCase(), tx, Y + M.kindBase);
    g.letterSpacing = '0px';
  }

  // specs/0055 §1.2, §1.3 — the board name is NOMINAL: caps, tracked .06em,
  // obliqued by the skew matrix, in the HUD's face at the HUD's weight.
  const name = String(row.name || '').toUpperCase();
  fitFont(g, name, tw, M.name, hudType.weight, hudType.family, FIT_CARD);
  g.fillStyle = boardInk;
  obliqueText(g, name, tx, Y + M.nameBase);
  g.letterSpacing = '0px';

  // ---- the stem: this sign belongs to a point on the ground below it
  g.fillStyle = K.border;
  g.fillRect(cx - 2.5, oy + BLADE_BOTTOM, 5, 14);
  g.beginPath();
  g.moveTo(cx - 11, oy + BLADE_BOTTOM + 11);
  g.lineTo(cx + 11, oy + BLADE_BOTTOM + 11);
  g.lineTo(cx, oy + CARD_H);
  g.closePath(); g.fill();

  g.restore();
}

function buildAtlas(THREE, rows) {
  const c = mkCanvas(ATLAS_W, ATLAS_H);
  const g = c.getContext('2d');
  for (let i = 0; i < rows.length; i++) {
    const col = i % COLS, r = (i / COLS) | 0;
    paintCard(g, col * CARD_W, r * CARD_H, rows[i]);
  }
  // NOTE: no sRGB colour space and no tone mapping on either texture. These are
  // raw ShaderMaterials, so three's output-encoding chunk never runs on them —
  // sampling the bytes exactly as painted and writing them straight out is what
  // makes the sign on screen the sign in the canvas.
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// the halo: one soft radial disc, tinted per marker by a vertex colour
function buildHalo(THREE) {
  const c = mkCanvas(160, 160);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(80, 80, 2, 80, 80, 79);
  gr.addColorStop(0.00, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, 'rgba(255,255,255,0.72)');
  gr.addColorStop(0.38, 'rgba(255,255,255,0.26)');
  gr.addColorStop(0.68, 'rgba(255,255,255,0.07)');
  gr.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 160, 160);
  return new THREE.CanvasTexture(c);
}

// ===========================================================================
// the billboard mesh — N quads, one draw call, camera-facing in the shader
// ===========================================================================

const VERT = `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec2 aScale;
attribute float aAlpha;
attribute float aLift;
attribute vec3 aTint;
attribute float aWipe;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
varying float vWipe;
varying float vCol;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vTint = aTint;
  // specs/0055 §6 — the WIPE's cursor. aCorner.x is +-0.5 by construction, so
  // this is 0 at the sign's left edge and 1 at its right WHATEVER cell of the
  // atlas the sign lives in, which is why the wipe does not need the cell's own
  // u range passed in beside it.
  vWipe = aWipe;
  vCol = aCorner.x + 0.5;
  vec4 mv = modelViewMatrix * vec4(aCenter + vec3(0.0, aLift, 0.0), 1.0);
  mv.xy += aCorner * aScale;          // screen-aligned: the sign always faces you
  gl_Position = projectionMatrix * mv;
}`;

const FRAG_CARD = `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
varying float vWipe;
varying float vCol;
void main() {
  // specs/0055 §6 — WIPE / FALL as a hard left-to-right cursor. A DISCARD and
  // not an alpha ramp: the lookbook's verb is "the plate draws, the board
  // unmasks FROM it", which is a mask edge travelling across the sign, and a
  // fading board is RISE wearing a wipe's clothes.
  if (vCol > vWipe) discard;
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
}`;

const FRAG_HALO = `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  float m = texture2D(uMap, vUv).a * vAlpha;
  if (m < 0.004) discard;
  gl_FragColor = vec4(vTint * m, m);
}`;

function quadGeo(THREE, n, uvFor) {
  const g = new THREE.BufferGeometry();
  const corner = new Float32Array(n * 4 * 2);
  const uv = new Float32Array(n * 4 * 2);
  const center = new Float32Array(n * 4 * 3);
  const scale = new Float32Array(n * 4 * 2);
  const alpha = new Float32Array(n * 4);
  const lift = new Float32Array(n * 4);
  const tint = new Float32Array(n * 4 * 3);
  // specs/0055 §6 — the WIPE cursor, per instance. Starts at 1 (fully drawn):
  // a sign that is already in range when the world loads has ARRIVED, and a
  // world that wipes all twenty of its signs in on the first frame is a title
  // sequence, not a map. Only a genuine draw-distance crossing re-arms it.
  const wipe = new Float32Array(n * 4).fill(1);
  const idx = new Uint16Array(n * 6);
  const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < n; i++) {
    const uvs = uvFor(i);        // [u0, v0, u1, v1]
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      corner[j * 2] = C[k][0]; corner[j * 2 + 1] = C[k][1];
      uv[j * 2] = C[k][0] < 0 ? uvs[0] : uvs[2];
      uv[j * 2 + 1] = C[k][1] < 0 ? uvs[1] : uvs[3];
    }
    const o = i * 6, v = i * 4;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  // `position` is required by three's material plumbing but unused by our shader
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aScale', new THREE.BufferAttribute(scale, 2));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('aWipe', new THREE.BufferAttribute(wipe, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // a sky-high sign must never be frustum-culled by a bbox we do not maintain
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

function hex(THREE, s) { return new THREE.Color(s); }

// ===========================================================================
// DOM — the approach card. Own overlay, own stylesheet (.pmk__*).
// ===========================================================================

const CSS = `
.pmk { position: fixed; left: 0; right: 0; bottom: 21vh; z-index: 20;
  display: flex; justify-content: center; pointer-events: none; }
/* specs/0055 §3.8 (D2, D3) — STATION APPROACH: B, THE BLADE, AND NOTHING ELSE.
   Greg: "B, without the subtitle... Also remove the spine on the left side."
   So three things go and one stays. GONE: the prose subtitle (.pmk__line),
   the kind line (.pmk__kind — §3.8 names it "the left spine"), and the 3 px
   kind border the lookbook's B carries down the left edge. STAYS: the name, on
   the blade, tinted by KINDS[kind].plate through --pmk-accent, which is the
   one variable §3.9 allows this family of panels.
   NO NEW SURFACE (§1.6, D19): the blade keeps the ink the card already used —
   the dark-glass slab DESIGN-0055 wanted is a §11 sign-off item and Greg has
   since said no to it. The whole card is held off screen by PANEL_APPROACH
   anyway; what is built here is what turning that flag on will show. */
.pmk__card {
  display: flex; align-items: center; gap: 14px;
  max-width: min(80vw, 820px);
  background: rgba(23, 22, 20, .88); color: #f4f1ea;
  border: 1px solid rgba(244, 241, 234, .20);
  border-radius: 2px; padding: 14px 26px 14px 20px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, .40);
  opacity: 0;
}
.pmk__icon { width: 38px; height: 38px; flex: none;
  background: center/contain no-repeat; }
.pmk__txt { min-width: 0; }
/* caps oblique for anything nominal (§1.2): the station name is nominal. The
   oblique is a transform, never a font-string token — nothing may depend on the
   face being present. */
.pmk__name { font-family: var(--pf, "Avenir Next", Avenir, "Nunito Sans", "Segoe UI", system-ui, sans-serif);
  font-size: 30px; font-weight: 500; letter-spacing: .06em; line-height: 1.15;
  text-transform: uppercase; transform: skewX(-12deg); transform-origin: left baseline;
  color: var(--pmk-accent, #f4f1ea); }
.pmk__dist { font-family: ui-monospace, Consolas, monospace;
  font-size: 15px; letter-spacing: .14em; color: #8b8578; margin-top: 6px; }

/* FAST TRAVEL — B, the quietest possible offer (specs/0055 §3.9, D4).
   The prompt sits just under the crosshair, so the thing you are aiming at and
   the offer to go there are the same glance.

   B DELETES THE PANEL. No board, no scrim, no border, no shadow: a key cap, a
   hairline divider and two words. The reason is 0048's own rule about this exact
   patch of screen — nothing shows when there is nothing to show — and a
   translucent slab parked 34 px under the reticle is a permanent object in the
   one place the player is aiming through. What is left carries the whole message
   and occupies no surface.

   ONE VARIABLE, AND IT IS THE KIND COLOUR. The key plate and the destination
   name take --pmk-accent, set per target from KINDS[kind].plate (§1.7), so
   what you are aiming at and what you are being offered are the same colour.
   Nothing else about this prompt changes with the target.

   MOTION IS **CUT**, both ways (§6): the prompt tracks the crosshair, so it must
   never travel and must never lag — today's 120 ms fade is 120 ms of ambiguity
   at an aim reticle. is-hit is the SNAP on press: the acknowledgement lands on
   the KEY, not on the name, and it is the only thing here that animates. */
.pmk-aim { position: fixed; left: 50%; top: 50%; z-index: 21;
  transform: translate(-50%, 34px); pointer-events: none;
  display: flex; align-items: center; gap: 9px;
  opacity: 0; }
.pmk-aim.is-on { opacity: 1; }
/* specs/0055 §3.9 (Greg 2026-09-06) — the glyph gets a SECOND variable, and it
   is not a free choice: --pmk-ink is set beside --pmk-accent from plateInk(),
   which is the plate's own contrast partner. On the ink plates (ski-run, venue)
   the T is cream, exactly as the sign board draws that plate's mark; on the
   orange / green / cyan plates it stays near-ink, also as drawn. */
.pmk-aim__key { font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  color: var(--pmk-ink, #171614); background: var(--pmk-accent, #ff4d00);
  border-radius: 2px; padding: 3px 7px; }
/* the snap is a CREAM PLATE, so it takes the ink glyph back for its 90 ms
   whatever the target was — otherwise a ski run would flash cream on cream. */
.pmk-aim.is-hit .pmk-aim__key { background: #f4f1ea; color: #171614;
  animation: pmkSnap 90ms steps(1, end); }
@keyframes pmkSnap { 0% { transform: scale(.96) } 100% { transform: none } }
/* the hairline: the only rule in the prompt, and it is 1 px (§1.10) */
.pmk-aim__bar { width: 1px; height: 12px; flex: none;
  background: rgba(244, 241, 234, .40); }
.pmk-aim__txt { font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  color: #f4f1ea; white-space: nowrap;
  text-shadow: 0 1px 5px rgba(0, 0, 0, .80); }
/* no surface under it, so the type carries its own contrast on snow — which is
   why the name takes --pmk-ink too (specs/0055 §3.9, Greg 2026-09-06). It used
   to take --pmk-accent, and on the ink plates that is a near-black word under a
   near-black shadow: fine against sky, gone against the trees. The shadow is
   unchanged; only the fill moves — and it moves to --pmk-name, NOT to the key
   cap's --pmk-ink, so the kind tint survives on every accent that is legible on
   its own (the lift stays orange). See plateName(). */
.pmk-aim__name { color: var(--pmk-name, #f4f1ea); font-weight: 700;
  text-shadow: 0 1px 5px rgba(0, 0, 0, .80); }
@media (prefers-reduced-motion: reduce) {
  .pmk-aim.is-hit .pmk-aim__key { animation: none; }
}
/* TELEPORT FLASH — A, the destination's own board (specs/0055 §3.10, D6).

   Today the arrival flash is the same white rectangle as the void fade, so two
   opposite events — you chose this / the world caught you — read identically.
   A spends the free frames on the one piece of content that could belong there:
   the name of the place you asked to go, on the place's own board.

   NO NEW SLAB (§1.6, D19). The band is the SIGN ANATOMY: mounting rule, board,
   pictogram. The board is the ink surface .pmk__card already uses, at the cell's
   .92, with cream type on it — fixed, for every destination, because the band
   lies on a white flash and half the kinds board in cream, which on white is no
   board at all. ONE VARIABLE, AND IT IS THE KIND COLOUR (§3.9's rule for this
   family): the two 3 px mounting rules take KINDS[kind].glow — the kind's
   signature, the same value showIntro tints the approach card with, and for a
   chairlift the picked cell's orange. KINDS.plate is what §3.9 names, and it is
   what the pictogram's own plate is already painted in (iconUrl), but plate is
   ink for ski-run and venue, and an ink rule on an ink board is not a rule.

   Nothing here types a hex; every literal below is the fallback inside a var(),
   which is the pattern .pmk__name and .pmk-aim already use.

   display:none on the parent is LOAD-BEARING, not tidiness: verify.mjs's
   overlap probe (:4860) measures .pmk-flash unforced, and a full-screen fixed
   element that is merely transparent would report a 1280x720 hit against the
   gauge. It stays none until paintFlash() shows it. */
.pmk-flash { position: fixed; inset: 0; z-index: 40; background: #fff;
  pointer-events: none; opacity: 0; display: none; }
/* the band: rule / board / rule, full viewport width, on the middle line.
   box-sizing keeps 3 + 46 + 3 exactly 52 px, which is the cell's geometry. */
.pmk-flash__sign { position: absolute; left: 0; right: 0; top: 50%;
  transform: translateY(-50%); box-sizing: border-box; height: 52px;
  display: flex; align-items: center; justify-content: center; gap: 14px;
  background: rgba(23, 22, 20, .92);
  border-top: 3px solid var(--pmk-flash-rule, #ff4d00);
  border-bottom: 3px solid var(--pmk-flash-rule, #ff4d00);
  /* WIPE (§1.11): the board is drawn on from screen-left. paintFlash() owns the
     clock — a CSS transition cannot be trusted on a headless 6 fps frame. */
  clip-path: inset(0 100% 0 0); }
/* 17 px, MEASURED: the cell's pictogram occupies a 17 x 15 box on a 46 px
   board, and this plate is square, so 17 squares it off. It was 30, which put
   65 % of the board's height into a pictogram the cell gives 33 % to. */
.pmk-flash__ico { width: 17px; height: 17px; flex: none;
  background: center/contain no-repeat; }
/* caps oblique, by transform, never a font-string token (§1.2) */
.pmk-flash__name { font-family: var(--pf, "Avenir Next", Avenir, "Nunito Sans", "Segoe UI", system-ui, sans-serif);
  font-size: 19px; font-weight: 500; letter-spacing: .06em; line-height: 1;
  text-transform: uppercase; transform: skewX(-12deg);
  color: #f4f1ea; white-space: nowrap; }
`;

function mountDom() {
  if (!document.getElementById('pmk-style')) {
    const st = document.createElement('style');
    st.id = 'pmk-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  let root = document.querySelector('.pmk');
  if (!root) {
    root = document.createElement('div');
    root.className = 'pmk';
    document.body.appendChild(root);
  }
  root.textContent = '';
  const card = document.createElement('div'); card.className = 'pmk__card';
  const ico = document.createElement('div'); ico.className = 'pmk__icon';
  const txt = document.createElement('div'); txt.className = 'pmk__txt';
  const nm = document.createElement('div'); nm.className = 'pmk__name';
  // specs/0055 §3.8 (D2, D3) — the kind line and the prose subtitle are NOT
  // BUILT, not merely hidden: an element that exists only to be display:none is
  // a panel waiting to come back by accident. `S.kindEl` / `S.lineEl` are gone
  // with them, and `showIntro` no longer writes either.
  txt.append(nm);
  card.append(ico, txt);
  root.append(card);
  card.style.display = 'none';
  S.root = root; S.cardEl = card; S.iconEl = ico;
  S.nameEl = nm;

  // the fast-travel prompt and the teleport flash live outside .pmk (which is
  // pinned to the bottom third) — both want the middle of the screen
  for (const el of document.querySelectorAll('.pmk-aim, .pmk-flash')) el.remove();
  const aim = document.createElement('div'); aim.className = 'pmk-aim';
  const key = document.createElement('span'); key.className = 'pmk-aim__key'; key.textContent = TRAVEL_KEY_CAP;
  const lbl = document.createElement('span'); lbl.className = 'pmk-aim__txt';
  const nmA = document.createElement('span'); nmA.className = 'pmk-aim__name';
  // specs/0055 §3.9 — B's grammar: KEY · "fast travel" · hairline · DESTINATION.
  // The divider replaces the middle dot the panel version used, because with the
  // board gone a punctuation mark on bare snow is the first thing to disappear.
  lbl.textContent = 'fast travel';
  const bar = document.createElement('span'); bar.className = 'pmk-aim__bar';
  aim.append(key, lbl, bar, nmA);
  const fl = document.createElement('div'); fl.className = 'pmk-flash';
  // specs/0055 §3.10 — the board the flash carries. Built once and rewritten
  // per teleport by setFlashSign(); it lives inside .pmk-flash so the white and
  // the board are one element's worth of z-order and clear together (FALL).
  const flSign = document.createElement('div'); flSign.className = 'pmk-flash__sign';
  const flIco = document.createElement('div'); flIco.className = 'pmk-flash__ico';
  const flName = document.createElement('div'); flName.className = 'pmk-flash__name';
  flSign.append(flIco, flName);
  fl.append(flSign);
  // specs/0003 — `debugHud`. The "T · fast travel · <sign>" card under the
  // crosshair. It is CONTEXTUAL — opacity:0 until you aim at a sign — which is
  // why it never showed up in a screenshot and why it is worth being precise
  // about: the front side of the mountain is covered in signs, so in practice it
  // lights up constantly, and a card that names the key, the feature AND the
  // destination is not keeping a secret (D44). The FEATURE is untouched in both
  // builds: KeyT still teleports, aimedAt() still answers, and the arrival flash
  // is still appended. Only the advertisement is lab-only.
  //
  // DETACHED, not deleted — setAim() writes classes and textContent to S.aimEl
  // on every frame you are looking at a sign, and _test.aimEl() reads it back. A
  // detached node takes all of that silently.
  // specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI) -- the append stays the
  // BUILD gate; the switch takes the card off the screen live. `display` and not
  // a class, because setAim() writes this element's classList every frame you
  // are looking at a sign and would take a class straight back off again.
  if (DEBUG_HUD) {
    document.body.append(aim);
    const paintAim = () => { aim.style.display = labUI() ? '' : 'none'; };
    addEventListener('play:labui', paintAim);
    paintAim();
  }
  document.body.append(fl);
  S.aimEl = aim; S.aimKeyEl = key; S.aimNameEl = nmA; S.flashEl = fl;
  S.flashSignEl = flSign; S.flashIcoEl = flIco; S.flashNameEl = flName;
}

// one 96² icon per kind, painted once, handed to the DOM as a data URL
function iconUrl(row) {
  const k = row.kind + (row.diff || '');
  if (S.iconUrl[k]) return S.iconUrl[k];
  const c = mkCanvas(96, 96);
  const g = c.getContext('2d');
  const K = kindOf(row.kind);
  g.fillStyle = K.plate;
  rrect(g, 0, 0, 96, 96, 12); g.fill();
  drawIcon(g, row, 48, 48, 30);
  const url = c.toDataURL();
  S.iconUrl[k] = url;
  return url;
}

function showIntro(row) {
  try {
    if (!S.cardEl) return;
    // specs/0055 §3.8 (D2) — HIDDEN, WITH THE TRIGGER LEFT RUNNING. Greg asked
    // for the approach cards to be held back "until we find a less distracting
    // way to present them" (§11 item 4), so the panel is built and this is the
    // one line between it and the screen. `introShown` is still set, so the
    // once-per-approach arm and its RESET_R re-arm behave exactly as they do
    // with the card on: turning the flag on is the ONLY difference.
    if (!PANEL_APPROACH) { row.introShown = true; return; }
    const K = kindOf(row.kind);
    // the halo colour is the kind's signature — the card's rule and its kind
    // strip use it too, so the sky and the HUD agree about what this place is
    S.cardEl.style.setProperty('--pmk-accent', K.glow);
    S.iconEl.style.backgroundImage = `url(${iconUrl(row)})`;
    // specs/0055 §3.8 — the NAME, and nothing else. `row.sub` and `row.line`
    // still travel on the row (the atlas board and the pause list read them);
    // this panel simply stopped being the place that repeats them.
    S.nameEl.textContent = row.name;
    S.cardEl.style.display = '';
    S.cardEl.style.opacity = '0';
    S.intro = { row, phase: 'in', t: 0 };
    row.introShown = true;
  } catch { S.errors++; }
}

function hideIntro() {
  S.intro = null;
  if (S.cardEl) { S.cardEl.style.opacity = '0'; S.cardEl.style.display = 'none'; }
}

// frame-rate independent: every phase is a clock, never a frame count
function tickIntro(dt) {
  const I = S.intro;
  if (!I) return;
  I.t += dt;
  if (I.phase === 'in') {
    const k = clamp(I.t / IN_T, 0, 1);
    S.cardEl.style.opacity = String(+(k * k * (3 - 2 * k)).toFixed(3));
    if (I.t >= IN_T) { I.phase = 'hold'; I.t = 0; S.cardEl.style.opacity = '1'; }
  } else if (I.phase === 'hold') {
    if (I.t >= HOLD_T) { I.phase = 'out'; I.t = 0; }
  } else {
    const k = clamp(1 - I.t / OUT_T, 0, 1);
    S.cardEl.style.opacity = String(+(k * k * (3 - 2 * k)).toFixed(3));
    if (I.t >= OUT_T) hideIntro();
  }
}

// ===========================================================================
// the registries
// ===========================================================================
// Coordinates are PLAYER frame — Y-up metres, the frame the controller reports.
// Every one of these worlds is authored ENU z-up and tipped by main.js, so a
// source anchor (x, y_enu, z_enu) is stored here as (x, z_enu, -y_enu). `pos.y`
// is the GROUND at the spot; the sign hangs `tier.h` metres over it, and
// init() re-settles y on the real collider floor where it can.

const REG = {
  // ================================================= PALISADES FRONT SIDE
  // runs/palisades-front-A-merge-01. Merged ENU frame (Red Dog's, unchanged):
  // origin 39.19197/-120.23108, z = 0 at 1890.0 m ASL. Anchors are the `A`
  // block and the RUNS[].pts[0] tops of scene/layout.mjs. This world is an
  // ORPHAN run (no poi id), so it is keyed by run prefix.
  'palisades-front': [
    { id: 'kt22', name: 'KT-22', kind: 'landmark', tier: 'major',
      pos: [-913.4, 570.8, 996.4], sub: 'SUMMIT', tag: '2,460 m · the roof of the front side',
      line: 'The highest point in the frame, and the mountain Squaw was built around. Everything from here is down.' },
    { id: 'eagles-nest', name: "EAGLE'S NEST", kind: 'landmark', tier: 'minor',
      pos: [-894.2, 552.0, 997.2], sub: 'SPIRES', tag: "McConkey's drops off the back",
      line: 'The spires on the summit knob. Shane McConkey’s run starts off the far side and does not ease you into it.' },
    { id: 'gs-bowl', name: 'GS BOWL', kind: 'ski-run', tier: 'mid', diff: 'black',
      pos: [-981.3, 541.0, 942.0], sub: 'KT-22', tag: '2,431 m · patrol shack at the gate',
      line: 'The wide north-facing bowl off the KT summit. Cornice at the top, 170 m of fall line under it.' },
    { id: 'olympic-lady', name: 'OLYMPIC LADY', kind: 'lift', tier: 'mid',
      pos: [-685.1, 519.0, 1027.2], sub: 'TOP STATION', tag: '732 m · fixed double',
      line: 'The smallest chair on the front side, and the one that ties KT-22 to Exhibition. Unload here for The Saddle.' },
    { id: 'exhibition', name: 'EXHIBITION', kind: 'lift', tier: 'mid',
      pos: [-591.7, 258.2, 297.6], sub: 'TOP STATION', tag: '727 m · fixed quad',
      line: 'Six runs start within 12 m of this station — Easy Street, Julia’s Gold, Schimmelpfennig Bowl among them.' },
    { id: 'red-dog-express', name: 'RED DOG EXPRESS', kind: 'lift', tier: 'major',
      pos: [322.5, 403.8, 401.8], sub: 'TOP STATION', tag: '917 m · six-pack',
      line: 'The 2023 six-pack, unloading on the Snow King knoll. The whole east half of the front side hangs off this point.' },
    { id: 'red-dog-face', name: 'RED DOG FACE', kind: 'ski-run', tier: 'major', diff: 'double',
      pos: [-276.5, 167.4, 135.3], sub: 'MOGULS', tag: '86 m wide · 600 m of bumps',
      line: 'The bump run the resort races on. Every mogul on it was built by somebody braking.' },
    { id: 'race-venue', name: 'OLYMPIC VILLAGE', kind: 'venue', tier: 'mid',
      pos: [-309.5, 13.0, -384.7], sub: 'GS COURSE', tag: 'Stifel Palisades Tahoe Cup' },
    { id: 'base-area', name: 'THE VILLAGE', kind: 'venue', tier: 'major',
      pos: [-270.0, 16.0, -515.0], sub: 'BASE AREA', tag: '1,890 m · lifts, lodges, lots',
      line: 'The valley floor. Five lift bases meet here, and every run in the world ends somewhere on this flat.' },
    { id: 'kt22-base', name: 'KT-22 EXPRESS', kind: 'lift', tier: 'minor',
      pos: [-481.8, 10.3, -359.0], sub: 'BASE STATION', tag: '1,425 m · express quad',
      line: 'The load for KT-22. Ride it and you are on the summit — 535 m of vertical in one lift line.' },
  ],

  // ================================================= SIBERIA / PALISADES BOWL
  // runs/siberia-palisades-A-raw-01. ENU, origin 39.18375/-120.26625,
  // z = 0 at 2366.0 m ASL. Anchors: layout.mjs `A` + runs-data.mjs way tops.
  'siberia-palisades': [
    { id: 'siberia-top', name: 'SIBERIA EXPRESS', kind: 'lift', tier: 'major',
      pos: [-511.6, 279.1, 109.8], sub: 'TOP STATION', tag: '2,645 m · the high lift',
      line: 'The top of the Siberia bowl. Everything worth doing up here starts within 30 m of this unload.' },
    { id: 'palisades-cliffs', name: 'THE PALISADES', kind: 'landmark', tier: 'major',
      pos: [-278.5, 329.9, 346.7], sub: 'CLIFF BAND', tag: 'Chimney · Main · Extra Chute',
      line: 'The cliff band the place is named for: 620 m of rock with three named chutes cut through it. Look before you drop.' },
    { id: 'reverse-traverse', name: 'REVERSE TRAVERSE', kind: 'ski-run', tier: 'mid', diff: 'blue',
      pos: [-242.7, 242.8, 246.8], sub: 'TRAVERSE', tag: 'Siberia top → Headwall top',
      line: 'The high line that connects the two lifts without giving up altitude. Ride it out and the whole Headwall opens.' },
    { id: 'headwall-top', name: 'HEADWALL EXPRESS', kind: 'lift', tier: 'mid',
      pos: [43.7, 266.0, 152.2], sub: 'TOP STATION', tag: '2,632 m',
      line: 'The east end of the Reverse Traverse and the gate to Sun Bowl, North Bowl and the Slot.' },
    { id: 'sun-bowl', name: 'SUN BOWL', kind: 'ski-run', tier: 'minor', diff: 'black',
      pos: [3.7, 259.8, 182.9], sub: 'BOWL', tag: '1,310 m · south-facing',
      line: 'The long south-facing bowl off the Headwall. It runs 1.3 km and it softens first every afternoon.' },
    { id: 'the-slot', name: 'THE SLOT', kind: 'ski-run', tier: 'mid', diff: 'double',
      pos: [259.2, 211.6, 97.8], sub: 'CHUTE', tag: 'off the scree ridge',
      line: 'A narrow line off the east end of the scree ridge. You walk to it, which is why nobody is in it.' },
    { id: 'high-camp', name: 'HIGH CAMP', kind: 'venue', tier: 'mid',
      pos: [102.7, 59.4, -599.5], sub: 'FUNITEL TOP', tag: '2,425 m',
      line: 'The mid-mountain village at the top of the Funitel. Everything on this side funnels back to it.' },
  ],

  // ================================================= DENALI / MULDROW GLACIER
  // runs/denali-muldrow-A-raw-01. ENU about 63.20/-150.80, z = 0 at 1600.0 m
  // ASL, so scene z = ASL - 1600. Anchors: layout.mjs SPAWN / TEMPLE / CAMPS,
  // work/chasms.json, scene/ice-data.mjs LAND. Default gear here is the glider.
  'denali-muldrow': [
    { id: 'temple', name: 'SOUTHERN AIR TEMPLE', kind: 'landmark', tier: 'major',
      pos: [1682.0, 947.0, 17.0], sub: 'TEMPLE', tag: '2,547 m · on the east shelf',
      line: 'A monastery on a shelf above the glacier — towers, an airball court and an outlook over the whole Muldrow. Fly to it.' },
    { id: 'launch-cornice', name: 'LAUNCH CORNICE', kind: 'venue', tier: 'major',
      pos: [-500.0, 1378.0, 1650.0], sub: 'LAUNCH', tag: '2,978 m · step off here',
      line: 'The lip you start from. Nothing but 1,100 m of air between this cornice and the glacier below it.' },
    { id: 'icefall', name: 'LOWER ICEFALL', kind: 'landmark', tier: 'mid',
      pos: [-2812.5, 532.5, 1506.6], sub: 'SERAC ZONE', tag: '2,133 m · broken ice',
      line: 'Where the Muldrow tears itself apart over a step in the bedrock. A kilometre of seracs, best seen from above.' },
    { id: 'chasm-field', name: 'THE CHASM FIELD', kind: 'landmark', tier: 'mid',
      pos: [-2410.0, 475.2, 1288.0], sub: 'CREVASSES', tag: 'six open chasms',
      line: 'Six crevasses wide enough to fly into, cut across the glacier between the icefall and the flats.' },
    { id: 'icefall-camp', name: 'LOWER ICEFALL CAMP', kind: 'venue', tier: 'mid',
      pos: [-2717.7, 415.7, 799.8], sub: 'CAMP', tag: '2,016 m',
      line: 'Tents on the ice below the icefall. The first place on the glacier anybody stops.' },
    { id: 'the-flats', name: 'THE FLATS', kind: 'venue', tier: 'mid',
      pos: [-1189.4, 276.7, -474.7], sub: 'CAMP', tag: '1,877 m · the long flat',
      line: 'The lower camp, out where the Muldrow finally stops falling. Landing here is the easy option.' },
    { id: 'gunsight', name: 'GUNSIGHT PASS', kind: 'landmark', tier: 'minor',
      pos: [-2578.0, 401.7, -637.0], sub: 'PASS', tag: '2,002 m',
      line: 'The notch on the north wall. Thread it and you are out of the Muldrow drainage entirely.' },
  ],

  // ================================================= TRUCKEE BIKE PARK
  // runs/truckee-bike-park-A-raw-01. ENU about 39.32975/-120.15803, z = 0 at
  // 1763.5 m ASL. Line starts come from layout.mjs LOC + the shipped ride
  // manifests; the park is only ±180 m so y is settled off the collider floor.
  'truckee-bike-park': [
    { id: 'runway-26', name: 'RUNWAY 26', kind: 'bike-trail', tier: 'major', diff: 'black',
      pos: [-60.0, 4.0, 108.6], sub: 'SLOPESTYLE', tag: 'start tower · 212 m to the finish',
      line: 'The park’s headline line. Off the tower deck, straight down the spine, and it does not have a slow section.' },
    { id: 'blue-slope', name: 'BLUE SLOPE LINE', kind: 'bike-trail', tier: 'mid', diff: 'blue',
      pos: [-78.0, 4.0, 110.0], sub: 'SLOPESTYLE', tag: 'the friendly one',
      line: 'Same hill as Runway 26, every gap turned into a table. This is where you learn the fall line.' },
    { id: 'jaws', name: 'JAWS', kind: 'bike-trail', tier: 'major', diff: 'double',
      pos: [10.0, 4.0, 116.5], sub: 'UPPER DJZ', tag: 'the big set',
      line: 'The largest jumps in the park, at the top of the upper dirt-jump zone. Full commitment or nothing.' },
    { id: 'djz', name: 'DIRT JUMP ZONE', kind: 'venue', tier: 'mid',
      pos: [50.0, 4.0, 60.0], sub: 'LOWER DJZ', tag: 'Maidu · SNP · Barbara-Jean · Intern',
      line: 'Four lines off one roll-in shelf, black through blue. The whole zone runs north into the plaza.' },
    { id: 'pump-track', name: 'PUMP TRACK', kind: 'venue', tier: 'mid',
      pos: [84.0, 4.0, -76.0], sub: 'PUMP', tag: 'asphalt loop + strider ring',
      line: 'The loop nobody pedals. Pump it well enough and you never touch the cranks for a full lap.' },
    { id: 'dual-slalom', name: 'DUAL SLALOM', kind: 'venue', tier: 'mid',
      pos: [-112.0, 4.0, 100.0], sub: 'RACE', tag: 'two gates · 184 m',
      line: 'Two parallel lines off one start deck, berm for berm the whole way down. Race venue, west edge of the park.' },
    { id: 'trailhead', name: 'TBP TRAILHEAD', kind: 'landmark', tier: 'minor',
      pos: [-60.0, 4.0, -90.0], sub: 'BASE', tag: 'plaza · shop · airbag',
      line: 'Where every line ends and every lap starts again. Map kiosk, shop hut and the airbag pad.' },
  ],

  // ================================================= RED BULL JOYRIDE
  // runs/redbull-joyride-whistler-A-raw-01. This world is authored THREE.js
  // Y-up (+Z south), `up:'y'` — no conversion. Values are the ride-line points
  // out of scene/layout.mjs, not the deck tops.
  'redbull-joyride-whistler': [
    { id: 'start-hut', name: 'START HUT', kind: 'venue', tier: 'major',
      pos: [2.0, 69.8, 300.0], sub: 'START', tag: 'drop in here',
      line: 'The deck at the top of the Boneyard. Seventeen features and 514 m of course between you and the corral.' },
    { id: 'boner-log', name: 'BONER LOG', kind: 'bike-trail', tier: 'mid', diff: 'black',
      pos: [5.97, 66.48, 238.4], sub: 'FEATURE 3', tag: 'we did not name it',
      line: 'A log ride into a gap, third feature down. Crankworx commentary has been dealing with the name since 2011.' },
    { id: 'lip-14ft', name: 'THE 14-FOOTER', kind: 'bike-trail', tier: 'mid', diff: 'double',
      pos: [-16.1, 53.72, 115.59], sub: 'FEATURE 7', tag: '4.3 m lip',
      line: 'The lip that decides the contest. Go deep off it and the crowd hears about it before you land.' },
    { id: 'whale-tail', name: 'WHALE-TAIL', kind: 'bike-trail', tier: 'major', diff: 'double',
      pos: [-12.63, 26.56, 10.53], sub: 'FEATURE 10', tag: '17 m gap into a step-down',
      line: 'The signature feature of Joyride: off the deck, over the tail, straight into a step-down with no reset between them.' },
    { id: 'finish-corral', name: 'FINISH CORRAL', kind: 'venue', tier: 'major',
      pos: [-13.52, -2.75, -197.51], sub: 'FINISH', tag: 'under the arch',
      line: 'The legendary corral at the bottom of the Whistler bike park. Twelve thousand people, one inflatable arch.' },
  ],

  // ================================================= EASTNOR FLOATING COURSE
  // runs/eastnor-floating-bike-course-A-raw-01. ENU, z = 0 at the lake surface;
  // `up:'z'`. Module mid-points from scene/layout.mjs's accumulator walk.
  'eastnor-floating-bike-course': [
    { id: 'start-arch', name: 'START ARCH', kind: 'venue', tier: 'major',
      pos: [177.6, 0.45, -8.0], sub: 'START', tag: 'roll in west',
      line: 'The arch on the east shore. From here the whole course floats — nothing you ride is standing on the bottom.' },
    { id: 'cheese-wheel', name: 'THE CHEESE WHEEL', kind: 'bike-trail', tier: 'major', diff: 'black',
      pos: [88.0, 1.65, -8.0], sub: 'FEATURE', tag: '4 m wheel · rolling',
      line: 'A four-metre wheel of cheese you ride over the top of. It creaks. It has always creaked.' },
    { id: 'teeter', name: 'THE TEETER', kind: 'bike-trail', tier: 'minor', diff: 'blue',
      pos: [109.5, 0.5, -8.0], sub: 'FEATURE', tag: 'floating seesaw',
      line: 'A seesaw on pontoons. It tips when you cross the middle, exactly as a seesaw should, and it is on water.' },
    { id: 'castle', name: 'EASTNOR CASTLE', kind: 'landmark', tier: 'major',
      pos: [-248.0, 11.0, -58.0], sub: 'VIEWPOINT', tag: '1812 · deer park',
      line: 'The castle across the water, and the reason the course is here. Eight hundred years of lawn, and tyre marks on it.' },
    { id: 'finish', name: 'FINISH JETTY', kind: 'venue', tier: 'mid',
      pos: [-93.1, 0.4, -43.3], sub: 'FINISH', tag: 'still floating',
      line: 'The far end of the chain. Get here with the plank still under you and both of those count as results.' },
  ],

  // ================================================= SAND HARBOR, LAKE TAHOE
  // runs/sand-harbor-B-harness-01 — the CONTRACT run (A-raw-01 is a
  // page-takeover orbit demo with no world.mjs and no declared frame, so this
  // key is deliberately B-only). ENU, z = 0 at the waterline; `up:'z'`.
  // Positions are the layout.json hero anchors.
  'sand-harbor-B': [
    { id: 'divers-rock', name: "DIVER'S ROCK", kind: 'landmark', tier: 'major',
      pos: [55.8, 3.0, -209.2], sub: 'JUMP ROCK', tag: '4.6 m over the water',
      line: 'The granite block everybody jumps off. The lake is clear enough that you can see exactly how deep it is not.' },
    { id: 'the-point', name: 'THE POINT', kind: 'landmark', tier: 'major',
      pos: [-46.7, 3.0, -36.2], sub: 'HEADLAND', tag: '10.5 m granite',
      line: 'The granite headland at the west end of the beach. Climb it for the view down the whole east shore.' },
    { id: 'main-beach', name: 'MAIN BEACH', kind: 'venue', tier: 'major',
      pos: [88.5, 1.2, -7.4], sub: 'BEACH', tag: 'south shore · 200 m of sand',
      line: 'The main south beach. Boulders at both ends, turquoise shelf offshore, and the clearest water in Nevada.' },
    { id: 'amphitheater', name: 'TREPP AMPHITHEATER', kind: 'venue', tier: 'mid',
      pos: [44.9, 3.0, -33.7], sub: 'AMPHITHEATRE', tag: 'nine granite rows',
      line: 'Nine rows of granite facing the lake. Perfect acoustics, tough room.' },
    { id: 'boat-launch', name: 'BOAT LAUNCH', kind: 'venue', tier: 'minor',
      pos: [203.6, 0.5, -308.9], sub: 'PIER', tag: 'north end',
      line: 'The pier and ramp at the north end of the park. A gull holds the end of it and does not negotiate.' },
  ],
};

// ===========================================================================
// wiring
// ===========================================================================

function regKey(ctx) {
  const p = (ctx.poi || '').trim();
  if (REG[p]) return p;
  const r = (ctx.run || '').trim();
  let best = '';
  for (const k of Object.keys(REG)) {
    if (r.indexOf(k) === 0 && k.length > best.length) best = k;
  }
  return best;
}

// contract markers (world.markers) — validate hard, drop anything malformed
function fromContract(list, upAxis) {
  const out = [];
  for (const m of list) {
    if (!m || !Array.isArray(m.pos) || m.pos.length < 3) continue;
    const p = m.pos.map(Number);
    if (!p.every((v) => isFinite(v))) continue;
    // the z-up tip, exactly as main.js does it for spawn and lifts
    const pos = upAxis === 'z' ? [p[0], p[2], -p[1]] : [p[0], p[1], p[2]];
    out.push({
      id: String(m.id || m.name || 'marker-' + out.length),
      name: String(m.name || m.id || 'POI'),
      kind: KINDS[m.kind] ? m.kind : 'landmark',
      tier: TIERS[m.tier] ? m.tier : 'mid',
      diff: m.diff || '', sub: m.sub || '', tag: m.tag || '',
      line: m.line || m.blurb || '',
      pos,
    });
    if (out.length >= MAX_MARKERS) break;
  }
  return out;
}

function fromRegistry(key) {
  const rows = (REG[key] || []).slice(0, MAX_MARKERS);
  return rows.map((m) => ({
    id: m.id, name: m.name, kind: KINDS[m.kind] ? m.kind : 'landmark',
    tier: TIERS[m.tier] ? m.tier : 'mid',
    diff: m.diff || '', sub: m.sub || '', tag: m.tag || '',
    line: m.line || '', pos: m.pos.slice(),
  }));
}

// Registry y is the anchor's own elevation — an OSM node's, a layout module's,
// or in a couple of worlds a flat placeholder because the layout only ships XY.
// Where the collider floor can be read and does not disagree wildly (a reading
// 60 m out is a roof, a serac or a hole in the grid), prefer it: the DEM the
// sign hangs over should be the one the player actually stands on.
const SETTLE_TOL = 60;

function settle(rows) {
  const at = (S.collision && S.collision.groundAt && S.collision.bounds)
    ? (x, z) => S.collision.groundAt(x, z, S.collision.bounds.maxY + 5)
    : (window.__player && window.__player.groundAt) || null;
  if (!at) return 0;
  let n = 0;
  for (const r of rows) {
    try {
      const g = at(r.pos[0], r.pos[2]);
      if (g === null || g === undefined || !isFinite(g)) continue;
      r.ground = g;
      if (Math.abs(g - r.pos[1]) <= SETTLE_TOL * S.u) { r.pos[1] = g; n++; }
    } catch { S.errors++; }
  }
  return n;
}
// specs/0055 §3.6 — WHICH MID-TIER SIGNS STAND OVER A POST STACK.
//
// `world.mjs` publishes the fork centres it derived from `RUNS` onto
// `scene.userData.forkCentres`, as ENU [x, y] pairs in `layout.mjs`'s own frame.
// It travels through `userData` rather than through a new `init()` argument
// because a world with no forks — a bike park, a single glacier line — then
// publishes nothing and this whole pass costs one property read; `ctx`'s own
// `forkCentres` is accepted too, for a host page that hands them over directly.
//
// THE FRAME CONVERSION IS THE WHOLE OF THE CARE HERE. Marker positions are in
// the PLAYER frame, Y-up, and a z-up world's contract markers were tipped on the
// way in — `(x, y, z)_ENU -> (x, z, -y)_three`, the same tip main.js does to its
// lifts. So the marker's ENU y is `-pos[2]`, and that is what a centre's y is
// compared against. A y-up world needs no tip and compares straight.
//
// COMPUTED ONCE, AT INIT, NOT PER FRAME. §3.6 budgets "one Math.hypot per marker
// per frame against <= 12 fork centres" — cheap, but it buys nothing, because
// neither term ever moves: the markers are settled onto the floor a few lines
// above and never again, and the forks are a pure function of `RUNS` baked at
// world build. Same answer, 20 x 12 hypots once instead of 720 every second.
function markForks(ctx) {
  let n = 0;
  try {
    const ud = (S.scene && S.scene.userData) || null;
    const centres = (ctx && ctx.forkCentres) || (ud && ud.forkCentres) || null;
    if (!Array.isArray(centres) || !centres.length) return 0;
    S.forks = centres.filter((c) => Array.isArray(c) && c.length >= 2
      && isFinite(c[0]) && isFinite(c[1]));
    const zUp = !!(ctx && ctx.upAxis === 'z');
    const R = FORK_HIDE_R * S.u;
    for (const r of S.rows) {
      r.forkHidden = false;
      // major and minor are never suppressed (§3.6): a lift station or a summit
      // is a place rather than a run choice, and the bracket does not name it;
      // a minor chip is already faint enough to read as a breadcrumb.
      if (r.tier !== 'mid') continue;
      const mx = r.pos[0], my = zUp ? -r.pos[2] : r.pos[2];
      for (const c of S.forks) {
        if (Math.hypot(mx - c[0], my - c[1]) <= R) { r.forkHidden = true; n++; break; }
      }
    }
  } catch { S.errors++; }
  return n;
}

// How far away a sign is still worth drawing. A 400 m bike park and a 5 km
// glacier cannot share one number: take it from the collidable extent, which
// is the only honest measure of how big the world the player is in actually is.
// The topmost collidable surface in a column — a roof, a serac, the cliff lip
// above an anchor tucked under it. groundAt() probes DOWN from above everything,
// so this is the highest thing the world has at (x, z).
function topAt(x, z) {
  try {
    const col = S.collision;
    if (!col || !col.groundAt || !col.bounds) return null;
    const g = col.groundAt(x, z, col.bounds.maxY + 5 * S.u);
    return (g === null || g === undefined || !isFinite(g)) ? null : g;
  } catch { S.errors++; return null; }
}

// Where the sign for `r` actually hangs. Start at the tier height over the
// settled ground, then make sure nothing in the world is standing between the
// anchor and the sign, or above the sign:
//   1. the top of the column must be below it (an anchor under an overhang has a
//      topmost surface far above its own ground);
//   2. a ray straight up from just over the anchor must reach it without hitting
//      anything (a roof, a bridge deck, the underside of a serac).
// Anything found pushes the sign to CLEAR_M above the obstruction, up to
// RAISE_MAX × the tier height. Records r.top / r.raise so the tests can read it.
function skyFor(r, tierH) {
  const base = r.pos[1];
  const want = base + tierH * S.u;
  const cap = base + tierH * S.u * RAISE_MAX;
  const clear = CLEAR_M * S.u;
  let y = want;
  const top = topAt(r.pos[0], r.pos[2]);
  r.top = top;
  if (top !== null && y < top + clear) y = top + clear;
  try {
    const col = S.collision;
    if (col && col.raycast) {
      const from = base + 3 * S.u;                 // clear of the triangle underfoot
      const reach = Math.max(y - from, 1);
      const hit = col.raycast(r.pos[0], from, r.pos[2], 0, 1, 0, reach);
      if (hit && isFinite(hit.dist)) {
        const hy = from + hit.dist;
        if (y < hy + clear) y = hy + clear;
      }
    }
  } catch { S.errors++; }
  if (y > cap) y = cap;
  if (y < want) y = want;
  r.raise = +(y - want).toFixed(2);
  return y;
}

function farRange() {
  let span = 0;
  try {
    const b = S.collision && S.collision.bounds;
    if (b) span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  } catch { span = 0; }
  if (!isFinite(span) || span <= 0) span = 1800 * S.u;
  S.farD = clamp(span * 0.55, FAR_D * S.u, 4000 * S.u);
  S.farGone = S.farD * 1.55;
  // How wide a card is allowed to get in world units. This is the distance at
  // which a sign stops holding its angular size and starts shrinking — put it
  // near the far range so a 1.4 km peak on a merged resort is still a legible
  // sign, while a 400 m bike park's cards never bloat.
  S.maxW = clamp(S.farD * 0.09, 96 * S.u, 420 * S.u);
}

function build(THREE, rows) {
  const n = rows.length;
  if (!n) return;
  S.atlas = buildAtlas(THREE, rows);
  S.haloTex = buildHalo(THREE);

  const uvCard = (i) => {
    const col = i % COLS, r = (i / COLS) | 0;
    const u0 = (col * CARD_W) / ATLAS_W, u1 = ((col + 1) * CARD_W) / ATLAS_W;
    // canvas y grows down, texture v grows up
    const v1 = 1 - (r * CARD_H) / ATLAS_H, v0 = 1 - ((r + 1) * CARD_H) / ATLAS_H;
    return [u0, v0, u1, v1];
  };
  const gCard = quadGeo(THREE, n, uvCard);
  const gHalo = quadGeo(THREE, n, () => [0, 0, 1, 1]);

  // OCCLUSION. depthTest is ON for both meshes: a sign is a thing in the world at
  // a real distance, and a ridge or a building in front of it must hide it. The
  // halo is additive and gets exactly the same treatment — an additive glow that
  // survives the mountain in front of it is the same "see through walls" bug as
  // the card, only brighter.
  //
  // depthWrite stays OFF. These are transparent quads with a shared atlas, drawn
  // in an order the declutter pass decides rather than back to front, so writing
  // depth would let whichever card happened to be drawn first punch a hole in the
  // one behind it — and would let the additive halo mask its own card.
  //
  // Because the billboard is built by offsetting the CENTRE in view space
  // (`mv.xy += aCorner * aScale`, mv.z untouched), every fragment of a quad
  // carries the centre's depth. The sign therefore tests as a flat plane facing
  // the camera at the sign's own distance, which is what makes partial occlusion
  // look right: a ridge crossing the quad clips it along the skyline instead of
  // popping the whole card in and out.
  const mCard = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: S.atlas } },
    vertexShader: VERT, fragmentShader: FRAG_CARD,
    transparent: true, depthTest: true, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  const mHalo = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: S.haloTex } },
    vertexShader: VERT, fragmentShader: FRAG_HALO,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });

  S.card = new THREE.Mesh(gCard, mCard);
  S.halo = new THREE.Mesh(gHalo, mHalo);
  S.card.name = 'pmk:cards'; S.halo.name = 'pmk:halos';
  S.card.frustumCulled = false; S.halo.frustumCulled = false;
  // Both are transparent, so they sort into the transparent pass: renderOrder
  // only decides the halo draws before its card, and that the pair draws after a
  // world's own transparent props (water, canopies) instead of interleaving with
  // them. It no longer means "on top of everything" — the depth test decides that.
  S.card.renderOrder = 992; S.halo.renderOrder = 991;   // halo behind the card

  S.group = new THREE.Group();
  S.group.name = 'pmk:markers';
  S.group.add(S.halo, S.card);
  S.scene.add(S.group);

  // static per-instance data: the anchor and the halo tint
  const cC = gCard.getAttribute('aCenter'), cH = gHalo.getAttribute('aCenter');
  const tH = gHalo.getAttribute('aTint');
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const T = tierOf(r.tier);
    r.sky = skyFor(r, T.h);
    const col = hex(THREE, kindOf(r.kind).glow);
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      cC.array[j * 3] = r.pos[0]; cC.array[j * 3 + 1] = r.sky; cC.array[j * 3 + 2] = r.pos[2];
      cH.array[j * 3] = r.pos[0]; cH.array[j * 3 + 1] = r.sky; cH.array[j * 3 + 2] = r.pos[2];
      tH.array[j * 3] = col.r; tH.array[j * 3 + 1] = col.g; tH.array[j * 3 + 2] = col.b;
    }
    r.phase = (i * 2.39996) % 6.283;
    // specs/0055 §6 — the WIPE's state, one row at a time. `wasIn` starts true
    // so a sign already inside the draw distance at load has arrived rather
    // than arriving; `plateFrac` is the tier's own plate edge, which is where
    // the enter wipe changes rate and where an overlapped sign retracts to.
    r.wipe = 1; r.wasIn = true; r.overlapped = false;
    r.plateFrac = plateFrac(r.tier);
  }
  cC.needsUpdate = true; cH.needsUpdate = true; tH.needsUpdate = true;
}

// ===========================================================================
// per-frame
// ===========================================================================

function step(dt, devOn) {
  const rows = S.rows;
  if (!rows.length || !S.card) return;
  const cam = S.camera;
  const cp = cam.position;
  // camera forward, for the centrality term of the declutter score.
  // getWorldDirection() refreshes the matrix itself — this runs before the
  // world renders, so reading matrixWorld raw would be a frame behind.
  const f = cam.getWorldDirection(S.fwd);
  const fx = f.x, fy = f.y, fz = f.z;
  // the camera's own right/up, so a marker can be placed on the SCREEN rather
  // than merely in the world — that is what the declutter pass needs
  const e = cam.matrixWorld.elements;
  const rx = e[0], ry = e[1], rz = e[2];
  const ux = e[4], uy = e[5], uz = e[6];

  let nearest = null, nearD = Infinity, visible = 0;

  for (const r of rows) {
    // ---- distance to the POI ON THE GROUND (that is the thing you walk to),
    // and to the sign in the sky (that is what sets its on-screen size)
    const dx = cp.x - r.pos[0], dy = cp.y - r.pos[1], dz = cp.z - r.pos[2];
    r.d = Math.sqrt(dx * dx + dy * dy + dz * dz) / S.u;
    const sy = cp.y - r.sky;
    r.ds = Math.sqrt(dx * dx + sy * sy + dz * dz);
    if (r.d < nearD) { nearD = r.d; nearest = r; }

    // where it lands on screen, in radians off the axis: centrality (1 dead
    // ahead, 0 at 90°) plus horizontal and vertical offset, and the angular
    // size the card is about to be drawn at
    const L = r.ds || 1;
    r.dot = (-dx * fx - sy * fy - dz * fz) / L;
    r.sx = (-dx * rx - sy * ry - dz * rz) / L;
    r.sy = (-dx * ux - sy * uy - dz * uz) / L;
    r.aw = Math.min(ANG, S.maxW / L) * tierOf(r.tier).size;
    r.ah = r.aw * (CARD_H / CARD_W);

    // ---- fades. Everything below is a function of distance and time, never
    // of frame count, so a 10 fps headless run and a 240 Hz monitor agree.
    let a = 1;
    if (r.d < AT_R * S.u) a = 0.04;                                  // AT the poi: get out of the way
    else if (r.d < AT_R * 1.8 * S.u) a = 0.04 + 0.96 * ((r.d - AT_R * S.u) / (AT_R * 0.8 * S.u));
    if (r.ds > S.farD) a *= clamp(1 - (r.ds - S.farD) / (0.3 * S.farD), 0, 1);
    r.aCard = a;
    let h = clamp(1 - (r.ds - S.farGone) / (0.45 * S.farGone), 0, 1) * tierOf(r.tier).glow;
    if (r.d < AT_R * S.u) h *= 0.12;
    r.aHalo = h;
    if (a > 0.02 || h > 0.02) visible++;
  }

  // ---- screen-space declutter. Two rules, in this order:
  //   1. at most LIT_MAX signs are fully lit at once, best score first — a
  //      score that rewards being near and dead ahead;
  //   2. a sign that would land ON TOP of one already lit is demoted, tested as
  //      an overlap of the two cards' angular boxes on screen.
  // Everything demoted stays on as a dim beacon: you can still see there is a
  // place over there, you just are not asked to read six cards at once. This is
  // what stops a merged resort's five distant lift stations from stacking into
  // one illegible pile when you look up the valley from the base.
  const score = (r) => r.dot * 900 + tierOf(r.tier).rank - r.ds * 0.55;
  const sorted = rows.slice().sort((p, q) => score(q) - score(p));
  const litRows = S.litRows;
  litRows.length = 0;
  for (const r of sorted) {
    let ok = r.dot > 0.05 && litRows.length < LIT_MAX;
    // specs/0055 §6 — OVERLAPPED is not the same demotion as LIT_MAX. Only the
    // sign that actually landed on top of a lit one loses its board to the
    // wipe; a sign demoted merely because six were already lit is not standing
    // in anybody's way and keeps its name.
    let ov = false;
    if (ok) {
      for (const q of litRows) {
        if (Math.abs(r.sx - q.sx) < 0.5 * (r.aw + q.aw) &&
            Math.abs(r.sy - q.sy) < 0.62 * (r.ah + q.ah)) { ok = false; ov = true; break; }
      }
    }
    r.full = ok; r.overlapped = ov;
    if (ok) litRows.push(r);
  }
  S.lit = litRows.length;

  // ---- how big each card is about to be drawn.
  //
  // Angular-constant sizing. A sign is only useful if you can READ it, so the
  // card is sized to subtend a roughly fixed slice of the screen — about 12° of
  // the horizontal field for a mid-tier one — instead of shrinking with distance
  // like a world-space object. The clamps stop it swallowing the sky underfoot,
  // and let it go back to being a small bright chip a kilometre out, which is the
  // "far = smaller" half of the distance behaviour. A demoted sign also shrinks,
  // so a cluster reads as one card plus a couple of chips rather than three cards
  // fighting for the same patch of sky.
  //
  // This runs BEFORE the aim test, because the aim box is the card's own angular
  // size, and the aim test in turn drives the hover ease below. Size is settled
  // once and reused; hovering brightens a sign, it never resizes it — a card that
  // grew under the crosshair would shove its neighbours around.
  for (const r of rows) {
    // specs/0055 §3.8 — THE SIGN GROWS INSTEAD OF A CARD ARRIVING. Between
    // GROW_FAR and GROW_NEAR the card eases from 1.0x to GROW_MAX and then
    // holds. Smoothstep and not a ramp: the growth has to be invisible as a
    // motion and only legible as a result, and a linear term reads as the sign
    // rushing you at the moment you cross 120 m.
    //
    // It multiplies the ANGULAR size, so it is genuinely "this sign is being
    // read now" and not "this sign is nearer" — the angular-constant rule below
    // has already taken the distance out. The aim box follows it (angW/angH are
    // computed from the grown width), which is right: a sign that has grown for
    // you is an easier fast-travel target, not a harder one.
    const gk = clamp((GROW_FAR - r.ds / S.u) / (GROW_FAR - GROW_NEAR), 0, 1);
    let grow = 1 + (GROW_MAX - 1) * smooth(gk);

    // ...AND IT NEVER GROWS ACROSS THE CROSSHAIR. Greg's second condition on
    // this pick. A sign is allowed to sit under the reticle — that is how fast
    // travel is aimed, and `aimMiss` needs the crosshair INSIDE the card box —
    // so the rule cannot be "never covers the axis". It is the narrower one that
    // actually matches the complaint: GROWTH MAY NOT BE WHAT PUTS IT THERE.
    //
    // The ungrown card is clear of the axis when |sx| > angW0/2 or |sy| >
    // angH0/2, so the largest scale that keeps that true is
    // max(2|sx|/angW0, 2|sy|/angH0). Floor it at 1: when the card already covers
    // the crosshair the sign simply stops growing and holds its natural size —
    // it never SHRINKS, which would be the reticle pushing the world around.
    const w0 = clamp(r.ds * ANG, 14 * S.u, S.maxW) * tierOf(r.tier).size * (r.full ? 1 : 0.42);
    const aw0 = w0 / (r.ds || 1), ah0 = aw0 * (CARD_H / CARD_W);
    if (grow > 1 && aw0 > 0 && ah0 > 0) {
      const room = Math.max(2 * Math.abs(r.sx) / aw0, 2 * Math.abs(r.sy) / ah0);
      grow = clamp(Math.min(grow, room), 1, GROW_MAX);
    }
    r.grow = grow;
    r.w = w0 * grow;
    r.h = r.w * (CARD_H / CARD_W);
    r.angW = r.w / (r.ds || 1);
    r.angH = r.h / (r.ds || 1);

    // specs/0055 §6 — the WIPE cursor. Distance and dt only, never frame count,
    // exactly like the fades above, so a headless 10 fps run and a 240 Hz
    // monitor agree about how long an arrival takes.
    const pf = r.plateFrac;
    const inR = r.ds <= S.farD;
    if (inR && r.wasIn === false) r.wipe = 0;        // ARRIVE: re-arm the wipe
    r.wasIn = inR;
    const want = r.overlapped ? pf : 1;
    if (r.wipe < want) {
      const rate = r.wipe < pf ? pf / WIPE_PLATE_T : (1 - pf) / WIPE_BOARD_T;
      r.wipe = Math.min(want, r.wipe + rate * dt);
    } else if (r.wipe > want) {
      r.wipe = Math.max(want, r.wipe - ((1 - pf) / WIPE_FALL_T) * dt);
    }
  }

  // ---- what the crosshair is on, and whether a ridge is in the way
  tickAim(dt, !devOn && travelLive());
  tickHover();

  // ---- write the instance attributes
  const gc = S.card.geometry, gh = S.halo.geometry;
  const aA = gc.getAttribute('aAlpha'), aS = gc.getAttribute('aScale'), aL = gc.getAttribute('aLift');
  const aW = gc.getAttribute('aWipe');
  const hA = gh.getAttribute('aAlpha'), hS = gh.getAttribute('aScale'), hL = gh.getAttribute('aLift');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const bob = Math.sin(S.t * 0.55 + r.phase) * 1.0 * S.u;
    const pulse = 0.86 + 0.14 * Math.sin(S.t * 0.9 + r.phase * 1.7);
    const w = r.w, h = r.h;

    // ---- the brightness stack, dimmest term first. Each layer survives the one
    // over it, which is what keeps every earlier behaviour intact:
    //   aCard  the distance / far-chip / AT-the-poi fade — at 25 m this is 0.04
    //          and nothing below can rescue it, so standing on a place still
    //          clears its sign out of the view;
    //   dim    declutter demotion, so a resting demoted sign is dimmer than a
    //          resting lit one;
    //   rest   the resting floor, lifted to 1 by hover.
    // Hover lifts the demotion too: putting the crosshair on a sign is an
    // explicit statement of interest, and answering it with 45 % of half is a
    // sign that looks broken rather than chosen.
    const hv = smooth(r.hov || 0);
    const dim = r.full ? 1 : 0.45;
    const hdim = r.full ? 1 : 0.55;
    const ca = r.aCard * (dim + (1 - dim) * hv) * (REST_CARD + (1 - REST_CARD) * hv);
    const ha = r.aHalo * pulse * (hdim + (1 - hdim) * hv) * (REST_HALO + (1 - REST_HALO) * hv);
    const hw = w * (r.full ? 1.7 : 1.95) * pulse;
    r.aDraw = ca; r.hDraw = ha;

    // specs/0055 §3.6 — THE SUPPRESSION IS APPLIED TO THE WRITTEN ALPHA ONLY,
    // deliberately AFTER `r.aDraw = ca` above. A mid-tier card standing over a
    // fork now has a physical post stack under it carrying the same run names,
    // so its billboard draws at zero — but `aimedAt` reads `r.aDraw` against
    // AIM_MIN_A, and `tickAim` runs one block EARLIER in this same frame, so
    // zeroing `ca` itself would make a suppressed sign untargetable and break
    // fast travel to it. §3.6 asks for exactly the opposite: "alpha 0, halo
    // kept, aimedAt kept". `hA` below is untouched for the same reason.
    const cw = r.forkHidden ? 0 : ca;
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      aS.array[j * 2] = w; aS.array[j * 2 + 1] = h;
      aA.array[j] = cw; aL.array[j] = bob; aW.array[j] = r.wipe;
      hS.array[j * 2] = hw; hS.array[j * 2 + 1] = hw;
      hA.array[j] = ha; hL.array[j] = bob + h * 0.06;
    }
  }
  aA.needsUpdate = aS.needsUpdate = aL.needsUpdate = aW.needsUpdate = true;
  hA.needsUpdate = hS.needsUpdate = hL.needsUpdate = true;

  S.nearest = nearest; S.visible = visible;

  // ---- the approach card
  if (devOn) { if (S.intro) hideIntro(); return; }        // dev mode: fly, do not narrate
  // The card belongs to the nearest UNSEEN poi inside the approach radius — not
  // to `nearest`, or standing next to one place you have already met would mute
  // the introduction to the one you are actually walking toward.
  let cand = null;
  for (const r of rows) {
    if (r.d > RESET_R * S.u) r.introShown = false;        // properly left — re-arm
    if (r.introShown || r.d > INTRO_R * S.u) continue;
    if (!cand || r.d < cand.d) cand = r;
  }
  if (!S.intro && cand) showIntro(cand);
}

// ===========================================================================
// fast travel — aim at a sign, press T, be there
// ===========================================================================
//
// The aim test is angular, against the card the shader actually drew: `r.sx` and
// `r.sy` are already the sign's offset from the view axis along the camera's own
// right/up (computed for the declutter pass), and `r.angW/angH` are the drawn
// card's angular size. A hit is "inside the card, padded and then capped".
//
// When two signs overlap on screen, the offer goes to the one the crosshair is
// most deeply inside, measured as a fraction of that sign's OWN box (aimMiss) so
// big cards and demoted chips are judged the same way; a genuine tie goes to the
// nearer sign. Picking purely by nearness — which is what this first did — hands
// the offer to whichever sign happens to be closest among all the ones whose
// generous padded box the crosshair grazes, so aiming squarely at a far venue lit
// a near lift station instead, and the hover ease went with it.
//
// Occlusion. The signs are depth-tested now, so a sign behind a ridge is not on
// the screen — and something you cannot see must not be something you can travel
// to. The GPU's answer is not readable from here at a sane cost, so this walks
// the ground profile along the camera→sign line and asks whether the world's
// topmost surface ever rises above the ray. That is the same question the depth
// buffer answered, asked of the collider instead of the framebuffer, and it is
// the case Greg described: a ridge standing between you and the sign.

// Is this sign a target at all, and if so how well is the crosshair on it?
//
// ELIGIBILITY is the padded, capped box, exactly as before — that pad is what
// makes a card only 4.5° tall a comfortable thing to point at.
//
// RANKING is a separate question and is measured against the sign's OWN DRAWN
// CARD: 0 dead centre, 1 on the card's edge, above 1 out in the padding. Two
// normalisations matter here. Against the card rather than the box, so a sign the
// crosshair is genuinely ON always out-ranks one it is merely in the padding of —
// the vertical pad is 2× and would otherwise let a sign 4° above the crosshair
// look better placed than the one under it. And against each sign's own size, so
// a 1.30 major card and a 0.42 demoted chip compete on "is the crosshair on this
// sign" rather than on which of them is bigger.
function aimMiss(r) {
  if (!(r.aCard > AIM_MIN_A)) return Infinity;
  if (!(r.dot > AIM_MIN_DOT)) return Infinity;
  if (!isFinite(r.angW) || !isFinite(r.angH)) return Infinity;
  if (!(r.angW > 0) || !(r.angH > 0)) return Infinity;
  const hw = Math.min(0.5 * r.angW * AIM_PAD_H, AIM_MAX_H);
  const hh = Math.min(0.5 * r.angH * AIM_PAD_V, AIM_MAX_V);
  if (Math.abs(r.sx) > hw || Math.abs(r.sy) > hh) return Infinity;
  return Math.max(Math.abs(r.sx) / (0.5 * r.angW), Math.abs(r.sy) / (0.5 * r.angH));
}

// aimMiss's eligibility WITHOUT its crosshair box: is this sign drawn, in front
// of you, and a real size on the screen? The box is the one gate the touch path
// cannot borrow — a tap names a sign the crosshair is nowhere near — so this is
// what is left of it, and it is also the test that ends a tap's hold: a sign that
// has faded out, gone behind you or scrolled off is no longer being offered.
function aimLive(r) {
  return r.aCard > AIM_MIN_A && r.dot > AIM_MIN_DOT
    && isFinite(r.angW) && isFinite(r.angH) && r.angW > 0 && r.angH > 0;
}

// What is under this point of the glass — the tap's answer to "which sign".
//
// Screen space, CSS px, against the card the shader ACTUALLY DREW, and it reuses
// the numbers step() already worked out this frame (`r.angW/angH`, `r.ds`): there
// is no second projection pass over the world, only one Vector3.project per row,
// and only on a tap. Nothing here runs per frame.
//
// The box is the crosshair's box restated in pixels: the card's own angular size
// times the focal length, padded by AIM_PAD_H/V and capped by AIM_MAX_H/V exactly
// as aimMiss pads and caps, then floored at TOUCH_MIN_PX so a chip stays hittable.
// Ranking is aimMiss's too — deepest inside its OWN card wins, and only a true tie
// falls through to the nearer sign — so a tap and the crosshair disagree about
// nothing except where the pointer is.
export function signAt(px, py) {
  try {
    if (!S.ok || !S.rows.length || !S.camera || !S.THREE) return null;
    // everything the T key refuses, the gesture refuses: paused, gear, locker, fly
    if (!travelLive()) return null;
    const f = 0.5 * innerHeight / Math.tan(0.5 * (S.camera.fov || 60) * Math.PI / 180);
    let best = null, bestM = Infinity;
    for (const r of S.rows) {
      if (!aimLive(r)) continue;
      const v = new S.THREE.Vector3(r.pos[0], r.sky, r.pos[2]).project(S.camera);
      if (!(v.z <= 1)) continue;                       // behind the camera
      const cx = (v.x + 1) / 2 * innerWidth, cy = (1 - v.y) / 2 * innerHeight;
      const cw = 0.5 * r.angW * f, ch = 0.5 * r.angH * f;     // half the drawn card
      const hx = Math.max(Math.min(cw * AIM_PAD_H, AIM_MAX_H * f), TOUCH_MIN_PX / 2);
      const hy = Math.max(Math.min(ch * AIM_PAD_V, AIM_MAX_V * f), TOUCH_MIN_PX / 2);
      const dx = Math.abs(px - cx), dy = Math.abs(py - cy);
      if (dx > hx || dy > hy) continue;
      const m = Math.max(dx / cw, dy / ch);
      if (m < bestM - 1e-4) { best = r; bestM = m; }
      else if (best && m <= bestM + 1e-4 && r.ds < best.ds) { best = r; bestM = m; }
    }
    if (!best) return null;
    // A sign behind a ridge is not on the screen, so a finger cannot be on it —
    // the tap falls through to whatever a tap on empty snow does. One probe, on
    // the winner only, which is the same cost tickAim pays on a crosshair change.
    if (occluded(best)) return null;
    return { id: best.id, name: best.name };
  } catch { S.errors++; return null; }
}

function occluded(r) {
  const col = S.collision;
  if (!col || !col.groundAt || !col.bounds) return false;   // no collider: nothing to hide behind
  try {
    const cp = S.camera.position;
    const ex = r.pos[0] - cp.x, ey = r.sky - cp.y, ez = r.pos[2] - cp.z;
    const top = col.bounds.maxY + 5 * S.u;
    const bias = 0.5 * S.u;
    for (let i = 1; i < OCC_STEPS; i++) {
      const f = i / OCC_STEPS;
      const g = col.groundAt(cp.x + ex * f, cp.z + ez * f, top);
      if (g === null || g === undefined || !isFinite(g)) continue;   // outside the grid
      if (g > cp.y + ey * f + bias) return true;
    }
  } catch { S.errors++; }
  return false;
}

// run every frame off the cheap angular test; re-probe occlusion on a timer, or
// straight away when the sign under the crosshair changes
function tickAim(dt, live) {
  if (!live) { setAim(null); return; }
  // A TAPPED sign holds the offer for TOUCH_AIM_MS (touchAim). The finger is not
  // the crosshair, so without this the loop below would take the offer straight
  // back on the very next frame and the second tap of a double would have nothing
  // to travel to. The hold ends the instant the sign stops being a target at all —
  // faded, behind you, scrolled off — and occlusion keeps re-probing on its own
  // timer underneath it, so a ridge sliding in front of an armed sign still mutes
  // the offer. On every other frame this costs one compare against 0.
  if (S.aimHold) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now < S.aimHold && S.aim && aimLive(S.aim)) {
      S.aimT += dt;
      if (S.aimT >= AIM_HZ) { S.aimT = 0; S.aimBlocked = occluded(S.aim); }
      setAim(S.aimBlocked ? null : S.aim);
      return;
    }
    S.aimHold = 0;
  }
  let best = null, bestM = Infinity;
  for (const r of S.rows) {
    const m = aimMiss(r);
    if (m === Infinity) continue;
    // Most-centred wins. Only a true tie — the crosshair equally deep inside two
    // boxes — falls through to "nearest", which is still what keeps a distant peak
    // from taking the offer off the lift station standing in front of it.
    if (m < bestM - 1e-4) { best = r; bestM = m; }
    else if (best && m <= bestM + 1e-4 && r.ds < best.ds) { best = r; bestM = m; }
  }
  // Hold the offer on the sign that already has it unless the challenger is
  // clearly more centred — but never while the current one is blocked, or a sign
  // behind a ridge would sit on the offer and mute the one you can actually see.
  if (best && S.aim && !S.aimBlocked && best !== S.aim) {
    const cur = aimMiss(S.aim);
    if (cur !== Infinity && bestM > cur - AIM_STICK) { best = S.aim; bestM = cur; }
  }
  if (best !== S.aim) { S.aim = best; S.aimT = 0; S.aimBlocked = best ? occluded(best) : false; }
  else if (best) {
    S.aimT += dt;
    if (S.aimT >= AIM_HZ) { S.aimT = 0; S.aimBlocked = occluded(best); }
  }
  setAim(S.aimBlocked ? null : best);
}

// Ease every sign's hover weight toward where the crosshair says it should be.
//
// Wall clock, not dt — same lesson the teleport flash taught: dt is clamped to
// 50 ms a frame, so on a slow world a dt-driven 150 ms ease would take most of a
// second. A rate ramp rather than a timestamp so it is interruptible: glance
// away halfway up and it falls from halfway, it does not snap or restart.
function tickHover() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wdt = clamp((now - (S.hoverWall || now)) / 1000, 0, 0.25);
  S.hoverWall = now;
  const on = (S.aim && !S.aimBlocked) ? S.aim : null;
  for (const r of S.rows) {
    if (r.hov === undefined) r.hov = 0;
    const want = r === on ? 1 : 0;
    if (r.hov === want) continue;
    const up = want > r.hov;
    const k = r.hov + (up ? 1 : -1) * (wdt / (up ? HOVER_IN : HOVER_OUT));
    r.hov = up ? Math.min(1, k) : Math.max(0, k);
  }
}

function setAim(r) {
  const el = S.aimEl;
  if (!el) return;
  if (!r) { el.classList.remove('is-on'); el.classList.remove('is-hit'); return; }
  if (S.aimNameEl.textContent !== r.name) {
    S.aimNameEl.textContent = r.name;
    // specs/0055 §3.9, §1.7 — the prompt is tinted by the target's own kind, and
    // by `KINDS[kind].plate` rather than `.glow`: `plate` is the flat kind colour
    // the sign's own icon plate is painted in, so the key cap under the crosshair
    // and the plate on the board being aimed at are literally the same value.
    // `.glow` is the halo's additive tint, which is a lighter wash of the same
    // hue and reads as a THIRD colour once it sits next to the board.
    const plate = kindOf(r.kind).plate;
    el.style.setProperty('--pmk-accent', plate);
    // specs/0055 §3.9 (Greg 2026-09-06) — and the glyph's ink alongside it, so
    // the key cap is legible on every plate instead of only the light ones.
    el.style.setProperty('--pmk-ink', plateInk(plate));
    // ...and the name's own fill, which keeps the accent wherever the accent is
    // legible unsurfaced and only falls to cream where it is the ink itself.
    el.style.setProperty('--pmk-name', plateName(plate));
    el.classList.remove('is-hit');
  }
  el.classList.add('is-on');
}

// specs/0055 §3.9 / §6 — SNAP, 90 ms, on the KEY. The one animation in this
// prompt, and it fires on the press rather than on the arrival, so the game has
// answered the keystroke before the teleport flash starts.
function aimHit() {
  const el = S.aimEl;
  if (!el || !el.classList.contains('is-on')) return;
  el.classList.remove('is-hit');
  void el.offsetWidth;                 // restart the animation on a repeat press
  el.classList.add('is-hit');
}

// Take the offer to a sign a finger has landed on, and hold it there for a beat.
// Everything downstream — the prompt chip, the hover ease, fastTravel() with no
// argument, the hud line on arrival — reads S.aim and cannot tell a tap from a
// crosshair, which is the point: the gesture adds a way to NAME a sign, not a
// second fast-travel path. signAt has already refused an occluded sign, so the
// offer starts unblocked; tickAim's timer re-checks that for as long as it stands.
export function touchAim(id) {
  try {
    if (!S.ok || !S.rows.length) return null;
    const r = S.rows.find((q) => q.id === id || q.name === id);
    if (!r) return null;
    S.aim = r; S.aimT = 0; S.aimBlocked = false;
    S.aimHold = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + TOUCH_AIM_MS;
    setAim(r);
    return { id: r.id, name: r.name, ms: TOUCH_AIM_MS };
  } catch { S.errors++; return null; }
}

// what the crosshair is offering right now, or null
export function aimedAt() {
  const r = (S.aim && !S.aimBlocked) ? S.aim : null;
  if (!r) return null;
  return {
    id: r.id, name: r.name, kind: r.kind, tier: r.tier,
    d: +(r.d || 0).toFixed(1), ds: +(r.ds || 0).toFixed(1),
    offAxisDeg: +(Math.hypot(r.sx, r.sy) * 180 / Math.PI).toFixed(2),
    blocked: false,
  };
}

// the same widening probe lift.js steps off a chair with: trust the triangles,
// not the declared y, and never drop anybody through the floor
function groundY(x, z, hintY) {
  const col = S.collision;
  if (!col || !col.groundAt) return hintY;
  try {
    for (const up of [2.5, 12, 45]) {
      const g = col.groundAt(x, z, hintY + up * S.u);
      if (g !== null && g !== undefined && isFinite(g)) return g;
    }
    const g = col.groundAt(x, z, col.bounds.maxY + 5 * S.u);
    if (g !== null && g !== undefined && isFinite(g)) return g;
  } catch { S.errors++; }
  return hintY;
}

// three.js forward is -Z and the controller reads yaw as (-sin, -cos) — the same
// conversion lift.js uses to face you back down the line
const yawToward = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

// ---- specs/0028 §2: THE NAME PEOPLE TYPE.
//
// The rows carry two spellings of every place — an id (`base-area`) and a
// display name shouted in caps (`THE VILLAGE`) — and a driver at a console types
// neither. `fastTravel('the-village')` used to return null, which is a silent
// no-op that reads exactly like a broken teleport; it was the third wrong guess
// of one night's headless debugging.
//
// So the id and the name are BOTH slugified — lower-cased, every run of
// non-alphanumerics collapsed to one `-`, ends trimmed — and the typed string is
// slugified the same way before it is compared. `the-village`, `The Village`,
// `kt22` and `KT-22` all land. This is the same normalisation spawn.js's
// `?spawn=` already runs, deliberately: two ways of naming the same mountain
// that disagree about spelling are worse than one that is merely strict.
//
// An exact id or name still wins outright, so nothing that resolved before can
// be stolen by a slug collision.
const mkSlug = (s) => String(s == null ? '' : s)
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

function rowNamed(id) {
  const exact = S.rows.find((q) => q.id === id || q.name === id);
  if (exact) return exact;
  const want = mkSlug(id);
  if (!want) return null;
  const hits = S.rows.filter((q) => mkSlug(q.id) === want || mkSlug(q.name) === want);
  if (!hits.length) return null;
  // ROW ORDER DECIDES, and it says so out loud. Two places whose names slugify
  // to the same string is a world-authoring problem, not a caller's — picking
  // silently would hide it, and throwing would break a link that used to work.
  if (hits.length > 1) {
    try {
      console.warn(`[markers] fastTravel('${id}') is ambiguous — `
        + `${hits.map((q) => `${q.id} ("${q.name}")`).join(', ')}; taking ${hits[0].id}`);
    } catch { S.errors++; }
  }
  return hits[0];
}

// The whole feature. Lands TRAVEL_OFF metres short of the anchor on the side you
// came from, on the real floor, looking at the place — so you arrive seeing the
// thing you asked for rather than standing in the middle of it.
export function fastTravel(id) {
  try {
    if (!S.ok || !S.rows.length || !S.ctrl || !S.ctrl.teleport || !S.THREE) return null;
    const r = id ? rowNamed(id)
                 : ((S.aim && !S.aimBlocked) ? S.aim : null);
    if (!r) return null;

    const p = S.ctrl.position;
    let ox = p.x - r.pos[0], oz = p.z - r.pos[2];
    let m = Math.hypot(ox, oz);
    if (!(m > 1e-3)) { ox = 0; oz = 1; m = 1; }      // standing on it: step off south
    const off = TRAVEL_OFF * S.u;
    const hint = (r.ground !== undefined && r.ground !== null && isFinite(r.ground)) ? r.ground : r.pos[1];
    const th0 = Math.atan2(oz / m, ox / m);

    // The side you came from is the first choice — you arrive looking the way you
    // were already looking. But a temple on a shelf has an edge, and three metres
    // the wrong way off it is a fall, not an arrival. So walk the offsets round
    // the anchor and take the first whose floor is on the anchor's own level.
    let x = r.pos[0] + Math.cos(th0) * off, z = r.pos[2] + Math.sin(th0) * off;
    let y = groundY(x, z, hint), bestErr = Math.abs(y - hint);
    if (bestErr > LAND_TOL * S.u) {
      for (let k = 1; k < 8; k++) {
        const th = th0 + (k * Math.PI * 2) / 8;
        const tx = r.pos[0] + Math.cos(th) * off, tz = r.pos[2] + Math.sin(th) * off;
        const ty = groundY(tx, tz, hint);
        const err = Math.abs(ty - hint);
        if (err < bestErr) { x = tx; z = tz; y = ty; bestErr = err; }
        if (bestErr <= LAND_TOL * S.u) break;
      }
    }
    // FACING. By default you arrive looking AT the thing you asked for, which is
    // right for a sign on a knoll and wrong for a drop-in: T on The Nose landed
    // you 3 m off the dot looking 1.3 deg — twenty degrees off the Fingers and
    // level with the horizon. A waypoint that declares a heading in
    // WAYPOINT_SPAWNS gets that heading here too, so the URL spawn and the fast
    // travel cannot arrive facing two different ways. Same table, both callers.
    const W = WAYPOINT_SPAWNS[r.id] || null;
    const yaw = (W && Number.isFinite(W.yawDeg)) ? (W.yawDeg * Math.PI) / 180
                                                 : yawToward(x, z, r.pos[0], r.pos[2]);

    const from = { x: p.x, y: p.y, z: p.z };
    S.ctrl.teleport(new S.THREE.Vector3(x, y, z), yaw);
    if (W && Number.isFinite(W.pitchDeg) && S.ctrl.setPitch) {
      try { S.ctrl.setPitch((W.pitchDeg * Math.PI) / 180); } catch { S.errors++; }
    }
    // specs/0055 §3.10 — dress the flash in the DESTINATION's board before it
    // is shown, never after: paintFlash() runs on the same tick and a board
    // that acquires its name a frame late is a board that flickers empty.
    setFlashSign(r);
    S.flash = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + FLASH_MS;
    paintFlash();
    S.travels++;
    // arriving IS the introduction — let the approach card play again here
    r.introShown = false;
    hideIntro();
    S.aim = null; S.aimBlocked = false; setAim(null);
    S.lastTravel = {
      id: r.id, name: r.name, from, to: { x, y, z }, yaw,
      gear: (S.ctrl && S.ctrl.mode) || null,
    };
    if (S.hud && S.hud.flash) { try { S.hud.flash(String(r.name).toLowerCase()); } catch { S.errors++; } }
    return S.lastTravel;
  } catch { S.errors++; return null; }
}

// specs/0055 §3.10 — the flash carries the DESTINATION's board. One variable
// (§3.9): the mounting rule takes the kind's signature colour. The pictogram is
// the very icon plate the approach card and the atlas already hand out, so a
// place looks the same wherever it speaks, and the name is the row's own.
// Nothing here chooses a colour.
function setFlashSign(row) {
  const sg = S.flashSignEl;
  if (!sg || !row) return;
  sg.style.setProperty('--pmk-flash-rule', kindOf(row.kind).glow);
  if (S.flashIcoEl) S.flashIcoEl.style.backgroundImage = `url(${iconUrl(row)})`;
  if (S.flashNameEl) S.flashNameEl.textContent = row.name;
}

// The arrival, on the picked cell's clock (FLASH_IN/WIPE/HOLD/OUT above).
// S.flash is the wall-clock instant the whole thing ends, so `t` is how far
// into the 800 ms we are. The white CUTs up, the board WIPEs on from
// screen-left behind it, both hold, and both FALL together — one arrival, no
// loop, and nothing blurs, shakes or splits (0048 removed that vocabulary).
function paintFlash() {
  const el = S.flashEl;
  const sg = S.flashSignEl;
  if (!el) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const left = S.flash - now;
  if (left <= 0) {
    S.flash = 0; el.style.display = 'none'; el.style.opacity = '0';
    if (sg) sg.style.clipPath = 'inset(0 100% 0 0)';
    return;
  }
  const t = FLASH_MS - left;                       // ms since the teleport
  const up = clamp(t / FLASH_IN, 0, 1);            // CUT
  const down = clamp(left / FLASH_OUT, 0, 1);      // FALL, linear (§1.11)
  // 'block', NOT '': the stylesheet rule under this element is `display: none`,
  // so clearing the inline value hands the element straight back to it. That is
  // a real defect this panel inherited — the flash has been setting display to
  // the empty string and computing to none, which is why every headless shot of
  // `teleport-flash` in the inventory pass is a frame of plain mountain.
  el.style.display = 'block';
  el.style.opacity = String(+(FLASH_PEAK * Math.min(up, down)).toFixed(3));
  if (sg) {
    const w = smooth(clamp((t - FLASH_IN) / FLASH_WIPE, 0, 1));
    sg.style.clipPath = `inset(0 ${(100 * (1 - w)).toFixed(1)}% 0 0)`;
  }
}

const typingIn = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// Everything that owns the keyboard ahead of us: the fly camera, the pause
// panel, the gear menu, the locker. Same order main.js gates F (ride the lift).
function travelLive() {
  try {
    if (!S.ok || !S.rows.length) return false;
    const P = window.__player;
    if (P && P.devMode && P.devMode()) return false;
    if (S.hud && S.hud.isPaused && S.hud.isPaused()) return false;
    if (S.hud && S.hud.gearOpen && S.hud.gearOpen()) return false;
    if (P && P.inventoryOpen && P.inventoryOpen()) return false;
  } catch { return false; }
  return true;
}

function wireKeys() {
  if (S.wired) return;
  S.wired = true;
  addEventListener('keydown', (e) => {
    try {
      if (e.code !== TRAVEL_KEY) return;
      if (e.repeat) return;                 // one teleport per keypress, not per repeat
      if (typingIn(e.target)) return;       // the dev note field
      if (!travelLive()) return;
      if (!S.aim || S.aimBlocked) return;   // nothing under the crosshair
      aimHit();                             // specs/0055 §3.9 — SNAP on the key
      fastTravel();
      e.preventDefault();
    } catch { S.errors++; }
  });
}

// ===========================================================================
// public
// ===========================================================================

export function init(ctx) {
  try {
    if (S.ok || !ctx) return;
    S.THREE = ctx.THREE; S.scene = ctx.scene; S.camera = ctx.camera;
    S.ctrl = ctx.ctrl; S.hud = ctx.hud; S.collision = ctx.collision || null;
    S.poi = ctx.poi || ''; S.run = ctx.run || '';
    if (!S.THREE || !S.scene || !S.camera) return;
    S.u = (S.ctrl && S.ctrl.T && S.ctrl.T.eyeHeight) ? S.ctrl.T.eyeHeight / 1.70 : 1;
    S.fwd = new S.THREE.Vector3();

    let rows = [];
    if (Array.isArray(ctx.markers) && ctx.markers.length) {
      rows = fromContract(ctx.markers, ctx.upAxis === 'z' ? 'z' : 'y');
      S.source = 'contract';
    }
    if (!rows.length) {
      S.key = regKey(ctx);
      if (S.key) { rows = fromRegistry(S.key); S.source = 'registry'; }
    }
    S.rows = rows;
    if (!rows.length) { S.ok = true; return; }   // no markers: mounted, inert, silent

    mountDom();
    farRange();
    S.settled = settle(rows);
    S.forkHidden = markForks(ctx);
    build(S.THREE, rows);
    wireKeys();
    S.ok = true;
  } catch { S.errors++; }
}

export function update(dt) {
  if (!S.ok) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    if (!S.rows.length) return;
    // the teleport flash runs on the wall clock — it must finish on time even if
    // the player hits pause on the frame after arriving, or the world renders at
    // six frames a second
    if (S.flash > 0) paintFlash();
    const paused = S.hud && S.hud.isPaused && S.hud.isPaused();
    let devOn = false;
    try { devOn = !!(window.__player && window.__player.devMode && window.__player.devMode()); } catch { devOn = false; }
    if (paused && !devOn) { setAim(null); S.aim = null; tickIntro(dt); return; }
    S.t += dt;
    step(dt, devOn);
    tickIntro(dt);
  } catch { S.errors++; }
}

export function stats() {
  const n = S.nearest;
  return {
    ok: S.ok, poi: S.key || '', source: S.source, errors: S.errors,
    count: S.rows.length,
    visible: S.visible,
    lit: S.lit,
    settled: S.settled, far: Math.round(S.farD), draws: S.card ? 2 : 0,
    // signs are depth-tested against the world now; these say so out loud so a
    // regression that puts them back on top of the mountain is one assert away
    depthTest: !!(S.card && S.card.material && S.card.material.depthTest),
    depthWrite: !!(S.card && S.card.material && S.card.material.depthWrite),
    haloDepthTest: !!(S.halo && S.halo.material && S.halo.material.depthTest),
    tiers: { major: TIERS.major.h, mid: TIERS.mid.h, minor: TIERS.minor.h },
    raised: S.rows.filter((r) => r.raise > 0).length,
    travelKey: TRAVEL_KEY, travels: S.travels,
    // signs rest at REST_CARD and ease to full under the crosshair
    rest: { card: REST_CARD, halo: REST_HALO, inMs: HOVER_IN * 1000, outMs: HOVER_OUT * 1000 },
    hovered: (() => { const r = S.rows.find((q) => (q.hov || 0) > 0.999); return r ? r.id : null; })(),
    aim: aimedAt(),
    nearest: n ? { id: n.id, name: n.name, kind: n.kind, d: +n.d.toFixed(1) } : null,
    intro: S.intro ? { id: S.intro.row.id, phase: S.intro.phase } : null,
  };
}

// ---------------------------------------------------------------- test hooks
const _test = {
  stats,
  // specs/0055 §8 P1 — the fork centres the world derived and the plates it
  // actually stood up, read off the BUILT scene rather than re-derived from
  // `RUNS` by the gate. A gate that recomputes the answer only proves the gate
  // agrees with itself; this proves the world was built. `forkHidden` is §3.6's
  // count, so P1 and the suppression it drives are one read.
  forks: () => {
    try {
      const out = { centres: S.scene.userData.forkCentres || null, plates: [], hidden: S.forkHidden || 0 };
      S.scene.traverse((o) => {
        if (o && typeof o.name === 'string' && o.name.indexOf('sign-stack-') === 0) {
          out.plates.push({ name: o.name,
            pos: [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)] });
        }
      });
      return out;
    } catch { return null; }
  },
  list: () => S.rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, tier: r.tier,
    pos: r.pos.slice(), sky: r.sky, ground: r.ground === undefined ? null : r.ground,
    // the doubled tier height, plus whatever the clearance probe had to add, plus
    // how much daylight is actually under the sign in its own column
    h: +(r.sky - r.pos[1]).toFixed(1),
    top: r.top === undefined ? null : r.top,
    raise: r.raise === undefined ? 0 : r.raise,
    airGap: (r.top === undefined || r.top === null) ? null : +(r.sky - r.top).toFixed(1),
    // hov is the raw 0..1 ease; drawn/drawnHalo are the alphas actually written
    // into the buffers this frame — resting, hovered, demoted, at-poi and all
    hov: r.hov === undefined ? 0 : +r.hov.toFixed(3),
    drawn: r.aDraw === undefined ? null : +r.aDraw.toFixed(4),
    drawnHalo: r.hDraw === undefined ? null : +r.hDraw.toFixed(4),
    angW: r.angW === undefined ? null : +r.angW.toFixed(4),
    sx: r.sx === undefined ? null : +r.sx.toFixed(4),
    sy: r.sy === undefined ? null : +r.sy.toFixed(4),
    d: r.d === undefined ? null : +r.d.toFixed(1),
    card: r.aCard === undefined ? null : +r.aCard.toFixed(3),
    halo: r.aHalo === undefined ? null : +r.aHalo.toFixed(3),
    full: !!r.full, introShown: !!r.introShown,
  })),
  // specs/0055 §8 P2 (as built, 2026-09-06) — what a BOARD name is actually
  // drawn at. It calls the shipped `fitFont` with the shipped `BLADE` metrics
  // rather than a gate's copy of them, for the same reason `signs.mjs` exports
  // `trailBoardFit`: a gate that re-derives the answer only proves it agrees
  // with itself. `w` is the OBLIQUE width — `measureText` reports the metric box
  // while a 12° skew occupies `SKEW · cap` more picture (§3.5), and the tracking
  // canvas applies lands after the final glyph too, so both corrections are
  // taken here exactly as `fitFont` takes them.
  fit: (name, tier) => {
    const M = bladeOf(tier);
    const c = mkCanvas(CARD_W, CARD_H);
    const g = c.getContext('2d');
    const s = String(name).toUpperCase();
    const tw = M.w - M.plate - M.pad * 2;
    const px = fitFont(g, s, tw, M.name, hudType.weight, hudType.family, FIT_CARD);
    const w = obliqueW(g.measureText(s).width - hudType.track * px, px);
    g.letterSpacing = '0px';
    return { name: s, tier: tier === 'minor' ? 'minor' : 'major/mid', px,
      cap: +capOf(px).toFixed(2), w: +w.toFixed(2), maxW: tw, clipped: w > tw + 0.5 };
  },
  row: (id) => S.rows.find((r) => r.id === id) || null,
  alpha: (id) => { const r = S.rows.find((q) => q.id === id); return r ? r.aCard : null; },
  // what actually reached the buffer: card alpha, halo alpha, hover ease
  drawn: (id) => {
    const r = S.rows.find((q) => q.id === id);
    return r ? { card: r.aDraw, halo: r.hDraw, hov: r.hov || 0, full: !!r.full } : null;
  },
  introEl: () => (S.cardEl && S.cardEl.style.display !== 'none' ? {
    opacity: +(S.cardEl.style.opacity || 0),
    // specs/0055 §3.8 — kind and line are no longer rendered by this panel;
    // the probe reports what the card actually carries.
    name: S.nameEl.textContent,
    phase: S.intro ? S.intro.phase : 'gone',
  } : null),
  forceIntro: (id) => { const r = S.rows.find((q) => q.id === id); if (r) showIntro(r); return !!r; },
  clearIntro: () => hideIntro(),
  rearm: () => { for (const r of S.rows) r.introShown = false; hideIntro(); },
  draws: () => (S.card ? 2 : 0),
  // hide both meshes without tearing anything down — a pixel test needs the same
  // frame with and without the signs to say "this box changed because of them"
  setVisible: (v) => { if (S.group) S.group.visible = !!v; return !!(S.group && S.group.visible); },
  // Read, or temporarily un-set, the depth test on both meshes. Exists so a
  // regression test can photograph the same camera pose with the signs occluded
  // and with them painted over the mountain — the bug this replaced.
  depthTest: (v) => {
    for (const m of [S.card, S.halo]) {
      if (!m) continue;
      if (v !== undefined) { m.material.depthTest = !!v; m.material.needsUpdate = true; }
    }
    return !!(S.card && S.card.material.depthTest);
  },
  // ---- fast travel
  aim: aimedAt,
  travel: fastTravel,
  travels: () => S.travels,
  lastTravel: () => S.lastTravel,
  travelKey: () => TRAVEL_KEY,
  // is a ridge between the camera and this sign right now? the aim gate's answer
  occluded: (id) => { const r = S.rows.find((q) => q.id === id); return r ? occluded(r) : null; },
  // Where this sign's quad lands on screen, in CSS pixels — the box the depth
  // test either lets through or does not. Rebuilt the way the shader builds it:
  // the centre goes to view space, the corners are offset THERE, and only then
  // is the projection applied. Exists so an occlusion test can sample the exact
  // pixels the card would occupy rather than guessing at the middle of the screen.
  quadOf: (id) => {
    const r = S.rows.find((q) => q.id === id);
    if (!r || !S.camera || !S.THREE || r.angW === undefined) return null;
    const T = S.THREE;
    const c = new T.Vector3(r.pos[0], r.sky, r.pos[2]).applyMatrix4(S.camera.matrixWorldInverse);
    const w = r.angW * (r.ds || 0), h = r.angH * (r.ds || 0);
    const P = (x, y) => {
      const v = new T.Vector3(x, y, c.z).applyMatrix4(S.camera.projectionMatrix);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    };
    const m = P(c.x, c.y), a = P(c.x - w / 2, c.y + h / 2), b = P(c.x + w / 2, c.y - h / 2);
    return {
      cx: +m.x.toFixed(1), cy: +m.y.toFixed(1),
      x0: +a.x.toFixed(1), y0: +a.y.toFixed(1), x1: +b.x.toFixed(1), y1: +b.y.toFixed(1),
      inFront: c.z < 0, alpha: +(r.aCard || 0).toFixed(3), halo: +(r.aHalo || 0).toFixed(3),
      full: !!r.full, ds: +(r.ds || 0).toFixed(1),
    };
  },
  aimEl: () => (S.aimEl && S.aimEl.classList.contains('is-on')
    ? { name: S.aimNameEl.textContent, key: S.aimKeyEl.textContent } : null),
  flash: () => +(S.flashEl ? (S.flashEl.style.opacity || 0) : 0),
  // press T exactly the way a player does, gates and all
  key: (code) => {
    dispatchEvent(new KeyboardEvent('keydown', { code: code || TRAVEL_KEY, bubbles: true }));
    return S.lastTravel;
  },
  // the painted atlas, for eyeballing the sign design without a world around it
  atlasUrl: () => (S.atlas && S.atlas.image ? S.atlas.image.toDataURL() : null),
  keys: () => Object.keys(REG),
  // tear down and rebuild against a different marker source, reusing this
  // world's THREE/scene/camera. Exists so the `world.markers` contract path —
  // including the z-up tip — can be exercised in a world that has not declared
  // one yet; nothing in the player calls it.
  reinit: (list, upAxis) => {
    const ctx = {
      THREE: S.THREE, scene: S.scene, camera: S.camera, ctrl: S.ctrl, hud: S.hud,
      collision: S.collision, poi: S.poi, run: S.run, markers: list, upAxis,
    };
    _test.destroy();
    init(ctx);
    return stats();
  },
  destroy: () => {
    if (S.group && S.group.parent) S.group.parent.remove(S.group);
    if (S.card) { S.card.geometry.dispose(); S.card.material.dispose(); }
    if (S.halo) { S.halo.geometry.dispose(); S.halo.material.dispose(); }
    if (S.atlas) S.atlas.dispose();
    if (S.haloTex) S.haloTex.dispose();
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    for (const el of document.querySelectorAll('.pmk-aim, .pmk-flash')) el.remove();
    const st = document.getElementById('pmk-style');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    S.rows = []; S.group = S.card = S.halo = null; S.root = null; S.ok = false;
    S.aim = null; S.aimBlocked = false; S.aimEl = S.flashEl = null; S.flash = 0;
    // specs/0055 §3.10 — the flash's board goes with it; a live handle to a
    // removed node is how a second boot paints into a detached tree.
    S.flashSignEl = S.flashIcoEl = S.flashNameEl = null;
  },
};

// signAt/touchAim ride the same handle: touch.js is the only caller and it already
// reaches the player through a global, so the tap path needs no import and a world
// that never mounted this module simply has no signs to tap.
window.__playMarkers = { init, update, stats, aimedAt, fastTravel, signAt, touchAim, _test };
export default init;
