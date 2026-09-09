// generated from lookbooks/rider/design/outfits.json by the 0037/seed converter — shell house(s): POI-LAB, Ornis, Duetto, Ascent, Fjell
// palette: Lambert base colours (emissive = colour × 0.45 at runtime, spec §3); ops are op-space (outfits.md §2), verbatim.
export default [
{
  code: 'g00', house: "POI-LAB", name: "House Orange", family: 'shell',
  palette: { jacket: 0xff4d00, sleeve: 0x26231f, pants: 0x26231f, helmet: 0xf4f1ea, lens: 0x1a1c22, face: 0xf4f1ea, glove: 0x26231f, boot: 0x17161a, belt: 0x26231f, strap: 0x17161a, pole: 0x17161a, poleBand: 0x17161a },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false },
  ops: [],
},
{
  code: 'g02', house: "Ornis", name: "Solitude", family: 'shell',
  palette: { jacket: 0xb9c6cf, pants: 0x1d2433, helmet: 0x1d2433, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x1d2433, boot: 0x17161a, belt: 0x1d2433, strap: 0x1d2433, pole: 0x26231f, poleBand: 0x26231f },
  flags: { torso: "shell", helmet: "dome", hood: true, chinBar: false, visor: false, guards: false, spine: false, belt: false, hem: "hip" },
  ops: [
    ["mark","chestFront","bird",70,30,14,"#1d2433"],
    ["mark","back","bird",48,28,24,"#1d2433"]
  ],
},
{
  code: 'g04', house: "Duetto", name: "Kombat Blue", family: 'shell',
  palette: { jacket: 0x1636a8, pants: 0x1636a8, helmet: 0xf6f8f8, lens: 0x1a1c22, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x1636a8, strap: 0x1636a8, pole: 0x17161a, poleBand: 0x17161a, tape: 0xf4f1ea },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false },
  ops: [
    ["tape","sleeveL",12,"#f4f1ea","DUET","#1636a8"],
    ["mirror","sleeveL","sleeveR"],
    ["tape","legL",12,"#f4f1ea","DUET","#1636a8"],
    ["mirror","legL","legR"],
    ["mark","chestFront","duet",70,30,14,"#f4f1ea"],
    ["text","back","DUETTO",48,24,14,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g12', house: "Ascent", name: "Finish Parka", family: 'shell',
  palette: { jacket: 0xd52b1e, pants: 0x17161a, helmet: 0xf6f8f8, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x17161a, boot: 0x17161a, belt: 0x17161a, strap: 0xd52b1e, pole: 0x17161a, poleBand: 0x17161a, accent: 0x1f7a4a, accent2: 0xf4f1ea },
  mats: { jacket: { metal: 0, rough: .88 } },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false,
    hem: "hip", collar: "stand" },
  ops: [
    ["hband","chestFront",0,18,"#1f7a4a"],
    ["hband","back",0,24,"#1f7a4a"],
    ["hband","sleeveL",0,16,"#1f7a4a"],
    ["mirror","sleeveL","sleeveR"],
    ["cross","chestFront",70,44,9,4,"#f4f1ea"],
    ["mark","chestFront","dart3up",24,44,13,"#f4f1ea"],
    ["text","back","ASCENT",48,62,14,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g13', house: "Fjell", name: "Kvitfjell", family: 'shell',
  palette: { jacket: 0x1b2a4a, pants: 0x1b2a4a, helmet: 0x1b2a4a, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x1b2a4a, boot: 0x17161a, belt: 0x1b2a4a, strap: 0xc8102e, pole: 0x17161a, poleBand: 0x17161a, accent: 0xc8102e },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false, hem: "long" },
  ops: [
    ["hband","chestFront",40,48,"#c8102e"],
    ["hband","back",40,48,"#c8102e"],
    ["mark","chestFront","ring",70,27,8,"#f4f1ea"],
    ["text","back","FJELL",48,24,14,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g19', house: "Duetto", name: "Corsa", family: 'shell',
  palette: { jacket: 0x121216, pants: 0x121216, helmet: 0x121216, lens: 0xd8102a, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x121216, strap: 0x121216, pole: 0x17161a, poleBand: 0x17161a, tape: 0xd8102a },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false },
  ops: [
    ["tape","sleeveL",12,"#d8102a","DUET","#121216"],
    ["mirror","sleeveL","sleeveR"],
    ["tape","legL",12,"#d8102a","DUET","#121216"],
    ["mirror","legL","legR"],
    ["mark","chestFront","duet",70,30,14,"#d8102a"],
    ["text","back","CORSA",48,24,14,"#d8102a",{"track":2}]
  ],
},
{
  code: 'g20', house: "Duetto", name: "Village Sherpa", family: 'shell',
  palette: { jacket: 0x17223f, pants: 0x17223f, helmet: 0x17223f, lens: 0x2b3340, face: 0xf4f1ea, glove: 0xc8102e, boot: 0x17161a, belt: 0x17223f, strap: 0xf4f1ea, pole: 0x17161a, poleBand: 0x17161a, accent: 0xc8102e, tape: 0xf4f1ea },
  mats: { jacket: { metal: 0, rough: .92 } },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false, puffy: true },
  ops: [
    ["hband","chestFront",0,26,"#c8102e"],
    ["hband","back",0,30,"#c8102e"],
    ["hband","sleeveL",0,30,"#c8102e"],
    ["tape","sleeveL",10,"#f4f1ea","DUET","#17223f"],
    ["mirror","sleeveL","sleeveR"],
    ["hatch","chestFront",0,26,96,102,4,"rgba(255,255,255,.07)",1],
    ["hatch","back",0,30,96,98,4,"rgba(255,255,255,.07)",1],
    ["mark","chestFront","duet",70,46,13,"#f4f1ea"]
  ],
},
];
