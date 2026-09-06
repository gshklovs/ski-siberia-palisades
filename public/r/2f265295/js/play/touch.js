matchMedia("(pointer: coarse)").matches&&lt();function lt(){const c=window.__player;if(!c)return;const a=58,g=4,w=80,x=16,Z=.06,p=.3,E=.38,M=.4,S=220,A=14,X=320,O=64,Y=1500,tt=400,q=26,H=1.1,k=.0022,L={},h=(t,n)=>{L[t]!==n&&(L[t]=n,c.keys({[t]:n}))},K=()=>{h("left",!1),h("right",!1),h("forward",!1),h("back",!1)},$=(t,n,e)=>t<n?n:t>e?e:t,y=()=>{if(document.body.classList.contains("intro-up"))return!0;try{return!!c.paused()}catch{return!1}},T=document.createElement("style");T.id="ptouch-css",T.textContent=`
/* A 1x1 box rather than a zero-size one: everything inside is absolutely
   positioned off it, so the size is never used for layout — but a definite box
   is what makes checkVisibility() an honest answer about whether the stick is
   on the screen, which is how the gate tells "H hid it" from "it never drew". */
.ptouch { position: fixed; left: 0; top: 0; width: 1px; height: 1px; z-index: 30; display: none; pointer-events: none; }
.ptouch.is-on { display: block; }
/* AS PICKED — A, "anchored ring, gradient arc in the held direction"
   (specs/0055 §4/§5 (W7, Greg 2026-09-06)). The ring is the HUD PLATE MADE
   ROUND: §1.6's 34 % ink and nothing else. Measured off the lookbook's
   k-touch-joystick A cell at 1:1 — rgba(23,22,20,.34), border-radius 50 %, NO
   border, NO box-shadow. The 1.5 px cream hairline and the two shadows that
   shipped are both gone: a plate that survives bright snow does not need a
   keyline, and the cell draws none. */
.ptouch__ring {
  position: absolute; left: 0; top: 0; width: ${a*2}px; height: ${a*2}px;
  margin: ${-a}px 0 0 ${-a}px; border-radius: 50%;
  background: rgba(23, 22, 20, .34);
  animation: ptouch-in 140ms cubic-bezier(.2, .9, .3, 1) both;
}
/* THE ARC — the held direction, drawn on the ring itself, the same arc idiom as
   the dial. A conic wedge masked to a band: ${g} px thick, sitting 1 px
   inside the ring's outer edge (the cell's band is 47→51 px in a 52 px radius,
   which is 4 px thick and 1 px in), spanning ${w}° centred on the push.
   ONE FLAT COLOUR, --p-grad-to: the cell's caption calls it "a gradient arc"
   but its conic-gradient carries two identical #3b6cff stops, and §1.5 is a
   hard rule — the gradient belongs to numbers the RIDER EARNED, and which way a
   thumb is pushing is not one. It is the gradient's blue end used flat, which
   is what the cell paints.
   --pa is the direction in degrees, written per frame; the wedge is drawn from
   --pa minus half the span, so the arc is centred on the push. */
.ptouch__arc {
  --pa: 0deg;
  position: absolute; left: 0; top: 0; width: ${a*2}px; height: ${a*2}px;
  margin: ${-a}px 0 0 ${-a}px; border-radius: 50%;
  opacity: 0;
  background: conic-gradient(from calc(var(--pa) - ${w/2}deg),
    var(--p-grad-to) 0 ${w}deg, transparent ${w}deg);
  -webkit-mask: radial-gradient(circle at 50% 50%,
    transparent 0 ${a-1-g}px, #000 ${a-1-g}px ${a-1}px, transparent ${a-1}px);
  mask: radial-gradient(circle at 50% 50%,
    transparent 0 ${a-1-g}px, #000 ${a-1-g}px ${a-1}px, transparent ${a-1}px);
}
.ptouch.is-push .ptouch__arc { opacity: 1; }
/* the vector: anchor to thumb, the cell's own construction — in the A cell the
   26 px line ends exactly under the 26 px-away nub. Length is the deflection, so
   it is written per frame; the angle is the same --pa the arc reads. */
.ptouch__vec {
  position: absolute; left: 0; top: 0; height: 2px; width: 0;
  margin-top: -1px; transform-origin: 0 50%;
  background: var(--p-grad-to);
}
.ptouch__dot {
  position: absolute; left: 0; top: 0; width: 5px; height: 5px;
  margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: rgba(244, 241, 234, .34);
}
/* the nub stays CREAM at every deflection — "it is the thumb, not a value" (the
   cell's note). The is-live orange recolour that shipped is gone: the arc is
   what says you are past the carve threshold now, and the signal colour on a
   thumb was the nub claiming to be a reading. ${x} px is the cell's 14 px
   scaled by the ring the build actually draws (r 52 → ${a}). */
.ptouch__nub {
  position: absolute; left: 0; top: 0; width: ${x}px; height: ${x}px;
  margin: ${-x/2}px 0 0 ${-x/2}px; border-radius: 50%;
  background: var(--p-cream);
  box-shadow: 0 1px 6px rgba(0, 0, 0, .5);
}
@keyframes ptouch-in { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ptouch__ring { animation: none; } }
`,document.head.appendChild(T);const d=document.createElement("div");d.className="ptouch";const j=document.createElement("div");j.className="ptouch__ring";const C=document.createElement("div");C.className="ptouch__arc";const b=document.createElement("div");b.className="ptouch__vec";const U=document.createElement("div");U.className="ptouch__dot";const D=document.createElement("div");D.className="ptouch__nub",d.append(j,C,b,U,D),document.body.appendChild(d);function B(){if(!s)return;d.style.transform=`translate3d(${s.x0}px, ${s.y0}px, 0)`,D.style.transform=`translate3d(${s.ax*a}px, ${s.ay*a}px, 0)`,d.classList.toggle("is-live",Math.hypot(s.ax,s.ay)>p);const t=Math.hypot(s.ax,s.ay),n=t>Z;if(d.classList.toggle("is-push",n),n){const e=Math.atan2(s.ax,-s.ay)*180/Math.PI;C.style.setProperty("--pa",e.toFixed(1)+"deg"),b.style.width=(Math.min(1,t)*a).toFixed(1)+"px",b.style.transform=`rotate(${(e-90).toFixed(1)}deg)`}else b.style.width="0px"}const r=new Map;let s=null,u=null,P=null,f=0,R=0,V=0;const et=t=>t<innerWidth/2?"L":"R",N=()=>{const t=[...r.values()].some(n=>n.side==="R");h("jumpHeld",t),h("grab",t)},nt=(t,n)=>{let e=0;for(const[i,o]of r)i!==t&&o.side===n&&e++;return e};function F(t,n){const e=new Set;for(const o of t.touches)e.add(o.identifier);if(n)for(const o of t.changedTouches)e.add(o.identifier);let i=0;for(const o of[...r.keys()])e.has(o)||(r.delete(o),V++,i++,s&&s.id===o&&z());return i&&N(),i}function it(t){s={id:t.identifier,x0:t.clientX,y0:t.clientY,ax:0,ay:0},d.classList.add("is-on"),B(),f||(R=performance.now(),f=requestAnimationFrame(W))}function z(){s=null,d.classList.remove("is-on","is-live"),f&&(cancelAnimationFrame(f),f=0),K()}function st(t){s&&(s.ax=$((t.clientX-s.x0)/a,-1,1),s.ay=$((t.clientY-s.y0)/a,-1,1),h("left",s.ax<-p),h("right",s.ax>p),h("back",s.ay>E),h("forward",s.ay<-E),B())}function W(t){f=requestAnimationFrame(W);const n=Math.min(.05,Math.max(0,(t-R)/1e3));if(R=t,!s)return;if(y()){z();return}if(M<=0||!n)return;let e=0;try{if(!c.grounded())return}catch{}const i=Math.abs(s.ax);i>p&&(e=Math.sign(s.ax)*$((i-p)/(1-p),0,1)),e&&c.look(e*M*n/k,0,k)}addEventListener("touchstart",t=>{if(F(t,!1),y())return;const n=performance.now();for(const e of t.changedTouches){const i=et(e.clientX);r.set(e.identifier,{side:i,x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,t0:n,tLast:n,moved:0,mates:0}),i==="L"&&!s&&it(e)}for(const e of t.changedTouches){const i=r.get(e.identifier);i&&(i.mates=nt(e.identifier,i.side))}N(),t.preventDefault()},{passive:!1}),addEventListener("touchmove",t=>{if(F(t,!1),y())return;const n=performance.now();for(const e of t.changedTouches){const i=r.get(e.identifier);if(!i)continue;const o=e.clientX-i.x,l=e.clientY-i.y,m=Math.max(1,n-i.tLast);i.moved+=Math.abs(o)+Math.abs(l),i.x=e.clientX,i.y=e.clientY,i.tLast=n,i.side==="R"?c.look(o*.9,l*.9,k):s&&s.id===e.identifier&&st(e);const dt=Math.abs(o)/m;!c.grounded()&&Math.abs(o)>q&&Math.abs(o)>Math.abs(l)*2&&dt>H&&ct(o<0?"spinLeft":"spinRight")}t.preventDefault()},{passive:!1});const I=()=>{try{return window.__playMarkers||null}catch{return null}},at=(t,n)=>{const e=I();try{return e&&e.signAt?e.signAt(t,n):null}catch{return null}},ot=t=>{const n=I();try{n&&n.touchAim&&n.touchAim(t)}catch{}},rt=t=>{const n=I();try{n&&n.fastTravel&&n.fastTravel(t)}catch{}},G=t=>{F(t,!0);const n=performance.now();for(const e of t.changedTouches){const i=r.get(e.identifier);if(r.delete(e.identifier),s&&s.id===e.identifier&&z(),!i||y()||!(n-i.t0<S&&i.moved<A&&Math.hypot(i.x-i.x0,i.y-i.y0)<A)||i.mates)continue;const l=at(i.x,i.y);if(u&&n-u.t<X&&Math.hypot(i.x-u.x,i.y-u.y)<O){const m=l&&u.sign&&l.id===u.sign;u=null,m?rt(l.id):c.respawn();continue}if(u={t:n,x:i.x,y:i.y,sign:l?l.id:null},l&&ot(l.id),i.side==="R"){c.keys({jump:!0});const m=()=>c.keys({jump:!1});requestAnimationFrame(()=>requestAnimationFrame(m)),setTimeout(m,Y)}}N(),!r.size&&!s&&K(),t.preventDefault()};addEventListener("touchend",G,{passive:!1}),addEventListener("touchcancel",G,{passive:!1});const J=120,Q=300;let v=0;addEventListener("touchstart",t=>{if(t.touches.length!==2){v=0;return}const n=r.get(t.touches[0].identifier),e=r.get(t.touches[1].identifier);v=n&&e&&Math.abs(n.t0-e.t0)<=J?Math.min(n.t0,e.t0):0},{passive:!0}),addEventListener("touchend",t=>{t.touches.length===0&&(v&&performance.now()-v<Q&&c.toggleCam(),v=0)},{passive:!0});function ct(t){P||(c.keys({[t]:!0}),P=setTimeout(()=>{c.keys({[t]:!1}),P=null},tt))}const _=(()=>{try{return window.__trace||null}catch{return null}})();if(_&&_.armed&&_.armed()){const t=document.createElement("button");t.type="button",t.setAttribute("aria-label","file a ride trace"),t.style.cssText="position:fixed;right:10px;top:10px;z-index:31;box-sizing:content-box;min-width:44px;min-height:44px;display:flex;align-items:flex-start;justify-content:flex-end;padding:0;margin:0;border:0;background:none;touch-action:manipulation;";const n=document.createElement("span");n.textContent="TRACE",n.style.cssText="display:block;font:10px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--p-cream);background:rgba(23,22,20,.86);border:1px solid var(--p-hazard);border-radius:3px;padding:7px 9px;",t.appendChild(n),t.addEventListener("touchstart",e=>{e.stopPropagation()},{passive:!0}),t.addEventListener("click",e=>{e.stopPropagation(),_.open()}),document.body.appendChild(t)}document.documentElement.style.overscrollBehavior="none",document.body.style.touchAction="none",addEventListener("gesturestart",t=>t.preventDefault()),addEventListener("dblclick",t=>t.preventDefault()),window.__touch={active:!0,zones:"left stick / right look",scheme:"anchored-stick",stick:()=>s?{on:!0,x:s.x0,y:s.y0,ax:+s.ax.toFixed(4),ay:+s.ay.toFixed(4)}:{on:!1,x:null,y:null,ax:0,ay:0},visible:()=>d.classList.contains("is-on"),shown:()=>d.classList.contains("is-on")&&d.checkVisibility(),el:()=>d,keys:()=>({...L}),blocked:()=>y(),touches:()=>r.size,ghostsPruned:()=>V,live:()=>[...r.entries()].map(([t,n])=>({id:t,side:n.side,mates:n.mates})),consts:{RING:a,CARVE:p,PITCH:E,STICK_YAW:M,TAP_MS:S,TAP_PX:A,DBL_MS:X,DBL_PX:O,JUMP_MS:Y,FLICK_PX:q,FLICK_V:H,LOOK:k,CAM_LAND_MS:J,CAM_LIFT_MS:Q}}}
