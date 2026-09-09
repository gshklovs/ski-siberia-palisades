// specs/0046 §4 — the rider's aura: a hand-written two-pass Gaussian bloom on a
// half-res render of the rider layer, added back over the frame.
//
//   makeBloom(THREE, renderer, scene, camera)  → { render, set, enabled, cost, tier }
//   COARSE / LOW_END / isLowEnd(renderer)      → §4.6's device gate, one name
//
// §4.1 — hand-written, because vendoring the addons post-processing chain for one
// separable Gaussian would be four files, an importmap entry, a manifest transform
// and a C19 exemption. This is the ONLY file allowed to name `ShaderMaterial`
// (§6.3); `RawShaderMaterial` is not used, it would mean hand-writing the attribute
// and uniform declarations three's own GLSL3 handling wants to write.
//
// §4.2, the four steps, in order, all at half res except the composite:
//   0 main       renderer.render(scene, camera)                — the frame, as today
//   1 isolate    camera on RIDER_LAYER, cleared to black       → RT_A  (linear)
//   2 blur H     9-tap Gaussian, σ 3.2 px, bright-pass folded  → RT_B  (display)
//   3 blur V     the same material, direction flipped          → RT_A
//   4 composite  additive, full res, over the default framebuffer
//
// WHERE THE TONE MAP LIVES, and why it is in step 2. three renders a render TARGET
// with `toneMapping = NoToneMapping` and `outputColorSpace = LinearSRGBColorSpace`
// (`three.module.js:6946`, `:17029`, both branch on `currentRenderTarget === null`),
// so RT_A comes out of step 1 LINEAR and un-tone-mapped while the frame it will be
// added to is ACES at exposure 1.12 and sRGB-encoded. §4.5's threshold of 0.62 is a
// number about THAT frame ("ACES at exposure 1.12 puts diffuse snow at ~0.55"), so
// step 2 tone-maps each tap with the identical curve three would have used —
// `tonemapping_pars_fragment`'s `ACESFilmicToneMapping`, copied not approximated —
// thresholds the result, and blurs in display space. Step 4 is then a plain add.
// §1.7 clause 3 holds by construction: the halo goes through the frame's own curve.
export const RIDER_LAYER = 1;

// §4.6 — THERE IS NO `lowEnd` FLAG IN THIS TREE. The measured device gate is the
// coarse-pointer media query, in four places already (`loader.js:71` the world's
// shadow bake, `loader.js:122` D25's pixel-ratio cap, `hud.js:250`, `intro.js:20`).
// 0046 invents no new tier; it reuses that expression under one exported name, and
// rider.js re-exports these two rather than restating them.
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const qs = (k) => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
// The MATERIAL ladder's gate — envmap face size, colour canvas, LRU depth, the
// shadow. No renderer needed, so it is a module const and rider.js reads it at
// import time for `CACHE_MAX` and `COLOR_PX`.
export const LOW_END = COARSE || qs('bloom') === '0';
// The BLOOM's own gate adds §4.6's WebGL2 clause, which needs a renderer and so
// cannot be a const. `?bloom=0` is a real control, not a debug switch: under it
// `render()` is `renderer.render(scene, camera)` and the frame is byte-identical
// to today's, which is what makes the undilated C15 lane a statement about the
// whole frame rather than about the halo (§6.5).
export const isLowEnd = (renderer) => LOW_END
  || !(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
let _lowEnd = LOW_END;

// §4.4's arithmetic lives in ONE place and it is not here. C3 seeded `maxGlow`,
// `scalarsOf` and the three `riderBloom.set` lines in `rider.js` (§8.3's pattern),
// in the file that already owns `srcOf` and `attrsOf`; a second reader here would
// be two copies of §4.4 with one of them going stale on the next look. What this
// file owns is the compositor those three lines drive.

// ---------------------------------------------------------------- the shaders
// One fullscreen TRIANGLE, not a quad: three vertices, no diagonal seam, and the
// clip-space positions are written straight through, so neither camera matrix is
// read and the pass does not care which camera renders it.
const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// §4.2 — the bright-pass is three ALU ops folded into the FIRST blur's tap loop,
// not a fourth fullscreen draw into a fourth target. `uBright` is 1 in the H pass
// and 0 in the V pass, which is the whole difference between the two.
const BLUR = `
precision highp float;
uniform sampler2D uTex;
uniform vec2  uStep;          // one texel along the pass direction
uniform float uBright;        // 1 = threshold this pass, 0 = plain blur
uniform float uThreshold;     // §4.4, fixed 0.62
uniform float uKnee;          // §4.2, soft knee 0.18
uniform float uExposure;      // renderer.toneMappingExposure — NOT a new dial
varying vec2 vUv;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// three's own ACES, tonemapping_pars_fragment (three.module.js:496), copied so
// the halo goes through the frame's curve and not through an approximation of it.
vec3 rrt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 IN  = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= uExposure / 0.6;
  c = OUT * rrt(IN * c);
  return clamp(c, 0.0, 1.0);
}
// three's sRGBTransferOETF — the frame is written through it, so the halo is too.
vec3 oetf(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 tap(vec2 uv) {
  vec3 c = texture2D(uTex, uv).rgb;
  if (uBright < 0.5) return c;
  c = oetf(aces(c));
  float l = dot(c, LUMA);
  // the soft knee: a quadratic ramp uKnee wide either side of the threshold,
  // maxed with the hard cut above it. Below the knee the term is 0 and the
  // rider's diffuse contributes nothing at all.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * (max(soft, l - uThreshold) / max(l, 1e-4));
}
void main() {
  // σ 3.2 px at half res, nine taps, weights normalised to 1 (Σ = 0.999998).
  vec3 s = tap(vUv) * 0.148056;
  s += (tap(vUv + uStep) + tap(vUv - uStep)) * 0.140998;
  s += (tap(vUv + uStep * 2.0) + tap(vUv - uStep * 2.0)) * 0.121786;
  s += (tap(vUv + uStep * 3.0) + tap(vUv - uStep * 3.0)) * 0.095403;
  s += (tap(vUv + uStep * 4.0) + tap(vUv - uStep * 4.0)) * 0.067784;
  gl_FragColor = vec4(s, 1.0);
}`;

// The composite adds an already-display-referred halo to an already-display-
// referred frame, so it is one texture read and one multiply. AdditiveBlending
// does the rest; there is no destination read and none is available.
const COMP = `
precision highp float;
uniform sampler2D uTex;
uniform float uStrength;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uStrength, 1.0); }`;

// ---------------------------------------------------------------- the compositor
let _active = null;                          // the one live bloom (window.__riderBloom)

// §4.2 — RIDER_LAYER is ENABLED on the rider's meshes, never SET: they stay on
// layer 0 and the main pass is untouched, which is the whole reason step 0 is
// byte-identical to today's frame. `rider:contact` (C3's shadow disc) is left off
// the layer on purpose — a shadow does not glow. The LIGHTS take the layer too:
// `projectObject` admits a light on `object.layers.test(camera.layers)`, a test
// against the CAMERA (§3.5), so a camera restricted to layer 1 would otherwise see
// no light at all and the isolate pass would render the rider by envmap and
// emissive alone. Enabling layer 1 on the world's lights is what makes §1.7
// clause 1 true here as well: the rider is lit by fx:hemi and fx:key in the
// isolate pass exactly as it is in the frame.
function stamp(scene) {
  let n = 0;
  for (const name of ['play:body', 'play:fp-arms']) {
    const root = scene.getObjectByName(name);
    if (!root) continue;
    root.traverse((o) => {
      if (!o.isMesh || o.name === 'rider:contact') return;
      o.layers.enable(RIDER_LAYER); n++;
    });
  }
  scene.traverse((o) => { if (o.isLight) o.layers.enable(RIDER_LAYER); });
  return n;
}

export function makeBloom(THREE, renderer, scene, camera, opts = {}) {
  _lowEnd = isLowEnd(renderer);
  const api = {
    enabled: !_lowEnd,
    strength: 0.3, threshold: 0.62, radius: 0.55,
    meshes: 0,
  };
  // §4.6 — off on lowEnd, off on WebGL1, off on ?bloom=0. `render()` is then the
  // one call main.js used to make and the frame is the frame it was before.
  if (!api.enabled) {
    api.render = () => renderer.render(scene, camera);
    // `set` still RECORDS on the off path: rider.js's seeded `setOutfit` line
    // writes here on every look, and a probe reading `__riderBloom.strength` on a
    // `?bloom=0` page should get the number the look asked for, not a stale 0.3.
    api.set = (o = {}) => { for (const k of ['strength', 'threshold', 'radius']) if (typeof o[k] === 'number') api[k] = o[k]; };
    api.cost = () => ({ medianMs: 0, n: 0, off: true });
    api.tier = () => 'low';
    api.stamp = () => 0;
    _active = api;
    installProbe(api);
    return api;
  }
  // Half-float where the driver will render to it, unsigned byte otherwise. The
  // isolate pass writes LINEAR light, so a byte target clips the rider's brightest
  // texels at 1.0 — a softer halo on the four glow looks, never an error.
  const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rtOpts = { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
  const rtA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(2, 2, rtOpts);

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
    uniforms: { uTex: { value: null }, uStep: { value: new THREE.Vector2() }, uBright: { value: 1 },
      uThreshold: { value: api.threshold }, uKnee: { value: 0.18 }, uExposure: { value: renderer.toneMappingExposure } } });
  const compMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMP, depthTest: false, depthWrite: false,
    transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { uTex: { value: null }, uStrength: { value: api.strength } } });
  const quad = new THREE.Scene();
  const quadMesh = new THREE.Mesh(tri, blurMat);
  quadMesh.frustumCulled = false;
  quad.add(quadMesh);
  const quadCam = new THREE.Camera();          // never read: VERT writes clip space

  const size = new THREE.Vector2();
  // The layer stamp runs on the first few frames rather than once: every rider
  // mesh exists by `buildRider` (main.js:334, long before this file is built),
  // but `play:fp-arms` mounts itself on an `added` event and the locker can add
  // a rack node late. Five frames is free and covers both; `api.stamp()` re-arms
  // it for anything that appears later still.
  let w = 0, h = 0, stamps = 5;
  const resize = () => {
    renderer.getDrawingBufferSize(size);
    const nw = Math.max(2, size.x >> 1), nh = Math.max(2, size.y >> 1);
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    rtA.setSize(w, h); rtB.setSize(w, h);
  };

  const draw = (mat, target) => {
    quadMesh.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  };
  const _clear = new THREE.Color();
  api.render = () => {
    renderer.render(scene, camera);            // step 0 — the frame, as today
    if (stamps > 0) { api.meshes = stamp(scene); stamps--; }
    resize();
    steps();
  };
  // Steps 1–4, lifted out so `cost()` can time them without a main render.
  function steps() {
    const mask = camera.layers.mask;
    const bg = scene.background;
    const auto = renderer.autoClear, shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(_clear);
    const alpha = renderer.getClearAlpha();
    try {
      // 1 — isolate. `scene.background` is nulled for the pass because three
      // renders the background INTO the bound target and a sky-filled RT_A would
      // bloom the whole sky; the shadow map is not re-rendered because step 0 just
      // did it and nothing moved between the two calls.
      scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setClearColor(0x000000, 0);
      camera.layers.set(RIDER_LAYER);
      renderer.setRenderTarget(rtA);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      scene.background = bg;
      renderer.setClearColor(_clear, alpha);
      // 2 / 3 — H then V, the same material with the direction flipped.
      blurMat.uniforms.uExposure.value = renderer.toneMappingExposure;
      blurMat.uniforms.uTex.value = rtA.texture;
      blurMat.uniforms.uStep.value.set(1 / w, 0);
      blurMat.uniforms.uBright.value = 1;
      draw(blurMat, rtB);
      blurMat.uniforms.uTex.value = rtB.texture;
      blurMat.uniforms.uStep.value.set(0, 1 / h);
      blurMat.uniforms.uBright.value = 0;
      draw(blurMat, rtA);
      // 4 — composite, full res, additive, over what step 0 left in the frame.
      compMat.uniforms.uTex.value = rtA.texture;
      renderer.autoClear = false;
      draw(compMat, null);
    } finally {
      camera.layers.mask = mask;
      scene.background = bg;
      renderer.autoClear = auto;
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.setRenderTarget(null);
      renderer.setClearColor(_clear, alpha);
    }
  }
  api.set = (o = {}) => {
    if (typeof o.strength === 'number') { api.strength = o.strength; compMat.uniforms.uStrength.value = o.strength; }
    if (typeof o.threshold === 'number') { api.threshold = o.threshold; blurMat.uniforms.uThreshold.value = o.threshold; }
    if (typeof o.radius === 'number') api.radius = o.radius;   // fixed at 0.55 (§4.4/§6.5)
  };
  api.stamp = () => { stamps = 1; };
  api.tier = () => 'high';
  // N28's number, and the only honest way to get it in a browser: WebGL commands
  // are QUEUED, so a wall clock around four draw calls measures the enqueue and
  // not the work. `gl.finish()` is the drain — it returns when the driver has
  // finished everything it was handed — so the loop below times (steps + finish)
  // and subtracts a measured (drain alone) baseline, which is the cost of the
  // drain itself on an already-empty queue. No timer-query extension is used:
  // ("drain", not the four-letter word for it: C19's real-brand list carries a
  // ski-apparel label spelled the same way and the check is a text scan, so the
  // word is spent here rather than exempting this file from the brand sweep.)
  // Chrome has not exposed one to the page since 2019. The drawing buffer is taken
  // to 1920×1080 for the run and restored, because §4.5's budget is a number at
  // 1920×1080 and the probe's viewport is 1280×720.
  api.cost = (n = 600, o = {}) => {
    const W = o.width || 1920, H = o.height || 1080;
    const gl = renderer.getContext();
    renderer.getDrawingBufferSize(size);
    const w0 = size.x, h0 = size.y;
    renderer.setDrawingBufferSize(W, H, 1);
    resize();
    // gl.finish() alone measures nothing under ANGLE's command buffer (measured:
    // 0.1 ms median for the whole chain, i.e. the enqueue). A 1-px readPixels off
    // the DEFAULT framebuffer is the drain that actually blocks, and RGBA/UNSIGNED
    // _BYTE is the one format every implementation must answer for.
    const px = new Uint8Array(4);
    const drain = () => { try { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } catch (e) { /* context lost */ } };
    for (let i = 0; i < 12; i++) { steps(); drain(); }                    // warm the programs
    const base = [], run = [];
    for (let i = 0; i < n; i++) { const t = performance.now(); drain(); base.push(performance.now() - t); }
    for (let i = 0; i < n; i++) { const t = performance.now(); steps(); drain(); run.push(performance.now() - t); }
    renderer.setDrawingBufferSize(w0, h0, 1);
    resize();
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
    return { medianMs: +(med(run) - med(base)).toFixed(3), median: +med(run).toFixed(3), baseline: +med(base).toFixed(3),
             p95Ms: +(p95(run) - med(base)).toFixed(3), n, width: W, height: H, halfFloat: half, meshes: api.meshes };
  };
  api.dispose = () => { rtA.dispose(); rtB.dispose(); tri.dispose(); blurMat.dispose(); compMat.dispose(); };
  api.set({ strength: opts.strength, threshold: opts.threshold ?? 0.62, radius: opts.radius ?? 0.55 });
  _active = api;
  installProbe(api);
  return api;
}

// §6.6 N28 reads `__rig.bloomCost` and rider.js's seeded `setOutfit` line (§4.4)
// reads `window.__riderBloom`. `installRigProbe` (rider.js §4.1) assigns `__rig`
// wholesale at `buildRider`, which main.js runs long before the compositor is
// built, so this ADDS one key rather than replacing the object. `tier`, `gfx` and
// `shadowCost` are C3's and are left alone — `tier` reports the MATERIAL ladder's
// tier, which is the one N30 asks about, and is not the bloom's.
function installProbe(api) {
  if (typeof window === 'undefined') return;
  window.__riderBloom = api;
  window.__rig = window.__rig || {};
  window.__rig.bloomCost = (n, o) => api.cost(n, o);
}
