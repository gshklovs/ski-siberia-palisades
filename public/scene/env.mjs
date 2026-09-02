// Sky, light and cloud. No ShaderMaterial anywhere — the dome is a
// vertex-coloured BackSide sphere, which sidesteps the tone-mapping /
// colour-space include trap entirely.

import { buf, tri, quad, prism, makeRng, rr, ri, lin, mixc, scalec, clamp, smooth, toGeo,
         f32, dialColor, LOOK, definePresets } from './lib/core.mjs';
import { SUN_AZ, SUN_EL, SUN_DIR } from './terrain.mjs';

// Warm low sun + a strongly blue sky dome. Because the terrain's vertex colour
// is albedo (see terrain.mjs), THIS is what makes a sunlit slope read warm
// white and a north-facing one read blue — the whole point of the palette.
// This sector is 2400-2700 m and NORTH-ASPECT: most of what the player looks at
// never sees the direct sun in late January, so the sky term is doing most of
// the work and it has to be strong enough to keep snow reading as snow.
// world.mjs constructs the DirectionalLight and the HemisphereLight out of this
// object and never hands them back, so these five are ALSO live dials
// (SUN_COLOR / SUN_INTENSITY / AMB_SKY / AMB_GROUND / AMB_INTENSITY, below).
// specs/0024 §2.
export const SUN = {
  dir: SUN_DIR,
  color: 0xfff2dc,
  intensity: 2.05,
  ambSky: 0xa9c8f0,
  ambGround: 0xe8eff8,
  ambIntensity: 1.92,
};

// deep winter blue overhead falling to a pale horizon. The four stops are dials
// (specs/0024 §2): linear rgb in one Float32Array, and moving any of them
// repaints the dome's vertex-colour attribute.
const uSky = f32(new Array(12).fill(0));
dialColor('SKY_TOP', uSky, 0, 0x3d7ec9);
dialColor('SKY_MID', uSky, 3, 0x8dbbe8);
dialColor('SKY_HORIZON', uSky, 6, 0xdfeaf7);
dialColor('SKY_LOW', uSky, 9, 0xc9d9ea);
const skyStop = (i) => [uSky[i], uSky[i + 1], uSky[i + 2]];

// the warm bloom the dome carries around the sun BEARING (not its elevation —
// see the preset table).
let SKY_SUN_GLOW = 0xffe9c8;
let SKY_SUN_GLOW_AMOUNT = 0.35;

// --------------------------------------------------- the dome and the lights
// The lights are found LAZILY off the dome's parent: world.mjs adds the dome
// and both lights to the same scene and returns none of them, and world.mjs is
// not this spec's territory. A write that lands BEFORE the world is built needs
// none of it — it changes SUN, and world.mjs reads SUN.
let lightsFor = null, sunLight = null, hemiLight = null;
function lights() {
  const scene = skyMesh && skyMesh.parent;
  if (!scene) return null;
  if (lightsFor !== scene) {
    lightsFor = scene; sunLight = null; hemiLight = null;
    scene.traverse((o) => {
      if (!sunLight && o.isDirectionalLight) sunLight = o;
      if (!hemiLight && o.isHemisphereLight) hemiLight = o;
    });
  }
  return (sunLight || hemiLight) ? { sun: sunLight, hemi: hemiLight } : null;
}

/** LOOK.NAME <-> SUN[key], written through to the live light when there is one. */
function lightDial(name, key, apply) {
  Object.defineProperty(LOOK, name, {
    get: () => SUN[key],
    set: (v) => { SUN[key] = v; const L = lights(); if (L) apply(L, v); },
    enumerable: true, configurable: true,
  });
}
lightDial('SUN_COLOR', 'color', (L, v) => { if (L.sun) L.sun.color.setHex(v); });
lightDial('SUN_INTENSITY', 'intensity', (L, v) => { if (L.sun) L.sun.intensity = v; });
lightDial('AMB_SKY', 'ambSky', (L, v) => { if (L.hemi) L.hemi.color.setHex(v); });
lightDial('AMB_GROUND', 'ambGround', (L, v) => { if (L.hemi) L.hemi.groundColor.setHex(v); });
lightDial('AMB_INTENSITY', 'ambIntensity', (L, v) => { if (L.hemi) L.hemi.intensity = v; });

Object.defineProperty(LOOK, 'SKY_SUN_GLOW', {
  get: () => SKY_SUN_GLOW,
  set: (v) => { SKY_SUN_GLOW = v; repaintSky(); }, enumerable: true, configurable: true,
});
Object.defineProperty(LOOK, 'SKY_SUN_GLOW_AMOUNT', {
  get: () => SKY_SUN_GLOW_AMOUNT,
  set: (v) => { SKY_SUN_GLOW_AMOUNT = +v; repaintSky(); }, enumerable: true, configurable: true,
});
for (const n of ['SKY_TOP', 'SKY_MID', 'SKY_HORIZON', 'SKY_LOW']) {
  const d = Object.getOwnPropertyDescriptor(LOOK, n);
  Object.defineProperty(LOOK, n, { ...d, set: (v) => { d.set(v); repaintSky(); } });
}

const SKY_R = 13000;

/** the dome's vertex colours, from the four SKY_* dials and the sun bearing. */
function paintSky(pos, col) {
  const R = SKY_R;
  const sd = SUN_DIR;
  const top = skyStop(0), mid = skyStop(3), hor = skyStop(6), low = skyStop(9);
  const glow = lin(SKY_SUN_GLOW), amt = SKY_SUN_GLOW_AMOUNT;
  for (let i = 0; i < pos.count; i++) {
    // the sphere is built Y-up; the mesh is rotated to Z-up below, so the
    // gradient must be driven by the POST-rotation axis (this is the bug that
    // put a horizontal gradient in the sibling run).
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i);
    const up = -zz / R;                       // after rotateX(-PI/2), +Z world = -Z local
    let c;
    if (up > 0.30) c = mixc(mid, top, smooth(0.30, 0.95, up));
    else if (up > 0.0) c = mixc(hor, mid, smooth(0.0, 0.30, up));
    else c = mixc(low, hor, smooth(-0.25, 0.0, up));
    // a little warmth around the sun bearing
    const wx = x / R, wy = y / R;
    const dot = wx * sd[0] + (-zz / R) * sd[2] + wy * sd[1];
    c = mixc(c, glow, clamp(dot, 0, 1) ** 6 * amt);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
}

let skyMesh = null;

function repaintSky() {
  if (!skyMesh) return;                       // dialled before the world exists
  const g = skyMesh.geometry;
  paintSky(g.attributes.position, g.attributes.color.array);
  g.attributes.color.needsUpdate = true;
}

// the dome's colour buffer, for anything that needs to prove the repaint is
// exact — the bench player exposes no scene handle. A function, so `preset()`'s
// dial walk skips it.
LOOK.skyColors = () => (skyMesh ? skyMesh.geometry.attributes.color.array : null);

export function buildSky(THREE) {
  const g = new THREE.SphereGeometry(SKY_R, 40, 24);
  const col = new Float32Array(g.attributes.position.count * 3);
  paintSky(g.attributes.position, col);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.name = 'sky';
  m.renderOrder = -10;
  m.frustumCulled = false;
  skyMesh = m;
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

// ============================================================ THE PRESET TABLE
//
// specs/0024, and it is the SAME TABLE as the Red Dog run's, copied verbatim.
// That is the point of §4.5: the rows this sector has no dial for (the L2
// shader look never landed here — no SUN_RAMP_*, no SHADOW_TINT, no
// FOG_BAND_COLOR, no SUN_STEP_EDGE) are skipped by `preset()`, so golden hour
// arrives on the dome and the two lights and asks for no world-specific code.
//
// THE SUN DOES NOT MOVE. terrain.mjs bakes the cast shadow and the sky
// occlusion into the vertex colours against SUN_DIR, so dropping the sun's
// elevation would put lit snow inside a baked shadow. Golden hour is sold by
// colour, ramp and fog, not by elevation.
export const PRESETS = {
  default: {},
  'golden-hour': {
    SUN_COLOR: 0xffd0a2,
    SUN_INTENSITY: 2.00,
    AMB_SKY: 0x7f92c2,
    AMB_GROUND: 0xe8c9a8,
    AMB_INTENSITY: 0.86,

    SUN_STEP_EDGE: 0.26,
    SUN_STEP_GAIN: 0.96,
    SUN_RAMP_LO: 0xffdcbc,
    SUN_RAMP_HI: 0xffecd4,
    SHADOW_TINT: 0x6e6bb8,
    SHADOW_TINT_STRENGTH: 0.46,

    FOG_BAND_COLOR: [0xb2b0c6, 0xcbc6d6, 0xddccbe],

    SKY_TOP: 0x2f5f9e,
    SKY_MID: 0x86a8dc,
    SKY_HORIZON: 0xecd8c0,
    SKY_LOW: 0xe0b48c,
    SKY_SUN_GLOW: 0xffc98e,
    SKY_SUN_GLOW_AMOUNT: 0.45,
  },
};

definePresets(PRESETS);

// ------------------------------------------------------------- `?look=` boot
// Guarded the way any query read in this project is: the headless harness and
// any node-side import of this module reach this line too, and a world that
// will not load without a URL bar is worse than one that boots default.
try {
  const q = new URLSearchParams(globalThis.location.search).get('look');
  if (q) LOOK.preset(q);
} catch { /* no location to read — default look */ }
