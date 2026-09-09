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
  makeBikeRig, styleBikeRig, getBikeModel, bikeRider,
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
// specs/0038 — the OUTFIT rack. The 32 looks are rider.js's own list (it
// re-exports outfits/index.js), and the three functions beside it are the whole
// of what this screen needs from the rig: where a pick is remembered, what the
// player is wearing right now, and how to dress the PREVIEW rig alone.
// specs/0039 — and the six more it needs to build ONE PART of a look: the part
// order, the look codec, the painter (for the part thumbs, which crop a real
// atlas) and the palette accessor the cards quote a colour from.
// specs/0041 §4.8 — and the two the SKINNED rider adds: `cloneRig` (§2.7), the
// only thing that makes a mannequin which is not bound to the live bones, and
// `rigOf`, which is how this screen reaches the live rig from the `play:body`
// node it already knows by name.
import {
  OUTFITS, byCode, previewOutfit, toggleOf, rememberOutfit, resolveOutfit,
  PARTS, parseLook, serialise, paint, swatch, cloneRig, rigOf,
} from './rider.js';
// the atlas layout, so the part thumbs can crop the region (or the swatch cell)
// a part owns straight out of the painted 512² — generated data, read-only here
import { R as ATLAS_R, C as ATLAS_C } from './atlas.js';
// specs/0042 — what each invented house is after, one string per code. It is the
// one rider source that names real brands (C19 exempts that path), so it is read
// here and nowhere else; a code with no entry renders no line at all.
import AFTER from './outfits/after.js';
// specs/0019 — the settings page at the back of the locker. The knobs' values
// AND their copy live in settings.js; this file renders them and writes through
// it, and holds no copy of either.
import { KNOBS, get as getSetting, set as setSetting } from './settings.js';
// specs/0061 §3.2 — `hudKind` and `hudMark` join `hudSurf`: 0055 §1.7 makes
// hud.js the ONE mirror of markers.js's KINDS (importing markers.js from a
// module hud.js is above in the graph closes a temporal-dead-zone cycle), and
// §1.8's alphabet lives beside it. A canvas cannot read `--p-k-*`, so it reads
// the objects those properties are published from — and this file still types
// no kind and no severity hex of its own.
import { hudSurf, hudKind, hudMark } from './hud.js';
const CREAM_N = parseInt(hudSurf.cream.slice(1), 16);
// specs/0055 5.2 — the TRAIL QUICK-TRAVEL tab. The destinations are the ones
// spawn.js already derives from the world contract every boot; this file
// re-uses that index rather than listing a single place name of its own, so a
// waypoint added to world.mjs is a row here with no wiring. ALIASES is the one
// hand-curated layer spawn.js keeps — the names people type that no id spells —
// and it rides along as the alternate slug printed on the row.
import { waypointIndex, ALIASES } from './spawn.js';

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
  // specs/0055 5.2 — the trail tab's glyph. A ridge line with a blade sign on
  // it: struck at the same 1.7 on currentColor as the eight above, so the new
  // tab reads as one of the strip and not as a pasted-in icon.
  trail: '<path d="M2.6 19.4 8.4 9.1l3.3 5.1 2.6-3.9 5.1 9.1z"/><path d="M15.4 3.1h5.6v3.6h-5.6z"/><path d="M15.4 3.1V10"/>',
  // the toboggan in side view: curled nose to the right, deck, two runners
  sled: '<path d="M3.2 13.9h12.9c2.1 0 3.5-1.3 3.5-3 0-1.3-1-2.3-2.2-2.3s-2.2 1-2.2 2.3"/><path d="M4.4 18.2h12.2"/><path d="M5.8 13.9v4.3"/><path d="M13.9 13.9v4.3"/>',
  // track, tunnel, windshield and the front ski
  snowmobile: '<rect x="2.5" y="14.2" width="10.2" height="4.3" rx="2.1"/><path d="M12.7 16.3h3.5l2.4-2.3"/><path d="M8.4 14.2 10.1 9.6h3.8l1.3 2.7"/><path d="M14 9.6 16.1 7.2"/><path d="M17.2 18.5h3.3"/><path d="M18.9 13.4v5.1"/>',
  // specs/0019 — the cog. Two circles and eight teeth on the diagonals, struck
  // at the same 1.7 stroke on currentColor as the six above, so the settings tab
  // reads as one of the strip rather than as a pasted-in icon set.
  // specs/0038 — a race suit read from the front: shoulders and two sleeves, the
  // torso tapering to the waist, one notch at the collar. Same 1.7 stroke on
  // currentColor as the seven above, so the outfit tab reads as one of the strip.
  outfit: '<path d="M9 3.2h6l4.1 2.3-1.6 4.4-1.9-.8v11.7H7.4V9.1l-1.9.8L3.9 5.5z"/>'
    + '<path d="M9 3.2 12 6.4 15 3.2"/>',
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

// ------------------------------------------------------------ specs/0038: outfits
// The outfit rack is the one registry that ships NO PROSE. outfits/*.js are
// generated colour and op data and stay that way on purpose (0037 §3 — the
// whole rider set has a 32 KB brotli ceiling, and 32 hand-written paragraphs is
// most of a kilobyte of it). So everything a card says is derived: the spec line
// and the fact sheet from the look's own `flags`, the art from its `palette`,
// and the second half of the blurb from ONE sentence per family, written here.
// No numbers are invented — a suit has no top speed, so it ships no `stats` and
// statScale() draws no bars.
const EXTRA_FLAGS = [
  ['chinBar', 'chin bar'], ['visor', 'visor'], ['hood', 'hood'],
  ['guards', 'guards'], ['spine', 'spine plates'], ['belt', 'belt'],
];
const FAMILY_LINE = {
  race: 'Cut for the gates: one skin, no slack, nothing on it the clock has to carry.',
  shell: 'A jacket and pants built for the weather first and the lift queue second.',
  freeride: 'Bib pants under a short jacket, cut wide enough to sit down in the trees.',
  retro: "The loudest page of an old catalogue, reprinted without one apology for it.",
  armour: 'Plated where a fall lands — spine, chin and hands — worn over the suit.',
};

// Palette entries are 0xRRGGBB NUMBERS (rider.js paints its atlas straight off
// them), so the two conversions the card art needs happen once, here.
const pHex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const pLum = (n) => (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
const OUT_SANS = '900 %px "Helvetica Neue", Helvetica, Arial, sans-serif';
const _ot = new Map();
// The look as four bands in the same 300×58 frame the glyph swatches use, so
// the grid's object-fit does not have to reconcile a third aspect ratio: the
// jacket takes half the plate, then the pants, the helmet, and the one colour
// that is the look's signal — its accent if it has one, else the goggle strap,
// else the glove. The house rides the jacket block in whichever of the two inks
// stands further off it, which is the only way one painter serves a white dome
// and a black race suit.
function outfitThumbURL(o) {
  const hit = _ot.get(o.code);
  if (hit) return hit;
  const W = 300, H = 58, p = o.palette;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const jacket = p.jacket;
  const bands = [[0, 150, jacket], [150, 230, p.pants], [230, 275, p.helmet],
    [275, 300, p.accent != null ? p.accent : p.strap != null ? p.strap : p.glove]];
  for (const [x0, x1, v] of bands) {
    x.fillStyle = pHex(v == null ? jacket : v);
    x.fillRect(x0, 0, x1 - x0, H);
  }
  drawHouse(x, o, jacket, H);
  const url = c.toDataURL('image/png');
  _ot.set(o.code, url);
  return url;
}
// The house over a block of `bg`, shrink-to-fit and tracked, in whichever of the
// two inks stands further off it. Uppercase because the card's own brand line is
// (`.lk__brand`), and the art and the line under it saying the same word two ways
// reads as a mistake. One painter for the look thumbs and for the two part rows
// that fall back to palette blocks (specs/0039 §4.3).
function drawHouse(x, o, bg, H, room = 126) {
  const s = houseOf(o).toUpperCase(), track = 1.4;
  for (let size = 22; size > 9; size--) {
    x.font = OUT_SANS.replace('%', size);
    if (x.measureText(s).width + track * (s.length - 1) <= room) break;
  }
  // specs/0055 §1.1, §10.3 — the cream by name. The canvas cannot read a
  // custom property, so it reads the object the :root block is published from.
  x.fillStyle = Math.abs(pLum(bg) - pLum(CREAM_N)) >= Math.abs(pLum(bg) - pLum(0x17181a))
    ? hudSurf.cream : '#17181a';
  x.textBaseline = 'middle';
  let px = 12;
  for (const ch of s) { x.fillText(ch, px, H / 2); px += x.measureText(ch).width + track; }
}

const outfitExtras = (f) => EXTRA_FLAGS.filter(([k]) => f[k]).map(([, label]) => label);
// g00 is the lab's own look — 0037's "today's rider" — and the house on it is
// the LAB's wordmark, written into outfits/shell.js as a literal. On a shipped
// world the wordmark is that world's (flags.js `BRAND`, the same substitution
// the boots card makes), and smoke.mjs's "no POI-LAB left on any card" is the
// check that holds this file to it. The other twenty-six houses are invented
// and belong to no world, so they pass straight through.
const houseOf = (o) => (o.house === 'POI-LAB' ? BRAND : o.house);
function outfitItem(o) {
  const f = o.flags, extras = outfitExtras(f), house = houseOf(o);
  return {
    id: o.code, name: o.name, brand: house, tag: o.family, group: o.family,
    after: AFTER[o.code] || '',
    thumb: outfitThumbURL(o),
    spec: [`${f.torso} torso · ${f.helmet} helmet`, ...extras].join(' · '),
    facts: [
      ['house', house], ['family', o.family],
      ['torso', f.torso], ['helmet', f.helmet],
      ['extras', extras.join(', ') || '—'],
    ],
    blurb: `${house} ${o.name}. ${FAMILY_LINE[o.family] || ''}`.trim(),
  };
}

// ------------------------------------------------------- specs/0039: one part
// The outfit tab's eight sub-tabs. `looks` is 0038's tab body — the 32 whole
// looks — and the seven after it are the parts of specs/0039 §1, in head-to-poles
// order. Every sub-tab holds the same 32 houses; what changes is which SEVENTH
// of each house the card is about.
const SUBS = ['looks', ...PARTS];
// what a part's card says it is, off that house's own flags (§4.1). No prose is
// authored for this either — the flags ARE the spec line.
// specs/0045 §4.4 — the sub-tabs STAY SEVEN. Every one of the fourteen new flag
// keys is absorbed by the part that already owns its region and its flag, and
// this table is where a player is told which: `collar` and `head` under helmet
// (a stand collar and a robot skull both read as head silhouette at card size),
// the four bespoke kits under JACKET as one line each — picking Ferrum's jacket
// brings the pauldrons, the reactor and the gauntlets, because those are one
// character read and four sub-tabs would let a player build three quarters of
// it. rider.js's FLAG_OWN is the same table as data; this is its prose, and the
// two are read from the same §4.4 row. An omitted key is `undefined` and falls
// out at `.filter(Boolean)`, so a house that authors nothing new still says
// exactly what it says today.
const PART_SPEC = {
  helmet: (f) => [f.helmet, f.chinBar && 'chin bar', f.visor && 'visor',
    f.head === 'robot' && 'robot head', f.mask && 'mask', f.collar === 'stand' && 'stand collar'],
  goggles: (f) => [f.goggles === false || f.goggles === 'none' ? 'no goggles' : f.goggles === 'rimless' && 'rimless'],
  jacket: (f) => [f.torso + ' torso', f.hood && 'hood', f.spine && 'spine plates',
    f.hem && f.hem + ' hem', f.puffy && 'puffy', f.anorak && 'anorak',
    f.chestPlate && 'chest plate', f.pauldrons && 'pauldrons',
    f.kitFerrum && 'Ferrum kit', f.kitUmbra && 'Umbra kit', f.kitPhantom && 'Phantom kit', f.kitDuke && 'Duke kit'],
  pants: (f) => [f.pants && f.pants + ' fit', f.belt && 'belt', f.hipPlate && 'hip plate',
    f.bloused && 'bloused', f.beltBoxes && 'belt boxes'],
  // `guards` is 0037's ARM guards (App. A's `armGuards`, `rider:guard-l/r` off the
  // wrists) and 0045's `poleGuards` is the shield over the glove. The old card
  // read "pole guards" for the first of those, which was survivable while it was
  // the only pair on the rig and is not now that both can be worn at once.
  gloves: (f) => [f.guards && 'arm guards', f.poleGuards && 'pole guards'],
  boots: (f) => [f.boot && f.boot + ' boot', f.shinGuards && 'shin guards'],
  poles: () => [],
};
// the one palette key that IS the part, for the card's colour fact
const PART_LEAD = { helmet: 'helmet', goggles: 'lens', jacket: 'jacket', pants: 'pants',
  gloves: 'glove', boots: 'boot', poles: 'pole' };
// §4.3 — the thumb is a REAL CROP of the house's painted atlas, laid out to fill
// the same 300×58 frame every other card art uses: [region or swatch cell, then
// the destination box]. Each crop is stretched to its slot on purpose — a card is
// 130 px wide on screen and an aspect-correct 96² helmet would be a stamp on a
// grey field, where a full-bleed one reads as the colour and the marks it is.
const PART_CROP = {
  helmet: [['helmet', 0, 0, 300, 58]],
  goggles: [['lens', 0, 0, 300, 29], ['strap', 0, 29, 300, 29]],
  jacket: [['chestFront', 0, 0, 110, 58], ['back', 110, 0, 110, 58], ['sleeveL', 220, 0, 80, 58]],
  pants: [['legL', 0, 0, 200, 58], ['belt', 200, 0, 100, 58]],
  gloves: [['glove', 0, 0, 200, 58], ['poleGuards', 200, 0, 100, 58]],
};
// …except for two rows, where §4.3's stated fallback applies. Twenty-six of the
// twenty-seven houses ship the SAME near-black boot (0x17161a) and twenty-four
// the same pole, so a real crop of either is 32 identical bars — true, and no
// way at all to tell one card from another. Those two take the part's own
// palette blocks with the house written over them, the same painter the
// whole-look thumbs use. Every other part is a real crop. (Recorded in
// PROGRESS-0039; if a later bake gives the boots and the poles colours of their
// own, delete these two entries and the crop comes back.)
const PART_BLOCKS = { boots: ['boot'], poles: ['pole', 'poleBand'] };
const CELL_PX = 22;
const srcRect = (n) => (ATLAS_R[n] ? ATLAS_R[n].slice(0, 4) : [ATLAS_C[n][0], ATLAS_C[n][1], CELL_PX, CELL_PX]);

// All 7 × 32 thumbs come off 32 atlas paints, done once on the first render of
// any part sub-tab. The paints bypass rider.js's 12-look cache (`cache:false`)
// so 32 full-size canvases do not evict the look the player is actually wearing;
// the 189 data URLs land in the same `_sw` map the glyph swatches use, keyed
// `part:code`. The elapsed ms is on `__locker.thumbMs()` so PROGRESS can quote it.
let _ptDone = false, _ptMs = 0;
function buildPartThumbs() {
  const t0 = performance.now();
  for (const o of OUTFITS) {
    const { canvas } = paint(o.code, null, { cache: false });
    for (const p of PARTS) {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 58;
      const x = c.getContext('2d');
      const blocks = PART_BLOCKS[p];
      if (blocks) {
        const w = 300 / blocks.length;
        blocks.forEach((k, i) => { x.fillStyle = pHex(swatch(o.palette, k)); x.fillRect(i * w, 0, w, 58); });
        drawHouse(x, o, swatch(o.palette, blocks[0]), 58);
      } else {
        for (const [n, dx, dy, dw, dh] of PART_CROP[p]) {
          const [sx, sy, sw, sh] = srcRect(n);
          x.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
        }
      }
      _sw.set(p + ':' + o.code, c.toDataURL('image/png'));
    }
  }
  _ptDone = true;
  _ptMs = Math.round(performance.now() - t0);
}
function partThumbURL(o, p) {
  if (!_ptDone) buildPartThumbs();
  return _sw.get(p + ':' + o.code);
}

function partItem(o, p) {
  const house = houseOf(o);
  return {
    id: o.code, name: o.name, brand: house, group: o.family, tag: p,
    after: AFTER[o.code] || '',
    thumb: partThumbURL(o, p),
    spec: PART_SPEC[p](o.flags).filter(Boolean).join(' · ') || '—',
    facts: [
      ['house', house], ['family', o.family], ['part', p],
      ['colour', pHex(swatch(o.palette, PART_LEAD[p]))],
    ],
    blurb: `${house} ${o.name} — ${p}. ${FAMILY_LINE[o.family] || ''}`.trim(),
  };
}

// specs/0044 §A.5 — the one card on the whole rack that is not a house: NO GOGGLES.
// Its art is the FACE crop off g00's atlas — the eye marks and the brow the band
// has been hiding — in the same 300 × 58 frame as every other part thumb, because
// what you get for taking the goggles off is exactly that face. It carries no
// `group`, so it lives under the `all` chip and no family claims it.
const GOGGLES_NONE = 'x';
function noneThumbURL() {
  const key = 'goggles:' + GOGGLES_NONE;
  if (!_sw.has(key)) {
    const { canvas } = paint('g00', null, { cache: false });
    const c = document.createElement('canvas');
    c.width = 300; c.height = 58;
    const [sx, sy, sw, sh] = srcRect('face');
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, 300, 58);
    _sw.set(key, c.toDataURL('image/png'));
  }
  return _sw.get(key);
}
const noneItem = () => ({
  id: GOGGLES_NONE, name: 'No goggles', brand: '—', tag: 'goggles',
  thumb: noneThumbURL(),
  spec: 'bare face',
  facts: [['house', '—'], ['part', 'goggles'], ['colour', '—']],
  blurb: 'No goggles. The band comes off and the face is the face.',
});

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
  // ---- specs/0038. The 32 houses. It sits HERE, with the gear and before the
  // settings page, because the Q/E walk order is the loadout order and what you
  // are wearing is part of the loadout — settings is still the last tab, and the
  // note under it still says so.
  //
  // IT SWITCHES NO CONTROLLER MODE. `gear` is absent on purpose — see the note
  // in equip() on what that makes onEquip do — and it is also why this tab is
  // not in `tabs()` below: that list is the RACKS, the loadout's gear types,
  // and the deploy gate asserts it is exactly the six of them in order.
  //
  // IT ALSO NEEDS NOTHING FROM main.js (specs/0038 §4, deviation in
  // PROGRESS-0038): the equipped code resolves off the same `?outfit=` and
  // storage key the rider does, and show() re-reads `__player.outfit` on the way
  // in, so a console or URL change lands on the right card's badge. main.js's
  // C18 ownership ranges do not reach the createInventory call, and a locker tab
  // is not worth a stray hunk in them.
  {
    // rose: nothing in the strip is near it (skis cyan, bike and snowmobile
    // orange, glider violet, sled and boots tan, settings green)
    id: 'outfit', label: 'outfit', kind: 'outfit', icon: 'outfit', accent: '#ff5c8a',
    remember: rememberOutfit,                      // the same key `?outfit=` and __player read
    // specs/0039 — the SUB-TAB is passed in rather than read off this entry: the
    // strip's state lives in createInventory's closure (§3), and a TABS row is
    // data every locker on the page would share. On `looks` a card is a whole
    // look and `setOutfit` takes the code; on a part it is a partial object, and
    // the rig merges it over what is already worn.
    apply: (id, sub) => window.__player?.setOutfit?.(sub && sub !== 'looks' ? { [sub]: id } : id),
    // specs/0044 §A.5 — the goggles sub-tab is the one rack with a card in front of
    // the 32 houses: `none`, id `x`, which `apply` hands to setOutfit as the
    // partial `{ goggles: 'x' }` like any other code.
    items: (sub) => (!sub || sub === 'looks' ? OUTFITS.map(outfitItem)
      : [...(sub === 'goggles' ? [noneItem()] : []), ...OUTFITS.map((o) => partItem(o, sub))]),
  },
  // ---- specs/0055 5.2 (D15). THE ONE ROW THIS SPEC ADDS, and it goes here:
  // BEFORE settings, because settings is the back of the locker and a
  // destination list is not a settings page. It equips nothing — `gear` and
  // `remember` are absent for the same reason they are absent on settings, so
  // `tabs()` still reports exactly the six racks and `onEquip` never fires —
  // and `kind: 'trail'` is the one word the render/detail/nav branches below
  // read, exactly the way `kind: 'settings'` has worked since 0019.
  //
  // The rows are `trailRows(world, upAxis)` above: derived from the world
  // contract on every open, never hand-listed, so `the-nose-drop-in` is a row
  // the day world.mjs declares it. `items()` closes over the world main.js
  // handed this screen; a build that hands none simply has an empty tab.
  {
    id: 'trails', label: 'trails', kind: 'trail', icon: 'trail', accent: '#4cc9f0',
    items: () => trailRows(WORLD, UPAXIS),
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
    // specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI) -- `def` rides along
    // now. The two 0019 knobs are both `false` and the detail panel hardcoded
    // that word; the LAB UI row defaults ON, and a fact row reading "default
    // off" beside a switch that ships on is simply wrong.
    items: () => KNOBS.map((k) => ({
      id: k.key, key: k.key, name: k.label, desc: k.desc, def: !!k.def,
    })),
  },
];

// --------------------------------------------------- specs/0055 5.2: trails
// THE ROWS ARE DERIVED AND NEVER HAND-LISTED. `waypointIndex(world, upAxis)`
// (spawn.js:66-80) is the same table `?spawn=` and the pretty path `/kt22`
// resolve against: markers first, then run drop-ins, then lift tops, ids
// beating display names, first-wins. It keys BOTH spellings of every place at
// the same entry, so the rows are deduped on the entry's id and the extra slugs
// become the row's alternate names — which is where `village` -> `base-area`,
// `fingers` -> `the-fingers` and `eagles-nest` -> `kt22` come from, straight out
// of spawn.js's own ALIASES, with no second table here.
//
// THE DIFFICULTY MARK BELONGS TO THE TRAIL (D15). It is read off the world
// contract's own `diff` — `world.markers[].diff` for a marker, `world.runs[].diff`
// for a run — and nothing without one gets a mark. No equipment row anywhere in
// this file gains one.
const DIFF_RANK = { double: 4, black: 3, blue: 2, green: 1 };

// the severity alphabet (1.8): shape and colour by name, drawn by one CSS class
const DIFF_MARK = {
  green: { cls: 'is-circ', label: 'green circle' },
  blue: { cls: 'is-sq', label: 'blue square' },
  black: { cls: 'is-dia', label: 'black diamond' },
  double: { cls: 'is-dia2', label: 'double diamond' },
};

// world.markers say `ski-run` / `lift` / `venue` / `landmark`; waypointIndex
// says `marker` / `run` / `lift`. The row prints the more specific of the two.
const TRAIL_KIND = {
  'ski-run': 'run', 'bike-trail': 'trail', lift: 'lift',
  venue: 'venue', landmark: 'landmark', notice: 'notice',
};

// ------------------------------------------------- specs/0061 §1.6: ONE ROW PER RUN
// Greg, 2026-09-06: "There shouldnt be multiple clones of the same run in the
// run selector - just one per a run."
//
// 0055 §5.2 built the rows out of `waypointIndex`, which is a SLUG table: every
// marker, every run drop-in and every lift top is an entry, and a run that
// carries a marker (or is cut into two segments, as SUNNYSIDE is) appears once
// per entry. Sixty-six rows for forty-eight runs, and a third of them were not
// runs at all.
//
// So the RUN LIST IS THE RUNS EXPORT and nothing else — `world.runs`, the table
// that carries `pts` and `diff` — collapsed BY FAMILY. Every segment of a run
// rides on its row (`segments`), which is what the map highlights and what
// guide.js lays the dye down; a marker that shares a run's id is no longer a row
// of its own, it is that run's entrance.
//
// specs/0061 (families, 2026-09-06). Greg: "There is still poulsends and west
// face duplicates in trail selector. Please remove all duplicates". The key was
// the DISPLAY NAME, which caught the two SUNNYSIDE halves and nothing else — the
// world still shipped '2nd/3rd/4th/5th WEST FACE' and 'WEST FACE ALTERNATES' as
// five rows of one face, and "POULSEN'S 1/2/3" beside "POULSEN'S GULLY" as four
// rows of one gully. The key is now `family || id`, off two optional strings the
// world declares on its own run rows (`layout.mjs`'s `R()`, through world.mjs's
// `runs` export): entrance lines and numbered variants of one trail carry the
// same `family`, and the row prints the `familyName`.
//
// A FAMILY IS A LOCKER AND MAP CONCEPT ONLY. It groups nothing in the world:
// world.mjs's post stacks and signs.mjs's plates still read the PER-LINE `name`,
// so the sign at the top of the third alternate still says 3rd WEST FACE. What
// the family changes is the ROW: one name, the hardest member's difficulty, the
// TOP member's entrance for the fast travel, dye down EVERY member, and one
// label on the map.
//
// FAST TRAVEL GOES TO THE TOP OF THE RUN. PLAYABLE.md orders `pts` top → bottom,
// so the drop-in is `pts[0]`; with several segments it is the HIGHEST of those
// heads, which is the top of the run as a person means it.
//
// THE PLACES DID NOT GO AWAY. 0055 §5.2's whole feature was fast travel to the
// village, KT and the lift tops, so they keep their rows — under the runs, in
// their own short section, out of the run list. Two sections, one row each.
function trailRows(world, upAxis) {
  if (!world) return [];
  let table = null;
  try { table = waypointIndex(world, upAxis === 'z' ? 'z' : 'y'); } catch { return []; }
  if (!table || !table.size) return [];

  // ---- the marker layer, by id: what a place is called and how hard it is.
  // Consulted for a run only when the runs export leaves a gap.
  const mk = new Map();
  for (const m of (Array.isArray(world.markers) ? world.markers : [])) {
    if (m && m.id) mk.set(m.id, { diff: m.diff || null, kind: TRAIL_KIND[m.kind] || m.kind || null });
  }

  // ---- 1. THE RUNS, collapsed by FAMILY
  const byName = new Map();
  const runIds = new Set();
  for (const r of (Array.isArray(world.runs) ? world.runs : [])) {
    if (!r || !r.id || !Array.isArray(r.pts) || !r.pts.length) continue;
    runIds.add(r.id);
    // specs/0061 (families, 2026-09-06) — THE KEY IS `family || id`, and the
    // display name is `familyName || name`. It was the NAME, which collapsed the
    // two SUNNYSIDE halves and nothing else: '2nd WEST FACE' and 'WEST FACE
    // ALTERNATES' are five spellings of one face, "POULSEN'S 1/2/3" are three
    // entrances into one gully, and no rule over the strings alone tells those
    // apart from RED DOG FACE / RED DOG GLADES. So the world DECLARES the
    // grouping (layout.mjs's `R()`, exported through world.mjs's `runs`) and this
    // reads it; an untagged run keys on its own id and is a row to itself, which
    // is every run this world does not group.
    const family = r.family ? String(r.family) : null;
    const name = String((family && r.familyName) || r.name || r.id);
    const key = family ? `f:${family}` : `i:${r.id}`;
    const head = r.pts[0];
    const seg = {
      id: r.id, n: r.pts.length,
      at: { x: +head[0], y: +head[1], z: +head[2] },
    };
    let row = byName.get(key);
    if (!row) {
      row = { name, kind: 'run', section: 'runs', diff: null, segments: [], slugs: [] };
      byName.set(key, row);
    }
    row.segments.push(seg);
    // THE FAMILY IS AS HARD AS ITS HARDEST LINE. A row that opens POULSEN'S 3
    // and POULSEN'S GULLY behind one double diamond must not print the easier of
    // the two — the mark is a warning, and the warning is the worst thing on it.
    const d = r.diff || (mk.get(r.id) || {}).diff || null;
    if (d && (DIFF_RANK[d] || 0) > (DIFF_RANK[row.diff] || 0)) row.diff = d;
  }
  const runRows = [];
  for (const row of byName.values()) {
    // top-down: the highest head is the run's top, and the order the segments
    // are joined in when the trail is laid
    row.segments.sort((a, b) => b.at.y - a.at.y);
    const top = row.segments[0];
    runRows.push({
      id: top.id, slug: top.id, name: row.name, at: top.at,
      diff: row.diff, kind: 'run', viaSign: false, section: 'runs',
      segments: row.segments.map((s) => s.id),
      // ≥ 4 vertices is what makePath/buildDye need to make a ribbon out of a
      // line; below that there is nothing to lay
      canEquip: row.segments.reduce((n, s) => n + s.n, 0) >= 4,
      slugs: [],
    });
  }

  // ---- 2. THE PLACES: everything in the slug table that is not a run — the
  // markers, the venues, the landmarks and the lift tops — one row per id.
  const places = new Map();
  for (const [slug, w] of table) {
    if (!w || !w.id || runIds.has(w.id)) continue;
    if (places.has(w.id)) continue;
    const f = mk.get(w.id) || {};
    places.set(w.id, {
      id: w.id, slug, name: w.name || w.id, at: w.at,
      diff: f.diff || null, kind: f.kind || w.kind || null,
      // `marker` destinations are the ones markers.js's own T fast travel can
      // resolve; a lift top is a waypoint spawn.js knows and the sign atlas does
      // not, so the row says which road it will take.
      viaSign: w.kind === 'marker',
      section: 'places', segments: [], canEquip: false, slugs: [],
    });
  }

  // spawn.js's hand-curated layer, attached to the row it resolves to. ONLY
  // these: the table also keys every display name's slugification, and printing
  // `poulsen-s-gully` beside `poulsens-gully` is noise, not an alias. What is
  // worth a row's second line is the name a person would actually type and no
  // id spells — `village`, `fingers`, `eagles-nest`.
  const bySlug = new Map();
  for (const r of runRows) for (const id of r.segments) bySlug.set(id, r);
  for (const p of places.values()) bySlug.set(p.id, p);
  for (const [alias, target] of Object.entries(ALIASES)) {
    const row = bySlug.get(target);
    if (row && alias !== row.slug && !row.slugs.includes(alias)) row.slugs.push(alias);
  }

  // STEEPEST FIRST, the way 3.3 stacks plates on a post: double, black, blue,
  // green, then the unrated places, alphabetical inside each band. A trail
  // selector that opened on the green circles would be reading the mountain
  // upside down. The places follow the runs and sort the same way inside their
  // own section.
  const rank = (a, b) => (DIFF_RANK[b.diff] || 0) - (DIFF_RANK[a.diff] || 0)
    || String(a.name).localeCompare(String(b.name));
  runRows.sort(rank);
  const placeRows = [...places.values()].sort(rank);
  return [...runRows, ...placeRows].map((r) => ({
    id: r.id, slug: r.slug, name: r.name, at: r.at, diff: r.diff,
    kind: r.kind, viaSign: r.viaSign, canEquip: r.canEquip,
    section: r.section, segments: r.segments.slice(),
    also: r.slugs.slice(0, 2).join(' · '),
  }));
}

// ------------------------------------------------- specs/0061 §3: the trail map
// A PLAN VIEW OF THE WORLD THE CONTRACT DECLARES, derived on every paint and
// hand-listed nowhere — the same rule the rows above keep. ONE canvas, one 2D
// context, and no animation frame of its own: it redraws when the locker opens,
// when the tab changes, when the selection moves and on a resize, which is every
// moment its picture could be wrong.
//
// NORTH-UP, AND THE FRAME IS THE DATA. main.js has already tipped the contract
// into the three frame, where x is east and z is MINUS north, so a point maps
// straight to (x, z) with no rotation and the top of the canvas is north. The
// world declares no crop box, so the bounding box of everything drawn — every
// run polyline, both ends of every lift, every marker — plus 5 % IS the crop.
const DIFF_LINE = {
  green: hudMark.green, blue: hudMark.blue,
  black: hudMark.black, double: hudMark.black,
};

function mapGeometry(world, rows) {
  const runs = [];
  for (const r of (Array.isArray(world && world.runs) ? world.runs : [])) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2) continue;
    // specs/0061 (families, 2026-09-06) — the map's ONE label for a highlighted
    // run is the FAMILY's name when it has one: the longest member of the WEST
    // FACE family is `west-face-3`, and a board that labels the face "3RD WEST
    // FACE" is naming a line the row does not.
    runs.push({ id: r.id, name: r.familyName || r.name || r.id, diff: r.diff || null, pts: r.pts });
  }
  const lifts = [];
  for (const l of (Array.isArray(world && world.lifts) ? world.lifts : [])) {
    if (!l || !Array.isArray(l.base) || !Array.isArray(l.top)) continue;
    lifts.push({ id: l.id, name: l.name || l.id, base: l.base, top: l.top });
  }
  // the DOTS are the venues and the landmarks, off the rows the tab is already
  // holding — a marker table of this screen's own would be the second list 0055
  // §5.2 spent its whole design refusing
  const dots = [];
  for (const w of (rows || [])) {
    if (!w || !w.at || !Number.isFinite(w.at.x)) continue;
    if (w.kind !== 'venue' && w.kind !== 'landmark') continue;
    dots.push({ id: w.id, name: w.name, kind: w.kind, at: w.at });
  }
  return { runs, lifts, dots };
}

function strokePath(g, scr, w, col) {
  if (scr.length < 2) return;
  g.beginPath();
  g.moveTo(scr[0][0], scr[0][1]);
  for (let i = 1; i < scr.length; i++) g.lineTo(scr[i][0], scr[i][1]);
  g.lineWidth = w; g.strokeStyle = col; g.stroke();
}

// the chair, at a lift's ends: the 0055 atlas's lift plate colour, a 5 px cabin
// under a 3 px hanger — small enough to read as an icon and not as a marker dot
function chairGlyph(g, x, y) {
  g.strokeStyle = hudKind.lift; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x, y - 1.6); g.stroke();
  g.fillStyle = hudKind.lift;
  g.fillRect(x - 2.5, y - 1.6, 5, 3.2);
}

// specs/0061 §3.2-§3.4. Returns the numbers the acceptance prints AND the
// screen-space polylines the click hit-test needs, so tapping the map and
// drawing the map cannot disagree about where a run is.
function paintTrailMap(cv, world, rows, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const g = cv.getContext && cv.getContext('2d');
  if (!g) return null;
  let dpr = 1;
  try { dpr = Math.min(2, window.devicePixelRatio || 1); } catch { dpr = 1; }
  const W = Math.max(60, Math.round(cv.clientWidth || 300));
  const H = Math.max(60, Math.round(cv.clientHeight || 240));
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = hudSurf.cream; g.fillRect(0, 0, W, H);
  g.lineJoin = 'round'; g.lineCap = 'round';

  const geo = mapGeometry(world, rows);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  };
  for (const r of geo.runs) for (const p of r.pts) see(p[0], p[2]);
  for (const l of geo.lifts) { see(l.base[0], l.base[2]); see(l.top[0], l.top[2]); }
  for (const d of geo.dots) see(d.at.x, d.at.z);
  const empty = { ms: 0, runs: 0, lifts: 0, markers: 0, you: false, hits: [], w: W, h: H };
  if (!(x1 > x0) || !(z1 > z0)) return empty;
  const padX = (x1 - x0) * 0.05, padZ = (z1 - z0) * 0.05;
  x0 -= padX; x1 += padX; z0 -= padZ; z1 += padZ;
  const inset = 9;
  const k = Math.min((W - inset * 2) / (x1 - x0), (H - inset * 2) / (z1 - z0));
  const ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
  const px = (x) => ox + (x - x0) * k;
  const py = (z) => oz + (z - z0) * k;

  // ---- runs, in §1.8's difficulty colour off the contract's own `diff`. An
  // unrated run is drawn in `sub` rather than being given a rating it has not
  // got — the rule the rows keep for their empty mark cell.
  // `highlight` is a SET of ids, not one id: specs/0061 §1.6 makes a row a whole
  // run, and a run cut into two segments highlights both halves or it is lying
  // about which line you picked.
  const hits = [];
  const want = opts.highlight instanceof Set ? opts.highlight
    : new Set(opts.highlight ? [opts.highlight] : []);
  const hot = [];
  for (const r of geo.runs) {
    const scr = r.pts.map((p) => [px(p[0]), py(p[2])]);
    hits.push({ id: r.id, name: r.name, scr });
    if (want.has(r.id)) { hot.push({ r, scr }); continue; }
    strokePath(g, scr, r.diff === 'double' ? 1.9 : 1.3, DIFF_LINE[r.diff] || hudSurf.sub);
  }
  // ---- lifts: the line, and the chair at both ends
  for (const l of geo.lifts) {
    const a = [px(l.base[0]), py(l.base[2])], b = [px(l.top[0]), py(l.top[2])];
    strokePath(g, [a, b], 1.5, hudKind.lift);
    chairGlyph(g, a[0], a[1]); chairGlyph(g, b[0], b[1]);
  }
  // ---- the places
  for (const d of geo.dots) {
    const x = px(d.at.x), y = py(d.at.z);
    g.beginPath(); g.arc(x, y, 2.7, 0, Math.PI * 2);
    g.fillStyle = d.kind === 'venue' ? hudKind.venue : hudKind.landmark;
    g.fill();
    g.lineWidth = 0.7; g.strokeStyle = hudSurf.ink; g.stroke();
  }
  // ---- the selected run goes LAST and goes through everything: a 6 px cream
  // halo knocks the crossings out from under it, then the line itself at 2.6×.
  for (const h of hot) strokePath(g, h.scr, 6, hudSurf.cream);
  for (const h of hot) strokePath(g, h.scr, 3.4, DIFF_LINE[h.r.diff] || hudSurf.ink);
  if (hot.length) {
    // ONE label for the run, on its longest segment, so a two-segment run does
    // not print its own name twice
    const h = hot.reduce((a, b) => (b.scr.length > a.scr.length ? b : a));
    const m = h.scr[Math.floor(h.scr.length / 2)];
    if (m) {
      g.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      g.textBaseline = 'middle';
      const txt = String(h.r.name).toUpperCase();
      const w = g.measureText(txt).width;
      const lx = Math.min(Math.max(6, m[0] + 7), W - w - 10), ly = Math.min(Math.max(9, m[1] - 8), H - 8);
      g.fillStyle = hudSurf.cream; g.fillRect(lx - 3, ly - 7, w + 6, 14);
      g.fillStyle = hudSurf.ink; g.fillText(txt, lx, ly);
    }
  }
  // ---- YOU ARE HERE: an ink triangle at the body, pointing where it is
  // looking. three's forward for a yaw is (-sin, -cos) in (x, z), and screen y
  // follows z, so the same pair is the screen heading with no second convention.
  let you = false;
  try {
    const p = window.__player && window.__player.position && window.__player.position();
    const yaw = window.__player && window.__player.yaw ? window.__player.yaw() : 0;
    if (p && Number.isFinite(p.x)) {
      const x = px(p.x), y = py(p.z);
      const fx = -Math.sin(yaw), fy = -Math.cos(yaw);
      g.beginPath();
      g.moveTo(x + fx * 6.5, y + fy * 6.5);
      g.lineTo(x - fx * 3.5 - fy * 3.6, y - fy * 3.5 + fx * 3.6);
      g.lineTo(x - fx * 3.5 + fy * 3.6, y - fy * 3.5 - fx * 3.6);
      g.closePath();
      g.fillStyle = hudSurf.ink; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = hudSurf.cream; g.stroke();
      you = true;
    }
  } catch { /* a locker opened before the body exists still draws the mountain */ }

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    ms: +(t1 - t0).toFixed(2),
    runs: geo.runs.length, lifts: geo.lifts.length, markers: geo.dots.length,
    you, hits, w: W, h: H,
    box: { x0: +x0.toFixed(1), x1: +x1.toFixed(1), z0: +z0.toFixed(1), z1: +z1.toFixed(1) },
  };
}

// nearest drawn run to a point on the canvas, in screen pixels (§3.4). Segment
// distance, not vertex distance: a 900 m run resampled at 20 m has vertices far
// enough apart that a vertex test would miss the middle of every segment.
function mapPick(hits, x, y, maxPx = 8) {
  let best = null, bd = maxPx * maxPx;
  for (const h of hits) {
    for (let i = 1; i < h.scr.length; i++) {
      const a = h.scr[i - 1], b = h.scr[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = dx * dx + dy * dy;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
      const qx = a[0] + dx * t, qy = a[1] + dy * t;
      const d = (x - qx) ** 2 + (y - qy) ** 2;
      if (d < bd) { bd = d; best = h.id; }
    }
  }
  return best;
}

// ------------------------------------------------------------------- style
// Injected once, under `lk`, so this screen owns its own appearance end to end
// and shares no selector with play.css. Dark slate panel, one accent per tab
// (--lk-acc, swapped on every setTab), high-contrast text, system fonts only.
const LOCKER_CSS = `
/* ================ specs/0055 §5.2 (Greg 2026-09-06: locker themed) ==========
   THE WHOLE LOCKER IS THE MAP BOARD NOW. Greg, 2026-09-06: "You can theme the
   whole inventory to the theme of the trails, just make sure that we can 1 see
   the player preview and 2 see the item previews that are being equipped." That
   supersedes the earlier "inventory stays as it is" pick and §10.8's
   byte-identical clause, and the register it names is the one W4 already built
   for the TRAIL QUICK-TRAVEL tab below: cream board, ink type, hairline rows,
   ink selection. Every tab now wears it — skis, bikes, glider, sled,
   snowmobile, boots, outfit, settings, trails.

   THE TWO THINGS THAT MAY NOT MOVE, and how they are kept:
     1. THE PLAYER PREVIEW. The mannequin stage is an INK BOARD under a 2 px
        mounting rule — §1.6's second surface, not a third slab — and it grew
        from 300 px to 320 px wide when the deck column did.
     2. THE ITEM PREVIEWS. Every thumb canvas and swatch this screen ever drew
        is still drawn, at the same size, on the same near-black ground it had:
        \`.lk__art\` and \`.lk__hero\` are ink boards, so the art reads exactly as
        it did. Only the FRAME around them changed — ink board, mounting rule,
        kind accent — and the cards' dark plates became cream ones.

   D19 — NO NEW SLAB. Cream \`--p-cream\` and ink \`--p-ink\` are §1.6's two
   surfaces and this file adds none. Every name below is a local alias for a
   token W1 published on \`:root\` (hud.js), read and never redeclared. The
   literals left are the ink written out with an alpha — the scrim at 55 % and
   the row wash at 7 %, both §1.6's ink and neither a new surface — and the
   muted grey W4's trail rows already carried, so no colour is new to this file
   either (specs/0055 D19, the fix round's item 3). */
.lk {
  --lk-acc: #4cc9f0;                    /* the tab's own colour — JS sets it */
  --lk-scrim: rgba(23, 22, 20, .55);    /* ink at 55 %, the lookbook A cell */
  --lk-board: var(--p-cream);
  --lk-plate: var(--p-ink);             /* the ink board every preview sits on */
  --lk-sig: var(--p-k-lift);            /* §1.7 — the one accent, and it means EQUIPPED */
  /* specs/0055 D19 / §11.3 — the hover is THE INK, NOT A THIRD SLAB. It read
     \`#e6e2d8\` — a colour that is in neither §1.6 surface and that no \`:root\`
     name publishes, so the gate counted it as a slab added without a sign-off.
     It is the ink at 7 % over the cream board, so that is what it now says:
     the same literal \`--lk-scrim\` above already reads, at a wash alpha instead
     of a scrim's. Over \`--p-cream\` it renders within four levels of the old
     value on one channel, and it can never drift away from the two surfaces. */
  --lk-wash: rgba(23, 22, 20, .07);     /* the trail rows' own hover — ink at 7 % */
  --lk-line: var(--p-seam);
  --lk-line-2: var(--p-sub);
  --lk-ink: var(--p-ink);
  --lk-ink-2: var(--p-sub);
  --lk-ink-3: #8f887a;
  --lk-good: var(--p-diff-green);
  --lk-bad: var(--p-diff-red);
  --lk-mono: var(--p-mono);
  --lk-sans: var(--p-fam);
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; padding: 16px;
  background: var(--lk-scrim);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: var(--lk-sans);
  color: var(--lk-ink);
  pointer-events: auto;
  opacity: 0;
  /* §6 — the locker RISEs and FALLs, and it invents neither duration */
  transition: opacity var(--p-fall) linear;
}
.lk[hidden] { display: none; }
.lk.is-in { opacity: 1; transition: opacity var(--p-rise) var(--p-rise-ease); }
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
  /* the map board: ONE colour, 2 px radius, and the shadow that lifts it off
     the slope. No chrome gradient, no inset highlight — a printed board has
     neither and the lookbook's \`.map\` is exactly this rule. */
  background: var(--lk-board);
  border-radius: var(--p-r);
  box-shadow: 0 12px 40px rgba(0,0,0,.42);
  overflow: hidden;
  transform: translateY(10px);
  opacity: 0;
  transition: transform var(--p-fall) linear, opacity var(--p-fall) linear;
}
.lk.is-in .lk__panel {
  transform: none; opacity: 1;
  transition: transform var(--p-rise) var(--p-rise-ease), opacity var(--p-rise) var(--p-rise-ease);
}
/* the accent hairline is gone: the header's own 2 px mounting rule is the
   board's top edge now, and one rule is the register's answer to two */
.lk__panel::before { content: none; }

/* ----------------------------------------------------------------- header
   The lookbook's \`.map__hd\`, measured at 1:1: the name in the board face at
   14 px oblique, the 2 px ink mounting rule under it, and the mono strip on the
   right — which is where the loadout already sat. */
.lk__hd {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px;
  border-bottom: var(--p-rule) solid var(--p-ink);
}
.lk__title {
  font-family: var(--lk-sans); font-size: 14px; font-weight: var(--p-weight);
  font-style: var(--p-oblique);
  letter-spacing: .1em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__title b { font-weight: var(--p-weight); }
.lk__spacer { flex: 1 1 auto; }
.lk__load { display: flex; align-items: center; gap: 14px; }
.lk__load-i { display: flex; align-items: baseline; gap: 6px; }
.lk__load-k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__load-v {
  font-family: var(--lk-mono); font-size: 9.5px; letter-spacing: .04em; color: var(--lk-ink-2);
  max-width: 19ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ------------------------------------------------------------------- tabs */
/* The lookbook's \`.tabbar\`: no gaps, no rounded caps, a 2 px ink rule under the
   strip, and the ACTIVE TAB IS AN INK PLATE rather than a coloured underline —
   the same object as a selected trail row, one register up. */
.lk__tabs {
  display: flex; align-items: stretch; gap: 0;
  padding: 0 14px; border-bottom: var(--p-rule) solid var(--p-ink);
}
/* NOTHING that says "this is the active tab" is transitioned. A CSS transition
   is driven by the document's animation clock, and on a frame-starved deck —
   a heavy world behind the panel, a software rasteriser — that clock can stall
   long enough for the strip to keep advertising the tab you just left. Colour
   changes here snap; only the decorative hover lift below animates. */
/* specs/0055 §8 P5 — 44 px, AND THE PREVIEW DOES NOT PAY FOR IT. The strip was
   33 px (a 15 px glyph in 9 px of padding), the one shipped control on this
   screen under the touch floor. \`min-height\` rather than more padding, because
   padding would also push the label away from the glyph on a rack tab whose
   count sits tight against it; \`.lk *\` is border-box, so 44 is 44. The 11 px
   the strip takes are given back by \`.lk__main\` below — its vertical padding
   drops 12 -> 6 — so \`.lk__stage\` and the mannequin canvas inside it come out
   a pixel LARGER than the 305 x 407 §10.8(b) records, not smaller. */
.lk__tab {
  position: relative;
  display: flex; align-items: center; gap: 7px;
  min-height: 44px;
  padding: 9px 11px; cursor: pointer;
  border-radius: 0;
  color: var(--lk-ink-2);
}
.lk__tab svg { width: 15px; height: 15px; flex: none; }
.lk__tab-l {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
}
.lk__tab-n {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 0; border-radius: 0; background: none;
  color: inherit; opacity: .6;
}
.lk__tab::after { content: none; }
.lk__tab:hover { color: var(--lk-ink); background: var(--lk-wash); }
.lk__tab.is-on { color: var(--p-cream); background: var(--p-ink); }
.lk__tab.is-on .lk__tab-n { background: none; color: inherit; opacity: .6; }
.lk__tab.is-on svg { color: inherit; }

/* ------------------------------------------------------------------- body */
.lk__main {
  display: grid; gap: 14px; min-height: 0;
  /* the two side decks grow with the panel instead of pinning at 320/340, so a
     2560-wide deck spends its extra width on the preview and the spec sheet
     rather than on ever-wider cards */
  /* the preview column's floor rises 300 -> 320 px with the theme: constraint 1
     says the player preview may not shrink, and on a 1280 deck this is the one
     column that can grow without costing the card grid a column */
  grid-template-columns: minmax(320px, 23%) minmax(0, 1fr) minmax(330px, 23%);
  grid-template-areas: "pv grid det";
  /* specs/0055 §8 P5 — 6 px, not 12: the vertical half of this padding is what
     pays for the tab strip's 44 px above, and it is the cheapest 12 px on the
     screen. Under a 2 px ink mounting rule the body wants a hairline of air,
     not a margin; the horizontal 14 is untouched. */
  padding: 6px 14px;
  gap: 0;
}

/* ---- left: THE PLAYER PREVIEW (constraint 1).
   The mannequin keeps its stage, its size and its renderer; the stage is now
   §1.6's OTHER surface — an ink board under a 2 px mounting rule in the tab's
   own colour — because a cream ground would put a cream helmet on cream. This
   is the same two-surface board the trail tab already stands on, read the other
   way up, and it is not a third slab. */
.lk__pv {
  grid-area: pv; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px;
  min-height: 0; padding-right: 14px;
  border-right: var(--p-hairline) solid var(--lk-line);
}
.lk__stage {
  position: relative; min-height: 0; border-radius: var(--p-r); overflow: hidden;
  border: 0; border-bottom: var(--p-rule) solid var(--lk-acc);
  background: var(--lk-plate);
}
/* the floor: one soft ellipse the figure stands on, drawn in CSS so the
   preview scene stays two lights and a turntable. On ink it is a LIGHT
   ellipse — §1.10's hairline-on-ink token, spread — where it used to be a
   dark one on a dark ground. */
.lk__stage::after {
  content: ""; position: absolute; left: 50%; bottom: 12%; width: 62%; height: 9%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--p-hair), transparent 78%);
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
/* the caption under the mannequin: the board's own type, no card around it —
   one hairline holds it to the stage the way a blade is held to its post */
.lk__plate {
  display: grid; gap: 2px; padding: 8px 2px 0;
  border: 0; border-radius: 0; background: none;
  /* specs/0012 §C — no left stripe. The brand line above the name is already
     accent-coloured; the plate did not need a second one turned on its side. */
}
.lk__plate-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--lk-ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__plate-name {
  font-family: var(--lk-sans); font-size: 15px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .06em; line-height: 1.18; color: var(--lk-ink);
}
.lk__plate-tag {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
}

/* ---- middle: filters + the card grid */
.lk__mid {
  grid-area: grid; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px;
  min-height: 0; padding: 0 14px;
}
/* specs/0039 — the sub-strip and the family filters are ONE grid row between
   them, so a tab that shows neither (every rack but the outfit one shows only
   the filters) collapses to nothing and the card grid keeps its own row. */
.lk__bars { display: grid; gap: 8px; }
.lk__filters, .lk__subs { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lk__filters[hidden], .lk__subs[hidden] { display: none; }
/* the sub-tabs are chips in the tab's own accent; the group dot the family chips
   carry says nothing here, so it stands down */
.lk__subs .lk__chip::before { display: none; }
.lk__subs .lk__key { margin-right: 3px; }
/* The lookbook A cell's filter line: WORDS with an ink underline, not pills.
   The pill was the dark screen's idea of a chip; on the board a filter is a
   caption that is either struck under or it is not. The group's tint stays as
   the 7 px mark in front of it — that dot is information, not decoration. */
.lk__chip {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 4px 2px; border-radius: 0;
  border: 0; border-bottom: var(--p-rule) solid transparent;
  background: none;
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-2);
}
.lk__chip i { font-style: normal; font-variant-numeric: tabular-nums; opacity: .7; letter-spacing: 0; }
.lk__chip::before {
  content: ""; width: 7px; height: 7px; border-radius: var(--p-r); flex: none;
  background: var(--g, var(--lk-ink-3)); align-self: center;
}
.lk__chip:hover { color: var(--lk-ink); }
.lk__chip.is-on { color: var(--lk-ink); border-bottom-color: var(--p-ink); background: none; }
.lk__chip.is-on::before { background: var(--g, var(--lk-ink)); }
.lk__filters, .lk__subs { gap: 6px 16px; }

.lk__grid {
  display: grid; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  overflow-y: auto; overflow-x: hidden;
  min-height: 0; padding: 2px 10px 10px 0;
  scrollbar-color: var(--lk-line-2) transparent;
}
.lk__grid::-webkit-scrollbar { width: 9px; }
.lk__grid::-webkit-scrollbar-track { background: transparent; }
.lk__grid::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; border: 3px solid transparent; background-clip: content-box; }
.lk__grid::-webkit-scrollbar-thumb:hover { background: var(--lk-ink); background-clip: content-box; }
.lk__grid.is-swap { animation: lk-swap var(--p-rise) var(--p-rise-ease); }
@keyframes lk-swap { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* ---- the card */
/* The card on the board: a cream plate, a hairline, 2 px radius, and NO LIFT —
   register 3 has no hover choreography, and a printed card does not levitate.
   Selection is the ink rule the trail rows use, turned all the way round the
   card; EQUIPPED is the one accent (§1.7's lift orange), spent on a word and
   never on a surface. */
.lk__card {
  position: relative; display: grid; gap: 6px; cursor: pointer; text-align: left;
  padding: 8px;
  border: var(--p-hairline) solid var(--lk-line);
  border-radius: var(--p-r);
  background: var(--lk-board);
  /* border-color is the selection ring and is deliberately NOT transitioned —
     see the note on .lk__tab. Nothing else here animates any more. */
  transition: none;
}
.lk__card:hover { background: var(--lk-wash); border-color: var(--lk-line-2); }
.lk__card.is-sel {
  background: var(--lk-wash);
  border-color: var(--p-ink);
  box-shadow: inset var(--p-spine) 0 0 var(--p-ink);
}
.lk__card.is-eq { background: var(--lk-wash); }
.lk__card.is-go { animation: lk-equip var(--p-snap) linear; }
@keyframes lk-equip {
  0% { transform: scale(.96); }
  100% { transform: none; }
}
/* THE ITEM PREVIEW (constraint 2). Every thumb this screen ever drew is still
   drawn here, at the same size, on the same near-black ground it always had —
   \`.lk__art\` was a dark plate before the theme and it is §1.6's ink board
   after it, so a ski topsheet, an outfit's four bands and a boot swatch all
   read exactly as they did. Only the frame changed: 2 px radius, and a
   mounting rule in the item's OWN kind colour under it. */
.lk__art {
  position: relative; display: grid; place-items: center;
  height: 78px; border-radius: var(--p-r); overflow: hidden;
  background: var(--lk-plate);
  border-bottom: var(--p-rule) solid var(--g, var(--lk-acc));
  box-shadow: none;
}
.lk__img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
/* the group word is a CAPTION in the group's colour, not a pill: on the ink
   board the tint carries itself, and the register spends no surface on it */
.lk__gchip {
  position: absolute; top: 5px; right: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  padding: 0; border-radius: 0;
  background: none; color: var(--g);
}
.lk__brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--lk-ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* specs/0042 — the real thing under the invented house. The muted card text, one
   size down from .lk__tag, no accent, and NOT uppercased: POC, EA7 and Arc’teryx
   carry their own case and the lowercase "after" keeps it off the house line. */
.lk__after, .lk__d-after {
  font-family: var(--lk-mono); font-size: 8px; letter-spacing: .1em; color: var(--lk-ink-3);
  margin-top: -4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__d-after { font-size: 9px; letter-spacing: .06em; margin-top: 0; }
.lk__name {
  /* two lines' worth whether the name needs them or not, so a rack that mixes
     "Trek Ticket DJ" with "Specialized Epic Hardtail" still rules a level grid.
     The board's own face, obliqued and capped — the trail rows' name, one size
     down because a card is not a row. */
  font-family: var(--lk-sans); font-size: 12.5px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .04em; line-height: 1.24; min-height: 2.48em;
  color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lk__tag {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* EQUIPPED sits on the art in the game's one accent — the lookbook A cell's
   rule: the orange stays a signal and never becomes a surface. It gets the ink
   plate under it because the art it lies on is a PICTURE, and a picture is the
   one ground a caption cannot count on (an orange ski under orange type). */
.lk__eq {
  position: absolute; left: 8px; top: 8px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 6px; border-radius: 0;
  background: var(--p-ink); color: var(--lk-sig);
  box-shadow: none;
}
.lk__eq::before { content: "\\2713"; font-size: 9px; letter-spacing: 0; }

/* ---- specs/0019: the settings rows.
   The same grid element the cards live in, switched to one full-width column,
   so the scrolling, the keyboard selection and the swap animation are the ones
   that already work rather than a second implementation of them. */
.lk__grid.is-rows { grid-template-columns: minmax(0, 1fr); gap: 0; }
.lk__row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 8px 16px; cursor: pointer; text-align: left;
  padding: 12px 10px;
  border: 0; border-bottom: var(--p-hairline) solid var(--lk-line); border-radius: 0;
  background: none;
  /* the selection is the ink rule, not transitioned — same note as .lk__tab */
  transition: none;
}
.lk__row:hover { background: var(--lk-wash); }
.lk__row.is-sel {
  background: var(--lk-wash);
  box-shadow: inset var(--p-spine) 0 0 var(--p-ink);
}
.lk__row.is-go { animation: lk-equip var(--p-snap) linear; }
/* both are SPANS in a <button> (a button may not contain a <div>), so they have
   to be told to be blocks — left inline they set as one paragraph and the label
   runs straight into the sentence after it */
.lk__row-t {
  display: block;
  font-family: var(--lk-sans); font-size: 15px; font-weight: var(--p-weight);
  font-style: var(--p-oblique);
  letter-spacing: .04em; text-transform: uppercase; color: var(--lk-ink);
}
/* §1.2 — prose is roman, sentence case, and never oblique */
.lk__row-d {
  display: block; font-family: var(--lk-sans); font-size: var(--p-prose);
  font-style: normal; letter-spacing: 0; line-height: 1.45;
  color: var(--lk-ink-2); margin-top: 4px;
}
.lk__row-txt { display: block; min-width: 0; }
/* the switch: a track, a plate, and a word. NOTHING here is transitioned, and
   that is the .lk__tab note applied to the one control on this screen where
   being wrong for a moment is worst: a transition runs on the document's
   animation clock, and on a frame-starved deck (a heavy world behind the panel,
   a software rasteriser) that clock stalls — the first cut animated the knob's
   travel and photographed a switch reading ON with its knob still hard left.
   A switch may not lie about its state for even one frame.

   specs/0055 5.3 — LOCKER SETTINGS **A** (D14). The pill and its round knob are
   gone: the control is A SQUARE INK PLATE SLIDING IN A CREAM TRACK, 1.10's plate
   at 18 px, so the settings switch is the same object as a lift sign's plate
   and not a borrowed OS control. No switch component is introduced — this is
   the plate, the track and the ON/OFF word, and the knobs keep their full
   verbatim blurbs above (settings.js:38-52, untouched). */
.lk__sw { display: inline-flex; align-items: center; gap: 10px; }
.lk__sw-t {
  position: relative; width: 34px; height: 18px; border-radius: var(--p-r); flex: none;
  background: var(--p-cream);
  box-shadow: inset 0 0 0 1px var(--p-ink);
}
.lk__sw-t::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 0; background: #8f887a;
}
.lk__sw-v {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink-3);
  width: 3ch;
}
.lk__sw.is-on .lk__sw-t::after { background: var(--p-ink); transform: translateX(16px); }
.lk__sw.is-on .lk__sw-v { color: var(--lk-sig); }

/* W1 TOOK THE HAND-OFF (specs/0055 1.1). W4 typed the cream, the ink and the
   seam here because the :root block did not exist yet; it does, so the two
   blocks below read --p-cream / --p-ink / --p-seam and this file names no
   colour of its own. hud.js's sheet is injected at import time, which is before
   this stylesheet paints anything, so there is no first-frame gap.

   ---- specs/0055 5.2: THE TRAIL QUICK-TRAVEL TAB.
   The lookbook's trail selector — and as of Greg's 2026-09-06 pick it is no
   longer the one board in a dark screen: it is the register the WHOLE locker
   now wears. So this block keeps only what is particular to a trail row (the
   four-column rhythm, the severity mark, the slug) and inherits the board, the
   hairline, the wash and the ink selection from \`.lk__row\` above. */
.lk__grid.is-trails { gap: 0; background: none; padding: 2px 10px 10px 0; border-radius: 0; }
.lk__trow {
  display: grid; align-items: center;
  grid-template-columns: 22px minmax(0, 1fr) 74px 132px;
  gap: 0 12px;
  /* P5 — 12 px of padding on a 20 px row is a 44 px tap target, and the 9 px
     W4 shipped was 38. Every row on this screen clears 44 now. */
  padding: 12px 8px; margin: 0;
  text-align: left; cursor: pointer;
}
.lk__trow.is-go { animation: none; }
.lk__trow-n {
  display: block; font-family: var(--lk-sans); font-size: 15px;
  font-weight: var(--p-weight); font-style: var(--p-oblique);
  letter-spacing: .04em; text-transform: uppercase; color: var(--p-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a, .lk__trow-k, .lk__trow-s {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a { display: block; margin-top: 2px; color: #a49c8d; }
.lk__trow-k { color: var(--p-sub); }
.lk__trow-s { text-align: right; }

/* ---- specs/0061 §1.3: the row's one state.
   specs/0061 (one click, 2026-09-06) — AND THE GO PLATE IS GONE WITH ITS CELL.
   The plate carried the fast travel the row body had given up; the body equips
   AND travels again, so the fifth column and the ink rectangle in it went back
   where they came from and the row is the four-column rhythm W4 shipped.
   The EQUIPPED row keeps the mounting rule as a left spine — the same 3 px inset
   the selected row already wears, in the tab's accent instead of ink, so
   "selected" and "equipped" read apart. No new surface: cream board, nothing
   else.
   GATE-0055 CLOSEOUT, 2026-09-06 (row 8(d)) — the ground here was a raw hex
   literal (specs/0055 §5.2 names it), which under D19 reads as a third surface
   however close to the wash it sat. It is \`--lk-wash\` now — the locker's own
   ground for a row that is ON: the token \`.lk__row:hover\`, \`.lk__row.is-sel\`
   and \`.lk__card.is-eq\` already use, ink at 7 % over \`--p-cream\`, resolving to
   \`#e5e2db\`. The literal was within four levels on one channel, so the row does
   not change colour. The state is still told apart the way this block always
   told it — EQUIPPED keeps the accent spine where a selected row wears the ink
   one, plus the \`· equipped\` caption below — so nothing is carried by a colour
   that can drift off §1.6's two surfaces. */
.lk__trow.is-eqt { background: var(--lk-wash); box-shadow: inset 3px 0 0 var(--lk-acc); }
.lk__trow.is-eqt.is-sel { box-shadow: inset 3px 0 0 var(--lk-acc); }
.lk__trow.is-eqt .lk__trow-n::after {
  content: "· equipped"; margin-left: 8px;
  font-family: var(--lk-mono); font-size: 8.5px; font-weight: 700;
  letter-spacing: .16em; color: #8f887a;
}

/* ---- specs/0061 §3.1: the map board. It sits in the hero's slot, which the
   trail tab already leaves empty (0055 §5.2), so no slab is added (D19): this
   is the cream surface the rows are already on, under §1.10's 2 px mounting
   rule. The canvas fills it and paints itself. */
.lk__map {
  position: relative; height: clamp(190px, 26vh, 330px);
  background: var(--p-cream);
  border: 0; border-bottom: var(--p-rule, 2px) solid var(--p-ink);
  border-radius: 2px 2px 0 0;
  overflow: hidden; cursor: crosshair;
}
/* THREE CLASSES, for the reason \`.lk__canvas\` above needs them: play.css's
   \`body.play canvas { position: fixed; left: 0; top: 0 }\` is (0,1,2) and
   outranks any two-part selector, so an unqualified rule here leaves the map
   pinned to the viewport at full screen size, painting cream over the whole
   locker. */
.lk .lk__map .lk__mapcv {
  position: absolute; inset: 0; display: block; width: 100%; height: 100%;
}
/* specs/0061 §1.6 — the section seam. Mono caps on the cream board over the
   3 px blade spine (§1.10), which is the rule the trail blades already use for
   "a heading, not a row". No surface of its own. */
.lk__tsec {
  font-family: var(--lk-mono); font-size: 8.5px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: #8f887a;
  padding: 12px 8px 5px; margin: 0;
  border-bottom: 1px solid var(--p-ink);
}
.lk__grid.is-trails > .lk__tsec:first-child { padding-top: 2px; }
.lk__map-t {
  position: absolute; left: 7px; top: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #8f887a;
  pointer-events: none;
}

/* 1.8's severity alphabet, one CSS class per shape. Colours are the ones the
   world already uses: green circle, blue square, black diamond, double. */
.lk__mark { display: block; width: 13px; height: 13px; justify-self: center; }
.lk__mark.is-circ { border-radius: 50%; background: var(--p-diff-green); }
.lk__mark.is-sq { background: var(--p-diff-blue); }
.lk__mark.is-dia { background: var(--p-ink); transform: rotate(45deg); width: 11px; height: 11px; }
/* a double diamond is TWO diamonds, so it is two rotated boxes on one element
   rather than a clipped bar — the same shape the atlas draws, at row size */
.lk__mark.is-dia2 { width: 22px; height: 11px; background: none; position: relative; transform: none; }
.lk__mark.is-dia2::before,
.lk__mark.is-dia2::after {
  content: ""; position: absolute; top: 1px; width: 9px; height: 9px;
  background: var(--p-ink); transform: rotate(45deg);
}
.lk__mark.is-dia2::before { left: 0; }
.lk__mark.is-dia2::after { right: 0; }
/* an unrated place gets an empty cell, not a neutral glyph (1.8) */

/* ---- right: the detail panel */
.lk__det {
  grid-area: det; min-height: 0;
  display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); gap: 10px;
  padding: 0 0 0 14px;
  border: 0; border-left: var(--p-hairline) solid var(--lk-line); border-radius: 0;
  background: none;
  overflow: hidden;
}
/* THE ITEM PREVIEW, BLOWN UP (constraint 2, second surface). The deck's hero is
   the same ink board the cards' art is, at 2 px radius under a mounting rule in
   the item's kind colour — so the thing you are about to equip is the largest
   picture on the screen after the rider. */
.lk__hero {
  /* the art grows into whatever height the deck has spare — 132 px at 720p,
     ~190 px at 1080p — instead of leaving the panel's foot empty */
  position: relative; height: clamp(132px, 18vh, 216px);
  border-radius: var(--p-r); overflow: hidden;
  display: grid; place-items: center;
  background: var(--lk-plate);
  border: 0; border-bottom: var(--p-rule) solid var(--g, var(--lk-acc));
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
  padding: 3px 6px; border-radius: 0;
  background: var(--p-ink); color: var(--lk-sig);
}
.lk__d-head { display: grid; gap: 2px; }
.lk__d-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--lk-ink-2);
}
.lk__d-name {
  font-family: var(--lk-sans); font-size: 24px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .06em; line-height: 1.12; color: var(--lk-ink);
}
.lk__d-spec {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .13em; text-transform: uppercase; color: var(--lk-ink-2);
}
/* §1.2 — the blurb is the one run of roman prose on this screen */
.lk__d-blurb {
  font-family: var(--lk-sans); font-size: 12.5px; font-style: normal; letter-spacing: 0;
  line-height: 1.45; color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}

/* ---- stat bars, with the delta against what is equipped */
.lk__stats { display: grid; gap: 6px; align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0; }
.lk__stats::-webkit-scrollbar { width: 7px; }
.lk__stats::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; }
.lk__stat { display: grid; grid-template-columns: 68px minmax(0, 1fr) 30px 34px; align-items: center; gap: 8px; }
.lk__stat-k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-2);
}
/* §1.10 — ONE 2 px gauge serves every bar in the game, and a stat bar is one
   of them: the seam is the track, ink is the fill, and the delta keeps the
   severity alphabet's green and red. No pill, no glow, no gradient. */
.lk__stat-t {
  position: relative; height: 4px; border-radius: 0; overflow: hidden;
  background: var(--lk-line); box-shadow: none;
}
.lk__stat-t i, .lk__stat-t u {
  position: absolute; top: 0; bottom: 0; display: block;
  transition: left .18s ease-out, width .18s ease-out, background .2s;
}
/* the bar itself stops at the SHARED value; the delta segment carries the sign */
.lk__stat-t i { left: 0; width: 0; background: var(--p-ink); }
.lk__stat-t u { width: 0; text-decoration: none; }
.lk__stat-t u.is-up { background: var(--lk-good); box-shadow: none; }
.lk__stat-t u.is-down {
  background: repeating-linear-gradient(-45deg, var(--lk-bad) 0 3px, transparent 3px 6px);
}
.lk__stat-v {
  font-family: var(--lk-mono); font-size: 10px; font-weight: 700;
  font-variant-numeric: tabular-nums;
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
.lk__cmp::before { content: ""; flex: 1 1 auto; height: var(--p-hairline); background: var(--lk-line); }

.lk__facts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px;
  align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0;
  border-top: var(--p-hairline) solid var(--lk-line); padding-top: 9px;
}
.lk__facts::-webkit-scrollbar { width: 7px; }
.lk__facts::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; }
.lk__fact { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.lk__fact .k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__fact .v {
  font-family: var(--lk-mono); font-size: 10px; font-weight: 700;
  color: var(--lk-ink); font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------------- hint bar */
.lk__foot {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 9px 14px; border-top: var(--p-hairline) solid var(--lk-line);
  background: none;
}
.lk__hint { display: inline-flex; align-items: center; gap: 7px; }
.lk__hint span {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-2);
}
/* the lookbook's \`.cap--inv\`: an outlined ink key cap, 2 px radius, no bevel */
.lk__key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 5px;
  border: var(--p-hairline) solid var(--p-ink); border-radius: var(--p-r);
  background: none;
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .04em; color: var(--lk-ink);
}
.lk__foot-sp { flex: 1 1 auto; }

/* ------------------------------------------------------------ narrow decks */
@media (max-width: 1180px) {
  .lk__main {
    grid-template-columns: 260px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 250px);
    grid-template-areas: "pv grid" "det det";
  }
  /* the deck moves under the grid, so its hairline turns with it */
  .lk__det {
    border-left: 0; border-top: var(--p-hairline) solid var(--lk-line);
    padding: 12px 0 0;
  }
  .lk__mid { padding: 0 0 0 14px; }
  .lk__hero { height: 96px; }
  .lk__det { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: "hero head" "hero blurb" "stats facts"; column-gap: 14px; }
  .lk__hero { grid-area: hero; height: 100%; }
  /* specs/0061 §3.1 — the map takes the hero's cell here too, because on this
     tab the hero is the thing that is hidden */
  .lk__map { grid-area: hero; height: 100%; }
  .lk__d-head { grid-area: head; align-self: end; }
  .lk__d-blurb { grid-area: blurb; -webkit-line-clamp: 3; }
  .lk__stats { grid-area: stats; }
  .lk__facts { grid-area: facts; }
}
@media (max-width: 860px) {
  .lk__main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "pv" "grid" "det"; grid-template-rows: 190px minmax(0,1fr) 220px; }
  .lk__load { display: none; }
  /* one column: every hairline is a horizontal one */
  .lk__pv { border-right: 0; padding-right: 0; padding-bottom: 12px;
    border-bottom: var(--p-hairline) solid var(--lk-line); }
  .lk__mid { padding: 12px 0 0; }
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

// specs/0055 5.2 — the world contract, so the derived trail list has something
// to derive from. Module-scope rather than a closure field because the TABS
// table is module data and `items()` on that table is what needs to reach it;
// a build that never calls createInventory (or one whose host passes no world)
// leaves it null and the trail tab renders empty rather than throwing.
let WORLD = null;
let UPAXIS = 'y';
// specs/0061 §1 — THE TRAIL SEAM, and it is three calls wide. main.js hands it
// over; the fallback reaches `window.__guide` directly so a locker built before
// the guide module resolved still works, and a build with no guide module at all
// answers null on all three and the tab quietly keeps only its fast travel.
let TRAIL = null;
const trailApi = () => {
  if (TRAIL) return TRAIL;
  let g = null;
  try { g = window.__guide || null; } catch { g = null; }
  if (!g || !g.layTrail) return null;
  return { lay: (id, opts) => g.layTrail(id, opts || {}), clear: () => g.clearTrail(), state: () => g.trailState() };
};
const trailNow = () => { const t = trailApi(); return t ? t.state() : null; };

export function createInventory({ THREE, model, unitScale, ctrl, onEquip, initial, world, upAxis, trail }) {
  injectCSS();
  if (world) { WORLD = world; UPAXIS = upAxis === 'z' ? 'z' : 'y'; }
  if (trail) TRAIL = trail;
  const u = unitScale || 1;
  let open = false;
  let tabIdx = 0;
  let filter = 'all';
  // specs/0039 §3 — which of the outfit tab's eight sub-tabs is up. It lives
  // HERE and not on the TABS entry: the entry is shared data, this is one
  // screen's state. `looks` is 0038's tab body, unchanged.
  let part = 'looks';
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
    // specs/0038 — what the rider is wearing. main.js hands it over in `initial`;
    // rider.js's own resolve (?outfit= → storage → g00) is the fallback, the same
    // way the sled and the snowmobile agree with the world above.
    outfit: (initial && initial.outfit) || resolveOutfit(),
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
    if (t.id === 'boots' || t.kind === 'settings' || t.kind === 'trail') continue;
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
  // specs/0039 §3 — the sub-strip sits ABOVE the filter chips and only the
  // outfit tab ever fills it; both share one grid row (`lk__bars`)
  const subsEl = el('div', 'lk__subs');
  subsEl.hidden = true;
  const filtersEl = el('div', 'lk__filters');
  const bars = el('div', 'lk__bars');
  bars.append(subsEl, filtersEl);
  const grid = el('div', 'lk__grid');
  mid.append(bars, grid);

  // ---- right: the detail panel
  const det = el('div', 'lk__det');
  const hero = el('div', 'lk__hero');
  const heroBg = el('div', 'lk__hero-bg');
  const heroImg = el('img', 'lk__hero-img');
  heroImg.alt = '';
  const heroEq = el('div', 'lk__hero-eq', 'equipped');
  heroEq.hidden = true;
  hero.append(heroBg, heroImg, heroEq);
  // specs/0061 §3.1 — THE TRAIL MAP, in the hero's own slot. On this tab the
  // hero is already hidden (0055 §5.2: a place is not an item and has no art),
  // so the map costs the detail panel no height it was not already leaving
  // empty, and no other tab ever sees it.
  const mapBox = el('div', 'lk__map');
  const mapCv = el('canvas', 'lk__mapcv');
  mapCv.setAttribute('data-map', 'trails');
  mapBox.append(mapCv, el('div', 'lk__map-t', 'north up'));
  mapBox.hidden = true;
  let mapStats = null;
  const dHead = el('div', 'lk__d-head');
  const dBrand = el('div', 'lk__d-brand', '');
  const dAfter = el('div', 'lk__d-after', '');   // specs/0042, under the house line
  const dName = el('div', 'lk__d-name', '—');
  const dSpec = el('div', 'lk__d-spec', '');
  dHead.append(dBrand, dAfter, dName, dSpec);
  const dBlurb = el('div', 'lk__d-blurb', '');
  const statsBox = el('div', 'lk__stats');
  const cmpLine = el('div', 'lk__cmp');
  const factsEl = el('div', 'lk__facts');
  // hero / head / blurb / bars size to their content; the fact sheet takes what
  // is left and scrolls, so no rack can push the panel past the viewport
  det.append(hero, mapBox, dHead, dBlurb, statsBox, factsEl);

  // specs/0061 §3.3/§3.4 — one paint, and the click that reads it back. Both
  // live here so the screen-space polylines the hit-test walks are the ones the
  // canvas actually drew, never a second projection of the same numbers.
  function drawMap() {
    if (!open || tab().kind !== 'trail' || mapBox.hidden) return null;
    const eq = trailNow();
    const row = view[sel];
    const hi = new Set(row && row.segments && row.segments.length ? row.segments
      : row ? [row.id]
        : (eq && eq.segments) || (eq ? [eq.id] : []));
    mapStats = paintTrailMap(mapCv, WORLD, safeItems(tab()), { highlight: hi });
    // THE BOARD TAKES THE MOUNTAIN'S SHAPE. This world is 5.0 km east-west and
    // 1.8 km north-south; a square board spends two thirds of its cream on
    // nothing. The height is set from the fitted box's own aspect once, and the
    // second paint only happens on the frame the height actually moves — after
    // that the numbers agree and this is one paint like every other redraw.
    if (mapStats && mapStats.box) {
      const b = mapStats.box;
      const ar = (b.z1 - b.z0) / Math.max(1e-6, b.x1 - b.x0);
      const want = Math.round(Math.max(120, Math.min(330, (mapCv.clientWidth || 300) * ar + 18)));
      if (Math.abs(mapBox.clientHeight - want) > 4) {
        mapBox.style.height = want + 'px';
        mapStats = paintTrailMap(mapCv, WORLD, safeItems(tab()), { highlight: hi });
      }
    }
    return mapStats;
  }
  mapBox.addEventListener('click', (e) => {
    if (!mapStats || !mapStats.hits.length) return;
    const b = mapCv.getBoundingClientRect();
    const id = mapPick(mapStats.hits, e.clientX - b.left, e.clientY - b.top);
    if (!id) return;                       // a tap on empty snow selects nothing
    // the hit is a SEGMENT id; the row is the run it belongs to (§1.6)
    const i = view.findIndex((q) => q.id === id || (q.segments || []).includes(id));
    if (i < 0) return;
    sel = i; paintSel();
    // specs/0061 (one click, 2026-09-06) — and a tap on a run's line IS the
    // click on its row: the map only ever hit-tests run polylines, so the same
    // one action follows — lay the trail, go to the top of it, close the locker.
    equip();
  });

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
  // specs/0061 §1.2 — the trail tab's own hint, and only its own: T means
  // nothing on a rack, so a permanent row about it would be a lie on five tabs
  // out of seven.
  // specs/0061 (one click, 2026-09-06) — and it is narrower than that now: T is
  // the PLACES' key, so the hint follows the SELECTION rather than the tab and
  // `paintSel` flips it. On a run row the hint is not there, because the run
  // row's whole action is the one click on the row.
  const goHint = el('span', 'lk__hint');
  goHint.append(el('kbd', 'lk__key', 't'), el('span', null, 'go there'));
  goHint.hidden = true;
  foot.append(goHint);
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
    // specs/0041 §4.8 — THE CLONE IS TWO STEPS NOW. `SkinnedMesh.copy` shares the
    // `Skeleton` BY REFERENCE (§2.7), so `clone(true)` alone hands back a
    // mannequin bound to the LIVE bones and it skis along with the player behind
    // the locker panel. The stale `play:body` is thrown away and rider.js's
    // `cloneRig` — fresh bones, a fresh Skeleton in the source's bone order,
    // `bind(skeleton, bindMatrix)` on BOTH skinned meshes — puts a real one in
    // its place. This happens BEFORE every traverse below, so `riderPairs`,
    // `riderMats`, `riderToggles`, `cBody` and `cPack` all see the cloneRig body
    // and never the stale one.
    const liveBody = model && model.getObjectByName('play:body');
    const liveRig = liveBody ? rigOf(liveBody) : null;
    const clone = liveRig ? cloneRig(liveRig) : null;
    if (clone) {
      const stale = figure.getObjectByName('play:body');
      if (stale && stale.parent) { stale.parent.add(clone.model); stale.parent.remove(stale); }
      else figure.add(clone.model);
      // …and the mannequin starts from the BIND pose, never from whatever the
      // live rig happened to hold at the instant the locker was first opened. A
      // clip writes only the bones it keys, so a head the §4.5 look layer had
      // turned would stay turned on the mannequin for the rest of the session,
      // and `turntable.mjs:206-216`'s sha1 would come back different on the next
      // boot — the one determinism `setTime(0)` cannot reach, because it is not
      // a phase. `Skeleton.pose()` (`three.core.js:25301`) IS that reset and the
      // clone's own skeleton already carries the bind matrices it needs.
      clone.skeleton.pose();
      clone.model.updateMatrixWorld(true);
    }
    figure.position.set(0, 0, 0);
    figure.rotation.set(0, 0, 0);
    // The clone arrives with whatever the world had hidden at that instant, so
    // everything is shown and then every GEAR RIG is hidden again by name. That
    // second sweep is a pattern, not a list, and deliberately so: the previous
    // version named the three rigs it knew about, and the day a sled and a
    // snowmobile were added to main.js both stood in the locker on every tab.
    // dressPreview shows back only the one rig the current tab is about.
    // The `rider:*` nodes (specs/0037 §1) are the exception: hood, chin bar,
    // visor, guards, spine, belt, four torsos and two helmets are the OUTFIT's
    // toggles, and showing them all stacks every look on one mannequin. Each is
    // paired with the live rig node of the same name instead, and `loop` copies
    // that node's visibility on every locker frame — so a setOutfit while the
    // locker is closed (or open) is followed, no rebuild.
    // specs/0041 §4.8 — THE PAIRS LIST IS TOGGLES-ONLY. `/^rider:/` matched 30
    // rigid meshes on v2; on v3 it matches 25 BONES, `rider:body` and
    // `rider:poles` as well, and pairing a bone copies a visibility the live rig
    // never writes. The predicate is the one the loop below already computes —
    // `toggleOf(o.name) != null` — so the list is exactly the 13 toggles and
    // every other node takes the existing `else o.visible = true`. That is right
    // for the bones and for the two skinned meshes: the poles were two of v2's
    // 30 paired nodes and were always visible, so a mannequin that always holds
    // them IS today's behaviour.
    const riderPairs = [];
    figure.traverse((o) => {
      const live = toggleOf(o.name || '') != null && model.getObjectByName(o.name);
      if (live) riderPairs.push([o, live]); else o.visible = true;
    });
    // specs/0038 §2.1 — a mannequin sharing the live rig's material cannot show a
    // look you have NOT equipped, so the preview rig owns its materials and
    // previewOutfit() in rider.js is the only thing that ever writes to them.
    // Textures are not cloned: paint(code) is cached per code and shared, so
    // walking all 32 cards paints at most 32 canvases once, live rig included.
    // specs/0041 §4.8 — but the CLONE owns that now, not this loop. v3 has two
    // materials on the body side (§4.1: `matSkin` for the two skinned meshes,
    // `matRigid` for the bone-parented toggles), so the single `riderMat` clone
    // is a `Map(source → clone)` and it is `cloneRig`'s (§2.7 step 5). The line
    // that stood here — one clone assigned to every paired mesh — is DELETED:
    // after the toggles-only predicate above, `rider:body` and `rider:poles` are
    // not in `riderPairs` at all, so it would have left them on the LIVE rig's
    // material by reference and try-on would have stopped working on everything
    // but the toggles, on all 32 looks.
    // §4.1's fallback clause is why this filters: `cloneRig` clones every
    // DISTINCT material it walks, and `play:rocket-pack`'s own three Lamberts
    // (rocket.js) now hang under `rider:spine-2` and are walked with the rest.
    // They must not take the atlas, so what previewOutfit writes is the RIDER's
    // materials alone.
    const worn = new Set();
    if (clone) clone.model.traverse((o) => { if (o.isMesh && /^rider:/.test(o.name || '') && o.material) worn.add(o.material); });
    const riderMats = clone ? new Map([...clone.riderMats].filter(([, m]) => worn.has(m))) : new Map();
    // `riderToggles` is the clone's own toggle list, keyed through rider.js's
    // exported toggleOf(name) so the rule is not restated here — `cloneRig`
    // builds it in the same walk, and the pairs list above is the same 13 nodes.
    const riderToggles = clone ? clone.riderToggles : [];
    const GEAR_RIG = /^play:(?:fp-|tp-)|^play:ski-[lr]$|^play:rocket-pack$/;
    figure.traverse((o) => { if (o.name && GEAR_RIG.test(o.name)) o.visible = false; });
    const cGlide = figure.getObjectByName('play:tp-glider');
    const cBody = figure.getObjectByName('play:body');
    // §4.6 — the rocket pack hangs off `rider:spine-2` now, so it arrives inside
    // the cloneRig body rather than beside it; the name lookup is unchanged and
    // this line runs after the swap, so it finds the cloned one.
    const cPack = figure.getObjectByName('play:rocket-pack');
    // specs/0041 §4.8 — the mannequin's own `AnimationMixer`, rooted on the
    // CLONED `rider:body` and playing exactly one action at weight 1. Its clips
    // are the body clips rider.js parks on `play:body`, which `Object3D.copy`
    // sliced across with the clone (`three.core.js:14721`) — nothing is decoded
    // twice. The root is the skinned MESH and not the group on purpose:
    // `PropertyBinding` resolves a track's node through
    // `root.skeleton.getBoneByName` for a SkinnedMesh root, which is what binds
    // these actions to the clone's bones instead of the live rider's.
    const cSkin = cBody ? cBody.getObjectByName('rider:body') : null;
    const mixer = cSkin ? new THREE.AnimationMixer(cSkin) : null;
    const clips = new Map();
    for (const c of (cBody && cBody.animations) || []) clips.set(c.name, c);
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
    // `tryOn` is the code the mannequin is showing when that differs from the
    // worn one, and null the rest of the time (specs/0038 §2.2)
    pv = { scene, camera, renderer, turntable, skiL, skiR, bike, sled, snow,
      cGlide, cBody, cPack, cSkin, mixer, clips, clip: null, want: null,
      riderPairs, riderMats, riderToggles, tryOn: null, t: 0, kick: 0 };
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

  // specs/0041 §4.8 — ONE action at weight 1, and a tab switch is a CUT, never a
  // crossfade: the rig under the mannequin swaps in the same frame, so a blend
  // would be a pose easing between two things that are not both on screen. A
  // clip the bake did not produce leaves the mannequin on the one it has rather
  // than dropping it to the bind pose.
  function setClip(name) {
    if (!pv || !pv.mixer || pv.want === name) return;
    pv.want = name;
    // W2 lands §3.2's clips one agent at a time, and a mannequin with NO action
    // is the one thing that is not deterministic: its bones keep whatever pose
    // the live rig held at the instant the locker was first opened, so
    // `turntable.mjs`'s sha1 turns over on the next boot for a reason
    // `setTime(0)` cannot fix. `ski-stance` is in every bake from W1 on and is
    // the fallback; the line is inert once all twenty clips are baked.
    const clip = pv.clips.get(name) || pv.clips.get('idle-boots') || pv.clips.get('ski-stance');
    if (!clip || pv.clip === clip.name) return;
    pv.mixer.stopAllAction();
    const a = pv.mixer.clipAction(clip);
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.play();
    pv.clip = clip.name;
    pv.mixer.setTime(0);
  }

  // what the mannequin is wearing right now
  function dressPreview(tab, item) {
    if (!pv) return;
    // specs/0038 §2.3 — the outfit tab stands the figure on the skis it is
    // ACTUALLY wearing and shows no other rig: a suit on a standing body with
    // skis under it reads the way the ski tab reads, and a look judged on a
    // mannequin holding a snowmobile is a look judged wrong.
    const onOutfit = tab.kind === 'outfit';
    const ski = tab.kind === 'ski' || onOutfit;
    // the glider tab dresses per MODEL, not per tab: the wing hangs the prone
    // pilot, the pack straps to the standing body
    const shape = tab.kind === 'glider' && item ? item.preview : null;
    const glide = shape === 'wing';
    const onBike = tab.kind === 'bike';
    const onSled = tab.kind === 'sled';
    const onSnow = tab.kind === 'snowmobile';
    // specs/0041 §4.7/§4.8 — the racks stopped building riders, so `ridden` no
    // longer stands the mannequin down: it is the CLIP SELECTOR now, and the
    // body is visible on every tab. §4.8's table in full — outfit / ski / boots
    // and anything else `idle-boots` at identity; bike `seat-bike` plus the §4.7
    // per-model offset; sled and snowmobile their own seat clips at identity;
    // the glider's wing `prone-glider` lifted to §3.8.4's pilot origin, its pack
    // `idle-boots` with `cPack` shown.
    const ridden = onBike || onSled || onSnow;
    pv.skiL.visible = pv.skiR.visible = ski;
    if (pv.cGlide) pv.cGlide.visible = glide;
    if (pv.cBody) pv.cBody.visible = true;
    if (pv.cPack) pv.cPack.visible = shape === 'pack';
    setClip(onBike ? 'seat-bike' : onSled ? 'seat-sled' : onSnow ? 'seat-snowmobile'
      : glide ? 'prone-glider' : 'idle-boots');
    if (pv.cBody) {
      // the clone arrived carrying whatever transform the live body had at the
      // instant the locker was first opened (main.js's mount copy writes it every
      // frame), so this is a SET on all three, never a `+=`
      pv.cBody.position.set(0, glide ? 1.05 * u : 0, 0);
      pv.cBody.rotation.x = pv.cBody.rotation.y = pv.cBody.rotation.z = 0;
      if (onBike && item) {
        // §4.7 — `seat-bike` is authored against `lab-standard`, so the whole
        // body moves per model off `bikeRider()`, exactly as main.js:1521 does.
        const R = bikeRider(getBikeModel(item.id));
        pv.cBody.position.y += (R.hip[0] - 1.0530) * u;
        pv.cBody.position.z += (R.hip[1] - 0.3050) * u;
      }
    }
    pv.bike.visible = onBike;
    pv.sled.visible = onSled;
    pv.snow.visible = onSnow;
    // §4.7 — the `{ rider: 'tp' }` option is gone with the rack's own rider:
    // there is one rider in this scene and it is the skinned mannequin above.
    if (onBike && item) styleBikeRig(THREE, pv.bike, item.id);
    if (onSled && item) styleSledRig(THREE, pv.sled, item.id);
    if (onSnow && item) styleSnowmobileRig(THREE, pv.snow, item.id);
    if (ski && item) {
      const skiId = onOutfit ? equipped.skis : item.id;
      styleSkiRig(THREE, pv.skiL, skiId);
      styleSkiRig(THREE, pv.skiR, skiId);
    }
    // specs/0038 §2 — TRY-ON. Highlighting a card (mouse or arrows) dresses the
    // mannequin in that look and equips NOTHING; leaving the tab — or closing the
    // locker, see hide() — puts the worn suit back, so the next open is honest.
    // While `tryOn` is set, loop()'s pairs copy stands down and the toggles on
    // screen are the previewed look's, not the live rig's.
    // specs/0039 §4.4 — on a PART sub-tab what is previewed is the worn look with
    // this one part swapped, so hovering a jacket leaves the helmet you picked on
    // the mannequin's head. `pv.tryOn` is the serialised look being shown.
    if (onOutfit && item) {
      const shown = part === 'looks' ? item.id : swapped(item.id);
      previewOutfit(THREE, pv, shown);
      pv.tryOn = shown;
    } else if (pv.tryOn != null) {
      previewOutfit(THREE, pv, window.__player?.outfit);
      pv.tryOn = null;
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
    if (pv.hold == null) pv.t += dt; // held (specs/0037 §5 turntable): camera bob frozen too
    pv.turntable.rotation.y = pv.hold == null ? pv.turntable.rotation.y + dt * (IDLE_SPIN + pv.kick) : pv.hold;
    // specs/0041 §4.8 — and the MIXER freezes with them. `turntable.mjs:206-216`
    // sha1s the locker PNG under `__locker.turntable(0.55)`, and a breathing idle
    // loop makes that hash a coin toss. `setTime(0)` rather than "stop updating":
    // a hold that arrives mid-loop has to land on the SAME frame every time, not
    // on whatever phase the loop had reached. `turntable(null)` releases it and
    // the loop resumes from 0.
    if (pv.mixer) { if (pv.hold == null) pv.mixer.update(dt); else pv.mixer.setTime(0); }
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
    // the outfit's toggles, as worn right now — unless a card is being tried on
    // (specs/0038 §2.4), in which case the live rig is not consulted at all.
    // specs/0041 §4.8 — this is the only consumer of `riderPairs` and with the
    // toggles-only predicate it walks 13 nodes, not 30: the bones, `rider:body`
    // and `rider:poles` are not paired and keep the `visible = true` the build
    // gave them.
    if (pv.tryOn == null) for (const [c, live] of pv.riderPairs) c.visible = live.visible;
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
      // specs/0039 — the sub-tab is handed to the rack rather than stored on it;
      // every other rack ignores the argument
      const r = t.items(t.kind === 'outfit' ? part : undefined);
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

  // ------------------------------------------------- specs/0039: what is worn
  // The card id that counts as EQUIPPED on the tab that is up. Every rack answers
  // with its one equipped id; the outfit tab answers per sub-tab — the seventh of
  // the worn look this sub-tab is about, or, on `looks`, the bare code only when
  // all seven parts agree. A MIXED look badges no look card, which is the honest
  // answer: none of the twenty-seven is what is on the rider's back.
  function equippedCode() {
    const t = tab();
    if (t.kind !== 'outfit') return equipped[t.id];
    const l = parseLook(equipped.outfit);
    return part === 'looks' ? (l.every((c) => c === l[0]) ? l[0] : null) : l[PARTS.indexOf(part)];
  }
  // the worn look with ONE part swapped for `id` — the try-on the part cards show
  const swapped = (id) => serialise(parseLook(equipped.outfit)
    .map((c, i) => (i === PARTS.indexOf(part) ? id : c)));

  // specs/0039 §3 — eight chips, `looks` first, the live one in the tab accent.
  // G cycles them and a click picks one; only the outfit tab renders the strip.
  function renderSubs() {
    const on = tab().kind === 'outfit';
    subsEl.hidden = !on;
    if (!on) return;
    subsEl.textContent = '';
    subsEl.append(el('kbd', 'lk__key', 'g'));
    for (const s of SUBS) {
      const b = el('button', 'lk__chip');
      b.type = 'button';
      b.style.setProperty('--g', tab().accent || '#4cc9f0');
      b.append(document.createTextNode(s));
      b.classList.toggle('is-on', part === s);
      b.addEventListener('click', (e) => { e.stopPropagation(); setSub(s); });
      subsEl.append(b);
    }
  }
  // a sub-tab change resets the selection the way a filter change does; the
  // family filter itself survives, because every sub-tab holds the same 32 houses
  function setSub(s) {
    if (!SUBS.includes(s)) return part;
    if (s !== part) { part = s; sel = 0; renderAll(); }
    return part;
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
      // specs/0038 §5 — a look is a HOUSE and a name. "Hydrogen" on its own says
      // nothing about which of the twenty-seven is on the rider's back.
      // specs/0039 §4.5 — and once the parts can disagree, no single house-and-
      // name is true: a mixed look reports how many houses are on the rider.
      loadRow[t.id].textContent = t.kind === 'outfit' ? outfitLoad()
        : !it ? '—'
          : it.name;
    }
  }

  function outfitLoad() {
    const uniq = [...new Set(parseLook(equipped.outfit))];
    if (uniq.length > 1) return 'mix · ' + uniq.length + ' houses';
    const o = byCode[uniq[0]];
    return o ? houseOf(o) + ' · ' + o.name : '—';
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

  // --------------------------------------------- specs/0055 5.2: a trail row
  // The lookbook's TRAIL SELECTOR, on the map board: a severity mark, the
  // place's name at 15 px, its kind word, and the slug you would type in a URL
  // to get here. One mark per row and it is the run's own `diff` (D15) — a row
  // with no rating gets no mark rather than a neutral one, because an invented
  // rating is worse than a missing one.
  //
  // ARRIVING IS THE SAME CALL `T` MAKES. `window.__playMarkers.fastTravel(slug)`
  // (markers.js:1883) lands you TRAVEL_OFF short of the anchor, on the real
  // floor, looking at the place. It resolves against the sign rows, which are
  // `world.markers`, so a run drop-in or a lift top — waypoints spawn.js knows
  // and the sign atlas does not — falls through to `__player.teleport` at the
  // waypoint the index already resolved. Either way the locker closes behind
  // you: a destination list that stayed up over the place you just travelled to
  // would be covering the only thing you asked to see.
  function travelTo(it) {
    let ok = null;
    try { ok = window.__playMarkers && window.__playMarkers.fastTravel(it.slug); } catch { ok = null; }
    if (!ok && it.at && window.__player && typeof window.__player.teleport === 'function') {
      try { window.__player.teleport(it.at.x, it.at.y, it.at.z); ok = true; } catch { ok = null; }
    }
    hide();
    return !!ok;
  }
  // specs/0061 (one click, 2026-09-06) — EQUIP THE RUN **AND GO**. `layTrail`
  // lays guide.js's own dye stripe and chevrons down the polyline the contract
  // ships for this id; there is no second renderer and no second set of numbers.
  // Then the same `fastTravel(slug)` the GO plate used to make puts you at the
  // top of that run and the locker closes behind you.
  //
  // THE ORDER IS THE FEATURE. Lay first, travel second: `layTrail` is
  // synchronous — it builds the ribbon and the chevron instances and settles
  // them with `fadeArrows(…, 1)` before it returns — so by the time the teleport
  // lands, the dye is already on the hill in front of you. Travelling first
  // would put you on bare snow for however many frames the build takes.
  //
  // A row with no polyline — a marker, a venue, a lift top — has nothing to lay,
  // so its body does what the whole row has always done: it travels.
  function equipTrail(it) {
    if (!it) return null;
    if (!it.canEquip) return travelTo(it);
    const t = trailApi();
    if (!t) return travelTo(it);
    // specs/0061 §1.6 — the whole run, every segment of it, top first, and
    // specs/0061 (families, 2026-09-06): every LINE of the family, laid as its
    // own ribbon where the lines do not chain. The row's name goes down with it
    // so the equipped state and the HUD flash say WEST FACE, not 3rd WEST FACE.
    const laid = t.lay(it.segments && it.segments.length > 1 ? it.segments : it.id, { name: it.name });
    // the stamps before the panel goes, so a locker that fails to close (a
    // travel with no destination at all) is still showing the truth
    renderGrid();
    travelTo(it);                       // ...and hide() with it
    // ...AND YOU FACE DOWN IT. markers.js's own note on this (markers.js:2076)
    // is the whole argument: fastTravel aims you AT the thing you asked for,
    // "which is right for a sign on a knoll and wrong for a drop-in" — and a run
    // you just equipped is the drop-in case, twice over. Arriving at POULSEN'S
    // GULLY looking at the POULSEN'S GULLY sign puts the chevrons you just laid
    // over your shoulder. §1.5's `start.yaw` is the first tangent of the path,
    // which is what `layTrail` returns it for.
    if (laid && laid.start && Number.isFinite(laid.start.yaw)) {
      try { window.__player.setYaw(laid.start.yaw); } catch { /* no controller under this locker */ }
    }
    return laid;
  }
  function renderTrailRow(it, i) {
    // specs/0061 §1.6 — TWO SECTIONS, and the seam between them is one line of
    // type on the board rather than a second surface: the runs you can equip,
    // then the places you can only travel to. The header is emitted by the first
    // row of each section, so a filter that leaves a section empty leaves no
    // header behind either.
    const prev = view[i - 1];
    if (!prev || prev.section !== it.section) {
      grid.append(el('div', 'lk__tsec', it.section === 'places' ? 'places · fast travel' : 'runs · equip a trail'));
    }
    const c = el('button', 'lk__row lk__trow');
    c.type = 'button';
    c.setAttribute('data-slug', it.slug);
    c.setAttribute('data-id', it.id);
    c.setAttribute('data-sec', it.section || 'runs');
    // §1.8's alphabet has five letters and "unknown" is not one of them: a place
    // the world contract gives no `diff` gets an EMPTY cell, never a neutral
    // glyph. `world.runs` (world.mjs:1782) carries id/name/style/width/pts and
    // no rating, so today the marks come from `world.markers[].diff` — see
    // PROGRESS-0055-W4.md's deviation on this.
    const m = DIFF_MARK[it.diff] || null;
    const mark = el('span', 'lk__mark' + (m ? ' ' + m.cls : ''));
    if (m) mark.setAttribute('aria-label', m.label);
    const txt = el('span', 'lk__row-txt');
    txt.append(el('span', 'lk__trow-n', it.name));
    if (it.also) txt.append(el('span', 'lk__trow-a', it.also));
    // specs/0061 (one click, 2026-09-06) — THE GO PLATE IS GONE. It existed to
    // carry the half of the row body 0061 took away; the body does both halves
    // again, so a second target for the same action is one more thing to aim at
    // for nothing. The row is back to its four-column rhythm.
    c.append(mark, txt, el('span', 'lk__trow-k', it.kind || ''), el('span', 'lk__trow-s', it.slug));
    const eq = trailNow();
    if (eq && eq.id === it.id) c.classList.add('is-eqt');
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
    grid.classList.toggle('is-rows', t.kind === 'settings' || t.kind === 'trail');
    grid.classList.toggle('is-trails', t.kind === 'trail');
    if (t.kind === 'settings') { cards = view.map(renderRow); paintSel(); return; }
    // specs/0055 5.2 — the ONE render branch this spec adds
    if (t.kind === 'trail') { cards = view.map(renderTrailRow); paintSel(); return; }
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
      // specs/0042 — the after-line sits under the house name. No entry means no
      // element, not an empty one: the card is a grid and a gap would open for it.
      const head = [el('span', 'lk__brand', it.brand || '')];
      if (it.after) head.push(el('span', 'lk__after', it.after));
      c.append(art, ...head, el('span', 'lk__name', it.name), el('span', 'lk__tag', it.tag || ''));
      if (equippedCode() === it.id) { c.append(el('span', 'lk__eq', 'equipped')); c.classList.add('is-eq'); }
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
    for (const [k, v] of [['state', getSetting(it.key) ? 'on' : 'off'], ['default', it.def ? 'on' : 'off']]) {
      const r = el('div', 'lk__fact');
      r.append(el('span', 'k', k), el('span', 'v', v));
      factsEl.append(r);
    }
  }

  // specs/0055 5.2 — the trail tab's detail panel, on the settings precedent:
  // the hero art and the stat bars are about an ITEM and a place is not one, so
  // both stand down and the head/blurb/fact furniture says where you would be
  // going. THE PREVIEW COLUMN IS NOT TOUCHED, for the same reason 0019 does not
  // touch it: this tab equips nothing, so the mannequin keeps wearing the
  // loadout it is actually wearing.
  function paintTrail(it) {
    det.style.setProperty('--g', tab().accent);
    heroImg.hidden = true;
    heroBg.style.backgroundImage = 'none';
    heroEq.hidden = true;
    hero.hidden = true;
    // specs/0061 §3 — the map takes the slot the hero just gave up
    mapBox.hidden = false;
    statsBox.textContent = '';
    dBrand.textContent = it.kind || 'waypoint';
    dName.textContent = it.name;
    dSpec.textContent = it.diff ? (DIFF_MARK[it.diff] ? DIFF_MARK[it.diff].label : it.diff) : 'unrated';
    const eq = trailNow();
    const mine = !!(eq && eq.id === it.id);
    // specs/0061 (one click, 2026-09-06) — one sentence, because it is one
    // action now: the click lays the trail and takes you to the top of it.
    dBlurb.textContent = it.canEquip
      ? (mine
        ? 'Equipped. The dye and the chevrons are down this run. Click it again to go back to the top. F clears them — unless you are standing at a lift base, where F still boards.'
        : 'One click equips this run and drops you in at the top of it: dye and chevrons the whole way down, and the locker gets out of the way.')
      : 'Fast travel. You arrive short of the sign, on the floor, looking at it. T does the same.';
    factsEl.textContent = '';
    const at = it.at || {};
    const facts = [
      ['slug', it.slug],
      ['also', it.also || '—'],
      ['road', it.viaSign ? 'sign · T' : 'waypoint'],
      ['east', Number.isFinite(at.x) ? Math.round(at.x) + ' m' : '—'],
      ['north', Number.isFinite(at.z) ? Math.round(-at.z) + ' m' : '—'],
    ];
    // specs/0061 §1.3 — what the equipped trail actually IS, in numbers: the
    // length guide.js measured off the resampled polyline, the chevron count it
    // laid at `arrowSpacingM`, and the dye's width.
    if (mine) {
      facts.push(['trail', Math.round(eq.lengthM) + ' m']);
      facts.push(['chevrons', eq.arrows + ' · every ' + eq.spacingM + ' m']);
      facts.push(['dye', eq.widthM + ' m wide']);
    } else if (it.canEquip) {
      facts.push(['trail', 'click to equip · go']);   // specs/0061 (one click, 2026-09-06)
    }
    for (const [k, v] of facts) {
      const r = el('div', 'lk__fact');
      r.append(el('span', 'k', k), el('span', 'v', String(v)));
      factsEl.append(r);
    }
    drawMap();
  }

  function paintSel() {
    cards.forEach((c, i) => c.classList.toggle('is-sel', i === sel));
    const it = view[sel];
    // specs/0061 (one click, 2026-09-06) — the T hint is true of a PLACES row
    // and of nothing else, so it is drawn from the row under the cursor rather
    // than from the tab. `canEquip` is the same test `equip()` branches on, so
    // the hint cannot drift from what the key does.
    goHint.hidden = tab().kind !== 'trail' || !it || !!it.canEquip;
    if (!it) return;
    if (cards[sel] && cards[sel].scrollIntoView) cards[sel].scrollIntoView({ block: 'nearest' });
    // specs/0061 §3.1 — the map board belongs to ONE tab, and it is off
    // everywhere else before any branch below can forget to turn it off
    mapBox.hidden = tab().kind !== 'trail';
    if (tab().kind === 'settings') { paintSettings(it); return; }
    if (tab().kind === 'trail') { paintTrail(it); return; }
    hero.hidden = false;
    const g = groupTint(it.group);
    det.style.setProperty('--g', g);
    const isEq = equippedCode() === it.id;
    // a thumbless item hides the art rather than setting src="", which some
    // browsers resolve as a second request for the page itself
    heroImg.hidden = !it.thumb;
    if (it.thumb) heroImg.src = it.thumb;
    heroBg.style.backgroundImage = it.thumb ? `url(${it.thumb})` : 'none';
    heroEq.hidden = !isEq;
    dBrand.textContent = it.brand || '';
    dAfter.textContent = it.after || ''; dAfter.hidden = !it.after;
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
    goHint.hidden = true;                          // paintSel turns it back on
    applyAccent();
    renderTabCounts();
    renderSubs();
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
    // specs/0061 §1.3 — the trail tab opens on the EQUIPPED trail, which is what
    // "opens on what is equipped" means here; every rack's answer is unchanged.
    const eqTrail = trailNow();
    const want = TABS[n].kind === 'trail' && eqTrail ? eqTrail.id : equippedCode();
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
    // specs/0055 5.2 — on the trail tab "equip" is "go there", and onEquip is
    // NOT called: this tab changes no gear, so main.js must never hear from it.
    // specs/0061 §1.2 — ...and as of this spec "equip" is EQUIP again, in the
    // one sense this tab can mean it: the run becomes the trail you are
    // following.
    // specs/0061 (one click, 2026-09-06) — and it is BOTH halves in one press:
    // the trail goes down and you go to the top of it. Nothing was moved behind
    // a second target. `onEquip` still never fires — a trail is not gear.
    if (t.kind === 'trail') { equipTrail(it); return; }
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
    if (t.apply) t.apply(it.id, t.kind === 'outfit' ? part : undefined);
    // specs/0039 §4 — on a part sub-tab the card's id is ONE of the seven codes
    // in the look, and `equipped[t.id] = it.id` above wrote it as if it were the
    // whole thing. What is actually worn is the merged look `setOutfit` has just
    // written, so it is read back off the rig. (`remember` ran BEFORE `apply` and
    // wrote the bare code; setOutfit's own rememberOutfit then corrected the key —
    // the harmless double write 0038 already lives with.)
    if (t.kind === 'outfit') equipped.outfit = (window.__player && window.__player.outfit) || it.id;
    // An item may name its own controller gear (the glider tab's two flight
    // models do); otherwise the tab's does. And a tab that switches NO mode at
    // all — specs/0038's outfit rack, which is paint and a handful of visibility
    // toggles — names THE ONE YOU ARE ALREADY IN, so main.js's fall-through
    // `else if (ctrl.mode !== gear) ctrl.setMode(gear)` is a no-op rather than a
    // setMode(undefined). Naming the current mode is the honest answer here:
    // equipping a suit leaves you riding exactly what you were riding.
    // specs/0039 §5 — what the HUD says it just put on: the house and the look on
    // `looks`, the house and the part on a part sub-tab (the item carries
    // `tag: part`). main.js prints `equipped · <name>` and is not touched here.
    const worn = t.kind === 'outfit' ? it.brand + ' ' + (part === 'looks' ? it.name : it.tag) : it.name;
    if (onEquip) onEquip({ tab: t.id, gear: it.gear || t.gear || (ctrl && ctrl.mode), kind: t.kind, id: it.id, name: worn });
    paintBadges();
    paintSel();
    renderLoadout();
    // specs/0038 §2.5 — the look is WORN now: `apply` re-painted the live rig and
    // paintSel() has just re-run the try-on with the same code, so the mannequin
    // already matches. Dropping tryOn hands the toggles back to loop()'s pairs
    // copy, which from here on is the same answer by a shorter road.
    if (pv && t.kind === 'outfit' && pv.tryOn === equipped.outfit) pv.tryOn = null;
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
      const want = equippedCode() === view[i].id;
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
    if (tab().kind === 'settings' || tab().kind === 'trail') return 1;
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
    // specs/0038 §2.1 — the preview rig owns its material now, so a setOutfit
    // that happened while the locker was shut is no longer followed for free the
    // way the shared material followed it. Re-dress the mannequin in the WORN
    // look on the way in, which is one call and keeps 0037's promise: a console
    // or URL change is on the figure the next time you press I.
    if (pv) { previewOutfit(THREE, pv, window.__player?.outfit); pv.tryOn = null; }
    // ...and take the equipped code from the world for the same reason: a
    // __player.setOutfit that never went through this screen still lands on the
    // right card's badge.
    if (window.__player && window.__player.outfit) equipped.outfit = window.__player.outfit;
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
    // ...and the map board with it (specs/0061 §3.3): it is measured off its own
    // box, which on the opening frame is still the box the layout has not
    // committed yet.
    requestAnimationFrame(() => { resizePreview(); drawMap(); });
  }
  function hide() {
    if (!open) return;
    open = false;
    if (pv) pv.hold = null;
    // specs/0038 §2.6 — closing the locker mid-hover must never leave the
    // mannequin in a suit nobody is wearing: the worn look goes back on before
    // the panel is gone, so the next open opens on the truth.
    if (pv && pv.tryOn != null) { previewOutfit(THREE, pv, window.__player?.outfit); pv.tryOn = null; }
    root.classList.remove('is-in');
    root.classList.add('is-out');
    // the panel is inert the instant open flips; the 150 ms is only the fade
    if (outT) clearTimeout(outT);
    outT = setTimeout(() => { outT = 0; if (!open) { root.hidden = true; root.classList.remove('is-out'); } }, 150);
  }

  addEventListener('resize', () => { if (open) { resizePreview(); drawMap(); } });

  // specs/0037 §5 — turntable harness: open the locker (openInventory's own path),
  // hold the preview rig at yaw `rad` (null releases the idle spin), let one held
  // frame render (2 rAFs: show() queues loop, then resizePreview clears the canvas),
  // resolve with the yaw actually applied.
  window.__locker = Object.assign(window.__locker || {}, {
    turntable(rad) {
      show();
      pv.hold = rad == null ? null : Number(rad);
      pv.t = 0;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(pv.turntable.rotation.y))));
    },
    // specs/0038 §2 — the code the mannequin is TRYING ON, null when it is
    // wearing the worn look. "Leaving the tab puts the suit back" and "the tab
    // happened to look the same" are the same picture; this is the only way a
    // harness can tell them apart.
    tryOn: () => (pv ? pv.tryOn : null),
    // specs/0041 §4.8 / N18 — the mannequin, for the harness. The two Object3D
    // handles are read INSIDE a page.evaluate and never serialised out of it
    // (that is what `pairs`/`mats`/`clip` are for); `__locker`'s key set is
    // noted by C13, not judged, so a hook here costs no baseline.
    mannequin: () => (pv ? {
      body: pv.cBody, skin: pv.cSkin, clip: pv.clip, want: pv.want,
      baked: [...pv.clips.keys()],
      pairs: pv.riderPairs.length, mats: pv.riderMats.size, toggles: pv.riderToggles.length,
      pos: pv.cBody ? [pv.cBody.position.x, pv.cBody.position.y, pv.cBody.position.z] : null,
      visible: !!(pv.cBody && pv.cBody.visible), pack: !!(pv.cPack && pv.cPack.visible),
      glider: !!(pv.cGlide && pv.cGlide.visible),
    } : null),
    // specs/0039 §3/§4.3 — which sub-tab is up (G's target), and what the 7 × 32
    // part thumbs cost to generate, once, on the first part sub-tab rendered.
    sub: () => part,
    setSub,
    thumbMs: () => _ptMs,
    // specs/0061 §3.3/§3.4 — what the last paint drew and what it cost, and the
    // hit-test as the canvas click performs it. `mapPickAt` takes CSS pixels
    // inside the canvas, which is what a synthetic click carries.
    mapStats: () => (mapStats
      ? { ms: mapStats.ms, runs: mapStats.runs, lifts: mapStats.lifts, markers: mapStats.markers, you: mapStats.you, w: mapStats.w, h: mapStats.h, box: mapStats.box }
      : null),
    mapDraw: () => { const s = drawMap(); return s ? { ms: s.ms, runs: s.runs, lifts: s.lifts, markers: s.markers, you: s.you } : null; },
    mapPickAt: (x, y) => (mapStats ? mapPick(mapStats.hits, x, y) : null),
    // where a run's polyline sits on the canvas right now, so a headless click
    // can be aimed at a real segment instead of at a guess
    mapMid: (id) => {
      const h = mapStats && mapStats.hits.find((q) => q.id === id);
      if (!h || !h.scr.length) return null;
      const m = h.scr[Math.floor(h.scr.length / 2)];
      return { x: +m[0].toFixed(1), y: +m[1].toFixed(1) };
    },
    trail: () => trailNow(),
    // specs/0061 (families, 2026-09-06) — the derived row table itself, so the
    // acceptance can read which member lines a row carries without scraping the
    // DOM for something the DOM does not print.
    rows: () => trailRows(WORLD, UPAXIS).map((r) => ({
      id: r.id, name: r.name, diff: r.diff, section: r.section,
      segments: r.segments.slice(), canEquip: r.canEquip,
    })),
  });

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
      // specs/0061 (M opens the map, 2026-09-06) — M is the trail tab's own key
      // in here too: on the trail tab it is the way back out (M opened it, M
      // shuts it, the way I does), and on any other tab it is the way TO it.
      // One key, one destination, and it never lands you somewhere you did not
      // ask for.
      if (code === 'KeyM') {
        if (tab().kind === 'trail') { hide(); return true; }
        const i = TABS.findIndex((t) => t.kind === 'trail' && !broken.has(t.id));
        if (i >= 0) setTab(i);
        return true;
      }
      if (code === 'KeyQ') { setTab(tabIdx - 1, -1); return true; }
      if (code === 'KeyE' || code === 'Tab') { setTab(tabIdx + 1, 1); return true; }
      if (code === 'KeyF') {
        const gs = ['all', ...groupsOf(safeItems(tab()))];
        filter = gs[(gs.indexOf(filter) + 1) % gs.length];
        sel = 0; renderAll(); return true;
      }
      // specs/0039 §3 — G walks the outfit tab's sub-strip. It was free: the
      // locker already spends W/A/S/D, the arrows, Space, F, Q/E, Tab, I and
      // Escape, and nothing else wanted it.
      if (code === 'KeyG') {
        if (tab().kind === 'outfit') setSub(SUBS[(SUBS.indexOf(part) + 1) % SUBS.length]);
        return true;
      }
      // specs/0061 (one click, 2026-09-06) — T IS THE PLACES' KEY. It is still
      // the key the mountain uses for fast travel (markers.js's own T), and the
      // places section is still nothing but fast travel — but a run row does
      // both halves on Enter now, so T on a run would be the two-step this
      // change removed. It acts on exactly the rows whose whole action is
      // travel, which is the same test the footer hint is drawn from.
      if (code === 'KeyT') {
        const t = view[sel];
        if (tab().kind === 'trail' && t && !t.canEquip) travelTo(t);
        return true;
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
    // neither is the settings page (specs/0019) or the outfit tab (specs/0038) —
    // neither holds gear, main.js reports this list as the loadout's gear types,
    // and the deploy gate asserts it is exactly the six racks in order. The test
    // is `gear` rather than a list of kinds, so the next tab that switches no
    // controller mode is right on the day it lands. `pages()` below is where the
    // two non-rack tabs are visible, and `tab()` still names whichever tab is on
    // screen.
    tabs: () => TABS.filter((t) => !broken.has(t.id) && t.gear).map((t) => t.id),
    pages: () => TABS.filter((t) => !broken.has(t.id) && !t.gear).map((t) => t.id),
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
