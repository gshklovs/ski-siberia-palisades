// settings.js — the player's own knobs, and the ONE place their value lives.
// specs/0019.
//
// WHY THIS FILE EXISTS AT ALL. Greg records this build, and H (clean.js) is the
// key that empties the frame so the mountain can be filmed. Three things were
// never covered by that emptying in the same way, because none of them is a
// fixed overlay the stylesheet's `> *:not(canvas)` rule can reach: the anime
// speed-line field is a canvas, and the jump-power aura and the ski tracks are
// in 3D. Each therefore carries its own answer to "am I in this shot", and Greg
// wanted those answers to be his rather than ours — "both separate knobs and
// default to false".
//
// TWO RULES, and they are the whole design:
//
//   1. NOTHING ELSE HOLDS A COPY. fx.js and tracks.js ask this module every
//      frame; inventory.js writes through it and reads back what it wrote.
//      There is no cached boolean anywhere else, which is what makes "a knob
//      flips live — no reload, no reboot" true by construction rather than by
//      somebody remembering to fire an event.
//   2. IT IS A LEAF. This module touches no DOM and imports only flags.js,
//      which is itself a leaf — so any file in the player may still import it
//      without thinking about load order, and a world that never imports it is
//      unchanged. (specs/0055 §5.3, 2026-09-06: the LAB UI knob's default IS a
//      flag, so the table has to be able to see them.)
//
// STORAGE is `poi-lab.play.settings.<key>` in localStorage, under the same
// try/catch discipline inventory.js's remember/recall use: private mode, a
// storage-disabled profile and a quota error are all "the knob is at its
// default", never a thrown exception on the render path.

import { DEBUG_HUD, labUI, setLabUI } from './flags.js';

const LS = 'poi-lab.play.settings.';

// ---------------------------------------------------------------- the knobs
// The row copy lives HERE and not in the locker, for rule 1: a label is as much
// a fact about the knob as its default is, and the day a third knob lands it is
// this table that grows by one entry and nothing else.
//
// BOTH DEFAULT FALSE, and false means "do not show this in a clean frame" —
// which is the recording Greg asked for by default. On means "ignore H, stay in
// the shot"; every OTHER reason each effect has to be silent still applies.
export const KNOBS = [
  {
    key: 'cleanSpeedLines',
    def: false,
    label: 'SPEED LINES IN CLEAN FRAME',
    // one line, plain, and it says which key the frame belongs to. The locker is
    // itself a secret screen, so this is the one surface allowed to name H.
    desc: 'H empties the frame. Off, the speed lines leave with everything else; on, they stay in the shot.',
  },
  {
    key: 'cleanPumpTracks',
    def: false,
    label: 'AURA + TRACKS IN CLEAN FRAME',
    desc: 'H empties the frame. Off, the ski flame and the lines you cut in the snow leave too; on, both stay. Neither is erased either way.',
  },
];

// specs/0055 §5.3 (Greg 2026-09-06: hide poi-lab UI) — THE THIRD ROW, and the
// one row here that owns no storage of its own.
//
// It is a knob in every way the locker cares about (a label, a blurb, a switch
// that flips live), so it goes in this table and inventory.js renders it with
// the other two through the `KNOBS.map` it already has — no new row markup, no
// second code path, the same 34x18 cream track and square ink plate W4 landed.
// What it does NOT own is the boolean: the default is `DEBUG_HUD` and the value
// has to be readable by hud.js/markers.js/dev.js at render time, so flags.js
// holds it and this entry carries a `get`/`set` pair pointing at it. Rule 1 is
// intact — still exactly one copy, it just lives one file upstream.
//
// ONLY IN THE LAB. On the shipped build DEBUG_HUD is false, no lab node was
// ever constructed, and a settings row reading LAB UI would be an internal
// identity string on a public screen for a switch with nothing to switch (D9,
// D44). A knob that cannot do anything is not a knob.
if (DEBUG_HUD) {
  KNOBS.push({
    key: 'labUI',
    def: true,               // = DEBUG_HUD, which is true wherever this pushes
    label: 'LAB UI',
    desc: 'The workshop instruments: the debug readout and its fps, the lip/compression meter, N reference photos, F8 dev fly, and the lab rows in this pause menu. Off hides all of them and F8 and N stop responding. (specs/0057 §4.4 — the refs viewer moved off B on 2026-09-06; B is the grab key and is not a lab control.) This switch stays here.',
    get: labUI,
    set: setLabUI,
  });
}

const DEF = {};
for (const k of KNOBS) DEF[k.key] = !!k.def;

// ------------------------------------------------------------------ storage
// Read ONCE, at module load, into `V`. Every later read is a property lookup,
// because these are read per frame by two modules and localStorage is a
// synchronous main-thread call that can be surprisingly slow under a profile
// with a large origin store.
function load(key) {
  try {
    const raw = localStorage.getItem(LS + key);
    if (raw === null) return DEF[key];
    return raw === '1' || raw === 'true';
  } catch { return DEF[key]; }
}

const V = {};
for (const k of KNOBS) V[k.key] = load(k.key);

// specs/0055 §5.3 — the one delegating knob, by key. A knob with a `get`/`set`
// pair keeps its value somewhere else (flags.js, above); `V[key]` is never read
// or written for it, so there is no second copy to drift.
const OWNER = {};
for (const k of KNOBS) if (k.get && k.set) OWNER[k.key] = k;

function save(key, v) {
  try { localStorage.setItem(LS + key, v ? '1' : '0'); } catch { /* private mode */ }
}

// -------------------------------------------------------------- the surface
/** the live value of one knob. An unknown key reads false, never undefined. */
export function get(key) { return OWNER[key] ? !!OWNER[key].get() : !!V[key]; }

/**
 * Write one knob. Returns the value that stuck, or undefined for a key this
 * module does not own — a typo'd key must not quietly become a third setting
 * that nothing reads.
 */
export function set(key, v) {
  if (!(key in V)) return undefined;
  if (OWNER[key]) return !!OWNER[key].set(!!v);
  V[key] = !!v;
  save(key, V[key]);
  return V[key];
}

/** every knob, as a plain object. A copy: callers cannot write through it. */
export function all() { const o = {}; for (const k in V) o[k] = get(k); return o; }

/** the keys, in the order the locker lists them. */
export function keys() { return KNOBS.map((k) => k.key); }

/** the defaults, so a test can assert a fresh profile without hardcoding them. */
export function defaults() { return { ...DEF }; }

/** back to the shipped state, storage included — the harness's reset. */
export function reset() {
  for (const k of KNOBS) {
    if (OWNER[k.key]) { OWNER[k.key].set(!!k.def); continue; }   // its owner writes its own storage
    V[k.key] = !!k.def;
    try { localStorage.removeItem(LS + k.key); } catch { /* private mode */ }
  }
  return all();
}

export const settings = { get, set, all, keys, defaults, reset, KNOBS, ns: LS };

// The harness handle, in the shape __clean / __speedlines / __aura already use.
if (typeof window !== 'undefined') window.__settings = settings;

export default settings;
