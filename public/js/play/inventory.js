// The locker. A full-screen equipment screen — I to open, I or ESC to close —
// with one tab per sport, a grid of item cards, a live 3D preview of the body
// wearing the highlighted item, and the stat bars that say how it will feel.
//
// Three rules keep it from becoming a second game:
//
//   1. IT OWNS NOTHING. The TABS table below is data; equipping is a callback
//      into main.js, which is still the only place that touches the controller.
//      The screen can be deleted and the player is unchanged.
//   2. ANY GEAR TYPE CAN HAVE MODELS. A tab is { id, label, gear, kind, icon,
//      accent, items() } and an item is { id, name, brand, tag, group, stats,
//      facts, blurb, thumb }. Skis ship with thirteen and bikes with twelve; the
//      glider ships two and boots one, in the same cards, so adding a registry
//      is one TABS entry and no UI work. See INTEGRATION-LOCKER.md.
//   3. IT STYLES ITSELF. Every rule this screen needs is in LOCKER_CSS below and
//      injected on first construction under the `lk` namespace, so the locker
//      never collides with play.css and never needs a network font or asset.
//
// While it is up, the player is deaf: main.js routes every key here and the
// pointer lock is released so the mouse can click. Nothing simulates
// differently — the world keeps running behind the panel, exactly as it does
// behind pause.

import {
  SKI_MODELS, getSkiModel, skiThumbURL, makeSkiRig, styleSkiRig,
  rememberSkiId, SKI_DEFAULT,
} from './ski.js';
import { GLIDER_MODELS, GLIDER_DEFAULT, rememberGliderId } from './glider.js';
import {
  BIKE_MODELS, BIKE_DEFAULT, bikeThumbURL, rememberBikeId,
  makeBikeRig, styleBikeRig,
} from './bike.js';
// The two racks that landed after this screen did (INTEGRATION-SLED.md). They
// resolve their own equipped id, because main.js's `initial` predates them —
// resolveSledId honours ?sled= then storage then the default, exactly as the
// player does, so the locker agrees with the world without main.js changing.
import {
  SLED_MODELS, SLED_DEFAULT, sledThumbURL, rememberSledId, resolveSledId,
  makeSledRig, styleSledRig,
} from './sled.js';
import {
  SNOWMOBILE_MODELS, SNOWMOBILE_DEFAULT, snowmobileThumbURL, rememberSnowmobileId,
  resolveSnowmobileId, makeSnowmobileRig, styleSnowmobileRig,
} from './snowmobile.js';
import { BIKE_GEAR, BRAND } from './flags.js';
// specs/0019 — the settings page at the back of the locker. The knobs' values
// AND their copy live in settings.js; this file renders them and writes through
// it, and holds no copy of either.
import { KNOBS, get as getSetting, set as setSetting } from './settings.js';

// the two glider models paint from the same 300×58 frame as the boots
const GLIDER_LOOK = {
  wing: { base: '#dd6a2a', ink: '#6b4a2a', accent: '#f2c98a' },
  rocket: { base: '#1b1c22', ink: '#0b0b0e', accent: '#b9bec4' },
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const LS = 'poi-lab.play.locker.';
const remember = (tab, id) => { try { localStorage.setItem(LS + tab, id); } catch { /* private mode */ } };
const recall = (tab) => { try { return localStorage.getItem(LS + tab); } catch { return null; } };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------- colour
// Everything tinted in this screen — a tab's accent, a group's card wash, a
// chip — resolves through here, and an UNKNOWN name still gets a stable colour
// rather than a hole. A new registry is therefore legible on the day it lands,
// before anyone has picked colours for it.
function hexRGB(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return n;
}
const rgba = (hex, a) => { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; };

// a stable hue for any string, so an unnamed group is never grey-on-grey
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
const hslHex = (hue) => {
  // one fixed S/L so a generated colour sits in the same family as the named ones
  const s = 0.62, l = 0.62;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
};

// the named groups the three shipped registries use
const GROUP_TINT = {
  lab: '#8fa3b8',
  race: '#ff3b5c',
  freeride: '#2ec4b6',
  trail: '#54d17a',
  jump: '#ffb020',
  fun: '#c77dff',
  dh: '#ff6b3d',
  xc: '#5ad1e6',
};
const groupTint = (g) => GROUP_TINT[g] || (GROUP_TINT[g] = hslHex(hashHue(String(g || 'x'))));

// ------------------------------------------------------------------- icons
// Drawn here, in markup, at 24×24 on currentColor. No files, no font, no
// network — a tab that ships without an icon still gets the crate.
const ICON = {
  ski: '<path d="M5.4 20.6 8.9 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M12.6 20.6 16.1 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M4.2 20.9h5.1"/><path d="M11.4 20.9h5.1"/>',
  bike: '<circle cx="5.9" cy="16.4" r="4.1"/><circle cx="18.1" cy="16.4" r="4.1"/><path d="M5.9 16.4 10.2 8.2h6.1l1.8 8.2"/><path d="M9.4 8.2h4.4"/><path d="M16.3 8.2 17.5 5.4h2.2"/>',
  glider: '<path d="M12 3.4 2.6 13.9c3.4-1.4 6.4-.7 9.4 6.7 3-7.4 6-8.1 9.4-6.7z"/><path d="M12 3.4v17.2"/>',
  boots: '<path d="M8.2 3.4h4.3v8.4c0 1.3.8 2.4 2 2.9l4.1 1.8v4.1H6.4V3.4z"/><path d="M6.6 17.1h12"/>',
  crate: '<path d="M12 2.7 20.2 7v10L12 21.3 3.8 17V7z"/><path d="M3.8 7 12 11.4 20.2 7"/><path d="M12 11.4v9.9"/>',
  // the toboggan in side view: curled nose to the right, deck, two runners
  sled: '<path d="M3.2 13.9h12.9c2.1 0 3.5-1.3 3.5-3 0-1.3-1-2.3-2.2-2.3s-2.2 1-2.2 2.3"/><path d="M4.4 18.2h12.2"/><path d="M5.8 13.9v4.3"/><path d="M13.9 13.9v4.3"/>',
  // track, tunnel, windshield and the front ski
  snowmobile: '<rect x="2.5" y="14.2" width="10.2" height="4.3" rx="2.1"/><path d="M12.7 16.3h3.5l2.4-2.3"/><path d="M8.4 14.2 10.1 9.6h3.8l1.3 2.7"/><path d="M14 9.6 16.1 7.2"/><path d="M17.2 18.5h3.3"/><path d="M18.9 13.4v5.1"/>',
  // specs/0019 — the cog. Two circles and eight teeth on the diagonals, struck
  // at the same 1.7 stroke on currentColor as the six above, so the settings tab
  // reads as one of the strip rather than as a pasted-in icon set.
  gear: '<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.9"/>'
    + '<path d="M18.6 12h2.2"/><path d="M5.4 12H3.2"/><path d="M12 5.4V3.2"/><path d="M12 18.6v2.2"/>'
    + '<path d="M16.67 7.33 18.22 5.78"/><path d="M7.33 16.67 5.78 18.22"/>'
    + '<path d="M16.67 16.67 18.22 18.22"/><path d="M7.33 7.33 5.78 5.78"/>',
};
function iconSVG(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (ICON[name] || ICON.crate) + '</svg>';
}

// -------------------------------------------------------------------- stats
// The bars are DERIVED, never authored: ski.js and bike.js each compute a
// turn/speed/stab/pop quartet from the tuning the physics will actually run, and
// a fifth SPIN bar appears only when every item in the tab carries a real
// spinTorque. A registry that ships four stats gets four bars; one that ships
// spin gets five; one that ships neither gets none, and nothing throws.
const STAT_DEFS = [
  { key: 'speed', label: 'speed', unit: true, src: 'term', suffix: ' m/s' },
  { key: 'turn', label: 'handling', unit: true, src: 'steer', suffix: ' rad/s' },
  { key: 'stab', label: 'stability', unit: true },
  { key: 'pop', label: 'pop', unit: true },
  { key: 'spinTorque', label: 'spin', unit: false, suffix: ' rad/s' },
];
const num = (v) => typeof v === 'number' && isFinite(v);

// Which bars this tab can honestly show, and the min/max of each ACROSS THE
// WHOLE TAB (not the filtered view) so a filter chip never rescales the bars
// under you. `unit` stats already arrive 0..1 from the registry; raw ones (spin)
// only mean anything relative to their neighbours, which is what this is for.
function statScale(items) {
  const out = [];
  for (const def of STAT_DEFS) {
    const vals = items.map((it) => (it.stats ? it.stats[def.key] : undefined));
    if (!vals.length || !vals.every(num)) continue;
    out.push({ ...def, min: Math.min(...vals), max: Math.max(...vals), n: items.length });
  }
  return out;
}

// 0..1 for the bar. Small racks keep their absolute numbers (two gliders
// stretched to 0 and 1 on every bar would be a lie); racks big enough to have a
// spread get normalised within the tab so the best ski in the rack reads full.
function statNorm(def, v) {
  const spread = def.max - def.min;
  if (def.unit && def.n < 4) return clamp01(v);
  if (spread > 1e-6) return 0.08 + 0.92 * ((v - def.min) / spread);
  return def.unit ? clamp01(v) : 0.5;
}

// ---------------------------------------------------------------- item art
// Skis paint their own topsheet (ski.js) and bikes their own side view
// (bike.js). Everything else gets a glyph in a 300×58 frame; the cards use
// object-fit so the two aspect ratios live in one grid without letterboxing.
const _sw = new Map();
function swatchURL(id, look, glyph) {
  if (_sw.has(id)) return _sw.get(id);
  const W = 300, H = 58;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = look.base; x.fillRect(0, 0, W, H);
  x.strokeStyle = look.accent; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round';
  x.fillStyle = look.accent;
  if (glyph === 'bike') {
    x.beginPath(); x.arc(96, 34, 17, 0, 7); x.stroke();
    x.beginPath(); x.arc(204, 34, 17, 0, 7); x.stroke();
    x.beginPath();
    x.moveTo(96, 34); x.lineTo(140, 18); x.lineTo(186, 18); x.lineTo(204, 34);
    x.lineTo(150, 34); x.closePath(); x.stroke();
    x.beginPath(); x.moveTo(186, 18); x.lineTo(196, 8); x.lineTo(212, 8); x.stroke();
  } else if (glyph === 'rocket') {
    // The pack as it actually sits on a back (rocket.js), read from behind: two
    // banded tanks on a harness plate, a bell under each, flame beneath. Drawn
    // to the same width as the bike glyph — a card is 130 px on screen, and the
    // first pass at 22 px tanks was a dark smudge at that size.
    x.fillStyle = look.ink;
    x.fillRect(132, 12, 36, 30);                            // harness plate
    for (const cx of [110, 190]) {
      x.fillStyle = look.accent;
      x.fillRect(cx - 17, 9, 34, 33);
      x.beginPath(); x.ellipse(cx, 9, 17, 7, 0, 0, 7); x.fill();
      x.fillStyle = look.ink;
      x.fillRect(cx - 17, 22, 34, 7);                       // the band
      x.beginPath();
      x.moveTo(cx - 11, 42); x.lineTo(cx + 11, 42);
      x.lineTo(cx + 17, 51); x.lineTo(cx - 17, 51);
      x.closePath(); x.fill();                              // the bell
      x.fillStyle = '#ffb347';
      x.beginPath(); x.moveTo(cx - 13, 52); x.lineTo(cx + 13, 52); x.lineTo(cx, 58); x.closePath(); x.fill();
    }
  } else if (glyph === 'wing') {
    x.beginPath();
    x.moveTo(150, 8); x.quadraticCurveTo(74, 20, 34, 46);
    x.quadraticCurveTo(96, 40, 150, 50);
    x.quadraticCurveTo(204, 40, 266, 46);
    x.quadraticCurveTo(226, 20, 150, 8);
    x.closePath(); x.fill();
    x.strokeStyle = look.ink; x.lineWidth = 2;
    x.beginPath(); x.moveTo(150, 4); x.lineTo(150, 54); x.stroke();
  } else {                                    // boot
    x.beginPath();
    x.moveTo(112, 8); x.lineTo(160, 8); x.lineTo(166, 34);
    x.lineTo(198, 42); x.lineTo(198, 52); x.lineTo(108, 52); x.closePath();
    x.fill();
    x.fillStyle = look.ink;
    for (let i = 0; i < 3; i++) x.fillRect(118, 14 + i * 10, 40, 4);
  }
  const url = c.toDataURL('image/png');
  _sw.set(id, url);
  return url;
}

// -------------------------------------------------------------- the tabs
// `items()` is a function so a tab can grow at runtime without the screen
// knowing; `group` on an item is what the filter chips are built from; `icon`
// and `accent` are the only two cosmetic fields, and both have fallbacks.
const TABS = [
  {
    id: 'skis', label: 'skis', gear: 'skis', kind: 'ski', icon: 'ski', accent: '#4cc9f0',
    items: () => SKI_MODELS.map((m) => ({
      id: m.id, name: m.name, brand: m.brand, tag: m.disc, group: m.group,
      blurb: m.blurb, stats: m.stats, thumb: skiThumbURL(m),
      // the one-line spec sheet under the hero art, the way a shop wall reads it
      spec: `${m.len} cm · ${m.waist} mm waist · R${m.radius}`,
      facts: [
        ['length', m.len + ' cm'],
        ['waist', m.waist + ' mm'],
        ['radius', 'R' + m.radius],
        ['top speed', m.stats.term.toFixed(1) + ' m/s'],
        ['turn rate', m.stats.steer.toFixed(2) + ' rad/s'],
        ['chatter', m.stats.chatterSpeed === Infinity ? 'never' : m.stats.chatterSpeed + ' m/s'],
        ['spin', m.stats.spinTorque.toFixed(1) + ' rad/s'],
        ['pop', '×' + m.stats.popMul.toFixed(2)],
      ],
    })),
  },
  // specs/0003 — `gearSet`. The bike rack is LAB-ONLY: on the ski set there is
  // no bike gear (controller.js registers none), and a locker tab that switches
  // nothing is the same anti-pattern the B viewer was cut for. bike.js itself
  // still ships in both — main.js and this file import it unconditionally, and
  // deleting the module is a module-level fatal, which is exactly the
  // file-deletion-vs-registry-edit distinction D24 warns about.
  ...(BIKE_GEAR ? [{
    // The bike rack (bike.js), same shape as the skis: every card's stats and
    // facts are derived from the tuning the physics will actually run, and the
    // thumbnail is drawn from the same head angle and wheelbase.
    id: 'bike', label: 'bikes', gear: 'bike', kind: 'bike', icon: 'bike', accent: '#ff7a29',
    items: () => BIKE_MODELS.map((m) => ({
      id: m.id, name: m.name, brand: m.brand, tag: m.disc, group: m.group,
      blurb: m.blurb, stats: m.stats, thumb: bikeThumbURL(m),
      spec: `${m.spec.travel} travel · ${m.spec.head.toFixed(1)}° head · ${m.spec.mass} · ${m.spec.wheel}`,
      facts: [
        ['travel', m.spec.travel],
        ['head angle', m.spec.head.toFixed(1) + '°'],
        ['wheelbase', m.spec.wb + ' mm'],
        ['weight', m.spec.mass],
        ['wheels', m.spec.wheel],
        ['top speed', m.stats.term.toFixed(1) + ' m/s'],
        ['pedal cap', m.stats.pedalMax.toFixed(1) + ' m/s'],
        ['spin', m.stats.spinTorque.toFixed(1) + ' rad/s'],
        ['pop', m.stats.popFull.toFixed(1) + ' m/s'],
      ],
    })),
  }] : []),
  {
    // ONE equipment type, two flight models — the rack lives in glider.js, and
    // each entry names the controller gear that actually flies it, so the wing
    // and the rocket pack are two cards in one tab rather than two gears.
    id: 'glider', label: 'glider', gear: 'glider', kind: 'glider', icon: 'glider', accent: '#a78bfa',
    items: () => GLIDER_MODELS.map((m) => ({
      id: m.id, name: m.name, brand: m.brand, tag: m.tag, group: m.group,
      blurb: m.blurb, stats: m.stats, facts: m.facts,
      gear: m.gear, preview: m.preview,
      spec: m.facts && m.facts.length ? m.facts.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ') : '',
      thumb: swatchURL('glider-' + m.id, GLIDER_LOOK[m.glyph], m.glyph),
    })),
  },
  // ---- the two racks from INTEGRATION-SLED.md.
  // `apply` is the one thing these two need that the first four do not: main.js's
  // onEquip branches on kind for ski / bike / glider and falls through to
  // ctrl.setMode for anything else, so the MODE switches but the model is never
  // written. Until that block grows a branch (or the generic hook proposed in
  // INTEGRATION-LOCKER.md §4), the tab applies itself through the same public
  // entry point the tests use. Optional-chained throughout: if the hook is not
  // there, equipping still switches gear and nothing throws.
  {
    id: 'sled', label: 'sled', gear: 'sled', kind: 'sled', icon: 'sled', accent: '#c98a3f',
    remember: rememberSledId,
    apply: (id) => window.__player?.setSledModel?.(id),
    items: () => SLED_MODELS.map((m) => ({
      id: m.id, name: m.name, brand: m.brand, tag: m.disc, group: m.group,
      blurb: m.blurb, stats: m.stats, thumb: sledThumbURL(m),
      spec: `${m.spec.length} · ${m.spec.deck} · ${m.spec.mass}`,
      facts: [
        ['length', m.spec.length], ['width', m.spec.width], ['deck', m.spec.deck],
        ['runners', m.spec.runners], ['weight', m.spec.mass],
        ['top speed', m.stats.term.toFixed(1) + ' m/s'],
        ['turn rate', m.stats.steer.toFixed(2) + ' rad/s'],
        ['wipe tolerance', (m.stats.wipeTol * 180 / Math.PI).toFixed(0) + '°'],
        ['stalls below', m.stats.stallSpeed.toFixed(1) + ' m/s'],
      ],
    })),
  },
  {
    id: 'snowmobile', label: 'snowmobile', gear: 'snowmobile', kind: 'snowmobile',
    icon: 'snowmobile', accent: '#ff6a1f',
    remember: rememberSnowmobileId,
    apply: (id) => window.__player?.setSnowmobileModel?.(id),
    items: () => SNOWMOBILE_MODELS.map((m) => ({
      id: m.id, name: m.name, brand: m.brand, tag: m.disc, group: m.group,
      blurb: m.blurb, stats: m.stats, thumb: snowmobileThumbURL(m),
      spec: `${m.spec.engine} · ${m.spec.mass}`,
      facts: [
        ['engine', m.spec.engine], ['track', m.spec.track], ['weight', m.spec.mass],
        ['suspension', m.spec.suspension],
        ['top speed', m.stats.term.toFixed(1) + ' m/s'],
        ['climbs to', m.stats.climbDeg.toFixed(1) + '°'],
        ['reverse', m.stats.reverseMax.toFixed(1) + ' m/s'],
        ['brake', m.stats.brake.toFixed(0) + ' m/s²'],
      ],
    })),
  },
  {
    id: 'boots', label: 'boots', gear: 'boots', kind: 'boots', icon: 'boots', accent: '#e0b166',
    items: () => [{
      id: 'boots', name: 'Boots', brand: BRAND, tag: 'on foot', group: 'lab',
      blurb: 'The Quake-ish walk controller, untouched since the first commit. Walk, sprint, jump, step over anything under 55 cm. Nothing you equip can change how this feels.',
      stats: { turn: 1.0, speed: 0.10, stab: 1.0, pop: 0.20 },
      thumb: swatchURL('boots', { base: '#26231f', ink: '#12110f', accent: '#cdc7ba' }, 'boot'),
      spec: 'walk 4.5 m/s · sprint 8.0 m/s · step 0.55 m',
      facts: [['walk', '4.5 m/s'], ['sprint', '8.0 m/s'], ['jump', '4.5 m/s'], ['step up', '0.55 m']],
    }],
  },
  // ---- specs/0019. THE LAST TAB, and the only one that is not a rack.
  //
  // It is here rather than in a menu of its own for the reason Greg asked for it
  // here: the locker is already the screen you press one undocumented key to
  // reach, it already owns the keyboard, and a settings page "in the back of the
  // inventory" costs a player nothing to find once and nothing to ignore
  // forever. `kind: 'settings'` is the one word the five render functions below
  // branch on; everything else on this entry is the same shape a rack has, so
  // the tab strip, the accent, the Q/E walk and the count badge all just work.
  //
  // IT EQUIPS NOTHING. `gear` and `remember` are absent on purpose — onEquip is
  // never called from this tab, the mannequin is left wearing whatever the last
  // gear tab dressed it in, and the persistence is settings.js's own.
  {
    // the accent is a green nothing else in the strip is near (skis cyan, bikes
    // and the snowmobile orange, the glider violet, the sled and the boots tan)
    // — it has to carry "on" on the switch as well as tint the tab
    id: 'settings', label: 'settings', kind: 'settings', icon: 'gear', accent: '#4fd6a9',
    // one row per knob, straight off settings.js's table — the "next knob is one
    // line" the spec asks for is one entry THERE, and no edit at all here.
    items: () => KNOBS.map((k) => ({
      id: k.key, key: k.key, name: k.label, desc: k.desc,
    })),
  },
];

// ------------------------------------------------------------------- style
// Injected once, under `lk`, so this screen owns its own appearance end to end
// and shares no selector with play.css. Dark slate panel, one accent per tab
// (--lk-acc, swapped on every setTab), high-contrast text, system fonts only.
const LOCKER_CSS = `
.lk {
  --lk-acc: #4cc9f0;
  --lk-scrim: rgba(6, 9, 14, .66);
  --lk-panel: #12161d;
  --lk-panel-2: #191f28;
  --lk-panel-3: #212936;
  --lk-line: #2a3341;
  --lk-line-2: #3a4655;
  --lk-ink: #eef4fa;
  --lk-ink-2: #a6b4c4;
  --lk-ink-3: #6b7a8c;
  --lk-good: #56d97f;
  --lk-bad: #ff6b6b;
  --lk-mono: ui-monospace, "Cascadia Mono", Consolas, "Segoe UI Mono", "DejaVu Sans Mono", monospace;
  --lk-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; padding: 16px;
  background: var(--lk-scrim);
  backdrop-filter: blur(6px) saturate(.9);
  -webkit-backdrop-filter: blur(6px) saturate(.9);
  font-family: var(--lk-sans);
  color: var(--lk-ink);
  pointer-events: auto;
  opacity: 0;
  transition: opacity .16s ease-out;
}
.lk[hidden] { display: none; }
.lk.is-in { opacity: 1; }
.lk.is-out { pointer-events: none; }
.lk *, .lk *::before, .lk *::after { box-sizing: border-box; }
/* the display rules below are all author-level, so [hidden] needs to shout */
.lk [hidden] { display: none !important; }
.lk button { font: inherit; color: inherit; background: none; border: 0; margin: 0; }

/* ------------------------------------------------------------------ panel */
.lk__panel {
  position: relative;
  width: min(1560px, 96vw); height: min(880px, 92vh);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-height: 0;
  background:
    radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.055), transparent 60%),
    linear-gradient(180deg, #141a22 0%, var(--lk-panel) 42%, #0f141a 100%);
  border: 1px solid var(--lk-line);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.03) inset;
  overflow: hidden;
  transform: translateY(16px) scale(.982);
  opacity: 0;
  transition: transform .2s cubic-bezier(.2,.8,.25,1), opacity .16s ease-out;
}
.lk.is-in .lk__panel { transform: none; opacity: 1; }
/* the accent hairline across the top — the one place the tab colour shouts */
.lk__panel::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--lk-acc) 18%, var(--lk-acc) 82%, transparent);
  opacity: .9;
}

/* ----------------------------------------------------------------- header */
.lk__hd {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 18px 11px;
  border-bottom: 1px solid var(--lk-line);
}
.lk__title {
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__title b { color: var(--lk-acc); }
.lk__spacer { flex: 1 1 auto; }
.lk__load { display: flex; align-items: center; gap: 14px; }
.lk__load-i { display: flex; align-items: baseline; gap: 6px; }
.lk__load-k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__load-v {
  font-family: var(--lk-mono); font-size: 10.5px; letter-spacing: .04em; color: var(--lk-ink-2);
  max-width: 19ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ------------------------------------------------------------------- tabs */
.lk__tabs {
  display: flex; align-items: stretch; gap: 6px;
  padding: 10px 18px 0; border-bottom: 1px solid var(--lk-line);
}
/* NOTHING that says "this is the active tab" is transitioned. A CSS transition
   is driven by the document's animation clock, and on a frame-starved deck —
   a heavy world behind the panel, a software rasteriser — that clock can stall
   long enough for the strip to keep advertising the tab you just left. Colour
   changes here snap; only the decorative hover lift below animates. */
.lk__tab {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px 10px; cursor: pointer;
  border-radius: 8px 8px 0 0;
  color: var(--lk-ink-3);
}
.lk__tab svg { width: 17px; height: 17px; flex: none; }
.lk__tab-l {
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
}
.lk__tab-n {
  font-family: var(--lk-mono); font-size: 9.5px; font-variant-numeric: tabular-nums;
  padding: 1px 5px; border-radius: 999px;
  background: var(--lk-panel-3); color: var(--lk-ink-3);
}
.lk__tab::after {
  content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px;
  background: var(--lk-tab-acc, var(--lk-acc)); border-radius: 2px 2px 0 0;
  transform: scaleX(0); transform-origin: 50% 100%;
}
.lk__tab:hover { color: var(--lk-ink-2); background: rgba(255,255,255,.035); }
.lk__tab.is-on { color: var(--lk-ink); background: rgba(255,255,255,.05); }
.lk__tab.is-on::after { transform: scaleX(1); }
.lk__tab.is-on .lk__tab-n { background: var(--lk-tab-acc, var(--lk-acc)); color: #08111a; }
.lk__tab.is-on svg { color: var(--lk-tab-acc, var(--lk-acc)); }

/* ------------------------------------------------------------------- body */
.lk__main {
  display: grid; gap: 14px; min-height: 0;
  /* the two side decks grow with the panel instead of pinning at 320/340, so a
     2560-wide deck spends its extra width on the preview and the spec sheet
     rather than on ever-wider cards */
  grid-template-columns: minmax(300px, 23%) minmax(0, 1fr) minmax(330px, 23%);
  grid-template-areas: "pv grid det";
  padding: 14px 18px;
}

/* ---- left: the mannequin */
.lk__pv { grid-area: pv; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px; min-height: 0; }
.lk__stage {
  position: relative; min-height: 0; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--lk-line);
  background:
    radial-gradient(78% 52% at 50% 92%, var(--lk-acc-soft, rgba(76,201,240,.16)), transparent 68%),
    radial-gradient(120% 80% at 50% 8%, rgba(255,255,255,.05), transparent 62%),
    linear-gradient(180deg, #0d1218 0%, #10161e 60%, #0a0e13 100%);
}
/* the floor: one soft ellipse the figure stands on, drawn in CSS so the
   preview scene stays two lights and a turntable */
.lk__stage::after {
  content: ""; position: absolute; left: 50%; bottom: 12%; width: 62%; height: 9%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0,0,0,.55), transparent 78%);
  pointer-events: none;
}
/* play.css carries \`body.play canvas { position: fixed; left: 0; top: 0 }\` for the
   world's own canvas, and that selector (0,1,2) outranks a single class. The
   preview renderer is a canvas in this document too, so it needs three classes
   to stay inside its box — without them it paints over the whole viewport. */
.lk .lk__stage .lk__canvas {
  display: block; position: absolute; left: 0; width: 100%; z-index: 1;
  /* height and top come from resizePreview(), which caps the 3D viewport to a
     3:4 band centred in the stage — see the comment there */
}
.lk__eqflash {
  position: absolute; inset: 0; z-index: 2; pointer-events: none; opacity: 0;
  background: radial-gradient(58% 42% at 50% 62%, var(--lk-acc), transparent 70%);
  mix-blend-mode: screen;
}
.lk__eqflash.is-go { animation: lk-flash .5s ease-out; }
@keyframes lk-flash {
  0% { opacity: 0; transform: scale(.86); }
  22% { opacity: .55; }
  100% { opacity: 0; transform: scale(1.06); }
}
.lk__plate {
  display: grid; gap: 3px; padding: 10px 12px;
  border: 1px solid var(--lk-line); border-radius: 10px;
  background: linear-gradient(180deg, var(--lk-panel-2), var(--lk-panel));
  /* specs/0012 §C — no left stripe. The brand line above the name is already
     accent-coloured; the plate did not need a second one turned on its side. */
}
.lk__plate-brand {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--lk-acc);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__plate-name { font-size: 16px; font-weight: 680; letter-spacing: -.01em; line-height: 1.15; }
.lk__plate-tag {
  font-family: var(--lk-mono); font-size: 9.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--lk-ink-3);
}

/* ---- middle: filters + the card grid */
.lk__mid { grid-area: grid; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; min-height: 0; }
.lk__filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lk__filters[hidden] { display: none; }
.lk__chip {
  display: inline-flex; align-items: baseline; gap: 6px; cursor: pointer;
  padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--lk-line-2);
  background: rgba(255,255,255,.02);
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__chip i { font-style: normal; font-variant-numeric: tabular-nums; opacity: .7; letter-spacing: 0; }
.lk__chip::before {
  content: ""; width: 7px; height: 7px; border-radius: 2px; flex: none;
  background: var(--g, var(--lk-ink-3)); align-self: center;
}
.lk__chip:hover { color: var(--lk-ink); border-color: var(--g, var(--lk-line-2)); }
.lk__chip.is-on {
  color: #08111a; border-color: var(--g, var(--lk-acc));
  background: var(--g, var(--lk-acc));
}
.lk__chip.is-on::before { background: rgba(0,0,0,.42); }

.lk__grid {
  display: grid; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  overflow-y: auto; overflow-x: hidden;
  min-height: 0; padding: 8px 10px 14px 6px;
  scrollbar-color: var(--lk-line-2) transparent;
}
.lk__grid::-webkit-scrollbar { width: 9px; }
.lk__grid::-webkit-scrollbar-track { background: transparent; }
.lk__grid::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.lk__grid::-webkit-scrollbar-thumb:hover { background: var(--lk-ink-3); background-clip: content-box; }
.lk__grid.is-swap { animation: lk-swap .22s ease-out; }
@keyframes lk-swap { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }

/* ---- the card */
.lk__card {
  position: relative; display: grid; gap: 7px; cursor: pointer; text-align: left;
  padding: 9px 9px 10px;
  border: 1px solid var(--lk-line);
  border-radius: 11px;
  background:
    linear-gradient(158deg, var(--g-wash) 0%, var(--lk-panel-2) 58%, var(--lk-panel-2) 100%);
  /* border-color is the selection ring and is deliberately NOT transitioned —
     see the note on .lk__tab. The lift and the glow are decoration and may lag. */
  transition: transform .14s cubic-bezier(.2,.8,.25,1), box-shadow .18s;
}
.lk__card:hover {
  transform: translateY(-3px);
  border-color: var(--g);
  box-shadow: 0 12px 26px rgba(0,0,0,.5), 0 0 22px -8px var(--g-glow);
}
.lk__card.is-sel {
  transform: translateY(-3px);
  border-color: var(--lk-acc);
  box-shadow: 0 0 0 1px var(--lk-acc), 0 14px 30px rgba(0,0,0,.55), 0 0 26px -6px var(--lk-acc);
}
.lk__card.is-eq { background: linear-gradient(158deg, var(--g-wash) 0%, var(--lk-panel-3) 62%, var(--lk-panel-2) 100%); }
.lk__card.is-go { animation: lk-equip .42s cubic-bezier(.2,.9,.25,1); }
@keyframes lk-equip {
  0% { transform: translateY(-3px) scale(1); }
  34% { transform: translateY(-6px) scale(1.045); }
  100% { transform: translateY(-3px) scale(1); }
}
.lk__art {
  position: relative; display: grid; place-items: center;
  height: 78px; border-radius: 8px; overflow: hidden;
  background: linear-gradient(180deg, rgba(0,0,0,.34), rgba(0,0,0,.16));
  box-shadow: 0 1px 0 rgba(255,255,255,.045) inset;
}
.lk__img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.lk__gchip {
  position: absolute; top: 6px; right: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 999px;
  background: var(--g); color: #08111a;
}
.lk__brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--g);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__name {
  /* two lines' worth whether the name needs them or not, so a rack that mixes
     "Trek Ticket DJ" with "Specialized Epic Hardtail" still rules a level grid */
  font-size: 12.5px; font-weight: 640; line-height: 1.22; min-height: 2.44em;
  color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lk__tag {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__eq {
  position: absolute; left: 9px; top: 9px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 7px 3px 5px; border-radius: 999px;
  background: var(--lk-acc); color: #08111a;
  box-shadow: 0 2px 10px rgba(0,0,0,.4);
}
.lk__eq::before { content: "\\2713"; font-size: 9px; letter-spacing: 0; }

/* ---- specs/0019: the settings rows.
   The same grid element the cards live in, switched to one full-width column,
   so the scrolling, the keyboard selection and the swap animation are the ones
   that already work rather than a second implementation of them. */
.lk__grid.is-rows { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.lk__row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 8px 16px; cursor: pointer; text-align: left;
  padding: 13px 15px;
  border: 1px solid var(--lk-line); border-radius: 11px;
  background: linear-gradient(158deg, rgba(255,255,255,.03) 0%, var(--lk-panel-2) 62%, var(--lk-panel-2) 100%);
  /* border-color is the selection ring: not transitioned, same note as .lk__tab */
  transition: transform .14s cubic-bezier(.2,.8,.25,1), box-shadow .18s;
}
.lk__row:hover { transform: translateY(-2px); border-color: var(--lk-line-2); }
.lk__row.is-sel {
  transform: translateY(-2px);
  border-color: var(--lk-acc);
  box-shadow: 0 0 0 1px var(--lk-acc), 0 12px 26px rgba(0,0,0,.5);
}
.lk__row.is-go { animation: lk-equip .42s cubic-bezier(.2,.9,.25,1); }
/* both are SPANS in a <button> (a button may not contain a <div>), so they have
   to be told to be blocks — left inline they set as one paragraph and the label
   runs straight into the sentence after it */
.lk__row-t {
  display: block;
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__row-d { display: block; font-size: 11.5px; line-height: 1.45; color: var(--lk-ink-2); margin-top: 5px; }
.lk__row-txt { display: block; min-width: 0; }
/* the switch: a track, a knob, and a word. NOTHING here is transitioned, and
   that is the .lk__tab note applied to the one control on this screen where
   being wrong for a moment is worst: a transition runs on the document's
   animation clock, and on a frame-starved deck (a heavy world behind the panel,
   a software rasteriser) that clock stalls — the first cut animated the knob's
   travel and photographed a switch reading ON with its knob still hard left.
   A switch may not lie about its state for even one frame. */
.lk__sw { display: inline-flex; align-items: center; gap: 9px; }
.lk__sw-t {
  position: relative; width: 42px; height: 22px; border-radius: 999px; flex: none;
  background: var(--lk-panel-3);
  border: 1px solid var(--lk-line-2);
}
.lk__sw-t::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--lk-ink-3);
}
.lk__sw-v {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink-3);
  width: 3ch;
}
.lk__sw.is-on .lk__sw-t { background: var(--lk-acc); border-color: var(--lk-acc); }
.lk__sw.is-on .lk__sw-t::after { background: #08111a; transform: translateX(20px); }
.lk__sw.is-on .lk__sw-v { color: var(--lk-acc); }

/* ---- right: the detail panel */
.lk__det {
  grid-area: det; min-height: 0;
  display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); gap: 11px;
  padding: 12px; border: 1px solid var(--lk-line); border-radius: 12px;
  background: linear-gradient(180deg, var(--lk-panel-2) 0%, var(--lk-panel) 100%);
  overflow: hidden;
}
.lk__hero {
  /* the art grows into whatever height the deck has spare — 132 px at 720p,
     ~190 px at 1080p — instead of leaving the panel's foot empty */
  position: relative; height: clamp(132px, 18vh, 216px);
  border-radius: 10px; overflow: hidden;
  display: grid; place-items: center;
  background: linear-gradient(180deg, rgba(0,0,0,.4), rgba(0,0,0,.2));
  border: 1px solid var(--lk-line);
}
/* the same art, blown up and blurred, as its own backdrop — depth for free */
.lk__hero-bg {
  position: absolute; inset: -18%;
  background-position: center; background-repeat: no-repeat; background-size: cover;
  filter: blur(20px) saturate(1.5); opacity: .38; transform: scale(1.1);
}
.lk__hero-img { position: relative; max-width: 92%; max-height: 82%; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,.55)); }
.lk__hero-eq {
  position: absolute; right: 8px; top: 8px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 999px;
  background: var(--lk-acc); color: #08111a;
}
.lk__d-head { display: grid; gap: 3px; }
.lk__d-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--g, var(--lk-acc));
}
.lk__d-name { font-size: 17px; font-weight: 680; letter-spacing: -.012em; line-height: 1.14; }
.lk__d-spec {
  font-family: var(--lk-mono); font-size: 10px; letter-spacing: .02em; color: var(--lk-ink-2);
}
.lk__d-blurb {
  font-size: 11.5px; line-height: 1.5; color: var(--lk-ink-2);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}

/* ---- stat bars, with the delta against what is equipped */
.lk__stats { display: grid; gap: 6px; align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0; }
.lk__stats::-webkit-scrollbar { width: 7px; }
.lk__stats::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; }
.lk__stat { display: grid; grid-template-columns: 68px minmax(0, 1fr) 30px 34px; align-items: center; gap: 8px; }
.lk__stat-k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__stat-t {
  position: relative; height: 7px; border-radius: 999px; overflow: hidden;
  background: var(--lk-panel-3); box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset;
}
.lk__stat-t i, .lk__stat-t u {
  position: absolute; top: 0; bottom: 0; display: block;
  transition: left .18s ease-out, width .18s ease-out, background .2s;
}
/* the bar itself stops at the SHARED value; the delta segment carries the sign */
.lk__stat-t i { left: 0; width: 0; background: linear-gradient(90deg, var(--lk-acc-dim, #2a6f88), var(--lk-acc)); }
.lk__stat-t u { width: 0; text-decoration: none; }
.lk__stat-t u.is-up { background: var(--lk-good); box-shadow: 0 0 10px -1px var(--lk-good); }
.lk__stat-t u.is-down {
  background: repeating-linear-gradient(-45deg, var(--lk-bad) 0 3px, rgba(255,107,107,.45) 3px 6px);
}
.lk__stat-v {
  font-family: var(--lk-mono); font-size: 10px; font-variant-numeric: tabular-nums;
  text-align: right; color: var(--lk-ink);
}
.lk__stat-d {
  font-family: var(--lk-mono); font-size: 9.5px; font-variant-numeric: tabular-nums;
  text-align: right; color: var(--lk-ink-3);
}
.lk__stat-d.is-up { color: var(--lk-good); }
.lk__stat-d.is-down { color: var(--lk-bad); }
.lk__cmp {
  font-family: var(--lk-mono); font-size: 8.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--lk-ink-3);
  display: flex; align-items: center; gap: 6px;
}
.lk__cmp::before { content: ""; flex: 1 1 auto; height: 1px; background: var(--lk-line); }

.lk__facts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px;
  align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0;
  border-top: 1px solid var(--lk-line); padding-top: 9px;
}
.lk__facts::-webkit-scrollbar { width: 7px; }
.lk__facts::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; }
.lk__fact { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.lk__fact .k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__fact .v { font-family: var(--lk-mono); font-size: 10px; color: var(--lk-ink-2); font-variant-numeric: tabular-nums; }

/* ---------------------------------------------------------------- hint bar */
.lk__foot {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 9px 18px 10px; border-top: 1px solid var(--lk-line);
  background: rgba(0,0,0,.22);
}
.lk__hint { display: inline-flex; align-items: center; gap: 7px; }
.lk__hint span {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 19px; padding: 0 5px;
  border: 1px solid var(--lk-line-2); border-bottom-width: 2px; border-radius: 5px;
  background: linear-gradient(180deg, var(--lk-panel-3), var(--lk-panel-2));
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .04em; color: var(--lk-ink-2);
}
.lk__foot-sp { flex: 1 1 auto; }

/* ------------------------------------------------------------ narrow decks */
@media (max-width: 1180px) {
  .lk__main {
    grid-template-columns: 250px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 250px);
    grid-template-areas: "pv grid" "det det";
  }
  .lk__hero { height: 96px; }
  .lk__det { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: "hero head" "hero blurb" "stats facts"; column-gap: 14px; }
  .lk__hero { grid-area: hero; height: 100%; }
  .lk__d-head { grid-area: head; align-self: end; }
  .lk__d-blurb { grid-area: blurb; -webkit-line-clamp: 3; }
  .lk__stats { grid-area: stats; }
  .lk__facts { grid-area: facts; }
}
@media (max-width: 860px) {
  .lk__main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "pv" "grid" "det"; grid-template-rows: 190px minmax(0,1fr) 220px; }
  .lk__load { display: none; }
}
@media (max-height: 760px) {
  .lk__hero { height: 104px; }
  .lk__d-blurb { -webkit-line-clamp: 3; }
}

@media (prefers-reduced-motion: reduce) {
  .lk, .lk *, .lk *::before, .lk *::after {
    transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important;
  }
}
`;

let _cssDone = false;
function injectCSS() {
  if (_cssDone || typeof document === 'undefined') return;
  _cssDone = true;
  const s = document.createElement('style');
  s.id = 'lk-css';
  s.textContent = LOCKER_CSS;
  document.head.appendChild(s);
}

export function createInventory({ THREE, model, unitScale, ctrl, onEquip, initial }) {
  injectCSS();
  const u = unitScale || 1;
  let open = false;
  let tabIdx = 0;
  let filter = 'all';
  let sel = 0;                      // index into the filtered view
  let view = [];                    // the items currently on screen
  // what is equipped in each tab, so the locker can show "equipped" honestly
  // main.js hands us `initial` for the three racks that predate it; the sled and
  // the snowmobile resolve themselves off the same query string and storage the
  // player used, so every tab opens on what is actually equipped.
  let qs = null;
  try { qs = new URLSearchParams(location.search); } catch { qs = null; }
  const equipped = {
    skis: (initial && initial.skis) || SKI_DEFAULT,
    glider: (initial && initial.glider) || GLIDER_DEFAULT,
    bike: (initial && initial.bike) || BIKE_DEFAULT,
    sled: (initial && initial.sled) || (qs ? resolveSledId(qs) : SLED_DEFAULT),
    snowmobile: (initial && initial.snowmobile)
      || (qs ? resolveSnowmobileId(qs) : SNOWMOBILE_DEFAULT),
    // one entry today; the lookup is what a second pair would need, and costs
    // nothing while there is only one
    boots: recall('boots') || 'boots',
  };

  // ------------------------------------------------------------------ DOM
  const root = el('div', 'lk');
  root.hidden = true;
  const panel = el('section', 'lk__panel');

  // ---- header
  const hd = el('div', 'lk__hd');
  const title = el('div', 'lk__title');
  title.innerHTML = 'equipment <b>locker</b>';
  const load = el('div', 'lk__load');
  const loadRow = {};
  for (const t of TABS) {
    // the loadout strip reads gear: not feet, and not the settings page, which
    // equips nothing and so has nothing to report here
    if (t.id === 'boots' || t.kind === 'settings') continue;
    const w = el('div', 'lk__load-i');
    const v = el('span', 'lk__load-v', '—');
    w.append(el('span', 'lk__load-k', t.label), v);
    load.append(w);
    loadRow[t.id] = v;
  }
  hd.append(title, el('span', 'lk__spacer'), load);

  // ---- tabs
  const tabsEl = el('div', 'lk__tabs');
  const tabBtns = TABS.map((t, i) => {
    const b = el('button', 'lk__tab');
    b.type = 'button';
    b.style.setProperty('--lk-tab-acc', t.accent || '#4cc9f0');
    const ic = el('span', 'lk__tab-ic');
    ic.innerHTML = iconSVG(t.icon);
    const n = el('span', 'lk__tab-n', '0');
    b.append(ic.firstChild, el('span', 'lk__tab-l', t.label), n);
    b.addEventListener('click', (e) => { e.stopPropagation(); setTab(i); });
    tabsEl.append(b);
    return { b, n };
  });

  const main = el('div', 'lk__main');

  // ---- left: the live preview
  const left = el('div', 'lk__pv');
  const stage = el('div', 'lk__stage');
  const eqFlash = el('div', 'lk__eqflash');
  stage.append(eqFlash);
  const plate = el('div', 'lk__plate');
  const capBrand = el('div', 'lk__plate-brand', '');
  const capName = el('div', 'lk__plate-name', '—');
  const capTag = el('div', 'lk__plate-tag', '');
  plate.append(capBrand, capName, capTag);
  left.append(stage, plate);

  // ---- middle: filters + grid
  const mid = el('div', 'lk__mid');
  const filtersEl = el('div', 'lk__filters');
  const grid = el('div', 'lk__grid');
  mid.append(filtersEl, grid);

  // ---- right: the detail panel
  const det = el('div', 'lk__det');
  const hero = el('div', 'lk__hero');
  const heroBg = el('div', 'lk__hero-bg');
  const heroImg = el('img', 'lk__hero-img');
  heroImg.alt = '';
  const heroEq = el('div', 'lk__hero-eq', 'equipped');
  heroEq.hidden = true;
  hero.append(heroBg, heroImg, heroEq);
  const dHead = el('div', 'lk__d-head');
  const dBrand = el('div', 'lk__d-brand', '');
  const dName = el('div', 'lk__d-name', '—');
  const dSpec = el('div', 'lk__d-spec', '');
  dHead.append(dBrand, dName, dSpec);
  const dBlurb = el('div', 'lk__d-blurb', '');
  const statsBox = el('div', 'lk__stats');
  const cmpLine = el('div', 'lk__cmp');
  const factsEl = el('div', 'lk__facts');
  // hero / head / blurb / bars size to their content; the fact sheet takes what
  // is left and scrolls, so no rack can push the panel past the viewport
  det.append(hero, dHead, dBlurb, statsBox, factsEl);

  main.append(left, mid, det);

  // ---- hint bar
  const foot = el('div', 'lk__foot');
  const hintDefs = [
    [['←', '→', '↑', '↓'], 'navigate'],
    [['enter'], 'equip'],
    [['q', 'e'], 'tabs'],
    [['f'], 'filter'],
    [['1-9'], 'quick equip'],
  ];
  for (const [keys, what] of hintDefs) {
    const h = el('span', 'lk__hint');
    for (const k of keys) h.append(el('kbd', 'lk__key', k));
    h.append(el('span', null, what));
    foot.append(h);
  }
  foot.append(el('span', 'lk__foot-sp'));
  const closeHint = el('span', 'lk__hint');
  closeHint.append(el('kbd', 'lk__key', 'esc'), el('span', null, 'close'));
  foot.append(closeHint);

  panel.append(hd, tabsEl, main, foot);
  root.append(panel);
  document.body.appendChild(root);

  // ------------------------------------------------------------- preview 3D
  // Built on first open, not on boot: a second WebGL context is not something to
  // hand every play session that never presses I.
  let pv = null;
  function buildPreview() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xffd9c8, 0.5); fill.position.set(-4, 2, -3);
    scene.add(key, fill);

    const turntable = new THREE.Group();
    scene.add(turntable);
    const figure = model ? model.clone(true) : new THREE.Group();
    figure.position.set(0, 0, 0);
    figure.rotation.set(0, 0, 0);
    // The clone arrives with whatever the world had hidden at that instant, so
    // everything is shown and then every GEAR RIG is hidden again by name. That
    // second sweep is a pattern, not a list, and deliberately so: the previous
    // version named the three rigs it knew about, and the day a sled and a
    // snowmobile were added to main.js both stood in the locker on every tab.
    // dressPreview shows back only the one rig the current tab is about.
    figure.traverse((o) => { o.visible = true; });
    const GEAR_RIG = /^play:(?:fp-|tp-)|^play:ski-[lr]$|^play:rocket-pack$/;
    figure.traverse((o) => { if (o.name && GEAR_RIG.test(o.name)) o.visible = false; });
    const cGlide = figure.getObjectByName('play:tp-glider');
    const cBody = figure.getObjectByName('play:body');
    const cPack = figure.getObjectByName('play:rocket-pack');
    turntable.add(figure);

    const skiL = makeSkiRig(THREE, u), skiR = makeSkiRig(THREE, u);
    skiL.position.set(-0.15 * u, 0.02 * u, 0);
    skiR.position.set(0.15 * u, 0.02 * u, 0);
    turntable.add(skiL, skiR);

    // the bike brings its own rider (posed to its grips and pedals in bike.js),
    // so on the bike tab the cloned mannequin steps aside entirely
    const bike = makeBikeRig(THREE, u);
    bike.visible = false;
    turntable.add(bike);

    // the sled and the snowmobile carry their own rider too (a seated one and a
    // kneeling one), so those tabs stand the mannequin down exactly like the bike
    const sled = makeSledRig(THREE, u);
    sled.visible = false;
    turntable.add(sled);
    const snow = makeSnowmobileRig(THREE, u, { model: equipped.snowmobile });
    snow.visible = false;
    turntable.add(snow);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.05 * u, 80 * u);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.domElement.className = 'lk__canvas';
    stage.insertBefore(renderer.domElement, eqFlash);
    pv = { scene, camera, renderer, turntable, skiL, skiR, bike, sled, snow,
      cGlide, cBody, cPack, t: 0, kick: 0 };
    resizePreview();
  }

  // The preview column is a tall slot — 318×647 on a 1080p deck — and `fov` is
  // the VERTICAL one, so rendering to the whole slot leaves the camera choosing
  // between cropping a 2.3 m bike off the sides and retreating until the rider
  // is a speck. Neither is the shot. Instead the 3D viewport is a band no taller
  // than 4:3 of its width, centred in the stage; the stage keeps its full-height
  // plate and floor glow, and the framing is the same at 720p and 1440p.
  function resizePreview() {
    if (!pv) return;
    const sw = Math.max(80, stage.clientWidth), sh = Math.max(80, stage.clientHeight);
    const h = Math.max(80, Math.min(sh, Math.round(sw * 4 / 3)));
    pv.renderer.setSize(sw, h, false);
    pv.renderer.domElement.style.height = h + 'px';
    pv.renderer.domElement.style.top = Math.round((sh - h) / 2) + 'px';
    pv.camera.aspect = sw / h;
    pv.camera.updateProjectionMatrix();
  }

  // what the mannequin is wearing right now
  function dressPreview(tab, item) {
    if (!pv) return;
    const ski = tab.kind === 'ski';
    // the glider tab dresses per MODEL, not per tab: the wing hangs the prone
    // pilot, the pack straps to the standing body
    const shape = tab.kind === 'glider' && item ? item.preview : null;
    const glide = shape === 'wing';
    const onBike = tab.kind === 'bike';
    const onSled = tab.kind === 'sled';
    const onSnow = tab.kind === 'snowmobile';
    // every rig that brings its own rider stands the cloned mannequin down
    const ridden = onBike || onSled || onSnow;
    pv.skiL.visible = pv.skiR.visible = ski;
    if (pv.cGlide) pv.cGlide.visible = glide;
    if (pv.cBody) pv.cBody.visible = !glide && !ridden;
    if (pv.cPack) pv.cPack.visible = shape === 'pack';
    pv.bike.visible = onBike;
    pv.sled.visible = onSled;
    pv.snow.visible = onSnow;
    if (onBike && item) styleBikeRig(THREE, pv.bike, item.id, { rider: 'tp' });
    if (onSled && item) styleSledRig(THREE, pv.sled, item.id);
    if (onSnow && item) styleSnowmobileRig(THREE, pv.snow, item.id);
    if (ski && item) {
      styleSkiRig(THREE, pv.skiL, item.id);
      styleSkiRig(THREE, pv.skiR, item.id);
    }
  }

  // A slow idle turntable — 0.28 rad/s, about 22 s a revolution, plus a breath
  // of vertical sway so a still frame never looks frozen. Equipping adds a kick
  // that decays; nothing here is load-bearing, and the equip swap itself is
  // instant (dressPreview runs synchronously in paintSel).
  const IDLE_SPIN = 0.28;
  let raf = 0, last = 0;
  function loop(now) {
    if (!open) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!pv) return;
    pv.t += dt;
    pv.turntable.rotation.y += dt * (IDLE_SPIN + pv.kick);
    pv.kick *= Math.exp(-dt * 3.4);
    if (pv.kick < 0.001) pv.kick = 0;
    // Frame the figure from the stage's ACTUAL aspect rather than a fixed 4.2u.
    // The locker's preview column is tall and narrow, and `fov` is the vertical
    // one — at a 0.76 aspect a hardcoded distance crops a 2.3 m ski clean off
    // the sides. Pull back to whichever of the two constraints binds: 1.12u of
    // half-height, or 1.30u of half-width once the turntable swings side-on.
    const tan = Math.tan((pv.camera.fov * Math.PI / 180) / 2);
    const d = Math.max(1.12 / tan, 1.30 / (tan * Math.max(0.25, pv.camera.aspect))) * u;
    pv.camera.position.set(0, (1.30 + 0.012 * Math.sin(pv.t * 0.7)) * u, d);
    pv.camera.lookAt(0, 0.86 * u, 0);
    pv.renderer.render(pv.scene, pv.camera);
  }

  // ----------------------------------------------------------------- render
  const tab = () => TABS[tabIdx];

  // A rack is another module's data, and it can change under this screen —
  // a registry mid-rename, a model that lost the field its card reads. Every
  // read of a tab's contents goes through here, so a rack that throws costs
  // its own tab (hidden, and stepped over by Q/E) instead of taking the whole
  // locker down. A rack that recovers un-hides itself on the next render.
  const broken = new Set();
  function safeItems(t) {
    try {
      const r = t.items();
      if (Array.isArray(r)) { broken.delete(t.id); return r; }
    } catch (e) {
      if (!broken.has(t.id)) console.warn(`[locker] rack "${t.id}" unavailable:`, e && e.message);
    }
    broken.add(t.id);
    return [];
  }

  function groupsOf(items) {
    const seen = [];
    for (const it of items) if (it.group && !seen.includes(it.group)) seen.push(it.group);
    return seen;
  }

  // the accent belongs to the tab; everything tinted reads it off the root
  function applyAccent() {
    const a = tab().accent || '#4cc9f0';
    root.style.setProperty('--lk-acc', a);
    root.style.setProperty('--lk-acc-soft', rgba(a, 0.18));
    root.style.setProperty('--lk-acc-dim', rgba(a, 0.34));
  }

  function renderTabCounts() {
    TABS.forEach((t, i) => {
      tabBtns[i].n.textContent = String(safeItems(t).length);
      // a rack that is not there is not advertised
      tabBtns[i].b.hidden = broken.has(t.id);
    });
  }

  function renderLoadout() {
    for (const t of TABS) {
      if (!loadRow[t.id]) continue;
      const it = safeItems(t).find((x) => x.id === equipped[t.id]);
      loadRow[t.id].parentElement.hidden = broken.has(t.id);
      loadRow[t.id].textContent = it ? it.name : '—';
    }
  }

  function renderFilters() {
    const all = safeItems(tab());
    const gs = groupsOf(all);
    filtersEl.textContent = '';
    filtersEl.hidden = gs.length < 2;
    if (gs.length < 2) return;
    const counts = { all: all.length };
    for (const g of gs) counts[g] = all.filter((i) => i.group === g).length;
    for (const g of ['all', ...gs]) {
      const b = el('button', 'lk__chip');
      b.type = 'button';
      b.style.setProperty('--g', g === 'all' ? (tab().accent || '#4cc9f0') : groupTint(g));
      b.append(document.createTextNode(g), el('i', null, String(counts[g])));
      b.classList.toggle('is-on', filter === g);
      b.addEventListener('click', (e) => { e.stopPropagation(); filter = g; sel = 0; renderAll(); });
      filtersEl.append(b);
    }
  }

  // ------------------------------------------------------- specs/0019: rows
  // The settings page is a list, not a grid of cards, and this is the whole of
  // the difference: one row element per knob, built into the same `grid` node so
  // the scroll box, the keyboard selection and the swap animation are shared.
  // `paintSwitch` is separated from `renderRow` because a toggle must not
  // rebuild the list — rebuilding would fire mouseenter on whatever row the
  // cursor is over and drag the keyboard selection back to it, the same bug
  // paintBadges() exists to avoid on the card grid.
  const swOf = new WeakMap();                       // row element -> its switch
  function paintSwitch(c, key) {
    const sw = swOf.get(c);
    if (!sw) return;
    const on = getSetting(key);
    sw.el.classList.toggle('is-on', on);
    sw.v.textContent = on ? 'on' : 'off';
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  function renderRow(it, i) {
    const c = el('button', 'lk__row');
    c.type = 'button';
    c.setAttribute('role', 'switch');
    const txt = el('span', 'lk__row-txt');
    txt.append(el('span', 'lk__row-t', it.name), el('span', 'lk__row-d', it.desc || ''));
    const sw = el('span', 'lk__sw');
    const v = el('span', 'lk__sw-v', 'off');
    sw.append(el('span', 'lk__sw-t'), v);
    swOf.set(c, { el: sw, v });
    c.append(txt, sw);
    paintSwitch(c, it.key);
    c.addEventListener('click', (e) => { e.stopPropagation(); sel = i; paintSel(); equip(); });
    c.addEventListener('mouseenter', () => { sel = i; paintSel(); });
    grid.append(c);
    return c;
  }

  let cards = [];
  let scale = [];                                   // the stat scale for this tab
  function renderGrid() {
    const t = tab();
    const all = safeItems(t);
    scale = statScale(all);
    view = filter === 'all' ? all : all.filter((i) => i.group === filter);
    if (!view.length) view = all;
    sel = Math.max(0, Math.min(sel, view.length - 1));
    grid.textContent = '';
    grid.classList.toggle('is-rows', t.kind === 'settings');
    if (t.kind === 'settings') { cards = view.map(renderRow); paintSel(); return; }
    cards = view.map((it, i) => {
      const g = groupTint(it.group);
      const c = el('button', 'lk__card');
      c.type = 'button';
      c.style.setProperty('--g', g);
      c.style.setProperty('--g-wash', rgba(g, 0.16));
      c.style.setProperty('--g-glow', rgba(g, 0.55));
      const art = el('span', 'lk__art');
      const img = el('img', 'lk__img');
      img.alt = '';
      if (it.thumb) img.src = it.thumb; else img.hidden = true;
      art.append(img);
      if (it.group) art.append(el('span', 'lk__gchip', it.group));
      c.append(art, el('span', 'lk__brand', it.brand || ''), el('span', 'lk__name', it.name),
        el('span', 'lk__tag', it.tag || ''));
      if (equipped[tab().id] === it.id) { c.append(el('span', 'lk__eq', 'equipped')); c.classList.add('is-eq'); }
      c.addEventListener('click', (e) => { e.stopPropagation(); sel = i; paintSel(); equip(); });
      c.addEventListener('mouseenter', () => { sel = i; paintSel(); });
      grid.append(c);
      return c;
    });
    paintSel();
  }

  // ---- the bars. Each row draws the value the SELECTED item has, and the part
  // of it that is a gain or a loss against what is currently equipped: green
  // riding on top of the shared span, hatched red beyond the new (shorter) fill.
  const statRows = [];
  function renderStats(it) {
    const eqIt = safeItems(tab()).find((x) => x.id === equipped[tab().id]) || null;
    const same = eqIt && eqIt.id === it.id;
    statsBox.textContent = '';
    statRows.length = 0;
    for (const def of scale) {
      const v = statNorm(def, it.stats[def.key]);
      const e = eqIt && num(eqIt.stats[def.key]) ? statNorm(def, eqIt.stats[def.key]) : v;
      const r = el('div', 'lk__stat');
      const track = el('span', 'lk__stat-t');
      const fill = el('i');
      const delta = el('u');
      const shared = Math.min(v, e);
      fill.style.width = (shared * 100).toFixed(1) + '%';
      if (!same && Math.abs(v - e) > 0.004) {
        delta.style.left = (shared * 100).toFixed(1) + '%';
        delta.style.width = (Math.abs(v - e) * 100).toFixed(1) + '%';
        delta.classList.add(v > e ? 'is-up' : 'is-down');
      } else {
        fill.style.width = (v * 100).toFixed(1) + '%';
      }
      track.append(fill, delta);
      const val = el('span', 'lk__stat-v', String(Math.round(v * 100)));
      const d = Math.round((v - e) * 100);
      const dEl = el('span', 'lk__stat-d', same || d === 0 ? '' : (d > 0 ? '+' : '−') + Math.abs(d));
      if (!same && d !== 0) dEl.classList.add(d > 0 ? 'is-up' : 'is-down');
      // the honest number the bar came from, on hover
      const raw = def.src && num(it.stats[def.src]) ? it.stats[def.src] : it.stats[def.key];
      r.title = `${def.label}: ${raw.toFixed(2)}${def.suffix || ''}`;
      r.append(el('span', 'lk__stat-k', def.label), track, val, dEl);
      statsBox.append(r);
      statRows.push(r);
    }
    if (scale.length) {
      cmpLine.textContent = same || !eqIt ? 'equipped' : 'vs ' + eqIt.name;
      statsBox.append(cmpLine);
    }
  }

  // specs/0019 — the settings page's own detail panel. The hero art and the
  // stat bars are about an ITEM and there is no item here, so both stand down;
  // what is left is the same head/blurb/fact-sheet furniture saying what the
  // knob is and where it stands. THE PREVIEW COLUMN IS NOT TOUCHED: the
  // mannequin keeps wearing whatever the last gear tab dressed it in, because
  // this tab equips nothing and a figure that undressed itself when you opened
  // the settings would be saying something untrue about your loadout.
  function paintSettings(it) {
    det.style.setProperty('--g', tab().accent);
    heroImg.hidden = true;
    heroBg.style.backgroundImage = 'none';
    heroEq.hidden = true;
    hero.hidden = true;
    statsBox.textContent = '';
    dBrand.textContent = 'settings';
    dName.textContent = it.name;
    dSpec.textContent = getSetting(it.key) ? 'on' : 'off';
    dBlurb.textContent = it.desc || '';
    factsEl.textContent = '';
    for (const [k, v] of [['state', getSetting(it.key) ? 'on' : 'off'], ['default', 'off']]) {
      const r = el('div', 'lk__fact');
      r.append(el('span', 'k', k), el('span', 'v', v));
      factsEl.append(r);
    }
  }

  function paintSel() {
    cards.forEach((c, i) => c.classList.toggle('is-sel', i === sel));
    const it = view[sel];
    if (!it) return;
    if (cards[sel] && cards[sel].scrollIntoView) cards[sel].scrollIntoView({ block: 'nearest' });
    if (tab().kind === 'settings') { paintSettings(it); return; }
    hero.hidden = false;
    const g = groupTint(it.group);
    det.style.setProperty('--g', g);
    const isEq = equipped[tab().id] === it.id;
    // a thumbless item hides the art rather than setting src="", which some
    // browsers resolve as a second request for the page itself
    heroImg.hidden = !it.thumb;
    if (it.thumb) heroImg.src = it.thumb;
    heroBg.style.backgroundImage = it.thumb ? `url(${it.thumb})` : 'none';
    heroEq.hidden = !isEq;
    dBrand.textContent = it.brand || '';
    dName.textContent = it.name;
    dSpec.textContent = it.spec || it.tag || '';
    dBlurb.textContent = it.blurb || '';
    capBrand.textContent = it.brand || '';
    capName.textContent = it.name;
    capTag.textContent = (it.tag || '') + (isEq ? ' · equipped' : '');
    renderStats(it);
    factsEl.textContent = '';
    for (const [k, v] of (it.facts || [])) {
      const r = el('div', 'lk__fact');
      r.append(el('span', 'k', k), el('span', 'v', String(v)));
      factsEl.append(r);
    }
    dressPreview(tab(), it);
  }

  function renderAll() {
    tabBtns.forEach((t, i) => t.b.classList.toggle('is-on', i === tabIdx));
    applyAccent();
    renderTabCounts();
    renderFilters();
    renderGrid();
    renderLoadout();
  }

  // `dir` is which way Q/E were walking, so a hidden rack in the middle of the
  // strip is stepped over rather than landed on. A click or a setTab(id) passes
  // no direction and searches forward.
  function setTab(i, dir = 1) {
    const from = tabIdx;
    // probe only the candidate — a tab is skipped once its own items() throws,
    // so the common case reads one rack rather than all six
    let n = ((i % TABS.length) + TABS.length) % TABS.length;
    for (let k = 0; k < TABS.length; k++) {
      safeItems(TABS[n]);
      if (!broken.has(TABS[n].id)) break;
      n = ((n + dir) % TABS.length + TABS.length) % TABS.length;
    }
    tabIdx = n;
    filter = 'all';
    const want = equipped[tab().id];
    const all = safeItems(tab());
    sel = Math.max(0, all.findIndex((it) => it.id === want));
    renderAll();
    if (from !== tabIdx) {
      grid.classList.remove('is-swap');
      void grid.offsetWidth;                       // restart the transition
      grid.classList.add('is-swap');
    }
  }

  // ----------------------------------------------------------------- equip
  function equip() {
    const t = tab(), it = view[sel];
    if (!it) return;
    // specs/0019 — on the settings page "equip" is "toggle", and that is the
    // whole of it: one write through settings.js, the row repainted from what
    // came back rather than from what we asked for, and the same landing click
    // the cards get. onEquip is NOT called — this tab changes no gear, so
    // main.js must never hear from it.
    if (t.kind === 'settings') {
      setSetting(it.key, !getSetting(it.key));
      const row = cards[sel];
      if (row) {
        paintSwitch(row, it.key);
        row.classList.remove('is-go'); void row.offsetWidth; row.classList.add('is-go');
      }
      paintSel();
      return;
    }
    equipped[t.id] = it.id;
    // a tab may bring its own persistence (every real rack does); the locker's
    // own localStorage key is the fallback for one that does not
    if (t.remember) t.remember(it.id);
    else if (t.kind === 'ski') rememberSkiId(it.id);
    else if (t.kind === 'glider') rememberGliderId(it.id);
    else if (t.kind === 'bike') rememberBikeId(it.id);
    else remember(t.id, it.id);
    if (t.apply) t.apply(it.id);
    // an item may name its own controller gear (the glider tab's two flight
    // models do); otherwise the tab's does
    if (onEquip) onEquip({ tab: t.id, gear: it.gear || t.gear, kind: t.kind, id: it.id, name: it.name });
    paintBadges();
    paintSel();
    renderLoadout();
    // the click of it landing: the card jumps, the stage flashes, the turntable
    // takes a kick. All decorative — nothing below is read by anything.
    const c = cards[sel];
    if (c) { c.classList.remove('is-go'); void c.offsetWidth; c.classList.add('is-go'); }
    eqFlash.classList.remove('is-go'); void eqFlash.offsetWidth; eqFlash.classList.add('is-go');
    if (pv) pv.kick = 2.6;
  }

  // Only the "equipped" stamps move — rebuilding the grid here would fire
  // mouseenter on whatever card the cursor happens to be over and drag the
  // keyboard selection back to it.
  function paintBadges() {
    cards.forEach((c, i) => {
      const has = c.querySelector('.lk__eq');
      const want = equipped[tab().id] === view[i].id;
      if (want && !has) c.append(el('span', 'lk__eq', 'equipped'));
      else if (!want && has) has.remove();
      c.classList.toggle('is-eq', want);
    });
  }

  // how many cards fit across, for up/down
  function cols() {
    // specs/0019 — the settings page is a LIST: up/down moves exactly one row,
    // and it says so rather than relying on the measurement below happening to
    // return 1 for a full-width row at every deck width
    if (tab().kind === 'settings') return 1;
    if (!cards.length) return 1;
    const w = cards[0].offsetWidth || 1;
    const gap = 10;
    return Math.max(1, Math.round((grid.clientWidth + gap) / (w + gap)));
  }

  // ------------------------------------------------------------------ open
  let outT = 0;
  function show() {
    if (open) return;
    open = true;
    if (outT) { clearTimeout(outT); outT = 0; }
    root.hidden = false;
    root.classList.remove('is-out');
    if (!pv) buildPreview(); else resizePreview();
    setTab(tabIdx);
    // Start the entrance off a forced reflow, NOT off requestAnimationFrame.
    // rAF is gated on compositor frames, and the frame you press I on is the
    // expensive one — under a slow first frame the panel sat invisible for the
    // best part of a second before the fade even began. Reading offsetWidth
    // commits the opacity:0 start state, so the transition still plays, and it
    // plays on wall-clock time like every other menu.
    void root.offsetWidth;
    root.classList.add('is-in');
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
    // one frame later the panel has laid out — size the canvas to what it got
    requestAnimationFrame(resizePreview);
  }
  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove('is-in');
    root.classList.add('is-out');
    // the panel is inert the instant open flips; the 150 ms is only the fade
    if (outT) clearTimeout(outT);
    outT = setTimeout(() => { outT = 0; if (!open) { root.hidden = true; root.classList.remove('is-out'); } }, 150);
  }

  addEventListener('resize', () => { if (open) resizePreview(); });

  return {
    root,
    isOpen: () => open,
    open: show,
    close: hide,
    toggle() { if (open) hide(); else show(); return open; },
    // returns true when the key was consumed (main.js swallows it either way)
    key(code) {
      if (!open) return false;
      if (code === 'Escape' || code === 'KeyI') { hide(); return true; }
      if (code === 'KeyQ') { setTab(tabIdx - 1, -1); return true; }
      if (code === 'KeyE' || code === 'Tab') { setTab(tabIdx + 1, 1); return true; }
      if (code === 'KeyF') {
        const gs = ['all', ...groupsOf(safeItems(tab()))];
        filter = gs[(gs.indexOf(filter) + 1) % gs.length];
        sel = 0; renderAll(); return true;
      }
      if (!view.length) return true;               // an empty rack swallows the rest
      if (code === 'ArrowLeft' || code === 'KeyA') { sel = (sel + view.length - 1) % view.length; paintSel(); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { sel = (sel + 1) % view.length; paintSel(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { sel = Math.max(0, sel - cols()); paintSel(); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { sel = Math.min(view.length - 1, sel + cols()); paintSel(); return true; }
      if (code === 'Enter' || code === 'Space') { equip(); return true; }
      const n = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (n) { const i = Number(n[1]) - 1; if (i < view.length) { sel = i; paintSel(); equip(); } return true; }
      return true;                      // everything else is swallowed while up
    },
    // ---- test + wiring surface
    // THE RACKS that are actually there; a rack that throws is not listed, and
    // neither is the settings page (specs/0019) — it holds no gear, main.js
    // reports this list as the loadout's gear types, and the deploy gate asserts
    // it is exactly the six racks in order. `pages()` below is where a non-rack
    // tab is visible, and `tab()` still names whichever tab is on screen.
    tabs: () => TABS.filter((t) => !broken.has(t.id) && t.kind !== 'settings').map((t) => t.id),
    pages: () => TABS.filter((t) => !broken.has(t.id) && t.kind === 'settings').map((t) => t.id),
    tab: () => tab().id,
    setTab: (id) => { const i = TABS.findIndex((t) => t.id === id); if (i >= 0) setTab(i); return tab().id; },
    filter: () => filter,
    setFilter: (f) => { filter = f; sel = 0; renderAll(); return filter; },
    items: () => view.map((i) => i.id),
    selected: () => (view[sel] ? view[sel].id : null),
    equipped: () => ({ ...equipped }),
    // main.js tells the locker what the world equipped without going through it
    noteEquipped(tabId, id) {
      if (equipped[tabId] !== undefined) {
        equipped[tabId] = id;
        if (open) { renderGrid(); renderLoadout(); }
      }
    },
  };
}
