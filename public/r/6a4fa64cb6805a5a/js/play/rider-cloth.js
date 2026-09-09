import { sharedClothTexture, CLOTH_TILE_METERS, CLOTH_TEXTURE_SIZE } from './rider-cloth-texture.js';

export const CLOTH_PROFILES = Object.freeze({
  shell: { roughness: 0.84, sheen: 0.16, relief: 0.000035 },
  panel: { roughness: 0.91, sheen: 0.10, relief: 0.000028 },
  pants: { roughness: 0.89, sheen: 0.12, relief: 0.00004 },
});

const fragmentDeclarations = `
varying vec3 vClothPosition;
varying vec3 vClothNormal;
uniform float riderClothEnabled;
uniform float riderClothScale;
uniform float riderClothRelief;
uniform sampler2D riderClothMap;
uniform float riderClothTile;
vec2 riderClothPattern(vec2 coordinate) {
  vec2 weavePhase = coordinate * 7853.981634;
  vec2 weaveFilter = 1.0 - smoothstep(vec2(0.6), vec2(2.5), fwidth(weavePhase));
  vec2 weave = sin(weavePhase) * weaveFilter;
  vec2 gridPhase = coordinate * 1047.197551;
  vec2 gridFilter = 1.0 - smoothstep(vec2(0.15), vec2(1.1), fwidth(gridPhase));
  vec2 grid = pow(0.5 + 0.5 * cos(gridPhase), vec2(8.0));
  grid = mix(vec2(0.19638), grid, gridFilter);
  return vec2((weave.x + weave.y) * 0.25, (grid.x + grid.y) * 0.5 - 0.19638);
}
`;

export function applyRiderCloth(material, name, unitScale = 1, THREE) {
  const profile = CLOTH_PROFILES[name];
  if (!profile) return material;
  if (!(unitScale > 0) || !Number.isFinite(unitScale)) throw new Error('Invalid rider cloth unit scale');
  if (!THREE) throw new Error('Cloth texture requires THREE');
  material.roughness = profile.roughness;
  material.clearcoat = 0;
  material.sheen = profile.sheen;
  material.sheenRoughness = 0.85;
  material.sheenColor.copy(material.color).lerp({ r: 1, g: 1, b: 1 }, 0.15);
  const uniforms = {
    riderClothEnabled: { value: 1 },
    riderClothScale: { value: unitScale },
    riderClothRelief: { value: profile.relief },
    riderClothMap: { value: sharedClothTexture(THREE) },
    riderClothTile: { value: CLOTH_TILE_METERS },
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vClothPosition;
varying vec3 vClothNormal;
uniform float riderClothScale;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vClothPosition = position / riderClothScale;
vClothNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${fragmentDeclarations}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec3 clothBlend = pow(abs(normalize(vClothNormal)), vec3(4.0));
clothBlend /= max(dot(clothBlend, vec3(1.0)), 0.00001);
vec2 clothPattern = riderClothPattern(vClothPosition.yz) * clothBlend.x
  + riderClothPattern(vClothPosition.xz) * clothBlend.y
  + riderClothPattern(vClothPosition.xy) * clothBlend.z;
clothPattern *= riderClothEnabled;
vec3 clothTexel = texture2D(riderClothMap, vClothPosition.yz / riderClothTile).rgb * clothBlend.x
  + texture2D(riderClothMap, vClothPosition.xz / riderClothTile).rgb * clothBlend.y
  + texture2D(riderClothMap, vClothPosition.xy / riderClothTile).rgb * clothBlend.z;
diffuseColor.rgb *= 1.0 + clothPattern.x * 0.025 + clothPattern.y * 0.035;
diffuseColor.rgb *= 1.0 + (clothTexel.b - 0.5) * 0.16 * riderClothEnabled;
float clothHeight = (clothPattern.x + clothPattern.y * 0.6 + (clothTexel.r - 0.43) * riderClothEnabled) * riderClothRelief * riderClothScale;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + clothPattern.x * 0.04 + clothPattern.y * 0.025 + (clothTexel.g - 0.5) * 0.22 * riderClothEnabled, 0.65, 1.0);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 clothDx = dFdx(-vViewPosition);
vec3 clothDy = dFdy(-vViewPosition);
vec3 clothTangent = cross(clothDy, normal);
vec3 clothBitangent = cross(normal, clothDx);
float clothDeterminant = dot(clothDx, clothTangent);
vec3 clothGradient = sign(clothDeterminant) *
  (dFdx(clothHeight) * clothTangent + dFdy(clothHeight) * clothBitangent);
normal = normalize(abs(clothDeterminant) * normal - clothGradient + normal * 0.0000000001);`);
  };
  material.customProgramCacheKey = () => `${previousKey}|rider-cloth-v2`;
  material.userData.riderCloth = { profile: name, uniforms, textureSamples: 3, textures: 1, shared: true, textureBytesWithMips: Math.ceil(CLOTH_TEXTURE_SIZE ** 2 * 4 * 4 / 3) };
  material.needsUpdate = true;
  return material;
}
