const E=1,j=typeof matchMedia=="function"&&matchMedia("(pointer: coarse)").matches,X=t=>{try{return new URLSearchParams(location.search).get(t)}catch{return null}},G=j||X("bloom")==="0",J=t=>G||!(t&&t.capabilities&&t.capabilities.isWebGL2);let I=G;const N=`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,Q=`
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
}`,Z=`
precision highp float;
uniform sampler2D uTex;
uniform float uStrength;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uStrength, 1.0); }`;let R=null;function $(t){let e=0;for(const a of["play:body","play:fp-arms"]){const u=t.getObjectByName(a);u&&u.traverse(h=>{!h.isMesh||h.name==="rider:contact"||(h.layers.enable(1),e++)})}return t.traverse(a=>{a.isLight&&a.layers.enable(1)}),e}function H(t,e,a,u,h={}){I=J(e);const o={enabled:!I,strength:.3,threshold:.62,radius:.55,meshes:0};if(!o.enabled)return o.render=()=>e.render(a,u),o.set=(s={})=>{for(const n of["strength","threshold","radius"])typeof s[n]=="number"&&(o[n]=s[n])},o.cost=()=>({medianMs:0,n:0,off:!0}),o.tier=()=>"low",o.stamp=()=>0,R=o,W(o),o;const k=e.extensions.has("EXT_color_buffer_float")||e.extensions.has("EXT_color_buffer_half_float"),O={type:k?t.HalfFloatType:t.UnsignedByteType,format:t.RGBAFormat,minFilter:t.LinearFilter,magFilter:t.LinearFilter,depthBuffer:!1,stencilBuffer:!1,generateMipmaps:!1},c=new t.WebGLRenderTarget(2,2,O),g=new t.WebGLRenderTarget(2,2,O),w=new t.BufferGeometry;w.setAttribute("position",new t.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),w.setAttribute("uv",new t.BufferAttribute(new Float32Array([0,0,2,0,0,2]),2));const i=new t.ShaderMaterial({vertexShader:N,fragmentShader:Q,depthTest:!1,depthWrite:!1,uniforms:{uTex:{value:null},uStep:{value:new t.Vector2},uBright:{value:1},uThreshold:{value:o.threshold},uKnee:{value:.18},uExposure:{value:e.toneMappingExposure}}}),x=new t.ShaderMaterial({vertexShader:N,fragmentShader:Z,depthTest:!1,depthWrite:!1,transparent:!0,blending:t.AdditiveBlending,uniforms:{uTex:{value:null},uStrength:{value:o.strength}}}),z=new t.Scene,B=new t.Mesh(w,i);B.frustumCulled=!1,z.add(B);const q=new t.Camera,f=new t.Vector2;let v=0,d=0,M=5;const U=()=>{e.getDrawingBufferSize(f);const s=Math.max(2,f.x>>1),n=Math.max(2,f.y>>1);s===v&&n===d||(v=s,d=n,c.setSize(v,d),g.setSize(v,d))},C=(s,n)=>{B.material=s,e.setRenderTarget(n),e.render(z,q)},A=new t.Color;o.render=()=>{e.render(a,u),M>0&&(o.meshes=$(a),M--),U(),F()};function F(){const s=u.layers.mask,n=a.background,b=e.autoClear,y=e.shadowMap.autoUpdate;e.getClearColor(A);const p=e.getClearAlpha();try{a.background=null,e.shadowMap.autoUpdate=!1,e.setClearColor(0,0),u.layers.set(1),e.setRenderTarget(c),e.render(a,u),u.layers.mask=s,a.background=n,e.setClearColor(A,p),i.uniforms.uExposure.value=e.toneMappingExposure,i.uniforms.uTex.value=c.texture,i.uniforms.uStep.value.set(1/v,0),i.uniforms.uBright.value=1,C(i,g),i.uniforms.uTex.value=g.texture,i.uniforms.uStep.value.set(0,1/d),i.uniforms.uBright.value=0,C(i,c),x.uniforms.uTex.value=c.texture,e.autoClear=!1,C(x,null)}finally{u.layers.mask=s,a.background=n,e.autoClear=b,e.shadowMap.autoUpdate=y,e.setRenderTarget(null),e.setClearColor(A,p)}}return o.set=(s={})=>{typeof s.strength=="number"&&(o.strength=s.strength,x.uniforms.uStrength.value=s.strength),typeof s.threshold=="number"&&(o.threshold=s.threshold,i.uniforms.uThreshold.value=s.threshold),typeof s.radius=="number"&&(o.radius=s.radius)},o.stamp=()=>{M=1},o.tier=()=>"high",o.cost=(s=600,n={})=>{const b=n.width||1920,y=n.height||1080,p=e.getContext();e.getDrawingBufferSize(f);const K=f.x,P=f.y;e.setDrawingBufferSize(b,y,1),U();const Y=new Uint8Array(4),L=()=>{try{e.setRenderTarget(null),p.readPixels(0,0,1,1,p.RGBA,p.UNSIGNED_BYTE,Y)}catch{}};for(let r=0;r<12;r++)F(),L();const S=[],_=[];for(let r=0;r<s;r++){const l=performance.now();L(),S.push(performance.now()-l)}for(let r=0;r<s;r++){const l=performance.now();F(),L(),_.push(performance.now()-l)}e.setDrawingBufferSize(K,P,1),U();const m=r=>{const l=r.slice().sort((T,D)=>T-D);return l[l.length>>1]},V=r=>{const l=r.slice().sort((T,D)=>T-D);return l[Math.min(l.length-1,Math.floor(l.length*.95))]};return{medianMs:+(m(_)-m(S)).toFixed(3),median:+m(_).toFixed(3),baseline:+m(S).toFixed(3),p95Ms:+(V(_)-m(S)).toFixed(3),n:s,width:b,height:y,halfFloat:k,meshes:o.meshes}},o.dispose=()=>{c.dispose(),g.dispose(),w.dispose(),i.dispose(),x.dispose()},o.set({strength:h.strength,threshold:h.threshold??.62,radius:h.radius??.55}),R=o,W(o),o}function W(t){typeof window>"u"||(window.__riderBloom=t,window.__rig=window.__rig||{},window.__rig.bloomCost=(e,a)=>t.cost(e,a))}export{j as COARSE,G as LOW_END,E as RIDER_LAYER,J as isLowEnd,H as makeBloom};
