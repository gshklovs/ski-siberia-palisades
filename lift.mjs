// Chairlift kit — parameterised by a polyline, so any lift in the sector can be
// built from its OSM aerialway way. Siberia Express is the hero: a 2015
// Leitner-Poma detachable six-pack, 1134 m plan / 278.8 m vertical, 14 towers,
// 2,400 pph at 1,000 ft/min.
//
// THE TERMINAL IS NOT THE RED DOG TERMINAL, and the bundle says so twice.
// annotations.md: "Terminals are low, dark, flat-roofed sheds — much plainer
// than the Red Dog kit." view-25 (liftblog, April 2017) is the portrait: a LOW
// box with a shallow DARK roof, a pale lettered band reading SIBERIA EXPRESS
// along the flank, standing on two splayed grey pylons over an open deck, with
// a small separate operator hut beside it (view-9). There is no glazed barrel
// vault here — that was the Red Dog shed and copying it would be the exact
// mistake COMPOSING rule 6 is about.

import { buf, tri, quad, box, tube, prism, plate, makeRng, rr, lin, mixc, scalec, clamp, lerp } from './lib/core.mjs';
import { PAL } from './kit.mjs';

// ------------------------------------------------------------ line frame
export function lineFrame(pts, gz) {
  const P = pts.map((p) => [p[0], p[1]]);
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = (s) => {
    s = clamp(s, 0, L);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const x = lerp(P[i - 1][0], P[i][0], t), y = lerp(P[i - 1][1], P[i][1], t);
    const dx = P[i][0] - P[i - 1][0], dy = P[i][1] - P[i - 1][1];
    const d = Math.hypot(dx, dy) || 1;
    return { x, y, ux: dx / d, uy: dy / d, z: gz(x, y) };
  };
  return { P, cum, L, at };
}

// -------------------------------------------------------------- terminals
// yaw is the direction of the line (radians, atan2(uy,ux)).
// `drive` = the base (drive) terminal, which sits lower and carries the maze.
export function terminal(B, seed, { x, y, z, yaw, len = 26, w = 7.2, deck = 4.6, name = true }) {
  const rng = makeRng(seed);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v, h) => [x + u * c - v * s, y + u * s + v * c, z + h];
  // two splayed pylons
  for (const u of [-len * 0.24, len * 0.24]) {
    const top = deck;
    quad(B, P(u - 2.6, -1.9, 0), P(u + 2.6, -1.9, 0), P(u + 1.0, -0.9, top), P(u - 1.0, -0.9, top), PAL.steelLo);
    quad(B, P(u - 2.6, 1.9, 0), P(u - 1.0, 0.9, top), P(u + 1.0, 0.9, top), P(u + 2.6, 1.9, 0), PAL.steelLo);
    quad(B, P(u - 2.6, -1.9, 0), P(u - 1.0, -0.9, top), P(u - 1.0, 0.9, top), P(u - 2.6, 1.9, 0), scalec(PAL.steelLo, 0.85));
    quad(B, P(u + 2.6, -1.9, 0), P(u + 2.6, 1.9, 0), P(u + 1.0, 0.9, top), P(u + 1.0, -0.9, top), scalec(PAL.steelLo, 0.85));
    // concrete plinth
    quad(B, P(u - 3.0, -2.3, 0.1), P(u + 3.0, -2.3, 0.1), P(u + 3.0, 2.3, 0.1), P(u - 3.0, 2.3, 0.1), lin(0x7d7c78));
  }
  // deck slab
  const hw = w / 2;
  quad(B, P(-len / 2, -hw, deck), P(len / 2, -hw, deck), P(len / 2, hw, deck), P(-len / 2, hw, deck), PAL.steelLo);
  // flanks: DARK sheet metal with a pale lettered band along the middle
  // (view-25: "SIBERIA EXPRESS" in white on a dark flank)
  const bodyH = 1.9;
  const DARKW = scalec(PAL.dark, 1.5);
  for (const v of [-hw, hw]) {
    const nrm = v > 0 ? 1 : -1;
    quad(B, P(-len / 2, v, deck), P(len / 2, v, deck), P(len / 2, v, deck + bodyH), P(-len / 2, v, deck + bodyH),
         nrm > 0 ? DARKW : scalec(DARKW, 0.9));
    // the pale band the lettering sits on (signs.mjs paints the words on top)
    quad(B, P(-len * 0.34, v * 1.008, deck + 0.32), P(len * 0.34, v * 1.008, deck + 0.32),
            P(len * 0.34, v * 1.008, deck + 1.78), P(-len * 0.34, v * 1.008, deck + 1.78),
         nrm > 0 ? PAL.offWhite : scalec(PAL.offWhite, 0.9));
  }
  quad(B, P(-len / 2, -hw, deck), P(-len / 2, -hw, deck + bodyH), P(-len / 2, hw, deck + bodyH), P(-len / 2, hw, deck), DARKW);
  quad(B, P(len / 2, -hw, deck), P(len / 2, hw, deck), P(len / 2, hw, deck + bodyH), P(len / 2, -hw, deck + bodyH), DARKW);
  // shallow DARK roof — a low segmented arc, 1.5 m of rise over a 7 m span, not
  // a barrel vault (view-25). The eaves overhang the flanks slightly.
  const NS = 7, rise = 1.5;
  const arc = (i) => {
    const t = i / NS, a = Math.PI * t;
    return [Math.cos(a) * hw * 1.10, deck + bodyH + Math.sin(a) * rise];
  };
  for (let i = 0; i < NS; i++) {
    const [v0, h0] = arc(i), [v1, h1] = arc(i + 1);
    const col = i === 0 || i === NS - 1 ? PAL.steelLo : PAL.roof;
    quad(B, P(-len / 2, v0, h0), P(len / 2, v0, h0), P(len / 2, v1, h1), P(-len / 2, v1, h1), col);
    quad(B, P(-len / 2, v1, h1), P(len / 2, v1, h1), P(len / 2, v0, h0), P(-len / 2, v0, h0), scalec(col, 0.7));
  }
  // a thin snow cap on the roof crown — every winter frame in the bundle has it
  {
    const [v0, h0] = arc(2), [v1, h1] = arc(NS - 2);
    quad(B, P(-len / 2 + 0.6, v0, h0 + 0.10), P(len / 2 - 0.6, v0, h0 + 0.10),
            P(len / 2 - 0.6, v1, h1 + 0.10), P(-len / 2 + 0.6, v1, h1 + 0.10), PAL.snow);
  }
  // end caps of the vault
  for (const u of [-len / 2, len / 2]) {
    const pts = [];
    for (let i = 0; i <= NS; i++) { const [v, h] = arc(i); pts.push(P(u, v, h)); }
    pts.push(P(u, hw * 1.10, deck + bodyH), P(u, -hw * 1.10, deck + bodyH));
    plate(B, pts, PAL.roof);
    plate(B, pts.slice().reverse(), scalec(PAL.roof, 0.9));
  }
  // bullwheel + rail under the deck
  const bw = 2.1;
  for (const u of [-len * 0.34, len * 0.34]) {
    tube(B, P(u, 0, deck - 1.5), P(u, 0, deck - 0.1), 0.22, PAL.steel, 6);
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring.push(P(u + Math.cos(a) * bw, Math.sin(a) * bw, deck - 1.5));
    }
    plate(B, ring, PAL.steelLo);
    plate(B, ring.slice().reverse(), scalec(PAL.steelLo, 0.8));
  }
  for (const v of [-1.5, 1.5]) {
    tube(B, P(-len / 2 - 2, v, deck - 1.2), P(len / 2 + 2, v, deck - 1.2), 0.09, PAL.steelLo, 4);
  }
  return { signAt: (v) => P(0, v, deck + 1.05), signYaw: yaw, len, w, deck, bodyH };
}

// ------------------------------------------------------------------ towers
// kind: 'std' | 'angled' | 'tall'
export function tower(B, seed, { x, y, z, yaw, h = 11, kind = 'std', n = 0 }) {
  const rng = makeRng(seed);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v, hh) => [x + u * c - v * s, y + u * s + v * c, z + hh];
  const lean = kind === 'angled' ? -0.20 : 0;             // leans back down-line
  const topU = lean * h;
  const R = kind === 'tall' ? 0.50 : 0.42;
  // column (splayed base)
  tube(B, P(0, 0, 0), P(topU * 0.5, 0, h * 0.5), R * 1.35, PAL.galv, 7, R * 1.05);
  tube(B, P(topU * 0.5, 0, h * 0.5), P(topU, 0, h), R * 1.05, PAL.galv, 7, R * 0.9);
  // base plate / plinth
  quad(B, P(-1.5, -1.5, 0.08), P(1.5, -1.5, 0.08), P(1.5, 1.5, 0.08), P(-1.5, 1.5, 0.08), lin(0x77756f));
  if (kind === 'angled') {
    // the second, forward leg that gives the breakover towers their A-shape
    tube(B, P(2.6, 0, 0), P(topU * 0.85, 0, h * 0.86), R * 1.05, PAL.galv, 6, R * 0.8);
  }
  // crossarm
  const armW = kind === 'tall' ? 3.4 : 3.0;
  // the crossarm is a braced lattice, not a stick — looking up at a Red Dog
  // tower from the chair (view-7) it is mostly crossarm and sheave train
  tube(B, P(topU, -armW, h), P(topU, armW, h), 0.22, PAL.galv, 6);
  tube(B, P(topU, -armW, h - 0.85), P(topU, armW, h - 0.85), 0.15, PAL.galv, 5);
  for (const v of [-armW * 0.72, -armW * 0.3, armW * 0.3, armW * 0.72]) {
    tube(B, P(topU, v, h), P(topU, v * 0.28, h - 0.85), 0.075, PAL.galv, 4);
  }
  // sheave trains, one each side, hanging under the arm, tilted on the breakover
  const tilt = kind === 'angled' ? 0.30 : 0.06;
  for (const side of [-1, 1]) {
    const v = side * (armW - 0.35);
    const drop = 0.95;
    tube(B, P(topU, v, h), P(topU + tilt * 1.2, v, h - drop), 0.15, PAL.galv, 5);
    const NS = kind === 'angled' ? 8 : 6, sp = 0.58;
    for (let i = 0; i < NS; i++) {
      const u = topU + (i - (NS - 1) / 2) * sp;
      const dz = h - drop - Math.abs(i - (NS - 1) / 2) * sp * tilt;
      tube(B, P(u, v - 0.30, dz), P(u, v + 0.30, dz), 0.165, PAL.steel, 7);
    }
    // the beam the sheaves hang from
    const uu0 = topU - (NS / 2) * sp, uu1 = topU + (NS / 2) * sp;
    tube(B, P(uu0, v, h - drop + 0.26), P(uu1, v, h - drop + 0.26), 0.11, PAL.galv, 5);
  }
  // ladder + catwalk
  for (const v of [-0.30, 0.30]) tube(B, P(-R * 1.9, v, 0.4), P(topU - R * 1.6, v, h - 0.6), 0.035, PAL.galv, 3);
  for (let i = 1; i * 0.42 < h - 1.0; i++) {
    const t = (i * 0.42) / h;
    tube(B, P(-R * 1.9 + topU * t, -0.30, i * 0.42), P(-R * 1.9 + topU * t, 0.30, i * 0.42), 0.022, PAL.galv, 3);
  }
  // number plate (view-14 of the sibling bundle: blue plates; Red Dog uses white)
  if (n) box(B, { x: P(0.1, -0.75, h * 0.55)[0], y: P(0.1, -0.75, h * 0.55)[1], z: P(0, 0, h * 0.55)[2],
                  sx: 0.6, sy: 0.05, sz: 0.6, yaw, col: PAL.white });
  return { top: P(topU, 0, h), armW };
}

// ------------------------------------------------------------------ cable
// Parabolic sag between consecutive sheave heads, two strands at +/- armW.
export function cable(B, nodes, armW, { r = 0.055, sagK = 0.010, seg = 7 } = {}) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * side * armW, ny = dx / L * side * armW;
      const sag = sagK * L;
      let prev = null;
      for (let k = 0; k <= seg; k++) {
        const t = k / seg;
        const p = [a[0] + dx * t + nx, a[1] + dy * t + ny, lerp(a[2], b[2], t) - 4 * sag * t * (1 - t)];
        if (prev) tube(B, prev, p, r, PAL.black, 4);
        prev = p;
      }
    }
  }
}

// sample the cable line (side +/-1) at arc length s
export function makeCablePath(nodes, armW, sagK = 0.010) {
  const cum = [0];
  for (let i = 1; i < nodes.length; i++)
    cum.push(cum[i - 1] + Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]));
  const L = cum[cum.length - 1];
  return {
    L,
    at(s, side) {
      s = ((s % L) + L) % L;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const a = nodes[i - 1], b = nodes[i];
      const span = (cum[i] - cum[i - 1]) || 1;
      const t = (s - cum[i - 1]) / span;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1;
      const sag = sagK * span;
      return {
        x: a[0] + dx * t - dy / d * side * armW,
        y: a[1] + dy * t + dx / d * side * armW,
        z: lerp(a[2], b[2], t) - 4 * sag * t * (1 - t),
        yaw: Math.atan2(dy, dx),
      };
    },
  };
}

// ------------------------------------------------------------------ chair
// Six-place: hanger, spring, bar, bench with six pads, backrest, safety bar
// (view-31 is shot from underneath one; view-33 is the same chair snow-loaded).
export function chairGeo(seed, seats = 6) {
  const B = buf();
  const W = seats * 0.56;
  tube(B, [0, 0, 0], [0, 0, -1.30], 0.075, PAL.steelLo, 5);            // hanger
  tube(B, [0, 0, -1.30], [0, 0.10, -2.20], 0.065, PAL.steelLo, 5);
  tube(B, [-W / 2, 0.10, -2.20], [W / 2, 0.10, -2.20], 0.055, PAL.steelLo, 4);
  for (const s of [-1, 1]) tube(B, [s * W * 0.42, 0.10, -2.20], [s * W * 0.42, 0.30, -2.78], 0.05, PAL.steelLo, 4);
  // bench
  box(B, { x: 0, y: 0.26, z: -2.86, sx: W, sy: 0.56, sz: 0.10, col: PAL.dark });
  box(B, { x: 0, y: 0.0, z: -2.86, sx: W, sy: 0.10, sz: 0.86, col: PAL.dark });     // back
  for (let i = 0; i < seats; i++) {
    const x = -W / 2 + (i + 0.5) * (W / seats);
    box(B, { x, y: 0.27, z: -2.76, sx: W / seats - 0.06, sy: 0.50, sz: 0.06, col: scalec(PAL.dark, 1.5) });
  }
  // safety bar, down
  tube(B, [-W / 2 + 0.1, 0.62, -2.60], [W / 2 - 0.1, 0.62, -2.60], 0.035, PAL.steelLo, 4);
  for (const s of [-1, 1]) tube(B, [s * (W / 2 - 0.1), 0.62, -2.60], [s * (W / 2 - 0.1), 0.06, -2.30], 0.032, PAL.steelLo, 4);
  return B;
}
