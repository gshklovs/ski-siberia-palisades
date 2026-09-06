import{SKI_MODELS as Sn,skiThumbURL as Mn,makeSkiRig as At,styleSkiRig as Et,rememberSkiId as Ln,SKI_DEFAULT as An}from"./ski.js";import{GLIDER_MODELS as En,GLIDER_DEFAULT as In,rememberGliderId as Pn}from"./glider.js";import{BIKE_MODELS as On,BIKE_DEFAULT as qn,bikeThumbURL as Cn,rememberBikeId as Nn,makeBikeRig as Rn,styleBikeRig as zn,getBikeModel as Fn,bikeRider as Bn}from"./bike.js";import{SLED_MODELS as Dn,SLED_DEFAULT as Wn,sledThumbURL as jn,rememberSledId as Gn,resolveSledId as Un,makeSledRig as $n,styleSledRig as Kn}from"./sled.js";import{SNOWMOBILE_MODELS as Hn,SNOWMOBILE_DEFAULT as Vn,snowmobileThumbURL as Yn,rememberSnowmobileId as Qn,resolveSnowmobileId as Xn,makeSnowmobileRig as Jn,styleSnowmobileRig as Zn}from"./snowmobile.js";import{BIKE_GEAR as ea,BRAND as It}from"./flags.js";import{OUTFITS as lt,byCode as ta,previewOutfit as Be,toggleOf as na,rememberOutfit as aa,resolveOutfit as ia,PARTS as De,parseLook as dt,serialise as oa,paint as Pt,swatch as ct,cloneRig as ra,rigOf as sa}from"./rider.js";import{R as Ot,C as qt}from"./atlas.js";import Ct from"./outfits/after.js";import{KNOBS as la,get as We,set as da}from"./settings.js";import{hudSurf as U,hudKind as ve,hudMark as je}from"./hud.js";const ca=parseInt(U.cream.slice(1),16);import{waypointIndex as pa,ALIASES as ha}from"./spawn.js";const fa={wing:{base:"#dd6a2a",ink:"#6b4a2a",accent:"#f2c98a"},rocket:{base:"#1b1c22",ink:"#0b0b0e",accent:"#b9bec4"}},d=(e,l,h)=>{const u=document.createElement(e);return l&&(u.className=l),h!=null&&(u.textContent=h),u},Nt="poi-lab.play.locker.",ua=(e,l)=>{try{localStorage.setItem(Nt+e,l)}catch{}},ka=e=>{try{return localStorage.getItem(Nt+e)}catch{return null}},Rt=e=>e<0?0:e>1?1:e;function ga(e){const l=e.replace("#","");return l.length===3?l.split("").map(u=>parseInt(u+u,16)):[parseInt(l.slice(0,2),16),parseInt(l.slice(2,4),16),parseInt(l.slice(4,6),16)]}const Ge=(e,l)=>{const[h,u,b]=ga(e);return`rgba(${h},${u},${b},${l})`};function ma(e){let l=0;for(let h=0;h<e.length;h++)l=l*31+e.charCodeAt(h)>>>0;return l%360}const ba=e=>{const u=i=>(i+e/30)%12,b=.62*Math.min(.62,.38),r=i=>Math.round(255*(.62-b*Math.max(-1,Math.min(u(i)-3,Math.min(9-u(i),1)))));return"#"+[r(0),r(8),r(4)].map(i=>i.toString(16).padStart(2,"0")).join("")},zt={lab:"#8fa3b8",race:"#ff3b5c",freeride:"#2ec4b6",trail:"#54d17a",jump:"#ffb020",fun:"#c77dff",dh:"#ff6b3d",xc:"#5ad1e6"},pt=e=>zt[e]||(zt[e]=ba(ma(String(e||"x")))),Ft={ski:'<path d="M5.4 20.6 8.9 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M12.6 20.6 16.1 5.1c.3-1.4 1.5-2.1 2.6-1.7"/><path d="M4.2 20.9h5.1"/><path d="M11.4 20.9h5.1"/>',bike:'<circle cx="5.9" cy="16.4" r="4.1"/><circle cx="18.1" cy="16.4" r="4.1"/><path d="M5.9 16.4 10.2 8.2h6.1l1.8 8.2"/><path d="M9.4 8.2h4.4"/><path d="M16.3 8.2 17.5 5.4h2.2"/>',glider:'<path d="M12 3.4 2.6 13.9c3.4-1.4 6.4-.7 9.4 6.7 3-7.4 6-8.1 9.4-6.7z"/><path d="M12 3.4v17.2"/>',boots:'<path d="M8.2 3.4h4.3v8.4c0 1.3.8 2.4 2 2.9l4.1 1.8v4.1H6.4V3.4z"/><path d="M6.6 17.1h12"/>',crate:'<path d="M12 2.7 20.2 7v10L12 21.3 3.8 17V7z"/><path d="M3.8 7 12 11.4 20.2 7"/><path d="M12 11.4v9.9"/>',trail:'<path d="M2.6 19.4 8.4 9.1l3.3 5.1 2.6-3.9 5.1 9.1z"/><path d="M15.4 3.1h5.6v3.6h-5.6z"/><path d="M15.4 3.1V10"/>',sled:'<path d="M3.2 13.9h12.9c2.1 0 3.5-1.3 3.5-3 0-1.3-1-2.3-2.2-2.3s-2.2 1-2.2 2.3"/><path d="M4.4 18.2h12.2"/><path d="M5.8 13.9v4.3"/><path d="M13.9 13.9v4.3"/>',snowmobile:'<rect x="2.5" y="14.2" width="10.2" height="4.3" rx="2.1"/><path d="M12.7 16.3h3.5l2.4-2.3"/><path d="M8.4 14.2 10.1 9.6h3.8l1.3 2.7"/><path d="M14 9.6 16.1 7.2"/><path d="M17.2 18.5h3.3"/><path d="M18.9 13.4v5.1"/>',outfit:'<path d="M9 3.2h6l4.1 2.3-1.6 4.4-1.9-.8v11.7H7.4V9.1l-1.9.8L3.9 5.5z"/><path d="M9 3.2 12 6.4 15 3.2"/>',gear:'<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.9"/><path d="M18.6 12h2.2"/><path d="M5.4 12H3.2"/><path d="M12 5.4V3.2"/><path d="M12 18.6v2.2"/><path d="M16.67 7.33 18.22 5.78"/><path d="M7.33 16.67 5.78 18.22"/><path d="M16.67 16.67 18.22 18.22"/><path d="M7.33 7.33 5.78 5.78"/>'};function _a(e){return'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(Ft[e]||Ft.crate)+"</svg>"}const wa=[{key:"speed",label:"speed",unit:!0,src:"term",suffix:" m/s"},{key:"turn",label:"handling",unit:!0,src:"steer",suffix:" rad/s"},{key:"stab",label:"stability",unit:!0},{key:"pop",label:"pop",unit:!0},{key:"spinTorque",label:"spin",unit:!1,suffix:" rad/s"}],ht=e=>typeof e=="number"&&isFinite(e);function va(e){const l=[];for(const h of wa){const u=e.map(b=>b.stats?b.stats[h.key]:void 0);!u.length||!u.every(ht)||l.push({...h,min:Math.min(...u),max:Math.max(...u),n:e.length})}return l}function Bt(e,l){const h=e.max-e.min;return e.unit&&e.n<4?Rt(l):h>1e-6?.08+.92*((l-e.min)/h):e.unit?Rt(l):.5}const J=new Map;function Dt(e,l,h){if(J.has(e))return J.get(e);const u=300,b=58,r=document.createElement("canvas");r.width=u,r.height=b;const i=r.getContext("2d");if(i.fillStyle=l.base,i.fillRect(0,0,u,b),i.strokeStyle=l.accent,i.lineWidth=3,i.lineCap="round",i.lineJoin="round",i.fillStyle=l.accent,h==="bike")i.beginPath(),i.arc(96,34,17,0,7),i.stroke(),i.beginPath(),i.arc(204,34,17,0,7),i.stroke(),i.beginPath(),i.moveTo(96,34),i.lineTo(140,18),i.lineTo(186,18),i.lineTo(204,34),i.lineTo(150,34),i.closePath(),i.stroke(),i.beginPath(),i.moveTo(186,18),i.lineTo(196,8),i.lineTo(212,8),i.stroke();else if(h==="rocket"){i.fillStyle=l.ink,i.fillRect(132,12,36,30);for(const m of[110,190])i.fillStyle=l.accent,i.fillRect(m-17,9,34,33),i.beginPath(),i.ellipse(m,9,17,7,0,0,7),i.fill(),i.fillStyle=l.ink,i.fillRect(m-17,22,34,7),i.beginPath(),i.moveTo(m-11,42),i.lineTo(m+11,42),i.lineTo(m+17,51),i.lineTo(m-17,51),i.closePath(),i.fill(),i.fillStyle="#ffb347",i.beginPath(),i.moveTo(m-13,52),i.lineTo(m+13,52),i.lineTo(m,58),i.closePath(),i.fill()}else if(h==="wing")i.beginPath(),i.moveTo(150,8),i.quadraticCurveTo(74,20,34,46),i.quadraticCurveTo(96,40,150,50),i.quadraticCurveTo(204,40,266,46),i.quadraticCurveTo(226,20,150,8),i.closePath(),i.fill(),i.strokeStyle=l.ink,i.lineWidth=2,i.beginPath(),i.moveTo(150,4),i.lineTo(150,54),i.stroke();else{i.beginPath(),i.moveTo(112,8),i.lineTo(160,8),i.lineTo(166,34),i.lineTo(198,42),i.lineTo(198,52),i.lineTo(108,52),i.closePath(),i.fill(),i.fillStyle=l.ink;for(let m=0;m<3;m++)i.fillRect(118,14+m*10,40,4)}const x=r.toDataURL("image/png");return J.set(e,x),x}const xa=[["chinBar","chin bar"],["visor","visor"],["hood","hood"],["guards","guards"],["spine","spine plates"],["belt","belt"]],Wt={race:"Cut for the gates: one skin, no slack, nothing on it the clock has to carry.",shell:"A jacket and pants built for the weather first and the lift queue second.",freeride:"Bib pants under a short jacket, cut wide enough to sit down in the trees.",retro:"The loudest page of an old catalogue, reprinted without one apology for it.",armour:"Plated where a fall lands — spine, chin and hands — worn over the suit."},ft=e=>"#"+(e&16777215).toString(16).padStart(6,"0"),Ue=e=>(.2126*(e>>16&255)+.7152*(e>>8&255)+.0722*(e&255))/255,ya='900 %px "Helvetica Neue", Helvetica, Arial, sans-serif',jt=new Map;function Ta(e){const l=jt.get(e.code);if(l)return l;const h=300,u=58,b=e.palette,r=document.createElement("canvas");r.width=h,r.height=u;const i=r.getContext("2d"),x=b.jacket,m=[[0,150,x],[150,230,b.pants],[230,275,b.helmet],[275,300,b.accent!=null?b.accent:b.strap!=null?b.strap:b.glove]];for(const[y,c,k]of m)i.fillStyle=ft(k??x),i.fillRect(y,0,c-y,u);Gt(i,e,x,u);const v=r.toDataURL("image/png");return jt.set(e.code,v),v}function Gt(e,l,h,u,b=126){const r=$e(l).toUpperCase(),i=1.4;for(let m=22;m>9&&(e.font=ya.replace("%",m),!(e.measureText(r).width+i*(r.length-1)<=b));m--);e.fillStyle=Math.abs(Ue(h)-Ue(ca))>=Math.abs(Ue(h)-Ue(1513498))?U.cream:"#17181a",e.textBaseline="middle";let x=12;for(const m of r)e.fillText(m,x,u/2),x+=e.measureText(m).width+i}const Sa=e=>xa.filter(([l])=>e[l]).map(([,l])=>l),$e=e=>e.house==="POI-LAB"?It:e.house;function Ma(e){const l=e.flags,h=Sa(l),u=$e(e);return{id:e.code,name:e.name,brand:u,tag:e.family,group:e.family,after:Ct[e.code]||"",thumb:Ta(e),spec:[`${l.torso} torso · ${l.helmet} helmet`,...h].join(" · "),facts:[["house",u],["family",e.family],["torso",l.torso],["helmet",l.helmet],["extras",h.join(", ")||"—"]],blurb:`${u} ${e.name}. ${Wt[e.family]||""}`.trim()}}const xe=["looks",...De],La={helmet:e=>[e.helmet,e.chinBar&&"chin bar",e.visor&&"visor",e.head==="robot"&&"robot head",e.mask&&"mask",e.collar==="stand"&&"stand collar"],goggles:e=>[e.goggles===!1||e.goggles==="none"?"no goggles":e.goggles==="rimless"&&"rimless"],jacket:e=>[e.torso+" torso",e.hood&&"hood",e.spine&&"spine plates",e.hem&&e.hem+" hem",e.puffy&&"puffy",e.anorak&&"anorak",e.chestPlate&&"chest plate",e.pauldrons&&"pauldrons",e.kitFerrum&&"Ferrum kit",e.kitUmbra&&"Umbra kit",e.kitPhantom&&"Phantom kit",e.kitDuke&&"Duke kit"],pants:e=>[e.pants&&e.pants+" fit",e.belt&&"belt",e.hipPlate&&"hip plate",e.bloused&&"bloused",e.beltBoxes&&"belt boxes"],gloves:e=>[e.guards&&"arm guards",e.poleGuards&&"pole guards"],boots:e=>[e.boot&&e.boot+" boot",e.shinGuards&&"shin guards"],poles:()=>[]},Aa={helmet:"helmet",goggles:"lens",jacket:"jacket",pants:"pants",gloves:"glove",boots:"boot",poles:"pole"},Ea={helmet:[["helmet",0,0,300,58]],goggles:[["lens",0,0,300,29],["strap",0,29,300,29]],jacket:[["chestFront",0,0,110,58],["back",110,0,110,58],["sleeveL",220,0,80,58]],pants:[["legL",0,0,200,58],["belt",200,0,100,58]],gloves:[["glove",0,0,200,58],["poleGuards",200,0,100,58]]},Ia={boots:["boot"],poles:["pole","poleBand"]},Ut=22,$t=e=>Ot[e]?Ot[e].slice(0,4):[qt[e][0],qt[e][1],Ut,Ut];let Kt=!1,Ht=0;function Pa(){const e=performance.now();for(const l of lt){const{canvas:h}=Pt(l.code,null,{cache:!1});for(const u of De){const b=document.createElement("canvas");b.width=300,b.height=58;const r=b.getContext("2d"),i=Ia[u];if(i){const x=300/i.length;i.forEach((m,v)=>{r.fillStyle=ft(ct(l.palette,m)),r.fillRect(v*x,0,x,58)}),Gt(r,l,ct(l.palette,i[0]),58)}else for(const[x,m,v,y,c]of Ea[u]){const[k,w,g,S]=$t(x);r.drawImage(h,k,w,g,S,m,v,y,c)}J.set(u+":"+l.code,b.toDataURL("image/png"))}}Kt=!0,Ht=Math.round(performance.now()-e)}function Oa(e,l){return Kt||Pa(),J.get(l+":"+e.code)}function qa(e,l){const h=$e(e);return{id:e.code,name:e.name,brand:h,group:e.family,tag:l,after:Ct[e.code]||"",thumb:Oa(e,l),spec:La[l](e.flags).filter(Boolean).join(" · ")||"—",facts:[["house",h],["family",e.family],["part",l],["colour",ft(ct(e.palette,Aa[l]))]],blurb:`${h} ${e.name} — ${l}. ${Wt[e.family]||""}`.trim()}}const Vt="x";function Ca(){const e="goggles:"+Vt;if(!J.has(e)){const{canvas:l}=Pt("g00",null,{cache:!1}),h=document.createElement("canvas");h.width=300,h.height=58;const[u,b,r,i]=$t("face");h.getContext("2d").drawImage(l,u,b,r,i,0,0,300,58),J.set(e,h.toDataURL("image/png"))}return J.get(e)}const Na=()=>({id:Vt,name:"No goggles",brand:"—",tag:"goggles",thumb:Ca(),spec:"bare face",facts:[["house","—"],["part","goggles"],["colour","—"]],blurb:"No goggles. The band comes off and the face is the face."}),q=[{id:"skis",label:"skis",gear:"skis",kind:"ski",icon:"ski",accent:"#4cc9f0",items:()=>Sn.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:Mn(e),spec:`${e.len} cm · ${e.waist} mm waist · R${e.radius}`,facts:[["length",e.len+" cm"],["waist",e.waist+" mm"],["radius","R"+e.radius],["top speed",e.stats.term.toFixed(1)+" m/s"],["turn rate",e.stats.steer.toFixed(2)+" rad/s"],["chatter",e.stats.chatterSpeed===1/0?"never":e.stats.chatterSpeed+" m/s"],["spin",e.stats.spinTorque.toFixed(1)+" rad/s"],["pop","×"+e.stats.popMul.toFixed(2)]]}))},...ea?[{id:"bike",label:"bikes",gear:"bike",kind:"bike",icon:"bike",accent:"#ff7a29",items:()=>On.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:Cn(e),spec:`${e.spec.travel} travel · ${e.spec.head.toFixed(1)}° head · ${e.spec.mass} · ${e.spec.wheel}`,facts:[["travel",e.spec.travel],["head angle",e.spec.head.toFixed(1)+"°"],["wheelbase",e.spec.wb+" mm"],["weight",e.spec.mass],["wheels",e.spec.wheel],["top speed",e.stats.term.toFixed(1)+" m/s"],["pedal cap",e.stats.pedalMax.toFixed(1)+" m/s"],["spin",e.stats.spinTorque.toFixed(1)+" rad/s"],["pop",e.stats.popFull.toFixed(1)+" m/s"]]}))}]:[],{id:"glider",label:"glider",gear:"glider",kind:"glider",icon:"glider",accent:"#a78bfa",items:()=>En.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.tag,group:e.group,blurb:e.blurb,stats:e.stats,facts:e.facts,gear:e.gear,preview:e.preview,spec:e.facts&&e.facts.length?e.facts.slice(0,3).map(([l,h])=>`${l} ${h}`).join(" · "):"",thumb:Dt("glider-"+e.id,fa[e.glyph],e.glyph)}))},{id:"sled",label:"sled",gear:"sled",kind:"sled",icon:"sled",accent:"#c98a3f",remember:Gn,apply:e=>window.__player?.setSledModel?.(e),items:()=>Dn.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:jn(e),spec:`${e.spec.length} · ${e.spec.deck} · ${e.spec.mass}`,facts:[["length",e.spec.length],["width",e.spec.width],["deck",e.spec.deck],["runners",e.spec.runners],["weight",e.spec.mass],["top speed",e.stats.term.toFixed(1)+" m/s"],["turn rate",e.stats.steer.toFixed(2)+" rad/s"],["wipe tolerance",(e.stats.wipeTol*180/Math.PI).toFixed(0)+"°"],["stalls below",e.stats.stallSpeed.toFixed(1)+" m/s"]]}))},{id:"snowmobile",label:"snowmobile",gear:"snowmobile",kind:"snowmobile",icon:"snowmobile",accent:"#ff6a1f",remember:Qn,apply:e=>window.__player?.setSnowmobileModel?.(e),items:()=>Hn.map(e=>({id:e.id,name:e.name,brand:e.brand,tag:e.disc,group:e.group,blurb:e.blurb,stats:e.stats,thumb:Yn(e),spec:`${e.spec.engine} · ${e.spec.mass}`,facts:[["engine",e.spec.engine],["track",e.spec.track],["weight",e.spec.mass],["suspension",e.spec.suspension],["top speed",e.stats.term.toFixed(1)+" m/s"],["climbs to",e.stats.climbDeg.toFixed(1)+"°"],["reverse",e.stats.reverseMax.toFixed(1)+" m/s"],["brake",e.stats.brake.toFixed(0)+" m/s²"]]}))},{id:"boots",label:"boots",gear:"boots",kind:"boots",icon:"boots",accent:"#e0b166",items:()=>[{id:"boots",name:"Boots",brand:It,tag:"on foot",group:"lab",blurb:"The Quake-ish walk controller, untouched since the first commit. Walk, sprint, jump, step over anything under 55 cm. Nothing you equip can change how this feels.",stats:{turn:1,speed:.1,stab:1,pop:.2},thumb:Dt("boots",{base:"#26231f",ink:"#12110f",accent:"#cdc7ba"},"boot"),spec:"walk 4.5 m/s · sprint 8.0 m/s · step 0.55 m",facts:[["walk","4.5 m/s"],["sprint","8.0 m/s"],["jump","4.5 m/s"],["step up","0.55 m"]]}]},{id:"outfit",label:"outfit",kind:"outfit",icon:"outfit",accent:"#ff5c8a",remember:aa,apply:(e,l)=>window.__player?.setOutfit?.(l&&l!=="looks"?{[l]:e}:e),items:e=>!e||e==="looks"?lt.map(Ma):[...e==="goggles"?[Na()]:[],...lt.map(l=>qa(l,e))]},{id:"trails",label:"trails",kind:"trail",icon:"trail",accent:"#4cc9f0",items:()=>za(He,tn)},{id:"settings",label:"settings",kind:"settings",icon:"gear",accent:"#4fd6a9",items:()=>la.map(e=>({id:e.key,key:e.key,name:e.label,desc:e.desc,def:!!e.def}))}],Yt={double:4,black:3,blue:2,green:1},ut={green:{cls:"is-circ",label:"green circle"},blue:{cls:"is-sq",label:"blue square"},black:{cls:"is-dia",label:"black diamond"},double:{cls:"is-dia2",label:"double diamond"}},Ra={"ski-run":"run","bike-trail":"trail",lift:"lift",venue:"venue",landmark:"landmark",notice:"notice"};function za(e,l){if(!e)return[];let h=null;try{h=pa(e,l==="z"?"z":"y")}catch{return[]}if(!h||!h.size)return[];const u=new Map;for(const c of Array.isArray(e.markers)?e.markers:[])c&&c.id&&u.set(c.id,{diff:c.diff||null,kind:Ra[c.kind]||c.kind||null});const b=new Map,r=new Set;for(const c of Array.isArray(e.runs)?e.runs:[]){if(!c||!c.id||!Array.isArray(c.pts)||!c.pts.length)continue;r.add(c.id);const k=String(c.name||c.id),w=k.toUpperCase(),g=c.pts[0],S={id:c.id,n:c.pts.length,at:{x:+g[0],y:+g[1],z:+g[2]}};let O=b.get(w);O||(O={name:k,kind:"run",section:"runs",diff:c.diff||(u.get(c.id)||{}).diff||null,segments:[],slugs:[]},b.set(w,O)),O.segments.push(S),O.diff||(O.diff=c.diff||null)}const i=[];for(const c of b.values()){c.segments.sort((w,g)=>g.at.y-w.at.y);const k=c.segments[0];i.push({id:k.id,slug:k.id,name:c.name,at:k.at,diff:c.diff,kind:"run",viaSign:!1,section:"runs",segments:c.segments.map(w=>w.id),canEquip:c.segments.reduce((w,g)=>w+g.n,0)>=4,slugs:[]})}const x=new Map;for(const[c,k]of h){if(!k||!k.id||r.has(k.id)||x.has(k.id))continue;const w=u.get(k.id)||{};x.set(k.id,{id:k.id,slug:c,name:k.name||k.id,at:k.at,diff:w.diff||null,kind:w.kind||k.kind||null,viaSign:k.kind==="marker",section:"places",segments:[],canEquip:!1,slugs:[]})}const m=new Map;for(const c of i)for(const k of c.segments)m.set(k,c);for(const c of x.values())m.set(c.id,c);for(const[c,k]of Object.entries(ha)){const w=m.get(k);w&&c!==w.slug&&!w.slugs.includes(c)&&w.slugs.push(c)}const v=(c,k)=>(Yt[k.diff]||0)-(Yt[c.diff]||0)||String(c.name).localeCompare(String(k.name));i.sort(v);const y=[...x.values()].sort(v);return[...i,...y].map(c=>({id:c.id,slug:c.slug,name:c.name,at:c.at,diff:c.diff,kind:c.kind,viaSign:c.viaSign,canEquip:c.canEquip,section:c.section,segments:c.segments.slice(),also:c.slugs.slice(0,2).join(" · ")}))}const Qt={green:je.green,blue:je.blue,black:je.black,double:je.black};function Fa(e,l){const h=[];for(const r of Array.isArray(e&&e.runs)?e.runs:[])!r||!Array.isArray(r.pts)||r.pts.length<2||h.push({id:r.id,name:r.name||r.id,diff:r.diff||null,pts:r.pts});const u=[];for(const r of Array.isArray(e&&e.lifts)?e.lifts:[])!r||!Array.isArray(r.base)||!Array.isArray(r.top)||u.push({id:r.id,name:r.name||r.id,base:r.base,top:r.top});const b=[];for(const r of l||[])!r||!r.at||!Number.isFinite(r.at.x)||r.kind!=="venue"&&r.kind!=="landmark"||b.push({id:r.id,name:r.name,kind:r.kind,at:r.at});return{runs:h,lifts:u,dots:b}}function Ke(e,l,h,u){if(!(l.length<2)){e.beginPath(),e.moveTo(l[0][0],l[0][1]);for(let b=1;b<l.length;b++)e.lineTo(l[b][0],l[b][1]);e.lineWidth=h,e.strokeStyle=u,e.stroke()}}function Xt(e,l,h){e.strokeStyle=ve.lift,e.lineWidth=1.2,e.beginPath(),e.moveTo(l,h-4.5),e.lineTo(l,h-1.6),e.stroke(),e.fillStyle=ve.lift,e.fillRect(l-2.5,h-1.6,5,3.2)}function Jt(e,l,h,u={}){const b=typeof performance<"u"?performance.now():Date.now(),r=e.getContext&&e.getContext("2d");if(!r)return null;let i=1;try{i=Math.min(2,window.devicePixelRatio||1)}catch{i=1}const x=Math.max(60,Math.round(e.clientWidth||300)),m=Math.max(60,Math.round(e.clientHeight||240));(e.width!==Math.round(x*i)||e.height!==Math.round(m*i))&&(e.width=Math.round(x*i),e.height=Math.round(m*i)),r.setTransform(i,0,0,i,0,0),r.fillStyle=U.cream,r.fillRect(0,0,x,m),r.lineJoin="round",r.lineCap="round";const v=Fa(l,h);let y=1/0,c=-1/0,k=1/0,w=-1/0;const g=(f,L)=>{!Number.isFinite(f)||!Number.isFinite(L)||(f<y&&(y=f),f>c&&(c=f),L<k&&(k=L),L>w&&(w=L))};for(const f of v.runs)for(const L of f.pts)g(L[0],L[2]);for(const f of v.lifts)g(f.base[0],f.base[2]),g(f.top[0],f.top[2]);for(const f of v.dots)g(f.at.x,f.at.z);const S={ms:0,runs:0,lifts:0,markers:0,you:!1,hits:[],w:x,h:m};if(!(c>y)||!(w>k))return S;const O=(c-y)*.05,C=(w-k)*.05;y-=O,c+=O,k-=C,w+=C;const N=9,Z=Math.min((x-N*2)/(c-y),(m-N*2)/(w-k)),Te=(x-(c-y)*Z)/2,Se=(m-(w-k)*Z)/2,Q=f=>Te+(f-y)*Z,$=f=>Se+(f-k)*Z,pe=[],he=u.highlight instanceof Set?u.highlight:new Set(u.highlight?[u.highlight]:[]),X=[];for(const f of v.runs){const L=f.pts.map(P=>[Q(P[0]),$(P[2])]);if(pe.push({id:f.id,name:f.name,scr:L}),he.has(f.id)){X.push({r:f,scr:L});continue}Ke(r,L,f.diff==="double"?1.9:1.3,Qt[f.diff]||U.sub)}for(const f of v.lifts){const L=[Q(f.base[0]),$(f.base[2])],P=[Q(f.top[0]),$(f.top[2])];Ke(r,[L,P],1.5,ve.lift),Xt(r,L[0],L[1]),Xt(r,P[0],P[1])}for(const f of v.dots){const L=Q(f.at.x),P=$(f.at.z);r.beginPath(),r.arc(L,P,2.7,0,Math.PI*2),r.fillStyle=f.kind==="venue"?ve.venue:ve.landmark,r.fill(),r.lineWidth=.7,r.strokeStyle=U.ink,r.stroke()}for(const f of X)Ke(r,f.scr,6,U.cream);for(const f of X)Ke(r,f.scr,3.4,Qt[f.r.diff]||U.ink);if(X.length){const f=X.reduce((P,B)=>B.scr.length>P.scr.length?B:P),L=f.scr[Math.floor(f.scr.length/2)];if(L){r.font="700 9px ui-monospace, Menlo, Consolas, monospace",r.textBaseline="middle";const P=String(f.r.name).toUpperCase(),B=r.measureText(P).width,j=Math.min(Math.max(6,L[0]+7),x-B-10),G=Math.min(Math.max(9,L[1]-8),m-8);r.fillStyle=U.cream,r.fillRect(j-3,G-7,B+6,14),r.fillStyle=U.ink,r.fillText(P,j,G)}}let fe=!1;try{const f=window.__player&&window.__player.position&&window.__player.position(),L=window.__player&&window.__player.yaw?window.__player.yaw():0;if(f&&Number.isFinite(f.x)){const P=Q(f.x),B=$(f.z),j=-Math.sin(L),G=-Math.cos(L);r.beginPath(),r.moveTo(P+j*6.5,B+G*6.5),r.lineTo(P-j*3.5-G*3.6,B-G*3.5+j*3.6),r.lineTo(P-j*3.5+G*3.6,B-G*3.5-j*3.6),r.closePath(),r.fillStyle=U.ink,r.fill(),r.lineWidth=1.6,r.strokeStyle=U.cream,r.stroke(),fe=!0}}catch{}return{ms:+((typeof performance<"u"?performance.now():Date.now())-b).toFixed(2),runs:v.runs.length,lifts:v.lifts.length,markers:v.dots.length,you:fe,hits:pe,w:x,h:m,box:{x0:+y.toFixed(1),x1:+c.toFixed(1),z0:+k.toFixed(1),z1:+w.toFixed(1)}}}function Zt(e,l,h,u=8){let b=null,r=u*u;for(const i of e)for(let x=1;x<i.scr.length;x++){const m=i.scr[x-1],v=i.scr[x],y=v[0]-m[0],c=v[1]-m[1],k=y*y+c*c,w=k>0?Math.max(0,Math.min(1,((l-m[0])*y+(h-m[1])*c)/k)):0,g=m[0]+y*w,S=m[1]+c*w,O=(l-g)**2+(h-S)**2;O<r&&(r=O,b=i.id)}return b}const Ba=`
/* ================ specs/0055 §5.2 (Greg 2026-09-06: locker themed) ==========
   THE WHOLE LOCKER IS THE MAP BOARD NOW. Greg, 2026-09-06: "You can theme the
   whole inventory to the theme of the trails, just make sure that we can 1 see
   the player preview and 2 see the item previews that are being equipped." That
   supersedes the earlier "inventory stays as it is" pick and §10.8's
   byte-identical clause, and the register it names is the one W4 already built
   for the TRAIL QUICK-TRAVEL tab below: cream board, ink type, hairline rows,
   ink selection. Every tab now wears it — skis, bikes, glider, sled,
   snowmobile, boots, outfit, settings, trails.

   THE TWO THINGS THAT MAY NOT MOVE, and how they are kept:
     1. THE PLAYER PREVIEW. The mannequin stage is an INK BOARD under a 2 px
        mounting rule — §1.6's second surface, not a third slab — and it grew
        from 300 px to 320 px wide when the deck column did.
     2. THE ITEM PREVIEWS. Every thumb canvas and swatch this screen ever drew
        is still drawn, at the same size, on the same near-black ground it had:
        \`.lk__art\` and \`.lk__hero\` are ink boards, so the art reads exactly as
        it did. Only the FRAME around them changed — ink board, mounting rule,
        kind accent — and the cards' dark plates became cream ones.

   D19 — NO NEW SLAB. Cream \`--p-cream\` and ink \`--p-ink\` are §1.6's two
   surfaces and this file adds none. Every name below is a local alias for a
   token W1 published on \`:root\` (hud.js), read and never redeclared. The
   literals left are the ink written out with an alpha — the scrim at 55 % and
   the row wash at 7 %, both §1.6's ink and neither a new surface — and the
   muted grey W4's trail rows already carried, so no colour is new to this file
   either (specs/0055 D19, the fix round's item 3). */
.lk {
  --lk-acc: #4cc9f0;                    /* the tab's own colour — JS sets it */
  --lk-scrim: rgba(23, 22, 20, .55);    /* ink at 55 %, the lookbook A cell */
  --lk-board: var(--p-cream);
  --lk-plate: var(--p-ink);             /* the ink board every preview sits on */
  --lk-sig: var(--p-k-lift);            /* §1.7 — the one accent, and it means EQUIPPED */
  /* specs/0055 D19 / §11.3 — the hover is THE INK, NOT A THIRD SLAB. It read
     \`#e6e2d8\` — a colour that is in neither §1.6 surface and that no \`:root\`
     name publishes, so the gate counted it as a slab added without a sign-off.
     It is the ink at 7 % over the cream board, so that is what it now says:
     the same literal \`--lk-scrim\` above already reads, at a wash alpha instead
     of a scrim's. Over \`--p-cream\` it renders within four levels of the old
     value on one channel, and it can never drift away from the two surfaces. */
  --lk-wash: rgba(23, 22, 20, .07);     /* the trail rows' own hover — ink at 7 % */
  --lk-line: var(--p-seam);
  --lk-line-2: var(--p-sub);
  --lk-ink: var(--p-ink);
  --lk-ink-2: var(--p-sub);
  --lk-ink-3: #8f887a;
  --lk-good: var(--p-diff-green);
  --lk-bad: var(--p-diff-red);
  --lk-mono: var(--p-mono);
  --lk-sans: var(--p-fam);
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; padding: 16px;
  background: var(--lk-scrim);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: var(--lk-sans);
  color: var(--lk-ink);
  pointer-events: auto;
  opacity: 0;
  /* §6 — the locker RISEs and FALLs, and it invents neither duration */
  transition: opacity var(--p-fall) linear;
}
.lk[hidden] { display: none; }
.lk.is-in { opacity: 1; transition: opacity var(--p-rise) var(--p-rise-ease); }
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
  /* the map board: ONE colour, 2 px radius, and the shadow that lifts it off
     the slope. No chrome gradient, no inset highlight — a printed board has
     neither and the lookbook's \`.map\` is exactly this rule. */
  background: var(--lk-board);
  border-radius: var(--p-r);
  box-shadow: 0 12px 40px rgba(0,0,0,.42);
  overflow: hidden;
  transform: translateY(10px);
  opacity: 0;
  transition: transform var(--p-fall) linear, opacity var(--p-fall) linear;
}
.lk.is-in .lk__panel {
  transform: none; opacity: 1;
  transition: transform var(--p-rise) var(--p-rise-ease), opacity var(--p-rise) var(--p-rise-ease);
}
/* the accent hairline is gone: the header's own 2 px mounting rule is the
   board's top edge now, and one rule is the register's answer to two */
.lk__panel::before { content: none; }

/* ----------------------------------------------------------------- header
   The lookbook's \`.map__hd\`, measured at 1:1: the name in the board face at
   14 px oblique, the 2 px ink mounting rule under it, and the mono strip on the
   right — which is where the loadout already sat. */
.lk__hd {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px;
  border-bottom: var(--p-rule) solid var(--p-ink);
}
.lk__title {
  font-family: var(--lk-sans); font-size: 14px; font-weight: var(--p-weight);
  font-style: var(--p-oblique);
  letter-spacing: .1em; text-transform: uppercase; color: var(--lk-ink);
}
.lk__title b { font-weight: var(--p-weight); }
.lk__spacer { flex: 1 1 auto; }
.lk__load { display: flex; align-items: center; gap: 14px; }
.lk__load-i { display: flex; align-items: baseline; gap: 6px; }
.lk__load-k {
  font-family: var(--lk-mono); font-size: 9px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__load-v {
  font-family: var(--lk-mono); font-size: 9.5px; letter-spacing: .04em; color: var(--lk-ink-2);
  max-width: 19ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ------------------------------------------------------------------- tabs */
/* The lookbook's \`.tabbar\`: no gaps, no rounded caps, a 2 px ink rule under the
   strip, and the ACTIVE TAB IS AN INK PLATE rather than a coloured underline —
   the same object as a selected trail row, one register up. */
.lk__tabs {
  display: flex; align-items: stretch; gap: 0;
  padding: 0 14px; border-bottom: var(--p-rule) solid var(--p-ink);
}
/* NOTHING that says "this is the active tab" is transitioned. A CSS transition
   is driven by the document's animation clock, and on a frame-starved deck —
   a heavy world behind the panel, a software rasteriser — that clock can stall
   long enough for the strip to keep advertising the tab you just left. Colour
   changes here snap; only the decorative hover lift below animates. */
/* specs/0055 §8 P5 — 44 px, AND THE PREVIEW DOES NOT PAY FOR IT. The strip was
   33 px (a 15 px glyph in 9 px of padding), the one shipped control on this
   screen under the touch floor. \`min-height\` rather than more padding, because
   padding would also push the label away from the glyph on a rack tab whose
   count sits tight against it; \`.lk *\` is border-box, so 44 is 44. The 11 px
   the strip takes are given back by \`.lk__main\` below — its vertical padding
   drops 12 -> 6 — so \`.lk__stage\` and the mannequin canvas inside it come out
   a pixel LARGER than the 305 x 407 §10.8(b) records, not smaller. */
.lk__tab {
  position: relative;
  display: flex; align-items: center; gap: 7px;
  min-height: 44px;
  padding: 9px 11px; cursor: pointer;
  border-radius: 0;
  color: var(--lk-ink-2);
}
.lk__tab svg { width: 15px; height: 15px; flex: none; }
.lk__tab-l {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
}
.lk__tab-n {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 0; border-radius: 0; background: none;
  color: inherit; opacity: .6;
}
.lk__tab::after { content: none; }
.lk__tab:hover { color: var(--lk-ink); background: var(--lk-wash); }
.lk__tab.is-on { color: var(--p-cream); background: var(--p-ink); }
.lk__tab.is-on .lk__tab-n { background: none; color: inherit; opacity: .6; }
.lk__tab.is-on svg { color: inherit; }

/* ------------------------------------------------------------------- body */
.lk__main {
  display: grid; gap: 14px; min-height: 0;
  /* the two side decks grow with the panel instead of pinning at 320/340, so a
     2560-wide deck spends its extra width on the preview and the spec sheet
     rather than on ever-wider cards */
  /* the preview column's floor rises 300 -> 320 px with the theme: constraint 1
     says the player preview may not shrink, and on a 1280 deck this is the one
     column that can grow without costing the card grid a column */
  grid-template-columns: minmax(320px, 23%) minmax(0, 1fr) minmax(330px, 23%);
  grid-template-areas: "pv grid det";
  /* specs/0055 §8 P5 — 6 px, not 12: the vertical half of this padding is what
     pays for the tab strip's 44 px above, and it is the cheapest 12 px on the
     screen. Under a 2 px ink mounting rule the body wants a hairline of air,
     not a margin; the horizontal 14 is untouched. */
  padding: 6px 14px;
  gap: 0;
}

/* ---- left: THE PLAYER PREVIEW (constraint 1).
   The mannequin keeps its stage, its size and its renderer; the stage is now
   §1.6's OTHER surface — an ink board under a 2 px mounting rule in the tab's
   own colour — because a cream ground would put a cream helmet on cream. This
   is the same two-surface board the trail tab already stands on, read the other
   way up, and it is not a third slab. */
.lk__pv {
  grid-area: pv; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px;
  min-height: 0; padding-right: 14px;
  border-right: var(--p-hairline) solid var(--lk-line);
}
.lk__stage {
  position: relative; min-height: 0; border-radius: var(--p-r); overflow: hidden;
  border: 0; border-bottom: var(--p-rule) solid var(--lk-acc);
  background: var(--lk-plate);
}
/* the floor: one soft ellipse the figure stands on, drawn in CSS so the
   preview scene stays two lights and a turntable. On ink it is a LIGHT
   ellipse — §1.10's hairline-on-ink token, spread — where it used to be a
   dark one on a dark ground. */
.lk__stage::after {
  content: ""; position: absolute; left: 50%; bottom: 12%; width: 62%; height: 9%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--p-hair), transparent 78%);
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
/* the caption under the mannequin: the board's own type, no card around it —
   one hairline holds it to the stage the way a blade is held to its post */
.lk__plate {
  display: grid; gap: 2px; padding: 8px 2px 0;
  border: 0; border-radius: 0; background: none;
  /* specs/0012 §C — no left stripe. The brand line above the name is already
     accent-coloured; the plate did not need a second one turned on its side. */
}
.lk__plate-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--lk-ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__plate-name {
  font-family: var(--lk-sans); font-size: 15px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .06em; line-height: 1.18; color: var(--lk-ink);
}
.lk__plate-tag {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
}

/* ---- middle: filters + the card grid */
.lk__mid {
  grid-area: grid; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px;
  min-height: 0; padding: 0 14px;
}
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
/* The lookbook A cell's filter line: WORDS with an ink underline, not pills.
   The pill was the dark screen's idea of a chip; on the board a filter is a
   caption that is either struck under or it is not. The group's tint stays as
   the 7 px mark in front of it — that dot is information, not decoration. */
.lk__chip {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 4px 2px; border-radius: 0;
  border: 0; border-bottom: var(--p-rule) solid transparent;
  background: none;
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-2);
}
.lk__chip i { font-style: normal; font-variant-numeric: tabular-nums; opacity: .7; letter-spacing: 0; }
.lk__chip::before {
  content: ""; width: 7px; height: 7px; border-radius: var(--p-r); flex: none;
  background: var(--g, var(--lk-ink-3)); align-self: center;
}
.lk__chip:hover { color: var(--lk-ink); }
.lk__chip.is-on { color: var(--lk-ink); border-bottom-color: var(--p-ink); background: none; }
.lk__chip.is-on::before { background: var(--g, var(--lk-ink)); }
.lk__filters, .lk__subs { gap: 6px 16px; }

.lk__grid {
  display: grid; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  overflow-y: auto; overflow-x: hidden;
  min-height: 0; padding: 2px 10px 10px 0;
  scrollbar-color: var(--lk-line-2) transparent;
}
.lk__grid::-webkit-scrollbar { width: 9px; }
.lk__grid::-webkit-scrollbar-track { background: transparent; }
.lk__grid::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; border: 3px solid transparent; background-clip: content-box; }
.lk__grid::-webkit-scrollbar-thumb:hover { background: var(--lk-ink); background-clip: content-box; }
.lk__grid.is-swap { animation: lk-swap var(--p-rise) var(--p-rise-ease); }
@keyframes lk-swap { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* ---- the card */
/* The card on the board: a cream plate, a hairline, 2 px radius, and NO LIFT —
   register 3 has no hover choreography, and a printed card does not levitate.
   Selection is the ink rule the trail rows use, turned all the way round the
   card; EQUIPPED is the one accent (§1.7's lift orange), spent on a word and
   never on a surface. */
.lk__card {
  position: relative; display: grid; gap: 6px; cursor: pointer; text-align: left;
  padding: 8px;
  border: var(--p-hairline) solid var(--lk-line);
  border-radius: var(--p-r);
  background: var(--lk-board);
  /* border-color is the selection ring and is deliberately NOT transitioned —
     see the note on .lk__tab. Nothing else here animates any more. */
  transition: none;
}
.lk__card:hover { background: var(--lk-wash); border-color: var(--lk-line-2); }
.lk__card.is-sel {
  background: var(--lk-wash);
  border-color: var(--p-ink);
  box-shadow: inset var(--p-spine) 0 0 var(--p-ink);
}
.lk__card.is-eq { background: var(--lk-wash); }
.lk__card.is-go { animation: lk-equip var(--p-snap) linear; }
@keyframes lk-equip {
  0% { transform: scale(.96); }
  100% { transform: none; }
}
/* THE ITEM PREVIEW (constraint 2). Every thumb this screen ever drew is still
   drawn here, at the same size, on the same near-black ground it always had —
   \`.lk__art\` was a dark plate before the theme and it is §1.6's ink board
   after it, so a ski topsheet, an outfit's four bands and a boot swatch all
   read exactly as they did. Only the frame changed: 2 px radius, and a
   mounting rule in the item's OWN kind colour under it. */
.lk__art {
  position: relative; display: grid; place-items: center;
  height: 78px; border-radius: var(--p-r); overflow: hidden;
  background: var(--lk-plate);
  border-bottom: var(--p-rule) solid var(--g, var(--lk-acc));
  box-shadow: none;
}
.lk__img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
/* the group word is a CAPTION in the group's colour, not a pill: on the ink
   board the tint carries itself, and the register spends no surface on it */
.lk__gchip {
  position: absolute; top: 5px; right: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  padding: 0; border-radius: 0;
  background: none; color: var(--g);
}
.lk__brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: var(--lk-ink-2);
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
     "Trek Ticket DJ" with "Specialized Epic Hardtail" still rules a level grid.
     The board's own face, obliqued and capped — the trail rows' name, one size
     down because a card is not a row. */
  font-family: var(--lk-sans); font-size: 12.5px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .04em; line-height: 1.24; min-height: 2.48em;
  color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lk__tag {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* EQUIPPED sits on the art in the game's one accent — the lookbook A cell's
   rule: the orange stays a signal and never becomes a surface. It gets the ink
   plate under it because the art it lies on is a PICTURE, and a picture is the
   one ground a caption cannot count on (an orange ski under orange type). */
.lk__eq {
  position: absolute; left: 8px; top: 8px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 3px 6px; border-radius: 0;
  background: var(--p-ink); color: var(--lk-sig);
  box-shadow: none;
}
.lk__eq::before { content: "\\2713"; font-size: 9px; letter-spacing: 0; }

/* ---- specs/0019: the settings rows.
   The same grid element the cards live in, switched to one full-width column,
   so the scrolling, the keyboard selection and the swap animation are the ones
   that already work rather than a second implementation of them. */
.lk__grid.is-rows { grid-template-columns: minmax(0, 1fr); gap: 0; }
.lk__row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 8px 16px; cursor: pointer; text-align: left;
  padding: 12px 10px;
  border: 0; border-bottom: var(--p-hairline) solid var(--lk-line); border-radius: 0;
  background: none;
  /* the selection is the ink rule, not transitioned — same note as .lk__tab */
  transition: none;
}
.lk__row:hover { background: var(--lk-wash); }
.lk__row.is-sel {
  background: var(--lk-wash);
  box-shadow: inset var(--p-spine) 0 0 var(--p-ink);
}
.lk__row.is-go { animation: lk-equip var(--p-snap) linear; }
/* both are SPANS in a <button> (a button may not contain a <div>), so they have
   to be told to be blocks — left inline they set as one paragraph and the label
   runs straight into the sentence after it */
.lk__row-t {
  display: block;
  font-family: var(--lk-sans); font-size: 15px; font-weight: var(--p-weight);
  font-style: var(--p-oblique);
  letter-spacing: .04em; text-transform: uppercase; color: var(--lk-ink);
}
/* §1.2 — prose is roman, sentence case, and never oblique */
.lk__row-d {
  display: block; font-family: var(--lk-sans); font-size: var(--p-prose);
  font-style: normal; letter-spacing: 0; line-height: 1.45;
  color: var(--lk-ink-2); margin-top: 4px;
}
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
  position: relative; width: 34px; height: 18px; border-radius: var(--p-r); flex: none;
  background: var(--p-cream);
  box-shadow: inset 0 0 0 1px var(--p-ink);
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
.lk__sw.is-on .lk__sw-v { color: var(--lk-sig); }

/* W1 TOOK THE HAND-OFF (specs/0055 1.1). W4 typed the cream, the ink and the
   seam here because the :root block did not exist yet; it does, so the two
   blocks below read --p-cream / --p-ink / --p-seam and this file names no
   colour of its own. hud.js's sheet is injected at import time, which is before
   this stylesheet paints anything, so there is no first-frame gap.

   ---- specs/0055 5.2: THE TRAIL QUICK-TRAVEL TAB.
   The lookbook's trail selector — and as of Greg's 2026-09-06 pick it is no
   longer the one board in a dark screen: it is the register the WHOLE locker
   now wears. So this block keeps only what is particular to a trail row (the
   four-column rhythm, the severity mark, the slug) and inherits the board, the
   hairline, the wash and the ink selection from \`.lk__row\` above. */
.lk__grid.is-trails { gap: 0; background: none; padding: 2px 10px 10px 0; border-radius: 0; }
.lk__trow {
  display: grid; align-items: center;
  grid-template-columns: 22px minmax(0, 1fr) 74px 132px;
  gap: 0 12px;
  /* P5 — 12 px of padding on a 20 px row is a 44 px tap target, and the 9 px
     W4 shipped was 38. Every row on this screen clears 44 now. */
  padding: 12px 8px; margin: 0;
  text-align: left; cursor: pointer;
}
.lk__trow.is-go { animation: none; }
.lk__trow-n {
  display: block; font-family: var(--lk-sans); font-size: 15px;
  font-weight: var(--p-weight); font-style: var(--p-oblique);
  letter-spacing: .04em; text-transform: uppercase; color: var(--p-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a, .lk__trow-k, .lk__trow-s {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lk__trow-a { display: block; margin-top: 2px; color: #a49c8d; }
.lk__trow-k { color: var(--p-sub); }
.lk__trow-s { text-align: right; }

/* ---- specs/0061 §1.3: the row's one state.
   specs/0061 (one click, 2026-09-06) — AND THE GO PLATE IS GONE WITH ITS CELL.
   The plate carried the fast travel the row body had given up; the body equips
   AND travels again, so the fifth column and the ink rectangle in it went back
   where they came from and the row is the four-column rhythm W4 shipped.
   The EQUIPPED row keeps the mounting rule as a left spine — the same 3 px inset
   the selected row already wears, in the tab's accent instead of ink, so
   "selected" and "equipped" read apart. No new surface: cream board, nothing
   else.
   GATE-0055 CLOSEOUT, 2026-09-06 (row 8(d)) — the ground here was a raw hex
   literal (specs/0055 §5.2 names it), which under D19 reads as a third surface
   however close to the wash it sat. It is \`--lk-wash\` now — the locker's own
   ground for a row that is ON: the token \`.lk__row:hover\`, \`.lk__row.is-sel\`
   and \`.lk__card.is-eq\` already use, ink at 7 % over \`--p-cream\`, resolving to
   \`#e5e2db\`. The literal was within four levels on one channel, so the row does
   not change colour. The state is still told apart the way this block always
   told it — EQUIPPED keeps the accent spine where a selected row wears the ink
   one, plus the \`· equipped\` caption below — so nothing is carried by a colour
   that can drift off §1.6's two surfaces. */
.lk__trow.is-eqt { background: var(--lk-wash); box-shadow: inset 3px 0 0 var(--lk-acc); }
.lk__trow.is-eqt.is-sel { box-shadow: inset 3px 0 0 var(--lk-acc); }
.lk__trow.is-eqt .lk__trow-n::after {
  content: "· equipped"; margin-left: 8px;
  font-family: var(--lk-mono); font-size: 8.5px; font-weight: 700;
  letter-spacing: .16em; color: #8f887a;
}

/* ---- specs/0061 §3.1: the map board. It sits in the hero's slot, which the
   trail tab already leaves empty (0055 §5.2), so no slab is added (D19): this
   is the cream surface the rows are already on, under §1.10's 2 px mounting
   rule. The canvas fills it and paints itself. */
.lk__map {
  position: relative; height: clamp(190px, 26vh, 330px);
  background: var(--p-cream);
  border: 0; border-bottom: var(--p-rule, 2px) solid var(--p-ink);
  border-radius: 2px 2px 0 0;
  overflow: hidden; cursor: crosshair;
}
/* THREE CLASSES, for the reason \`.lk__canvas\` above needs them: play.css's
   \`body.play canvas { position: fixed; left: 0; top: 0 }\` is (0,1,2) and
   outranks any two-part selector, so an unqualified rule here leaves the map
   pinned to the viewport at full screen size, painting cream over the whole
   locker. */
.lk .lk__map .lk__mapcv {
  position: absolute; inset: 0; display: block; width: 100%; height: 100%;
}
/* specs/0061 §1.6 — the section seam. Mono caps on the cream board over the
   3 px blade spine (§1.10), which is the rule the trail blades already use for
   "a heading, not a row". No surface of its own. */
.lk__tsec {
  font-family: var(--lk-mono); font-size: 8.5px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: #8f887a;
  padding: 12px 8px 5px; margin: 0;
  border-bottom: 1px solid var(--p-ink);
}
.lk__grid.is-trails > .lk__tsec:first-child { padding-top: 2px; }
.lk__map-t {
  position: absolute; left: 7px; top: 6px;
  font-family: var(--lk-mono); font-size: 8px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #8f887a;
  pointer-events: none;
}

/* 1.8's severity alphabet, one CSS class per shape. Colours are the ones the
   world already uses: green circle, blue square, black diamond, double. */
.lk__mark { display: block; width: 13px; height: 13px; justify-self: center; }
.lk__mark.is-circ { border-radius: 50%; background: var(--p-diff-green); }
.lk__mark.is-sq { background: var(--p-diff-blue); }
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
  display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); gap: 10px;
  padding: 0 0 0 14px;
  border: 0; border-left: var(--p-hairline) solid var(--lk-line); border-radius: 0;
  background: none;
  overflow: hidden;
}
/* THE ITEM PREVIEW, BLOWN UP (constraint 2, second surface). The deck's hero is
   the same ink board the cards' art is, at 2 px radius under a mounting rule in
   the item's kind colour — so the thing you are about to equip is the largest
   picture on the screen after the rider. */
.lk__hero {
  /* the art grows into whatever height the deck has spare — 132 px at 720p,
     ~190 px at 1080p — instead of leaving the panel's foot empty */
  position: relative; height: clamp(132px, 18vh, 216px);
  border-radius: var(--p-r); overflow: hidden;
  display: grid; place-items: center;
  background: var(--lk-plate);
  border: 0; border-bottom: var(--p-rule) solid var(--g, var(--lk-acc));
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
  padding: 3px 6px; border-radius: 0;
  background: var(--p-ink); color: var(--lk-sig);
}
.lk__d-head { display: grid; gap: 2px; }
.lk__d-brand {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase; color: var(--lk-ink-2);
}
.lk__d-name {
  font-family: var(--lk-sans); font-size: 24px; font-weight: var(--p-weight);
  font-style: var(--p-oblique); text-transform: uppercase;
  letter-spacing: .06em; line-height: 1.12; color: var(--lk-ink);
}
.lk__d-spec {
  font-family: var(--lk-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .13em; text-transform: uppercase; color: var(--lk-ink-2);
}
/* §1.2 — the blurb is the one run of roman prose on this screen */
.lk__d-blurb {
  font-family: var(--lk-sans); font-size: 12.5px; font-style: normal; letter-spacing: 0;
  line-height: 1.45; color: var(--lk-ink);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}

/* ---- stat bars, with the delta against what is equipped */
.lk__stats { display: grid; gap: 6px; align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0; }
.lk__stats::-webkit-scrollbar { width: 7px; }
.lk__stats::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; }
.lk__stat { display: grid; grid-template-columns: 68px minmax(0, 1fr) 30px 34px; align-items: center; gap: 8px; }
.lk__stat-k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--lk-ink-2);
}
/* §1.10 — ONE 2 px gauge serves every bar in the game, and a stat bar is one
   of them: the seam is the track, ink is the fill, and the delta keeps the
   severity alphabet's green and red. No pill, no glow, no gradient. */
.lk__stat-t {
  position: relative; height: 4px; border-radius: 0; overflow: hidden;
  background: var(--lk-line); box-shadow: none;
}
.lk__stat-t i, .lk__stat-t u {
  position: absolute; top: 0; bottom: 0; display: block;
  transition: left .18s ease-out, width .18s ease-out, background .2s;
}
/* the bar itself stops at the SHARED value; the delta segment carries the sign */
.lk__stat-t i { left: 0; width: 0; background: var(--p-ink); }
.lk__stat-t u { width: 0; text-decoration: none; }
.lk__stat-t u.is-up { background: var(--lk-good); box-shadow: none; }
.lk__stat-t u.is-down {
  background: repeating-linear-gradient(-45deg, var(--lk-bad) 0 3px, transparent 3px 6px);
}
.lk__stat-v {
  font-family: var(--lk-mono); font-size: 10px; font-weight: 700;
  font-variant-numeric: tabular-nums;
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
.lk__cmp::before { content: ""; flex: 1 1 auto; height: var(--p-hairline); background: var(--lk-line); }

.lk__facts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px;
  align-content: start; overflow-y: auto; padding-right: 4px; min-height: 0;
  border-top: var(--p-hairline) solid var(--lk-line); padding-top: 9px;
}
.lk__facts::-webkit-scrollbar { width: 7px; }
.lk__facts::-webkit-scrollbar-thumb { background: var(--lk-line-2); border-radius: 0; }
.lk__fact { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.lk__fact .k {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--lk-ink-3);
}
.lk__fact .v {
  font-family: var(--lk-mono); font-size: 10px; font-weight: 700;
  color: var(--lk-ink); font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------------- hint bar */
.lk__foot {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 9px 14px; border-top: var(--p-hairline) solid var(--lk-line);
  background: none;
}
.lk__hint { display: inline-flex; align-items: center; gap: 7px; }
.lk__hint span {
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700; letter-spacing: .16em;
  text-transform: uppercase; color: var(--lk-ink-2);
}
/* the lookbook's \`.cap--inv\`: an outlined ink key cap, 2 px radius, no bevel */
.lk__key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 5px;
  border: var(--p-hairline) solid var(--p-ink); border-radius: var(--p-r);
  background: none;
  font-family: var(--lk-mono); font-size: 9px; font-weight: 700;
  letter-spacing: .04em; color: var(--lk-ink);
}
.lk__foot-sp { flex: 1 1 auto; }

/* ------------------------------------------------------------ narrow decks */
@media (max-width: 1180px) {
  .lk__main {
    grid-template-columns: 260px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 250px);
    grid-template-areas: "pv grid" "det det";
  }
  /* the deck moves under the grid, so its hairline turns with it */
  .lk__det {
    border-left: 0; border-top: var(--p-hairline) solid var(--lk-line);
    padding: 12px 0 0;
  }
  .lk__mid { padding: 0 0 0 14px; }
  .lk__hero { height: 96px; }
  .lk__det { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: "hero head" "hero blurb" "stats facts"; column-gap: 14px; }
  .lk__hero { grid-area: hero; height: 100%; }
  /* specs/0061 §3.1 — the map takes the hero's cell here too, because on this
     tab the hero is the thing that is hidden */
  .lk__map { grid-area: hero; height: 100%; }
  .lk__d-head { grid-area: head; align-self: end; }
  .lk__d-blurb { grid-area: blurb; -webkit-line-clamp: 3; }
  .lk__stats { grid-area: stats; }
  .lk__facts { grid-area: facts; }
}
@media (max-width: 860px) {
  .lk__main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "pv" "grid" "det"; grid-template-rows: 190px minmax(0,1fr) 220px; }
  .lk__load { display: none; }
  /* one column: every hairline is a horizontal one */
  .lk__pv { border-right: 0; padding-right: 0; padding-bottom: 12px;
    border-bottom: var(--p-hairline) solid var(--lk-line); }
  .lk__mid { padding: 12px 0 0; }
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
`;let en=!1;function Da(){if(en||typeof document>"u")return;en=!0;const e=document.createElement("style");e.id="lk-css",e.textContent=Ba,document.head.appendChild(e)}let He=null,tn="y",kt=null;const nn=()=>{if(kt)return kt;let e=null;try{e=window.__guide||null}catch{e=null}return!e||!e.layTrail?null:{lay:l=>e.layTrail(l),clear:()=>e.clearTrail(),state:()=>e.trailState()}},ye=()=>{const e=nn();return e?e.state():null};function ei({THREE:e,model:l,unitScale:h,ctrl:u,onEquip:b,initial:r,world:i,upAxis:x,trail:m}){Da(),i&&(He=i,tn=x==="z"?"z":"y"),m&&(kt=m);const v=h||1;let y=!1,c=0,k="all",w="looks",g=0,S=[],O=null;try{O=new URLSearchParams(location.search)}catch{O=null}const C={skis:r&&r.skis||An,glider:r&&r.glider||In,bike:r&&r.bike||qn,sled:r&&r.sled||(O?Un(O):Wn),snowmobile:r&&r.snowmobile||(O?Xn(O):Vn),boots:ka("boots")||"boots",outfit:r&&r.outfit||ia()},N=d("div","lk");N.hidden=!0;const Z=d("section","lk__panel"),Te=d("div","lk__hd"),Se=d("div","lk__title");Se.innerHTML="equipment <b>locker</b>";const Q=d("div","lk__load"),$={};for(const t of q){if(t.id==="boots"||t.kind==="settings"||t.kind==="trail")continue;const n=d("div","lk__load-i"),a=d("span","lk__load-v","—");n.append(d("span","lk__load-k",t.label),a),Q.append(n),$[t.id]=a}Te.append(Se,d("span","lk__spacer"),Q);const pe=d("div","lk__tabs"),he=q.map((t,n)=>{const a=d("button","lk__tab");a.type="button",a.style.setProperty("--lk-tab-acc",t.accent||"#4cc9f0");const s=d("span","lk__tab-ic");s.innerHTML=_a(t.icon);const p=d("span","lk__tab-n","0");return a.append(s.firstChild,d("span","lk__tab-l",t.label),p),a.addEventListener("click",_=>{_.stopPropagation(),de(n)}),pe.append(a),{b:a,n:p}}),X=d("div","lk__main"),fe=d("div","lk__pv"),ie=d("div","lk__stage"),f=d("div","lk__eqflash");ie.append(f);const L=d("div","lk__plate"),P=d("div","lk__plate-brand",""),B=d("div","lk__plate-name","—"),j=d("div","lk__plate-tag","");L.append(P,B,j),fe.append(ie,L);const G=d("div","lk__mid"),oe=d("div","lk__subs");oe.hidden=!0;const Me=d("div","lk__filters"),gt=d("div","lk__bars");gt.append(oe,Me);const D=d("div","lk__grid");G.append(gt,D);const ue=d("div","lk__det"),ke=d("div","lk__hero"),Le=d("div","lk__hero-bg"),re=d("img","lk__hero-img");re.alt="";const ge=d("div","lk__hero-eq","equipped");ge.hidden=!0,ke.append(Le,re,ge);const V=d("div","lk__map"),se=d("canvas","lk__mapcv");se.setAttribute("data-map","trails"),V.append(se,d("div","lk__map-t","north up")),V.hidden=!0;let I=null;const mt=d("div","lk__d-head"),Ae=d("div","lk__d-brand",""),Ve=d("div","lk__d-after",""),Ee=d("div","lk__d-name","—"),Ie=d("div","lk__d-spec","");mt.append(Ae,Ve,Ee,Ie);const Pe=d("div","lk__d-blurb",""),le=d("div","lk__stats"),bt=d("div","lk__cmp"),ee=d("div","lk__facts");ue.append(ke,V,mt,Pe,le,ee);function Oe(){if(!y||M().kind!=="trail"||V.hidden)return null;const t=ye(),n=S[g],a=new Set(n&&n.segments&&n.segments.length?n.segments:n?[n.id]:t&&t.segments||(t?[t.id]:[]));if(I=Jt(se,He,K(M()),{highlight:a}),I&&I.box){const s=I.box,p=(s.z1-s.z0)/Math.max(1e-6,s.x1-s.x0),_=Math.round(Math.max(120,Math.min(330,(se.clientWidth||300)*p+18)));Math.abs(V.clientHeight-_)>4&&(V.style.height=_+"px",I=Jt(se,He,K(M()),{highlight:a}))}return I}V.addEventListener("click",t=>{if(!I||!I.hits.length)return;const n=se.getBoundingClientRect(),a=Zt(I.hits,t.clientX-n.left,t.clientY-n.top);if(!a)return;const s=S.findIndex(p=>p.id===a||(p.segments||[]).includes(a));s<0||(g=s,R(),ce())}),X.append(fe,G,ue);const me=d("div","lk__foot"),an=[[["←","→","↑","↓"],"navigate"],[["enter"],"equip"],[["q","e"],"tabs"],[["f"],"filter"],[["1-9"],"quick equip"]];for(const[t,n]of an){const a=d("span","lk__hint");for(const s of t)a.append(d("kbd","lk__key",s));a.append(d("span",null,n)),me.append(a)}const be=d("span","lk__hint");be.append(d("kbd","lk__key","t"),d("span",null,"go there")),be.hidden=!0,me.append(be),me.append(d("span","lk__foot-sp"));const _t=d("span","lk__hint");_t.append(d("kbd","lk__key","esc"),d("span",null,"close")),me.append(_t),Z.append(Te,pe,X,me),N.append(Z),document.body.appendChild(N);let o=null;function on(){const t=new e.Scene;t.add(new e.HemisphereLight(16777215,3816004,1.35));const n=new e.DirectionalLight(16777215,1.05);n.position.set(3,5,4);const a=new e.DirectionalLight(16767432,.5);a.position.set(-4,2,-3),t.add(n,a);const s=new e.Group;t.add(s);const p=l?l.clone(!0):new e.Group,_=l&&l.getObjectByName("play:body"),A=_?sa(_):null,T=A?ra(A):null;if(T){const E=p.getObjectByName("play:body");E&&E.parent?(E.parent.add(T.model),E.parent.remove(E)):p.add(T.model),T.skeleton.pose(),T.model.updateMatrixWorld(!0)}p.position.set(0,0,0),p.rotation.set(0,0,0);const z=[];p.traverse(E=>{const Lt=na(E.name||"")!=null&&l.getObjectByName(E.name);Lt?z.push([E,Lt]):E.visible=!0});const H=new Set;T&&T.model.traverse(E=>{E.isMesh&&/^rider:/.test(E.name||"")&&E.material&&H.add(E.material)});const F=T?new Map([...T.riderMats].filter(([,E])=>H.has(E))):new Map,tt=T?T.riderToggles:[],ne=/^play:(?:fp-|tp-)|^play:ski-[lr]$|^play:rocket-pack$/;p.traverse(E=>{E.name&&ne.test(E.name)&&(E.visible=!1)});const ze=p.getObjectByName("play:tp-glider"),ae=p.getObjectByName("play:body"),xn=p.getObjectByName("play:rocket-pack"),nt=ae?ae.getObjectByName("rider:body"):null,yn=nt?new e.AnimationMixer(nt):null,Mt=new Map;for(const E of ae&&ae.animations||[])Mt.set(E.name,E);s.add(p);const at=At(e,v),it=At(e,v);at.position.set(-.15*v,.02*v,0),it.position.set(.15*v,.02*v,0),s.add(at,it);const ot=Rn(e,v);ot.visible=!1,s.add(ot);const rt=$n(e,v);rt.visible=!1,s.add(rt);const st=Jn(e,v,{model:C.snowmobile});st.visible=!1,s.add(st);const Tn=new e.PerspectiveCamera(34,1,.05*v,80*v),Fe=new e.WebGLRenderer({alpha:!0,antialias:!0});Fe.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),Fe.domElement.className="lk__canvas",ie.insertBefore(Fe.domElement,f),o={scene:t,camera:Tn,renderer:Fe,turntable:s,skiL:at,skiR:it,bike:ot,sled:rt,snow:st,cGlide:ze,cBody:ae,cPack:xn,cSkin:nt,mixer:yn,clips:Mt,clip:null,want:null,riderPairs:z,riderMats:F,riderToggles:tt,tryOn:null,t:0,kick:0},qe()}function qe(){if(!o)return;const t=Math.max(80,ie.clientWidth),n=Math.max(80,ie.clientHeight),a=Math.max(80,Math.min(n,Math.round(t*4/3)));o.renderer.setSize(t,a,!1),o.renderer.domElement.style.height=a+"px",o.renderer.domElement.style.top=Math.round((n-a)/2)+"px",o.camera.aspect=t/a,o.camera.updateProjectionMatrix()}function rn(t){if(!o||!o.mixer||o.want===t)return;o.want=t;const n=o.clips.get(t)||o.clips.get("idle-boots")||o.clips.get("ski-stance");if(!n||o.clip===n.name)return;o.mixer.stopAllAction();const a=o.mixer.clipAction(n);a.reset(),a.enabled=!0,a.setEffectiveWeight(1),a.play(),o.clip=n.name,o.mixer.setTime(0)}function sn(t,n){if(!o)return;const a=t.kind==="outfit",s=t.kind==="ski"||a,p=t.kind==="glider"&&n?n.preview:null,_=p==="wing",A=t.kind==="bike",T=t.kind==="sled",z=t.kind==="snowmobile",H=A||T||z;if(o.skiL.visible=o.skiR.visible=s,o.cGlide&&(o.cGlide.visible=_),o.cBody&&(o.cBody.visible=!0),o.cPack&&(o.cPack.visible=p==="pack"),rn(A?"seat-bike":T?"seat-sled":z?"seat-snowmobile":_?"prone-glider":"idle-boots"),o.cBody&&(o.cBody.position.set(0,_?1.05*v:0,0),o.cBody.rotation.x=o.cBody.rotation.y=o.cBody.rotation.z=0,A&&n)){const F=Bn(Fn(n.id));o.cBody.position.y+=(F.hip[0]-1.053)*v,o.cBody.position.z+=(F.hip[1]-.305)*v}if(o.bike.visible=A,o.sled.visible=T,o.snow.visible=z,A&&n&&zn(e,o.bike,n.id),T&&n&&Kn(e,o.sled,n.id),z&&n&&Zn(e,o.snow,n.id),s&&n){const F=a?C.skis:n.id;Et(e,o.skiL,F),Et(e,o.skiR,F)}if(a&&n){const F=w==="looks"?n.id:dn(n.id);Be(e,o,F),o.tryOn=F}else o.tryOn!=null&&(Be(e,o,window.__player?.outfit),o.tryOn=null)}const ln=.28;let Ce=0,Ye=0;function wt(t){if(!y){Ce=0;return}Ce=requestAnimationFrame(wt);const n=Math.min(.05,(t-Ye)/1e3||0);if(Ye=t,!o)return;o.hold==null&&(o.t+=n),o.turntable.rotation.y=o.hold==null?o.turntable.rotation.y+n*(ln+o.kick):o.hold,o.mixer&&(o.hold==null?o.mixer.update(n):o.mixer.setTime(0)),o.kick*=Math.exp(-n*3.4),o.kick<.001&&(o.kick=0);const a=Math.tan(o.camera.fov*Math.PI/180/2),s=Math.max(1.12/a,1.3/(a*Math.max(.25,o.camera.aspect)))*v;if(o.camera.position.set(0,(1.3+.012*Math.sin(o.t*.7))*v,s),o.camera.lookAt(0,.86*v,0),o.tryOn==null)for(const[p,_]of o.riderPairs)p.visible=_.visible;o.renderer.render(o.scene,o.camera)}const M=()=>q[c],Y=new Set;function K(t){try{const n=t.items(t.kind==="outfit"?w:void 0);if(Array.isArray(n))return Y.delete(t.id),n}catch(n){Y.has(t.id)||console.warn(`[locker] rack "${t.id}" unavailable:`,n&&n.message)}return Y.add(t.id),[]}function vt(t){const n=[];for(const a of t)a.group&&!n.includes(a.group)&&n.push(a.group);return n}function Ne(){const t=M();if(t.kind!=="outfit")return C[t.id];const n=dt(C.outfit);return w==="looks"?n.every(a=>a===n[0])?n[0]:null:n[De.indexOf(w)]}const dn=t=>oa(dt(C.outfit).map((n,a)=>a===De.indexOf(w)?t:n));function cn(){const t=M().kind==="outfit";if(oe.hidden=!t,!!t){oe.textContent="",oe.append(d("kbd","lk__key","g"));for(const n of xe){const a=d("button","lk__chip");a.type="button",a.style.setProperty("--g",M().accent||"#4cc9f0"),a.append(document.createTextNode(n)),a.classList.toggle("is-on",w===n),a.addEventListener("click",s=>{s.stopPropagation(),Qe(n)}),oe.append(a)}}}function Qe(t){return xe.includes(t)&&t!==w&&(w=t,g=0,_e()),w}function pn(){const t=M().accent||"#4cc9f0";N.style.setProperty("--lk-acc",t),N.style.setProperty("--lk-acc-soft",Ge(t,.18)),N.style.setProperty("--lk-acc-dim",Ge(t,.34))}function hn(){q.forEach((t,n)=>{he[n].n.textContent=String(K(t).length),he[n].b.hidden=Y.has(t.id)})}function Xe(){for(const t of q){if(!$[t.id])continue;const n=K(t).find(a=>a.id===C[t.id]);$[t.id].parentElement.hidden=Y.has(t.id),$[t.id].textContent=t.kind==="outfit"?fn():n?n.name:"—"}}function fn(){const t=[...new Set(dt(C.outfit))];if(t.length>1)return"mix · "+t.length+" houses";const n=ta[t[0]];return n?$e(n)+" · "+n.name:"—"}function un(){const t=K(M()),n=vt(t);if(Me.textContent="",Me.hidden=n.length<2,n.length<2)return;const a={all:t.length};for(const s of n)a[s]=t.filter(p=>p.group===s).length;for(const s of["all",...n]){const p=d("button","lk__chip");p.type="button",p.style.setProperty("--g",s==="all"?M().accent||"#4cc9f0":pt(s)),p.append(document.createTextNode(s),d("i",null,String(a[s]))),p.classList.toggle("is-on",k===s),p.addEventListener("click",_=>{_.stopPropagation(),k=s,g=0,_e()}),Me.append(p)}}const xt=new WeakMap;function yt(t,n){const a=xt.get(t);if(!a)return;const s=We(n);a.el.classList.toggle("is-on",s),a.v.textContent=s?"on":"off",t.setAttribute("aria-checked",s?"true":"false")}function kn(t,n){const a=d("button","lk__row");a.type="button",a.setAttribute("role","switch");const s=d("span","lk__row-txt");s.append(d("span","lk__row-t",t.name),d("span","lk__row-d",t.desc||""));const p=d("span","lk__sw"),_=d("span","lk__sw-v","off");return p.append(d("span","lk__sw-t"),_),xt.set(a,{el:p,v:_}),a.append(s,p),yt(a,t.key),a.addEventListener("click",A=>{A.stopPropagation(),g=n,R(),ce()}),a.addEventListener("mouseenter",()=>{g=n,R()}),D.append(a),a}function Re(t){let n=null;try{n=window.__playMarkers&&window.__playMarkers.fastTravel(t.slug)}catch{n=null}if(!n&&t.at&&window.__player&&typeof window.__player.teleport=="function")try{window.__player.teleport(t.at.x,t.at.y,t.at.z),n=!0}catch{n=null}return we(),!!n}function gn(t){if(!t)return null;if(!t.canEquip)return Re(t);const n=nn();if(!n)return Re(t);const a=n.lay(t.segments&&t.segments.length>1?t.segments:t.id);if(Ze(),Re(t),a&&a.start&&Number.isFinite(a.start.yaw))try{window.__player.setYaw(a.start.yaw)}catch{}return a}function mn(t,n){const a=S[n-1];(!a||a.section!==t.section)&&D.append(d("div","lk__tsec",t.section==="places"?"places · fast travel":"runs · equip a trail"));const s=d("button","lk__row lk__trow");s.type="button",s.setAttribute("data-slug",t.slug),s.setAttribute("data-id",t.id),s.setAttribute("data-sec",t.section||"runs");const p=ut[t.diff]||null,_=d("span","lk__mark"+(p?" "+p.cls:""));p&&_.setAttribute("aria-label",p.label);const A=d("span","lk__row-txt");A.append(d("span","lk__trow-n",t.name)),t.also&&A.append(d("span","lk__trow-a",t.also)),s.append(_,A,d("span","lk__trow-k",t.kind||""),d("span","lk__trow-s",t.slug));const T=ye();return T&&T.id===t.id&&s.classList.add("is-eqt"),s.addEventListener("click",z=>{z.stopPropagation(),g=n,R(),ce()}),s.addEventListener("mouseenter",()=>{g=n,R()}),D.append(s),s}let W=[],Je=[];function Ze(){const t=M(),n=K(t);if(Je=va(n),S=k==="all"?n:n.filter(a=>a.group===k),S.length||(S=n),g=Math.max(0,Math.min(g,S.length-1)),D.textContent="",D.classList.toggle("is-rows",t.kind==="settings"||t.kind==="trail"),D.classList.toggle("is-trails",t.kind==="trail"),t.kind==="settings"){W=S.map(kn),R();return}if(t.kind==="trail"){W=S.map(mn),R();return}W=S.map((a,s)=>{const p=pt(a.group),_=d("button","lk__card");_.type="button",_.style.setProperty("--g",p),_.style.setProperty("--g-wash",Ge(p,.16)),_.style.setProperty("--g-glow",Ge(p,.55));const A=d("span","lk__art"),T=d("img","lk__img");T.alt="",a.thumb?T.src=a.thumb:T.hidden=!0,A.append(T),a.group&&A.append(d("span","lk__gchip",a.group));const z=[d("span","lk__brand",a.brand||"")];return a.after&&z.push(d("span","lk__after",a.after)),_.append(A,...z,d("span","lk__name",a.name),d("span","lk__tag",a.tag||"")),Ne()===a.id&&(_.append(d("span","lk__eq","equipped")),_.classList.add("is-eq")),_.addEventListener("click",H=>{H.stopPropagation(),g=s,R(),ce()}),_.addEventListener("mouseenter",()=>{g=s,R()}),D.append(_),_}),R()}const Tt=[];function bn(t){const n=K(M()).find(s=>s.id===C[M().id])||null,a=n&&n.id===t.id;le.textContent="",Tt.length=0;for(const s of Je){const p=Bt(s,t.stats[s.key]),_=n&&ht(n.stats[s.key])?Bt(s,n.stats[s.key]):p,A=d("div","lk__stat"),T=d("span","lk__stat-t"),z=d("i"),H=d("u"),F=Math.min(p,_);z.style.width=(F*100).toFixed(1)+"%",!a&&Math.abs(p-_)>.004?(H.style.left=(F*100).toFixed(1)+"%",H.style.width=(Math.abs(p-_)*100).toFixed(1)+"%",H.classList.add(p>_?"is-up":"is-down")):z.style.width=(p*100).toFixed(1)+"%",T.append(z,H);const tt=d("span","lk__stat-v",String(Math.round(p*100))),ne=Math.round((p-_)*100),ze=d("span","lk__stat-d",a||ne===0?"":(ne>0?"+":"−")+Math.abs(ne));!a&&ne!==0&&ze.classList.add(ne>0?"is-up":"is-down");const ae=s.src&&ht(t.stats[s.src])?t.stats[s.src]:t.stats[s.key];A.title=`${s.label}: ${ae.toFixed(2)}${s.suffix||""}`,A.append(d("span","lk__stat-k",s.label),T,tt,ze),le.append(A),Tt.push(A)}Je.length&&(bt.textContent=a||!n?"equipped":"vs "+n.name,le.append(bt))}function _n(t){ue.style.setProperty("--g",M().accent),re.hidden=!0,Le.style.backgroundImage="none",ge.hidden=!0,ke.hidden=!0,le.textContent="",Ae.textContent="settings",Ee.textContent=t.name,Ie.textContent=We(t.key)?"on":"off",Pe.textContent=t.desc||"",ee.textContent="";for(const[n,a]of[["state",We(t.key)?"on":"off"],["default",t.def?"on":"off"]]){const s=d("div","lk__fact");s.append(d("span","k",n),d("span","v",a)),ee.append(s)}}function wn(t){ue.style.setProperty("--g",M().accent),re.hidden=!0,Le.style.backgroundImage="none",ge.hidden=!0,ke.hidden=!0,V.hidden=!1,le.textContent="",Ae.textContent=t.kind||"waypoint",Ee.textContent=t.name,Ie.textContent=t.diff?ut[t.diff]?ut[t.diff].label:t.diff:"unrated";const n=ye(),a=!!(n&&n.id===t.id);Pe.textContent=t.canEquip?a?"Equipped. The dye and the chevrons are down this run. Click it again to go back to the top. F clears them — unless you are standing at a lift base, where F still boards.":"One click equips this run and drops you in at the top of it: dye and chevrons the whole way down, and the locker gets out of the way.":"Fast travel. You arrive short of the sign, on the floor, looking at it. T does the same.",ee.textContent="";const s=t.at||{},p=[["slug",t.slug],["also",t.also||"—"],["road",t.viaSign?"sign · T":"waypoint"],["east",Number.isFinite(s.x)?Math.round(s.x)+" m":"—"],["north",Number.isFinite(s.z)?Math.round(-s.z)+" m":"—"]];a?(p.push(["trail",Math.round(n.lengthM)+" m"]),p.push(["chevrons",n.arrows+" · every "+n.spacingM+" m"]),p.push(["dye",n.widthM+" m wide"])):t.canEquip&&p.push(["trail","click to equip · go"]);for(const[_,A]of p){const T=d("div","lk__fact");T.append(d("span","k",_),d("span","v",String(A))),ee.append(T)}Oe()}function R(){W.forEach((s,p)=>s.classList.toggle("is-sel",p===g));const t=S[g];if(be.hidden=M().kind!=="trail"||!t||!!t.canEquip,!t)return;if(W[g]&&W[g].scrollIntoView&&W[g].scrollIntoView({block:"nearest"}),V.hidden=M().kind!=="trail",M().kind==="settings"){_n(t);return}if(M().kind==="trail"){wn(t);return}ke.hidden=!1;const n=pt(t.group);ue.style.setProperty("--g",n);const a=Ne()===t.id;re.hidden=!t.thumb,t.thumb&&(re.src=t.thumb),Le.style.backgroundImage=t.thumb?`url(${t.thumb})`:"none",ge.hidden=!a,Ae.textContent=t.brand||"",Ve.textContent=t.after||"",Ve.hidden=!t.after,Ee.textContent=t.name,Ie.textContent=t.spec||t.tag||"",Pe.textContent=t.blurb||"",P.textContent=t.brand||"",B.textContent=t.name,j.textContent=(t.tag||"")+(a?" · equipped":""),bn(t),ee.textContent="";for(const[s,p]of t.facts||[]){const _=d("div","lk__fact");_.append(d("span","k",s),d("span","v",String(p))),ee.append(_)}sn(M(),t)}function _e(){he.forEach((t,n)=>t.b.classList.toggle("is-on",n===c)),be.hidden=!0,pn(),hn(),cn(),un(),Ze(),Xe()}function de(t,n=1){const a=c;let s=(t%q.length+q.length)%q.length;for(let T=0;T<q.length&&(K(q[s]),!!Y.has(q[s].id));T++)s=((s+n)%q.length+q.length)%q.length;c=s,k="all";const p=ye(),_=q[s].kind==="trail"&&p?p.id:Ne(),A=K(M());g=Math.max(0,A.findIndex(T=>T.id===_)),_e(),a!==c&&(D.classList.remove("is-swap"),D.offsetWidth,D.classList.add("is-swap"))}function ce(){const t=M(),n=S[g];if(!n)return;if(t.kind==="trail"){gn(n);return}if(t.kind==="settings"){da(n.key,!We(n.key));const p=W[g];p&&(yt(p,n.key),p.classList.remove("is-go"),p.offsetWidth,p.classList.add("is-go")),R();return}C[t.id]=n.id,t.remember?t.remember(n.id):t.kind==="ski"?Ln(n.id):t.kind==="glider"?Pn(n.id):t.kind==="bike"?Nn(n.id):ua(t.id,n.id),t.apply&&t.apply(n.id,t.kind==="outfit"?w:void 0),t.kind==="outfit"&&(C.outfit=window.__player&&window.__player.outfit||n.id);const a=t.kind==="outfit"?n.brand+" "+(w==="looks"?n.name:n.tag):n.name;b&&b({tab:t.id,gear:n.gear||t.gear||u&&u.mode,kind:t.kind,id:n.id,name:a}),vn(),R(),Xe(),o&&t.kind==="outfit"&&o.tryOn===C.outfit&&(o.tryOn=null);const s=W[g];s&&(s.classList.remove("is-go"),s.offsetWidth,s.classList.add("is-go")),f.classList.remove("is-go"),f.offsetWidth,f.classList.add("is-go"),o&&(o.kick=2.6)}function vn(){W.forEach((t,n)=>{const a=t.querySelector(".lk__eq"),s=Ne()===S[n].id;s&&!a?t.append(d("span","lk__eq","equipped")):!s&&a&&a.remove(),t.classList.toggle("is-eq",s)})}function St(){if(M().kind==="settings"||M().kind==="trail"||!W.length)return 1;const t=W[0].offsetWidth||1,n=10;return Math.max(1,Math.round((D.clientWidth+n)/(t+n)))}let te=0;function et(){y||(y=!0,te&&(clearTimeout(te),te=0),N.hidden=!1,N.classList.remove("is-out"),o?qe():on(),o&&(Be(e,o,window.__player?.outfit),o.tryOn=null),window.__player&&window.__player.outfit&&(C.outfit=window.__player.outfit),de(c),N.offsetWidth,N.classList.add("is-in"),Ye=performance.now(),Ce||(Ce=requestAnimationFrame(wt)),requestAnimationFrame(()=>{qe(),Oe()}))}function we(){y&&(y=!1,o&&(o.hold=null),o&&o.tryOn!=null&&(Be(e,o,window.__player?.outfit),o.tryOn=null),N.classList.remove("is-in"),N.classList.add("is-out"),te&&clearTimeout(te),te=setTimeout(()=>{te=0,y||(N.hidden=!0,N.classList.remove("is-out"))},150))}return addEventListener("resize",()=>{y&&(qe(),Oe())}),window.__locker=Object.assign(window.__locker||{},{turntable(t){return et(),o.hold=t==null?null:Number(t),o.t=0,new Promise(n=>requestAnimationFrame(()=>requestAnimationFrame(()=>n(o.turntable.rotation.y))))},tryOn:()=>o?o.tryOn:null,mannequin:()=>o?{body:o.cBody,skin:o.cSkin,clip:o.clip,want:o.want,baked:[...o.clips.keys()],pairs:o.riderPairs.length,mats:o.riderMats.size,toggles:o.riderToggles.length,pos:o.cBody?[o.cBody.position.x,o.cBody.position.y,o.cBody.position.z]:null,visible:!!(o.cBody&&o.cBody.visible),pack:!!(o.cPack&&o.cPack.visible),glider:!!(o.cGlide&&o.cGlide.visible)}:null,sub:()=>w,setSub:Qe,thumbMs:()=>Ht,mapStats:()=>I?{ms:I.ms,runs:I.runs,lifts:I.lifts,markers:I.markers,you:I.you,w:I.w,h:I.h,box:I.box}:null,mapDraw:()=>{const t=Oe();return t?{ms:t.ms,runs:t.runs,lifts:t.lifts,markers:t.markers,you:t.you}:null},mapPickAt:(t,n)=>I?Zt(I.hits,t,n):null,mapMid:t=>{const n=I&&I.hits.find(s=>s.id===t);if(!n||!n.scr.length)return null;const a=n.scr[Math.floor(n.scr.length/2)];return{x:+a[0].toFixed(1),y:+a[1].toFixed(1)}},trail:()=>ye()}),{root:N,isOpen:()=>y,open:et,close:we,toggle(){return y?we():et(),y},key(t){if(!y)return!1;if(t==="Escape"||t==="KeyI")return we(),!0;if(t==="KeyM"){if(M().kind==="trail")return we(),!0;const a=q.findIndex(s=>s.kind==="trail"&&!Y.has(s.id));return a>=0&&de(a),!0}if(t==="KeyQ")return de(c-1,-1),!0;if(t==="KeyE"||t==="Tab")return de(c+1,1),!0;if(t==="KeyF"){const a=["all",...vt(K(M()))];return k=a[(a.indexOf(k)+1)%a.length],g=0,_e(),!0}if(t==="KeyG")return M().kind==="outfit"&&Qe(xe[(xe.indexOf(w)+1)%xe.length]),!0;if(t==="KeyT"){const a=S[g];return M().kind==="trail"&&a&&!a.canEquip&&Re(a),!0}if(!S.length)return!0;if(t==="ArrowLeft"||t==="KeyA")return g=(g+S.length-1)%S.length,R(),!0;if(t==="ArrowRight"||t==="KeyD")return g=(g+1)%S.length,R(),!0;if(t==="ArrowUp"||t==="KeyW")return g=Math.max(0,g-St()),R(),!0;if(t==="ArrowDown"||t==="KeyS")return g=Math.min(S.length-1,g+St()),R(),!0;if(t==="Enter"||t==="Space")return ce(),!0;const n=/^(?:Digit|Numpad)([1-9])$/.exec(t);if(n){const a=Number(n[1])-1;return a<S.length&&(g=a,R(),ce()),!0}return!0},tabs:()=>q.filter(t=>!Y.has(t.id)&&t.gear).map(t=>t.id),pages:()=>q.filter(t=>!Y.has(t.id)&&!t.gear).map(t=>t.id),tab:()=>M().id,setTab:t=>{const n=q.findIndex(a=>a.id===t);return n>=0&&de(n),M().id},filter:()=>k,setFilter:t=>(k=t,g=0,_e(),k),items:()=>S.map(t=>t.id),selected:()=>S[g]?S[g].id:null,equipped:()=>({...C}),noteEquipped(t,n){C[t]!==void 0&&(C[t]=n,y&&(Ze(),Xe()))}}}export{ei as createInventory};
