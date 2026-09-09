const DEFAULTS = Object.freeze({ enabled: true, metersPerRepeat: 5.4, normalStrength: .72, colorStrength: .86, roughness: .91, albedoUrl: new URL('./rock-albedo.jpg', import.meta.url).href, normalUrl: new URL('./rock-normal.png', import.meta.url).href });
const textureCaches = new WeakMap();
const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function normalizeRockSurfaceOptions(options = {}) {
  return { enabled: options.enabled !== false, metersPerRepeat: bounded(options.metersPerRepeat, DEFAULTS.metersPerRepeat, 1.5, 18), normalStrength: bounded(options.normalStrength, DEFAULTS.normalStrength, 0, 1.25), colorStrength: bounded(options.colorStrength, DEFAULTS.colorStrength, 0, 1), roughness: bounded(options.roughness, DEFAULTS.roughness, .72, 1), albedoUrl: options.albedoUrl ?? DEFAULTS.albedoUrl, normalUrl: options.normalUrl ?? DEFAULTS.normalUrl };
}

function configureTexture(THREE, texture, color) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  if ('colorSpace' in texture) texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  else if ('encoding' in texture) texture.encoding = color ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

function acquireTextures(THREE, settings, options) {
  if (!THREE) return { albedo: options.albedoTexture ?? null, normal: options.normalTexture ?? null, ready: Promise.resolve(null) };
  const canLoad = typeof document !== 'undefined' && typeof THREE.TextureLoader === 'function';
  let cache;
  const key = `${settings.albedoUrl}\n${settings.normalUrl}`;
  if (!options.albedoTexture && !options.normalTexture && canLoad) {
    cache = textureCaches.get(THREE);
    if (!cache) textureCaches.set(THREE, cache = new Map());
    if (cache.has(key)) return cache.get(key);
  }
  const makeNeutral = normal => configureTexture(THREE, new THREE.DataTexture(new Uint8Array(normal ? [128, 128, 255, 255] : [255, 255, 255, 255]), 1, 1), !normal);
  const albedo = options.albedoTexture ? configureTexture(THREE, options.albedoTexture, true) : makeNeutral(false);
  const normal = options.normalTexture ? configureTexture(THREE, options.normalTexture, false) : makeNeutral(true);
  if ((options.albedoTexture && options.normalTexture) || !canLoad) return { albedo, normal, ready: Promise.resolve({ albedo, normal }) };
  const entry = { albedo, normal, loadError: null, ready: null };
  const loader = new THREE.TextureLoader();
  const load = (url, color) => new Promise((resolve, reject) => loader.load(url, texture => resolve(configureTexture(THREE, texture, color)), undefined, reject));
  entry.ready = Promise.all([options.albedoTexture ? Promise.resolve(albedo) : load(settings.albedoUrl, true), options.normalTexture ? Promise.resolve(normal) : load(settings.normalUrl, false)]).then(([loadedAlbedo, loadedNormal]) => {
    if (loadedAlbedo !== albedo) albedo.dispose();
    if (loadedNormal !== normal) normal.dispose();
    return Object.assign(entry, { albedo: loadedAlbedo, normal: loadedNormal });
  }).catch(error => { entry.loadError = error; return entry; });
  if (!options.albedoTexture && !options.normalTexture) cache.set(key, entry);
  return entry;
}

export function applyRockSurface(material, options = {}) {
  if (material.userData.rockSurface) return material.userData.rockSurface;
  const settings = normalizeRockSurfaceOptions(options);
  const textures = acquireTextures(options.THREE, settings, options);
  const uniforms = { rockSurfaceEnabled: { value: settings.enabled ? 1 : 0 }, rockSurfaceScale: { value: 1 / settings.metersPerRepeat }, rockSurfaceNormalStrength: { value: settings.normalStrength }, rockSurfaceColorStrength: { value: settings.colorStrength }, rockSurfaceRoughness: { value: settings.roughness }, rockSurfaceAlbedo: { value: textures.albedo }, rockSurfaceNormalMap: { value: textures.normal } };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float rockSurfaceEnabled, rockSurfaceScale, rockSurfaceNormalStrength, rockSurfaceColorStrength, rockSurfaceRoughness;
      uniform mat3 normalMatrix;
      uniform sampler2D rockSurfaceAlbedo, rockSurfaceNormalMap;
      vec3 rockSurfaceWeights(vec3 n){vec3 w=pow(abs(normalize(n)),vec3(5.0));return w/max(dot(w,vec3(1.0)),.0001);}
      vec3 rockSurfaceTriplanar(sampler2D map,vec3 p,vec3 w){return texture2D(map,p.yz).rgb*w.x+texture2D(map,p.xz).rgb*w.y+texture2D(map,p.xy).rgb*w.z;}
      vec3 rockSurfaceTriplanarNormal(vec3 p,vec3 n,vec3 w){
        vec3 nx=texture2D(rockSurfaceNormalMap,p.yz).xyz*2.0-1.0,ny=texture2D(rockSurfaceNormalMap,p.xz).xyz*2.0-1.0,nz=texture2D(rockSurfaceNormalMap,p.xy).xyz*2.0-1.0;
        vec3 xBase=vec3(sign(n.x),0.0,0.0),yBase=vec3(0.0,sign(n.y),0.0),zBase=vec3(0.0,0.0,sign(n.z));
        vec3 detail=(vec3(nx.z*sign(n.x),nx.x,nx.y)-xBase)*w.x+(vec3(ny.x,ny.z*sign(n.y),ny.y)-yBase)*w.y+(vec3(nz.x,nz.y,nz.z*sign(n.z))-zBase)*w.z;
        return normalize(n+detail);
      }`);
    const sentinel = 'rock *= 1.0-alpineChute;';
    if (!shader.fragmentShader.includes(sentinel)) throw new Error('Rock surface requires the terrain rock mask sentinel');
    shader.fragmentShader = shader.fragmentShader.replace(sentinel, `${sentinel}
      vec3 rockSurfaceBlend=rockSurfaceWeights(alpineNormal),rockSurfacePoint=alpinePosition*rockSurfaceScale;
      vec3 rockSurfaceTexel=rockSurfaceTriplanar(rockSurfaceAlbedo,rockSurfacePoint,rockSurfaceBlend);
      float rockSurfaceLuma=dot(rockSurfaceTexel,vec3(.2126,.7152,.0722));
      rockSurfaceTexel=mix(rockSurfaceTexel,vec3(rockSurfaceLuma),.75);
      rockSurfaceTexel=mix(vec3(.69,.70,.69),rockSurfaceTexel,.80)*1.35;
      granite=mix(granite,rockSurfaceTexel,rockSurfaceColorStrength*rockSurfaceEnabled);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float rockSurfaceFootprint=max(length(dFdx(rockSurfacePoint)),length(dFdy(rockSurfacePoint)));
      float rockSurfaceNormalFade=1.0-smoothstep(.08,.55,rockSurfaceFootprint);
      vec3 rockSurfaceLocalNormal=rockSurfaceTriplanarNormal(rockSurfacePoint,alpineNormal,rockSurfaceBlend);
      vec3 rockSurfaceViewNormal=normalize(normalMatrix*rockSurfaceLocalNormal);
      float rockSurfaceAmount=rock*rockSurfaceEnabled;
      normal=normalize(mix(normal,rockSurfaceViewNormal,rockSurfaceAmount*rockSurfaceNormalStrength*rockSurfaceNormalFade));
      roughnessFactor=mix(roughnessFactor,rockSurfaceRoughness,rockSurfaceAmount);`);
  };
  material.customProgramCacheKey = () => `${previousKey}:rock-surface-v2-triplanar`;
  const controls = { uniforms, ready: null, loadError: null, setEnabled(value) { uniforms.rockSurfaceEnabled.value = value ? 1 : 0; }, setMetersPerRepeat(value) { uniforms.rockSurfaceScale.value = 1 / bounded(value, DEFAULTS.metersPerRepeat, 1.5, 18); }, setNormalStrength(value) { uniforms.rockSurfaceNormalStrength.value = bounded(value, DEFAULTS.normalStrength, 0, 1.25); }, setColorStrength(value) { uniforms.rockSurfaceColorStrength.value = bounded(value, DEFAULTS.colorStrength, 0, 1); }, setRoughness(value) { uniforms.rockSurfaceRoughness.value = bounded(value, DEFAULTS.roughness, .72, 1); }, budget: { fragmentTextureSamples: 6, sharedTextures: 2, addedTextures: 2, addedTriangles: 0, addedDrawCalls: 0 } };
  controls.ready = textures.ready.then(loaded => { if (loaded) { uniforms.rockSurfaceAlbedo.value = loaded.albedo; uniforms.rockSurfaceNormalMap.value = loaded.normal; controls.loadError = loaded.loadError; if (loaded.loadError) uniforms.rockSurfaceEnabled.value = 0; } return controls; });
  material.userData.rockSurface = controls;
  material.needsUpdate = true;
  return controls;
}
