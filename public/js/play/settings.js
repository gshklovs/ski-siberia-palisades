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
//   2. IT IS A LEAF. This module imports nothing and touches no DOM. Any file
//      in the player may import it without thinking about load order, and a
//      world that never imports it is unchanged.
//
// STORAGE is `poi-lab.play.settings.<key>` in localStorage, under the same
// try/catch discipline inventory.js's remember/recall use: private mode, a
// storage-disabled profile and a quota error are all "the knob is at its
// default", never a thrown exception on the render path.

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

function save(key, v) {
  try { localStorage.setItem(LS + key, v ? '1' : '0'); } catch { /* private mode */ }
}

// -------------------------------------------------------------- the surface
/** the live value of one knob. An unknown key reads false, never undefined. */
export function get(key) { return !!V[key]; }

/**
 * Write one knob. Returns the value that stuck, or undefined for a key this
 * module does not own — a typo'd key must not quietly become a third setting
 * that nothing reads.
 */
export function set(key, v) {
  if (!(key in V)) return undefined;
  V[key] = !!v;
  save(key, V[key]);
  return V[key];
}

/** every knob, as a plain object. A copy: callers cannot write through it. */
export function all() { const o = {}; for (const k in V) o[k] = V[k]; return o; }

/** the keys, in the order the locker lists them. */
export function keys() { return KNOBS.map((k) => k.key); }

/** the defaults, so a test can assert a fresh profile without hardcoding them. */
export function defaults() { return { ...DEF }; }

/** back to the shipped state, storage included — the harness's reset. */
export function reset() {
  for (const k of KNOBS) { V[k.key] = !!k.def; try { localStorage.removeItem(LS + k.key); } catch { /* private mode */ } }
  return all();
}

export const settings = { get, set, all, keys, defaults, reset, KNOBS, ns: LS };

// The harness handle, in the shape __clean / __speedlines / __aura already use.
if (typeof window !== 'undefined') window.__settings = settings;

export default settings;
