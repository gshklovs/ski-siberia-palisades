import { snowRegionGLSL } from './snow-regions.mjs';

const textures = new WeakMap();
const powderTextures = new WeakMap();
const groomedTextures = new WeakMap();

export function createSnowTexture(THREE, { powder = false } = {}) {
  const cache = powder ? powderTextures : textures;
  if (cache.has(THREE)) return cache.get(THREE);
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const hash = (east, north) => {
    let value = Math.imul(east + 73, 374761393) ^ Math.imul(north + 91, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  function noise(east, north, frequency) {
    const across = east * frequency, along = north * frequency;
    const column = Math.floor(across), row = Math.floor(along);
    const fractionEast = across - column, fractionNorth = along - row;
    const blendEast = fractionEast * fractionEast * (3 - 2 * fractionEast);
    const blendNorth = fractionNorth * fractionNorth * (3 - 2 * fractionNorth);
    const sample = (offsetEast, offsetNorth) => hash((column + offsetEast) % frequency, (row + offsetNorth) % frequency);
    return (sample(0, 0) * (1 - blendEast) + sample(1, 0) * blendEast) * (1 - blendNorth)
      + (sample(0, 1) * (1 - blendEast) + sample(1, 1) * blendEast) * blendNorth;
  }
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const east = column / size, north = row / size;
    const broad = noise(east, north, 8);
    const phase = Math.PI * 2 * (18 * east + 2 * north) + (broad - .5) * 5;
    const ridge = Math.sin(phase) * .16 + Math.sin(phase * 2 + 1.3) * .045;
    const offset = (row * size + column) * 4;
    heights[row * size + column] = .028 * (ridge * (.35 + broad * .65) + (noise(east, north, 32) - .5) * .08);
    if (powder) {
      const clumps = noise(east, north, 16);
      const crust = noise(east, north, 64);
      const rounded = Math.max(0, clumps - .28);
      heights[row * size + column] = .24 * rounded * rounded + .045 * broad + .009 * crust;
    }
    data[offset + 2] = Math.round(255 * (.7 * broad + .3 * noise(east, north, 32)));
    data[offset + 3] = Math.round(255 * hash(column + 819, row + 273));
  }
  const encode = slope => Math.round(255 * (.5 + Math.max(-1, Math.min(1, slope / .24)) * .5));
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const offset = (row * size + column) * 4;
    const across = (heights[row * size + (column + 1) % size] - heights[row * size + (column + size - 1) % size]) / (16 / size);
    const along = (heights[((row + 1) % size) * size + column] - heights[((row + size - 1) % size) * size + column]) / (16 / size);
    data[offset] = encode(across);
    data[offset + 1] = encode(along);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = powder ? 'Snow surface / rounded powder, broken crust, grains' : 'Snow surface / wind, grains, crust, facets';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(THREE, texture);
  return texture;
}

export function createGroomedV4Texture(THREE) {
  if (groomedTextures.has(THREE)) return groomedTextures.get(THREE);
  const size = 512;
  const tileMeters = 3.84;
  const sourceSpacing = .04;
  const sourceRelief = .005;
  const heights = new Float32Array(size * size);
  const profiles = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  const smoothstep = value => {
    const bounded = Math.max(0, Math.min(1, value));
    return bounded * bounded * (3 - 2 * bounded);
  };
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const east = column / size * tileMeters;
    const north = row / size * tileMeters;
    const phase = (east / sourceSpacing) % 1;
    const ridge = smoothstep(1 - Math.abs(phase - .5) * 2) ** 1.55;
    const fine = .0002 * Math.sin(Math.PI * 2 * (5 * north + 2 * east) / tileMeters);
    const offset = row * size + column;
    heights[offset] = sourceRelief * ridge + fine * (.25 + .75 * ridge);
    profiles[offset] = ridge;
  }
  const pixelStep = tileMeters / size;
  const encodeNormal = value => Math.round(255 * (value * .5 + .5));
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const previousRow = (row + size - 1) % size;
    const nextRow = (row + 1) % size;
    const previousColumn = (column + size - 1) % size;
    const nextColumn = (column + 1) % size;
    const slopeEast = (heights[row * size + nextColumn] - heights[row * size + previousColumn]) / (2 * pixelStep);
    const slopeNorth = (heights[nextRow * size + column] - heights[previousRow * size + column]) / (2 * pixelStep);
    const length = Math.hypot(slopeEast, slopeNorth, 1);
    const ridge = profiles[row * size + column];
    const roughness = Math.max(.77, Math.min(.92, .895 - .085 * ridge + .009 * Math.sin(Math.PI * 2 * row / size * 5)));
    const offset = (row * size + column) * 4;
    data[offset] = encodeNormal(-slopeEast / length);
    data[offset + 1] = encodeNormal(-slopeNorth / length);
    data[offset + 2] = encodeNormal(1 / length);
    data[offset + 3] = Math.round(255 * roughness);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Groomed v4 packed tangent normal / roughness';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.userData.referenceAsset = 'showcase/groomed-v4-normalroughness.png';
  texture.userData.referenceAssetBytes = 60854;
  texture.userData.generation = 'Synchronous procedural reconstruction of the v4 recipe; no runtime asset fetch';
  texture.userData.sourceTileMeters = tileMeters;
  texture.userData.sourceSpacingMeters = sourceSpacing;
  texture.userData.sourceReliefMeters = sourceRelief;
  texture.needsUpdate = true;
  groomedTextures.set(THREE, texture);
  return texture;
}

export function applySnowSurface(THREE, material, { up = 'z', mask = '1.0', enabled = true, alpinePolish = false } = {}) {
  if (material.userData.snowSurface) return material.userData.snowSurface;
  const uniforms = {
    snowSurfaceMap: { value: createSnowTexture(THREE, { powder: alpinePolish }) },
    snowSurfaceEnabled: { value: enabled ? 1 : 0 },
    snowWindStrength: { value: 1 },
    snowGrainStrength: { value: 1 }
  };
  if (alpinePolish) {
    uniforms.snowLegacyMap = { value: createSnowTexture(THREE) };
    uniforms.snowRegionOverride = { value: -1 };
  }
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 snowSurfacePlane;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 snowSurfacePosition = position;
      #ifdef USE_INSTANCING
        snowSurfacePosition = (instanceMatrix * vec4(position, 1.0)).xyz;
      #endif
      snowSurfacePlane = ${up === 'y' ? 'vec2(snowSurfacePosition.x, -snowSurfacePosition.z)' : 'snowSurfacePosition.xy'};
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 snowSurfacePlane;
      uniform sampler2D snowSurfaceMap;
      uniform float snowSurfaceEnabled;
      uniform float snowWindStrength;
      uniform float snowGrainStrength;
      ${alpinePolish ? `uniform sampler2D snowLegacyMap;
      uniform float snowRegionOverride;
      ${snowRegionGLSL}` : ''}
      vec3 snowGradientNormal(vec3 surfacePosition, vec3 surfaceNormal, vec2 fieldGradient) {
        vec3 across = dFdx(surfacePosition);
        vec3 along = dFdy(surfacePosition);
        vec3 first = cross(along, surfaceNormal);
        vec3 second = cross(surfaceNormal, across);
        float determinant = dot(across, first);
        float heightAcross = dot(fieldGradient, dFdx(snowSurfacePlane));
        float heightAlong = dot(fieldGradient, dFdy(snowSurfacePlane));
        vec3 gradient = sign(determinant) * (heightAcross * first + heightAlong * second);
        return normalize(max(abs(determinant), 1e-10) * surfaceNormal - gradient);
      }
    `);
    const mediumDistancePolish = alpinePolish ? `
      float snowMediumRange = 1.0 - smoothstep(420.0, 760.0, snowRange);
      float snowMediumFootprint = 1.0 - smoothstep(.16, 1.05, snowFootprint);
      float snowMediumFade = snowAmount * snowMediumRange * snowMediumFootprint * snowRegion;
      vec2 snowSweep = mat2(.9397, .3420, -.3420, .9397) * snowSurfacePlane;
      vec4 snowField = texture2D(snowSurfaceMap, snowSweep / 12.0 + vec2(.137, .419));
      vec4 snowDrift = texture2D(snowSurfaceMap, snowSweep / 48.0 + vec2(.683, .271));
      float snowLump = smoothstep(.36, .76, snowDrift.b) - smoothstep(.76, .94, snowDrift.b) * .38;
      float snowPit = smoothstep(.68, .91, 1.0 - snowField.b) * smoothstep(.35, .72, snowDrift.a);
      float snowCrustPlate = smoothstep(.48, .69, snowField.b) * (1.0 - smoothstep(.72, .88, snowField.b));
      vec2 snowBroadSlope = (snowDrift.rg * 2.0 - 1.0) * .12;
      snowBroadSlope += (snowField.rg * 2.0 - 1.0) * .20;
      snowBroadSlope = mat2(.9397, -.3420, .3420, .9397) * snowBroadSlope;
      vec3 snowBroadNormal = snowGradientNormal(-vViewPosition, normal, snowBroadSlope);
      normal = normalize(mix(normal, snowBroadNormal, snowMediumFade));
      float snowBroadShape = snowLump * .55 - snowPit * .62 + (snowField.b - .5) * .16;
      diffuseColor.rgb *= 1.0 + snowBroadShape * snowMediumFade * .014;
      float snowCrustRoughness = snowCrustPlate * .055 - snowPit * .025 + (snowDrift.a - .5) * .018;
      roughnessFactor = clamp(roughnessFactor + snowCrustRoughness * snowMediumFade, .72, .96);
    ` : '';
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (snowSurfaceEnabled > .5) {
      float snowAmount = clamp(${mask}, 0.0, 1.0) * snowSurfaceEnabled${material.userData.groomedSnow ? ' * (1.0 - clamp(groomedMask, 0.0, 1.0))' : ''};
      float snowRange = length(vViewPosition);
      float snowDetailFade = 1.0 - smoothstep(25.0, 90.0, snowRange);
      float snowFootprint = max(length(dFdx(snowSurfacePlane)), length(dFdy(snowSurfacePlane)));
      float snowGrainFade = (1.0 - smoothstep(4.0, 16.0, snowRange)) * (1.0 - smoothstep(.001, .006, snowFootprint));
      float snowWindFade = 1.0 - smoothstep(.015, .08, snowFootprint);
      float snowCrustFade = 1.0 - smoothstep(.004, .025, snowFootprint);
      vec4 snowWind = texture2D(snowSurfaceMap, snowSurfacePlane / 8.0);
      vec4 snowCrust = texture2D(snowSurfaceMap, snowSurfacePlane / 1.7 + vec2(.371, .613));
      vec4 snowGrain = texture2D(snowSurfaceMap, snowSurfacePlane / 1.5);
      ${alpinePolish ? `
      float snowRegion = snowRegionOverride < 0.0 ? snowRegionAt(snowSurfacePlane) : clamp(snowRegionOverride, 0.0, 1.0);
      snowWind = mix(texture2D(snowLegacyMap, snowSurfacePlane / 8.0), snowWind, snowRegion);
      snowCrust = mix(texture2D(snowLegacyMap, snowSurfacePlane / 1.7 + vec2(.371, .613)), snowCrust, snowRegion);
      snowGrain = mix(texture2D(snowLegacyMap, snowSurfacePlane / 1.5), snowGrain, snowRegion);
      ` : ''}
      vec2 snowSlope = (snowWind.rg * 2.0 - 1.0) * .24 * snowWindStrength * snowWindFade;
      snowSlope += (snowCrust.rg * 2.0 - 1.0) * ${alpinePolish ? 'mix(.035, .12, snowRegion)' : '.035'} * snowCrustFade;
      snowSlope += (snowGrain.ab - .5) * .14 * snowGrainStrength * snowGrainFade;
      vec3 snowPerturbed = snowGradientNormal(-vViewPosition, normal, snowSlope);
      normal = normalize(mix(normal, snowPerturbed, snowAmount * snowDetailFade));
      float snowRoughness = .76 + snowCrust.b * .15;
      snowRoughness -= smoothstep(.91, .99, snowGrain.a) * .36 * snowGrainFade;
      roughnessFactor = mix(roughnessFactor, snowRoughness, snowAmount);
      vec3 snowAlbedo = ${alpinePolish ? 'vec3(.91, .925, .94)' : 'vec3(.86, .89, .92)'} * (.989 + .011 * snowWind.b);
      diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, snowAmount * .72);
      ${mediumDistancePolish}
      }
    `);
  };
  material.customProgramCacheKey = () => alpinePolish ? `${previousKey}:snow-surface-v6-regions:${up}:${mask}` : `${previousKey}:snow-surface-v1:${up}:${mask}`;
  const controls = {
    uniforms,
    setEnabled(value) { uniforms.snowSurfaceEnabled.value = value ? 1 : 0; },
    setWind(value) { uniforms.snowWindStrength.value = Math.max(0, Math.min(2, value)); },
    setGrain(value) { uniforms.snowGrainStrength.value = Math.max(0, Math.min(2, value)); },
    setRegion(value) { if (alpinePolish) uniforms.snowRegionOverride.value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : -1; },
    budget: { textureBytesWithMips: Math.ceil(512 * 512 * 4 * 4 / 3) * (alpinePolish ? 2 : 1), fragmentTextureSamples: alpinePolish ? 8 : 3, addedTriangles: 0, addedDrawCalls: 0, addedTextures: alpinePolish ? 1 : 0 }
  };
  material.userData.snowSurface = controls;
  material.needsUpdate = true;
  return controls;
}

export function applyGroomedSnow(THREE, material, texture, { up = 'z', spacing = .06, relief = .0075, tint = '#ccdfeb', routeCoordinates = false, mask = '1.0', ridgeStrength = 1.4 } = {}) {
  if (material.userData.groomedSnow) return material.userData.groomedSnow;
  if (!routeCoordinates && mask === '1.0') material.color.set(tint);
  const uniforms = { groomedMap: { value: texture }, groomedSpacing: { value: spacing }, groomedRelief: { value: relief }, groomedTint: { value: new THREE.Color(tint) }, groomedRidgeStrength: { value: ridgeStrength } };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec2 groomedPlane;
      varying float groomedMask;
      ${routeCoordinates ? 'attribute vec2 groomedRoute; attribute float groomedRunMask;' : ''}
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      groomedPlane = ${routeCoordinates ? 'groomedRoute' : up === 'y' ? 'vec2(position.x, -position.z)' : 'position.xy'};
      groomedMask = ${routeCoordinates ? 'groomedRunMask' : '1.0'};
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 groomedPlane;
      varying float groomedMask;
      uniform sampler2D groomedMap;
      uniform float groomedSpacing;
      uniform float groomedRelief;
      uniform float groomedRidgeStrength;
      uniform vec3 groomedTint;
      vec3 groomedGradientNormal(vec3 surfacePosition, vec3 surfaceNormal, vec2 fieldGradient) {
        vec3 across = dFdx(surfacePosition);
        vec3 along = dFdy(surfacePosition);
        vec3 first = cross(along, surfaceNormal);
        vec3 second = cross(surfaceNormal, across);
        float determinant = dot(across, first);
        float heightAcross = dot(fieldGradient, dFdx(groomedPlane));
        float heightAlong = dot(fieldGradient, dFdy(groomedPlane));
        vec3 gradient = sign(determinant) * (heightAcross * first + heightAlong * second);
        return normalize(max(abs(determinant), 1e-10) * surfaceNormal - gradient);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float groomedAmount = clamp(groomedMask * (${mask}), 0.0, 1.0);
      float groomedFootprint = max(length(dFdx(groomedPlane)), length(dFdy(groomedPlane)));
      float groomedFade = (1.0 - smoothstep(groomedSpacing * .35, groomedSpacing * 1.35, groomedFootprint)) * groomedAmount;
      vec4 groomedSample = texture2D(groomedMap, vec2(groomedPlane.x / (groomedSpacing * 96.0), groomedPlane.y / (groomedSpacing * 96.0)));
      vec3 groomedTangentNormal = groomedSample.rgb * 2.0 - 1.0;
      vec2 groomedSlope = -groomedTangentNormal.xy / max(groomedTangentNormal.z, .1) * (.04 / max(groomedSpacing, .001));
      groomedSlope *= clamp(groomedRelief / .005, 0.0, 3.0) * groomedRidgeStrength;
      vec3 groomedNormal = groomedGradientNormal(-vViewPosition, normal, groomedSlope);
      normal = normalize(mix(normal, groomedNormal, groomedFade));
      float groomedRidge = clamp((.895 - groomedSample.a) / .085, 0.0, 1.0);
      float groomedRoughness = mix(.90, .72, groomedRidge);
      roughnessFactor = mix(roughnessFactor, mix(.85, groomedRoughness, groomedFade / max(groomedAmount, .001)), groomedAmount);
      float groomedTroughShade = mix(1.0, mix(.94, 1.0, groomedRidge), groomedFade);
      diffuseColor.rgb = mix(diffuseColor.rgb, groomedTint * groomedTroughShade, groomedAmount);
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}:groomed-runtime-v3-crisp:${up}:${spacing}:${relief}:${routeCoordinates}:${mask}`;
  material.needsUpdate = true;
  const textureBytes = texture.image?.data?.byteLength ?? 0;
  const controls = { uniforms, budget: { textureBytes, textureBytesWithMips: texture.generateMipmaps ? Math.ceil(textureBytes * 4 / 3) : textureBytes, referencePngBytes: texture.userData?.referenceAssetBytes ?? 0, runtimeTextureFetches: 0, fragmentTextureSamples: 1, addedTriangles: 0, addedDrawCalls: 0, addedTextures: 1 } };
  material.userData.groomedSnow = controls;
  return controls;
}
