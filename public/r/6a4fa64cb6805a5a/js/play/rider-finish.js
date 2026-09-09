export function riderFinishBinding(part, vertex) {
  if (/^polish-v7:boot-shell-[lr]$/.test(part.name)) {
    const phase = Math.max(0, Math.min(1, (part.positions[vertex * 3 + 1] - .018) / .018));
    return [1, 1 - phase * phase * (3 - 2 * phase), 0];
  }
  return [0, 0, /boot-buckle|zipper-puller/.test(part.name) ? 1 : 0];
}

export function applyRiderFinish(material) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const uniforms = { riderFinishEnabled: { value: 1 } };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 riderFinish;
varying vec3 vRiderFinish;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vRiderFinish = riderFinish;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRiderFinish;
uniform float riderFinishEnabled;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec3 riderFinishMask = clamp(vRiderFinish, 0.0, 1.0) * riderFinishEnabled;
vec3 bootColor = mix(vec3(0.023, 0.032, 0.043), vec3(0.006, 0.007, 0.009), riderFinishMask.y);
diffuseColor.rgb = mix(diffuseColor.rgb, bootColor, riderFinishMask.x);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.35, 0.38), riderFinishMask.z);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(0.36, 0.88, riderFinishMask.y), riderFinishMask.x);
roughnessFactor = mix(roughnessFactor, 0.28, riderFinishMask.z);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.72, riderFinishMask.z);`);
  };
  material.customProgramCacheKey = () => `${key}|rider-finish-v1`;
  material.userData.riderFinish = { uniforms, textureSamples: 0 };
  material.needsUpdate = true;
  return material;
}
