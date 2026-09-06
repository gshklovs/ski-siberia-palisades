import{pickBrand as g}from"./flags.js";import{hudSurf as v}from"./hud.js";const y="terrain USGS 3DEP · trails © OpenStreetMap contributors (ODbL)",x=2400,d=matchMedia("(pointer: coarse)").matches,e=(t,r,o)=>{const i=document.createElement(t);return r&&(i.className=r),o!=null&&(i.textContent=o),i};document.body.classList.add("intro-up");const n=e("div","intro");n.setAttribute("role","dialog"),n.setAttribute("aria-label",g({lab:"Red Dog Chair","RED DOG":"Red Dog Chair",SIBERIA:"Siberia Express"}));const u=e("section","intro__card intro__card--title");u.append(e("h1","intro__h1",g({lab:"RED DOG CHAIR","RED DOG":"RED DOG CHAIR",SIBERIA:"SIBERIA EXPRESS"})),e("p","intro__sub","Palisades Tahoe · Olympic Valley, California"),e("p","intro__credit",y));const c=e("section","intro__card intro__card--"+(d?"touch":"keys"));c.hidden=!0;const E=d?S():R();c.append(e("h2","intro__h2","CONTROLS"),E,e("p","intro__go",d?"tap to drop in":"click to drop in"),e("p","intro__credit",y));function R(){const t=e("div","intro__keys"),r=[["ESC","settings"],["W A S D","move"],["← →","tricks in the air"],["C","camera"],["R","reset"],["↑ ↓","look"],["M","trail map"]];for(const[o,i]of r)t.append(e("div","intro__cap",o),e("div","intro__what",i));return t}function S(){document.head.appendChild(e("style",null,`
.intro__card--touch .intro__td {
  display: grid; grid-template-columns: 1fr 1fr;
  width: min(300px, 84vw); margin: 0 auto;
  border: 1px solid rgba(244, 241, 234, .20); border-radius: 14px;
  background: rgba(23, 22, 20, .34);
  box-shadow: inset 0 0 0 1px rgba(23, 22, 20, .35);
  overflow: hidden;
}
.intro__card--touch .intro__tz {
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  padding: 15px 9px 14px;
}
.intro__card--touch .intro__tz + .intro__tz { border-left: 1px dashed rgba(244, 241, 234, .22); }
.intro__card--touch .intro__tg { display: block; width: 54px; height: 54px; }
.intro__card--touch .intro__tk {
  font: 700 0.64rem / 1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .13em; text-transform: uppercase; color: #ffd9c4;
  text-align: center; text-wrap: balance;
}
.intro__card--touch .intro__tf {
  margin: 0.85rem 0 0;
  font: 700 0.62rem / 1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .2em; text-transform: uppercase; opacity: .8;
}
`));const t=p=>{const a=document.createElementNS("http://www.w3.org/2000/svg","svg");return a.setAttribute("class","intro__tg"),a.setAttribute("viewBox","0 0 56 56"),a.setAttribute("aria-hidden","true"),a.innerHTML=p,a},r=v.hazard,o="rgba(244,241,234,.42)",i="rgba(244,241,234,.34)",w=t(`
    <circle cx="28" cy="28" r="18.5" fill="rgba(23,22,20,.34)" stroke="${i}" stroke-width="1.5"/>
    <circle cx="28" cy="28" r="1.6" fill="${o}"/>
    <circle cx="34.5" cy="22.5" r="7.5" fill="${r}"/>
    <path d="M28 1.5 L31.6 8 L24.4 8 Z" fill="${o}"/>
    <path d="M28 54.5 L24.4 48 L31.6 48 Z" fill="${o}"/>
    <path d="M1.5 28 L8 24.4 L8 31.6 Z" fill="${o}"/>
    <path d="M54.5 28 L48 31.6 L48 24.4 Z" fill="${o}"/>`),L=t(`
    <circle cx="19" cy="20" r="5.5" fill="${r}"/>
    <circle cx="19" cy="20" r="10.5" fill="none" stroke="${i}" stroke-width="1.5"/>
    <circle cx="19" cy="20" r="15.5" fill="none" stroke="rgba(244,241,234,.17)" stroke-width="1.5"/>
    <path d="M14 41 C 24 47, 36 45, 44 36" fill="none" stroke="${o}" stroke-width="2"
          stroke-linecap="round" stroke-dasharray="0.1 5.4"/>
    <path d="M45.5 30.5 L47 38.5 L39.5 36 Z" fill="${o}"/>`),_=(p,a)=>{const m=e("div","intro__tz");return m.append(p,e("b","intro__tk",a)),m},f=e("div"),h=e("div","intro__td");return h.append(_(w,"MOVE"),_(L,"TAP JUMP · DRAG LOOK")),f.append(h,e("p","intro__tf","DOUBLE-TAP · RESET")),f}try{const t=window.__guide,r=t&&typeof t.state=="function"?t.state():null,o=t&&typeof t.skipKey=="function"?t.skipKey():null;r&&r.ok&&Array.isArray(r.stages)&&r.stages.length&&o&&c.insertBefore(e("p","intro__go",`guided run · hold ${o.cap} any time to skip it`),c.querySelector(".intro__credit"))}catch{}n.append(u,c),document.body.appendChild(n),requestAnimationFrame(()=>n.classList.add("is-in"));let s=0,D=setTimeout(()=>l(),x);function l(){if(clearTimeout(D),s===0){s=1,u.hidden=!0,c.hidden=!1;return}if(s===1){s=2,n.classList.remove("is-in"),n.classList.add("is-out"),setTimeout(()=>n.remove(),320);const t=window.__player;t&&typeof t.enter=="function"&&t.enter(),document.body.classList.remove("intro-up"),A()}}function k(t){t.key==="F5"||t.key==="F12"||t.metaKey||t.ctrlKey||t.altKey||(t.preventDefault(),l())}function b(t){t.preventDefault(),t.stopPropagation(),l()}function A(){removeEventListener("keydown",k,!0),n.removeEventListener("pointerdown",b)}addEventListener("keydown",k,!0),n.addEventListener("pointerdown",b),window.__intro={skip:()=>{for(;s<2;)l()},stage:()=>s,card:()=>d?"touch":"keys"};
