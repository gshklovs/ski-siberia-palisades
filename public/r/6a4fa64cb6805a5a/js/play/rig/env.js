// specs/0045 §7.2 — the rider's environment, built in code, shipping no file.
// specs/0046 §3.4 — the same mechanism, four times bigger, with two more stops.
//
//   makeEnv(THREE, {zenith, mid, horizon, snow})  → THREE.CubeTexture, 6 × 64²
//   envFor(THREE, scene)                          → the one env for that scene, cached
//   defaultEnv(THREE)                             → SKY's literals, built once
//   FACE                                          → the face size this tier builds
//
// A metalness of 0.8 with no envMap is BLACK — `envmap_physical_pars_fragment`
// returns vec3(0) for getIBLIrradiance/getIBLRadiance without ENVMAP_TYPE_CUBE_UV,
// and a metal has no diffuse term to fall back on. D7 bans a shipped image asset
// under bench/public as hard as it bans a baked lightmap, so the cube is built
// out of the world's own sky and snow colours: six 64×64 canvases, +Y a THREE-stop
// vertical gradient (zenith → mid → horizon, §3.4), −Y flat snow, the four sides
// a horizon split at v = 0.5 with an ordered dither across the seam so a rough
// metal does not band on it, and a WARM BOUNCE BAND over their lower third.
// Cost 6 × 64 × 64 × 4 = 98,304 B of runtime typed array, ONE GPU pass at boot,
// zero transfer bytes.
//
// specs/0046 §3.4 — why 16² was not enough. PMREM's mip chain bottoms out before
// the specular lobe is narrow enough for a `roughness 0.05` visor under
// `clearcoat 1.0`: at 16² that visor reflects a sixteen-pixel horizon and shows
// it. At 64² the horizon line lands sub-texel at every roughness the rider uses.
// Transfer bytes stay at ZERO — the cost is one more PMREM pass over 4× the
// texels, ≈ +0.6 ms at boot, and ≈ 120 B of source.
//
// The warm bounce band is the other half of §3.4: a helmet standing on snow gets
// its underside lit by the snow, and snow outdoors is not neutral — it carries
// the key's warmth. The lower third of the four side faces is the world's snow
// albedo warmed 8 % toward `fx:key`'s 0xfff1dc (fx.js:124-133), which is what
// makes a clearcoat read as outdoors rather than as a studio sphere.
//
// No PMREM import and none is needed: a CubeTexture carries CubeReflectionMapping
// and WebGLPrograms routes a Standard material's envMap through WebGLCubeUVMaps
// (three.module.js:6832, :3606, :3631), which runs the CORE PMREMGenerator
// (:2720) itself, once, on the first render that sees it. The addons and examples
// trees stay banned (C19) because nothing here imports either.
//
// The env is built ONCE per world and shared by all four rider material instances
// and by the locker mannequin; it is NOT part of paint()'s cache and does not
// repaint when the look changes.

// The palisades world's own dials (runs/…/scene/env.mjs:36-39 SKY_TOP / SKY_MID /
// SKY_HORIZON and :25 ambGround, which is the snow albedo the ground shader
// bounces). They are the DEFAULT, not the source of truth: `envFor` prefers the
// live scene's background and fog colours whenever it has them, so a world with
// another sky reflects its own.
export const SKY = { zenith: 0x3d7ec9, mid: 0x8dbbe8, horizon: 0xdfeaf7, snow: 0xdfe9f4 };

// specs/0046 §4.6 — the degrade ladder's env row: 64² on desktop, 32² on a coarse
// pointer, because a phone's mip chain does not resolve past 32². This is the same
// media query loader.js:71/:122, hud.js:250 and intro.js:20 already read; §4.6
// gives it one exported name in `rig/bloom.js`, which is C4's file and does not
// exist yet (§8.3 runs C3 and C4 in parallel), so this module reads the query
// itself rather than importing a file that is not there.
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const FACE = COARSE ? 32 : 64;          // §3.4 / §4.6, and what N30 reads
const N = FACE;                                // §3.4 — six 64² faces (32² on coarse)
const SEAM = N >> 3;                           // the dither band, in texels — 2 at 16², 8 at 64²
const WARM = 0xfff1dc;                         // §3.4 — fx:key's colour, fx.js:124-133
const WARM_MIX = 0.08;                         // 8 % toward it, on the snow bounce alone
const BOUNCE = Math.round(N * 2 / 3);          // the lower third of a side face
// a fixed 4×4 ordered (Bayer) matrix, normalised to (0, 1). C19 bans the RNG
// outright, and a stochastic dither would also make the env — and every metal
// texel that samples it — a different image on every boot.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
// the same lerp twice over: `lerp3` when the caller wants a triple to keep mixing
// (the warm bounce mixes the snow, then ramps it), `mix` when it wants a fill
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const mix = (a, b, t) => css(lerp3(a, b, t));

function face(fill) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const x = cv.getContext('2d');
  fill(x);
  return cv;
}
// one row of a face, so the three fills below read as three one-liners
const row = (x, y, c) => { x.fillStyle = c; x.fillRect(0, y, N, 1); };

// The six faces in three's cube order: +X, −X, +Y, −Y, +Z, −Z (Texture.image is
// an ARRAY for a CubeTexture and `isCubeTextureComplete` wants all six).
export function makeEnv(THREE, o = {}) {
  const z = rgb(o.zenith ?? SKY.zenith), m = rgb(o.mid ?? SKY.mid);
  const h = rgb(o.horizon ?? SKY.horizon), s = rgb(o.snow ?? SKY.snow);
  // §3.4 — the snow the lower third bounces back up, warmed 8 % toward the key.
  // It is a mix of the WORLD's snow, not a literal, so a world with blue snow
  // still bounces blue snow — just a warmer blue.
  const w = lerp3(s, rgb(WARM), WARM_MIX);
  // a side face: sky mid → horizon down to v = 0.5, then snow, with the rows
  // either side of the split dithered so the step is broken up rather than a line,
  // and the lower third ramped from snow to the warm bounce (§3.4)
  const side = () => face((x) => {
    const half = N / 2;
    for (let y = 0; y < N; y++) {
      if (y < half - SEAM) row(x, y, mix(m, h, y / (half - SEAM)));
      else if (y >= half + SEAM) row(x, y, y < BOUNCE ? css(s) : mix(s, w, (y - BOUNCE) / (N - BOUNCE)));
      else {
        // the seam band, per texel: an ordered-dither threshold on the ramp from
        // horizon sky to snow, so a rough metal reads a stipple instead of a band
        const t = (y - (half - SEAM)) / (2 * SEAM);
        for (let u = 0; u < N; u++) {
          x.fillStyle = t > BAYER[(u & 3) + 4 * (y & 3)] ? css(s) : mix(h, s, t);
          x.fillRect(u, y, 1, 1);
        }
      }
    }
  });
  // §3.4 — +Y gains its THIRD stop: zenith → mid over the upper half, mid →
  // horizon over the lower. Two stops put the whole sky on one straight line in
  // RGB, which a 64² PMREM chain is now sharp enough to show as a flat gradient
  // on a clearcoat; three is the shape a real sky has.
  const half = N / 2;
  const up = face((x) => { for (let y = 0; y < N; y++) row(x, y, y < half ? mix(z, m, y / half) : mix(m, h, (y - half) / (N - half - 1 || 1))); });
  const down = face((x) => { x.fillStyle = css(s); x.fillRect(0, 0, N, N); });
  const env = new THREE.CubeTexture([side(), side(), up, down, side(), side()]);
  env.colorSpace = THREE.SRGBColorSpace;
  env.needsUpdate = true;
  return env;
}

// One env per scene. `scene.background` is a Color on every play world
// (loader.js:106 and the run's own env.mjs), and `scene.fog.color` is fx.js's
// horizon tint — both are read when present so the rider reflects the world it
// is actually in, and SKY's literals are the fallback for a scene that has
// neither (the locker's own, and every headless probe).
const _envs = new WeakMap();
let _def = null;
// SKY's own literals, built once and shared: the locker's scene, every headless
// probe and the moment before a rig is added to a world. A metal with no envMap
// is black, so there is always one.
export function defaultEnv(THREE) {
  if (!_def) _def = makeEnv(THREE);
  return _def;
}
export function envFor(THREE, scene) {
  if (!scene) return defaultEnv(THREE);
  let e = _envs.get(scene);
  if (e) return e;
  const bg = scene.background && scene.background.isColor ? scene.background.getHex() : null;
  const fog = scene.fog && scene.fog.color ? scene.fog.color.getHex() : null;
  e = bg == null && fog == null ? defaultEnv(THREE) : makeEnv(THREE, { mid: bg ?? undefined, horizon: fog ?? bg ?? undefined });
  _envs.set(scene, e);
  return e;
}
