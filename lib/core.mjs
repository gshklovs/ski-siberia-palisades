// Small self-contained toolbox: rng, value noise, colour, geometry buffers.
// No THREE dependency — geometry is accumulated into flat arrays and handed to
// THREE only at the very end (toGeo). Everything is deterministic.

// ------------------------------------------------------------------- random
export function makeRng(seed) {
  let a = 0;
  if (typeof seed === 'string') { for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0; }
  else a = (seed >>> 0) || 1;
  a = (a + 0x9e3779b9) >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (rng, a, b) => a + (b - a) * rng();
export const ri = (rng, a, b) => Math.floor(a + (b - a + 1) * rng());
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// -------------------------------------------------------------------- maths
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (d, w) => Math.exp(-(d * d) / (w * w));

// ------------------------------------------------------------- value noise
function h2(ix, iy, s) {
  let n = ix * 374761393 + iy * 668265263 + s * 2246822519;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}
export function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5, s = 0) {
  let v = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, s + i * 17); norm += amp; amp *= gain; f *= lac; }
  return v / norm;
}
export function ridged(x, y, oct = 4, s = 0) {
  let v = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp * (1 - Math.abs(vnoise(x * f, y * f, s + i * 31))); norm += amp; amp *= 0.5; f *= 2.07; }
  return (v / norm) * 2 - 1;
}

// ------------------------------------------------------------------ colour
// sRGB hex -> linear float triple. Vertex-colour attributes are consumed as
// linear-srgb by three, so the conversion has to happen here.
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function lin(hex) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return [s2l(r), s2l(g), s2l(b)];
}
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const scalec = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export function jitc(c, rng, k) { const f = 1 + (rng() - 0.5) * 2 * k; return [c[0] * f, c[1] * f, c[2] * f]; }

// -------------------------------------------------------------- geom buffer
export function buf() { return { pos: [], col: [] }; }
export function tri(B, a, b, c, ca, cb, cc) {
  B.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  cb = cb || ca; cc = cc || ca;
  B.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
}
export function quad(B, a, b, c, d, ca, cb, cc, cd) {
  tri(B, a, b, c, ca, cb || ca, cc || ca);
  tri(B, a, c, d, ca, cc || ca, cd || ca);
}
export function bufTris(B) { return B.pos.length / 9; }
export function appendBuf(dst, src) {
  for (let i = 0; i < src.pos.length; i++) dst.pos.push(src.pos[i]);
  for (let i = 0; i < src.col.length; i++) dst.col.push(src.col[i]);
}

export function toGeo(THREE, B, { normals = true } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  if (normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Face-normal driven snow: every triangle whose normal points up enough gets
// blended toward snow. This is what makes near-black rock read as "rock with
// snow lace on every ledge" without a texture.
export function snowLace(B, { snow, lo = 0.35, hi = 0.80, amount = 1.0, patchy = 0.0, seed = 3 } = {}) {
  const P = B.pos, C = B.col;
  const rng = makeRng(seed);
  for (let t = 0; t < P.length; t += 9) {
    const ax = P[t], ay = P[t + 1], az = P[t + 2];
    const e1x = P[t + 3] - ax, e1y = P[t + 4] - ay, e1z = P[t + 5] - az;
    const e2x = P[t + 6] - ax, e2y = P[t + 7] - ay, e2z = P[t + 8] - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nz = Math.abs(nz / len);
    let f = smooth(lo, hi, nz) * amount;
    if (patchy > 0) f *= 1 - patchy * rng();
    if (f <= 0.002) continue;
    for (let k = 0; k < 3; k++) {
      const o = t + k * 3;
      C[o] = lerp(C[o], snow[0], f);
      C[o + 1] = lerp(C[o + 1], snow[1], f);
      C[o + 2] = lerp(C[o + 2], snow[2], f);
    }
  }
}

// ------------------------------------------------------------ solid makers
// An n-sided prism with independently jittered top and bottom rings, a lateral
// top offset and a yaw. This is the single primitive every rock is built from:
// stack them, lean them, flare them and you get blocky granite instead of cones.
export function prism(B, rng, o) {
  const {
    x = 0, y = 0, z = 0, r = 1, h = 1, sides = 6, taper = 0.8,
    jit = 0.18, yaw = 0, dx = 0, dy = 0, col, colTop, tiltX = 0, tiltY = 0, rz = 1,
  } = o;
  const n = Math.max(3, sides | 0);
  const bot = [], top = [];
  for (let i = 0; i < n; i++) {
    const a = yaw + (i / n) * Math.PI * 2;
    const rb = r * (1 + (rng() - 0.5) * 2 * jit);
    const rt = r * taper * (1 + (rng() - 0.5) * 2 * jit);
    const bz = z + (rng() - 0.5) * h * 0.08;
    bot.push([x + Math.cos(a) * rb, y + Math.sin(a) * rb * rz, bz]);
    top.push([x + dx + Math.cos(a) * rt + tiltX, y + dy + Math.sin(a) * rt * rz + tiltY, z + h * (1 + (rng() - 0.5) * 0.14)]);
  }
  const cB = col, cT = colTop || col;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(B, bot[i], bot[j], top[j], top[i], cB, cB, cT, cT);
  }
  for (let i = 1; i < n - 1; i++) tri(B, top[0], top[i], top[i + 1], cT);
  for (let i = 1; i < n - 1; i++) tri(B, bot[0], bot[i + 1], bot[i], cB);
  return { top, bot };
}

// axis-aligned-ish box with yaw, used for man-made things
export function box(B, o) {
  const { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, yaw = 0, col, colTop } = o;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, ly, lz) => [x + lx * c - ly * s, y + lx * s + ly * c, z + lz];
  const hx = sx / 2, hy = sy / 2;
  const a = P(-hx, -hy, 0), b = P(hx, -hy, 0), d = P(hx, hy, 0), e = P(-hx, hy, 0);
  const a2 = P(-hx, -hy, sz), b2 = P(hx, -hy, sz), d2 = P(hx, hy, sz), e2 = P(-hx, hy, sz);
  const cT = colTop || col;
  quad(B, a, b, b2, a2, col); quad(B, b, d, d2, b2, col);
  quad(B, d, e, e2, d2, col); quad(B, e, a, a2, e2, col);
  quad(B, a2, b2, d2, e2, cT);
  quad(B, a, e, d, b, col);
}

// a cylinder between two points (cables, poles, tree trunks)
export function tube(B, p0, p1, r, col, sides = 6, r1 = null) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const w = [d[0] / L, d[1] / L, d[2] / L];
  let up = Math.abs(w[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let a = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]];
  const al = Math.hypot(a[0], a[1], a[2]) || 1; a = [a[0] / al, a[1] / al, a[2] / al];
  const b = [w[1] * a[2] - w[2] * a[1], w[2] * a[0] - w[0] * a[2], w[0] * a[1] - w[1] * a[0]];
  const R1 = r1 === null ? r : r1;
  const ring = (p, rad) => {
    const o = [];
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2, ca = Math.cos(t) * rad, sa = Math.sin(t) * rad;
      o.push([p[0] + a[0] * ca + b[0] * sa, p[1] + a[1] * ca + b[1] * sa, p[2] + a[2] * ca + b[2] * sa]);
    }
    return o;
  };
  const r0 = ring(p0, r), rn = ring(p1, R1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    quad(B, r0[i], r0[j], rn[j], rn[i], col);
  }
}

// flat quad in the XY plane at height z (signs, flags handled separately)
export function plate(B, pts, col) {
  for (let i = 1; i < pts.length - 1; i++) tri(B, pts[0], pts[i], pts[i + 1], col);
}
