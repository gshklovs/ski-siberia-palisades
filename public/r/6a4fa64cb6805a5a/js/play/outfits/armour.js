// armour family — houses Ovo, Saltvik, Gnar, Ion, Tempo, Ferrum (lookbooks/rider/design/outfits.md; polished by 0037/fam-armour, +g27 by specs/0040 §A).
// palette: Lambert base colours (emissive = colour × 0.45 at runtime, spec §3); ops are op-space (outfits.md §2).
// rider:spine samples back op x 38..58 as four blocks y 36.6-46.2/49.8-59.4/63-72.6/76.2-85.8 (gap 3.6):
// `plates back 48 37 86 4 22 c 3.6` paints one plate per block. helmet: x 0 brow, 64 back, y 0 crown, mirrored both sides.
export default [
{
  code: 'g09', house: "Ovo", name: "Hydrogen", family: 'armour',
  palette: { jacket: 0x17181a, pants: 0x17181a, helmet: 0xf6f8f8, lens: 0x3a4a63, face: 0xf4f1ea, glove: 0xf6f8f8, boot: 0x17161a, belt: 0x17181a, strap: 0xff5a1f, pole: 0x17161a, poleBand: 0x17161a, strapTick: 0xf6f8f8 },
  mats: { jacket: { metal: .35, rough: .35 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: true, belt: false,
    pants: "slim", shinGuards: true, pauldrons: true, chestPlate: true, hipPlate: true },
  ops: [
    ["text","helmetSide","OVO",28,27,11,"#17181a",{"track":1,"weight":900}],
    ["plates","back",48,37,86,4,22,"#2b2c31",3.6],
    ["plates","sleeveL",32,70,118,1,24,"#2b2c31",0],
    ["mirror","sleeveL","sleeveR"],
    ["plates","legL",16,70,118,1,22,"#2b2c31",0],
    ["mirror","legL","legR"]
  ],
},
{
  code: 'g21', house: "Saltvik", name: "Volata", family: 'armour',
  palette: { jacket: 0x0f1e46, pants: 0x0f1e46, helmet: 0xf4f1ea, lens: 0xffb020, face: 0xf4f1ea, glove: 0x0f1e46, boot: 0x17161a, belt: 0x0f1e46, strap: 0x0f1e46, pole: 0x17161a, poleBand: 0x17161a, accent: 0xffd400 },
  mats: { jacket: { metal: .2, rough: .4 }, helmet: { metal: .25, rough: .25 } },
  flags: { torso: "race", helmet: "facet", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", shinGuards: true, pauldrons: true },
  ops: [
    ["hband","helmetSide",0,7,"#17181a"],
    ["poly","helmetSide",[[22,10],[58,10],[62,38],[42,50],[24,40]],"#ffd400"],
    ["poly","chestFront",[[0,0],[96,0],[96,22],[0,78]],"#ffd400"],
    ["poly","back",[[0,0],[96,0],[96,78],[0,22]],"#ffd400"],
    ["plates","sleeveL",32,70,118,1,24,"#08122e",0],
    ["mirror","sleeveL","sleeveR"],
    ["plates","legL",16,70,118,1,22,"#08122e",0],
    ["mirror","legL","legR"],
    ["text","chestFront","SALTVIK",48,110,7,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g22', house: "Gnar", name: "Second Skin", family: 'armour',
  palette: { jacket: 0x2a2a30, pants: 0x2a2a30, helmet: 0x17181a, lens: 0x9dff00, face: 0xf4f1ea, glove: 0x17181a, boot: 0x17161a, belt: 0x2a2a30, strap: 0x17181a, pole: 0x17161a, poleBand: 0x17161a, accent: 0x9dff00, accent2: 0x0c0c0e },
  mats: { jacket: { metal: .35, rough: .35 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: true, belt: false,
    pants: "slim", shinGuards: true, pauldrons: true, chestPlate: true },
  ops: [
    ["rect","back",40,37,16,49,"#9dff00"],
    ["plates","back",48,37,86,4,22,"#0c0c0e",3.6],
    ["plates","sleeveL",32,70,118,1,24,"#0c0c0e",0],
    ["mirror","sleeveL","sleeveR"],
    ["plates","legL",16,70,118,1,22,"#0c0c0e",0],
    ["mirror","legL","legR"],
    ["text","chestFront","GNAR",48,60,12,"#9dff00",{"track":2,"weight":900}]
  ],
},
{
  code: 'g23', house: "Ion", name: "Live Shield", family: 'armour',
  palette: { jacket: 0x3a3f46, pants: 0x1e2226, helmet: 0x17181a, lens: 0x3fa9c9, face: 0xf4f1ea, glove: 0x1e2226, boot: 0x17161a, belt: 0x1e2226, strap: 0x17181a, pole: 0x17161a, poleBand: 0x17161a, accent: 0x19c3d8, accent2: 0x0c0c0e },
  mats: { jacket: { metal: .35, rough: .35 }, lens: { glow: .7 } },
  flags: { torso: "jacket", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: true, belt: false,
    pauldrons: true, chestPlate: true, hipPlate: true },
  ops: [
    ["straps","chestFront","#0c0c0e",8],
    ["mark","chestFront","ring",48,70,8,"#19c3d8"],
    ["rect","back",20,8,56,96,"#0c0c0e"],
    ["plates","back",48,13,33,1,44,"#1e2126",0],
    ["plates","back",48,37,86,1,44,"#1e2126",0],
    ["plates","back",48,90,100,1,44,"#1e2126",0],
    ["text","back","ION",48,23,10,"#19c3d8",{"track":2,"weight":900}]
  ],
},
{
  code: 'g25', house: "Tempo", name: "Impact", family: 'armour',
  palette: { jacket: 0x121216, pants: 0x17223f, helmet: 0x17181a, lens: 0x3a3f4a, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x17223f, strap: 0x121216, pole: 0x17161a, poleBand: 0x17161a, accent: 0x34343b },
  mats: { jacket: { metal: .35, rough: .35 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: true, belt: false,
    pants: "slim", pauldrons: true, chestPlate: true, hipPlate: true },
  ops: [
    ["plates","sleeveL",32,0,22,1,32,"#34343b",0],
    ["plates","sleeveL",32,66,116,1,24,"#34343b",0],
    ["hatch","sleeveL",16,0,32,22,4,"#1c1c21",1],
    ["hatch","sleeveL",20,66,24,50,4,"#1c1c21",1],
    ["mirror","sleeveL","sleeveR"],
    ["plates","back",48,37,86,4,22,"#34343b",3.6],
    ["hatch","back",37,37,22,49,4,"#1c1c21",1],
    ["text","chestFront","TEMPO",48,30,8,"#8a8a92",{"track":2}]
  ],
},
// specs/0040 §A, repainted by specs/0044 §B — a suit of plates, not a red onesie.
// The two reds swap roles: the prefill is the DEEP underlayer (torso sides, inner
// arms, hips, every gap) and each bright block is a plate painted on top. Gold is
// still a bed, never an outline — the gold beds are 26 op-px and the `plates` on
// them 20, so 3 px of gold shows each side and in every gap (§B.1's wider trim).
// 18 ops; §B.4 raises this look's cap from 14.
// The helmet inverts: gold is the palette base and the red shell is op 1.
// gen_rider.py builds the chin bar and visor from `swatch_uv('helmet')` — one
// texel of the swatch HELMET CELL, not the `helmetSide` region — so nothing can
// gild the chin-bar strip while `palette.helmet` is red. Gold there buys the chin
// bar, the faceplate and the cell at once; `face` was already gold, so brow → jaw
// is one gold mass (§B.2). The locker's helmet chip is that gold, not the shell.
// Text lives on `back` only — helmetSide mirrors and would read backwards on the
// rider's left (the 0037 leftover); the chest carries the reactor, not a wordmark.
{
  code: 'g27', house: "Ferrum", name: "Reactor", family: 'armour',
  // specs/0044 §B's Ferrum "Reactor" palette (deep 0x6e0c10 underlayer, gold
  // 0xe0b04a plates, helmet and face) rides in from rider/v2 with the 18 ops
  // below; specs/0045 K5's `mats` and the kit `flags` are v3's and stay.
  palette: { jacket: 0x6e0c10, pants: 0x6e0c10, helmet: 0xe0b04a, lens: 0xbfefff, face: 0xe0b04a, glove: 0xe0b04a, boot: 0xe0b04a, strap: 0x6e0c10, pole: 0x1c1c22, poleBand: 0xe0b04a, poleGuards: 0xe0b04a, accent: 0xe0b04a, accent2: 0xbfefff },
  mats: { jacket: { metal: .85, rough: .25 }, helmet: { metal: .9, rough: .15 }, glove: { metal: .8, rough: .25 }, boot: { metal: .8, rough: .25 }, lens: { glow: 1 } },
  flags: { torso: "race", helmet: "facet", hood: false, chinBar: true, visor: false, guards: true, spine: true, belt: false,
    pants: "slim", shinGuards: true, poleGuards: true, pauldrons: true, hipPlate: true, kitFerrum: true },
  ops: [
    ["poly","helmetSide",[[0,0],[64,0],[64,64],[20,64],[28,45],[24,25],[0,21]],"#c4181f"],
    ["hband","helmetSide",0,12,"#e0b04a"],
    ["rect","helmetSide",2,30,21,3,"#bfefff"],
    ["rect","helmetSide",0,35,24,1,"#6e0c10"],
    ["poly","chestFront",[[10,4],[86,4],[80,88],[48,100],[16,88]],"#c4181f"],
    ["chev","chestFront",48,34,32,9,3,"#e0b04a","down"],
    ["poly","chestFront",[[35,40],[61,40],[48,66]],"#e0b04a"],
    ["poly","chestFront",[[40,44],[56,44],[48,60]],"#bfefff"],
    ["poly","back",[[38,8],[48,2],[58,8],[58,30],[61,34],[61,87],[35,87],[35,34],[38,30]],"#e0b04a"],
    ["plates","back",48,37,86,4,20,"#6e0c10",3.6],
    ["text","back","FERRUM",48,102,9,"#e0b04a",{"track":2,"weight":900}],
    ["rect","sleeveL",19,20,26,99,"#e0b04a"],
    ["poly","sleeveL",[[0,0],[64,0],[64,18],[46,25],[18,25],[0,18]],"#c4181f"],
    ["plates","sleeveL",32,29,118,2,20,"#c4181f",6],
    ["mirror","sleeveL","sleeveR"],
    ["vstripe","legL",3,29,"#e0b04a"],
    ["plates","legL",16,4,118,2,20,"#c4181f",8],
    ["mirror","legL","legR"]
  ],
},
{
  code: 'g31', house: "Umbra", name: "Lord", family: 'armour',
  palette: { jacket: 0x0c0c0e, pants: 0x0c0c0e, sleeve: 0x141416, helmet: 0x0a0a0c, lens: 0x1a0a0a, face: 0x2a2b30, glove: 0x0a0a0c, boot: 0x0a0a0c, belt: 0x141416, beltBuckle: 0x8a8d94, strap: 0x0a0a0c, pole: 0x0a0a0c, poleBand: 0x8a8d94, accent: 0x8a8d94, accent2: 0xd42a2a },
  mats: { jacket: { metal: .1, rough: .55 }, helmet: { metal: .35, rough: .08 }, lens: { glow: .8 } },
  flags: { torso: "race", helmet: "helm", hood: false, chinBar: true, visor: false, guards: true, spine: false, belt: true,
    pants: "slim", goggles: "none", poleGuards: true, pauldrons: true, beltBoxes: true, mask: true, kitUmbra: true },
  ops: [
    ["rect","chestFront",37,34,22,14,"#8a8d94"],
    ["rect","chestFront",40,38,3,3,"#d42a2a"],
    ["rect","chestFront",46,38,3,3,"#2d7ef0"],
    ["rect","chestFront",52,38,3,3,"#3fc46a"],
    ["rect","chestFront",39,44,18,1,"#3a3d44"],
    ["rect","back",40,86,16,10,"#8a8d94"],
    ["plates","sleeveL",32,16,104,4,72,"#0a0a0c",18],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#141416"],
    ["mirror","legL","legR"],
    ["poly","helmetSide",[[0,40],[30,40],[8,64]],"#8a8d94"],
    ["hband","helmetSide",20,21,"#8a8d94"]
  ],
},
{
  code: 'g28', house: "Foundation", name: "Phantom", family: 'armour',
  palette: { jacket: 0x15171b, pants: 0x15171b, helmet: 0x0e0f12, lens: 0x0b0c0e, face: 0x15171b, glove: 0x15171b, boot: 0x0b0c0e, belt: 0x15171b, strap: 0x0b0c0e, pole: 0x2b2f36, poleBand: 0xa8b0ba, accent: 0xa8b0ba, accent2: 0xe8eef2 },
  mats: { jacket: { metal: .3, rough: .45 }, helmet: { metal: .4, rough: .4 }, face: { glow: .9 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", head: "robot", goggles: "none", kitPhantom: true },
  ops: [
    ["rect","helmetSide",0,20,22,32,"#2b2f36"],
    ["rect","helmetSide",0,27,6,24,"#e8eef2"],
    ["poly","chestFront",[[10,24],[86,24],[80,100],[48,114],[16,100]],"#2b2f36"],
    ["poly","chestFront",[[6,2],[90,2],[90,20],[62,26],[48,34],[34,26],[6,20]],"#a8b0ba"],
    ["mark","chestFront","ring",48,66,14,"#0b0c0e"],
    ["poly","chestFront",[[48,38],[52,48],[48,56],[44,48]],"#e8eef2"],
    ["poly","back",[[6,2],[90,2],[90,24],[48,32],[6,24]],"#2b2f36"],
    ["text","back","FOUNDATION",48,54,7,"#a8b0ba",{"track":2}],
    ["mark","sleeveL","ring",32,16,22,"#0b0c0e"],
    ["rect","sleeveL",24,70,24,44,"#a8b0ba"],
    ["mirror","sleeveL","sleeveR"],
    ["hband","legL",60,68,"#0b0c0e"],
    ["rect","legL",6,74,22,42,"#a8b0ba"],
    ["mirror","legL","legR"]
  ],
},
{
  // specs/0040 §D — the ducal desert house: black-green dress suit, stillsuit limbs, red hawk crest.
  // The crest is the mark, so nothing is written on the chest; `DUKE` sits on `back` (helmetSide text
  // reads mirrored on the rider's left, REPORT-0037 leftover 1). Sand piping owns the outer leg seam
  // (op x 32), so the leg's tube line is the piping — 14 ops is the §D cap.
  code: 'g29', house: "Duke", name: "Hawk", family: 'armour',
  palette: { jacket: 0x1c2622, sleeve: 0x2b2f2a, pants: 0x1a1f1c, helmet: 0x15181a, lens: 0x2a2a2a, face: 0xd9b48a, glove: 0x2b2f2a, boot: 0x141414, belt: 0x0f0f0f, strap: 0x15181a, pole: 0x2a2a30, poleBand: 0x8a1c1c, accent: 0xb3161b, accent2: 0x8a7a55 },
  mats: { jacket: { metal: .05, rough: .7 }, belt: { metal: .5, rough: .35 } },
  flags: { torso: "race", helmet: "dome", hood: true, chinBar: false, visor: false, guards: false, spine: false, belt: true,
    pants: "slim", collar: "stand", kitDuke: true },
  ops: [
    ["hband","chestFront",0,4,"#8a7a55"],
    ["hband","back",0,4,"#8a7a55"],
    ["poly","chestFront",[[44,18],[48,10],[52,18],[78,22],[68,34],[54,34],[48,56],[42,34],[28,34],[18,22]],"#b3161b"],
    ["hband","sleeveL",34,38,"#1c2622"],
    ["hband","sleeveL",62,66,"#1c2622"],
    ["hband","sleeveL",90,94,"#1c2622"],
    ["rect","sleeveL",44,0,3,128,"#1c2622"],
    ["mirror","sleeveL","sleeveR"],
    ["hband","legL",40,44,"#2b2f2a"],
    ["hband","legL",72,76,"#2b2f2a"],
    ["hband","legL",104,108,"#2b2f2a"],
    ["rect","legL",30,0,4,128,"#8a7a55"],
    ["mirror","legL","legR"],
    ["text","back","DUKE",48,22,9,"#8a7a55",{"track":2}]
  ],
},
];
