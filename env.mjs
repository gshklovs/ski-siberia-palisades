// Sky, light and cloud. No ShaderMaterial anywhere — the dome is a
// vertex-coloured BackSide sphere, which sidesteps the tone-mapping /
// colour-space include trap entirely.

import { buf, tri, quad, prism, makeRng, rr, ri, lin, mixc, scalec, clamp, smooth, toGeo } from './lib/core.mjs';
import { SUN_AZ, SUN_EL, SUN_DIR } from './terrain.mjs';

// Warm low sun + a strongly blue sky dome. Because the terrain's vertex colour
// is albedo (see terrain.mjs), THIS is what makes a sunlit slope read warm
// white and a north-facing one read blue — the whole point of the palette.
// This sector is 2400-2700 m and NORTH-ASPECT: most of what the player looks at
// never sees the direct sun in late January, so the sky term is doing most of
// the work and it has to be strong enough to keep snow reading as snow.
export const SUN = {
  dir: SUN_DIR,
  color: 0xfff2dc,
  intensity: 2.05,
  ambSky: 0xa9c8f0,
  ambGround: 0xe8eff8,
  ambIntensity: 1.92,
};

// deep winter blue overhead falling to a pale horizon
const SKY_TOP = lin(0x3d7ec9);
const SKY_MID = lin(0x8dbbe8);
const SKY_HORIZON = lin(0xdfeaf7);
const SKY_LOW = lin(0xc9d9ea);

export function buildSky(THREE) {
  const R = 13000;
  const g = new THREE.SphereGeometry(R, 40, 24);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sd = SUN_DIR;
  for (let i = 0; i < pos.count; i++) {
    // the sphere is built Y-up; the mesh is rotated to Z-up below, so the
    // gradient must be driven by the POST-rotation axis (this is the bug that
    // put a horizontal gradient in the sibling run).
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i);
    const up = -zz / R;                       // after rotateX(-PI/2), +Z world = -Z local
    let c;
    if (up > 0.30) c = mixc(SKY_MID, SKY_TOP, smooth(0.30, 0.95, up));
    else if (up > 0.0) c = mixc(SKY_HORIZON, SKY_MID, smooth(0.0, 0.30, up));
    else c = mixc(SKY_LOW, SKY_HORIZON, smooth(-0.25, 0.0, up));
    // a little warmth around the sun bearing
    const wx = x / R, wy = y / R;
    const dot = wx * sd[0] + (-zz / R) * sd[2] + wy * sd[1];
    c = mixc(c, lin(0xffe9c8), clamp(dot, 0, 1) ** 6 * 0.35);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.name = 'sky';
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// High cirrus banners — views 16-25 all have them combed across the blue.
export function buildClouds(THREE) {
  const rng = makeRng('cirrus');
  const B = buf();
  const hi = lin(0xf6fbff), lo = lin(0xd5e4f4);
  for (let i = 0; i < 22; i++) {
    const a = rr(rng, 0, Math.PI * 2), d = rr(rng, 1400, 9000);
    const cx = Math.cos(a) * d, cy = Math.sin(a) * d;
    const z = rr(rng, 2100, 3400);
    const yaw = rr(rng, 0.5, 1.3);
    const L = rr(rng, 900, 3200), W = rr(rng, 30, 120);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, v, h) => [cx + u * c - v * s, cy + u * s + v * c, z + h];
    const n = ri(rng, 3, 6);
    for (let k = 0; k < n; k++) {
      const u0 = -L / 2 + rr(rng, 0, L * 0.5), l = rr(rng, L * 0.25, L * 0.6);
      const v0 = rr(rng, -W, W), w = rr(rng, W * 0.25, W * 0.8);
      const h = rr(rng, -60, 60);
      const col = mixc(lo, hi, rr(rng, 0.3, 1));
      quad(B, P(u0, v0, h), P(u0 + l, v0 + rr(rng, -w, w), h), P(u0 + l, v0 + w, h), P(u0, v0 + w * 0.6, h), col);
    }
  }
  const m = new THREE.Mesh(toGeo(THREE, B, { normals: false }), new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.30, fog: false, depthWrite: false,
  }));
  m.name = 'cirrus';
  m.renderOrder = -8;
  m.frustumCulled = false;
  return m;
}
