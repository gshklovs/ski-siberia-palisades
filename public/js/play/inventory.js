import{SKI_MODELS as sa,skiThumbURL as la,makeSkiRig as ht,styleSkiRig as ut,rememberSkiId as da,SKI_DEFAULT as ca}from"./ski.js";import{GLIDER_MODELS as pa,GLIDER_DEFAULT as fa,rememberGliderId as ka}from"./glider.js";import{BIKE_MODELS as ha,BIKE_DEFAULT as ua,bikeThumbURL as ga,rememberBikeId as ma,makeBikeRig as ba,styleBikeRig as _a,getBikeModel as xa,bikeRider as wa}from"./bike.js";import{SLED_MODELS as va,SLED_DEFAULT as ya,sledThumbURL as Sa,rememberSledId as Ma,resolveSledId as La,makeSledRig as Ta,styleSledRig as Aa}from"./sled.js";import{SNOWMOBILE_MODELS as Ca,SNOWMOBILE_DEFAULT as Pa,snowmobileThumbURL as Oa,rememberSnowmobileId as Ia,resolveSnowmobileId as za,makeSnowmobileRig as Ba,styleSnowmobileRig as qa}from"./snowmobile.js";import{BIKE_GEAR as Fa,BRAND as gt}from"./flags.js";import{OUTFITS as Fe,byCode as Ra,previewOutfit as ge,toggleOf as Na,rememberOutfit as Da,resolveOutfit as Ea,PARTS as me,parseLook as Re,serialise as ja,paint as mt,swatch as Ne,cloneRig as $a,rigOf as Ga}from"./rider.js";import{R as bt,C as _t}from"./atlas.js";import xt from"./outfits/after.js";import{KNOBS as Ua,get as be,set as Ka}from"./settings.js";import{hudSurf as wt}from"./hud.js";const Wa=parseInt(wt.cream.slice(1),16);import{waypointIndex as Ya,ALIASES as Va}from"./spawn.js";const Xa={wing:{base:"#dd6a2a",ink:"#6b4a2a",accent:"#f2c98a"},rocket:{base:"#1b1c22",ink:"#0b0b0e",accent:"#b9bec4"}},r=(e,l,p)=>{const f=document.createElement(e);return l&&(f.className=l),p!=null&&(f.textContent=p),f},vt="poi-lab.play.locker.",Qa=(e,l)=>{try{localStorage.setItem(vt+e,l)}catch{}},Ha=e=>{try{return localStorage.getItem(vt+e)}catch{return null}},yt=e=>e<0?0:e>1?1:e;function Ja(e){const l=e.replace("#","");return l.length===3?l.split("").map(f=>parseInt(f+f,16)):[parseInt(l.slice(0,2),16),parseInt(l.slice(2,4),16),parseInt(l.slice(4,6),16)]}const _e=(e,l)=>{const[p,f,u]=Ja(e);return`rgba(${p},${f},${u},${l})`};function Za(e){let l=0;for(let p=0;p<e.length;p++)l=l*31+e.charCodeAt(p)>>>0;return l%360}const en=e=>{const f=n=>(n+e/30)%12,u=.62*Math.min(.62,.38),h=n=>Math.round(255*(.62-u*Math.max(-1,Math.min(f(n)-3,Math.min(9-f(n),1)))));return"#"+[h(0),h(8),h(4)].map(n=>n.toString(16).padStart(2,"0")).join("")},St={lab:"#8fa3b8",race:"#ff3b5c",freeride:"#2ec4b6",trail:"#54d17a",jump:"#ffb020",fun:"#c77dff",dh:"#ff6b3d",xc:"#5ad1e6"},De=e=>St[e]||(St[e]=en(Za(String(e||"x")))),Mt={ski:'<path d="M5.4 20.6 8.9 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M12.6 20.6 16.1 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M4.2 20.9h5.1"/><path d="M11.4 20.9h5.1"/>',bike:'<circle cx="5.9" cy="16.4" r="4.1"/><circle cx="18.1" cy="16.4" r="4.1"/><path d="M5.9 16.4 10.2 8.2h6.1l1.8 8.2"/><path d="M9.4 8.2h4.4"/><path d="M16.3 8.2 17.5 5.4h2.2"/>',glider:'<path d="M12 3.4 2.6 13.9c3.4-1.4 6.4-.7 9.4 6.7 3-7.4 6-8.1 9.4-6.7z"/><path d="M12 3.4v17.2"/>',boots:'<path d="M8.2 3.4h4.3v8.4c0 1.3.8 2.4 2 2.9l4.1 1.8v4.1H6.4V3.4z"/><path d="M6.6 17.1h12"/>',crate:'<path d="M12 2.7 20.2 7v10L12 21.3 3.8 17V7z"/><path d="M3.8 7 12 11.4 20.2 7"/><path d="M12 11.4v9.9"/>',trail:'<path d="M2.6 19.4 8.4 9.1l3.3 5.1 2.6-3.9 5.1 9.1z"/><path d="M15.4 3.1h5.6v3.6h-5.6z"/><path d="M15.4 3.1V10"/>',sled:'<path d="M3.2 13.9h12.9c2.1 0 3.5-1.3 3.5-3 0-1.3-1-2.3-2.2-2.3s-2.2 1-2.2 2.3"/><path d="M4.4 18.2h12.2"/><path d="M5.8 13.9v4.3"/><path d="M13.9 13.9v4.3"/>',snowmobile:'<rect x="2.5" y="14.2" width="10.2" height="4.3" rx="2.1"/><path d="M12.7 16.3h3.5l2.4-2.3"/><path d="M8.4 14.2 10.1 9.6h3.8l1.3 2.7"/><path d="M14 9.6 16.1 7.2"/><path d="M17.2 18.5h3.3"/><path d="M18.9 13.4v5.1"/>',outfit:'<path d="M9 3.2h6l4.1 2.3-1.6 4.4-1.9-.8v11.7H7.4V9.1l-1.9.8L3.9 5.5z"/><path d="M9 3.2 12 6.4 15 3.2"/>',gear:'<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.9"/><path d="M18.6 12h2.2"/><path d="M5.4 12H3.2"/><path d="M12 5.4V3.2"/><path d="M12 18.6v2.2"/><path d="M16.67 7.33 18.22 5.78"/><path d="M7.33 16.67 5.78 18.22"/><path d="M16.67 16.67 18.22 18.22"/><path d="M7.33 7.33 5.78 5.78"/>'};function tn(e){return'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(Mt[e]||Mt.crate)+"</svg>"}const an=[{key:"speed",label:"speed",unit:!0,src:"term",suffix:" m/s"},{key:"turn",label:"handling",unit:!0,src:"steer",suffix:" rad/s"},{key:"stab",label:"stability",unit:!0},{key:"pop",label:"pop",unit:!0},{key:"spinTorque",label:"spin",unit:!1,suffix:" rad/s"}],Ee=e=>typeof e=="number"&&isFinite(e);function nn(e){const l=[];for(const p of an){const f=e.map(u=>u.stats?u.stats[p.key]:void 0);!f.length||!f.every(Ee)||l.push({...p,min:Math.min(...f),max:Math.max(...f),n:e.length})}return l}function Lt(e,l){const p=e.max-e.min;return e.unit&&e.n<4?yt(l):p>1e-6?.08+.92*((l-e.min)/p):e.unit?yt(l):.5}const D=new Map;function Tt(e,l,p){if(D.has(e))return D.get(e);const f=300,u=58,h=document.createElement("canvas");h.width=f,h.height=u;const n=h.getContext("2d");if(n.fillStyle=l.base,n.fillRect(0,0,f,u),n.strokeStyle=l.accent,n.lineWidth=3,n.lineCap="round",n.lineJoin="round",n.fillStyle=l.accent,p==="bike")n.beginPath(),n.arc(96,34,17,0,7),n.stroke(),n.beginPath(),n.arc(204,34,17,0,7),n.stroke(),n.beginPath(),n.moveTo(96,34),n.lineTo(140,18),n.lineTo(186,18),n.lineTo(204,34),n.lineTo(150,34),n.closePath(),n.stroke(),n.beginPath(),n.moveTo(186,18),n.lineTo(196,8),n.lineTo(212,8),n.stroke();else if(p==="rocket"){n.fillStyle=l.ink,n.fillRect(132,12,36,30);for(const c of[110,190])n.fillStyle=l.accent,n.fillRect(c-17,9,34,33),n.beginPath(),n.ellipse(c,9,17,7,0,0,7),n.fill(),n.fillStyle=l.ink,n.fillRect(c-17,22,34,7),n.beginPath(),n.moveTo(c-11,42),n.lineTo(c+11,42),n.lineTo(c+17,51),n.lineTo(c-17,51),n.closePath(),n.fill(),n.fillStyle="#ffb347",n.beginPath(),n.moveTo(c-13,52),n.lineTo(c+13,52),n.lineTo(c,58),n.closePath(),n.fill()}else if(p==="wing")n.beginPath(),n.moveTo(150,8),n.quadraticCurveTo(74,20,34,46),n.quadraticCurveTo(96,40,150,50),n.quadraticCurveTo(204,40,266,46),n.quadraticCurveTo(226,20,150,8),n.closePath(),n.fill(),n.strokeStyle=l.ink,n.lineWidth=2,n.beginPath(),n.moveTo(150,4),n.lineTo(150,54),n.stroke();else{n.beginPath(),n.moveTo(112,8),n.lineTo(160,8),n.lineTo(166,34),n.lineTo(198,42),n.lineTo(198,52),n.lineTo(108,52),n.closePath(),n.fill(),n.fillStyle=l.ink;for(let c=0;c<3;c++)n.fillRect(118,14+c*10,40,4)}const m=h.toDataURL("image/png");return D.set(e,m),m}const on=[["chinBar","chin bar"],["visor","visor"],["hood","hood"],["guards","guards"],["spine","spine plates"],["belt","belt"]],At={race:"Cut for the gates: one skin, no slack, nothing on it the clock has to carry.",shell:"A jacket and pants built for the weather first and the lift queue second.",freeride:"Bib pants under a short jacket, cut wide enough to sit down in the trees.",retro:"The loudest page of an old catalogue, reprinted without one apology for it.",armour:"Plated where a fall lands — spine, chin and hands — worn over the suit."},je=e=>"#"+(e&16777215).toString(16).padStart(6,"0"),xe=e=>(.2126*(e>>16&255)+.7152*(e>>8&255)+.0722*(e&255))/255,rn='900 %px "Helvetica Neue", Helvetica, Arial, sans-serif',Ct=new Map;function sn(e){const l=Ct.get(e.code);if(l)return l;const p=300,f=58,u=e.palette,h=document.createElement("canvas");h.width=p,h.height=f;const n=h.getContext("2d"),m=u.jacket,c=[[0,150,m],[150,230,u.pants],[230,275,u.helmet],[275,300,u.accent!=null?u.accent:u.strap!=null?u.strap:u.glove]];for(const[O,C,S]of c)n.fillStyle=je(S??m),n.fillRect(O,0,C-O,f);Pt(n,e,m,f);const w=h.toDataURL("image/png");return Ct.set(e.code,w),w}function Pt(e,l,p,f,u=126){const h=we(l).toUpperCase(),n=1.4;for(let c=22;c>9&&(e.font=rn.replace("%",c),!(e.measureText(h).width+n*(h.length-1)<=u));c--);e.fillStyle=Math.abs(xe(p)-xe(Wa))>=Math.abs(xe(p)-xe(1513498))?wt.cream:"#17181a",e.textBaseline="middle";let m=12;for(const c of h)e.fillText(c,m,f/2),m+=e.measureText(c).width+n}const ln=e=>on.filter(([l])=>e[l]).map(([,l])=>l),we=e=>e.house==="POI-LAB"?gt:e.house;function dn(e){const l=e.flags,p=ln(l),f=we(e);return{id:e.code,name:e.name,brand:f,tag:e.family,group:e.family,after:xt[e.code]||"",thumb:sn(e),spec:[`${l.torso} torso · ${l.helmet} helmet`,...p].join(" · "),facts:[["house",f],["family",e.family],["torso",l.torso],["helmet",l.helmet],["extras",p.join(", ")||"—"]],blurb:`${f} ${e.name}. ${At[e.family]||""}`.trim()}}const te=["looks",...me],cn={helmet:e=>[e.helmet,e.chinBar&&"chin bar",e.visor&&"visor",e.head==="robot"&&"robot head",e.mask&&"mask",e.collar==="stand"&&"stand collar"],goggles:e=>[e.goggles===!1||e.goggles==="none"?"no goggles":e.goggles==="rimless"&&"rimless"],jacket:e=>[e.torso+" torso",e.hood&&"hood",e.spine&&"spine plates",e.hem&&e.hem+" hem",e.puffy&&"puffy",e.anorak&&"anorak",e.chestPlate&&"chest plate",e.pauldrons&&"pauldrons",e.kitFerrum&&"Ferrum kit",e.kitUmbra&&"Umbra kit",e.kitPhantom&&"Phantom kit",e.kitDuke&&"Duke kit"],pants:e=>[e.pants&&e.pants+" fit",e.belt&&"belt",e.hipPlate&&"hip plate",e.bloused&&"bloused",e.beltBoxes&&"belt boxes"],gloves:e=>[e.guards&&"arm guards",e.poleGuards&&"pole guards"],boots:e=>[e.boot&&e.boot+" boot",e.shinGuards&&"shin guards"],poles:()=>[]},pn={helmet:"helmet",goggles:"lens",jacket:"jacket",pants:"pants",gloves:"glove",boots:"boot",poles:"pole"},fn={helmet:[["helmet",0,0,300,58]],goggles:[["lens",0,0,300,29],["strap",0,29,300,29]],jacket:[["chestFront",0,0,110,58],["back",110,0,110,58],["sleeveL",220,0,80,58]],pants:[["legL",0,0,200,58],["belt",200,0,100,58]],gloves:[["glove",0,0,200,58],["poleGuards",200,0,100,58]]},kn={boots:["boot"],poles:["pole","poleBand"]},Ot=22,It=e=>bt[e]?bt[e].slice(0,4):[_t[e][0],_t[e][1],Ot,Ot];let zt=!1,Bt=0;function hn(){const e=performance.now();for(const l of Fe){const{canvas:p}=mt(l.code,null,{cache:!1});for(const f of me){const u=document.createElement("canvas");u.width=300,u.height=58;const h=u.getContext("2d"),n=kn[f];if(n){const m=300/n.length;n.forEach((c,w)=>{h.fillStyle=je(Ne(l.palette,c)),h.fillRect(w*m,0,m,58)}),Pt(h,l,Ne(l.palette,n[0]),58)}else for(const[m,c,w,O,C]of fn[f]){const[S,g,y,F]=It(m);h.drawImage(p,S,g,y,F,c,w,O,C)}D.set(f+":"+l.code,u.toDataURL("image/png"))}}zt=!0,Bt=Math.round(performance.now()-e)}function un(e,l){return zt||hn(),D.get(l+":"+e.code)}function gn(e,l){const p=we(e);return{id:e.code,name:e.name,brand:p,group:e.family,tag:l,after:xt[e.code]||"",thumb:un(e,l),spec:cn[l](e.flags).filter(Boolean).join(" · ")||"—",facts:[["house",p],["family",e.family],["part",l],["colour",je(Ne(e.palette,pn[l]))]],blurb:`${p} ${e.name} — ${l}. ${At[e.family]||""}`.trim()}}const qt="x";function mn(){const e="goggles:"+qt;if(!D.has(e)){const{canvas:l}=mt("g00",null,{cache:!1}),p=document.createElement("canvas");p.width=300,p.height=58;const[f,u,h,n]=It("face");p.getContext("2d").drawImage(l,f,u,h,n,0,0,300,58),D.set(e,p.toDataURL("image/png"))}return D.get(e)}const bn=()=>({id:qt,name:"No goggles",brand:"—",tag:"goggles",thumb:mn(),spec:"bare face",facts:[["house","—"],["part","goggles"],["colour","—"]],blurb:"No goggles. The band comes off and the face is the face."}),M=[{id:"skis",label:"skis",gear:"skis",kind:"ski",icon:"ski",accent:"#4cc9f0",items:()=>sa.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:la(e),spec:`${e.len} cm · ${e.waist} mm waist · R${e.radius}`,facts:[["length",e.len+" cm"],["waist",e.waist+" mm"],["radius","R"+e.radius],["top speed",e.stats.term.toFixed(1)+" m/s"],["turn rate",e.stats.steer.toFixed(2)+" rad/s"],["chatter",e.stats.chatterSpeed===1/0?"never":e.stats.chatterSpeed+" m/s"],["spin",e.stats.spinTorque.toFixed(1)+" rad/s"],["pop","×"+e.stats.popMul.toFixed(2)]]}))},...Fa?[{id:"bike",label:"bikes",gear:"bike",kind:"bike",icon:"bike",accent:"#ff7a29",items:()=>ha.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:ga(e),spec:`${e.spec.travel} travel · ${e.spec.head.toFixed(1)}° head · ${e.spec.mass} · ${e.spec.wheel}`,facts:[["travel",e.spec.travel],["head angle",e.spec.head.toFixed(1)+"°"],["wheelbase",e.spec.wb+" mm"],["weight",e.spec.mass],["wheels",e.spec.wheel],["top speed",e.stats.term.toFixed(1)+" m/s"],["pedal cap",e.stats.pedalMax.toFixed(1)+" m/s"],["spin",e.stats.spinTorque.toFixed(1)+" rad/s"],["pop",e.stats.popFull.toFixed(1)+" m/s"]]}))}]:[],{id:"glider",label:"glider",gear:"glider",kind:"glider",icon:"glider",accent:"#a78bfa",items:()=>pa.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.tag,group:e.group,blurb:e.blurb,stats:e.stats,facts:e.facts,gear:e.gear,preview:e.preview,spec:e.facts&&e.facts.length?e.facts.slice(0,3).map(([l,p])=>`${l} ${p}`).join(" · "):"",thumb:Tt("glider-"+e.id,Xa[e.glyph],e.glyph)}))},{id:"sled",label:"sled",gear:"sled",kind:"sled",icon:"sled",accent:"#c98a3f",remember:Ma,apply:e=>window.__player?.setSledModel?.(e),items:()=>va.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:Sa(e),spec:`${e.spec.length} · ${e.spec.deck} · ${e.spec.mass}`,facts:[["length",e.spec.length],["width",e.spec.width],["deck",e.spec.deck],["runners",e.spec.runners],["weight",e.spec.mass],["top speed",e.stats.term.toFixed(1)+" m/s"],["turn rate",e.stats.steer.toFixed(2)+" rad/s"],["wipe tolerance",(e.stats.wipeTol*180/Math.PI).toFixed(0)+"°"],["stalls below",e.stats.stallSpeed.toFixed(1)+" m/s"]]}))},{id:"snowmobile",label:"snowmobile",gear:"snowmobile",kind:"snowmobile",icon:"snowmobile",accent:"#ff6a1f",remember:Ia,apply:e=>window.__player?.setSnowmobileModel?.(e),items:()=>Ca.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:Oa(e),spec:`${e.spec.engine} · ${e.spec.mass}`,facts:[["engine",e.spec.engine],["track",e.spec.track],["weight",e.spec.mass],["suspension",e.spec.suspension],["top speed",e.stats.term.toFixed(1)+" m/s"],["climbs to",e.stats.climbDeg.toFixed(1)+"°"],["reverse",e.stats.reverseMax.toFixed(1)+" m/s"],["brake",e.stats.brake.toFixed(0)+" m/s²"]]}))},{id:"boots",label:"boots",gear:"boots",kind:"boots",icon:"boots",accent:"#e0b166",items:()=>[{id:"boots",name:"Boots",brand:gt,tag:"on foot",group:"lab",blurb:"The Quake-ish walk controller, untouched since the first commit. Walk, sprint, jump, step over anything under 55 cm. Nothing you equip can change how this feels.",stats:{turn:1,speed:.1,stab:1,pop:.2},thumb:Tt("boots",{base:"#26231f",ink:"#12110f",accent:"#cdc7ba"},"boot"),spec:"walk 4.5 m/s · sprint 8.0 m/s · step 0.55 m",facts:[["walk","4.5 m/s"],["sprint","8.0 m/s"],["jump","4.5 m/s"],["step up","0.55 m"]]}]},{id:"outfit",label:"outfit",kind:"outfit",icon:"outfit",accent:"#ff5c8a",remember:Da,apply:(e,l)=>window.__player?.setOutfit?.(l&&l!=="looks"?{[l]:e}:e),items:e=>!e||e==="looks"?Fe.map(dn):[...e==="goggles"?[bn()]:[],...Fe.map(l=>gn(l,e))]},{id:"trails",label:"trails",kind:"trail",icon:"trail",accent:"#4cc9f0",items:()=>xn(Nt,Dt)},{id:"settings",label:"settings",kind:"settings",icon:"gear",accent:"#4fd6a9",items:()=>Ua.map(e=>({id:e.key,key:e.key,name:e.label,desc:e.desc}))}],Ft={double:4,black:3,blue:2,green:1},$e={green:{cls:"is-circ",label:"green circle"},blue:{cls:"is-sq",label:"blue square"},black:{cls:"is-dia",label:"black diamond"},double:{cls:"is-dia2",label:"double diamond"}},_n={"ski-run":"run","bike-trail":"trail",lift:"lift",venue:"venue",landmark:"landmark",notice:"notice"};function xn(e,l){if(!e)return[];let p=null;try{p=Ya(e,l==="z"?"z":"y")}catch{return[]}if(!p||!p.size)return[];const f=new Map;for(const n of Array.isArray(e.runs)?e.runs:[])n&&n.id&&f.set(n.id,{diff:n.diff||null,kind:"run",width:n.width});for(const n of Array.isArray(e.markers)?e.markers:[])n&&n.id&&f.set(n.id,{diff:n.diff||null,kind:_n[n.kind]||n.kind||null});const u=new Map;for(const[n,m]of p){if(!m||!m.id)continue;let c=u.get(m.id);if(!c){const w=f.get(m.id)||{};c={id:m.id,slug:n,name:m.name||m.id,at:m.at,diff:w.diff||null,kind:w.kind||m.kind||null,viaSign:m.kind==="marker",slugs:[]},u.set(m.id,c)}}for(const[n,m]of Object.entries(Va)){const c=u.get(m);c&&n!==c.slug&&!c.slugs.includes(n)&&c.slugs.push(n)}const h=[...u.values()];return h.sort((n,m)=>(Ft[m.diff]||0)-(Ft[n.diff]||0)||String(n.name).localeCompare(String(m.name))),h.map(n=>({id:n.id,slug:n.slug,name:n.name,at:n.at,diff:n.diff,kind:n.kind,viaSign:n.viaSign,also:n.slugs.slice(0,2).join(" · ")}))}const wn=`
.lk {
  --lk-acc: #4cc9f0;
  --lk-scrim: rgba(6, 9, 14, .66);
  --lk-panel: #12161d;
  --lk-panel-2: #191f28;
  --lk-panel-3: #212936;
  --lk-line: #2a3341;
  --lk-line-2: #3a4655;
  --lk-ink: #eef4fa;
  --lk-ink-2: #a6b4c4;
  --lk-ink-3: #6b7a8c;
  --lk-good: #56d97f;
  --lk-bad: #ff6b6b;
  --lk-mono: ui-monospace, "Cascadia Mono", Consolas, "Segoe UI Mono", "DejaVu Sans Mono", monospace;
  --lk-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; padding: 16px;
  background: var(--lk-scrim);
  backdrop-filter: blur(6px) saturate(.9);
  -webkit-backdrop-filter: blur(6px) saturate(.9);
  font-family: var(--lk-sans);
  color: var(--lk-ink);
  pointer-events: auto;
  opacity: 0;
  transition: opacity .16s ease-out;
}
.lk[hidden] { display: none; }
.lk.is-in { opacity: 1; }
.lk.is-out { pointer-events: none; }
.lk *, .lk *::before, .lk *::after { box-sizing: border-box; }
/* the display rules below are all author-level, so [hidden] needs to shout */
.lk [hidden] { display: none !important; }
.lk button { font: inherit; color: inherit; background: none; border: 0; margin: 0; }

/* ------------------------------------------------------------------ panel */
.lk__panel {
  position: relative;
  width: min(1560px, 96vw); height: min(880px, 92vh);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-height: 0;
  background:
    radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.055), transparent 60%),
    linear-gradient(180deg, #141a22 0%, var(--lk-panel) 42%, #0f141a 100%);
  border: 1px solid var(--lk-line);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.03) inset;
  overflow: hidden;
  transform: translateY(16px) scale(.982);
  opacity: 0;
  transition: transform .2s cubic-bezier(.2,.8,.25,1), opacity .16s ease-out;
}
.lk.is-in .lk__panel { transform: none; opacity: 1; }
/* the accent hairline across the top — the one place the tab colour shouts */
.lk__panel::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--lk-acc) 18%, var(--lk-acc) 82%, transparent);
  opacity: .9;
}

/* ----------------------------------------------------------------- header */
.lk__hd {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 18px 11px;
  border-bottom: 1px solid var(--lk-line);
}
.lk__title {
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__title b { color: var(--lk-acc); }
.lk__spacer { flex: 1 1 auto; }
.lk__load { display: flex; align-items: center; gap: 14px; }
.lk__load-i { display: flex; align-items: baseline; gap: 6px; }
.lk__load-k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__load-v {
  font-family: var(--lk-mono); font-size: 10.5px; letter-spacing: .04em; color: var(--lk-ink-2);
  max-width: 19ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ------------------------------------------------------------------- tabs */
.lk__tabs {
  display: flex; align-items: stretch; gap: 6px;
  padding: 10px 18px 0; border-bottom: 1px solid var(--lk-line);
}
/* NOTHING that says "this is the active tab" is transitioned. A CSS transition
   is driven by the document's animation clock, and on a frame-starved deck —
   a heavy world behind the panel, a software rasteriser — that clock can stall
   long enough for the strip to keep advertising the tab you just left. Colour
   changes here snap; only the decorative hover lift below animates. */
.lk__tab {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px 10px; cursor: pointer;
  border-radius: 8px 8px 0 0;
  color: var(--lk-ink-3);
}
.lk__tab svg { width: 17px; height: 17px; flex: none; }
.lk__tab-l {
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
}
.lk__tab-n {
  font-family: var(--lk-mono); font-size: 9.5px; font-variant-numeric: tabular-nums;
  padding: 1px 5px; border-radius: 999px;
  background: var(--lk-panel-3); color: var(--lk-ink-3);
}
.lk__tab::after {
  content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px;
  background: var(--lk-tab-acc, var(--lk-acc)); border-radius: 2px 2px 0 0;
  transform: scaleX(0); transform-origin: 50% 100%;
}
.lk__tab:hover { color: var(--lk-ink-2); background: rgba(255,255,255,.035); }
.lk__tab.is-on { color: var(--lk-ink); background: rgba(255,255,255,.05); }
.lk__tab.is-on::after { transform: scaleX(1); }
.lk__tab.is-on .lk__tab-n { background: var(--lk-tab-acc, var(--lk-acc)); color: #08111a; }
.lk__tab.is-on svg { color: var(--lk-tab-acc, var(--lk-acc)); }

/* ------------------------------------------------------------------- body */
.lk__main {
  display: grid; gap: 14px; min-height: 0;
  /* the two side decks grow with the panel instead of pinning at 320/340, so a
     2560-wide deck spends its extra width on the preview and the spec sheet
     rather than on ever-wider cards */
  grid-template-columns: minmax(300px, 23%) minmax(0, 1fr) minmax(330px, 23%);
  grid-template-areas: "pv grid det";
  padding: 14px 18px;
}

/* ---- left: the mannequin */
.lk__pv { grid-area: pv; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px; min-height: 0; }
.lk__stage {
  position: relative; min-height: 0; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--lk-line);
  background:
    radial-gradient(78% 52% at 50% 92%, var(--lk-acc-soft, rgba(76,201,240,.16)), transparent 68%),
    radial-gradient(120% 80% at 50% 8%, rgba(255,255,255,.05), transparent 62%),
    linear-gradient(180deg, #0d1218 0%, #10161e 60%, #0a0e13 100%);
}
/* the floor: one soft ellipse the figure stands on, drawn in CSS so the
   preview scene stays two lights and a turntable */
.lk__stage::after {
  content: ""; position: absolute; left: 50%; bottom: 12%; width: 62%; height: 9%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0,0,0,.55), transparent 78%);
  pointer-events: none;
}
/* play.css carries \`body.play canvas { position: fixed; left: 0; top: 0 }\` for the
   world's own canvas, and that selector (0,1,2) outranks a single class. The
   preview renderer is a canvas in this document too, so it needs three classes
   to stay inside its box — without them it paints over the whole viewport. */
.lk .lk__stage .lk__canvas {
  display: block; position: absolute; left: 0; width: 100%; z-index: 1;
  /* height and top come from resizePreview(), which caps the 3D viewport to a
     3:4 band centred in the stage — see the comment there */
}
.lk__eqflash {
  position: absolute; inset: 0; z-index: 2; pointer-events: none; opacity: 0;
  background: radial-gradient(58% 42% at 50% 62%, var(--lk-acc), transparent 70%);
  mix-blend-mode: screen;
}
.lk__eqflash.is-go { animation: lk-flash .5s ease-out; }
@keyframes lk-flash {
  0% { opacity: 0; transform: scale(.86); }
  22% { opacity: .55; }
  100% { opacity: 0; transform: scale(1.06); }
}
.lk__plate {
  display: grid; gap: 3px; padding: 10px 12px;
  border: 1px solid var(--lk-line); border-radius: 10px;
  background: linear-gradient(180deg, var(--lk-panel-2), var(--lk-panel));
  /* specs/0012 §C — no left stripe. The brand line above the name is already
     accent-coloured; the plate did not need a second one turned on its side. */
}
.lk__plate-brand {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--lk-acc);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__plate-name { font-size: 16px; font-weight: 680; letter-spacing: -.01em; line-height: 1.15; }
.lk__plate-tag {
  font-family: var(--lk-mono); font-size: 9.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--lk-ink-3);
}

/* ---- middle: filters + the card grid */
.lk__mid { grid-area: grid; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; min-height: 0; }
/* specs/0039 — the sub-strip and the family filters are ONE grid row between
   them, so a tab that shows neither (every rack but the outfit one shows only
   the filters) collapses to nothing and the card grid keeps its own row. */
.lk__bars { display: grid; gap: 8px; }
.lk__filters, .lk__subs { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lk__filters[hidden], .lk__subs[hidden] { display: none; }
/* the sub-tabs are chips in the tab's own accent; the group dot the family chips
   carry says nothing here, so it stands down */
.lk__subs .lk__chip::before { display: none; }
.lk__subs .lk__key { margin-right: 3px; }
.lk__chip {
  display: inline-flex; align-items: baseline; gap: 6px; cursor: pointer;
  padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--lk-line-2);
  background: rgba(255,255,255,.02);
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__chip i { font-style: normal; font-variant-numeric: tabular-nums; opacity: .7; letter-spacing: 0; }
.lk__chip::before {
  content: ""; width: 7px; height: 7px; border-radius: 2px; flex: none;
  background: var(--g, var(--lk-ink-3)); align-self: center;
}
.lk__chip:hover { color: var(--lk-ink); border-color: var(--g, var(--lk-line-2)); }
.lk__chip.is-on {
  color: #08111a; border-color: var(--g, var(--lk-acc));
  background: var(--g, var(--lk-acc));
}
.lk__chip.is-on::before { background: rgba(0,0,0,.42); }

.lk__grid {
  display: grid; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  overflow-y: auto; overflow-x: hidden;
  min-height: 0; padding: 8px 10px 14px 6px;
  scrollbar-color: var(--lk-line-2) transparent;
}
.lk__grid::-webkit-scrollbar { width: 9px; }
.lk__grid::-webkit-scrollbar-track { background: transparent; }
.lk__grid::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.lk__grid::-webkit-scrollbar-thumb:hover { background: var(--lk-ink-3); background-clip: content-box; }
.lk__grid.is-swap { animation: lk-swap .22s ease-out; }
@keyframes lk-swap { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }

/* ---- the card */
.lk__card {
  position: relative; display: grid; gap: 7px; cursor: pointer; text-align: left;
  padding: 9px 9px 10px;
  border: 1px solid var(--lk-line);
  border-radius: 11px;
  background:
    linear-gradient(158deg, var(--g-wash) 0%, var(--lk-panel-2) 58%, var(--lk-panel-2) 100%);
  /* border-color is the selection ring and is deliberately NOT transitioned —
     see the note on .lk__tab. The lift and the glow are decoration and may lag. */
  transition: transform .14s cubic-bezier(.2,.8,.25,1), box-shadow .18s;
}
.lk__card:hover {
  transform: translateY(-3px);
  border-color: var(--g);
  box-shadow: 0 12px 26px rgba(0,0,0,.5), 0 0 22px -8px var(--g-glow);
}
.lk__card.is-sel {
  transform: translateY(-3px);
  border-color: var(--lk-acc);
  box-shadow: 0 0 0 1px var(--lk-acc), 0 14px 30px rgba(0,0,0,.55), 0 0 26px -6px var(--lk-acc);
}
.lk__card.is-eq { background: linear-gradient(158deg, var(--g-wash) 0%, var(--lk-panel-3) 62%, var(--lk-panel-2) 100%); }
.lk__card.is-go { animation: lk-equip .42s cubic-bezier(.2,.9,.25,1); }
@keyframes lk-equip {
  0% { transform: translateY(-3px) scale(1); }
  34% { transform: translateY(-6px) scale(1.045); }
  100% { transform: translateY(-3px) scale(1); }
}
.lk__art {
  position: relative; display: grid; place-items: center;
  height: 78px; border-radius: 8px; overflow: hidden;
  background: linear-gradient(180deg, rgba(0,0,0,.34), rgba(0,0,0,.16));
  box-shadow: 0 1px 0 rgba(255,255,255,.045) inset;
}
.lk__img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.lk__gchip {
  position: absolute; top: 6px; right: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 999px;
  background: var(--g); color: #08111a;
}
.lk__brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--g);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* specs/0042 — the real thing under the invented house. The muted card text, one
   size down from .lk__tag, no accent, and NOT uppercased: POC, EA7 and Arc’teryx
   carry their own case and the lowercase "after" keeps it off the house line. */
.lk__after, .lk__d-after {
  font-family: var(--lk-mono); font-size: 8px; letter-spacing: .1em; color: var(--lk-ink-3);
  margin-top: -4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__d-after { font-size: 9px; letter-spacing: .06em; margin-top: 0; }
.lk__name {
  /* two lines' worth whether the name needs them or not, so a rack that mixes
     "Trek Ticket DJ" with "Specialized Epic Hardtail" still rules a level grid */
  font-size: 12.5px; font-weight: 640; line-height: 1.22; min-height: 2.44em;
  color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lk__tag {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__eq {
  position: absolute; left: 9px; top: 9px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 7px 3px 5px; border-radius: 999px;
  background: var(--lk-acc); color: #08111a;
  box-shadow: 0 2px 10px rgba(0,0,0,.4);
}
.lk__eq::before { content: "\\2713"; font-size: 9px; letter-spacing: 0; }

/* ---- specs/0019: the settings rows.
   The same grid element the cards live in, switched to one full-width column,
   so the scrolling, the keyboard selection and the swap animation are the ones
   that already work rather than a second implementation of them. */
.lk__grid.is-rows { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.lk__row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 8px 16px; cursor: pointer; text-align: left;
  padding: 13px 15px;
  border: 1px solid var(--lk-line); border-radius: 11px;
  background: linear-gradient(158deg, rgba(255,255,255,.03) 0%, var(--lk-panel-2) 62%, var(--lk-panel-2) 100%);
  /* border-color is the selection ring: not transitioned, same note as .lk__tab */
  transition: transform .14s cubic-bezier(.2,.8,.25,1), box-shadow .18s;
}
.lk__row:hover { transform: translateY(-2px); border-color: var(--lk-line-2); }
.lk__row.is-sel {
  transform: translateY(-2px);
  border-color: var(--lk-acc);
  box-shadow: 0 0 0 1px var(--lk-acc), 0 12px 26px rgba(0,0,0,.5);
}
.lk__row.is-go { animation: lk-equip .42s cubic-bezier(.2,.9,.25,1); }
/* both are SPANS in a <button> (a button may not contain a <div>), so they have
   to be told to be blocks — left inline they set as one paragraph and the label
   runs straight into the sentence after it */
.lk__row-t {
  display: block;
  font-family: var(--lk-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__row-d { display: block; font-size: 11.5px; line-height: 1.45; color: var(--lk-ink-2); margin-top: 5px; }
.lk__row-txt { display: block; min-width: 0; }
/* the switch: a track, a plate, and a word. NOTHING here is transitioned, and
   that is the .lk__tab note applied to the one control on this screen where
   being wrong for a moment is worst: a transition runs on the document's
   animation clock, and on a frame-starved deck (a heavy world behind the panel,
   a software rasteriser) that clock stalls — the first cut animated the knob's
   travel and photographed a switch reading ON with its knob still hard left.
   A switch may not lie about its state for even one frame.

   specs/0055 5.3 — LOCKER SETTINGS **A** (D14). The pill and its round knob are
   gone: the control is A SQUARE INK PLATE SLIDING IN A CREAM TRACK, 1.10's plate
   at 18 px, so the settings switch is the same object as a lift sign's plate
   and not a borrowed OS control. No switch component is introduced — this is
   the plate, the track and the ON/OFF word, and the knobs keep their full
   verbatim blurbs above (settings.js:38-52, untouched). */
.lk__sw { display: inline-flex; align-items: center; gap: 10px; }
.lk__sw-t {
  position: relative; width: 34px; height: 18px; border-radius: 2px; flex: none;
  background: var(--p-cream);
  box-shadow: inset 0 0 0 1px rgba(23, 22, 20, .55);
}
.lk__sw-t::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 0; background: #8f887a;
}
.lk__sw-v {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--lk-ink-3);
  width: 3ch;
}
.lk__sw.is-on .lk__sw-t::after { background: var(--p-ink); transform: translateX(16px); }
.lk__sw.is-on .lk__sw-v { color: var(--lk-acc); }

/* W1 TOOK THE HAND-OFF (specs/0055 1.1). W4 typed the cream, the ink and the
   seam here because the :root block did not exist yet; it does, so the two
   blocks below read --p-cream / --p-ink / --p-seam and this file names no
   colour of its own. hud.js's sheet is injected at import time, which is before
   this stylesheet paints anything, so there is no first-frame gap.

   ---- specs/0055 5.2: THE TRAIL QUICK-TRAVEL TAB.
   The lookbook's trail selector, and it is the only surface in this file that
   leaves the dark locker for the map board — because it is a MAP, and 1.6
   allows exactly the two surfaces those two names carry. Nothing else on this
   screen changes: the racks keep their white preview squares, their font and
   their eight outfit sub-tabs, byte for byte (D15, 10.8). */
.lk__grid.is-trails { gap: 0; background: var(--p-cream); padding: 10px 12px 12px; border-radius: 2px; }
.lk__trow {
  display: grid; align-items: center;
  grid-template-columns: 22px minmax(0, 1fr) 74px 132px;
  gap: 0 12px;
  padding: 9px 8px; margin: 0;
  background: none; border: 0; border-radius: 0;
  border-bottom: 1px solid var(--p-seam);              /* the hairline row rule (1.10) */
  box-shadow: none; transform: none;
  text-align: left; cursor: pointer;
  transition: none;
}
.lk__trow:hover, .lk__trow.is-sel { transform: none; background: #e6e2d8; border-color: var(--p-seam); box-shadow: none; }
.lk__trow.is-sel { box-shadow: inset 3px 0 0 var(--p-ink); }
.lk__trow.is-go { animation: none; }
.lk__trow-n {
  display: block; font-family: var(--lk-sans); font-size: 15px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--p-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a, .lk__trow-k, .lk__trow-s {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: #8f887a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a { display: block; margin-top: 2px; color: #a49c8d; }
.lk__trow-k { color: #726c60; }
.lk__trow-s { text-align: right; }

/* 1.8's severity alphabet, one CSS class per shape. Colours are the ones the
   world already uses: green circle, blue square, black diamond, double. */
.lk__mark { display: block; width: 13px; height: 13px; justify-self: center; }
.lk__mark.is-circ { border-radius: 50%; background: #2f9e44; }
.lk__mark.is-sq { background: #2a5fd6; }
.lk__mark.is-dia { background: var(--p-ink); transform: rotate(45deg); width: 11px; height: 11px; }
/* a double diamond is TWO diamonds, so it is two rotated boxes on one element
   rather than a clipped bar — the same shape the atlas draws, at row size */
.lk__mark.is-dia2 { width: 22px; height: 11px; background: none; position: relative; transform: none; }
.lk__mark.is-dia2::before,
.lk__mark.is-dia2::after {
  content: ""; position: absolute; top: 1px; width: 9px; height: 9px;
  background: var(--p-ink); transform: rotate(45deg);
}
.lk__mark.is-dia2::before { left: 0; }
.lk__mark.is-dia2::after { right: 0; }
/* an unrated place gets an empty cell, not a neutral glyph (1.8) */

/* ---- right: the detail panel */
.lk__det {
  grid-area: det; min-height: 0;
  display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); gap: 11px;
  padding: 12px; border: 1px solid var(--lk-line); border-radius: 12px;
  background: linear-gradient(180deg, var(--lk-panel-2) 0%, var(--lk-panel) 100%);
  overflow: hidden;
}
.lk__hero {
  /* the art grows into whatever height the deck has spare — 132 px at 720p,
     ~190 px at 1080p — instead of leaving the panel's foot empty */
  position: relative; height: clamp(132px, 18vh, 216px);
  border-radius: 10px; overflow: hidden;
  display: grid; place-items: center;
  background: linear-gradient(180deg, rgba(0,0,0,.4), rgba(0,0,0,.2));
  border: 1px solid var(--lk-line);
}
/* the same art, blown up and blurred, as its own backdrop — depth for free */
.lk__hero-bg {
  position: absolute; inset: -18%;
  background-position: center; background-repeat: no-repeat; background-size: cover;
  filter: blur(20px) saturate(1.5); opacity: .38; transform: scale(1.1);
}
.lk__hero-img { position: relative; max-width: 92%; max-height: 82%; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,.55)); }
.lk__hero-eq {
  position: absolute; right: 8px; top: 8px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 999px;
  background: var(--lk-acc); color: #08111a;
}
.lk__d-head { display: grid; gap: 3px; }
.lk__d-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--g, var(--lk-acc));
}
.lk__d-name { font-size: 17px; font-weight: 680; letter-spacing: -.012em; line-height: 1.14; }
.lk__d-spec {
  font-family: var(--lk-mono); font-size: 10px; letter-spacing: .02em; color: var(--lk-ink-2);
}
.lk__d-blurb {
  font-size: 11.5px; line-height: 1.5; color: var(--lk-ink-2);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}

/* ---- stat bars, with the delta against what is equipped */
.lk__stats { display: grid; gap: 6px; align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0; }
.lk__stats::-webkit-scrollbar { width: 7px; }
.lk__stats::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; }
.lk__stat { display: grid; grid-template-columns: 68px minmax(0, 1fr) 30px 34px; align-items: center; gap: 8px; }
.lk__stat-k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__stat-t {
  position: relative; height: 7px; border-radius: 999px; overflow: hidden;
  background: var(--lk-panel-3); box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset;
}
.lk__stat-t i, .lk__stat-t u {
  position: absolute; top: 0; bottom: 0; display: block;
  transition: left .18s ease-out, width .18s ease-out, background .2s;
}
/* the bar itself stops at the SHARED value; the delta segment carries the sign */
.lk__stat-t i { left: 0; width: 0; background: linear-gradient(90deg, var(--lk-acc-dim, #2a6f88), var(--lk-acc)); }
.lk__stat-t u { width: 0; text-decoration: none; }
.lk__stat-t u.is-up { background: var(--lk-good); box-shadow: 0 0 10px -1px var(--lk-good); }
.lk__stat-t u.is-down {
  background: repeating-linear-gradient(-45deg, var(--lk-bad) 0 3px, rgba(255,107,107,.45) 3px 6px);
}
.lk__stat-v {
  font-family: var(--lk-mono); font-size: 10px; font-variant-numeric: tabular-nums;
  text-align: right; color: var(--lk-ink);
}
.lk__stat-d {
  font-family: var(--lk-mono); font-size: 9.5px; font-variant-numeric: tabular-nums;
  text-align: right; color: var(--lk-ink-3);
}
.lk__stat-d.is-up { color: var(--lk-good); }
.lk__stat-d.is-down { color: var(--lk-bad); }
.lk__cmp {
  font-family: var(--lk-mono); font-size: 8.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--lk-ink-3);
  display: flex; align-items: center; gap: 6px;
}
.lk__cmp::before { content: ""; flex: 1 1 auto; height: 1px; background: var(--lk-line); }

.lk__facts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px;
  align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0;
  border-top: 1px solid var(--lk-line); padding-top: 9px;
}
.lk__facts::-webkit-scrollbar { width: 7px; }
.lk__facts::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 999px; }
.lk__fact { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.lk__fact .k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__fact .v { font-family: var(--lk-mono); font-size: 10px; color: var(--lk-ink-2); font-variant-numeric: tabular-nums; }

/* ---------------------------------------------------------------- hint bar */
.lk__foot {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 9px 18px 10px; border-top: 1px solid var(--lk-line);
  background: rgba(0,0,0,.22);
}
.lk__hint { display: inline-flex; align-items: center; gap: 7px; }
.lk__hint span {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 19px; padding: 0 5px;
  border: 1px solid var(--lk-line-2); border-bottom-width: 2px; border-radius: 5px;
  background: linear-gradient(180deg, var(--lk-panel-3), var(--lk-panel-2));
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .04em; color: var(--lk-ink-2);
}
.lk__foot-sp { flex: 1 1 auto; }

/* ------------------------------------------------------------ narrow decks */
@media (max-width: 1180px) {
  .lk__main {
    grid-template-columns: 250px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 250px);
    grid-template-areas: "pv grid" "det det";
  }
  .lk__hero { height: 96px; }
  .lk__det { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: "hero head" "hero blurb" "stats facts"; column-gap: 14px; }
  .lk__hero { grid-area: hero; height: 100%; }
  .lk__d-head { grid-area: head; align-self: end; }
  .lk__d-blurb { grid-area: blurb; -webkit-line-clamp: 3; }
  .lk__stats { grid-area: stats; }
  .lk__facts { grid-area: facts; }
}
@media (max-width: 860px) {
  .lk__main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "pv" "grid" "det"; grid-template-rows: 190px minmax(0,1fr) 220px; }
  .lk__load { display: none; }
}
@media (max-height: 760px) {
  .lk__hero { height: 104px; }
  .lk__d-blurb { -webkit-line-clamp: 3; }
}

@media (prefers-reduced-motion: reduce) {
  .lk, .lk *, .lk *::before, .lk *::after {
    transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important;
  }
}
`;let Rt=!1;function vn(){if(Rt||typeof document>"u")return;Rt=!0;const e=document.createElement("style");e.id="lk-css",e.textContent=wn,document.head.appendChild(e)}let Nt=null,Dt="y";function Fn({THREE:e,model:l,unitScale:p,ctrl:f,onEquip:u,initial:h,world:n,upAxis:m}){vn(),n&&(Nt=n,Dt=m==="z"?"z":"y");const c=p||1;let w=!1,O=0,C="all",S="looks",g=0,y=[],F=null;try{F=new URLSearchParams(location.search)}catch{F=null}const T={skis:h&&h.skis||ca,glider:h&&h.glider||fa,bike:h&&h.bike||ua,sled:h&&h.sled||(F?La(F):ya),snowmobile:h&&h.snowmobile||(F?za(F):Pa),boots:Ha("boots")||"boots",outfit:h&&h.outfit||Ea()},A=r("div","lk");A.hidden=!0;const Ge=r("section","lk__panel"),Ue=r("div","lk__hd"),Ke=r("div","lk__title");Ke.innerHTML="equipment <b>locker</b>";const We=r("div","lk__load"),ae={};for(const t of M){if(t.id==="boots"||t.kind==="settings"||t.kind==="trail")continue;const a=r("div","lk__load-i"),i=r("span","lk__load-v","—");a.append(r("span","lk__load-k",t.label),i),We.append(a),ae[t.id]=i}Ue.append(Ke,r("span","lk__spacer"),We);const Ye=r("div","lk__tabs"),ve=M.map((t,a)=>{const i=r("button","lk__tab");i.type="button",i.style.setProperty("--lk-tab-acc",t.accent||"#4cc9f0");const s=r("span","lk__tab-ic");s.innerHTML=tn(t.icon);const d=r("span","lk__tab-n","0");return i.append(s.firstChild,r("span","lk__tab-l",t.label),d),i.addEventListener("click",k=>{k.stopPropagation(),Z(a)}),Ye.append(i),{b:i,n:d}}),Ve=r("div","lk__main"),Xe=r("div","lk__pv"),Y=r("div","lk__stage"),V=r("div","lk__eqflash");Y.append(V);const Qe=r("div","lk__plate"),He=r("div","lk__plate-brand",""),Je=r("div","lk__plate-name","—"),Ze=r("div","lk__plate-tag","");Qe.append(He,Je,Ze),Xe.append(Y,Qe);const et=r("div","lk__mid"),U=r("div","lk__subs");U.hidden=!0;const ne=r("div","lk__filters"),tt=r("div","lk__bars");tt.append(U,ne);const B=r("div","lk__grid");et.append(tt,B);const X=r("div","lk__det"),Q=r("div","lk__hero"),ie=r("div","lk__hero-bg"),K=r("img","lk__hero-img");K.alt="";const H=r("div","lk__hero-eq","equipped");H.hidden=!0,Q.append(ie,K,H);const at=r("div","lk__d-head"),oe=r("div","lk__d-brand",""),ye=r("div","lk__d-after",""),re=r("div","lk__d-name","—"),se=r("div","lk__d-spec","");at.append(oe,ye,re,se);const le=r("div","lk__d-blurb",""),W=r("div","lk__stats"),nt=r("div","lk__cmp"),E=r("div","lk__facts");X.append(Q,at,le,W,E),Ve.append(Xe,et,X);const de=r("div","lk__foot"),Et=[[["←","→","↑","↓"],"navigate"],[["enter"],"equip"],[["q","e"],"tabs"],[["f"],"filter"],[["1-9"],"quick equip"]];for(const[t,a]of Et){const i=r("span","lk__hint");for(const s of t)i.append(r("kbd","lk__key",s));i.append(r("span",null,a)),de.append(i)}de.append(r("span","lk__foot-sp"));const it=r("span","lk__hint");it.append(r("kbd","lk__key","esc"),r("span",null,"close")),de.append(it),Ge.append(Ue,Ye,Ve,de),A.append(Ge),document.body.appendChild(A);let o=null;function jt(){const t=new e.Scene;t.add(new e.HemisphereLight(16777215,3816004,1.35));const a=new e.DirectionalLight(16777215,1.05);a.position.set(3,5,4);const i=new e.DirectionalLight(16767432,.5);i.position.set(-4,2,-3),t.add(a,i);const s=new e.Group;t.add(s);const d=l?l.clone(!0):new e.Group,k=l&&l.getObjectByName("play:body"),b=k?Ga(k):null,_=b?$a(b):null;if(_){const x=d.getObjectByName("play:body");x&&x.parent?(x.parent.add(_.model),x.parent.remove(x)):d.add(_.model),_.skeleton.pose(),_.model.updateMatrixWorld(!0)}d.position.set(0,0,0),d.rotation.set(0,0,0);const P=[];d.traverse(x=>{const kt=Na(x.name||"")!=null&&l.getObjectByName(x.name);kt?P.push([x,kt]):x.visible=!0});const q=new Set;_&&_.model.traverse(x=>{x.isMesh&&/^rider:/.test(x.name||"")&&x.material&&q.add(x.material)});const I=_?new Map([..._.riderMats].filter(([,x])=>q.has(x))):new Map,Ce=_?_.riderToggles:[],$=/^play:(?:fp-|tp-)|^play:ski-[lr]$|^play:rocket-pack$/;d.traverse(x=>{x.name&&$.test(x.name)&&(x.visible=!1)});const he=d.getObjectByName("play:tp-glider"),G=d.getObjectByName("play:body"),ia=d.getObjectByName("play:rocket-pack"),Pe=G?G.getObjectByName("rider:body"):null,oa=Pe?new e.AnimationMixer(Pe):null,ft=new Map;for(const x of G&&G.animations||[])ft.set(x.name,x);s.add(d);const Oe=ht(e,c),Ie=ht(e,c);Oe.position.set(-.15*c,.02*c,0),Ie.position.set(.15*c,.02*c,0),s.add(Oe,Ie);const ze=ba(e,c);ze.visible=!1,s.add(ze);const Be=Ta(e,c);Be.visible=!1,s.add(Be);const qe=Ba(e,c,{model:T.snowmobile});qe.visible=!1,s.add(qe);const ra=new e.PerspectiveCamera(34,1,.05*c,80*c),ue=new e.WebGLRenderer({alpha:!0,antialias:!0});ue.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),ue.domElement.className="lk__canvas",Y.insertBefore(ue.domElement,V),o={scene:t,camera:ra,renderer:ue,turntable:s,skiL:Oe,skiR:Ie,bike:ze,sled:Be,snow:qe,cGlide:he,cBody:G,cPack:ia,cSkin:Pe,mixer:oa,clips:ft,clip:null,want:null,riderPairs:P,riderMats:I,riderToggles:Ce,tryOn:null,t:0,kick:0},ce()}function ce(){if(!o)return;const t=Math.max(80,Y.clientWidth),a=Math.max(80,Y.clientHeight),i=Math.max(80,Math.min(a,Math.round(t*4/3)));o.renderer.setSize(t,i,!1),o.renderer.domElement.style.height=i+"px",o.renderer.domElement.style.top=Math.round((a-i)/2)+"px",o.camera.aspect=t/i,o.camera.updateProjectionMatrix()}function $t(t){if(!o||!o.mixer||o.want===t)return;o.want=t;const a=o.clips.get(t)||o.clips.get("idle-boots")||o.clips.get("ski-stance");if(!a||o.clip===a.name)return;o.mixer.stopAllAction();const i=o.mixer.clipAction(a);i.reset(),i.enabled=!0,i.setEffectiveWeight(1),i.play(),o.clip=a.name,o.mixer.setTime(0)}function Gt(t,a){if(!o)return;const i=t.kind==="outfit",s=t.kind==="ski"||i,d=t.kind==="glider"&&a?a.preview:null,k=d==="wing",b=t.kind==="bike",_=t.kind==="sled",P=t.kind==="snowmobile",q=b||_||P;if(o.skiL.visible=o.skiR.visible=s,o.cGlide&&(o.cGlide.visible=k),o.cBody&&(o.cBody.visible=!0),o.cPack&&(o.cPack.visible=d==="pack"),$t(b?"seat-bike":_?"seat-sled":P?"seat-snowmobile":k?"prone-glider":"idle-boots"),o.cBody&&(o.cBody.position.set(0,k?1.05*c:0,0),o.cBody.rotation.x=o.cBody.rotation.y=o.cBody.rotation.z=0,b&&a)){const I=wa(xa(a.id));o.cBody.position.y+=(I.hip[0]-1.053)*c,o.cBody.position.z+=(I.hip[1]-.305)*c}if(o.bike.visible=b,o.sled.visible=_,o.snow.visible=P,b&&a&&_a(e,o.bike,a.id),_&&a&&Aa(e,o.sled,a.id),P&&a&&qa(e,o.snow,a.id),s&&a){const I=i?T.skis:a.id;ut(e,o.skiL,I),ut(e,o.skiR,I)}if(i&&a){const I=S==="looks"?a.id:Kt(a.id);ge(e,o,I),o.tryOn=I}else o.tryOn!=null&&(ge(e,o,window.__player?.outfit),o.tryOn=null)}const Ut=.28;let pe=0,Se=0;function ot(t){if(!w){pe=0;return}pe=requestAnimationFrame(ot);const a=Math.min(.05,(t-Se)/1e3||0);if(Se=t,!o)return;o.hold==null&&(o.t+=a),o.turntable.rotation.y=o.hold==null?o.turntable.rotation.y+a*(Ut+o.kick):o.hold,o.mixer&&(o.hold==null?o.mixer.update(a):o.mixer.setTime(0)),o.kick*=Math.exp(-a*3.4),o.kick<.001&&(o.kick=0);const i=Math.tan(o.camera.fov*Math.PI/180/2),s=Math.max(1.12/i,1.3/(i*Math.max(.25,o.camera.aspect)))*c;if(o.camera.position.set(0,(1.3+.012*Math.sin(o.t*.7))*c,s),o.camera.lookAt(0,.86*c,0),o.tryOn==null)for(const[d,k]of o.riderPairs)d.visible=k.visible;o.renderer.render(o.scene,o.camera)}const v=()=>M[O],R=new Set;function N(t){try{const a=t.items(t.kind==="outfit"?S:void 0);if(Array.isArray(a))return R.delete(t.id),a}catch(a){R.has(t.id)||console.warn(`[locker] rack "${t.id}" unavailable:`,a&&a.message)}return R.add(t.id),[]}function rt(t){const a=[];for(const i of t)i.group&&!a.includes(i.group)&&a.push(i.group);return a}function fe(){const t=v();if(t.kind!=="outfit")return T[t.id];const a=Re(T.outfit);return S==="looks"?a.every(i=>i===a[0])?a[0]:null:a[me.indexOf(S)]}const Kt=t=>ja(Re(T.outfit).map((a,i)=>i===me.indexOf(S)?t:a));function Wt(){const t=v().kind==="outfit";if(U.hidden=!t,!!t){U.textContent="",U.append(r("kbd","lk__key","g"));for(const a of te){const i=r("button","lk__chip");i.type="button",i.style.setProperty("--g",v().accent||"#4cc9f0"),i.append(document.createTextNode(a)),i.classList.toggle("is-on",S===a),i.addEventListener("click",s=>{s.stopPropagation(),Me(a)}),U.append(i)}}}function Me(t){return te.includes(t)&&t!==S&&(S=t,g=0,J()),S}function Yt(){const t=v().accent||"#4cc9f0";A.style.setProperty("--lk-acc",t),A.style.setProperty("--lk-acc-soft",_e(t,.18)),A.style.setProperty("--lk-acc-dim",_e(t,.34))}function Vt(){M.forEach((t,a)=>{ve[a].n.textContent=String(N(t).length),ve[a].b.hidden=R.has(t.id)})}function Le(){for(const t of M){if(!ae[t.id])continue;const a=N(t).find(i=>i.id===T[t.id]);ae[t.id].parentElement.hidden=R.has(t.id),ae[t.id].textContent=t.kind==="outfit"?Xt():a?a.name:"—"}}function Xt(){const t=[...new Set(Re(T.outfit))];if(t.length>1)return"mix · "+t.length+" houses";const a=Ra[t[0]];return a?we(a)+" · "+a.name:"—"}function Qt(){const t=N(v()),a=rt(t);if(ne.textContent="",ne.hidden=a.length<2,a.length<2)return;const i={all:t.length};for(const s of a)i[s]=t.filter(d=>d.group===s).length;for(const s of["all",...a]){const d=r("button","lk__chip");d.type="button",d.style.setProperty("--g",s==="all"?v().accent||"#4cc9f0":De(s)),d.append(document.createTextNode(s),r("i",null,String(i[s]))),d.classList.toggle("is-on",C===s),d.addEventListener("click",k=>{k.stopPropagation(),C=s,g=0,J()}),ne.append(d)}}const st=new WeakMap;function lt(t,a){const i=st.get(t);if(!i)return;const s=be(a);i.el.classList.toggle("is-on",s),i.v.textContent=s?"on":"off",t.setAttribute("aria-checked",s?"true":"false")}function Ht(t,a){const i=r("button","lk__row");i.type="button",i.setAttribute("role","switch");const s=r("span","lk__row-txt");s.append(r("span","lk__row-t",t.name),r("span","lk__row-d",t.desc||""));const d=r("span","lk__sw"),k=r("span","lk__sw-v","off");return d.append(r("span","lk__sw-t"),k),st.set(i,{el:d,v:k}),i.append(s,d),lt(i,t.key),i.addEventListener("click",b=>{b.stopPropagation(),g=a,L(),ee()}),i.addEventListener("mouseenter",()=>{g=a,L()}),B.append(i),i}function Jt(t){let a=null;try{a=window.__playMarkers&&window.__playMarkers.fastTravel(t.slug)}catch{a=null}if(!a&&t.at&&window.__player&&typeof window.__player.teleport=="function")try{window.__player.teleport(t.at.x,t.at.y,t.at.z),a=!0}catch{a=null}return ke(),!!a}function Zt(t,a){const i=r("button","lk__row lk__trow");i.type="button",i.setAttribute("data-slug",t.slug);const s=$e[t.diff]||null,d=r("span","lk__mark"+(s?" "+s.cls:""));s&&d.setAttribute("aria-label",s.label);const k=r("span","lk__row-txt");return k.append(r("span","lk__trow-n",t.name)),t.also&&k.append(r("span","lk__trow-a",t.also)),i.append(d,k,r("span","lk__trow-k",t.kind||""),r("span","lk__trow-s",t.slug)),i.addEventListener("click",b=>{b.stopPropagation(),g=a,L(),ee()}),i.addEventListener("mouseenter",()=>{g=a,L()}),B.append(i),i}let z=[],Te=[];function dt(){const t=v(),a=N(t);if(Te=nn(a),y=C==="all"?a:a.filter(i=>i.group===C),y.length||(y=a),g=Math.max(0,Math.min(g,y.length-1)),B.textContent="",B.classList.toggle("is-rows",t.kind==="settings"||t.kind==="trail"),B.classList.toggle("is-trails",t.kind==="trail"),t.kind==="settings"){z=y.map(Ht),L();return}if(t.kind==="trail"){z=y.map(Zt),L();return}z=y.map((i,s)=>{const d=De(i.group),k=r("button","lk__card");k.type="button",k.style.setProperty("--g",d),k.style.setProperty("--g-wash",_e(d,.16)),k.style.setProperty("--g-glow",_e(d,.55));const b=r("span","lk__art"),_=r("img","lk__img");_.alt="",i.thumb?_.src=i.thumb:_.hidden=!0,b.append(_),i.group&&b.append(r("span","lk__gchip",i.group));const P=[r("span","lk__brand",i.brand||"")];return i.after&&P.push(r("span","lk__after",i.after)),k.append(b,...P,r("span","lk__name",i.name),r("span","lk__tag",i.tag||"")),fe()===i.id&&(k.append(r("span","lk__eq","equipped")),k.classList.add("is-eq")),k.addEventListener("click",q=>{q.stopPropagation(),g=s,L(),ee()}),k.addEventListener("mouseenter",()=>{g=s,L()}),B.append(k),k}),L()}const ct=[];function ea(t){const a=N(v()).find(s=>s.id===T[v().id])||null,i=a&&a.id===t.id;W.textContent="",ct.length=0;for(const s of Te){const d=Lt(s,t.stats[s.key]),k=a&&Ee(a.stats[s.key])?Lt(s,a.stats[s.key]):d,b=r("div","lk__stat"),_=r("span","lk__stat-t"),P=r("i"),q=r("u"),I=Math.min(d,k);P.style.width=(I*100).toFixed(1)+"%",!i&&Math.abs(d-k)>.004?(q.style.left=(I*100).toFixed(1)+"%",q.style.width=(Math.abs(d-k)*100).toFixed(1)+"%",q.classList.add(d>k?"is-up":"is-down")):P.style.width=(d*100).toFixed(1)+"%",_.append(P,q);const Ce=r("span","lk__stat-v",String(Math.round(d*100))),$=Math.round((d-k)*100),he=r("span","lk__stat-d",i||$===0?"":($>0?"+":"−")+Math.abs($));!i&&$!==0&&he.classList.add($>0?"is-up":"is-down");const G=s.src&&Ee(t.stats[s.src])?t.stats[s.src]:t.stats[s.key];b.title=`${s.label}: ${G.toFixed(2)}${s.suffix||""}`,b.append(r("span","lk__stat-k",s.label),_,Ce,he),W.append(b),ct.push(b)}Te.length&&(nt.textContent=i||!a?"equipped":"vs "+a.name,W.append(nt))}function ta(t){X.style.setProperty("--g",v().accent),K.hidden=!0,ie.style.backgroundImage="none",H.hidden=!0,Q.hidden=!0,W.textContent="",oe.textContent="settings",re.textContent=t.name,se.textContent=be(t.key)?"on":"off",le.textContent=t.desc||"",E.textContent="";for(const[a,i]of[["state",be(t.key)?"on":"off"],["default","off"]]){const s=r("div","lk__fact");s.append(r("span","k",a),r("span","v",i)),E.append(s)}}function aa(t){X.style.setProperty("--g",v().accent),K.hidden=!0,ie.style.backgroundImage="none",H.hidden=!0,Q.hidden=!0,W.textContent="",oe.textContent=t.kind||"waypoint",re.textContent=t.name,se.textContent=t.diff?$e[t.diff]?$e[t.diff].label:t.diff:"unrated",le.textContent="Fast travel. You arrive short of the sign, on the floor, looking at it.",E.textContent="";const a=t.at||{};for(const[i,s]of[["slug",t.slug],["also",t.also||"—"],["road",t.viaSign?"sign · T":"waypoint"],["east",Number.isFinite(a.x)?Math.round(a.x)+" m":"—"],["north",Number.isFinite(a.z)?Math.round(-a.z)+" m":"—"]]){const d=r("div","lk__fact");d.append(r("span","k",i),r("span","v",String(s))),E.append(d)}}function L(){z.forEach((s,d)=>s.classList.toggle("is-sel",d===g));const t=y[g];if(!t)return;if(z[g]&&z[g].scrollIntoView&&z[g].scrollIntoView({block:"nearest"}),v().kind==="settings"){ta(t);return}if(v().kind==="trail"){aa(t);return}Q.hidden=!1;const a=De(t.group);X.style.setProperty("--g",a);const i=fe()===t.id;K.hidden=!t.thumb,t.thumb&&(K.src=t.thumb),ie.style.backgroundImage=t.thumb?`url(${t.thumb})`:"none",H.hidden=!i,oe.textContent=t.brand||"",ye.textContent=t.after||"",ye.hidden=!t.after,re.textContent=t.name,se.textContent=t.spec||t.tag||"",le.textContent=t.blurb||"",He.textContent=t.brand||"",Je.textContent=t.name,Ze.textContent=(t.tag||"")+(i?" · equipped":""),ea(t),E.textContent="";for(const[s,d]of t.facts||[]){const k=r("div","lk__fact");k.append(r("span","k",s),r("span","v",String(d))),E.append(k)}Gt(v(),t)}function J(){ve.forEach((t,a)=>t.b.classList.toggle("is-on",a===O)),Yt(),Vt(),Wt(),Qt(),dt(),Le()}function Z(t,a=1){const i=O;let s=(t%M.length+M.length)%M.length;for(let b=0;b<M.length&&(N(M[s]),!!R.has(M[s].id));b++)s=((s+a)%M.length+M.length)%M.length;O=s,C="all";const d=fe(),k=N(v());g=Math.max(0,k.findIndex(b=>b.id===d)),J(),i!==O&&(B.classList.remove("is-swap"),B.offsetWidth,B.classList.add("is-swap"))}function ee(){const t=v(),a=y[g];if(!a)return;if(t.kind==="trail"){Jt(a);return}if(t.kind==="settings"){Ka(a.key,!be(a.key));const d=z[g];d&&(lt(d,a.key),d.classList.remove("is-go"),d.offsetWidth,d.classList.add("is-go")),L();return}T[t.id]=a.id,t.remember?t.remember(a.id):t.kind==="ski"?da(a.id):t.kind==="glider"?ka(a.id):t.kind==="bike"?ma(a.id):Qa(t.id,a.id),t.apply&&t.apply(a.id,t.kind==="outfit"?S:void 0),t.kind==="outfit"&&(T.outfit=window.__player&&window.__player.outfit||a.id);const i=t.kind==="outfit"?a.brand+" "+(S==="looks"?a.name:a.tag):a.name;u&&u({tab:t.id,gear:a.gear||t.gear||f&&f.mode,kind:t.kind,id:a.id,name:i}),na(),L(),Le(),o&&t.kind==="outfit"&&o.tryOn===T.outfit&&(o.tryOn=null);const s=z[g];s&&(s.classList.remove("is-go"),s.offsetWidth,s.classList.add("is-go")),V.classList.remove("is-go"),V.offsetWidth,V.classList.add("is-go"),o&&(o.kick=2.6)}function na(){z.forEach((t,a)=>{const i=t.querySelector(".lk__eq"),s=fe()===y[a].id;s&&!i?t.append(r("span","lk__eq","equipped")):!s&&i&&i.remove(),t.classList.toggle("is-eq",s)})}function pt(){if(v().kind==="settings"||v().kind==="trail"||!z.length)return 1;const t=z[0].offsetWidth||1,a=10;return Math.max(1,Math.round((B.clientWidth+a)/(t+a)))}let j=0;function Ae(){w||(w=!0,j&&(clearTimeout(j),j=0),A.hidden=!1,A.classList.remove("is-out"),o?ce():jt(),o&&(ge(e,o,window.__player?.outfit),o.tryOn=null),window.__player&&window.__player.outfit&&(T.outfit=window.__player.outfit),Z(O),A.offsetWidth,A.classList.add("is-in"),Se=performance.now(),pe||(pe=requestAnimationFrame(ot)),requestAnimationFrame(ce))}function ke(){w&&(w=!1,o&&(o.hold=null),o&&o.tryOn!=null&&(ge(e,o,window.__player?.outfit),o.tryOn=null),A.classList.remove("is-in"),A.classList.add("is-out"),j&&clearTimeout(j),j=setTimeout(()=>{j=0,w||(A.hidden=!0,A.classList.remove("is-out"))},150))}return addEventListener("resize",()=>{w&&ce()}),window.__locker=Object.assign(window.__locker||{},{turntable(t){return Ae(),o.hold=t==null?null:Number(t),o.t=0,new Promise(a=>requestAnimationFrame(()=>requestAnimationFrame(()=>a(o.turntable.rotation.y))))},tryOn:()=>o?o.tryOn:null,mannequin:()=>o?{body:o.cBody,skin:o.cSkin,clip:o.clip,want:o.want,baked:[...o.clips.keys()],pairs:o.riderPairs.length,mats:o.riderMats.size,toggles:o.riderToggles.length,pos:o.cBody?[o.cBody.position.x,o.cBody.position.y,o.cBody.position.z]:null,visible:!!(o.cBody&&o.cBody.visible),pack:!!(o.cPack&&o.cPack.visible),glider:!!(o.cGlide&&o.cGlide.visible)}:null,sub:()=>S,setSub:Me,thumbMs:()=>Bt}),{root:A,isOpen:()=>w,open:Ae,close:ke,toggle(){return w?ke():Ae(),w},key(t){if(!w)return!1;if(t==="Escape"||t==="KeyI")return ke(),!0;if(t==="KeyQ")return Z(O-1,-1),!0;if(t==="KeyE"||t==="Tab")return Z(O+1,1),!0;if(t==="KeyF"){const i=["all",...rt(N(v()))];return C=i[(i.indexOf(C)+1)%i.length],g=0,J(),!0}if(t==="KeyG")return v().kind==="outfit"&&Me(te[(te.indexOf(S)+1)%te.length]),!0;if(!y.length)return!0;if(t==="ArrowLeft"||t==="KeyA")return g=(g+y.length-1)%y.length,L(),!0;if(t==="ArrowRight"||t==="KeyD")return g=(g+1)%y.length,L(),!0;if(t==="ArrowUp"||t==="KeyW")return g=Math.max(0,g-pt()),L(),!0;if(t==="ArrowDown"||t==="KeyS")return g=Math.min(y.length-1,g+pt()),L(),!0;if(t==="Enter"||t==="Space")return ee(),!0;const a=/^(?:Digit|Numpad)([1-9])$/.exec(t);if(a){const i=Number(a[1])-1;return i<y.length&&(g=i,L(),ee()),!0}return!0},tabs:()=>M.filter(t=>!R.has(t.id)&&t.gear).map(t=>t.id),pages:()=>M.filter(t=>!R.has(t.id)&&!t.gear).map(t=>t.id),tab:()=>v().id,setTab:t=>{const a=M.findIndex(i=>i.id===t);return a>=0&&Z(a),v().id},filter:()=>C,setFilter:t=>(C=t,g=0,J(),C),items:()=>y.map(t=>t.id),selected:()=>y[g]?y[g].id:null,equipped:()=>({...T}),noteEquipped(t,a){T[t]!==void 0&&(T[t]=a,w&&(dt(),Le()))}}}export{Fn as createInventory};
