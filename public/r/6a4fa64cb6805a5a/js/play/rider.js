// specs/0041 §4 — the rider: ONE `THREE.SkinnedMesh` over a `rider:*` armature
// decoded from rider-mesh.js's quantised blob, its bone-parented rigid toggles
// (§1.5), an `AnimationMixer` on simulation time (§4.2), the 17-bone fp rig
// `play:fp-arms` (§2.5), and the specs/0039 atlas painter (a LOOK is seven
// codes; every region, swatch cell and flag has exactly one owning part, OWN /
// FLAG_OWN; ops are region-local in OP space, outfits.md §2). It replaces
// specs/0037 §3's thirty rigid segment meshes; `play:body` is the same Group.
//
//   buildRider(THREE, u, {outfit}) → {model, armL, armR, head, parts, bone, mixer, fp, update, setOutfit, …}
//   cloneRig(rig)                 → the locker mannequin, on its OWN skeleton (§2.7)
//   retarget(clip, from, to, names) → a body clip on the fp rig (§2.5)
//   paint(look, THREE?, {cache})  → {canvas, texture}   lazy, ≤12 looks cached
//   resolveOutfit() / rememberOutfit(look)              ?outfit= → localStorage → 'g00'
//   parseLook(s) / serialise(l) / PARTS                 specs/0039 §1, the seven codes
//   window.__rig                  → the bone probe (§4.1), never on __player
//
// RFLIP: the R limb regions are the mirror image of L in UV (atlas.json), so an
// explicit R op flips in x and `mirror L R` is a plain copy — set it false if the
// bake ever ships same-handed R UVs (then mirror = flip).
//
// specs/0044 §A: the goggles come OFF. Slot 1 of a look also takes `x` = none,
// `rider:goggles` is a toggle of its own in the bake, and the compositor paints
// eye marks into the `face` region on every look — the band hid them all along.
//
// Coordinates: every op is region-local in OP space (outfits.md §2: sleeves and
// legs x 0 inner, 16 front, 32 OUTER, 48 back); the atlas (atlas.js from
// tools/rider/atlas.json) puts the outer seam at x 0, so limb ops roll by
// `opRoll` and are drawn twice (+roll, +roll−W) so a shape crossing the seam
// wraps. The R limb regions are the mirror image of L in UV (atlas.json), so
// an explicit R op flips in x (RFLIP) and `mirror L R` is a plain copy — set
// RFLIP=false if the bake ships same-handed R UVs (then mirror = flip).
import * as MESH from './rider-mesh.js';
import * as POLISH from './rider-polish-mesh.js';
import { applyRiderCloth } from './rider-cloth.js';
import { createDrapeLayout, createRiderDrape } from './rider-drape.js';
import { mountDrapeControls } from './rider-drape-controls.js';
import { createRiderStance } from './rider-stance.js';
import { tailorRiderParts } from './rider-tailoring.js';
import { tailorRiderUpperParts } from './rider-upper-tailoring.js';
import { buildRiderFpvGeometry } from './rider-fpv.js';
import { stepAirEnvelope } from './rider-air-envelope.js';
import { riderFinishBinding, applyRiderFinish } from './rider-finish.js';
import { C as CLIP_BLOB } from './rig/clips.js';
// specs/0045 §7.2 — the procedural cube envmap: six 16² faces of the world's own
// sky and snow, no shipped asset (D7, C19), no PMREM import (WebGLCubeUVMaps runs
// the core generator). A metalness of 0.8 with no environment is black.
import { envFor, defaultEnv, FACE } from './rig/env.js';
// specs/0046 §4.6 — the degrade ladder's one gate, imported from its canonical
// home now that C4's file exists; re-exported below, at §4.6's own block.
import { COARSE, LOW_END } from './rig/bloom.js';
// §4.3 — the blend tree's ski inputs (`carveRoll`, and `push`, which already
// encodes the :884 skate gate). Read here rather than handed through
// `rig.update`'s `o`, so the carve, the pole plant and the skate cannot go quiet
// on a call site that forgets them; ski.js itself is NOT edited (§0.1).
import { skiState } from './ski.js';
// §4.5 write 4 / §10.8 — the sled's steer output. `deckRoll` is the field, in rad,
// range ±`S.deckRoll = 0.34` (sled.js:77), smoothed at sled.js:241 and already the
// number `main.js:1345` and `rollSledRig` read; `sledState()` carries no other
// steer term (sled.js:114-124), which is §10.8's answer. Read here, not through
// `rig.update`'s `o`, for the same reason `skiState` is — sled.js is NOT edited.
import { sledState } from './sled.js';
// the landing's other input: the judge's verdict (clean / sketchy, tricks.js:390),
// read here for the same reason skiState is. tricks.js imports nothing: no cycle.
import { state as trickState } from './tricks.js';
import { OUTFITS, byCode } from './outfits/index.js';
import { SIZE, INSET, R as REG, C as CELL, ALIAS } from './atlas.js';

export { OUTFITS, byCode };
export const KEY = 'poi-lab.play.outfit';
const RFLIP = true;
const SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const CELL_PX = 22;
const IRIS = 0x3a2f26;                // specs/0050-DECISIONS §4 — the eyeballs' one texel (see paintLook layer 1b)
const SKIN = 0xd2a682;                // specs/0050-DECISIONS §9.6 — the `face` default under the house white (paintLook layer 1)
const FACE_WHITE = new Set([0xf4f1ea, 0xf6f8f8]);

// ---- ski.js idiom, duplicated (ski.js is not touched)
export function seeded(s) {
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function band(x, c, a, b, W, H) { x.fillStyle = c; x.fillRect(0, H * a, W, H * (b - a)); }
function tracked(x, s, track) {
  let w = 0; const widths = [];
  for (const ch of s) { const cw = x.measureText(ch).width; widths.push(cw); w += cw + track; }
  return { w: w - track, widths };
}
function drawTracked(x, s, cx, cy, track) {
  const { w, widths } = tracked(x, s, track);
  let px = cx - w / 2, i = 0;
  for (const ch of s) { x.fillText(ch, px, cy); px += widths[i++] + track; }
  return w;
}
// reads down (rot 90) or across; centre-anchored, tracked like ski.js's runText/crossText
function runText(x, s, cx, cy, size, colour, o = {}) {
  x.save();
  x.translate(cx, cy); x.rotate((o.rot || 0) * Math.PI / 180);
  x.fillStyle = colour;
  x.font = `${o.weight || 700} ${size}px ${o.font || SANS}`;
  x.textBaseline = 'middle';
  const w = drawTracked(x, s, 0, 0, o.track == null ? size * 0.06 : o.track);
  x.restore();
  return w;
}
export const crossText = (x, s, cx, cy, size, colour, o = {}) => runText(x, s, cx, cy, size, colour, { ...o, rot: 0 });
function hatch(x, x0, y0, w, h, gap, colour, lw = 1) {
  x.save();
  x.beginPath(); x.rect(x0, y0, w, h); x.clip();
  x.strokeStyle = colour; x.lineWidth = lw;
  for (let i = -h; i < w + h; i += gap) {
    x.beginPath(); x.moveTo(x0 + i, y0 + h); x.lineTo(x0 + i + h, y0); x.stroke();
  }
  x.restore();
}
export function star5(x, cx, cy, r, colour, tilt = -Math.PI / 2) {
  x.fillStyle = colour; x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = tilt + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath(); x.fill();
}
const poly = (x, pts, c) => { x.fillStyle = c; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); };
const line = (x, pts, c, lw, close) => {
  x.strokeStyle = c; x.lineWidth = lw; x.lineJoin = x.lineCap = 'round'; x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); if (close) x.closePath(); x.stroke();
};
const rrect = (x, x0, y0, w, h, r, c) => { x.fillStyle = c; x.beginPath(); x.roundRect ? x.roundRect(x0, y0, w, h, r) : x.rect(x0, y0, w, h); x.fill(); };
const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

// ---- house glyphs (outfits.md §3): drawn about (0,0), s = bounding size (exported for the locker cards, spec 0038)
export const GLYPH = {
  cluster(x, s, c) {
    const r = seeded(7);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + r() * 0.8, d = s * (0.14 + r() * 0.14), cx = Math.cos(a) * d, cy = Math.sin(a) * d, rr = s * (0.14 + r() * 0.08);
      const pts = [];
      for (let i = 0; i < 5; i++) { const t = i * Math.PI * 0.4 + r() * 0.5, q = rr * (0.7 + r() * 0.6); pts.push([cx + Math.cos(t) * q, cy + Math.sin(t) * q]); }
      poly(x, pts, c);
    }
  },
  bird(x, s, c) {
    line(x, [[-0.5 * s, 0.1 * s], [-0.2 * s, -0.3 * s], [0.15 * s, -0.2 * s], [0.5 * s, 0.25 * s]], c, s / 9);
    for (const t of [-0.05, 0.1, 0.25]) { const y = (t <= 0.15 ? -0.3 + (t + 0.2) / 3.5 : -0.2 + (t - 0.15) / 0.78) * s; line(x, [[t * s, y], [t * s, y + 0.12 * s]], c, s / 12); }
  },
  duet(x, s, c) {
    for (const m of [-1, 1]) {
      x.fillStyle = c; x.beginPath(); x.arc(m * 0.24 * s, -0.28 * s, 0.17 * s, 0, 7); x.fill();
      const b = [[m * 0.06 * s, -0.05 * s], [m * 0.46 * s, -0.05 * s], [m * 0.3 * s, 0.45 * s]];
      poly(x, b, c); line(x, b, c, s * 0.1, true);
    }
  },
  dart3up(x, s, c) {
    for (let i = -1; i <= 1; i++) { const y = i * 0.3 * s; line(x, [[-0.4 * s, y + 0.15 * s], [0, y - 0.15 * s], [0.4 * s, y + 0.15 * s]], c, s / 8); }
  },
  ember(x, s, c) {
    x.fillStyle = c; x.beginPath(); x.moveTo(0, 0.5 * s);
    x.quadraticCurveTo(-0.55 * s, 0.1 * s, 0.1 * s, -0.5 * s);
    x.quadraticCurveTo(0.55 * s, 0.15 * s, 0, 0.5 * s); x.fill();
  },
  ring(x, s, c) { x.strokeStyle = c; x.lineWidth = s / 4; x.beginPath(); x.arc(0, 0, s / 2, 0, 7); x.stroke(); },
  lark(x, s, c) {
    x.fillStyle = c; x.beginPath(); x.arc(0.25 * s, -0.2 * s, 0.18 * s, 0, 7); x.fill();
    poly(x, [[-0.5 * s, 0.3 * s], [0.35 * s, -0.05 * s], [0.25 * s, 0.4 * s]], c);
    line(x, [[-0.4 * s, 0.25 * s], [-0.55 * s, 0.05 * s]], c, s / 10);
  },
  tree(x, s, c) {
    poly(x, [[-0.4 * s, 0.3 * s], [0, -0.15 * s], [0.4 * s, 0.3 * s]], c);
    poly(x, [[-0.28 * s, 0], [0, -0.5 * s], [0.28 * s, 0]], c);
    x.fillRect(-0.05 * s, 0.3 * s, 0.1 * s, 0.2 * s);
  },
};

// ---- the ops (outfits.md §3), in op space; W,H = the region's op size
const OPS = {
  fill: (x, W, H, c) => { x.fillStyle = c; x.fillRect(0, 0, W, H); },
  hband: (x, W, H, y0, y1, c) => band(x, c, y0 / H, y1 / H, W, H),
  vstripe: (x, W, H, x0, x1, c) => { x.fillStyle = c; x.fillRect(x0, 0, x1 - x0, H); },
  tape(x, W, H, w, c, word, ink) {
    x.fillStyle = c; x.fillRect(32 - w / 2, 0, w, H);
    if (!word) return;
    x.font = `700 7px ${SANS}`;
    const step = x.measureText(word).width + 6;
    for (let y = 4 + step / 2; y < H; y += step) runText(x, word, 32, y, 7, ink, { rot: 90, track: 0.5 });
  },
  poly: (x, W, H, pts, c) => poly(x, pts, c),
  polys(x, W, H, seed, n, rMin, rMax, c, [cx, cy, rx, ry]) {
    const r = seeded(seed);
    for (let k = 0; k < n; k++) {
      const a = r() * 6.2832, d = Math.sqrt(r()), px = cx + Math.cos(a) * d * rx, py = cy + Math.sin(a) * d * ry;
      const sides = 5 + Math.floor(r() * 3), rad = rMin + r() * (rMax - rMin), pts = [];
      for (let i = 0; i < sides; i++) { const t = i * 6.2832 / sides + r() * 0.4, q = rad * (0.65 + r() * 0.7); pts.push([px + Math.cos(t) * q, py + Math.sin(t) * q]); }
      poly(x, pts, c);
    }
  },
  chev(x, W, H, cx, cy, hw, h, lw, c, dir) {
    const d = dir === 'up' ? -1 : 1;
    x.strokeStyle = c; x.lineWidth = lw; x.lineJoin = 'miter'; x.lineCap = 'butt'; x.beginPath();
    x.moveTo(cx - hw, cy - h * d); x.lineTo(cx, cy); x.lineTo(cx + hw, cy - h * d); x.stroke();
  },
  zig(x, W, H, y, amp, n, lw, c) {
    const pts = [];
    for (let i = 0; i <= 2 * n; i++) pts.push([W * i / (2 * n), y + (i % 2 ? -amp : amp)]);
    line(x, pts, c, lw);
  },
  curve(x, W, H, y, sag, h, c) {
    x.fillStyle = c; x.beginPath(); x.moveTo(0, y); x.quadraticCurveTo(W / 2, y + 2 * sag, W, y);
    x.lineTo(W, y + h); x.quadraticCurveTo(W / 2, y + h + 2 * sag, 0, y + h); x.closePath(); x.fill();
  },
  rect: (x, W, H, x0, y0, w, h, c) => { x.fillStyle = c; x.fillRect(x0, y0, w, h); },
  stroke: (x, W, H, pts, c, lw) => line(x, pts, c, lw),
  plates(x, W, H, cx, y0, y1, n, w, c, gap) {
    const h = (y1 - y0 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) rrect(x, cx - w / 2, y0 + i * (h + gap), w, h, Math.min(4, h / 3), c);
  },
  straps: (x, W, H, c, lw) => { line(x, [[12, 0], [48, 70], [84, 0]], c, lw); line(x, [[48, 70], [48, 128]], c, lw); },
  cross(x, W, H, cx, cy, arm, th, c) { x.fillStyle = c; x.fillRect(cx - arm, cy - th / 2, 2 * arm, th); x.fillRect(cx - th / 2, cy - arm, th, 2 * arm); },
  hatch: (x, W, H, x0, y0, w, h, gap, c, lw) => hatch(x, x0, y0, w, h, gap, c, lw),
  text: (x, W, H, s, cx, cy, size, c, o) => runText(x, s, cx, cy, size, c, o),
  mark(x, W, H, g, cx, cy, s, c) { x.save(); x.translate(cx, cy); (GLYPH[g] || GLYPH.ring)(x, s, c); x.restore(); },
};

// ---- the painter
const region = (name) => { const k = ALIAS[name] || name; return { k, r: REG[k] }; };
// run `fn(ctx, W, H)` in a region's op space: translate + scale + clip, the limb
// roll (twice, so shapes wrap the seam) and the R-side flip.
function inRegion(x, name, fn) {
  const { k, r } = region(name);
  if (!r) return;
  const [rx, ry, rw, rh, W, H, s, , roll] = r;
  const flip = RFLIP && /R$/.test(k);
  for (const dx of roll ? [roll, roll - W] : [0]) {
    x.save();
    x.translate(rx, ry); x.scale(s, s);
    x.beginPath(); x.rect(0, 0, rw / s, rh / s); x.clip();
    x.translate(dx, 0);
    if (flip) { x.translate(W, 0); x.scale(-1, 1); }
    fn(x, W || rw / s, H || rh / s);
    x.restore();
  }
}
function fillCell(x, name, c) {
  const { r } = region(name);
  x.fillStyle = c; x.fillRect(r[0] - INSET, r[1] - INSET, r[2] + 2 * INSET, r[3] + 2 * INSET);
}
// specs/0046 §2.5 — the colour canvas is 1024² now and every other canvas is
// still 512², so the painter runs under a base `scale(k, k)` with k = canvas/SIZE
// and keeps ALL of its coordinates in 512 atlas space (which is why no op array
// and no outfits/*.js file is edited). The two helpers that read the canvas back
// with `drawImage` are the exception the one-line claim glosses over: a drawImage
// SOURCE rect is in image pixels and does not go through the CTM, so it — and only
// it — carries the k. Destination rects stay in atlas space and are transformed
// like every other fill.
// copy L → R (plain under RFLIP: the R UVs are already the mirror image)
function mirror(x, cv, from, to, k = 1) {
  const a = region(from).r, b = region(to).r;
  x.save(); x.beginPath(); x.rect(b[0], b[1], b[2], b[3]); x.clip();
  if (RFLIP) x.drawImage(cv, a[0] * k, a[1] * k, a[2] * k, a[3] * k, b[0], b[1], b[2], b[3]);
  else { x.translate(b[0] + b[2], b[1]); x.scale(-1, 1); x.drawImage(cv, a[0] * k, a[1] * k, a[2] * k, a[3] * k, 0, 0, b[2], b[3]); }
  x.restore();
}
// the 4 px inset around every region: wrap for cylinders, clamp for flats, so
// LinearFilter never blends a seam with the base colour. The clamp strip is ONE
// atlas texel wide, which is `k` real pixels — sampling 1 px at k = 2 would clamp
// off the wrong half of the doubled edge.
function pad(x, cv, k = 1) {
  x.save(); x.imageSmoothingEnabled = false;
  for (const [rx, ry, w, h, , , , cyl] of Object.values(REG)) {
    const I = INSET;
    if (cyl) { x.drawImage(cv, (rx + w - I) * k, ry * k, I * k, h * k, rx - I, ry, I, h); x.drawImage(cv, rx * k, ry * k, I * k, h * k, rx + w, ry, I, h); }
    else { x.drawImage(cv, rx * k, ry * k, k, h * k, rx - I, ry, I, h); x.drawImage(cv, (rx + w - 1) * k, ry * k, k, h * k, rx + w, ry, I, h); }
    x.drawImage(cv, (rx - I) * k, ry * k, (w + 2 * I) * k, k, rx - I, ry - I, w + 2 * I, I);
    x.drawImage(cv, (rx - I) * k, (ry + h - 1) * k, (w + 2 * I) * k, k, rx - I, ry + h, w + 2 * I, I);
  }
  x.restore();
}

const PREFILL = { chestFront: 'jacket', back: 'jacket', sleeveL: 'sleeve', sleeveR: 'sleeve', legL: 'pants', legR: 'pants',
  helmet: 'helmet', belt: 'belt', strap: 'strap', lens: 'lens', pole: 'pole', face: 'face', glove: 'glove', boot: 'boot' };
// `sleeve` is optional (g00's dark arms, spec §3 "today's rider"); it falls back to the jacket for every other look
const FALLBACK = { beltEdge: 'belt', beltBuckle: 'belt', strapTick: 'strap', poleGuards: 'pole', anorak: 'jacket', poleBand: 'pole', belt: 'pants', sleeve: 'jacket' };
export const swatch = (p, k) => p[k] == null ? p[FALLBACK[k]] ?? p.jacket : p[k];

// ---- specs/0045 §7.1 — the PBR channels, painted from the SAME op lists
// Blender node shaders do not run in three.js and a baked texture asset is banned
// under bench/public (D7, C19), so the rider goes PBR the procedural way: the maps
// are painted at runtime out of the 32 op lists that already exist, and Blender
// contributes only what a browser cannot compute — AO (§7.3).
//
// specs/0046 §2.5 — THREE canvases now, not four, and the colour one is 1024²:
//   map       RGB   the colour atlas, 1024² (§2.5) — 512 atlas space × scale(2,2)
//   ORM       R = CLEARCOAT (§3.2 — 0045 left R free), G = roughness,
//             B = metalness (three.module.js:424 reads metalnessMap.b, :470 reads
//             roughnessMap.g, :1249 reads clearcoatMap.r — the glTF ORM convention
//             and the reason ONE canvas is three maps)
//   emissive  RGB   colour × glow, so a look can light one op without the rest
//
// 0045's runtime NORMAL canvas is deleted, and specs/0046 §2.5 calls that a saving
// rather than a cut: it existed to Sobel a height field because nothing else could
// give the rider a normal, and §2.2's baked 1024² `rider-nrm.webp` does that job
// from a real Cycles detail pass. Two normal maps on one material fight — three
// applies `bumpMap` after `normalMap` in `normal_fragment_maps` — so there is
// exactly one. 0045 §3.3's rung 5 is taken unconditionally here.
//
// The `bump` op attribute KEEPS its meaning (§2.5): a raised texel is a texel the
// lacquer pools on, so `bump` biases the ORM canvas's clearcoat channel by
// ±COAT_BUMP instead of writing a height canvas. No shipped op authors one
// (§2.1 forbids editing the op lists), so all 32 looks are unchanged by the swap.
//
// §7.1's four resolution layers, later wins: region default → node default →
// look `mats` → op attributes. All of them run inside one paintLook()
// parameterised by a CHANNEL, rather than two copies of the pass.
const GLOW0 = 0x73 / 0xff;                      // 0.45098 — exactly today's emissive 0x737373
// §7.1's region prefill, in ORM terms (metal, rough). A region not named here is
// fabric. `swatch` covers every flat colour cell (atlas.js's C).
// specs/0046 §3.2 — a THIRD column, `coat`: the clearcoat layer's strength. A
// painted hard shell IS a clearcoat and that is the single biggest visual win in
// the spec, so `helmet` carries 0.85 and `lens` 1.00 while fabric carries none.
const M_FAB = [0, 0.85, 0.00];
const REGION_MAT = { chestFront: M_FAB, back: M_FAB, sleeveL: M_FAB, sleeveR: M_FAB, legL: M_FAB, legR: M_FAB,
  strap: [0, 0.90, 0.00], belt: [0, 0.80, 0.00], helmet: [0.10, 0.35, 0.85], lens: [0.10, 0.05, 1.00], face: [0, 0.60, 0.00],
  glove: [0, 0.65, 0.20], boot: [0, 0.65, 0.20], pole: [0.60, 0.25, 0.35], swatch: M_FAB };
// §3.2's last row — the armour nodes are lacquered plate at 0.70. A node NOT named
// here inherits the coat of the region it paints over, which is what keeps
// `helmet-cap` and `helmet-helm` on the helmet's own 0.85 instead of flattening it.
const NODE_COAT = { 'chest-plate': 0.70, 'pauldron-l': 0.70, 'pauldron-r': 0.70, 'hip-plate': 0.70,
  'shin-l': 0.70, 'shin-r': 0.70, 'ferrum-chest': 0.70, 'ferrum-gauntlet-l': 0.70, 'ferrum-gauntlet-r': 0.70 };
const COAT_BUMP = 0.25;                         // §2.5 — how far a `bump` of ±1 moves the coat
// the coat a NODE default inherits when NODE_COAT does not name it: the region it
// draws into. `@cell` is a flat swatch square, which is fabric.
const coatOfArea = (a) => {
  if (a.charCodeAt(0) === 64) return M_FAB[2];
  const i = a.indexOf(':'), r = i < 0 ? a : a.slice(0, i);
  return (REGION_MAT[ALIAS[r] || r] || M_FAB)[2];
};
// §7.1 step 2 — the NODE default: `gen/kits.py`'s `mat` column painted over the
// declared sub-rectangle of §1.2's UV column, and only for the nodes a look
// actually shows. Rows whose `mat` IS the region default are omitted: painting
// them would be a no-op and 0045 §3.1 charges this table by the byte. An area is
// `region` (the whole rectangle), `region:x,y,w,h` (that region's OP space, §1.2's
// UV column verbatim) or `@cell` (a flat swatch square). gen/kits.py's order.
const NODE_MAT = [
  ['puffy', 0, 0.90, 'chestFront back sleeveL sleeveR'],
  ['chest-plate', 0.80, 0.30, 'chestFront:0,20,96,50'],
  ['pauldron-l', 0.80, 0.30, 'sleeveL:0,0,64,24'], ['pauldron-r', 0.80, 0.30, 'sleeveR:0,0,64,24'],
  ['hip-plate', 0.80, 0.30, 'legL:0,0,64,24 legR:0,0,64,24'],
  ['pants-slim', 0, 0.80, 'legL legR'], ['pants-baggy', 0, 0.90, 'legL legR'],
  ['bloused-l', 0, 0.90, 'legL:0,104,64,24'], ['bloused-r', 0, 0.90, 'legR:0,104,64,24'],
  ['boot-race', 0, 0.55, 'boot'], ['boot-freeride', 0, 0.75, 'boot'],
  ['belt-boxes', 0.70, 0.35, '@beltBuckle'],
  ['shin-l', 0.50, 0.35, 'legL:6,72,20,46'], ['shin-r', 0.50, 0.35, 'legR:6,72,20,46'],
  ['pole-guard-l', 0.30, 0.40, '@poleGuards'], ['pole-guard-r', 0.30, 0.40, '@poleGuards'],
  ['head-robot', 0.35, 0.45, 'face helmet'],
  ['helmet-cap', 0, 0.70, 'helmet'], ['helmet-helm', 0.25, 0.12, 'helmet'],
  ['goggles-thick', 0.10, 0.05, 'strap'], ['goggles-rimless', 0.10, 0.05, 'strap'],
  ['mask', 0.20, 0.20, 'helmet:24,0,16,16'],
  ['ferrum-chest', 0.85, 0.25, 'chestFront:0,26,96,34'],
  ['ferrum-gauntlet-l', 0.85, 0.25, 'sleeveL:24,70,24,48'], ['ferrum-gauntlet-r', 0.85, 0.25, 'sleeveR:24,70,24,48'],
  ['umbra-cape', 0, 0.55, 'back'],
  ['umbra-chest-box', 0.40, 0.35, 'chestFront:0,34,96,24'], ['umbra-back-plate', 0.40, 0.35, 'back:0,70,96,30'],
  ['phantom-disc-l', 0.55, 0.35, 'sleeveL:0,0,64,20'], ['phantom-disc-r', 0.55, 0.35, 'sleeveR:0,0,64,20'],
  ['phantom-chest', 0.45, 0.40, 'chestFront:0,18,96,46'],
  ['phantom-foot-l', 0.30, 0.50, 'boot'], ['phantom-foot-r', 0.30, 0.50, 'boot'],
  ['duke-tubes', 0, 0.65, 'sleeveL sleeveR legL legR'], ['duke-crest', 0.15, 0.30, 'chestFront:0,22,96,36'],
];
// §7.1's op-attribute rule, in one line: IF THE LAST ELEMENT OF AN OP ARRAY IS A
// PLAIN OBJECT, IT IS THAT OP'S ATTRIBUTE RECORD. `text`'s existing
// {track, weight, rot} live in the same object and the four reserved names
// (metal, rough, glow, bump) are disjoint from every layout key in use, so no
// existing op array changes shape and all 32 op lists stay correct with zero edits.
// specs/0046 §3.2 — one new reserved key, `coat` 0–1, region default 0.0. The
// resolution order is 0045 §7.1's, unchanged: region default → node default →
// look `mats` → op attribute.
const RESERVED = ['metal', 'rough', 'glow', 'bump', 'coat'];
function attrsOf(a) {
  const last = a[a.length - 1];
  if (!last || typeof last !== 'object' || Array.isArray(last)) return null;
  for (const k of RESERVED) if (last[k] !== undefined) return last;
  return null;                                   // a pure layout object is not an attribute record
}
// ORM as a CSS colour: R = CLEARCOAT (specs/0046 §3.2 — 0045 kept it 0 and free,
// and `clearcoatMap` reads `.x`), G = roughness, B = metalness.
const u8 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const orm = (m, r, c = 0) => `rgb(${u8(c)},${u8(r)},${u8(m)})`;
// colour × glow, done in LINEAR light and once per COLOUR rather than per texel.
// three multiplies `emissive` (sRGB-decoded, three.core.js Color.setHex) by the
// emissiveMap texel (also sRGB-decoded), so today's {emissive 0x737373,
// emissiveMap = map} is emissive_lin(0.1714) × texel_lin. With `emissive`
// 0xffffff the CANVAS has to carry that product, and the product is linear —
// a plain sRGB-space multiply would be 5/255 dark in the midtones.
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const _glowC = new Map();
function glow(css, g) {
  const key = css + '|' + g;
  let v = _glowC.get(key);
  if (v) return v;
  const n = parseInt(css.slice(1), 16), k = s2l(g);
  const ch = (sh) => Math.round(255 * l2s(s2l(((n >> sh) & 255) / 255) * k));
  v = `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
  _glowC.set(key, v);
  return v;
}

// ---- specs/0047 §1 — THE THREE COLOURS A LOOK LENDS THE FIRE.
//
// fx.js owns the flame, the trail and the speed lines; it does not own the
// locker, and it must never learn what an outfit IS. So the whole of the outfit
// side of 0047 is this one export: three `0xRRGGBB` numbers off the WORN look,
// which fx.js blends into colours it already had. Nothing here is a texture,
// nothing here allocates per frame, and nothing in fx.js can write back.
//
//   primary — the JACKET. The colour of the suit you can see from behind, and
//             what the flame charges toward while the power is still building.
//   accent  — the suit's own contrast: its declared `accent`, else the goggle
//             strap when the strap is genuinely a different value from the
//             jacket (a black strap on an orange shell is contrast; a black
//             strap on a black shell is the same garment), else the helmet.
//   glow    — the one LIGHT on the outfit: the lens, the second accent, the
//             thing that would be lit if anything on the suit were. It goes in
//             the white-hot core, so it is picked on PEAK CHANNEL rather than
//             perceived luminance — a glow is what its brightest channel does,
//             which is why Umbra's `accent2` red (0xd42a2a, peak 212) beats its
//             pewter `accent` (0x8a8d94, peak 148) even though the pewter is
//             the lighter of the two. `primary` is in the running as the last
//             candidate so a house with no lights at all (g00: no `accent2`,
//             a near-black lens) glows its own jacket rather than a black
//             flame. Both readings are what make §1's four named results come
//             out: Ferrum → cyan, Umbra → red light, Phantom → sensor white,
//             POI-LAB → orange.
//
// MIXED LOOKS (specs/0039) RESOLVE PER PART SOURCE, through the same `OWN`
// table the compositor paints with: `jacket`/`accent`/`accent2` off the jacket
// part's house, `strap`/`lens` off the goggles', `helmet` off the helmet's. A
// uniform look reads one palette, which is the 0039 rule, not a second one.
//
// Cached per SERIALISED look and handed back BY REFERENCE, so fx.js's
// per-frame "did the outfit change" is an object-identity test rather than a
// string compare — the same shape `bankState().launch` already uses over there.
const _lumOf = (n) => (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
const _peakOf = (n) => Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255);
const ACCENT_DV = 0.25;               // §1 — how far the strap must sit from the jacket to count as contrast
const _colours = new Map();
export function lookColours(look) {
  const key = look == null ? _worn : serialise(parseLook(look));
  const hit = _colours.get(key);
  if (hit) return hit;
  const src = srcOf(parseLook(key));
  // every cell read off the part that OWNS it (0039 §1), so a mixed look mixes
  const cell = (k) => swatch(src[ownerOf(k)].palette, k);
  const raw = (part, k) => src[part].palette[k];
  const primary = cell('jacket');
  let accent = raw('jacket', 'accent');
  if (accent == null) {
    const strap = cell('strap');
    accent = Math.abs(_lumOf(strap) - _lumOf(primary)) >= ACCENT_DV ? strap : cell('helmet');
  }
  let glow = primary;
  for (const c of [raw('jacket', 'accent2'), cell('lens'), accent]) {
    if (c != null && _peakOf(c) > _peakOf(glow)) glow = c;
  }
  const out = { primary, accent, glow };
  if (_colours.size >= 64) _colours.clear();   // a locker cycling looks must not grow a map for ever
  _colours.set(key, out);
  return out;
}

// ---- specs/0047 §A (0047a) — THE WHOLE PALETTE, not three picks off it.
// Greg, 2026-09-05: "use all of the outfit palette for the speed lines ... rn we
// use one, but let's only use outfit palette and the whole outfit palette." §2's
// three named colours answer "which one colour is the suit"; the speed-line field
// asks the other question — "what IS this suit" — and the answer is every ink the
// look actually paints itself with. Returns an ARRAY of `0xRRGGBB`, cached and
// handed back BY REFERENCE like `lookColours` so fx.js's per-frame test is an
// object-identity compare, and read PER PART SOURCE so a mixed look (0039) is a
// mixed field.
//
// Three rules, and each one is a thing the field would otherwise get wrong:
//   ORDER   — a fixed key order, jacket first, so the field is stable across a
//             re-dress and the suit's own colour is the one a short palette keeps.
//   NO FACE — `face` is skin, not a garment: 27 of 32 palettes carry the same
//             near-white there and it would put one identical ink in every look.
//   SPACING — a colour joins only if it is ≥ PAL_MIN apart in RGB from every ink
//             already in. Half the rack declares four near-blacks (g29 Hawk has
//             five between 0x0f0f0f and 0x1c2622); drawn as four inks they are
//             one ink and three wasted fill() calls. Merged, the count lands at
//             2–6 across the 32 looks (g02/g19/g25/g30 are the twos: a jacket and
//             a lens is genuinely all they declare).
const PAL_ORDER = ['jacket', 'accent', 'accent2', 'helmet', 'lens', 'pants', 'strap', 'glove',
  'boot', 'sleeve', 'belt', 'pole', 'poleBand', 'beltEdge', 'beltBuckle', 'anorak', 'tape',
  'strapTick', 'poleGuards'];
export const PAL_MAX = 8;              // fx.js sizes its fill table off this
const PAL_MIN2 = 40 * 40;              // squared RGB spacing — see SPACING above
const _pals = new Map();
export function lookPalette(look) {
  const key = look == null ? _worn : serialise(parseLook(look));
  const hit = _pals.get(key);
  if (hit) return hit;
  const src = srcOf(parseLook(key));
  const out = [];
  for (const k of PAL_ORDER) {
    const v = src[ownerOf(k)].palette[k];      // raw: only what the look DECLARES
    if (v == null) continue;
    let near = false;
    for (let i = 0; i < out.length && !near; i++) {
      const c = out[i];
      const dr = ((c >> 16) & 255) - ((v >> 16) & 255);
      const dg = ((c >> 8) & 255) - ((v >> 8) & 255);
      const db = (c & 255) - (v & 255);
      near = dr * dr + dg * dg + db * db < PAL_MIN2;
    }
    if (near) continue;
    out.push(v);
    if (out.length >= PAL_MAX) break;
  }
  if (!out.length) out.push(swatch(src.jacket.palette, 'jacket'));
  if (_pals.size >= 64) _pals.clear();
  _pals.set(key, out);
  return out;
}

// ---- specs/0039 §1: a look is seven codes
// Head to poles — the order the sub-tabs read in and the dotted form is written in.
export const PARTS = ['helmet', 'goggles', 'jacket', 'pants', 'gloves', 'boots', 'poles'];
// §1's ownership table: every ATLAS REGION and every SWATCH CELL names exactly
// one part, so no two houses can paint the same pixel. A name that is neither —
// and the generic base fill — belongs to the jacket.
const OWN = {
  helmet: 'helmet', face: 'helmet',
  lens: 'goggles', strap: 'goggles', strapTick: 'goggles',
  chestFront: 'jacket', back: 'jacket', sleeveL: 'jacket', sleeveR: 'jacket',
  jacket: 'jacket', sleeve: 'jacket', anorak: 'jacket',
  legL: 'pants', legR: 'pants', belt: 'pants', pants: 'pants', beltEdge: 'pants', beltBuckle: 'pants',
  glove: 'gloves', poleGuards: 'gloves',
  boot: 'boots',
  pole: 'poles', poleBand: 'poles',
};
// the flags merge the same way: the helmet's house decides the dome and the chin
// bar, the jacket's the torso, the pants' the belt, the gloves' the pole guards
// specs/0045 §4.4 — twenty-eight flags now, still SEVEN sub-tabs: each new key
// goes to the part that already owns its region, and the four `kit*` go to the
// jacket because a bespoke kit is one character read. This object IS §4.4's
// table; inventory.js's PART_SPEC is the same row as prose.
const FLAG_OWN = { helmet: 'helmet', chinBar: 'helmet', visor: 'helmet', head: 'helmet', mask: 'helmet', collar: 'helmet',
  goggles: 'goggles',
  torso: 'jacket', hood: 'jacket', spine: 'jacket', hem: 'jacket', puffy: 'jacket', anorak: 'jacket',
  chestPlate: 'jacket', pauldrons: 'jacket',
  kitFerrum: 'jacket', kitUmbra: 'jacket', kitPhantom: 'jacket', kitDuke: 'jacket',
  pants: 'pants', belt: 'pants', hipPlate: 'pants', bloused: 'pants', beltBoxes: 'pants',
  guards: 'gloves', poleGuards: 'gloves',
  boot: 'boots', shinGuards: 'boots' };
const ownerOf = (name) => OWN[ALIAS[name] || name] || 'jacket';

// ---- specs/0044 §A.3 — the one code in a look that is not a house.
// `x` in slot 1 (goggles) means NONE: the `rider:goggles` node off, a bare face.
// It is legal in that slot only, a bare `x` is not a look, and it never reaches
// `srcOf` — the goggle regions keep g00's paint under a band nobody can see.
export const NONE = 'x';
const codeOk = (part, c) => !!byCode[c] || (part === 'goggles' && c === NONE);

// A bare `gNN` is "all seven gNN"; a dotted string is read position by position,
// missing trailing parts and unknown codes are g00, and garbage is all g00.
export function parseLook(v) {
  const t = String(v == null ? '' : v).split('.');
  const bare = t.length === 1 && byCode[t[0]] ? t[0] : null;
  return PARTS.map((p, i) => bare || (codeOk(p, t[i]) ? t[i] : 'g00'));
}
// …and back: bare when all seven agree, so every 0037 caller that reads a `gNN`
// off `__player.outfit` still does
export const serialise = (l) => (l.every((c) => c === l[0]) ? l[0] : l.join('.'));
const srcOf = (l) => { const s = {}; PARTS.forEach((p, i) => { s[p] = byCode[l[i]] || byCode.g00; }); return s; };
// `{ helmet: 'g09' }` is a PARTIAL, merged over the look already on the rig
const mergeLook = (cur, v) => (v && typeof v === 'object'
  ? PARTS.map((p, i) => (codeOk(p, v[p]) ? v[p] : cur[i]))
  : parseLook(v));
// specs/0044 §A.2 — `goggles` is the one flag no house declares, so the absent key
// means ON and all 32 `outfits/*.js` stay untouched; what takes the band off is the
// look's own `x` in slot 1. A house that ever writes `goggles: false` still wins.
const GOGGLES = PARTS.indexOf('goggles');
// INTEGRATION: 0044 A.2 gives mergeFlags the LOOK ARRAY (it needs l[GOGGLES]),
// where v3's took srcOf(l); every call site passes `l`. `f.goggles` stays 0044's
// boolean and visibleNodes/applyFlags spell it 'thick'/'none' (0045 4.3(c)).
const mergeFlags = (l) => {
  const src = srcOf(l), f = {};
  for (const k in FLAG_OWN) f[k] = src[FLAG_OWN[k]].flags[k];
  f.goggles = f.goggles !== false && l[GOGGLES] !== NONE;
  return f;
};

// ---- specs/0046 §4.6 — the degrade ladder's one gate
// There is no `lowEnd` flag in this tree and 0046 does not invent a tier: this is
// the coarse-pointer media query `loader.js:71`, `loader.js:122` (D25),
// `hud.js:250` and `intro.js:20` already read, under one name. §4.6 puts the
// canonical export in `rig/bloom.js`; C3 seeded the expression here while that
// file did not exist (§8.3 runs C3 and C4 in parallel), it does now, so the two
// are one definition again and this is the re-export. The WebGL2 clause of §4.6
// needs a renderer and gates the BLOOM alone (`isLowEnd(renderer)`, C4's); what
// THIS gate decides is the material ladder: envmap face size, colour canvas, LRU
// depth and the shadow.
export { COARSE, LOW_END };
// ---- the compositor (specs/0039 §2)
const _atlas = new Map();
const CACHE_MAX = LOW_END ? 4 : 8;              // specs/0046 §2.5 / §4.6 — 0045 OQ4's answer
const COLOR_PX = LOW_END ? 512 : 1024;          // §2.5 — the colour canvas; the two data canvases stay 512²
let _T = null, _worn = 'g00';
// One pass per part over ITS house's op list. Every op is clipped to its own
// region and no two parts own a region, so the parts may run in any order while
// the ops inside a part keep their house's — which is why a uniform look lands
// pixel-identical to 0037's single-house pass (§6.2: 27/27).
// specs/0045 §7.1 — one pass, four canvases. `ch` picks the channel; `nodes` is
// the kit nodes this look shows (layer 2). Every op already takes its colours as
// ARGUMENTS, so re-running the identical op list with the colours replaced draws
// that op's own shape into another channel — "clipped to what that op draws",
// with no per-op knowledge and no second code path. An op carrying no attribute
// record is SKIPPED in the ORM and height passes and inherits what is under it,
// which is what makes all 32 shipped op lists correct with zero edits (§2.1).
const CH_ORM = 1, CH_EMIS = 2;                   // specs/0046 §2.5 — CH_BUMP is gone with the normal canvas
// a colour argument is any string that starts '#'; a region name, a glyph name
// and `text`'s own string never do, so the map is safe on every op in the sheet
const mapArgs = (a, f) => a.map((v) => (typeof v === 'string' && v.charCodeAt(0) === 35 ? f(v) : v));
function paintLook(cv, l, ch = 0, nodes = null) {
  const src = srcOf(l), pal = (part) => src[part].palette;
  const x = cv.getContext('2d');
  // specs/0046 §2.5 — the ONE line that takes the colour canvas to 1024². Every
  // coordinate below stays in 512 atlas space; `k` is 2 on the colour pass and 1
  // on the two 512² data passes, which is why the op lists do not move.
  const k = cv.width / SIZE;
  x.setTransform(k, 0, 0, k, 0, 0);
  // §7.1 step 3 — the look's own `mats`, resolved through the ONE-HOP fallback
  // chain `swatch` already walks, so `mats.jacket` reaches the sleeves as well.
  const mat = (part, k) => { const m = src[part].mats; return (m && (m[k] || m[FALLBACK[k]])) || null; };
  // the one colour mapper: css colour + region + this op's attribute record →
  // the channel's value, layers 1, 3 and 4 in §7.1's order (later wins).
  const F = (css, reg, at) => {
    if (!ch) return css;
    const key = PREFILL[reg] ?? reg, o = mat(ownerOf(reg), key) || {}, d = REGION_MAT[ALIAS[reg] || reg] || M_FAB;
    if (ch === CH_ORM) return orm(at && at.metal !== undefined ? at.metal : o.metal ?? d[0],
      at && at.rough !== undefined ? at.rough : o.rough ?? d[1],
      // §3.2 / §2.5 — the coat, then the `bump` bias on top of it
      (at && at.coat !== undefined ? at.coat : o.coat ?? d[2]) + (at && at.bump !== undefined ? COAT_BUMP * at.bump : 0));
    return glow(css, at && at.glow !== undefined ? at.glow : o.glow ?? GLOW0);
  };
  // layer 1 — the region/cell prefill, the same walk the colour pass makes
  x.fillStyle = F(hex(swatch(pal('jacket'), 'jacket')), 'chestFront');
  x.fillRect(0, 0, SIZE, SIZE);
  // specs/0050-DECISIONS §9.6 (B5) — the `face` prefill is SKIN, not the mannequin
  // white: 27 of 32 palettes carry the converter's 0xf4f1ea / 0xf6f8f8 for `face`,
  // which on a sculpted head reads as a white mannequin between strap and collar.
  // Only that default is replaced; any other `face` colour is the look's own
  // choice (g27's gold, g28's glowing dark, g29's tan) and wins.
  for (const k in PREFILL) { const c = swatch(pal(ownerOf(k)), PREFILL[k]); fillCell(x, k, F(hex(k === 'face' && FACE_WHITE.has(c) ? SKIN : c), k)); }
  for (const k in CELL) { x.fillStyle = F(hex(swatch(pal(ownerOf(k)), k)), k); x.fillRect(CELL[k][0], CELL[k][1], CELL_PX, CELL_PX); }
  // layer 1b — specs/0050-DECISIONS §4, THE EYES. Still layer 1: it runs before the
  // ops, and it is here rather than in an `outfits/*.js` op list because it is not a
  // look's decision. The sculpt (0050 §5) brings two real eyeball meshes inside
  // `rider:body`, weighted 1.0 to `rider:head`; B1 gave every one of their 1,000
  // vertices ONE constant UV — the centre of a reserved 8 × 8 px corner of `face`,
  // atlas px 452–460 × 300–308 (`SOURCE.json.fit.eye_rect`), verified unpainted by
  // all 32 looks. A constant UV means the eyeball samples exactly one texel, so this
  // is one flat colour and cannot be an iris ring around a sclera however it is
  // painted; the whole rect takes that colour so the texel is right wherever the
  // 6 dp UV rounds. Without it the eyeball inherits the look's `face` skin tone and
  // reads as a blank socket at every camera.
  //
  // The colour is the IRIS, not the sclera, and that is the choice: what is visible
  // through a lid aperture at 12–30 px of head is the dark centre, a white eyeball
  // at that size reads as two lit pinholes and 0046 §4's bloom picks them up. Dark
  // umber rather than black so 0045 §7.3's baked AO and the 0.052 u socket still
  // shade it. It is painted per channel through `F` like every other mark, so the
  // ORM pass gives it the face's roughness and the emissive pass its glow.
  inRegion(x, 'face', (c) => { c.fillStyle = F(hex(IRIS), 'face'); c.fillRect(32, 32, 8, 8); });
  // layer 2 — the NODE default, ORM only (§1.2's `mat` column is (metal, rough);
  // no kit row lights itself). Painted in gen/kits.py order, so a plate lands on
  // top of the base it covers, and only for the nodes this look shows.
  if (ch === CH_ORM && nodes) for (const [n, m, r, areas] of NODE_MAT) {
    if (!nodes.has(n)) continue;
    // specs/0046 §3.2 — the coat is PER AREA, not per node: a node NODE_COAT does
    // not name keeps the coat of whatever region it is drawing over, so a helmet
    // variant paints its own roughness without flattening the helmet's lacquer.
    const nc = NODE_COAT[n];
    for (const a of areas.split(' ')) {
      const c = orm(m, r, nc ?? coatOfArea(a));
      if (a.charCodeAt(0) === 64) { const q = CELL[a.slice(1)]; if (q) { x.fillStyle = c; x.fillRect(q[0], q[1], CELL_PX, CELL_PX); } continue; }
      const i = a.indexOf(':');
      if (i < 0) { fillCell(x, a, c); continue; }
      const b = a.slice(i + 1).split(',');
      inRegion(x, a.slice(0, i), (q) => { q.fillStyle = c; q.fillRect(+b[0], +b[1], +b[2], +b[3]); });
    }
  }
  inRegion(x, 'pole', (c) => OPS.vstripe(c, 64, 16, 11, 15, F(hex(swatch(pal('poles'), 'poleBand')), 'pole')));
  // layer 4 — the ops, each mapped by its own attribute record
  for (const part of PARTS) {
    for (const [op, reg, ...a] of src[part].ops) {
      if (ownerOf(reg) !== part) continue;               // a mirror stays with its region's owner
      // a mirror runs in EVERY channel: the L half already carries this channel's
      // layers 1-4 and the R half is defined as its copy (RFLIP, atlas.json)
      if (op === 'mirror') { mirror(x, cv, reg, a[0], k); continue; }
      if (!OPS[op]) continue;
      const at = attrsOf(a);
      if (ch === CH_ORM && !at) continue;                // inherit what is underneath
      const args = ch ? mapArgs(a, (c) => F(c, reg, at)) : a;
      inRegion(x, reg, (c, W, H) => OPS[op](c, W, H, ...args));
    }
  }
  const pp = pal('pants'), gp = pal('goggles');
  if (pp.beltEdge != null && ch !== CH_ORM) inRegion(x, 'belt', (c, W, H) => {
    const e = F(hex(pp.beltEdge), 'belt'); OPS.hband(c, W, H, 0, 3, e); OPS.hband(c, W, H, 13, 16, e);
    OPS.rect(c, W, H, 28, 3, 8, 10, F(hex(swatch(pp, 'beltBuckle')), 'beltBuckle'));
  });
  if (gp.strapTick != null && ch !== CH_ORM) inRegion(x, 'strap', (c, W, H) => OPS.rect(c, W, H, 28, 5, 8, 6, F(hex(gp.strapTick), 'strap')));
  // specs/0044 §A.4's painted brow and eye marks are GONE (specs/0050-DECISIONS §9.5,
  // B5): they were calibrated to a face projection 0050 retired and landed 30–50 mm
  // under the sculpt's real eyeballs (y 1.577–1.600), on the cheek. The eyes are
  // geometry now — two eyeball meshes, the iris texel above, a 0.052 u socket.
  pad(x, cv, k);
}
// ---- specs/0046 §3.3 — the whole-material scalars, and §4.4's glow read
// `sheen`, `sheenRoughness`, `anisotropy`, `anisotropyRotation` and the bloom
// multiplier are material SCALARS, not maps: five numbers written where the four
// canvases are already written, and zero bytes of texture. They ride in 0045
// §7.1's `mats` object under a reserved `""` key, so no palette key is shadowed.
//
// A look is seven houses and each may author a `""` block, so the resolution rule
// has to be stated: the FIRST house in `PARTS` order that names a key wins, which
// is the same first-wins walk `swatch` makes over its fallback chain. For all 32
// shipped looks every house of a look is that look's own, so the rule only bites
// on a dotted mix — and there the helmet's house speaking first is the same
// convention the flag merge already uses (§4.3).
const SCALAR0 = { sheen: 0.0, sheenRough: 0.5, aniso: 0.0, anisoRot: 0.0, bloom: 1.0 };
function scalarsOf(l) {
  const src = srcOf(l), out = { ...SCALAR0 };
  const seen = new Set();
  for (const p of PARTS) {
    const w = src[p].mats && src[p].mats[''];
    if (!w) continue;
    for (const k in SCALAR0) if (!seen.has(k) && w[k] !== undefined) { out[k] = w[k]; seen.add(k); }
  }
  return out;
}
// §4.4 — the bloom reads the channel that already exists. `maxGlow` is the
// brightest `glow` anywhere in the look, over the op attribute records and the
// `mats` blocks alike, floored at 0045's global default. C4's `riderBloom.set`
// takes this and `scalars.bloom` and computes §4.4's strength; C3 measures it.
function maxGlow(l) {
  const src = srcOf(l);
  let g = GLOW0;
  for (const p of PARTS) {
    const m = src[p].mats;
    for (const k in m) if (m[k] && m[k].glow > g) g = m[k].glow;
    for (const [, , ...a] of src[p].ops) { const at = attrsOf(a); if (at && at.glow > g) g = at.glow; }
  }
  return g;
}
// specs/0046 §2.5 — the LRU that answers 0045 OQ4. At 6.0 MB of GPU per cached
// look (one 1024² colour + two 512² data canvases) an unbounded cache is 192 MB
// after a 32-look locker session, so `keep()` drops 12 → 8: one worn look, one
// hovered, and the six most recent, which is the whole interaction 0038/0039
// built. §4.6's ladder halves it again to 4 on a coarse pointer (12 MB). The
// locker's 64×64 cards paint COLOUR ONLY and are not cached as looks at all.
// The WORN look is still never the entry thrown away.
function keep(k, v) {
  _atlas.delete(k); _atlas.set(k, v);
  for (const old of [..._atlas.keys()]) {
    if (_atlas.size <= CACHE_MAX) break;
    if (old === _worn) continue;
    const e = _atlas.get(old);
    _atlas.delete(old);
    evict(e);
  }
}
// MEASURED, and it is the whole point of the LRU. Dropping the map entry frees the
// canvases to the JS heap and frees NOTHING on the GPU: three uploads a
// CanvasTexture on first use and holds it until `dispose()`, so a 32-look locker
// sweep left `renderInfo().memory.textures` at 129 with a cache of 8 — 96 uploads
// alive, 6.0 MB each, exactly the 0045 OQ4 number the LRU was meant to bound. An
// LRU whose eviction does not dispose is an LRU that saves heap and no VRAM.
//
// The one thing eviction must not do is dispose a texture something is still
// WEARING. `_worn` is never evicted, but the locker mannequin can be previewing a
// look that is (0038 §2's try-on writes the mannequin's materials and nothing
// else). So the registry is asked first: a texture that is any registered rider
// material's `map` stays, and its entry is simply forgotten.
function evict(e) {
  if (!e) return;
  const live = new Set();
  for (const m of _riderMats) { if (m.map) live.add(m.map); if (m.emissiveMap) live.add(m.emissiveMap); if (m.metalnessMap) live.add(m.metalnessMap); }
  for (const t of [e.texture, e.orm, e.emissive]) if (t && !live.has(t)) t.dispose();
}
// specs/0045 §4.3(b) — the DECLARED variant defaults; the bake emits them
// (`MESH.VARIANTS`) and this literal is the fallback for a pre-kit blob. `'none'`
// matches no node, so a family whose default is "nothing shown" shows nothing.
const VARIANTS0 = { torso: 'jacket', helmet: 'dome', pants: 'regular', boot: 'race',
  head: 'human', goggles: 'thick', hem: 'none', collar: 'none' };
// which layer-2 nodes does this look show? Through the SAME `toggleOf` the rig
// and the mannequin read (specs/0038 §3), so the compositor cannot disagree with
// `applyFlags` about what is on the body — one table, not two. A row whose toggle
// `toggleOf` does not know yet (§4.3(a)'s widening is K5's hunk) does not paint,
// which is today's behaviour.
function visibleNodes(l, mesh) {
  const f = mergeFlags(l), V = (mesh && mesh.VARIANTS) || VARIANTS0, on = new Set();
  for (const [n] of NODE_MAT) {
    const t = toggleOf('rider:' + n);
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq < 0) { if (f[t]) on.add(n); continue; }
    const kind = t.slice(0, eq);
    let want = f[kind];
    if (typeof want === 'boolean') want = want ? 'thick' : 'none';   // §4.3(c), goggles' two spellings
    if ((want ?? V[kind]) === t.slice(eq + 1)) on.add(n);
  }
  return on;
}
// One CanvasTexture per channel. The ORM canvas is DATA, not colour — its texels
// are clearcoat, roughness and metalness and must NOT be sRGB-decoded — so only
// `map` and `emissiveMap` carry SRGBColorSpace. Mipmaps stay off on all three
// (0037's LinearFilter atlas rule); the 4 px inset keeps the seams clean.
function tex(THREE, cv, srgb) {
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const canvasN = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
export function paint(look, THREE = _T, opt = {}) {
  const cached = opt.cache !== false;
  const l = parseLook(look), key = serialise(l);
  const hit = cached ? _atlas.get(key) : null;
  if (hit && (hit.texture || !THREE)) { keep(key, hit); return hit; }
  // specs/0046 §2.5 — the colour canvas at 1024² (512² on §4.6's low tier), so a
  // painted seam lands on the same texel grid as a baked one. The ORM and
  // emissive canvases stay 512²: both are low-frequency and doubling them would
  // buy 2 MB of GPU per look and no pixel.
  const cv = hit ? hit.canvas : canvasN(COLOR_PX);
  if (!hit) paintLook(cv, l);
  // §4.4 — the locker's 64×64 cards call paint() with THREE null and get the
  // COLOUR canvas alone: a roughness map does nothing at card size, and the
  // two extra canvases would be 27 × 2 atlases for no pixel on screen.
  let texture = null, orm = null, emissive = null;
  if (THREE) {
    texture = tex(THREE, cv, true);
    const ormCv = canvasN(SIZE), emCv = canvasN(SIZE);
    paintLook(ormCv, l, CH_ORM, visibleNodes(l, opt.mesh));
    paintLook(emCv, l, CH_EMIS);
    orm = tex(THREE, ormCv, false);
    emissive = tex(THREE, emCv, true);
  }
  // specs/0046 §3.3 / §4.4 — the five whole-material scalars and the look's
  // brightest glow ride with the canvases, so `setOutfit` and `previewOutfit`
  // write them in the same place and cannot disagree about which look is worn.
  const out = { canvas: cv, texture, orm, emissive, scalars: scalarsOf(l), maxGlow: maxGlow(l) };
  if (cached) keep(key, out);
  return out;
}
// specs/0045 §7.1 — the four maps land together or not at all: a rig that took
// the new `map` and kept the previous look's ORM is a look wearing another look's
// surface. One function for `setOutfit` and `previewOutfit` alike — §4.4's "one
// loop, three more assignments", not a second code path.
// specs/0046 §3.1 / §3.2 — the ORM canvas is THREE maps now: `clearcoatMap` reads
// its R alongside the metalness B and roughness G. `normalMap` is NOT written
// here: it is the baked `rider-nrm.webp` (§2.2), set once per material by
// `applyMaps` and shared by every look, and nulling it on a look change is how a
// rider silently loses its stitching.
// §3.3 — and the five whole-material scalars, five assignments and zero bytes.
export function wearMaps(m, p) {
  m.map = p.texture; m.emissiveMap = p.emissive || p.texture;
  m.metalnessMap = m.roughnessMap = m.clearcoatMap = p.orm;
  if (p.scalars) {
    const s = p.scalars;
    m.sheen = s.sheen; m.sheenRoughness = s.sheenRough;
    m.anisotropy = s.aniso; m.anisotropyRotation = s.anisoRot;
    // §3.1 — `clearcoat` is the material's own switch on the layer the ORM canvas
    // then modulates per texel. A look whose every region defaults to coat 0 pays
    // for the layer and gets nothing from it, so the switch is 1 and the map
    // decides; three multiplies `clearcoat` by `clearcoatMap.x` (three.module.js:1249).
    m.clearcoat = 1.0;
  }
  m.needsUpdate = true;
}

// ---- persistence (spec §3): ?outfit= → localStorage → g00
// specs/0039 — the serialisation IS the identity, so a dotted look is as valid a
// value here as a bare code: it is taken when every code in it is a real one.
// specs/0044 §A.3 — …and `x` is a real code in slot 1, so `?outfit=g09.x.g11.…`
// survives the URL and the localStorage round trip like any other look.
const asLook = (v) => { const t = String(v).split('.'); return v && t.length <= PARTS.length && t.every((c, i) => codeOk(PARTS[i], c)) ? v : null; };
export function resolveOutfit() {
  const get = (f) => { try { return f() || ''; } catch (e) { return ''; } };
  const u = get(() => new URLSearchParams(location.search).get('outfit')), s = get(() => localStorage.getItem(KEY));
  return asLook(u) || asLook(s) || 'g00';
}
export function rememberOutfit(look) { try { localStorage.setItem(KEY, look); } catch (e) { /* private mode */ } }

// ---- the rig
const _rigs = new WeakMap();
export const rigOf = (body) => _rigs.get(body);
// specs/0038 §3 — the name→toggle rule, EXPORTED and made a pure function of the
// name. The locker's preview rig is a `clone(true)` of the live one: it has node
// names and nothing else, no `mesh.PARTS` entry to read a `toggle` off. Rather
// than let inventory.js restate this table (two copies of it is one of them
// going stale on the next bake), the clone reads the same function the live rig
// does. Every explicit `toggle` in today's bake agrees with what the name rule
// derives — belt, chinBar, guards, hood, spine, visor, torso=*, helmet=* — so
// the two paths cannot disagree on the shipped mesh.
// specs/0045 §4.3(a) — the same rule over eight variant families and 39 more
// nodes. The kind alternation is CLOSED: `hip-plate` and `pole-guard-l` are
// booleans, and an open `(\w+)-` rule would have read both as variants. A `-l/-r`
// pair is two nodes on ONE toggle string (§1.2), which applyFlags already drives.
// The kits go by prefix, so K4 can add an Umbra piece without editing a table.
const KIT_OF = { ferrum: 'kitFerrum', umbra: 'kitUmbra', phantom: 'kitPhantom', duke: 'kitDuke' };
export function toggleOf(name) {
  const m = /^rider:(torso|helmet|pants|boot|head|goggles|hem|collar)-([\w-]+)$/.exec(name);
  if (m) return `${m[1]}=${m[2]}`;
  const n = name.replace(/^rider:/, '');
  const k = KIT_OF[(/^(ferrum|umbra|phantom|duke)-/.exec(n) || [])[1]];
  return { belt: 'belt', hood: 'hood', 'chin-bar': 'chinBar', visor: 'visor', 'guard-l': 'guards', 'guard-r': 'guards', spine: 'spine',
    'shin-l': 'shinGuards', 'shin-r': 'shinGuards', 'pole-guard-l': 'poleGuards', 'pole-guard-r': 'poleGuards',
    'pauldron-l': 'pauldrons', 'pauldron-r': 'pauldrons', 'chest-plate': 'chestPlate', 'hip-plate': 'hipPlate',
    'bloused-l': 'bloused', 'bloused-r': 'bloused', 'belt-boxes': 'beltBoxes',
    anorak: 'anorak', puffy: 'puffy', mask: 'mask' }[n] || k || null;
}
// toggle key of a PART: the bake's explicit `toggle` ('belt', 'torso:race' …)
// wins, the name rule above is the fallback — unchanged behaviour, one line
// shorter than it was.
function togglePart(part) {
  const t = part.toggle;
  if (t) return typeof t === 'string' ? t.replace(':', '=') : `${t.key || t.k}=${t.value ?? t.v}`;
  return toggleOf(part.name);
}
// specs/0038 §3 — the visibility half of `setOutfit`, lifted out of the rig so a
// SECOND set of toggles (the locker's cloned mannequin) can be dressed by the
// same code. Byte-for-byte the block that used to live inside `rig.setOutfit`:
// a variant kind (`torso=`, `helmet=`) shows the flagged one, else its declared
// default, so a partial bake still shows a torso; every other toggle is the
// plain boolean flag.
// specs/0045 §4.3(b) — with EIGHT variant families `present(kind)[0]` is a booby
// trap: the first `hem` member in bake order would be worn by every look that
// never mentions a hem. So the default is DECLARED — the bake's `MESH.VARIANTS`,
// `VARIANTS0` for a pre-kit blob — and `present(kind)[0]` is only the last resort
// for a kind the table never heard of. The boolean branch is untouched.
function applyFlags(toggles, f, V = (MESH && MESH.VARIANTS) || VARIANTS0) {
  const present = (kind) => toggles.filter((x) => x.t.startsWith(kind + '=')).map((x) => x.t.slice(kind.length + 1));
  // §4.3(c) — `goggles` is the one key with two spellings, because 0044 shipped it
  // as a boolean. `true` → thick, `false` → none, a string → that member.
  if (typeof f.goggles === 'boolean') f = { ...f, goggles: f.goggles ? 'thick' : 'none' };
  const pick = {};
  for (const { t } of toggles) {
    const eq = t.indexOf('='), kind = t.slice(0, eq);
    if (eq < 0 || kind in pick) continue;
    // `'none'` is a VALUE, not a miss — `goggles`' third member and the declared
    // default of `hem`/`collar` — and it matches no node on purpose. Without this
    // arm g28 and g31 fall to `V.goggles` and wear the pair they go without.
    pick[kind] = f[kind] === 'none' || present(kind).includes(f[kind]) ? f[kind] : (V[kind] ?? present(kind)[0]);
  }
  for (const { node, t } of toggles) {
    const eq = t.indexOf('=');
    node.visible = eq < 0 ? !!f[t] : pick[t.slice(0, eq)] === t.slice(eq + 1);
  }
  fitGoggles(toggles, pick);
}
// GOG, 2026-09-04 — the ONE place a kit node is sized, and the only runtime half of
// "the goggles get eaten by the helmet". `goggles_thick.py` / `goggles_rimless.py` bake
// the band to hug the three slim shells: its strap facet plane sits at 0.1554 u, which is
// 5.7 mm proud of helmet-dome, 5.4 of helmet-facet and 8.9 of the bare skull. `helmet=helm`
// is the outlier — its skirt is 0.172 u over the WHOLE band height (measured: the old band
// was 31.2 mm inside it, i.e. invisible), and no single baked radius can both hug a 0.150
// dome and clear a 0.172 skirt. So that one shell gets the band pushed out radially.
// x/z only, about the head axis the node's own origin already sits on, so the band's
// heights, its nose cut-out and its UVs do not move; 0 bytes of mesh and 0 draw calls,
// against ≈ +1,100 B br and a second node for a `helm` bake of both members.
const GOGGLE_FIT = { helm: 1.14 };          // 0.160 → 0.1824 u: face plane 0.1762, +4.2 mm on the skirt
function fitGoggles(toggles, pick) {
  const s = GOGGLE_FIT[pick.helmet] || 1;
  for (const { node, t } of toggles) {
    if (t !== 'goggles=thick' && t !== 'goggles=rimless') continue;
    if (node.scale.x !== s) node.scale.set(s, 1, s);
  }
}
// specs/0038 §2 — TRY-ON. Dresses the locker's preview rig in `code` and touches
// nothing else: not `rememberOutfit`, not `rig.outfit`, not the live rig's
// materials. A pure function of `pv` — the locker built `pv.riderMats` (§2.7
// step 5's `Map(source → clone)`, `cloneRig`'s, not a second clone of its own)
// and `pv.riderToggles` (the cloned `rider:*` nodes keyed through `toggleOf`),
// and this is the only thing that writes to either. The atlas itself is
// `paint()`'s cache, shared with the live rig, so hovering 27 cards paints at
// most 27 canvases once.
// specs/0041 §4.8 — v3 has TWO materials on the body side (§4.1: `matSkin` for
// the two skinned meshes, `matRigid` for the bone-parented toggles), so this
// writes EVERY VALUE of the map, not the single `pv.riderMat` v2 wrote: one
// `paint()` lookup, N assignments (critic #21). A one-material write would have
// left the toggles on the worn atlas and try-on would show half a look.
// specs/0039 — it takes a LOOK (a bare code still works), so hovering a part
// card previews the worn look with that one part swapped.
export function previewOutfit(THREE, pv, look) {
  const l = parseLook(look), str = serialise(l);
  // specs/0045 §4.4 — §7's FOUR maps now, not one: one `paint()` lookup and a
  // `wearMaps` per material. The mannequin shares the canvases and the envmap
  // with the live rig (C10 unchanged), so a hover is still at most one paint.
  if (pv.riderMats && pv.riderMats.size) {
    const p = paint(str, THREE);
    for (const m of pv.riderMats.values()) wearMaps(m, p);
  }
  applyFlags(pv.riderToggles || [], mergeFlags(l));
  return str;
}
// ---- specs/0041 §3.3 — the decoder, once at load
// The blob's own layout note lives in tools/rider/bake.mjs beside the encoder;
// this is its mirror. Every plane is delta+zigzag with a leading width byte, so
// there is ONE loop here for positions, uv, skin and indices alike, and a width
// change is a data change rather than a format one.
function reader(b64) {
  const bin = atob(b64), n = bin.length, d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = bin.charCodeAt(i);
  let o = 0;
  const u8 = () => d[o++];
  const u16 = () => { const v = d[o] | (d[o + 1] << 8); o += 2; return v; };
  const unzig = (z) => ((z & 1) ? -((z + 1) / 2) : z / 2);
  return {
    u8, u16,
    str: () => { const k = u8(); let s = ''; for (let i = 0; i < k; i++) s += String.fromCharCode(u8()); return s; },
    bytes: (n) => { const a = d.subarray(o, o + n); o += n; return a; },   // 0045 §7.3's AO run
    zz16: () => unzig(u16()),
    plane: (count, Type) => {
      const w = u8(), out = new Type(count);
      let prev = 0;
      for (let i = 0; i < count; i++) {
        const z = w === 1 ? u8() : w === 2 ? u16() : (u16() | (u16() << 16)) >>> 0;
        prev += unzig(z);
        out[i] = prev;
      }
      return out;
    },
  };
}
const Q = 10000;                                    // §3.3 — LSB 1e-4, range ±3.2767
function decodeMesh(b64) {
  const r = reader(b64);
  const version = r.u8();
  if (version !== 1) throw new Error(`rider-mesh: blob version ${version}`);
  const flags = r.u8(), boneCount = r.u8(), verts = r.u16(), tris = r.u16();
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const name = r.str(), parent = r.u8();
    bones.push({ name, parent: parent === 255 ? -1 : parent, rest: [r.zz16() / Q, r.zz16() / Q, r.zz16() / Q] });
  }
  const plane = (c, T, s) => { const a = r.plane(c, T); if (s) for (let i = 0; i < c; i++) a[i] /= s; return a; };
  const px = plane(verts, Float32Array, Q), py = plane(verts, Float32Array, Q), pz = plane(verts, Float32Array, Q);
  const uu = plane(verts, Float32Array, Q), vv = plane(verts, Float32Array, Q);
  const j0 = r.plane(verts, Uint8Array), j1 = r.plane(verts, Uint8Array), w0 = r.plane(verts, Uint8Array);
  // §2.4 — both blocks expand to itemSize 4: GL fills a missing w with 1 otherwise.
  const si = new Uint8Array(verts * 4), sw = new Float32Array(verts * 4);
  for (let i = 0; i < verts; i++) {
    const a = w0[i] / 255;
    si[i * 4] = j0[i]; si[i * 4 + 1] = j1[i];
    sw[i * 4] = a; sw[i * 4 + 1] = 1 - a;
  }
  const n4 = r.u16();
  if (n4) {
    const vi = r.plane(n4, Uint32Array);
    const jj = [0, 1, 2, 3].map(() => r.plane(n4, Uint8Array));
    const ww = [0, 1, 2, 3].map(() => r.plane(n4, Uint8Array));
    for (let k = 0; k < n4; k++) for (let c = 0; c < 4; c++) { si[vi[k] * 4 + c] = jj[c][k]; sw[vi[k] * 4 + c] = ww[c][k] / 255; }
  }
  const idx = r.plane(tris * 3, Uint32Array);
  const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  for (let i = 0; i < verts; i++) { pos[i * 3] = px[i]; pos[i * 3 + 1] = py[i]; pos[i * 3 + 2] = pz[i]; uv[i * 2] = uu[i]; uv[i * 2 + 1] = vv[i]; }
  // specs/0045 §7.3 — the uint8 AO block, `flags` bit 1: one byte per vertex,
  // 0 fully occluded → 255 open, baked in Blender over the assembled rest-pose
  // mesh (gen/parts/kits/ao.py). It becomes a grey `color` attribute and three
  // multiplies it into `diffuseColor` — AO darkens base colour, nothing else.
  // NOT `r.plane` — the AO block is a plain uint8 run (bake.mjs's layout note): a
  // delta+zigzag plane doubled it, because AO is a ramp in SPACE and the vertex
  // stream is ordered by part and region seam.
  const ao = (flags & 2) ? r.bytes(verts) : null;
  let nor = null;
  if (flags & 1) {
    // specs/0050 §6 — the octahedral planes ship at uint8 grade, round(oct × 127), so the
    // two planes divide by 127 and not by Q. That is C1's OQ1, resolved: it is what puts
    // the mesh block under its ceiling without dropping the normal block at all.
    const ox = plane(verts, Float32Array, 127), oy = plane(verts, Float32Array, 127);
    nor = new Float32Array(verts * 3);
    for (let i = 0; i < verts; i++) {
      let x = ox[i], z = oy[i], y = 1 - Math.abs(x) - Math.abs(z);
      if (y < 0) { const ax = x, az = z; x = (1 - Math.abs(az)) * (ax >= 0 ? 1 : -1); z = (1 - Math.abs(ax)) * (az >= 0 ? 1 : -1); }
      const l = Math.hypot(x, y, z) || 1;
      nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
    }
  }
  return { bones, pos, uv, si, sw, idx, nor, ao, verts, tris };
}
// One decode per mesh module, shared by every rig built from it (§2.7 shares
// geometry too — the locker mannequin is the same mesh, never a copy).
const _decoded = new WeakMap();
const meshOf = (mesh) => {
  if (!_decoded.has(mesh)) _decoded.set(mesh, decodeMesh(mesh.B));
  return _decoded.get(mesh);
};

// Compact one index slice into its own BufferGeometry: the part's own vertices,
// its own bounding box, and — for a skinned group — its own skin attributes.
function sliceGeometry(THREE, D, slices, u, skinned) {
  const map = new Map(), P = [], U = [], N = [], SI = [], SW = [], I = [], A = [];
  for (const [start, count] of slices) {
    for (let k = start; k < start + count; k++) {
      const v = D.idx[k];
      let j = map.get(v);
      if (j === undefined) {
        j = map.size; map.set(v, j);
        P.push(D.pos[v * 3] * u, D.pos[v * 3 + 1] * u, D.pos[v * 3 + 2] * u);
        U.push(D.uv[v * 2], D.uv[v * 2 + 1]);
        if (D.nor) N.push(D.nor[v * 3], D.nor[v * 3 + 1], D.nor[v * 3 + 2]);
        // §7.3 — AO rides as a grey vertex colour (r = g = b = ao/255): three
        // multiplies vertex colour into `diffuseColor` and nothing else, which
        // is exactly "AO darkens base colour".
        if (D.ao) { const a = D.ao[v] / 255; A.push(a, a, a); }
        if (skinned) { for (let c = 0; c < 4; c++) SI.push(D.si[v * 4 + c]); for (let c = 0; c < 4; c++) SW.push(D.sw[v * 4 + c]); }
      }
      I.push(j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  if (D.nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (D.ao) g.setAttribute('color', new THREE.Float32BufferAttribute(A, 3));
  if (skinned) {
    g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  }
  g.setIndex(I);
  // flatShading takes its normal from the derivative (§1.3), so an unshipped
  // normal stream is not a missing one; computeVertexNormals only runs when the
  // blob carries the octahedral block and the material is smooth.
  if (!D.nor) g.computeVertexNormals();
  return g;
}

// ---- specs/0041 §2 — the armature
// A rest transform is a pure translation with an identity rotation (§2.2), which
// is what makes a stored Euler a bone's ABSOLUTE local rotation rather than a
// delta from a rest orientation. The Skeleton is built while `play:body` is still
// at the origin and before the A-pose is written, so `boneInverses` is the bind
// pose and nothing else.
function buildBones(THREE, D, u, root) {
  const bones = D.bones.map((b) => {
    const o = new THREE.Bone();
    o.name = b.name;
    o.position.set(b.rest[0] * u, b.rest[1] * u, b.rest[2] * u);
    return o;
  });
  D.bones.forEach((b, i) => (b.parent < 0 ? root : bones[b.parent]).add(bones[i]));
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const byName = {};
  bones.forEach((o) => (byName[o.name] = o));
  return { bones, skeleton, byName };
}

// specs/0041 §3.3 — the clip stream, decoded once at load out of rig/clips.js.
// Bone IDS, never track-name strings: the names cost bytes, and the `rider:`
// colon is reserved in PropertyBinding, so the binding form is this file's
// problem and not the format's. Track names are therefore the ACCESSOR form,
// `.bones[rider:hips].quaternion` — `sanitizeNodeName` would strip the colon and
// a track bound to `riderhips` binds to nothing at all (§4.2).
function decodeClips(THREE, b64, boneNames, rest) {
  const r = reader(b64);
  const version = r.u8();
  if (version !== 1) throw new Error(`rig/clips: blob version ${version}`);
  const boneCount = r.u8(), clipCount = r.u8();
  const out = [];
  // §3.5 — mirror, the runtime half: the blob NEVER carries a `-r` clip or bone
  // (it would blow the clips ceiling), so the decoder rebuilds both sides. Exact
  // and axis-wise because every rest orientation is identity (§2.2): swap the
  // `-l`/`-r` SUFFIX, keep Euler x, negate y and z, negate the hips POSITION x
  // only. The twin is `gen/api.py`'s; N9 holds them to 1e-4 rad.
  const mirrorBone = (n) => (n.endsWith('-l') ? `${n.slice(0, -2)}-r` : n.endsWith('-r') ? `${n.slice(0, -2)}-l` : n);
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const quatTrack = (bone, times, ex, ey, ez, sx) => {
    // Slot order is x, y, z; the COMPOSITION order is XZY. They are not the
    // same thing and this is the single most likely bug in the pair (§3.3).
    const keys = times.length, values = new Float32Array(keys * 4);
    let prev = null;
    for (let k = 0; k < keys; k++) {
      e.set(ex[k] / Q, (sx * ey[k]) / Q, (sx * ez[k]) / Q, 'XZY');
      q.setFromEuler(e);
      // w ≥ 0 canonicalised against the previous key, so the mixer never takes
      // the long way round between two keys that are 1e-3 apart (§3.10)
      if (prev && (q.x * prev[0] + q.y * prev[1] + q.z * prev[2] + q.w * prev[3]) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
      values[k * 4] = q.x; values[k * 4 + 1] = q.y; values[k * 4 + 2] = q.z; values[k * 4 + 3] = q.w;
      prev = [q.x, q.y, q.z, q.w];
    }
    return new THREE.QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, times, values);
  };
  const posTrack = (times, px, py, pz, sx) => {
    const keys = times.length, values = new Float32Array(keys * 3);
    for (let k = 0; k < keys; k++) {                 // stored as an OFFSET from the hips rest
      values[k * 3] = (sx * px[k]) / Q + rest[0]; values[k * 3 + 1] = py[k] / Q + rest[1]; values[k * 3 + 2] = pz[k] / Q + rest[2];
    }
    return new THREE.VectorKeyframeTrack(`.bones[${boneNames[0]}].position`, times, values);
  };
  for (let c = 0; c < clipCount; c++) {
    const name = r.str(), flags = r.u8(), fps = r.u8(), dur = r.u8(), nb = r.u8();
    const sym = !!(flags & 2);
    const keyed = [];
    for (let b = 0; b < nb; b++) {
      const id = r.u8(), keys = r.u8();
      const times = new Float32Array(keys);
      for (let k = 0; k < keys; k++) times[k] = r.u8() / fps;
      keyed.push({ bone: boneNames[id], times, ex: r.plane(keys, Float32Array), ey: r.plane(keys, Float32Array), ez: r.plane(keys, Float32Array) });
    }
    let hips = null;
    if (flags & 4) {                                  // bit2 — rider:hips position
      const keys = r.u8();
      const times = new Float32Array(keys);
      for (let k = 0; k < keys; k++) times[k] = r.u8() / fps;
      hips = { times, px: r.plane(keys, Float32Array), py: r.plane(keys, Float32Array), pz: r.plane(keys, Float32Array) };
    }
    // §3.5b — a `sym` clip stores `-l` only; its right side is the mirror, and a
    // centre-line bone has no partner. §3.5a — a clip whose own NAME ends in `-l`
    // (`carve-l`, `pole-plant-l`, `skate-push-l`) gets its `-r` partner as a whole
    // second clip: the runtime alternates strides half a period apart (§4).
    const build = (clipName, sx) => {
      const tracks = [];
      for (const t of keyed) {
        const partner = mirrorBone(t.bone);
        tracks.push(quatTrack(sx < 0 ? partner : t.bone, t.times, t.ex, t.ey, t.ez, sx));
        if (sym && partner !== t.bone) tracks.push(quatTrack(sx < 0 ? t.bone : partner, t.times, t.ex, t.ey, t.ez, -sx));
      }
      if (hips) tracks.push(posTrack(hips.times, hips.px, hips.py, hips.pz, sx));
      const clip = new THREE.AnimationClip(clipName, dur / fps, tracks);
      // §3.3 bit 5 — ADDITIVE: a delta LAYER, accumulated in PropertyMixer's own
      // slot (three.core.js:50974) over the normal blend, so it takes no weight from
      // the base slot. No makeClipAdditive pass: the bake refuses an additive clip
      // whose key 0 is not the identity, and against that reference it is a no-op.
      const additive = !!(flags & 32);
      if (additive) clip.blendMode = THREE.AdditiveAnimationBlendMode;
      clip.userData = { loop: !!(flags & 1), sym, scrub: !!(flags & 8), rig: (flags & 16) ? 'fp' : 'body', additive, mirrored: sx < 0 };
      return clip;
    };
    out.push(build(name, 1));
    if (name.endsWith('-l')) out.push(build(`${name.slice(0, -2)}-r`, -1));
  }
  return { clips: out, boneCount };
}

// specs/0041 §2.7 — `cloneRig`. The addons clone helper is not vendored (§6.3
// bans it outright for that reason) and `SkinnedMesh.copy` shares the skeleton BY
// REFERENCE, so `model.clone(true)` would bind the locker mannequin to the LIVE
// bones and the mannequin would ski along with the player. This is the
// hand-written clone that does not.
export function cloneRig(rig) {
  const THREE = _T;
  const src = rig.model;
  // the prototype clone, not `src.clone` — buildRider answers that name with this
  // very function so the locker's `model.clone(true)` lands here (see below)
  const model = THREE.Object3D.prototype.clone.call(src, true);   // 1. fresh Bone objects
  const order = rig.skeleton.bones.map((b) => b.name); // 2. in the SOURCE skeleton's order
  const map = new Map();
  model.traverse((o) => { if (o.isBone) map.set(o.name, o); });
  const bones = order.map((n) => map.get(n));
  const skeleton = new THREE.Skeleton(bones, rig.skeleton.boneInverses); // 3. same bind pose
  const mats = new Map();
  const skins = [];
  model.traverse((o) => {
    if (o.isSkinnedMesh) skins.push(o);
    // specs/0046 §2 — the mannequin's clones join the map registry too: a clone
    // made BEFORE the WebPs decode would otherwise wear the rider's surface and
    // none of its detail, which is the one place a locker card would disagree with
    // the body it is previewing.
    if (o.isMesh && o.material && !mats.has(o.material)) { const c = o.material.clone(); snowy(c); mats.set(o.material, c); }
  });
  // 4. BOTH cloned SkinnedMeshes rebind to the ONE cloned skeleton with the
  // source's bindMatrix — rebinding only the body leaves the mannequin's poles on
  // the live bones (N18, C09).
  for (const s of skins) { s.bind(skeleton, s.bindMatrix.clone()); s.frustumCulled = false; }
  // 5. geometry is shared, never cloned; every DISTINCT material gets its own
  // copy, and the lookup falls back to the source so a mesh whose material is not
  // a key — play:rocket-pack's own three Lamberts, a toggle added later — keeps
  // the one it has instead of picking up `undefined`.
  model.traverse((o) => { if (o.isMesh) o.material = mats.get(o.material) ?? o.material; });
  const toggles = [];
  model.traverse((o) => { const t = toggleOf(o.name || ''); if (t && o.isMesh) toggles.push({ node: o, t }); });
  return { model, skeleton, bones, mats, riderMats: mats, riderToggles: toggles,
           bone: (n) => map.get(n) || null };
}

// specs/0041 §2.5 — `retarget(clip, 'rider:', 'rider:fp-', fpNames)`: each track's
// bone renamed `from` → `to`; a track whose bone the fp rig lacks (hips + its
// POSITION track, spine-1, neck, head, ankle-l/r, pole-l/r) is dropped.
export function retarget(clip, from, to, names) {
  const tracks = [];
  for (const t of clip.tracks) {
    const n = t.name.replace('[' + from, '[' + to);
    if (!names.includes(n.slice(7, n.indexOf(']')))) continue;
    const c = t.clone(); c.name = n; tracks.push(c);
  }
  return new _T.AnimationClip(clip.name, clip.duration, tracks);
}

// specs/0041 §4.1 — the harness surface. It lives on a NEW global, never on
// `window.__player`: C13 asserts `__player`'s addition set is exactly
// `outfit, setOutfit, outfits`, and the house already carries `__locker`,
// `__tumble`, `__playFX` and thirty others of exactly this shape.
function installRigProbe(rig) {
  if (typeof window === 'undefined') return;
  const q4 = (v) => Math.round(v * 10000) / 10000 + 0;
  window.__rig = {
    bones: () => { const o = {}; for (const b of rig.skeleton.bones) o[b.name] = [q4(b.quaternion.x), q4(b.quaternion.y), q4(b.quaternion.z), q4(b.quaternion.w)]; return o; },
    weights: () => rig.weights(),
    clips: () => rig.clipNames(),
    cost: (n) => rig.cost(n),
    pose: () => rig.pose(),
    settled: () => rig.settled(),
    setScrub: (name, c) => rig.setScrub(name, c),
    cloneRig,
    rigOf,
    // specs/0046 §4.6 — N30's gate. 'low' is the coarse-pointer tier; everything
    // else is 'high'. One string, so the check reads as the ladder does.
    tier: () => (LOW_END ? 'low' : 'high'),
    // §2.5 / §3.4 / §3.6 / §4.6 — every number the ladder moves, in one record, so
    // N27 and N30 read the shipped values rather than re-deriving them. `maps`
    // reports what actually decoded: N27's 1024/1024 and 512/512, the colour space
    // and the aoMap channel.
    gfx: () => {
      const m = rig.mats ? [...rig.mats][0] : null;
      const dim = (t) => (t && t.image ? [t.image.width | 0, t.image.height | 0] : null);
      // C11 clause 6 (§6.2 / §1.7) — the frame's tone map, reported so the check
      // can say "0046 changed none of them" with three numbers. A "make the rider
      // pop" exposure bump is exactly the edit this catches.
      const R = _renderer;
      return { tier: LOW_END ? 'low' : 'high', envFace: FACE, colorPx: COLOR_PX, lru: CACHE_MAX,
        shadow: !!rig.shadow(), shadowMap: !!(R && R.shadowMap && R.shadowMap.enabled), mapState: _mapState,
        tone: R ? { mapping: R.toneMapping, exposure: R.toneMappingExposure, out: R.outputColorSpace } : null,
        maps: _maps ? { nrm: dim(_maps.nrm), ach: dim(_maps.ach), nrmSpace: _maps.nrm.colorSpace, achSpace: _maps.ach.colorSpace, aoChannel: _maps.ach.channel } : null,
        normalScale: m && m.normalScale ? [m.normalScale.x, m.normalScale.y] : null,
        aoMapIntensity: m ? m.aoMapIntensity ?? null : null };
    },
    // §2.5's paint budget — the median ms to paint ONE look from cold, cache
    // bypassed, over `n` runs. `g27` (Ferrum, 23 nodes) is the worst look and the
    // number §2.5 caps at 22 ms.
    paintCost: (look = 'g27', n = 9) => {
      const t = [];
      for (let i = 0; i < n; i++) { const a = performance.now(); paint(look, _T, { cache: false }); t.push(performance.now() - a); }
      return t.sort((a, b) => a - b)[t.length >> 1];
    },
    // §3.6 / N29 — the median frame-time delta between `shadowMap.enabled` true and
    // false over `n` frames. C4 owns N29's assertion; this is the probe it reads.
    shadowCost: (n = 600) => rig.shadowCost(n),
  };
}

// specs/0046 §1.1 — the reversal, and it is a change of INPUT, not of taste.
// W0-DECISIONS #2 chose `flatShading: true` because §1.2's part table was about to
// replace v2's cylinders with flat-authored faces. It did, and the consequence is
// the rider reading as shapes. C1's Catmull-Clark pass makes the cage a limit
// surface and ships the octahedral normal block, so the flat rule now throws away
// the very thing that was bought.
const FLAT = false;                                    // §1.1 — was true, see W0-DECISIONS #2
const ENV_I = 0.85;                                    // specs/0046 §3.4 — was 0045's 0.6

// ---- specs/0046 §2 — the two baked detail maps
// One tangent-space normal map (1024²) and one packed AO / cavity / height map
// (512²), baked in Cycles by C2 from a procedural detail pass, shared by all 32
// looks, shipped as WebP under §2.4's named two-file D7 exemption. They carry the
// stitching, quilting, panel breaks and plate seams the cage cannot afford, in the
// SAME atlas UV layout the op lists paint into — a texel in a map is the same
// surface point as that texel in the colour canvas.
//
// Both are LINEAR. A normal map read as sRGB is a bent normal map and an AO ramp
// read as sRGB is a wrong AO ramp; N27 asserts both colour spaces.
//
// `aoMap.channel = 0` is §2.3's gotcha and the reason this is written out rather
// than left to a reader: three's `aomap_fragment` samples `vAoMapUv`, which
// `WebGLPrograms` maps to `uv1` unless the texture says otherwise, and the rider
// has exactly ONE uv set. Omitting the line produces a black or garbage AO term
// with no error.
//
// Height (B) is a PAINT-TIME input, not a shader input (§2.3): the normal map
// already carries every height feature, a `bumpMap` beside a `normalMap` fights it
// in `normal_fragment_maps`, and the channel `clearcoatRoughnessMap` reads is `.y`
// — which is the packed map's G, the cavity. So `ach` lands on `aoMap` and
// `clearcoatRoughnessMap` and nowhere else.
const NRM_SCALE = 0.85, AO_I = 0.9;                    // §2.3
// every rider material instance ever built, so a map that resolves on frame 40
// reaches the rig, the fp pair and the locker mannequin's clones alike. Nothing
// disposes a rider material and the instances live as long as the page, so a Set
// of them is a registry, not a leak.
const _riderMats = new Set();
// ---- specs/0056 §2 — SNOW ON THE BODY. One uniform, no canvas, no per-look
// anything: a wipeout packs snow onto you and the coverage is a property of the
// SURFACE, not of the outfit, so a per-look atlas layer would be 27 canvases
// answering one number. `_snowU` is ONE object shared by every rider material —
// including `matFpRigid` and the locker mannequin's clones, which is why the
// three registration sites all go through `snowy()` (Material.copy carries a
// fixed property list and would drop an own `onBeforeCompile`).
//
// Coverage: up-facing (world normal y), plus the LEADING face (`uLead`, the body's
// own travel direction, written by fx.js), plus the creases — and the creases come
// free, because the baked vertex AO (`D.ao`, specs/0041) is dark exactly at the
// cuffs, the collar and the helmet rim, which is where snow crusts. The grain is
// hashed off the shaded normal, so it is locked to the surface rather than
// swimming with the camera, and it makes low S read as flecks instead of a wash.
//
// The whole block is inside `if (uSnow > 0.0)`, on a uniform, so at S = 0 the
// fragment is the byte-identical fragment it was — which is what C15's no-wipe
// lanes assert and what makes this safe to compile into every rider material.
// QUANT is why the flecks are flecks and not television static: the hash is taken
// on the normal QUANTISED to a 9-step lattice, so texels facing nearly the same
// way share a bucket and the grain comes out in clumps that follow the surface.
// On the raw normal it was salt and pepper — measured, first strip.
const SNOWV = { UP0: 0.10, UP1: 0.72, LEAD: 0.45, CRUST: 0.85, GRAIN: 0.45, SOFT: 0.50, QUANT: 9.0, ROUGH: 0.94 };
const _snowU = { value: 0 }, _leadU = { value: null };
let _snowAo = false;                                   // does this bake carry vertex AO?
// The one writer. `s` is 0056's S; `lx/ly/lz` is the unit travel direction.
export function riderSnow(s, lx, ly, lz) {
  _snowU.value = s > 0 ? (s < 1 ? s : 1) : 0;
  if (_leadU.value && lx !== undefined) _leadU.value.set(lx, ly, lz);
  return _snowU.value;
}
// GLSL has no implicit int→float: `sN * 9` is a type error, the program never
// links, and three drops the draw WITHOUT throwing — the rider simply stops being
// rendered and every other material carries on. `SNOWV.QUANT = 9.0` stringifies
// as "9", which is exactly that. Every number injected below goes through here.
const g1 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
function snowPatch(sh) {
  sh.uniforms.uSnow = _snowU;
  if (!_leadU.value) _leadU.value = new _T.Vector3(0, 0, -1);
  sh.uniforms.uLead = _leadU;
  const crust = _snowAo ? `+ (1.0 - vColor.r) * ${g1(SNOWV.CRUST)}` : '';
  sh.fragmentShader = `uniform float uSnow;\nuniform vec3 uLead;\n${sh.fragmentShader}`.replace(
    '#include <clearcoat_normal_fragment_begin>',
    `#include <clearcoat_normal_fragment_begin>
if ( uSnow > 0.0 ) {
  vec3 sN = inverseTransformDirection( normal, viewMatrix );
  float sCov = clamp( smoothstep( ${g1(SNOWV.UP0)}, ${g1(SNOWV.UP1)}, sN.y )
    + max( 0.0, dot( sN, uLead ) ) * ${g1(SNOWV.LEAD)} ${crust}, 0.0, 1.0 ) * uSnow;
  float sG = fract( sin( dot( floor( sN * ${g1(SNOWV.QUANT)} ), vec3( 12.9898, 78.233, 45.164 ) ) ) * 43758.5453 );
  float sK = smoothstep( 0.0, ${g1(SNOWV.SOFT)}, sCov - sG * ${g1(SNOWV.GRAIN)} );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.96, 0.975, 1.0 ), sK );
  roughnessFactor = mix( roughnessFactor, ${g1(SNOWV.ROUGH)}, sK );
  metalnessFactor = mix( metalnessFactor, 0.0, sK );
}`);
}
// register + patch, in one call, at every site that mints a rider material
function snowy(m) { m.onBeforeCompile = snowPatch; _riderMats.add(m); return m; }
let _maps = null;                                      // {nrm, ach} once BOTH have decoded
let _mapState = 'idle';                                // idle | loading | ready | <the url that 404'd>
function applyMaps(m) {
  if (!_maps) return;
  m.normalMap = _maps.nrm;
  if (m.normalScale) m.normalScale.set(NRM_SCALE, NRM_SCALE);
  m.aoMap = _maps.ach; m.aoMapIntensity = AO_I;
  m.clearcoatRoughnessMap = _maps.ach;                 // §2.3 — reads .y = G = cavity
  m.needsUpdate = true;
}
// specs/0046 §6.3 — `TextureLoader` is allowed in rider.js and ONLY on a line that
// also names '/r/6a4fa64cb6805a5a/rider/rider-'. The two `load` lines below are the whole exemption.
// N27 — the maps arrive LATE by construction and the rider renders correctly for
// ≥ 30 frames before either resolves. A 404 leaves it on its painted canvases plus
// 0045 §7.3's vertex AO, which is §2.1's "the vertex AO is not redundant" doing
// exactly the job it was kept for, and is not an error.
function loadRiderMaps(THREE) {
  if (_mapState !== 'idle') return;
  _mapState = 'loading';
  const got = {};
  const ok = (k) => (t) => {
    t.colorSpace = THREE.NoColorSpace;                 // §2.2 — both maps are LINEAR
    t.channel = 0;                                     // §2.3's gotcha — the rider has one uv set
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    got[k] = t;
    if (!got.nrm || !got.ach) return;
    _maps = got; _mapState = 'ready';
    for (const m of _riderMats) applyMaps(m);
  };
  const miss = (u) => () => { _mapState = u; };
  new THREE.TextureLoader().load('/r/6a4fa64cb6805a5a/rider/rider-nrm.webp', ok('nrm'), undefined, miss('/r/6a4fa64cb6805a5a/rider/rider-nrm.webp'));
  new THREE.TextureLoader().load('/r/6a4fa64cb6805a5a/rider/rider-ach.webp', ok('ach'), undefined, miss('/r/6a4fa64cb6805a5a/rider/rider-ach.webp'));
}

// ---- specs/0046 §3.6 — the rider shadow: a near-zero caster and a ShadowMaterial disc
// The world ships NO real-time shadow at all: terrain.mjs bakes cast shadow and sky
// occlusion into vertex colours (scene/env.mjs:398-403), props are lit by ambient
// alone (:123-127), and no scene module sets `castShadow` anywhere —
// `loader.js:71`'s `shadows:` flag feeds the world's BAKE, not a shadow map. So the
// rider floats, and the fix is one light, one disc, and two mechanisms worth
// stating because neither is obvious.
//
// WHY INTENSITY 0.0001 WORKS. `ShadowMaterial`'s fragment is
// `vec4(color, opacity * (1 - getShadowMask()))`, and `getShadowMask()`
// (three.module.js:480) sums `receiveShadow ? getShadow(...)` over the
// shadow-casting lights WITHOUT scaling by intensity. The disc therefore renders a
// full-strength shadow while the light contributes 0.0001 × 255 = 0.026/255 of
// diffuse to the rest of the scene — below the frame buffer's own 1/255
// quantisation, i.e. provably invisible, which is what keeps C15's no-wipe at
// 0.0000 % outside the rider mask.
//
// WHY THE REST OF THE WORLD PAYS ALMOST NOTHING. `receiveShadow` is a PROGRAM
// parameter (:17324-17327 — `needsProgramChange` fires on
// `receiveShadow !== object.receiveShadow`), so the shadow branch is compiled OUT
// of every material whose object has `receiveShadow === false`, which is every
// object in the world except `rider:contact`. The cost is one extra program
// variant, compiled once.
//
// §3.5 is why there is no rider-only key or rim light instead: three has no
// per-object light list. `WebGLRenderer.projectObject` admits a light on
// `object.layers.test(camera.layers)` — a test against the CAMERA — so a light "on
// the rider layer" either lights the whole mountain or is excluded from the frame.
// What the rider gets instead is `envMapIntensity`, `clearcoat`, `sheen` and the
// bloom, all of which live on the rider's own material and are rider-only by
// construction.
const SHADOW_OFF = [0.55, 3.2, 0.75];                  // §3.6 — down-slope and slightly aft
const _shadowOf = new WeakMap();                       // one rig shadow per scene, never two
// `buildRider` is handed a THREE and a unit scale, never a renderer — and §3.6
// needs one to set `shadowMap.enabled`, while C11 clause 6 (§6.2) needs one to
// prove 0046 left `toneMapping`, `toneMappingExposure` and `outputColorSpace`
// alone. three hands it over on the first draw: `onBeforeRender(renderer, …)` is
// its own signature. So the rider captures it there, once, and everything that
// wants a renderer queues on `_onRenderer` instead of polling for one.
let _renderer = null, _scene = null, _camera = null;
const _onRenderer = [];
function captureRenderer(body) {
  const prev = body.onBeforeRender;
  body.onBeforeRender = function (r, s, cam, geo, mat, grp) {
    _scene = s; _camera = cam;                         // the live pair, for N29's re-render
    if (r && !_renderer) { _renderer = r; for (const f of _onRenderer.splice(0)) f(r); }
    if (prev) prev.call(this, r, s, cam, geo, mat, grp);
  };
}
function addShadow(THREE, scene, model) {
  if (LOW_END || _shadowOf.has(scene)) return null;    // §4.6 — the ladder's shadow row
  const sh = new THREE.DirectionalLight(0xffffff, 0.0001);
  sh.name = 'rider:shadow-sun';
  sh.castShadow = true;
  sh.shadow.mapSize.set(512, 512);
  sh.shadow.camera.left = -1.2; sh.shadow.camera.right = 1.2;      // a 2.4 u box
  sh.shadow.camera.top = 1.2; sh.shadow.camera.bottom = -1.2;
  sh.shadow.camera.near = 0.1; sh.shadow.camera.far = 6.0;
  sh.shadow.bias = -0.0012;
  // DEVIATION, and it is load-bearing. §3.6 states that "no scene module sets
  // `castShadow` anywhere", and on THIS run's scene that is not true:
  // `scene/world.mjs:180` does `sun.castShadow = opts.shadows !== false` and
  // `world.mjs:468-613`, `park.mjs:987/1224` and `terrain.mjs:1077` set the flag on
  // the village, the lift, the deck, the park surface and the terrain core, with
  // `receiveShadow` on several of them. None of it ever RENDERED, because
  // `renderer.shadowMap.enabled` has always been false — `loader.js:71`'s
  // `shadows:` feeds the world's vertex-colour BAKE, not a shadow map.
  //
  // The moment §3.6 turns that flag on, every one of those flags wakes up: the
  // world sun (intensity 2.15) starts rendering a real shadow map over the whole
  // mountain and the village starts receiving it. That is a wholesale change to
  // the frame — C15's no-wipe would be nowhere near 0.0000 % — and it is many
  // milliseconds, not the ≤ 0.35 ms N29 gates.
  //
  // §3.6's own cost argument depends on the invariant it assumed: "the shadow
  // branch is compiled OUT of every material whose object has receiveShadow ===
  // false — which is every object in the world except rider:contact". So this
  // ESTABLISHES that invariant instead of assuming it. Clearing a flag that has
  // never been read is a no-op for today's frame by construction, which is exactly
  // why it is safe to do and why it has to be done here rather than in a world
  // module nobody on this spec owns.
  // It runs on the FIRST DRAW rather than here, because `mount` fires the moment
  // the rider is added and the world's props, park and signs are still arriving.
  const quiesce = () => scene.traverse((o) => {
    if (o.isLight) { if (o !== sh) o.castShadow = false; }
    else if (o.isMesh && o.name !== 'rider:contact') { if (!/^rider:/.test(o.name)) o.castShadow = false; o.receiveShadow = false; }
  });
  scene.add(sh); scene.add(sh.target);
  // …and then every rider mesh casts — the body, the poles, the 13 skinned
  // garments and each rigid toggle. `play:fp-arms` is NOT under `model` and does
  // not cast: the fp arms are inside the camera and their shadow would be a hand
  // on the snow.
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20),
    new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
  disc.name = 'rider:contact';
  disc.receiveShadow = true;
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = -1;
  scene.add(disc);
  // `renderer.shadowMap.enabled` is the one thing rider.js cannot set from here:
  // it needs the renderer, and buildRider is handed a THREE and a unit scale. The
  // first render of the body hands it over — `onBeforeRender(renderer, …)` is
  // three's own signature — so the flag is set once, on the frame the rider is
  // first drawn, and never polled.
  const rec = { light: sh, disc, follow: null, get renderer() { return _renderer; } };
  const arm = (r) => { quiesce(); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; };
  if (_renderer) arm(_renderer); else _onRenderer.push(arm);
  // The light and the disc follow the rider each frame: the light sits at
  // target + SHADOW_OFF so the shadow falls down-slope and slightly aft, and the
  // disc sits at the rider's own origin, which §N5 puts at the sole. It is snapped
  // flat rather than to the terrain normal — a 1.9 u disc on a groomer's pitch is
  // under a metre of run and the tilt is not readable at chase-cam distance.
  const p = new THREE.Vector3();
  rec.follow = () => {
    model.getWorldPosition(p);
    sh.target.position.copy(p);
    sh.position.set(p.x + SHADOW_OFF[0], p.y + SHADOW_OFF[1], p.z + SHADOW_OFF[2]);
    disc.position.set(p.x, p.y + 0.02, p.z);
  };
  rec.follow();
  _shadowOf.set(scene, rec);
  return rec;
}

let tailoredPolishParts;
function buildAlpinePolish(THREE, rig, u) {
  const parts = tailoredPolishParts ??= tailorRiderUpperParts(tailorRiderParts(POLISH.PARTS));
  const drapeLayout = createDrapeLayout(parts);
  const materialNames = Object.keys(POLISH.MATERIALS);
  const materials = materialNames.map((name) => {
    const source = POLISH.MATERIALS[name];
    const material = new THREE.MeshPhysicalMaterial({ color: source.color, metalness: source.metalness,
      roughness: source.roughness, envMap: defaultEnv(THREE), envMapIntensity: ENV_I,
      clearcoat: source.clearcoat ?? 0.04, clearcoatRoughness: source.clearcoatRoughness ?? 0.45,
      transparent: source.transparent === true, opacity: source.opacity ?? 1 });
    return applyRiderFinish(applyRiderCloth(material, name, u, THREE));
  });
  const boneIndex = Object.fromEntries(rig.skeleton.bones.map((bone, index) => [bone.name, index]));
  const buildBatch = (toggle) => {
    const position = [], normals = [], skinIndex = [], skinWeight = [], index = [], drapeBinding = [], finishBinding = [];
    let completeNormals = true;
    const geometry = new THREE.BufferGeometry();
    for (let materialIndex = 0; materialIndex < materialNames.length; materialIndex++) {
      const start = index.length;
      for (const part of parts) {
        if (part.toggle !== toggle || part.material !== materialNames[materialIndex]) continue;
        const joint = boneIndex[part.bone];
        const weighted = Array.isArray(part.bones) && Array.isArray(part.boneIndices) && Array.isArray(part.boneWeights);
        if (!weighted && joint == null) continue;
        const offset = position.length / 3;
        const hasNormals = Array.isArray(part.normals) && part.normals.length === part.positions.length;
        if (!hasNormals) completeNormals = false;
        for (let vertex = 0; vertex < part.positions.length; vertex += 3) {
          position.push(part.positions[vertex] * u, part.positions[vertex + 1] * u, part.positions[vertex + 2] * u);
          drapeBinding.push(...drapeLayout.encode(part, vertex / 3));
          finishBinding.push(...riderFinishBinding(part, vertex / 3));
          if (hasNormals) normals.push(part.normals[vertex], part.normals[vertex + 1], part.normals[vertex + 2]);
          if (/^polish-v7:boot-shell-[lr]$/.test(part.name)) {
            skinIndex.push(joint, 0, 0, 0);
            skinWeight.push(1, 0, 0, 0);
          } else if (part.name === 'polish-v7:connected-pants' && part.positions[vertex + 1] < 0.56) {
            const side = part.positions[vertex] < 0 ? 'l' : 'r';
            const height = part.positions[vertex + 1];
            const blend = Math.max(0, Math.min(1, (0.34 - height) / 0.16));
            const ankle = blend * blend * (3 - 2 * blend);
            const thigh = Math.max(0, Math.min(0.4, (height - 0.43) / 0.15));
            skinIndex.push(boneIndex[`rider:ankle-${side}`], boneIndex[`rider:leg-l-${side}`], boneIndex[`rider:leg-u-${side}`], 0);
            skinWeight.push(ankle, 1 - ankle - thigh, thigh, 0);
          } else if (weighted) {
            const weightOffset = vertex / 3 * 4;
            for (let slot = 0; slot < 4; slot++) {
              const boneName = part.bones[part.boneIndices[weightOffset + slot]];
              skinIndex.push(boneIndex[boneName] ?? joint ?? 0);
              skinWeight.push(part.boneWeights[weightOffset + slot] ?? 0);
            }
          } else {
            skinIndex.push(joint, 0, 0, 0);
            skinWeight.push(1, 0, 0, 0);
          }
        }
        for (const value of part.indices) index.push(offset + value);
      }
      const count = index.length - start;
      if (count) geometry.addGroup(start, count, materialIndex);
    }
    if (!index.length) return null;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.setAttribute('drapeBinding', new THREE.Float32BufferAttribute(drapeBinding, 4));
    geometry.setAttribute('riderFinish', new THREE.Float32BufferAttribute(finishBinding, 3));
    geometry.setIndex(index);
    if (completeNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const node = new THREE.SkinnedMesh(geometry, materials);
    node.name = toggle ? `rider:alpine-polish-${toggle}` : 'rider:alpine-polish-body';
    node.frustumCulled = false;
    node.castShadow = true;
    rig.model.add(node);
    node.bind(rig.skeleton, new THREE.Matrix4());
    return node;
  };
  const body = buildBatch(''), goggles = buildBatch('goggles');
  const drape = body ? createRiderDrape(THREE, body, materials, u) : null;
  if (drape && typeof location !== 'undefined' && new URLSearchParams(location.search).get('drapeReview') === '1') {
    const removeControls = mountDrapeControls(drape);
    const dispose = drape.dispose;
    drape.dispose = () => { removeControls(); dispose(); };
  }
  return { body, goggles, materials, drape, stats: POLISH.STATS };
}

export function maskAlpineBase(rig) {
  const base = rig.parts && rig.parts['rider:body'];
  if (!base || !base.geometry) return false;
  base.geometry.setDrawRange(0, 0);
  return true;
}

export function maskAlpineLayers(rig) {
  if (!rig.parts) return [];
  const hidden = [];
  const replaced = /^rider:(torso|pants|boot|head|helmet|goggles|hem|bloused)-/;
  for (const [name, node] of Object.entries(rig.parts)) {
    if (!node.geometry || !replaced.test(name)) continue;
    node.visible = false;
    hidden.push(name);
  }
  return hidden;
}

export function buildRider(THREE, u = 1, { outfit = resolveOutfit(), mesh = MESH, alpinePolish = false } = {}) {
  _T = THREE;
  const D = meshOf(mesh);
  _snowAo = !!D.ao;                                    // specs/0056 §2 — the crust term needs vColor
  const model = new THREE.Group();
  model.name = 'play:body';
  // §4.1 — two materials, not one, and the reason is a program change per draw:
  // WebGLRenderer flips `needsProgramChange` when a skinned object meets a
  // material compiled without skinning and again the other way, so one material
  // alternating between a skinned and a rigid mesh reselects a program on EVERY
  // draw of both. `matSkin` is shared by rider:body and rider:poles; `matRigid`
  // is the bone-parented toggles', with the same atlas texture object.
  // specs/0045 §7.1 — ONE physical material per slot, not Lambert. `metalness`
  // and `roughness` stay 1.0 because the ORM canvas carries the values (three
  // multiplies texel.b and texel.g in — three.module.js:424, :470). `emissive`
  // moves 0x737373 → 0xffffff and the emissive CANVAS carries colour × glow, so a
  // look that authors none renders exactly today's 0.451 and Ferrum's reactor is
  // bright because a number says so, not because a hex faked it.
  //
  // specs/0046 §3.1 — `MeshPhysicalMaterial` EXTENDS that: the same `#define
  // STANDARD` shader with `#ifdef PHYSICAL` switched on (three.module.js:560), so
  // every 0045 decision above carries over unchanged and what is added is four
  // feature blocks and two maps. Zero vendor bytes — `lights_physical_fragment`
  // (:398) already implements USE_CLEARCOAT / USE_SHEEN / USE_ANISOTROPY and the
  // clearcoat uniforms are declared at :1249 and :454 in the vendored r180.
  //
  // `transmission`, `thickness`, `iridescence` and `dispersion` are BANNED on
  // rider materials (§3.1) and C11 asserts they are 0: `transmission > 0` makes
  // WebGLRenderer allocate a transmissionRenderTarget and render the whole scene a
  // second time before the transmissive draw (:17441) — 250 calls and 1.9 M tris
  // for a visor, ≈ +8–11 ms, against a 2.5 ms budget for the whole aura. A visor
  // reads as glass from roughness 0.05 + clearcoat 1.0 + the envmap, free.
  //
  // `anisotropy` needs a tangent frame and gets one for nothing: USE_ANISOTROPY
  // reads `tbn`, which the shader builds from screen-space derivatives when
  // USE_NORMALMAP_TANGENTSPACE is defined and no `tangent` attribute is present.
  // §2.2 ships a tangent-space normal map, so no tangent block is baked — that
  // would be +2 B br/vert for nothing. Before the map loads, anisotropy renders as
  // isotropic roughness, which is a graceful degrade rather than an error.
  const physMat = () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, flatShading: FLAT,
      emissive: 0xffffff, metalness: 1.0, roughness: 1.0,
      envMap: defaultEnv(THREE), envMapIntensity: ENV_I, vertexColors: !!D.ao,
      // ---- §3.1's four physical blocks, all driven per look by §3.3 ----
      clearcoat: 1.0, clearcoatRoughness: 0.12,
      sheen: 0.0, sheenColor: 0xffffff, sheenRoughness: 0.5,
      anisotropy: 0.0, anisotropyRotation: 0.0,
      ior: 1.45, specularIntensity: 1.0 });
    snowy(m);                                          // specs/0056 §2 — register + the snow patch
    applyMaps(m);                                      // a no-op until §2's maps land
    return m;
  };
  loadRiderMaps(THREE);
  const matSkin = physMat();
  const matRigid = physMat();
  const mats = [matSkin, matRigid];

  const arm = buildBones(THREE, D, u, model);
  const list = mesh.PARTS || [];
  const parts = { 'play:body': model, ...arm.byName };
  const toggles = [];
  // §2.6 — the bake names the poles' index slice `rider:poles` (extras.parts, §1.6);
  // every other skinned row is the body's. The pole BONES live on the body
  // skeleton under the gloves (§2.1) — it is the mesh, not the bones, that is
  // separate, which is what lets the racks and the fp camera hide the poles
  // without touching the hands.
  const isPole = (p) => p.name === 'rider:poles';
  // specs/0041-W2-DECISIONS §1 — an `sv` row is 0045's third shape: a SkinnedMesh
  // that ALSO carries a toggle (the 13 kit garments — hem-hip, hem-long, puffy,
  // umbra-cape, duke-tubes, the pants/boot/head families). The bake marks it
  // `mesh: 'sv'` and its vertices are in BIND space, not bone-local, so it must
  // NOT go down the rigid-toggle path below.
  const isSv = (p) => p.mesh === 'sv';
  const skinSlices = (f) => list.filter((p) => p.count && f(p)).map((p) => [p.start, p.count]);

  // §4.1 — `rider:body` and `rider:poles` are two SkinnedMesh on the SAME
  // Skeleton instance, both `frustumCulled = false`: a skinned bounding sphere is
  // computed from the BIND pose, and a rider whose arms are over their head in a
  // tumble would pop out of frame at the screen edge.
  // specs/0041-W2-DECISIONS §1 — the `sv` rows join this loop, one SkinnedMesh
  // EACH (never merged into rider:body), which is exactly what lets `.visible`
  // toggle a whole garment; they are bound to the SAME `arm.skeleton` instance
  // and get no bones of their own (the armature is frozen, 0045 §4.2). Their
  // `frustumCulled = false` is the same reason rider:body's is.
  const skinned = [];
  const svRows = list.filter((p) => p.count && isSv(p));
  for (const [name, pick] of [['rider:body', (p) => !p.toggle && !isPole(p)], ['rider:poles', (p) => !p.toggle && isPole(p)],
                              ...svRows.map((p) => [p.name, (q) => q === p])]) {
    const slices = skinSlices(pick);
    if (!slices.length) continue;
    const m = new THREE.SkinnedMesh(sliceGeometry(THREE, D, slices, u, true), matSkin);
    m.name = name;
    m.frustumCulled = false;
    model.add(m);
    m.bind(arm.skeleton, new THREE.Matrix4());
    parts[name] = m;
    skinned.push(m);
  }
  // …and each one registers as a toggle, so `applyFlags` dresses it through the
  // one table the rigid toggles use (§4.3(b)'s variant families reach the kit
  // garments unchanged — `hem=hip` is a variant member whether the node is
  // skinned or rigid).
  for (const p of svRows) if (parts[p.name]) toggles.push({ node: parts[p.name], t: togglePart(p) });
  // §1.5 — a toggle is a rigid Mesh added directly to its owner Bone. Its
  // geometry is already in bone-local space (the bake did `v' = M_rest(bone)⁻¹·v`),
  // so the mesh sits at identity under the bone and there is no per-frame matrix
  // copy anywhere, in the game or in the locker.
  for (const p of list) {
    if (!p.toggle || !p.count || isSv(p)) continue;     // W2-DECISIONS §1 — sv rows are skinned, above
    const bone = arm.byName[p.bone];
    if (!bone) continue;
    const node = new THREE.Mesh(sliceGeometry(THREE, D, [[p.start, p.count]], u, false), matRigid);
    node.name = p.name;
    bone.add(node);
    parts[p.name] = node;
    toggles.push({ node, t: togglePart(p) });
  }

  // §2.6 / §4.1 — `rider:poles`: ski mode, third person, and nowhere else — the
  // racks and every fp mode hide the poles, not the body. The rule runs inside
  // `rig.update` (§4.7's `mount` arrives there); `rig.setPoles(on)` is the harness's.
  const poles = parts['rider:poles'] || null;
  const setPoles = (on) => { if (poles) poles.visible = !!on; return poles ? poles.visible : false; };

  // §2.5 — the fp rig `play:fp-arms`: one 17-bone SkinnedMesh (the F blob, the
  // same vec4-padding decoder), its own material pair (§4.1), the body pole slice
  // re-based under rider:fp-glove-l/r. It mounts itself on the SCENE ROOT (§4.1)
  // and copies the camera's WORLD transform in onBeforeRender (§4.5 write 6) at
  // eye − (0, 0.40, −0.14) — W0 decision 4's 0.14 rides on the mesh, not the bone.
  // specs/0046 §2 — a `clone()` copies the map references but NOT the registry
  // entry, so the fp rigid slot joins `_riderMats` itself or a late map never
  // reaches it.
  const matFp = physMat(), matFpRigid = matFp.clone();
  snowy(matFpRigid);
  mats.push(matFp, matFpRigid);
  const F = decodeMesh(mesh.F);
  // §7.3 — the fp SkinnedMesh is the F blob's; `matFpRigid`'s two pole meshes are
  // sliced out of the BODY blob below, so they follow D, not F.
  matFp.vertexColors = !!F.ao;
  matFpRigid.vertexColors = !!D.ao;
  const fp = new THREE.SkinnedMesh(sliceGeometry(THREE, F, [[0, F.idx.length]], u, true), matFp);
  fp.name = 'play:fp-arms'; fp.frustumCulled = false; fp.visible = false;
  const fa = buildBones(THREE, F, u, fp);
  fp.bind(fa.skeleton, new THREE.Matrix4());
  if (alpinePolish) {
    const polishedFp = buildRiderFpvGeometry(THREE, { scale: u, bodySkeleton: arm.skeleton, fpSkeleton: fa.skeleton });
    fp.geometry.dispose();
    fp.geometry = polishedFp.geometry;
    fp.material = polishedFp.materials;
    fp.userData.polish = polishedFp.stats;
    for (const material of polishedFp.materials) {
      material.envMap = defaultEnv(THREE);
      material.envMapIntensity = ENV_I;
      material.userData.fpvPolish = true;
      mats.push(material);
    }
  }
  // §2.6 — the fp poles are the BODY blob's `rider:poles` slice re-based under
  // rider:fp-glove-l/r, one Mesh per side. WHICH triangles are which pole is read
  // off the SKIN, never off the slice's midpoint: poles.py emits pole-l whole and
  // then pole-r whole, but the Blender stack the part goes through (bevel,
  // Catmull-Clark, triangulate — gen/api.py's modifier order) reorders faces
  // inside the part, and the baked `rider:poles` slice is in fact
  // pole-l ×88 · pole-r ×88 · pole-l ×20 · pole-r ×20 triangles. Cutting it at
  // `count / 2` therefore handed the left glove 88 left triangles + the first 20
  // of the right pole and the right glove the remainder — the shaft stub and the
  // loose basket of the fp screenshot. Every pole vertex weights its own pole bone
  // at 1.0 (poles.py's `Weights`), so the bone id of a triangle's first vertex IS
  // the side, and the runs it groups into are the slices sliceGeometry wants.
  const pole = list.find(isPole), fpPoles = [];
  const poleRuns = (side) => {
    const want = D.bones.findIndex((b) => b.name === 'rider:pole-' + side);
    const out = [];
    for (let k = pole.start; k < pole.start + pole.count; k += 3) {
      if (D.si[D.idx[k] * 4] !== want) continue;
      const last = out[out.length - 1];
      if (last && last[0] + last[1] === k) last[1] += 3; else out.push([k, 3]);
    }
    return out;
  };
  if (pole) for (const s of ['l', 'r']) {
    const g = sliceGeometry(THREE, D, poleRuns(s), u, false);
    const m0 = mesh.DATUM.mount[s === 'l' ? 'gloveL' : 'gloveR'];
    const pm = new THREE.Mesh(g.translate(-m0[0] * u, -m0[1] * u, -m0[2] * u), matFpRigid);
    // The fp rig sits AT the camera (§4.5 write 6) and its world matrix is
    // written in `fp.onBeforeRender`, which runs AFTER WebGLRenderer.projectObject
    // has already culled: a frustum test on this mesh reads LAST frame's matrix
    // (the scene origin on the first frame), so a fast camera turn made the pole
    // vanish and come back. `fp` itself is `frustumCulled = false` for the same
    // reason one line up; its poles were not, and that was the pop.
    pm.frustumCulled = false;
    pm.name = 'play:fp-pole-' + s;
    fa.byName['rider:fp-glove-' + s].add(pm);
    fpPoles.push(pm);
  }
  // 0045 §7.2 — the walk that finds the scene root for the fp rig is also where
  // the rider picks up THAT WORLD's envmap: one cached CubeTexture per scene, so
  // all four materials and the mannequin share one PMREM pass. Before a scene is
  // found they carry `defaultEnv` — a metal is never black.
  let _shadow = null;                                  // specs/0046 §3.6, filled by `mount`
  captureRenderer(parts['rider:body'] || model);       // specs/0046 §3.6 / §6.2 C11 clause 6
  const mount = () => {
    let p = model;
    while (p.parent) p = p.parent;
    if (!p.isScene) { p.addEventListener('added', mount); return; }
    p.add(fp);
    const e = envFor(THREE, p);
    for (const m of mats) if (m.envMap !== e) { m.envMap = e; m.needsUpdate = true; }
    _shadow = addShadow(THREE, p, model) || _shadowOf.get(p) || null;   // specs/0046 §3.6
  };
  model.addEventListener('added', mount);
  const fwd = new THREE.Vector3();
  // §2.5 — the fp rig is FROZEN at 17 bones (bones.json, N1) and carries no
  // rider:fp-pole-*, so the pole hangs off the glove at its REST tilt (0.55 rad
  // back, poles.py:42) while the third-person pole swings on `rider:pole-l/r` —
  // the clips key that bone (skate-push-l runs it −1.35 … −0.95) and §4.5 write 3
  // pitches it onto the snow. The rigid fp pole IS the pole bone's child in every
  // sense but the skeleton, so it takes that bone's LOCAL quaternion each frame:
  // one copy, no allocation, and the two cameras see the same pole angle.
  const bPoleFp = fpPoles.map((_, i) => arm.byName['rider:pole-' + (i ? 'r' : 'l')] || null);
  fp.onBeforeRender = (r, s, cam) => {
    cam.getWorldPosition(fp.position).add(fwd.set(0, 0, -0.14 * u).applyQuaternion(cam.getWorldQuaternion(fp.quaternion)));
    for (let i = 0; i < fpPoles.length; i++) if (bPoleFp[i]) fpPoles[i].quaternion.copy(bPoleFp[i].quaternion);
    fp.updateMatrixWorld(true);
    fa.skeleton.update();
  };
  const setFp = (on) => (fp.visible = !!on);

  // §4.2 — one AnimationMixer per skeleton, with the SkinnedMesh itself as the
  // root: a track name binds a bone through `.bones[<name>]`, which
  // PropertyBinding resolves via `targetObject.skeleton`, and a Group has none.
  // The clip table is the 42 (25 body, then 17 fp — §3.3): an `fp` clip binds on
  // the fp mixer alone, a body clip on both, retargeted, under the SAME name.
  const mixer = new THREE.AnimationMixer(parts['rider:body'] || model), fpMixer = new THREE.AnimationMixer(fp);
  const actions = new Map(), fpActions = new Map();
  const fpNames = F.bones.map((b) => b.name), names = D.bones.map((b) => b.name).concat(fpNames);
  const dc = decodeClips(THREE, mesh.C || CLIP_BLOB, names, D.bones[0].rest);
  if (dc.boneCount !== names.length) throw new Error(`rig/clips: ${dc.boneCount} bones, rider-mesh.js has ${names.length}`);
  for (const c of dc.clips) {
    if (c.userData.rig === 'fp') { fpActions.set(c.name, fpMixer.clipAction(c)); continue; }
    actions.set(c.name, mixer.clipAction(c));
    const t = retarget(c, 'rider:', 'rider:fp-', fpNames);
    // `retarget` builds a FRESH clip, so the blend mode does not come across.
    if (t.tracks.length) { t.blendMode = c.blendMode; t.userData = c.userData; fpActions.set(c.name, fpMixer.clipAction(t)); }
  }

  // §4.4 — THE TUMBLE FAMILY. The root keeps its authority (main.js:1552-1581);
  // the bones get four pose clips (§3.2 rows 9–12) on the same tracks, replacing
  // the rigid arm overlay main.js:1583-1585 (A23 deletes it). fold = min(1, t /
  // TUM.FOLD) is main.js:925's expression (TUM.FOLD 0.15, module-local there);
  // kickN / backN are the two samples tumbleStep() stores (A23's insertion).
  //   u_fold = fold² · u_kick = kickN · u_back = backN · u_splay = max(0, 1 − fold² − kickN)
  //   w_i = a · u_i / Σu,  a = tum.auth  (Σu ≥ 1 by construction)
  // The NORMALISATION is the point: the family sums to exactly its authority
  // every frame, or PropertyMixer's bind-pose slerp (§4.2) takes the rest.
  // `1 − a` is the base slot's (A21, §4.3); until then the mixer's `weight < 1`
  // branch IS mix(riding, tumble, a) on a rest-posed rider. One-key poses play
  // PAUSED at time 0, stopped outright at a = 0 (N8); a stub is absent from Σu.
  const TUM_FOLD = 0.15;
  const family = [['tum-fold', 'fold'], ['tum-kick', 'kick'], ['tum-prone', 'back'], ['tum-splay', 'splay']]
    .map(([name, key]) => ({ name, key, action: actions.get(name) || null, u: 0, w: 0 }))
    .filter((f) => f.action);
  let familyLive = false, familySum = 0;
  // specs/0041-W2-DECISIONS §14 — THE BONE SLOT'S AUTHORITY IS NOT THE ROOT'S RAMP.
  // `TUM_KF.auth` is `[[0,0],[0.045,1],[1.60,1],[2.00,0]]`: it is **0 on the wipe
  // frame itself** and reaches 1 three frames later. That ramp is the ROOT's, and
  // §4.4 keeps it ("Nothing about the root changes"). But §6.2 C21 says the tum-*
  // actions are the only body actions over 0.01 **during the tumble**, and it reads
  // the frame `wipeT()` first goes positive — where `a` is exactly 0, so a family
  // scaled by `a` alone is silent on the one frame the check looks at while the
  // base slot is still at 1. That is the C21 failure the merged W2 tree carries.
  //
  // So the BONE authority is `max(auth, 1 while t < TUM_FOLD)`: 1 from the wipe
  // frame through the fold — §4.4's own words, "the fold IS a snap" — then `auth`
  // itself, which is already 1 until t = 1.60 and hands back over 1.60 → 2.00, so
  // the get-up still lands exactly on the riding pose at 2.0 and nothing about that
  // tail changes. Outside a wipe `tum.on` is false and this is 0, identically to
  // before. The base slot and every ski overlay are scaled by `1 − A` in blendStep,
  // so the two slots sum to exactly 1 at every instant and PropertyMixer's
  // bind-pose slerp (§4.2) never sees a cumulative weight under 1 — which is the
  // same rule §4.4's normalisation paragraph states, applied across the pair.
  const tumAuth = (tum) => {
    if (!tum) return 0;
    const a = Math.min(1, Math.max(0, +tum.auth || 0));
    // a `tum` without `.on` (a pre-§4.4 shape) keeps exactly today's behaviour
    const on = tum.on !== undefined ? !!tum.on : a > 0;
    return on ? Math.max(a, (+tum.t || 0) < TUM_FOLD ? 1 : 0) : 0;
  };
  const tumbleFamily = (tum) => {
    const a = tumAuth(tum);
    if (!(a > 0) || !family.length) {
      if (familyLive) { for (const f of family) { f.action.setEffectiveWeight(0); f.action.stop(); f.u = f.w = 0; } familyLive = false; familySum = 0; }
      return 0;
    }
    const fold = Math.min(1, (+tum.t || 0) / TUM_FOLD), f2 = fold * fold;
    // (`a` here is tumAuth's, so `w_i = a · u_i / Σu` reads exactly as §4.4 writes
    // it — only the value of `a` on the fold's first three frames has changed.)
    const kick = +tum.kickN || 0, back = +tum.backN || 0;
    const u = { fold: f2, kick, back, splay: Math.max(0, 1 - f2 - kick) };
    familySum = 0;
    for (const f of family) familySum += (f.u = u[f.key]);
    if (!familyLive) { for (const f of family) { f.action.reset(); f.action.play(); f.action.paused = true; f.action.time = 0; } familyLive = true; }
    for (const f of family) f.action.setEffectiveWeight(f.w = familySum > 0 ? a * f.u / familySum : 0);
    return a;
  };

  // ---------------------------------------------------- §4.3 THE BLEND TREE
  // (1) THE BASE SLOT SUMS TO 1: §4.2's `weight < 1` branch (three.core.js:51014)
  // slerps every base bone back toward its bind-time original, so a base that
  // dips for one frame is a rider flickering toward the A-pose on every mode
  // change (design R6). The proof is one line — the targets sum to 1 in EVERY
  // mode and every base weight moves on the SAME k, so `Σw += (Σt − Σw)·k` holds
  // Σw at 1 for all time; the divide below is the float belt.
  // (2) EVERY WEIGHT MOVES ON THE SIM dt: `w += (t − w)·min(1, 8·dt)`,
  // main.js:1214's shape, on the dt `rig.update` differences out of `simTime` —
  // 0 while paused, one n·dt burst out of `stepFixed` (§4.2), which is what makes
  // N16 true. (3) Weights go to `action.weight`, NEVER `setEffectiveWeight`: the
  // setter calls `stopFading()` (:52663) and would eat the envelope the one-shot
  // rows require, while `_updateWeight` multiplies `.weight` BY the fade
  // interpolant (:53017) — so `1 − a` and `fadeIn(0.08)` compose.
  const CARVE_FULL = 0.68;                 // ski.js:68 `S.carveRoll` — a committed edge (39°)
  // ---- THE POP AND THE THREE LANDING TIERS (branch rider/land-pop).
  const LIP_MAX = 7.5;                     // ski.js:227 `S.lipMax` — the charge's denominator
  // The tiers, in u, on fx.js:2165's `max(0, -prevVy)` GENERALISED TO THE SURFACE:
  // `max(0, -(v · n))`, the closing speed along the ground normal. On flat snow n is
  // +y and the two are one number; on a pitch they are not, and this mountain is a
  // pitch — every Gold Coast roller lands at -prevVy 6…17 purely because the ground
  // falls away, which read as a stomp at every touchdown (PROGRESS-land-pop.md §5).
  // 2.5 is fx.js:2166's own burst gate, under which the generic `land` plays for
  // every gear; 12.0 is IM.FLASH_V, where the impact frame inverts the screen.
  const LAND_SOFT = 2.5, LAND_MED = 7.0, LAND_HARD = 12.0;
  // ---- specs/0057 §6 — THE PARK SET. Two eases and one basis, and nothing else is new arithmetic.
  const JIB_FADE = 0.12;                   // specs/0057 §6.2 — the JIB group's ease (snapT's number)
  const GRAB_FADE = 0.10;                  // specs/0057 §5.5 — the grab layer's fade in and out
  const GRAB_TWEAK = 0.35;                 // specs/0057 §5.5 — rad, the procedural bone-out on the grabbed leg
  // specs/0057 §6.2's basis node spacing: `tri(a, c) = max(0, 1 − |wrap(a − c)| / 90°)`, in RADIANS
  // because every angle in this file is. The three nodes are −90 / 0 / +90 and the ±180 pole folds onto
  // 0 by the wrap — which is §6.2's "the ±180° pole reuses jib-5050": a switch 50-50 is a 50-50.
  const JIB_NODE = Math.PI / 2;
  // specs/0057 §6.2 / 0057-DECISIONS #2 — the SIGN of `__rail.state().yaw`. R1 owns the measurement
  // (§3: "the signed angle from segment tangent to ski heading"); which way round it comes out decides
  // only whether +90° is the frontside clip or the backside one. It is a named constant and not an
  // inlined sign so that, if R1's convention lands the other way up, the merge is this one line.
  const RAIL_YAW_SIGN = 1;
  // branch rider/air-stance — HOW FAR A LANDING TIER DUCKS THE BASE SLOT. It was 1: the tier
  // took the whole slot, the stance and the tuck went to zero, and a `land-hard` therefore
  // ended on its own key 24 — the REST leg, a 10° knee — and handed a 64° riding stance back
  // over one fade. The clip's last keys and that hand-back move the knee the SAME way and
  // measured 8.6°/frame together. At 0.85 the stance is never entirely gone, the tier still
  // reads at ~87 % of its authored depth (its 1 against a base of 0.15), and the hand-back
  // is a fraction of the swing.
  const LAND_DUCK = 0.85;
  const POLE_ON = 0.20, POLE_OFF = 0.10;   // §4.3 — the carve-onset edge, and its re-arm
  // ---- branch rider/pump-oneshot — THE PUMP'S OWN EDGE. `pump` (gen/clips/pump.py) is a SHOT-slot
  // one-shot fired on the TURN APEX and nowhere else: the frame ski.js's `pumpPhase` crosses from
  // COMPLETION (−1, the load building) to INITIATION (+1, coming back down), with the peak edge load
  // still inside `S.pumpWindow` of the turn clock — which is exactly the `timing` term ski.js already
  // scores the payout with (ski.js:859). One rising edge per turn, armed only by a completion phase,
  // so a phase that chatters across the ±0.02 dead band cannot fire a second push.
  // PUMP_WINDOW is `S.pumpWindow` (ski.js:118), the way LIP_MAX is `S.lipMax` and CARVE_FULL is
  // `S.carveRoll` — a literal here, named, because `skiState()` is module-scope and `S` is not.
  // ...and `S.pumpMinTurnT` (ski.js:120), ski.js's own anti-wiggle floor: a turn that lasted less
  // than this does not pay a payout, so it does not buy a push either. Measured on the carving run
  // it is what stops a quick edge flip mid-arc from reading as two pushes 0.13 s apart.
  const PUMP_WINDOW = 0.22, PUMP_MIN_T = 0.25;
  const FADE_IN = 0.08, FADE_OUT = 0.12;   // §4.3 — the one-shot envelopes
  // ---- branch rider/air-stance — TWO NAMED SWITCHES AND THE AIR ENVELOPE.
  //
  // `PUMP_POSE` is the pump's POSE, and nothing else. `pop-load` (gen/clips/pop_load.py)
  // is the wind-up the tree scrubs on `skiState().lipVy`: knees fold, torso folds over the
  // skis, and the arms DRAW BACK behind the hips. Measured on the Gold Coast in-run it sits
  // at w 0.78–0.93 for the whole approach, because `lipVy` is pegged at `lipMax` on that
  // pitch — so the rider descends a 30° face permanently cocked to throw, which is Greg's
  // "the pump looks like it's slowing me down" (2026-09-05). It reads as braking because a
  // deep crouch with the hands behind the hips IS the braking shape; the physics disagrees
  // (the pump ADDS speed, ski.js §1) and the physics is untouched here. `false` takes the
  // charge to 0 before the tree ever sees it, so `pop-load` takes no base weight and is
  // never scrubbed — one flag, no deletion, and the clip still ships and still bakes.
  const PUMP_POSE = false;
  // `AIR_STANCE` is the tuck-and-extend envelope (§4.3a below). `false` gives back the
  // camera's own airborne crouch — `wantCrouch = 0.9` while `!grounded`, main.js:1242.
  const AIR_STANCE = true;
  const AIR_TUCK = 0.98;                   // the scrub the knees come up to — ski-tuck's own deep end
  const WALK_LO = 0.5, WALK_HI = 1.6;      // × u — main.js:1516's literal, moved here (A23 deletes it)
  const RUN_LO = 3.2, RUN_HI = 4.4;        // × u — §4.3's walk → run crossfade
  const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ramp = (v, lo, hi) => c01((v - lo) / (hi - lo));
  // one channel = one clip NAME on both skeletons (a body clip is retargeted onto
  // the fp rig under the same name, §3.3) carrying one weight. `ski-tuck` is a
  // scrub but sits in the BASE slot: its weight IS the base's own remainder
  // (§4.3), its time is the crouch — two uses of one number (§3.7).
  // THE fp OVERRIDE, one lookup: an authored `fp-<name>` wins over §3.9's retarget
  // of `<name>`, because in fp the arms are the only thing on screen and a gesture
  // sized for 20 px of rider reads as nothing at 0.6 m. No twin, no change.
  const chan = (n) => ({ name: n, a: actions.get(n) || null, f: fpActions.get(`fp-${n}`) || fpActions.get(n) || null, w: 0, t: 0, out: false });
  const have = (l) => l.map(chan).filter((x) => x.a || x.f);
  const BASE = have(['ski-stance', 'ski-tuck', 'pop-load', 'idle-boots', 'walk', 'run',
                     'seat-bike', 'seat-sled', 'seat-snowmobile', 'prone-glider']);
  const OVER = have(['carve-l', 'carve-r', 'skate-push-l', 'skate-push-r']);
  // `pump` (branch rider/pump-oneshot) joins the SHOT slot rather than the BASE slot `pop-load` sat
  // in: it is an EVENT, so it takes its authority as an overlay with a fade in, a clip-phase envelope
  // and an end — never a level. Its fp half is the AUTHORED `fp-pump`, which `chan()` picks up as this
  // channel's fp override (§3.9), so one row drives both rigs off one edge.
  const SHOT = have(['pole-plant-l', 'pole-plant-r', 'jump-off', 'pop', 'air',
                     'land', 'land-soft', 'land-med', 'land-hard', 'pump']);
  // the ADDITIVE slot: one row, outside every sum above by construction — which is
  // why a stagger is authored this way. It rides the SHOT loop's `1 − a` too.
  const ADD = have(['land-stagger']), SHOT_ADD = [...SHOT, ...ADD];
  // ---- specs/0057 §6.1 — THE JIB GROUP, parallel to OVER: three looping slide clips blended on one
  // dimension, `railYaw`. LOOPS and not scrubs (a slide breathes on its own clock while the basis picks
  // which of the three you are breathing in), so all three run from the first step and the basis moves
  // their weights — armed together, which holds their 24-frame loops in phase so a blend between two of
  // them can never cross-fade one clip's key 0 against another's key 12.
  const JIB = have(['jib-5050', 'jib-fs', 'jib-bs']);
  // ---- specs/0057 §5.5 — THE GRAB ADDITIVE ROW, beside ADD and outside every sum for the same reason
  // (§3.3 bit 5). Six poses and the let-go. Grab name → clip, and the leg the tweak bones out: SAFETY
  // and TRUCK DRIVER are `tweakable: no` in §5.1's table and carry side 0, both hands being committed.
  // The key is normalised (letters only, upper case) so R3 may publish 'INDY', 'indy' or 'grab-indy'.
  const GRAB = have(['grab-nose', 'grab-tail', 'grab-mute', 'grab-indy', 'grab-safety', 'grab-truck']);
  const LETGO = have(['grab-release']);
  const ADD_ALL = [...ADD, ...GRAB, ...LETGO];
  const GRABS = [['NOSE', 'grab-nose', -1], ['TAIL', 'grab-tail', 1], ['MUTE', 'grab-mute', -1],
                 ['INDY', 'grab-indy', 1], ['SAFETY', 'grab-safety', 0], ['TRUCKDRIVER', 'grab-truck', 0],
                 ['TRUCK', 'grab-truck', 0]];
  const GRAB_ROW = new Map();
  for (const [k, name, side] of GRABS) { const row = { name, side, x: null }; GRAB_ROW.set(k, row); GRAB_ROW.set(name.replace(/[^A-Za-z]/g, '').toUpperCase(), row); }
  // §3.2a (rider/fp-poles) — THE FP ARM OVERLAYS. Three clips authored on the fp rig
  // itself (gen/clips/fp_idle_poles.py, fp_skate.py, fp_pole_plant.py), so `chan().a` is
  // null on every one of them and NOTHING in this group can reach the third-person body.
  // They exist because on skis the fp rig plays the RETARGETED body clips (§3.9) and the
  // body's ski stance hangs the gloves at ndc y ≈ −1.26 — under the bottom of the frame,
  // which is why a cold start showed skis and no hands.
  const FPO = have(['fp-idle-poles', 'fp-skate']);
  const FPSHOT = have(['fp-pole-plant']);
  const CH = new Map([...BASE, ...OVER, ...SHOT, ...ADD, ...FPO, ...FPSHOT,
                      ...JIB, ...GRAB, ...LETGO].map((x) => [x.name, x]));   // specs/0057 §6
  const ch = (n) => CH.get(n) || null;
  const each = (x, fn) => { if (x) { if (x.a) fn(x.a); if (x.f) fn(x.f); } };
  for (const row of new Set(GRAB_ROW.values())) row.x = ch(row.name);        // specs/0057 §5.5
  // specs/0057 §6.2 / §5.5 — THE TWO TEST HOOKS THIS TREE READS, and it reads nothing else off window.
  // `__rail` is R1's and `__grab` is R3's (0057 §9); either may be absent — the locker, paint-sheet's
  // scratch harness and a bench without the park module all load this file, and in all three the tree
  // must run with no jib and no grab. Read defensively every step, never cached: the `?? null` IS
  // §9's stub, with nothing for the merger to unpick. Shapes, pinned by §3 and §5.4:
  //   __rail.on() -> bool · __rail.state() -> { jib, type, s, yaw, switchUps, charge, entryYaw }
  //   __grab.state() -> { grab, tweak, held, releasedAt }
  // `yaw` is RADIANS (this file's unit everywhere); a magnitude past π can only be degrees, so it is
  // converted rather than clamped — §6.2 writes the basis in degrees, R1's own text in neither, and a
  // tree that silently saturated at π would blend a switch 50-50 as a frontside slide.
  const W = () => (typeof window !== 'undefined' ? window : null);
  const railHook = () => {
    try {
      const w = W(), r = w && w.__rail;
      if (!r || typeof r.state !== 'function') return null;
      if (typeof r.on === 'function' && !r.on()) return null;
      return r.state() || null;
    } catch { return null; }
  };
  const grabHook = () => {
    try { const w = W(), gr = w && w.__grab; return gr && typeof gr.state === 'function' ? (gr.state() || null) : null; } catch { return null; }
  };
  const rad = (v) => { const n = +v || 0; return Math.abs(n) > Math.PI + 1e-6 ? n * (Math.PI / 180) : n; };

  // `wr` is what goes to the MIXER, `w` what the tree remembers. specs/0041-W2-DECISIONS
  // §14: during a wipe every ski row is written at `w · (1 − A)` while its own `w`
  // keeps tracking its target, so the tree unwinds to the right pose the moment the
  // tumble hands back instead of restarting from zero.
  // `wr` is the BODY action's weight and `fr` the fp one's. They were one number until
  // §3.2a: the fp overlays take their share OFF the fp side of the base and the overlays
  // (`fr = wr · (1 − fpo)`), so on the fp rig base + fp overlay = 1 exactly. Without that
  // split an overlay at weight w over a base at 1 shows w/(1 + w) of its pose (A12
  // finding 4) and the authored hand position is never reached; with it the cumulative
  // weight on every fp bone is still 1 and PropertyMixer's bind-pose slerp is never
  // entered — which is why the three fp clips key all seventeen fp bones (W2 §10).
  const play1 = (t, v) => { if (!t) return; t.weight = v; if (!t.isRunning()) { t.enabled = true; t.play(); } };
  const put = (x, w, wr = w, fr = wr) => { x.w = w; play1(x.a, wr); play1(x.f, fr); };
  // a scrub is PAUSED and read at a phase, never advanced on its own clock (§3.3)
  const scrubAt = (x, k) => each(x, (t) => { t.paused = true; t.time = c01(k) * t.getClip().duration; });
  // one-shot: LoopOnce, and `_updateTime` disables it at the end (:53138)
  const fire = (x) => { if (!x) return; x.out = false; each(x, (t) => { t.reset(); t.setLoop(THREE.LoopOnce, 1); t.clampWhenFinished = false; t.enabled = true; t.weight = 1; t.play(); t.fadeIn(FADE_IN); }); };
  const hold = (x) => { if (!x) return; x.out = false; each(x, (t) => { if (!t.isRunning() || !t.enabled) { t.reset(); t.setLoop(THREE.LoopRepeat, Infinity); t.enabled = true; t.weight = 1; t.play(); t.fadeIn(FADE_IN); } }); };
  const release = (x) => { if (!x || x.out) return; x.out = true; each(x, (t) => { if (t.isRunning()) t.fadeOut(FADE_OUT); }); };
  // branch rider/air-stance — A LoopOnce ROW'S OWN ENVELOPE, read off its clip phase.
  // OUT: `fire` sets `clampWhenFinished = false`, so `_updateTime` DISABLES the action the
  // frame it reaches its duration — full authority to none with no fade at all (measured:
  // +12.2° of knee in the one frame `jump-off` ended). IN: `fire` sets `weight = 1` and only
  // THEN `fadeIn`, and the interpolant does not exist until `mixer.update`, which runs after
  // this function — so the first frame writes a full-weight pose (−12.4° of knee at take-off).
  // `phase` multiplies both ends, which turns three's linear 0.08 s fade into a quadratic
  // ease and gives the hard end the 0.12 s `release` would have given it. LoopRepeat rows
  // (the `air` loop) answer 1 at every phase — a tail there would dip on every lap.
  const SHOT_TAIL = 0.12;   // s — the tail, `release`'s own FADE_OUT applied to a clip that ends
  // by running out of frames instead of by being let go.
  const phase = (t) => { if (t.loop !== THREE.LoopOnce) return 1; const d = t.getClip().duration; return d > FADE_IN + SHOT_TAIL ? Math.min(c01(t.time / FADE_IN), c01((d - t.time) / SHOT_TAIL)) : 1; };
  let _sum = 0, _first = true;

  let _grounded = null, _poleArmed = true, _skating = false, _skateSide = 0, _skateT = 0;
  // branch rider/pump-oneshot — the apex edge's memory: `_pumpArmed` is set by a completion phase and
  // cleared by the attempt, `_pumpN` counts the shots fired and is reported by `rig.blend()` so a trace
  // can line the fires up against the phase crossings one for one.
  let _pumpArmed = false, _pumpN = 0, _pumpTurn = -1;
  let _fpo = 0;                                  // §3.2a's fp-overlay share, reported by rig.blend()
  let _crouch = 0, _frozen = false;
  // `_pv` is fx.js:2164's `R.prevVy`, kept as the whole vector; `_popPaid` mirrors
  // `skiState().popPaid` so the tree can take its RISING edge (ski.js:1215, the frame
  // the pop counted); `_lastJudged` is the judge's verdict OBJECT, by reference.
  let _pv = { x: 0, y: 0, z: 0 }, _impact = 0, _popPaid = null, _lastJudged = null;
  let _land = 0, _lastTier = '', _charge = 0;
  // specs/0057 §6.2 / §5.5 — the park set's own memory. `_jib` is the JIB group's eased weight and the
  // factor the base slot is ducked by; `_railYaw` the basis input as the tree last read it; `_grabRow`
  // the pose row currently held (by reference, so a name change is one comparison); `_grabHeld` the
  // level whose FALLING edge is D13's release edge and the only thing that fires the let-go; `_tweak`
  // the eased 0…1 on §5.5's ±0.35 rad procedural bone-out and `_tweakSide` which leg takes it.
  let _jib = 0, _railYaw = 0, _jibArmed = false;
  let _grabRow = null, _grabHeld = false, _grabRel = null, _tweak = 0, _tweakSide = 0;
  // §4.3a — the air envelope's state. `_airT` is elapsed air, `_airTtl` the flight time
  // estimated at take-off, `_cOff` the seam: the crouch this layer was holding when the
  // skis touched down, carried as an OFFSET on the camera's own value and eased to 0, so
  // the frame the tree hands the crouch back is not a step. `_landFired` is the touchdown
  // frame itself (see `_land` below).
  let _cTake = 0, _cOff = 0, _landFired = false;
  let _airEnvelope = null;
  // §4.3 — the tree, run BEFORE `mixer.update` on the §4.2 sim dt.
  const blendStep = (dt, ctrl, camRig, tum, o) => {
    if (_frozen) return _sum;                      // `setScrub` holds the whole tree (§4.1)
    const k = Math.min(1, 8 * dt);
    // specs/0041-W2-DECISIONS §14 — `a` is the BONE authority `tumAuth` gave the
    // tumble family one call earlier in rig.update, not the raw `tum.auth`: on the
    // wipe frame the root has not moved yet but the body has been hit, and C21
    // reads that frame. `g = 1 − a` is unchanged as a rule and is still 0 outside a
    // wipe; inside one it now reaches 0 immediately instead of over three frames.
    const a = tumAuth(tum), g = 1 - a;
    // §4.3's `(1 − a)` on every ski overlay, one rule stated once: as the tumble
    // takes authority everything the rider was doing on the snow fades out —
    // main.js:1546-1551's mix(riding, tumble, auth), spelled in weights.
    const mode = ctrl ? ctrl.mode : 'skis';
    const footed = !!(ctrl && ctrl.footedNow);
    const riding = !!ctrl && mode !== 'boots' && !footed;
    const glide = mode === 'glider', glideAir = glide && !!ctrl && !ctrl.grounded;
    const stand = !footed && (mode === 'skis' || mode === 'rocket');
    const grounded = !ctrl || !!ctrl.grounded;
    const sp = ctrl && ctrl.speed ? ctrl.speed() : 0;
    // ---- §4.3a (branch rider/air-stance) — THE CROUCH THE TREE RIDES.
    //
    // On the ground it is the camera's own, unchanged: `0.15 + 0.6·spN + 0.7·ctrl.crouch`
    // eased at 5/s (main.js:1242-1243), which is the "slightly bent legs" default stance —
    // measured on a settled standing rider it is 27.3° of knee, and on the Gold Coast
    // in-run 42–47°. Nothing here bends it further.
    //
    // In the AIR that same line slams `wantCrouch` to a flat 0.9 and leaves it there for the
    // whole flight, so the legs fold on the way up, stay folded, and are still folded when
    // the snow arrives — the landing tier then has to unfold them in three frames, which is
    // the "legs teleporting down" (measured: −37.0° of knee in ONE frame at touchdown).
    // Greg, 2026-09-05: "when they jump, the knees go up to the belly and then gradually
    // come back to the default down position". So this layer authors the flight instead:
    const cCam = riding && !glide && camRig && camRig.state ? c01(+camRig.state.crouch || 0) : 0;
    let c = cCam;
    if (AIR_STANCE && riding && stand) {
      if (grounded) {
        // the seam: whatever this layer was holding at touchdown is carried as an offset on
        // the camera's value and eased out at the tree's own rate, so handing the crouch back
        // is a fade and not a step.
        _cOff += (0 - _cOff) * k;
        _cTake = c01(cCam + _cOff);
        _airEnvelope = null;
        c = _cTake;
      } else {
        _airEnvelope = stepAirEnvelope(_airEnvelope, dt, ctrl && ctrl.airToLanding ? ctrl.airToLanding() : 0);
        c = c01(_cTake + (AIR_TUCK - _cTake) * _airEnvelope.tuck);
        _cOff = c - cCam;
      }
    }
    _crouch = c;
    // `carveRoll` and NOT `roll`: `roll` is `_rollOut`, the carve PLUS the 27 Hz
    // chatter shimmy (ski.js:1026-1027), and a spine that shivers with the tails
    // is a body having a seizure. The chatter belongs to the skis.
    const sk = mode === 'skis' ? skiState() : null;
    const carve = sk ? +sk.carveRoll || 0 : 0;
    const skating = !!sk && grounded && (+sk.push || 0) !== 0;   // A17: `push` IS the :884 gate

    // ---- §3.2a — THE FP ARM OVERLAYS, computed BEFORE the base is written because the
    // base's fp side is scaled by their total. `fp-idle-poles` is the hands resting on
    // the poles and fades out over FP_LO…FP_HI as the stance and the tuck take the frame
    // back; `fp-skate` runs on the same `skating` gate as skate-push-l/r and shares its
    // period to the frame; `fp-pole-plant` is a one-shot on the skate gate's RISING edge
    // — the double pole that starts the push — and `_skating` still holds LAST frame's
    // value at this point, which is exactly that edge. All three are grounded-on-skis
    // only, so `fpo` is 0 in the air and §4.3's one-shots keep the whole fp rig there.
    const FP_LO = 3.0, FP_HI = 11.0;             // × u — the band the fp hands hand back over
    const fpIdle = ch('fp-idle-poles'), fpSk8 = ch('fp-skate');
    const fpOn = mode === 'skis' && stand && (grounded || (alpinePolish && !_grabHeld)) && !glide;
    // The one-shot is read FIRST and the two loops are given the `room` it leaves, so the fp
    // side of the tree sums to exactly 1: base · (1 − fpo) + loops · room + shot. Summed the
    // other way round, the plant and the loop it hands over to would both sit at 1 and
    // PropertyMixer would show half of each — the authored gesture, halved.
    if (FPSHOT.length && skating && !_skating) fire(FPSHOT[0]);
    let fpShot = 0;
    for (const x of FPSHOT) {
      x.w = 0;
      if (x.f && x.f.isRunning()) { x.f.weight = fpOn ? g : 0; x.w = x.f.getEffectiveWeight(); }
      fpShot += x.w;
    }
    const room = 1 - (fpShot < 0 ? 0 : fpShot > 1 ? 1 : fpShot);
    let fpo = 1 - room;
    const fpIdleWeight = alpinePolish ? 1 - 0.2 * ramp(sp, FP_LO * u, FP_HI * u) : 1 - ramp(sp, FP_LO * u, FP_HI * u);
    for (const [x, t] of [[fpIdle, fpOn && !skating ? fpIdleWeight * g : 0],
                          [fpSk8, fpOn && skating ? g : 0]]) {
      if (!x) continue;
      x.t = t; x.w += (x.t - x.w) * k; put(x, x.w, x.w, x.w * room);
      fpo += x.w * room;
    }
    _fpo = fpo < 0 ? 0 : fpo > 1 ? 1 : fpo;
    const fpBase = 1 - _fpo;                     // what is left of the fp side of the base and the overlays

    // ---- specs/0057 §6.2 — THE JIB BASIS, read BEFORE the base slot is written, because the base is
    // ducked by this group's weight. A rail slide REPLACES the ski stance rather than tinting it: at the
    // OVER group's ordinary authority (PropertyMixer's w/(1 + w) — carve_l.py's blend note) a hip-lock
    // shows at half strength and reads as a shrug. The mechanism is not new — it is the `(1 − _land)`
    // the landing tiers already duck the base by, one factor further along — and §4.3 rule (1) is
    // untouched: the slot still SUMS to 1 among itself, and only what reaches the mixer is scaled.
    const railS = mode === 'skis' ? railHook() : null;
    const jibOn = !!railS;
    if (jibOn) _railYaw = angDiff(RAIL_YAW_SIGN * rad(railS.yaw), 0);   // wrapped to (−π, π]
    // the group's own ease: JIB_FADE 0.12 s, on the sim dt like every other weight in this file
    _jib += ((jibOn ? 1 : 0) - _jib) * Math.min(1, dt / JIB_FADE);
    if (_jib < 1e-4 && !jibOn) _jib = 0;
    if (JIB.length && !_jibArmed) {                  // armed together, once — the three loops stay in phase
      _jibArmed = true;
      for (const x of JIB) each(x, (t) => { t.reset(); t.setLoop(THREE.LoopRepeat, Infinity); t.enabled = true; t.paused = false; t.time = 0; t.weight = 0; t.play(); });
    }
    const jibDuck = 1 - (_jib < 0 ? 0 : _jib > 1 ? 1 : _jib);

    // ---- THE LOAD. `pop-load` scrubs on the live lip charge the way the tuck
    // scrubs on the crouch, and takes weight PROPORTIONALLY out of the stance and
    // the tuck — never the tuck alone, so its share stays c·(1 − load) of a slot
    // that still sums to 1 and §3.1's closed form keeps meaning what it means.
    // `PUMP_POSE` is the one gate: at `false` the charge the tree reads is 0, so `pop-load`
    // takes no base weight and `scrubAt` holds it at key 0 (which IS the stance, pop_load.py
    // asserts it), and the pump stops being a pose. ski.js's bank, `pumpLaunchK` and every
    // number the payout is made of are untouched — this is the animation, not the physics.
    const charge = _charge = PUMP_POSE && sk && grounded ? c01((+sk.lipVy || 0) / LIP_MAX) : 0;
    // ---- the base slot's targets. They sum to 1 in every mode, by construction.
    for (const x of BASE) x.t = 0;
    const tuck = stand ? c * g : 0;                // §3.7 / D-19: c·(1 − a), not the bare c
    const load = stand && ch('pop-load') ? charge * g : 0;
    if (footed || mode === 'boots') {              // boots, and any footed gear on the ground
      const loco = ramp(sp, WALK_LO * u, WALK_HI * u), run = ramp(sp, RUN_LO * u, RUN_HI * u);
      if (ch('idle-boots')) ch('idle-boots').t = 1 - loco;
      if (ch('walk')) ch('walk').t = loco * (1 - run);
      if (ch('run')) ch('run').t = loco * run;
    } else if (stand) {                            // skis and the airborne rocket
      if (ch('ski-stance')) ch('ski-stance').t = (1 - tuck) * (1 - load);
      if (ch('ski-tuck')) ch('ski-tuck').t = tuck * (1 - load);
      if (ch('pop-load')) ch('pop-load').t = load;
    } else if (mode === 'bike' && ch('seat-bike')) ch('seat-bike').t = 1;
    else if (mode === 'sled' && ch('seat-sled')) ch('seat-sled').t = 1;
    else if (mode === 'snowmobile' && ch('seat-snowmobile')) ch('seat-snowmobile').t = 1;
    else if (glideAir && ch('prone-glider')) ch('prone-glider').t = 1;
      // A clip the blob does not carry costs its row's target, not the slot's sum:
    // renormalise over what is here and fall back to the first channel rather
    // than let the base go empty (rule 1). Ten of twenty clips are stored today
    // (§8.3), so this is the live path, not a guard.
    let st = 0; for (const x of BASE) st += x.t;
    if (st > 1e-9) { for (const x of BASE) x.t /= st; } else if (BASE.length) BASE[0].t = 1;

    // The tree ARMS on its first step, not at build: no action plays and no bone
    // is written until `rig.update` runs, so C02's rest quats and C21's
    // "only tum-* is loud" read the rig as they did before this block.
    _sum = 0;
    for (const x of BASE) { x.w = _first || (_airEnvelope && !grounded && riding && stand) ? x.t : x.w + (x.t - x.w) * k; _sum += x.w; }
    _first = false;
    if (_sum > 1e-9 && Math.abs(_sum - 1) > 1e-12) { for (const x of BASE) x.w /= _sum; _sum = 1; }
    // specs/0041-W2-DECISIONS §14 / §6.2 C21 — THE BASE SLOT FADES WITH THE TUMBLE.
    // Rule (1) above is unbroken: the base still SUMS TO 1 among itself and each
    // row keeps tracking its own target, so nothing about a mode change moves. What
    // is written to the mixer is that sum times `g`, and §4.4's family is written
    // `a · u_i / Σu` — so base + family = (1 − a) + a = 1 at every instant and the
    // mixer's `weight < 1` bind-pose slerp is never reached. Without this the base
    // keeps the rider skiing through their own wipeout, which is what C21's "the
    // tum-* actions are the only body actions over 0.01" is there to catch.
    // ---- ...AND IT FADES WITH A LANDING. `_land` is the loudest of the four
    // pop/landing one-shots as the mixer last saw them, so a tier reads at the depth
    // it was authored to (a `land-hard` at half weight is a half squat). Scoped to
    // those four: `jump-off`, `air`, `land` and the pole plant are untouched. The fp
    // side takes the SAME `(1 − _land)` and then §3.2a's `fpBase` on top, so both
    // skeletons duck by the same amount and the fp sum stays exactly 1.
    // specs/0057 §6.2 — `jibDuck` joins `(1 − _land)` on the same line and for the same reason.
    const landingDuck = _airEnvelope && !grounded ? 1 : 1 - _land;
    for (const x of BASE) { const wr = x.w * g * landingDuck * jibDuck; put(x, x.w, wr, wr * fpBase); }
    scrubAt(ch('ski-tuck'), c);
    scrubAt(ch('pop-load'), charge);

    // ---- the carve scrub. carve-l IS the left turn (carve_l.py: keys.left →
    // cmd > 0 → carveRoll > 0), which is how `sign(carveRoll)` picks a side.
    const cw = sk ? Math.min(1, Math.abs(carve) / CARVE_FULL) : 0, left = carve > 0;
    for (const n of ['carve-l', 'carve-r']) {
      const x = ch(n); if (!x) continue;
      // specs/0057 §3.1 / 0057-DECISIONS #2 — on a jib the carve is INERT (A/D yaw the skis there), so
      // the pair is ducked by the same `jibDuck` the base takes rather than left to fight the hip-lock.
      x.t = (n === (left ? 'carve-l' : 'carve-r')) ? cw * g * jibDuck : 0;
      x.w += (x.t - x.w) * k;
      scrubAt(x, cw);
      put(x, x.w, x.w * g, x.w * g * fpBase);   // W2-DECISIONS §14 — 0 on the wipe frame, not k-decayed
    }

    // ---- specs/0057 §6.2 — THE BLEND, one dimension. `tri(a, c) = max(0, 1 − |wrap(a − c)| / 90°)` at
    // three nodes, and the ±180° pole folds onto 0 by the wrap so a switch 50-50 costs no clip:
    //   w(jib-bs) = tri(y, −90°)   w(jib-5050) = tri(y, 0°) + tri(y, ±180°)   w(jib-fs) = tri(y, +90°)
    // The ±180° term is not decoration and it is not the wrap: `wrap(180° − 0°)` is 180°, so tri at the
    // 0 node is already zero there and a switch 50-50 on three nodes would blend to NOTHING. The fourth
    // node IS jib-5050 a second time — §6.2's "the ±180° pole reuses jib-5050 through the existing sym
    // mirror flag", the pose being symmetric. With it the weights sum to 1 for EVERY yaw (|wrap| to the
    // two nearest nodes always totals 90°), so the group carries exactly `_jib` of authority however
    // sideways the skis are and the hip-lock changes CONTINUOUSLY through 90°, which is all of D10.
    if (JIB.length) {
      const tri = (cn) => { const d = Math.abs(angDiff(_railYaw, cn)); return d >= JIB_NODE ? 0 : 1 - d / JIB_NODE; };
      const basis = [[ch('jib-bs'), tri(-JIB_NODE)], [ch('jib-5050'), tri(0) + tri(Math.PI)], [ch('jib-fs'), tri(JIB_NODE)]];
      for (const [x, u] of basis) {
        if (!x) continue;
        x.t = _jib * u;
        x.w = x.t;                              // the group's own ease is on `_jib`; the basis is instant
        put(x, x.w, x.w * g, x.w * g * fpBase);
      }
    }

    // ---- skate. A17's pair is one FULL stride each (skate_push_l.py DUR 27 =
    // 0.90 s); §3.5a starts them half a period apart, §4.3 alternates per stride.
    // Both open on the STANCE (key 0), so the hand-off at the loop boundary lands
    // on the pose the base already holds and cannot pop.
    const sL = ch('skate-push-l'), sR = ch('skate-push-r');
    if (sL || sR) {
      if (skating && !_skating) {
        _skating = true; _skateSide = 0; _skateT = 0;
        const arm = (x, ph) => each(x, (t) => { t.reset(); t.setLoop(THREE.LoopRepeat, Infinity); t.enabled = true; t.paused = false; t.time = ph * t.getClip().duration; t.play(); });
        arm(sL, 0); arm(sR, 0.5);
      } else if (!skating && _skating && (!sL || sL.w < 1e-4) && (!sR || sR.w < 1e-4)) _skating = false;
      const lead = _skateSide ? sR : sL;            // the stride boundary is the loop wrap
      if (lead && lead.a) {
        if (lead.a.time < _skateT - 1e-9) { _skateSide ^= 1; each(_skateSide ? sR : sL, (t) => { t.time = 0; }); }
        const now = _skateSide ? sR : sL;
        _skateT = now && now.a ? now.a.time : 0;
      }
      const want = skating ? g : 0;
      for (const n of [0, 1]) {
        const x = n ? sR : sL; if (!x) continue;
        x.t = n === _skateSide ? want : 0;
        x.w += (x.t - x.w) * k;
        put(x, x.w, x.w * g, x.w * g * fpBase);   // W2-DECISIONS §14 — as the carve above
      }
    }

    // ---- the pole plant, on a CARVE ONSET edge (§4.3): |carveRoll| crossing
    // 0.20 rising while grounded on skis, side = the inside edge = sign(carveRoll),
    // re-armed only under 0.10.
    if (sk && grounded) {
      const m = Math.abs(carve);
      if (_poleArmed && m >= POLE_ON) { fire(ch(left ? 'pole-plant-l' : 'pole-plant-r')); _poleArmed = false; }
      else if (!_poleArmed && m < POLE_OFF) _poleArmed = true;
    }

    // ---- branch rider/pump-oneshot — THE PUMP, ONE SHOT ON THE TURN APEX.
    //
    // ski.js's `pumpPhase` is the low-passed sign of d(alignment-to-fall-line)/dt: −1 through the
    // COMPLETION of a turn (the load building, where the bank charges) and +1 through the INITIATION
    // (coming back down). The frame it crosses from one to the other IS the apex, and `turnT − tPeak`
    // says whether the edge load actually peaked there — the same measurement ski.js's `timing` term
    // makes at the transition. Both come off `skiState()` and nothing here writes to it.
    //
    // ARMED by a completion phase, disarmed by the attempt — and then held off until the TURN ITSELF
    // changes. `skiState().turns` is ski.js's own transition counter (`_pumpN`, stepped on the roll
    // sign flip that ends a turn, ski.js:842), so "one visible push per turn" is literally one shot
    // per value of it. Without that clamp the ±0.02 dead band is enough: measured on the carving run,
    // the low-passed phase dips back below zero for a frame or two mid-initiation and the arm/disarm
    // pair alone fired twice in six of nine turns, 0.13–0.28 s apart, the second `fire()` resetting
    // the first clip to frame 0 — one push read as a stutter.
    //
    // `stand && grounded` is the whole airborne story: a pump is a thing you do to snow, the §4.3a air
    // envelope owns the body from take-off to touchdown, and a clip caught in the air by a lip is let
    // go on the take-off edge below rather than left to argue with `air`.
    if (sk && grounded && stand && ch('pump')) {
      const ph = +sk.pumpPhase || 0, turn = +sk.turns || 0;
      if (ph < 0) _pumpArmed = true;
      else if (ph > 0 && _pumpArmed) {
        _pumpArmed = false;
        const tt = +sk.turnT || 0;
        if (turn !== _pumpTurn && tt >= PUMP_MIN_T && Math.abs(tt - (+sk.tPeak || 0)) <= PUMP_WINDOW) {
          _pumpTurn = turn; fire(ch('pump')); _pumpN++;
        }
      }
    } else _pumpArmed = false;

    // ---- the airborne edges, on `ctrl.grounded` and NOT `ctrl.takeEvents()`:
    // camRig.update drained the event object one line before updateVisuals
    // (main.js:2278, :2285) and a second take returns {} (controller.js:1080).
    if (_grounded === null) _grounded = grounded;
    // THE POP FRAME is ski.js's own: `popPaid` goes true on the one frame skiLaunch
    // decides the pop counted (ski.js:1215) — inside `popWindow` 0.16 s before the
    // lip, or `popCoyote` 0.14 s after leaving it. Its RISING edge fires `pop`.
    // Leave the lip without popping and the edge never comes: `jump-off` plays
    // alone and the extension is skipped, a passive air. A coyote pop lands a frame
    // or three into the air, so it releases the `jump-off` it overtakes.
    const paid = !!(sk && sk.popPaid);
    if (_popPaid === null) _popPaid = paid;
    const popNow = paid && !_popPaid && !!ch('pop');
    _popPaid = paid;
    if (!grounded && _grounded) {
      // branch rider/pump-oneshot — a pump that was still playing when the skis left the snow is LET
      // GO here, over `release`'s own 0.12 s. It cannot be fired airborne (the gate above) and it must
      // not be finishing airborne either: the §4.3a envelope owns the leg from take-off to touchdown.
      release(ch('pump'));
      if (popNow) { fire(ch('pop')); _landFired = true; } else fire(ch('jump-off'));
      hold(ch('air'));
    } else if (popNow && !grounded) { release(ch('jump-off')); fire(ch('pop')); _landFired = true; }
    else if (grounded && !_grounded && jibOn) {
      // specs/0057 §2.3 / §6.2 — A RAIL ENTRY FIRES NO TIER. "A rail save fires the JIB group INSTEAD of
      // the landing tier; no tier clip is fired at all" — the slide clip takes the frame, which is what
      // makes D3's save read as a lock-on and not as a stomp that happened to survive. The air loop is
      // still released, because the rider has stopped being airborne whatever else is true.
      release(ch('air'));
      _lastTier = 'jib';
      _lastJudged = (() => { try { const ts = trickState(); return ts ? ts.last : null; } catch { return null; } })();
    } else if (grounded && !_grounded) {
      // THE LANDING, from the impact tier AND the judge's verdict. The tier picks
      // the clip; a SKETCHY verdict LAYERS `land-stagger` on it instead of picking a
      // sixth clip. The verdict is this landing's only when the judge built a fresh
      // `S.last` for it, compared by REFERENCE.
      const n = ctrl && ctrl.groundNormal ? ctrl.groundNormal() : null;
      const impact = _impact = Math.max(0, n ? -(_pv.x * n.x + _pv.y * n.y + _pv.z * n.z) : -_pv.y) / u;
      const tier = !ch('land-soft') || impact < LAND_SOFT ? 'land'
        : impact < LAND_MED ? 'land-soft' : impact < LAND_HARD ? 'land-med' : 'land-hard';
      let judged = null;
      try { const ts = trickState(); judged = ts ? ts.last : null; } catch { judged = null; }
      const sketchy = !!(judged && judged !== _lastJudged && judged.verdict === 'sketchy');
      _lastJudged = judged;
      _lastTier = tier;
      release(ch('air'));
      fire(ch(tier));
      _landFired = true;
      if (sketchy) fire(ch('land-stagger'));
    }
    _grounded = grounded;
    if (ctrl && ctrl.velocity) { const v = ctrl.velocity; _pv.x = v.x; _pv.y = v.y; _pv.z = v.z; }
    // the (1 − a) on the one-shots and the air loop: `.weight` multiplies the
    // live fade interpolant, so this scales the envelope instead of ending it
    // ...and (branch rider/air-stance) THE ONE-SHOTS GET AN ENVELOPE OF THEIR OWN.
    // `phase` gives every LoopOnce row a soft head AND a soft tail off its own clip time; the
    // `air` loop is LoopRepeat and is untouched. See the helper for the two measurements.
    for (const x of SHOT) {
      x.w = 0;
      const takeoffWeight = !grounded && _airEnvelope ? (x.name === 'jump-off' || x.name === 'pop' ? _airEnvelope.jumpOffScale : x.name === 'air' ? _airEnvelope.airScale : 1) : 1;
      if (x.a && x.a.isRunning()) { x.a.weight = g * phase(x.a) * takeoffWeight; x.w = Math.max(x.w, x.a.getEffectiveWeight()); }
      if (x.f && x.f.isRunning()) { x.f.weight = g * fpBase * phase(x.f) * takeoffWeight; x.w = Math.max(x.w, x.f.getEffectiveWeight()); }
    }
    // the ADDITIVE row is outside every sum by construction (§3.3 bit 5), so it takes the
    // tumble's `(1 − a)` and NOT §3.2a's `fpBase` — scaling it by the fp remainder would
    // fold an additive track into a sum it was authored to sit outside of.
    // ---- specs/0057 §5.5 — THE GRAB LAYER, driven by R3's `__grab.state()`. Additive, so it takes no
    // weight from anything: the rider keeps doing whatever the air, the tier or the jib group say, and
    // the grab is a delta over the top. Three edges and nothing else.
    //   1 a NAMED grab while `held` holds its pose clip. The clip's own two keys ARE the 0.10 s fade-in
    //     (GRAB_FADE — see any grab_*.py header), so it is fired ONCE with clampWhenFinished and left
    //     holding; re-firing every step would restart the fade every frame.
    //   2 the RELEASE EDGE — `held` falling, the grab going away, or `releasedAt` moving — fades the
    //     pose out over GRAB_FADE and fires `grab-release`. D13's point is that the let-go plays on the
    //     release and NOT on touchdown, so it runs inside the 0.25 s window it makes legible.
    //   3 the TWEAK is not a clip (§5.5) — it is `_tweak`, eased here and spent in the procedural layer
    //     as ±0.35 rad on the grabbed side's leg-u/leg-l pair.
    {
      const gs = grabHook();
      const key = gs && gs.grab != null ? String(gs.grab).replace(/[^A-Za-z]/g, '').toUpperCase() : '';
      const row = key ? GRAB_ROW.get(key) || null : null;
      const held = !!(gs && gs.held && row && row.x);
      const relAt = gs && gs.releasedAt != null ? +gs.releasedAt : null;
      const relEdge = (_grabHeld && !held) || (relAt !== null && _grabRel !== null && relAt !== _grabRel);
      // fix/stuck-pose — LET GO OF A POSE THE SAME WAY §5.5 WRITES ONE: on `isScheduled()`, never
      // on `isRunning()`. This is the ADD_ALL line at :2531 stating its own rule and this block
      // then breaking it. A grab pose is fired with `clampWhenFinished`, so the frame its 0.14 s
      // clip runs out (tools/rider/bake.mjs:229 — every grab is authored as a 2-key band) three.js
      // sets `paused = true` (AnimationAction._updateTime, the LoopOnce arm), and a PAUSED action
      // reads `isRunning() === false` while it is still scheduled, still weighted by :2531 at `g`,
      // and still on the body. So the release fade-out was a no-op on every grab held longer than
      // 0.14 s — which is every grab anyone flies — and the pose stayed at weight 1 for the rest
      // of the session. That is Greg's "perma stuck in some trick position" (2026-09-06).
      //
      // MEASURED, tools/rider/grab-land-trace.mjs ride `released`, jump-2 Gold Coast: from the
      // touchdown frame on, the tree reports `blend().grab.name ''` and R3 reports `held false` —
      // the BOOKKEEPING released — while `grab-nose` reads w 1.000 for the whole 1.2 s after
      // touchdown and 1.000 still at +1.5 s. `__hitstop.state().ts` is 1.0 on every one of those
      // rows, which is what rules the 0060 dip out. The `nograb` control reads 0.000 throughout.
      //
      // `fadeOut` itself needs no un-pausing: `_updateWeight` runs the fading interpolant against
      // the MIXER clock and is reached for a paused action, so the pose holds its last key while
      // its weight rides GRAB_FADE to zero — which is what "fades the pose out" was always meant
      // to say. Keeping it paused is deliberate: un-pausing would re-run the clip's tail.
      const letGo = (x) => { if (x) each(x, (t) => { if (t.isScheduled()) t.fadeOut(GRAB_FADE); }); };
      if (held && row !== _grabRow) {
        if (_grabRow) letGo(_grabRow.x);
        fire(row.x);
        each(row.x, (t) => { t.clampWhenFinished = true; });
        _grabRow = row;
      } else if (!held && _grabRow) {
        letGo(_grabRow.x);
        _grabRow = null;
      }
      // ...and the CLOSE-OUT, the one the `air` loop already gets thirty lines down for the same
      // reason: a clamped pose is paused, so nothing in this tree retires it on its own. `enabled`
      // is the safe discriminator and `getEffectiveWeight()` alone is not — a pose fired THIS frame
      // still reads 0 until `mixer.update` runs (the `_landFired` trap below), and it is `enabled`;
      // a fade that has actually landed is `enabled === false`, which is `_updateWeight`'s own
      // close on a zero interpolant.
      for (const x of GRAB) each(x, (t) => { if (t.isScheduled() && !t.enabled && t.getEffectiveWeight() <= 1e-6) t.stop(); });
      if (relEdge && LETGO.length) fire(LETGO[0]);
      _grabHeld = held; _grabRel = relAt;
      const want = held && gs && gs.tweak && _grabRow ? _grabRow.side : 0;
      if (want) _tweakSide = want;                   // sticky through the fade-out, or the leg snaps back
      _tweak += ((want ? 1 : 0) - _tweak) * Math.min(1, dt / GRAB_FADE);
      if (_tweak < 1e-4) { _tweak = 0; _tweakSide = 0; }
    }
    // specs/0057 §5.5 — `isScheduled()` and NOT `isRunning()`, procStep write 3's idiom for the same
    // reason it uses it there: a grab pose is HELD by `clampWhenFinished`, which PAUSES the action at
    // its last key — and a paused action is scheduled, weighted and on screen while `isRunning()` reads
    // false for it. Under the old test the six poses would be authored, fired, and never written.
    for (const x of ADD_ALL) { x.w = 0; each(x, (t) => { if (t.isScheduled()) { t.weight = g; x.w = Math.max(x.w, t.getEffectiveWeight()); } }); }
    // ---- branch rider/air-stance — THE FIRE FRAME READS 1 AND MEANS 0. `fire` sets
    // `t.weight = 1` and THEN `fadeIn(0.08)`, and the fade interpolant does not exist until
    // `mixer.update` runs — which is after this function. So on the touchdown frame
    // `getEffectiveWeight()` answers 1 for a tier that will render at 0.2, `_land` goes to 1,
    // and `x.w · g · (1 − _land)` writes the ENTIRE BASE SLOT at zero for that one frame: the
    // stance and the tuck vanish, the air loop is alone on the legs, and the knee snapped
    // −37.0° and back +34.7° in two frames. That is the "legs teleporting down". `_landFired`
    // is that frame and only that frame; from the next one the fade is real and `_land` is
    // the honest read it always was.
    _land = 0;
    if (_landFired) _landFired = false;
    else for (const n of ['pop', 'land-soft', 'land-med', 'land-hard']) { const x = ch(n); if (x && x.w > _land) _land = x.w; }
    if (_land > LAND_DUCK) _land = LAND_DUCK;
    const air = ch('air');                         // the air loop closes itself once the 0.12 s fade-out has run
    if (air && air.out && air.a && air.a.getEffectiveWeight() <= 1e-6) each(air, (t) => t.stop());
    return _sum;
  };

  // ------------------------------------ §4.5 THE POST-MIXER PROCEDURAL LAYER
  // Five bone writes in §4.5's order, bone-local, between mixer.update and
  // updateMatrixWorld (N17); 1, 2 and 5 take `1 − a`. 1–4 COMPOSE onto the clip
  // (`quaternion.multiply`) — an assignment discards it; 5 is the one slerp-to-rest
  // and is DROPPED, not widened, when its bones are not disjoint from the tuck's
  // and the carve's. Write 6 is already on `fp.onBeforeRender` above (the world
  // copy main.js:1419-1420 uses). AFTER the mixer because PropertyMixer.apply
  // slerps toward the BIND pose while cumulative weight < 1 (three.core.js:51014):
  // a write before it would be taken for the original and partly restored.
  const LOOK = [0.6, 0.3], LOOK_K = 6, LOOK_SHARE = [0.4, 0.6];  // ±yaw, ±pitch; min(1, 6·dt); neck/head — 0.6 rad on ONE joint at 1.52 u is an owl
  const YAW_GAIN = 0.05, YAW_CLAMP = 0.15, SPINE = [0.4, 0.6];   // w2 — yawRate · 0.05, clamped, split over spine-1/2
  const POLE_CLAMP = 0.5, DECK = 0.6 * 0.5, BREATH_K = 0.7;      // w3 rad from the clip pose · w4 deckRoll·0.6 split 0.5 · w5 slerp(rest, 0.7·spN)
  // main.js:780's angDiff, copied not imported: main.js imports THIS file (:13).
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const cAbs = (v, m) => (v < -m ? -m : v > m ? m : v);
  const pb = (n) => arm.byName[n] || null;
  const bLook = [pb('rider:neck'), pb('rider:head')], bSpine = [pb('rider:spine-1'), pb('rider:spine-2')];
  const bPole = [pb('rider:pole-l'), pb('rider:pole-r')];
  const BREATH = ['rider:spine-1', 'rider:spine-2', 'rider:shoulder-l', 'rider:shoulder-r'].map(pb).filter(Boolean);
  // w5's gate, decided once at build — the runtime half of the rule the bake
  // asserts offline, and drop-rung 1 of §4.9 in any case.
  const keyed = (n) => (actions.get(n) ? actions.get(n).getClip().tracks : []).map((t) => (/^\.bones\[(.+)\]\./.exec(t.name) || [0, ''])[1]);
  const claimed = new Set([...keyed('ski-tuck'), ...keyed('carve-l'), ...keyed('carve-r')]);
  const breathOn = BREATH.length === 4 && !BREATH.some((b) => claimed.has(b.name));
  const restQ = BREATH.map((b) => b.quaternion.clone());   // identity by §2.3 / C02 — read, not assumed
  // w3's tip in POLE-BONE space: one direction from the bone head, D = (0,
  // −cos 0.55, +sin 0.55) over LEN 0.72 (gen/parts/poles.py:42,44); the pitch is
  // about the bone's own x, the axis poles.py:26 names for this layer.
  const TIP = new THREE.Vector3(0, -0.8525245, 0.5226872).multiplyScalar(0.72 * u);
  const XA = new THREE.Vector3(1, 0, 0), YA = new THREE.Vector3(0, 1, 0), ZA = new THREE.Vector3(0, 0, 1);
  const _q = new THREE.Quaternion();
  // every input read ONCE per frame, so rig.cost drives the same writes (§4.9)
  let _pYaw = 0, _pPitch = 0, _pSpN = 0, _pGnd = true, _pGY = 0, _pDeck = 0;
  let _lookY = 0, _lookP = 0, _yawPrev = NaN, _yawRate = 0, _wrote = 0;
  const procRead = (ctrl, camRig, o, force) => {
    _pGnd = force || !ctrl || !!ctrl.grounded;
    // A23 hands both look scalars down from updateVisuals; until then the same two
    // expressions run here — model.rotation.y IS yawRide (main.js:1476-1478),
    // ctrl.pitch main.js:2336's. The clamp is the contract either way.
    _pYaw = o.lookYaw !== undefined ? +o.lookYaw || 0 : (ctrl ? angDiff(+ctrl.yaw || 0, model.rotation.y) : 0);
    _pPitch = o.lookPitch !== undefined ? +o.lookPitch || 0 : (ctrl ? +ctrl.pitch || 0 : 0);
    _pSpN = camRig && camRig.state ? c01(+camRig.state.spN || 0) : 0;
    // the ground under the hand: the body root IS the contact point (the rest sole
    // sits 0.03 u over it), stale by the one frame this layer leads updateMatrixWorld
    _pGY = o.groundY !== undefined ? +o.groundY || 0 : model.matrixWorld.elements[13];
    _pDeck = ctrl && ctrl.mode === 'sled' ? +sledState().deckRoll || 0 : 0;
  };
  // w3 in closed form, never iterated: with M the bone's world matrix and m11/m12
  // the y of its images of local +y/+z, the tip's world y under a pitch θ about
  // local x is headY + A·cos θ + B·sin θ — one atan2, one acos. M is LAST frame's,
  // so the solve chases over two or three frames rather than landing in one, and
  // out of reach it holds the pole at its lowest y instead of giving up.
  const poleTip = (b, w) => {
    if (!b || !(w > 1e-4)) return;
    const e = b.matrixWorld.elements, A = e[5] * TIP.y + e[9] * TIP.z, B = e[9] * TIP.y - e[5] * TIP.z;
    const r = Math.sqrt(A * A + B * B);
    if (r < 1e-9) return;
    const ac = Math.acos(cAbs((_pGY - e[13]) / r, 1)), phi = Math.atan2(B, A);   // out of reach: the closest the pole gets
    let th = angDiff(phi + ac, 0); const t2 = angDiff(phi - ac, 0);
    if (Math.abs(t2) < Math.abs(th)) th = t2;    // the nearer of the two arms
    th = cAbs(th, POLE_CLAMP) * w;
    _wrote += Math.abs(th);
    b.quaternion.multiply(_q.setFromAxisAngle(XA, th));
  };
  // the layer: five writes over nine bones, no allocation.
  const procStep = (dt, g) => {
    _wrote = 0;
    const k = Math.min(1, LOOK_K * dt);
    // 1 — the look, neck 0.4 / head 0.6: 0.6 rad on one joint at 1.52 u is an owl,
    // and the split keeps this write off the counter-yaw's toes.
    _lookY += (cAbs(_pYaw, LOOK[0]) - _lookY) * k;
    _lookP += (cAbs(_pPitch, LOOK[1]) - _lookP) * k;
    for (let i = 0; i < 2; i++) {
      const b = bLook[i], sh = LOOK_SHARE[i] * g; if (!b) continue;
      _wrote += Math.abs(_lookY * sh) + Math.abs(_lookP * sh);
      b.quaternion.multiply(_q.setFromAxisAngle(YA, _lookY * sh)).multiply(_q.setFromAxisAngle(XA, _lookP * sh));
    }
    // 2 — the torso counters the steer: an INPUT RATE, which no clip can key.
    if (dt > 1e-9) _yawRate += (angDiff(_pYaw, Number.isNaN(_yawPrev) ? _pYaw : _yawPrev) / dt - _yawRate) * k;
    _yawPrev = _pYaw;
    const cy = -cAbs(_yawRate * YAW_GAIN, YAW_CLAMP) * g;   // COUNTER: the chest lags the hips into the turn
    // 3 — the tip on the snow while a plant is live and grounded. `planted` IS the
    // one-shot's envelope, which getEffectiveWeight reports. `isScheduled` and NOT
    // `isRunning`, rig.weights()'s idiom: a PAUSED action is scheduled, weighted
    // and on screen, and isRunning is false for it — which would take this write
    // off every pose the harness scrubs to.
    if (_pGnd) for (let i = 0; i < 2; i++) {
      const x = ch(i ? 'pole-plant-r' : 'pole-plant-l');
      poleTip(bPole[i], Math.min(1, x && x.a && x.a.isScheduled() ? x.a.getEffectiveWeight() : 0));
    }
    // 4 — the sled's steer roll (§10.8). Not on `1 − a`: a rider mid-tumble is off
    // the deck and deckRoll went with them (sled.js:240's `ctx.grounded` factor).
    for (let i = 0; i < 2; i++) {
      const b = bSpine[i]; if (!b) continue;
      const z = _pDeck * DECK, y = cy * SPINE[i];
      if (y) { _wrote += Math.abs(y); b.quaternion.multiply(_q.setFromAxisAngle(YA, y)); }
      if (z) { _wrote += Math.abs(z); b.quaternion.multiply(_q.setFromAxisAngle(ZA, z)); }
    }
    // 5 — the breathing scale, the table's one slerp: the clip's whole deviation
    // from rest on these four bones IS the breath, so 0.7·spN back toward rest is
    // that amplitude going quiet as the speed comes up.
    const t = breathOn ? BREATH_K * _pSpN * g : 0;
    if (t > 1e-6) for (let i = 0; i < BREATH.length; i++) { _wrote += t; BREATH[i].quaternion.slerp(restQ[i], t); }
    // 6 — specs/0057 §5.5 THE TWEAK, a write and not a clip because §5.5 is explicit that "A tweak is
    // NOT a clip": one pose at weight 1 plus a procedural ±0.35 rad extension on the GRABBED SIDE's
    // leg-u/leg-l pair. Six poses therefore cover six grabs AND every tweak, which is why §6.3's clip
    // block fits. It COMPOSES onto the clip (`quaternion.multiply`, the table's rule) and rides `1 − a`
    // like writes 1, 2 and 5 — a rider mid-wipeout is not tweaking. The pair is opposed (+ thigh, − shin)
    // so the leg BONES OUT at the knee rather than the whole leg swinging.
    const tw = _tweak * g;
    if (tw > 1e-6 && _tweakSide) {
      const sfx = _tweakSide < 0 ? 'l' : 'r';
      for (const [n, s] of [[`rider:leg-u-${sfx}`, 1], [`rider:leg-l-${sfx}`, -1]]) {
        const b = pb(n); if (!b) continue;
        _wrote += GRAB_TWEAK * tw;
        b.quaternion.multiply(_q.setFromAxisAngle(XA, s * GRAB_TWEAK * tw));
      }
    }
    return _wrote;
  };

  // §2.2 — the A-pose lives in the bone HEADS (C05) and every rest rotation is
  // identity (C02). `rig.armL/armR` survive only because `main.js:334` still
  // destructures them and writes `rotation.z = ±0.22` every frame (§4.6, A23):
  // on the baked mesh that would DOUBLE the A-pose, so until A23 removes both
  // ends they are detached sinks nothing renders. `head` stays the bone (§4.5).
  const armL = new THREE.Object3D(), armR = new THREE.Object3D(), head = arm.byName['rider:head'];
  model.updateMatrixWorld(true);

  const rig = { model, armL, armR, head, parts, mixer, skeleton: arm.skeleton, poles, setPoles, fp, fpMixer, fpPoles, setFp,
    outfit: '', look: PARTS.map(() => 'g00'), mats,
    outfits: OUTFITS.map(({ code, house, name, family }) => ({ code, house, name, family })) };
  rig.polish = alpinePolish ? buildAlpinePolish(THREE, rig, u) : null;
  if (rig.polish) maskAlpineBase(rig);
  if (rig.polish) maskAlpineLayers(rig);
  rig.bone = (name) => arm.byName[name] || null;
  if (rig.polish) rig.polish.stance = createRiderStance(THREE, rig, u);
  // specs/0046 §3.6 — the shadow's handle. `setShadow` flips the renderer flag and
  // the disc together, which is the pair N29 measures the frame-time delta across;
  // it is a no-op on §4.6's low tier, where no caster was ever built.
  rig.shadow = () => _shadow;
  rig.setShadow = (on) => {
    if (!_shadow || !_shadow.renderer) return false;
    _shadow.renderer.shadowMap.enabled = !!on;
    _shadow.disc.visible = !!on;
    return !!on;
  };
  // N29 — the median frame-time delta between shadows on and shadows off, over `n`
  // frames. It does NOT time `requestAnimationFrame`: the page's loop is
  // vsync-locked, every interval is 16.7 ms whatever the renderer does, and a
  // vsync-timed delta is 0.0000 ms on a scene that is 8 ms over budget as loudly
  // as on one that is free. So it renders the frame itself, `n` times, and blocks
  // on `gl.finish()` after each — the GPU is asynchronous and a CPU-side
  // `render()` return says only that the commands were queued.
  //
  // Four alternating blocks rather than one on-run and one off-run, so a thermal
  // or scheduler drift over the sample lands on both sides instead of on the
  // answer. The trimmed mean over the middle half is what is reported: a browser
  // hands out a compositor hitch every few hundred frames and one 40 ms outlier is
  // not what §3.6 is asking about.
  rig.shadowCost = (n = 600) => {
    const s = _shadow;
    if (!s || !s.renderer || !_scene || !_camera) return null;
    const r = s.renderer, gl = r.getContext();
    const on = [], off = [], block = Math.max(4, Math.round(n / 4));
    for (let b = 0; b < 4; b++) {
      const want = (b & 1) === 0;
      rig.setShadow(want);
      for (let i = 0; i < block; i++) {
        const t0 = performance.now();
        r.render(_scene, _camera);
        gl.finish();
        if (i >= 4) (want ? on : off).push(performance.now() - t0);   // the first 4 are the switch settling
      }
    }
    rig.setShadow(true);
    const mid = (a) => { const q = a.slice().sort((x, y) => x - y).slice(a.length >> 2, a.length - (a.length >> 2)); return q.reduce((p, v) => p + v, 0) / (q.length || 1); };
    return { deltaMs: +(mid(on) - mid(off)).toFixed(4), onMs: +mid(on).toFixed(4), offMs: +mid(off).toFixed(4), frames: on.length + off.length };
  };
  // specs/0056 §6.6 — what the snow layer costs, on the same rig and by the same
  // method: four alternating blocks of direct `render()` with `gl.finish()`, the
  // first four frames of each block thrown away as the switch settling. The ONLY
  // thing that moves is `uSnow` — same program either way, since §2's block is
  // inside `if (uSnow > 0.0)` — so the delta is that branch's own cost and not a
  // shader swap. A rAF-timed A/B cannot answer this: a paused headless page runs
  // its animation frames at about 1 Hz and measures the throttle.
  // NOT on `__rig`: C13 asserts that handle's key set against a declared baseline,
  // and a probe is not worth a gate edit. `__rig.rigOf(play:body).snowCost(n)`
  // reaches it — see renders/tumble/_cost56.mjs.
  rig.snowCost = (n = 400) => {
    const s = _shadow;
    if (!s || !s.renderer || !_scene || !_camera) return null;
    const r = s.renderer, gl = r.getContext(), was = _snowU.value;
    const on = [], off = [], block = Math.max(4, Math.round(n / 4));
    for (let b = 0; b < 4; b++) {
      const want = (b & 1) === 0;
      _snowU.value = want ? 1 : 0;
      for (let i = 0; i < block; i++) {
        const t0 = performance.now();
        r.render(_scene, _camera);
        gl.finish();
        if (i >= 4) (want ? on : off).push(performance.now() - t0);
      }
    }
    _snowU.value = was;
    const mid = (a) => { const q = a.slice().sort((x, y) => x - y).slice(a.length >> 2, a.length - (a.length >> 2)); return q.reduce((p, v) => p + v, 0) / (q.length || 1); };
    return { deltaMs: +(mid(on) - mid(off)).toFixed(4), onMs: +mid(on).toFixed(4), offMs: +mid(off).toFixed(4), frames: on.length + off.length };
  };

  // §4.2 — the clock is `simTime`, never wall time, differenced here: 0 while
  // paused or in the locker, one n·dt step out of `stepFixed`. Per-frame order
  // is fixed and N17 asserts it: mixer.update(dt) → the procedural writes (§4.5)
  // → updateMatrixWorld — a bone written BEFORE the mixer is partially restored
  // by PropertyMixer.apply's bind-pose blend whenever cumulative weight < 1.
  let _t = 0;
  const _ord = ['', '', ''];
  let _oi = 0, _pcOn = false;                       // N17's three slots, and whether _pc has been filled
  const _pc = { ctrl: null, camRig: null, o: null }; // the last live inputs, reused by rig.cost (§4.9) — no per-frame allocation
  const mark = (s) => { if (_oi < 3) _ord[_oi++] = s; };
  rig.update = (simTime, ctrl, camRig, tum, o = {}) => {
    const dt = simTime - _t;
    _t = simTime;
    // specs/0046 §3.6 — the shadow caster and the contact disc follow the rider,
    // here rather than in an `onBeforeRender`, because the shadow DEPTH pass runs
    // before the main pass and an object hook fires too late to place the light.
    if (_shadow) _shadow.follow();
    // §2.6 — poles: skis, third person, never on a rack (§4.7's `mount`);
    // §2.5 / §4.7 — the fp rig: first person on skis or the bike, its poles on skis
    if (poles) poles.visible = !!ctrl && ctrl.mode === 'skis' && !o.mount && !(camRig && camRig.mode === 'fp');
    fp.visible = !!ctrl && !!camRig && camRig.mode === 'fp' && (ctrl.mode === 'skis' || ctrl.mode === 'bike');
    for (const pm of fpPoles) pm.visible = ctrl.mode === 'skis';
    // §4.4 — the family's weights are a function of `tum` alone, set BEFORE the
    // mixer runs (no smoothing: `auth` is already the tumble's envelope)
    const a = tumbleFamily(tum);
    // §4.3 — the blend tree, read once and written to `action.weight` BEFORE the
    // mixer runs. Its own dt is this one, so the base slot, the scrubs and the
    // one-shot envelopes are all on the sim clock and none of them advances while
    // `paused(true)` holds `simTime` (§4.2 fall-out 1).
    blendStep(dt, ctrl, camRig, tum, o);
    // N17 — the three calls, INSTRUMENTED and in this order. `_ord` is a fixed
    // three-slot array written in place, so the check costs three stores and no
    // allocation; `rig.order()` reads it through rigOf(body), never a new __rig
    // key (C13). A procedural write BEFORE the mixer is silently blended toward
    // the bind pose (§4.2), which is the whole reason the order is a check.
    _oi = 0;
    rig.polish?.stance.restore();
    mark('mixer'); mixer.update(dt); fpMixer.update(dt);
    // §4.5 — the layer, on the bones the mixer just wrote and nothing else.
    mark('proc'); procRead(ctrl, camRig, o, false); procStep(dt, 1 - a);
    rig.polish?.stance.update(dt, ctrl, camRig, tum, o);
    mark('world'); model.updateMatrixWorld(true);
    if (rig.polish?.drape) rig.polish.drape.update(dt);
    _pc.ctrl = ctrl; _pc.camRig = camRig; _pc.o = o; _pcOn = true;
    return rig;
  };
  // N17's readout — the order the last `rig.update` ran the three calls in, and
  // Σ|rad| the layer put on top of the mixer. Read through rigOf(body) like
  // rig.tumble() and rig.blend(), never a new __rig key (C13).
  rig.order = () => ({ seq: _ord.slice(0, _oi), wrote: _wrote, breathing: breathOn });
  // §4.9 / N8 — the per-frame cost of mixer + the §4.5 procedural layer +
  // updateMatrixWorld, MEASURED not extrapolated: the design's 15–17 µs came from
  // cost-estimate.mjs in node, which has no bone texture and no driver. `n`
  // isolated calls at a fixed dt with the rig held in the tp ski ride pose — base
  // + tuck + carve + one one-shot, the four-action worst case that is not a
  // tumble. MICROSECONDS, §4.9's unit, with the ms twin so neither reader is
  // misled. The locker mannequin is measured separately and is NOT in this.
  const COST_SET = [['ski-stance', 0.55, -1], ['ski-tuck', 0.45, 0.5], ['carve-l', 0.5, 1], ['pole-plant-l', 0.5, -1]];
  rig.cost = (n = 600, { dt = 1 / 60 } = {}) => {
    // save every action's state, pin the four, measure, put it all back: cost()
    // is called on a LIVE page between two frames and must not leave a pose behind
    const all = [...actions.values(), ...fpActions.values()];
    const was = all.map((t) => ({ t, w: t.weight, e: t.enabled, p: t.paused, tm: t.time, r: t.isRunning(), l: t.loop, rep: t.repetitions }));
    const froze = _frozen; _frozen = true;          // blendStep cannot unwind the set (§4.1's freeze)
    for (const t of all) { t.weight = 0; t.stop(); }
    let live = 0;
    for (const [name, w, phase] of COST_SET) {
      const x = ch(name); if (!x) continue;
      live++;
      each(x, (t) => {
        t.reset(); t.enabled = true; t.weight = w; t.play();
        if (phase >= 0) { t.paused = true; t.time = phase * t.getClip().duration; } else t.paused = false;
      });
    }
    if (_pcOn) procRead(_pc.ctrl, _pc.camRig, _pc.o, true);   // grounded forced: write 3 must be IN the worst case
    const s = new Float64Array(n);
    const w0 = performance.now();
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      mixer.update(dt);
      procStep(dt, 1);
      model.updateMatrixWorld(true);
      s[i] = (performance.now() - t0) * 1000;       // µs
    }
    // `mean` brackets the WHOLE run: performance.now() is coarsened to 100 µs on a
    // page that is not cross-origin-isolated, which quantises every per-frame
    // sample to 0 or 100 — the median stays true and stops being informative.
    const mean = (performance.now() - w0) * 1000 / n;
    s.sort();
    for (const r of was) { r.t.stop(); r.t.setLoop(r.l, r.rep); r.t.weight = r.w; r.t.enabled = r.e; r.t.paused = r.p; r.t.time = r.tm; if (r.r) r.t.play(); }
    _frozen = froze;
    mixer.update(0); fpMixer.update(0);
    const median = s[Math.floor(n / 2)], p95 = s[Math.min(n - 1, Math.floor(n * 0.95))];
    return { median, p95, mean, n, actions: live, unit: 'us', medianMs: median / 1000, meanMs: mean / 1000 };
  };
  rig.clipNames = () => [...new Set([...actions.keys(), ...fpActions.keys()])];
  rig.weights = () => { const o = {}; for (const [k, a] of actions) o[k] = a.isScheduled() ? a.getEffectiveWeight() : 0; return o; };   // §6.2 C21: the MIXER's weight
  // §4.4 / N11 — the family this frame: raw u, normalised w, Σu, Σw (== a to
  // 1e-6); the harness reads it through rigOf(body), never a new __rig key (C13)
  rig.tumble = () => ({ live: familyLive, sum: familySum,
    weight: family.reduce((s, f) => s + f.w, 0),
    family: family.map((f) => ({ name: f.name, u: f.u, w: f.w })) });
  // a stable hash of every bone quaternion — cheap to compare across two boots
  rig.pose = () => {
    let h = 2166136261;
    for (const b of rig.skeleton.bones) for (const v of [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]) {
      h ^= Math.round(v * 10000) + 32768; h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  // §4.3 — the tree this frame: Σ across the base (N11 wants ≥ 0.999 on EVERY
  // frame), the crouch it read, and every channel's weight against its target.
  // Read through rigOf(body) like rig.tumble(), never a new __rig key (C13).
  rig.blend = () => ({ sum: _sum, frozen: _frozen, crouch: _crouch, skating: _skating, fp: _fpo, air: _airEnvelope ? { ..._airEnvelope } : null,
    // what the last touchdown chose, where the harness already reads the tree
    // (rigOf(body).blend(), never a new __rig key — C13).
    land: _land, tier: _lastTier, impact: _impact, charge: _charge, pumpN: _pumpN,
    // specs/0057 §6.2 / §5.5 — the park set, reported HERE and not on a new __rig key (C13). `yaw` is
    // the basis input in radians as the tree read it; `grab` the pose row's clip name or ''.
    jib: { w: _jib, yaw: _railYaw, duck: 1 - _jib },
    grab: { name: _grabRow ? _grabRow.name : '', held: _grabHeld, tweak: _tweak, side: _tweakSide },
    base: BASE.map((x) => ({ name: x.name, w: x.w, t: x.t })),
    over: [...OVER, ...SHOT, ...ADD_ALL, ...JIB, ...FPO, ...FPSHOT].map((x) => ({ name: x.name, w: x.w, t: x.t })) });
  // §4.1 — true when every base / scrub / overlay weight is within 1e-4 of its
  // target AND the camera's crouch has stopped moving. `wantCrouch` is
  // closure-private (main.js:1213), so `|c − wantCrouch|` is read off c's OWN
  // step: camRig eases at min(1, 5·dt) on WALL dt, so |Δc| ≤ 5e-6 over a 60 Hz
  // frame is ≤ 6e-5. The cap resolves false rather than hang `rest()` (:166).
  rig.settled = () => new Promise((res) => {
    let n = 0, prev = NaN;
    const step = () => {
      let dw = 0;
      for (const x of [...BASE, ...OVER]) dw = Math.max(dw, Math.abs(x.t - x.w));
      const dc = Math.abs(_crouch - prev); prev = _crouch;
      if (n > 0 && dw <= 1e-4 && dc <= 5e-6) return res(true);
      if (++n >= 120 || typeof requestAnimationFrame !== 'function') return res(dw <= 1e-4);
      requestAnimationFrame(step);
    };
    step();
  });
  // §4.1 — nothing but this can drive the tuck scrub: `camRig.state.crouch` is
  // closure-private and `__player.crouch()` is the controller's value, not the
  // camera's. It returns false while there is no such clip rather than throwing.
  // ONE slot: `setScrub(null)` releases it, or a held scrub stays loud (C21).
  // It also FREEZES the blend (§4.1): while a scrub is held `blendStep` touches
  // no weight, so the pose asked for is the pose on screen. `setScrub(null)`
  // releases both the slot and the freeze.
  let held = [];
  rig.setScrub = (name, c) => {
    for (const x of held) if (x) x.stop();
    // the held clip is measured ALONE (C08's five tuck values, A17's contact
    // sheet): a base still at 1 would have PropertyMixer normalise the answer to
    // half a scrub. Releasing re-arms the tree, so Σ is back at 1 on the next step.
    _frozen = !!name; _first = !name;
    // specs/0057 §6 — the park rows join the stop list: `setScrub` measures ONE clip alone (C08), and a
    // held jib loop or a clamped grab pose would layer over the very frame the contact sheet is taking.
    for (const x of [...BASE, ...OVER, ...SHOT, ...ADD_ALL, ...JIB]) { x.w = 0; each(x, (t) => { t.weight = 0; t.stop(); }); }
    _land = 0; _jib = 0; _jibArmed = false; _grabRow = null; _grabHeld = false; _grabRel = null; _tweak = 0; _tweakSide = 0;
    held = [actions.get(name), fpActions.get(name)];
    // weight 1 EXPLICITLY: the tree has been writing `.weight` on this very
    // action, so `play()` alone would re-schedule it at whatever the base left.
    for (const x of held) if (x) { x.enabled = true; x.weight = 1; x.play(); x.paused = true; x.time = c * x.getClip().duration; }
    mixer.update(0); fpMixer.update(0);
    return !!(held[0] || held[1]);
  };

  rig.setOutfit = (v, { remember = true } = {}) => {
    const l = mergeLook(rig.look, v), str = serialise(l);
    const p = paint(str, THREE, { mesh });
    // §4.1 — all FOUR materials, not one `mat`: the texture objects are paint()'s
    // cache and are shared, so this is four `wearMaps`, never four sets of canvases.
    // specs/0046 §3.3 — `wearMaps` writes the five whole-material scalars in the
    // same call, which is why sheen and anisotropy cost five assignments and no
    // bytes of texture.
    for (const m of mats) if (!m.userData.fpvPolish) wearMaps(m, p);
    // specs/0046 §4.4 — the aura is the glow channel, READ, not a new authoring
    // surface: a look that declares no `glow` gets strength 0.30 (a soft lift on
    // the brightest specular) and one with a `glow: 1.0` op gets 1.20. `radius` is
    // fixed at 0.55 so C15's 24 px halo dilation is a constant (§6.5). These are
    // C4's three lines, seeded here per §8.3 so C4 never opens this file's
    // material block; the guard is what lets rider.js ship before rig/bloom.js does.
    const bl = Math.min(1.2, Math.max(0.3, 0.3 + 0.9 * (p.maxGlow - GLOW0) / 0.549)) * p.scalars.bloom;
    if (typeof window !== 'undefined' && window.__riderBloom) window.__riderBloom.set({ strength: bl, threshold: 0.62, radius: 0.55 });
    const flags = mergeFlags(l);
    applyFlags(toggles, flags);
    if (rig.polish) {
      maskAlpineLayers(rig);
      if (rig.polish.goggles) rig.polish.goggles.visible = flags.goggles !== false;
    }
    rig.outfit = str; rig.look = l; _worn = str;
    if (remember) rememberOutfit(str);
    return str;
  };
  rig.setOutfit(outfit, { remember: false });
  // §4.8 — the locker mannequin plays ONE body clip at weight 1 on a mixer of
  // its own, and `cloneRig` hands it bones, not clips. Parking the body clips on
  // `play:body` is three's own convention (a loader leaves them on the scene it
  // loaded) and it is what makes them clone-safe: `Object3D.copy` slices
  // `animations` (`three.core.js:14721`), so the cloned group arrives carrying
  // these very AnimationClip objects and `inventory.js` decodes nothing a second
  // time. The fp clips stay off the list — their tracks name `rider:fp-*` bones
  // the mannequin's skeleton does not have.
  model.animations = dc.clips.filter((c) => c.userData.rig !== 'fp');
  // The W0 bridge (`model.clone = () => cloneRig(rig).model`) is GONE with
  // §0.1's `inventory.js:1329` edit: the locker swaps the stale `play:body` for
  // `cloneRig(rigOf(model))` itself now, in the open and before any traverse,
  // rather than through a `clone` that answered with something a caller reading
  // three's docs would not expect.
  _rigs.set(model, rig);
  installRigProbe(rig);
  return rig;
}
