const DEFAULT_GAIN = 0;
const DEFAULT_DARK = .18;
const DEFAULT_RIM = .10;

function blankTrackMap(THREE) {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'snow-tracks:blank';
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function applySnowTracks(THREE, material, { mask = '1.0 - rock', up = 'z' } = {}) {
  if (material.userData.snowTracks) return material.userData.snowTracks;

  const uniforms = {
    snowTracksMap: { value: blankTrackMap(THREE) },
    snowTracksWindow: { value: new THREE.Vector3(0, 0, 64) },
    snowTracksGain: { value: DEFAULT_GAIN },
    snowTracksDark: { value: DEFAULT_DARK },
    snowTracksRim: { value: DEFAULT_RIM }
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const trackDepth = material.userData.groomedSnow ? 'mix(.015, .004, clamp(groomedMask, 0.0, 1.0))' : '.015';

  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 snowTracksWorldPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        snowTracksWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        snowTracksWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 snowTracksWorldPosition;
      uniform sampler2D snowTracksMap;
      uniform vec3 snowTracksWindow;
      uniform float snowTracksGain;
      uniform float snowTracksDark;
      uniform float snowTracksRim;
      vec3 snowTracksGradientNormal(vec3 surfacePosition, vec3 surfaceNormal, float surfaceHeight) {
        vec3 across = dFdx(surfacePosition);
        vec3 along = dFdy(surfacePosition);
        vec3 first = cross(along, surfaceNormal);
        vec3 second = cross(surfaceNormal, across);
        float determinant = dot(across, first);
        vec3 gradient = sign(determinant) * (dFdx(surfaceHeight) * first + dFdy(surfaceHeight) * second);
        return normalize(max(abs(determinant), 1e-10) * surfaceNormal - gradient);
      }
    `);

    const insertion = `
      if (snowTracksGain > 0.0) {
        vec2 snowTracksUv = (snowTracksWorldPosition.xz - snowTracksWindow.xy) / max(snowTracksWindow.z, .001) + .5;
        float snowTracksInside = step(0.0, snowTracksUv.x) * step(snowTracksUv.x, 1.0)
          * step(0.0, snowTracksUv.y) * step(snowTracksUv.y, 1.0);
        vec2 snowTracksSample = texture2D(snowTracksMap, clamp(snowTracksUv, 0.0, 1.0)).rg;
        float snowTracksMask = snowTracksInside * clamp(${mask}, 0.0, 1.0) * clamp(snowTracksGain, 0.0, 1.0);
        float snowTracksInk = snowTracksSample.r * snowTracksMask;
        float snowTracksLip = snowTracksSample.g * snowTracksMask;
        float snowTracksDepth = ${trackDepth};
        float snowTracksHeight = snowTracksLip * .010 - snowTracksInk * snowTracksDepth;
        normal = normalize(mix(normal, nonPerturbedNormal, clamp(snowTracksInk * .65, 0.0, .65)));
        normal = snowTracksGradientNormal(-vViewPosition, normal, snowTracksHeight);
        diffuseColor.rgb *= 1.0 - snowTracksInk * snowTracksDark;
        diffuseColor.rgb += snowTracksLip * snowTracksRim;
        roughnessFactor = clamp(roughnessFactor + snowTracksInk * .035 - snowTracksLip * .025, 0.0, 1.0);
      }
    `;
    const afterSnowAnchor = '#include <clearcoat_normal_fragment_begin>';
    if (shader.fragmentShader.includes(afterSnowAnchor)) {
      shader.fragmentShader = shader.fragmentShader.replace(afterSnowAnchor, `${insertion}\n${afterSnowAnchor}`);
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${insertion}`);
    }
  };

  material.customProgramCacheKey = () => `${previousKey}:snow-tracks-v1:${up}:${mask}`;
  const controls = {
    uniforms,
    budget: { fragmentTextureSamples: 1, addedTriangles: 0, addedDrawCalls: 0, addedTextures: 0 },
    setMap(texture) { uniforms.snowTracksMap.value = texture || controls.blankMap; },
    setWindow(centerX, centerZ, span) { uniforms.snowTracksWindow.value.set(centerX, centerZ, Math.max(.001, span)); },
    blankMap: uniforms.snowTracksMap.value
  };
  material.userData.snowTracks = controls;
  material.needsUpdate = true;
  return controls;
}

export function installSnowTrackBridge(controls, target = globalThis.window) {
  if (!controls?.uniforms || !target) return null;
  const look = target.__look || {};
  if (!target.__look) target.__look = look;
  const { uniforms } = controls;

  const chainFunction = (name, callback) => {
    const descriptor = Object.getOwnPropertyDescriptor(look, name);
    const previous = typeof look[name] === 'function' ? look[name] : null;
    const chained = (...args) => {
      if (previous) previous.apply(look, args);
      callback(...args);
    };
    if (!descriptor || descriptor.configurable) Object.defineProperty(look, name, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value: chained });
    else if ('value' in descriptor && descriptor.writable) look[name] = chained;
    else if (descriptor.set) descriptor.set.call(look, chained);
  };
  chainFunction('tracksMap', texture => controls.setMap(texture));
  chainFunction('tracksWindow', (centerX, centerZ, span) => controls.setWindow(centerX, centerZ, span));

  for (const [name, uniform, maximum] of [
    ['TRACKS_GAIN', uniforms.snowTracksGain, 1],
    ['TRACKS_DARK', uniforms.snowTracksDark, 2],
    ['TRACKS_RIM', uniforms.snowTracksRim, 2]
  ]) {
    const prior = Object.getOwnPropertyDescriptor(look, name);
    let priorValue;
    try { priorValue = look[name]; } catch { priorValue = undefined; }
    if (Number.isFinite(+priorValue)) uniform.value = Math.max(0, Math.min(maximum, +priorValue));
    if (prior && !prior.configurable) continue;
    const previousSet = prior?.set;
    Object.defineProperty(look, name, {
      configurable: true,
      enumerable: prior?.enumerable ?? true,
      get: () => uniform.value,
      set: value => {
        const numeric = +value;
        if (!Number.isFinite(numeric)) return;
        const bounded = Math.max(0, Math.min(maximum, numeric));
        if (previousSet) previousSet.call(look, bounded);
        uniform.value = bounded;
      }
    });
  }
  return look;
}
