// The fill kit. annotations.md is unusually specific about what belongs in this
// sector, and just as specific about what does NOT:
//
//   "Man-made kit on the upper ridge is ONLY the signage/closure furniture:
//    Sun Bowl's red warning boards + rope line, Headwall knoll signboard,
//    North Bowl gate, terminal snow fencing."
//
// So there are no lodges up here, no lift maze, no parking, no race venue —
// nothing that is not in a photograph. What there IS a lot of is GRANITE, and
// it gets the geometry: blocky ribs with ledges, not lumpy cones.
//
// Everything is a flat vertex-coloured buffer built once and instanced or
// merged — no textures except the sign/terminal lettering canvases in signs.mjs.

import {
  buf, tri, quad, box, tube, prism, plate, makeRng, rr, ri, pick,
  lin, mixc, scalec, jitc, clamp, lerp, smooth, snowLace,
} from './lib/core.mjs';

export const PAL = {
  bark:     lin(0x322820), barkRed: lin(0x46331f), barkPale: lin(0x6a5949),
  needle:   lin(0x1b3124), needleLo: lin(0x122119), needleHi: lin(0x2b4d34),
  pineGrn:  lin(0x243d2b),
  snow:     lin(0xeef4fd), snowLo: lin(0xbccee6),
  // near-black granite streaked pale grey — annotations.md's palette entry,
  // and what views 4 / 19 / 20 show from three different vantages
  rock:     lin(0x3c392f), rockLo: lin(0x26241d), granite: lin(0x8d8471),
  rockPale: lin(0xa79d88), lichen: lin(0x4c4e3c),
  scree:    lin(0x7d7464), screeLo: lin(0x555142),
  steel:    lin(0x9aa2a8), steelLo: lin(0x6d757c), galv: lin(0xb6bcc0),
  dark:     lin(0x1d2024), black: lin(0x0f1113),
  white:    lin(0xeef1f4), offWhite: lin(0xd8dde2),
  red:      lin(0xc32026), redLo: lin(0x8e1418),
  yellow:   lin(0xe0b422), orange: lin(0xe07422), blue: lin(0x2c62b4),
  green:    lin(0x2f8a44),
  timber:   lin(0x5a4634), timberLo: lin(0x3d2f22), stucco: lin(0xc9b391),
  roof:     lin(0x33353a), glass: lin(0x28374a),
  jacket:   [lin(0xd2402f), lin(0x2f6fd2), lin(0xe0b422), lin(0x27a35a), lin(0xe8e8ea), lin(0x8b3fbc)],
};

// ------------------------------------------------------------------- trees
export function firGeo(seed, { h = 24, tiers = 6, sides = 7, lean = 0.05, flock = 0.34, lite = false } = {}) {
  const rng = makeRng(seed);
  const B = buf();
  const R = h * rr(rng, 0.070, 0.096);
  const bare = h * rr(rng, 0.16, 0.27);
  const tilt = [rr(rng, -lean, lean), rr(rng, -lean, lean)];
  const bark = jitc(rng() < 0.35 ? PAL.barkRed : PAL.bark, rng, 0.16);
  const trunkTop = [tilt[0] * h, tilt[1] * h, h * 0.99];
  if (lite) {
    tube(B, [0, 0, 0], trunkTop, R * 0.28, bark, 3, R * 0.04);
  } else {
    tube(B, [0, 0, 0], [tilt[0] * h * 0.5, tilt[1] * h * 0.5, h * 0.55], R * 0.30, bark, sides > 5 ? 5 : 4, R * 0.16);
    tube(B, [tilt[0] * h * 0.5, tilt[1] * h * 0.5, h * 0.55], trunkTop, R * 0.16, bark, 4, R * 0.03);
  }
  const needle = mixc(PAL.needle, rng() < 0.4 ? PAL.pineGrn : PAL.needleLo, rng());
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const z0 = bare + (h - bare) * f * 0.92;
    const rad = R * (1.42 - 1.14 * f) * rr(rng, 0.88, 1.12);
    const hh = (h - bare) / tiers * rr(rng, 1.7, 2.3);
    const cx = tilt[0] * z0, cy = tilt[1] * z0;
    const apex = [cx + tilt[0] * hh, cy + tilt[1] * hh, z0 + hh];
    const col = mixc(needle, PAL.needleHi, 0.05 + 0.34 * f);
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + t * 0.7;
      const rj = rad * (0.78 + 0.34 * ((i * 7 + t * 3) % 5) / 5);
      ring.push([cx + Math.cos(a) * rj, cy + Math.sin(a) * rj, z0 - hh * 0.14]);
    }
    for (let i = 0; i < sides; i++) tri(B, ring[i], ring[(i + 1) % sides], apex, scalec(col, 0.82), col, col);
  }
  snowLace(B, { snow: PAL.snowLo, lo: 0.30, hi: 0.86, amount: flock, patchy: 0.55, seed: seed + 7 });
  return B;
}

export function snagGeo(seed, { h = 15 } = {}) {
  const rng = makeRng(seed);
  const B = buf();
  const c = jitc(PAL.barkPale, rng, 0.25);
  tube(B, [0, 0, 0], [rr(rng, -0.6, 0.6), rr(rng, -0.6, 0.6), h], h * 0.045, c, 4, h * 0.012);
  for (let i = 0; i < 3; i++) {
    const z = h * rr(rng, 0.45, 0.9), a = rr(rng, 0, 6.28), L = h * rr(rng, 0.12, 0.24);
    tube(B, [0, 0, z], [Math.cos(a) * L, Math.sin(a) * L, z + rr(rng, -1, 2)], h * 0.014, c, 3);
  }
  return B;
}

// --------------------------------------------------------------- granite
// ROCK IS THE HERO OF THIS WORLD, so it is built as rock: a stack of tilted
// slabs with LEDGES between them, not a pile of cones. views 4 and 20 show the
// Palisades ribs as blocky, jointed, near-vertical granite with snow caught on
// every up-facing shelf, and view-28 shows the same construction on The Slot's
// two walls. `ledges` puts a horizontal step every ~1/3 of the height, which is
// what reads as bedding from the bowl floor.
export function ribGeo(seed, { r = 3.0, h = 9.0, ledges = 3 } = {}) {
  const rng = makeRng(seed);
  const B = buf();
  // ONE dominant plane per rib: the whole stack leans on a single bearing, so
  // the outcrop reads as a fin of tilted bedding rather than a pile of lumps.
  // (The first cut stacked near-cylindrical prisms with a wider cap on each and
  // came out as rows of black mushrooms along every crest.)
  const yaw0 = rr(rng, 0, 6.28);
  const leanA = rr(rng, 0, 6.28);
  const lean = rr(rng, 0.16, 0.34);
  const lx = Math.cos(leanA) * lean, ly = Math.sin(leanA) * lean;
  const flat = rr(rng, 0.42, 0.72);          // how blade-like the fin is
  let z = -h * 0.34, rad = r;                 // buried a third of its height
  for (let i = 0; i < ledges; i++) {
    const hh = h / ledges * rr(rng, 0.9, 1.35);
    prism(B, rng, {
      x: lx * z, y: ly * z, z,
      r: rad, h: hh, sides: ri(rng, 4, 6), taper: rr(rng, 0.52, 0.76),
      jit: 0.30, yaw: yaw0 + i * 0.34, rz: flat,
      tiltX: lx * hh, tiltY: ly * hh,
      col: jitc(PAL.rockLo, rng, 0.22), colTop: jitc(PAL.rock, rng, 0.18),
    });
    z += hh * 0.86;
    rad *= rr(rng, 0.62, 0.82);
  }
  // lace, not frosting: only near-horizontal shelves hold snow, so the rib
  // still reads as near-black granite with white ledge lines, never a white cap
  snowLace(B, { snow: PAL.snow, lo: 0.80, hi: 0.985, amount: 0.5, patchy: 0.55, seed: seed + 5 });
  return B;
}

export function boulderGeo(seed, r = 2.2) {
  const rng = makeRng(seed);
  const B = buf();
  const n = ri(rng, 2, 4);
  for (let i = 0; i < n; i++) {
    const rr2 = r * rr(rng, 0.42, 0.8);
    prism(B, rng, {
      x: rr(rng, -r * 0.5, r * 0.5), y: rr(rng, -r * 0.5, r * 0.5), z: rr(rng, -r * 0.35, r * 0.2),
      r: rr2, h: rr2 * rr(rng, 0.7, 1.5), sides: ri(rng, 5, 7), taper: rr(rng, 0.45, 0.85),
      jit: 0.26, yaw: rr(rng, 0, 6.28), tiltX: rr(rng, -0.3, 0.3) * rr2, tiltY: rr(rng, -0.3, 0.3) * rr2,
      col: jitc(PAL.rockLo, rng, 0.18), colTop: jitc(PAL.rock, rng, 0.16),
    });
  }
  snowLace(B, { snow: PAL.snow, lo: 0.42, hi: 0.86, amount: 0.8, patchy: 0.26, seed: seed + 11 });
  return B;
}

// a talus block: angular, snow-free, brown-grey. view-27's rubble spine.
export function talusGeo(seed, r = 1.0) {
  const rng = makeRng(seed);
  const B = buf();
  prism(B, rng, {
    x: 0, y: 0, z: -r * 0.35, r, h: r * rr(rng, 0.6, 1.3), sides: ri(rng, 4, 6),
    taper: rr(rng, 0.35, 0.8), jit: 0.34, yaw: rr(rng, 0, 6.28),
    tiltX: rr(rng, -0.4, 0.4) * r, tiltY: rr(rng, -0.4, 0.4) * r,
    col: jitc(PAL.screeLo, rng, 0.22), colTop: jitc(PAL.scree, rng, 0.20),
  });
  // deliberately NO snow lace: view-27 is 31 January and this ground is bare
  return B;
}

// ---------------------------------------------------------------- people
export function skierGeo(seed, jacket, { skis = true, sit = false } = {}) {
  const rng = makeRng(seed);
  const B = buf();
  const j = jacket || pick(rng, PAL.jacket);
  const pants = rng() < 0.5 ? PAL.dark : lin(0x2e3742);
  if (sit) {
    box(B, { x: 0, y: 0, z: 0.10, sx: 0.44, sy: 0.30, sz: 0.42, col: pants });
    box(B, { x: 0, y: -0.24, z: 0.40, sx: 0.46, sy: 0.30, sz: 0.56, col: j });
    box(B, { x: 0, y: -0.26, z: 0.96, sx: 0.24, sy: 0.24, sz: 0.24, col: PAL.dark });
    if (skis) for (const s of [-0.12, 0.12]) {
      box(B, { x: s, y: 0.30, z: -0.62, sx: 0.10, sy: 1.68, sz: 0.05, col: rng() < 0.5 ? PAL.red : PAL.white });
      box(B, { x: s, y: 0.16, z: -0.60, sx: 0.10, sy: 0.14, sz: 0.55, col: PAL.dark });
    }
    return B;
  }
  const lean = rr(rng, 0.0, 0.16);
  box(B, { x: -0.13, y: 0, z: 0.09, sx: 0.16, sy: 0.30, sz: 0.66, col: pants });
  box(B, { x: 0.13, y: 0, z: 0.09, sx: 0.16, sy: 0.30, sz: 0.66, col: pants });
  box(B, { x: 0, y: lean * 0.4, z: 0.72, sx: 0.44, sy: 0.28, sz: 0.52, col: j });
  box(B, { x: -0.27, y: lean * 0.5, z: 0.74, sx: 0.13, sy: 0.16, sz: 0.44, col: scalec(j, 0.85) });
  box(B, { x: 0.27, y: lean * 0.5, z: 0.74, sx: 0.13, sy: 0.16, sz: 0.44, col: scalec(j, 0.85) });
  box(B, { x: 0, y: lean * 0.9, z: 1.24, sx: 0.23, sy: 0.24, sz: 0.24, col: PAL.dark });
  box(B, { x: 0, y: lean * 0.9 + 0.11, z: 1.30, sx: 0.20, sy: 0.05, sz: 0.09, col: PAL.glass });
  if (skis) for (const s of [-0.16, 0.16]) {
    box(B, { x: s, y: -0.28, z: 0.0, sx: 0.10, sy: 1.72, sz: 0.045, col: rng() < 0.5 ? PAL.red : PAL.yellow });
    box(B, { x: s, y: -0.02, z: 0.02, sx: 0.11, sy: 0.15, sz: 0.11, col: PAL.dark });
  }
  return B;
}

// ------------------------------------------------------------- structures
export function lodgeGeo(seed, sx, sy, storeys, kind = 'lodge') {
  const rng = makeRng(seed);
  const B = buf();
  const h = storeys * 3.4;
  const wall = mixc(PAL.stucco, PAL.timber, rr(rng, 0.25, 0.7));
  box(B, { x: 0, y: 0, z: 0, sx, sy, sz: h, col: wall });
  for (let s = 1; s <= storeys; s++) {
    const z = (s - 1) * 3.4 + 1.3;
    for (const [ax, ay, w] of [[0, sy / 2 + 0.02, sx], [0, -sy / 2 - 0.02, sx]])
      box(B, { x: ax, y: ay, z, sx: w * 0.86, sy: 0.06, sz: 1.25, col: PAL.glass });
    for (const ax of [sx / 2 + 0.02, -sx / 2 - 0.02])
      box(B, { x: ax, y: 0, z, sx: 0.06, sy: sy * 0.84, sz: 1.25, col: PAL.glass });
  }
  const rh = Math.min(4.4, Math.max(2.0, sx * 0.16));
  const ov = 0.9;
  const A = [-sx / 2 - ov, -sy / 2 - ov, h], Bp = [sx / 2 + ov, -sy / 2 - ov, h];
  const Cc = [sx / 2 + ov, sy / 2 + ov, h], D = [-sx / 2 - ov, sy / 2 + ov, h];
  const r0 = [0, -sy / 2 - ov, h + rh], r1 = [0, sy / 2 + ov, h + rh];
  quad(B, A, Bp, r0, r0, PAL.roof);
  quad(B, D, r1, r1, Cc, PAL.roof);
  quad(B, A, r0, r1, D, PAL.roof);
  quad(B, Bp, Cc, r1, r0, PAL.roof);
  const lift = 0.34;
  const A2 = [A[0] * 0.97, A[1] * 0.97, h + lift * 0.4], B2 = [Bp[0] * 0.97, Bp[1] * 0.97, h + lift * 0.4];
  const C2 = [Cc[0] * 0.97, Cc[1] * 0.97, h + lift * 0.4], D2 = [D[0] * 0.97, D[1] * 0.97, h + lift * 0.4];
  const s0 = [0, r0[1] * 0.97, h + rh + lift], s1 = [0, r1[1] * 0.97, h + rh + lift];
  quad(B, A2, s0, s1, D2, PAL.snow);
  quad(B, B2, C2, s1, s0, PAL.snow);
  return B;
}

export function hutGeo(seed, sx = 4.2, sy = 3.0, h = 2.6, col = null) {
  const B = buf();
  box(B, { x: 0, y: 0, z: 0, sx, sy, sz: h, col: col || PAL.offWhite });
  box(B, { x: 0, y: -sy / 2 - 0.02, z: h * 0.45, sx: sx * 0.5, sy: 0.06, sz: 0.9, col: PAL.glass });
  box(B, { x: 0, y: 0, z: h, sx: sx + 0.5, sy: sy + 0.5, sz: 0.20, col: PAL.roof });
  box(B, { x: 0, y: 0, z: h + 0.20, sx: sx + 0.4, sy: sy + 0.4, sz: 0.26, col: PAL.snow });
  return B;
}

// ============================================================================
// THE RIDGE FURNITURE — the only man-made things above the treeline
// ============================================================================

/** Sun Bowl entrance (view-37): a cluster of RED warning signboards on timber
 *  posts, with a rope line strung at the knoll's foot. */
export function warningBoards(B, x, y, z, yaw, gz, { n = 3 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v, h) => [x + u * c - v * s, y + u * s + v * c, h];
  for (let i = 0; i < n; i++) {
    const u = (i - (n - 1) / 2) * 2.35;
    const g = gz(P(u, 0, 0)[0], P(u, 0, 0)[1]);
    for (const v of [-0.78, 0.78]) tube(B, P(u, v, g), P(u, v, g + 2.15), 0.055, PAL.timberLo, 4);
    const a0 = P(u, -0.86, g + 0.95), b0 = P(u, 0.86, g + 0.95);
    const a1 = P(u, -0.86, g + 2.02), b1 = P(u, 0.86, g + 2.02);
    quad(B, a0, b0, b1, a1, PAL.red);
    quad(B, a1, b1, b0, a0, scalec(PAL.red, 0.78));
    // white banner band across the board
    const w0 = P(u + 0.02, -0.80, g + 1.30), w1 = P(u + 0.02, 0.80, g + 1.30);
    const w2 = P(u + 0.02, 0.80, g + 1.62), w3 = P(u + 0.02, -0.80, g + 1.62);
    quad(B, w0, w1, w2, w3, PAL.white);
  }
  // the rope line at the foot
  const rope = [];
  for (let i = -4; i <= 4; i++) rope.push([P(i * 3.4, -3.4, 0)[0], P(i * 3.4, -3.4, 0)[1]]);
  ropeLine(B, rope, gz, { h: 1.0, col: PAL.red });
}

/** Bamboo-and-rope closure line: posts with a single rope strung between. */
export function ropeLine(B, pts, gz, { h = 1.05, col = PAL.red, post = PAL.timberLo } = {}) {
  for (const [x, y] of pts) {
    const z = gz(x, y);
    tube(B, [x, y, z], [x, y, z + h], 0.042, post, 4);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const az = gz(ax, ay) + h * 0.9, bz = gz(bx, by) + h * 0.9;
    const mid = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2 - 0.16];
    tube(B, [ax, ay, az], mid, 0.028, col, 3);
    tube(B, mid, [bx, by, bz], 0.028, col, 3);
  }
}

/** A single posted trail signboard on the ridge (views 26, 40). The BOARD FACE
 *  is drawn here as a blank panel; where a name is confirmed, signs.mjs puts a
 *  lettered board on top of it. */
export function signPost(B, x, y, z, yaw, { h = 2.3, w = 1.5, bh = 0.6 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const v of [-(w / 2 - 0.1), w / 2 - 0.1]) {
    tube(B, [x - s * v, y + c * v, z], [x - s * v, y + c * v, z + h], 0.05, PAL.timberLo, 4);
  }
  const P = (v, hh) => [x - s * v, y + c * v, z + hh];
  quad(B, P(-w / 2, h - bh), P(w / 2, h - bh), P(w / 2, h), P(-w / 2, h), PAL.offWhite);
  quad(B, P(-w / 2, h), P(w / 2, h), P(w / 2, h - bh), P(-w / 2, h - bh), scalec(PAL.offWhite, 0.8));
  return { face: P(0, h - bh / 2), yaw };
}

/** Snow fencing: posts + a slatted orange band (view-32, the Headwall apron). */
export function snowFence(B, pts, gz, { h = 1.25, col = PAL.orange } = {}) {
  for (const [x, y] of pts) {
    const z = gz(x, y);
    tube(B, [x, y, z], [x, y, z + h], 0.05, PAL.dark, 4);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const az = gz(ax, ay), bz = gz(bx, by);
    for (const [lo, hi] of [[0.18, 0.48], [0.60, 0.92]]) {
      const a0 = [ax, ay, az + h * lo], b0 = [bx, by, bz + h * lo];
      const a1 = [ax, ay, az + h * hi], b1 = [bx, by, bz + h * hi];
      quad(B, a0, b0, b1, a1, col);
      quad(B, a1, b1, b0, a0, scalec(col, 0.8));
    }
  }
}

/** The timber sign frame at the left of view-21 — the only ground photograph of
 *  the Reverse Traverse. An A-frame of squared timber with a blank board. */
export function timberFrame(B, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v, h) => [x + u * c - v * s, y + u * s + v * c, z + h];
  for (const u of [-1.35, 1.35]) {
    tube(B, P(u, 0, 0), P(u * 0.86, 0, 2.5), 0.085, PAL.timber, 4);
  }
  tube(B, P(-1.2, 0, 2.42), P(1.2, 0, 2.42), 0.075, PAL.timber, 4);
  quad(B, P(-1.05, 0.03, 1.15), P(1.05, 0.03, 1.15), P(1.05, 0.03, 2.25), P(-1.05, 0.03, 2.25), PAL.offWhite);
  quad(B, P(-1.05, -0.03, 2.25), P(1.05, -0.03, 2.25), P(1.05, -0.03, 1.15), P(-1.05, -0.03, 1.15), scalec(PAL.offWhite, 0.82));
}

/** Bamboo boundary wand. */
export function wand(B, x, y, z, { h = 1.5, col = PAL.yellow } = {}) {
  tube(B, [x, y, z], [x + 0.06, y, z + h], 0.028, col, 3);
}
