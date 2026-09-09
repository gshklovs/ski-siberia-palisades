// generated from lookbooks/rider/design/outfits.json by the 0037/seed converter — race house(s): Arakn, Tempo, Fjell, Borea, Ascent, Ember, Riva, Hochalm, Sette, Lark
// palette: Lambert base colours (emissive = colour × 0.45 at runtime, spec §3); ops are op-space (outfits.md §2).
// 0037/fam-race polish on the A1 bake (deviations from outfits.json are commented at the op):
//  - helmet marks sit at the temple (x 18, y 17) — on this rig the goggle band hides helmet y > ~26 and the
//    balaclava wedge hides x > ~34 from the side, so the authored (34..44, 30..40) spots never showed.
export default [
{
  code: 'g01', house: "Arakn", name: "Firebird", family: 'race',
  palette: { jacket: 0x121216, pants: 0x121216, helmet: 0xd8102a, lens: 0x3a3f4a, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x121216, strap: 0x121216, pole: 0x17161a, poleBand: 0x17161a, accent: 0xd8102a, accent2: 0xff6a78 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["poly","chestFront",[[0,0],[96,0],[96,20],[0,84]],"#d8102a"],
    ["poly","back",[[0,0],[96,0],[96,84],[0,20]],"#d8102a"],
    ["polys","chestFront",1984,5,8,16,"#ff6a78",[44,46,36,34]],
    ["rect","sleeveL",24,70,24,48,"#0c0c10"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#0c0c10"],
    ["mirror","legL","legR"],
    // 0037/o1 data fix: the two R-only ops were listed BEFORE their mirrors, which overwrote them (op order is paint order)
    ["poly","sleeveR",[[0,0],[64,0],[64,30],[0,44]],"#d8102a"],
    ["polys","legR",1985,4,7,13,"#2c2c34",[32,34,18,28]],
    ["text","chestFront","ARAKN",48,110,8,"#f4f1ea",{"track":2}],
    ["mark","helmetSide","cluster",18,17,11,"#f4f1ea"]
  ],
},
{
  code: 'g03', house: "Tempo", name: "Finlay", family: 'race',
  palette: { jacket: 0x121216, pants: 0x121216, helmet: 0xf6f8f8, lens: 0xffb020, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x121216, strap: 0x121216, pole: 0x17161a, poleBand: 0x17161a, accent: 0xffd400, anorak: 0x2f5d50 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true, anorak: true },
  ops: [
    ["poly","chestFront",[[0,24],[96,0],[96,40],[0,64]],"#ffd400"],
    ["poly","back",[[0,0],[96,24],[96,64],[0,40]],"#ffd400"],
    ["chev","chestFront",48,80,20,14,6,"#ffd400","down"],
    ["rect","sleeveL",24,70,24,48,"#0c0c10"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#0c0c10"],
    ["mirror","legL","legR"],
    ["text","chestFront","TEMPO",48,112,8,"#ffd400",{"track":2}],
    ["text","helmetSide","TEMPO",18,18,6,"#121216",{"track":1}]
  ],
},
{
  code: 'g05', house: "Fjell", name: "Nordlys", family: 'race',
  palette: { jacket: 0xc8102e, pants: 0xc8102e, helmet: 0xf6f8f8, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x0f1e46, boot: 0x17161a, belt: 0xc8102e, strap: 0xc8102e, pole: 0x17161a, poleBand: 0x17161a, accent: 0xf4f1ea, accent2: 0x0f1e46 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["poly","chestFront",[[96,0],[96,26],[0,96],[0,70]],"#f4f1ea"],
    ["poly","chestFront",[[96,26],[96,36],[0,106],[0,96]],"#0f1e46"],
    ["poly","back",[[0,0],[0,26],[96,96],[96,70]],"#f4f1ea"],
    ["poly","back",[[0,26],[0,36],[96,106],[96,96]],"#0f1e46"],
    ["poly","sleeveL",[[0,0],[64,0],[64,22],[0,30]],"#f4f1ea"],
    ["rect","sleeveL",24,70,24,48,"#7a0a1c"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#7a0a1c"],
    ["mirror","legL","legR"],
    ["text","chestFront","FJELL",48,116,8,"#f4f1ea",{"track":2}],
    ["text","helmetSide","FJ",18,18,10,"#c8102e",{"track":0,"weight":900}]
  ],
},
{
  code: 'g07', house: "Borea", name: "Optic", family: 'race',
  palette: { jacket: 0x17223f, pants: 0xe9f13a, helmet: 0xf6f8f8, lens: 0x1a1c22, face: 0xf4f1ea, glove: 0x17223f, boot: 0x17161a, belt: 0xe9f13a, strap: 0x17223f, pole: 0x17161a, poleBand: 0x17161a, accent: 0x9aa020 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false },
  ops: [
    ["tape","legL",2,"#b5bd25",null,null],
    ["hband","legL",108,128,"#9aa020"],
    ["poly","legL",[[29,0],[35,0],[34,26],[30,26]],"#17223f"],
    ["text","legL","BOREA",32,92,6,"#17223f",{"rot":90,"track":1}],
    ["mirror","legL","legR"],
    ["rect","sleeveL",24,70,24,48,"#0f1730"],
    ["mirror","sleeveL","sleeveR"],
    ["text","back","BOREA",48,22,9,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g11', house: "Ascent", name: "Helvetia", family: 'race',
  palette: { jacket: 0xd52b1e, pants: 0xd52b1e, helmet: 0xf6f8f8, lens: 0x2b3340, face: 0xf4f1ea, glove: 0xd52b1e, boot: 0x17161a, belt: 0xd52b1e, strap: 0xd52b1e, pole: 0x17161a, poleBand: 0x17161a, accent: 0xf4f1ea },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["poly","chestFront",[[48,10],[96,10],[96,34],[64,34],[64,72],[48,72]],"#f4f1ea"],
    ["poly","back",[[0,10],[48,10],[48,72],[32,72],[32,34],[0,34]],"#f4f1ea"],
    ["stroke","chestFront",[[8,0],[2,64],[10,128]],"#a01f14",2],
    ["stroke","back",[[88,0],[94,64],[86,128]],"#a01f14",2],
    ["rect","sleeveL",24,70,24,48,"#8a1a12"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#8a1a12"],
    ["mirror","legL","legR"],
    ["mark","chestFront","dart3up",22,100,10,"#f4f1ea"],
    ["text","back","ASCENT",48,100,8,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g14', house: "Ember", name: "Tre Kronor", family: 'race',
  palette: { jacket: 0x0f4dbf, pants: 0x0f4dbf, helmet: 0xf6f8f8, lens: 0xffb020, face: 0xf4f1ea, glove: 0x0f4dbf, boot: 0x17161a, belt: 0x0f4dbf, strap: 0x0f4dbf, pole: 0x17161a, poleBand: 0x17161a, accent: 0xffcc00 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["curve","chestFront",40,10,16,"#ffcc00"],
    ["curve","back",36,-8,16,"#ffcc00"],
    ["poly","sleeveL",[[0,12],[64,28],[64,44],[0,28]],"#ffcc00"],
    ["poly","sleeveR",[[0,28],[64,12],[64,28],[0,44]],"#ffcc00"],
    ["rect","sleeveL",24,70,24,48,"#0a3690"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#0a3690"],
    ["mirror","legL","legR"],
    ["text","chestFront","EMBER",48,104,8,"#ffcc00",{"track":2}],
    ["mark","helmetSide","ember",18,17,11,"#0f4dbf"]
  ],
},
{
  code: 'g15', house: "Riva", name: "Tricolore DH", family: 'race',
  palette: { jacket: 0x0b2f8a, pants: 0x0b2f8a, helmet: 0xf6f8f8, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x0b2f8a, boot: 0x17161a, belt: 0x0b2f8a, strap: 0x0b2f8a, pole: 0x17161a, poleBand: 0x17161a, accent: 0xf4f1ea, accent2: 0xd8102a },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false, pants: "slim" },
  ops: [
    ["curve","chestFront",46,8,14,"#f4f1ea"],
    ["curve","back",44,-6,14,"#f4f1ea"],
    ["rect","chestFront",0,96,44,32,"#d8102a"],
    ["rect","back",52,96,44,32,"#d8102a"],
    ["hband","legR",0,14,"#d8102a"],
    ["text","chestFront","RIVA",48,74,8,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g16', house: "Hochalm", name: "Rot-Weiss-Rot", family: 'race',
  palette: { jacket: 0xc8102e, pants: 0xc8102e, helmet: 0x17181a, lens: 0x3a3f4a, face: 0xf4f1ea, glove: 0x17181a, boot: 0x17161a, belt: 0xc8102e, strap: 0xc8102e, pole: 0x17161a, poleBand: 0x17161a, accent: 0xf4f1ea },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["hband","chestFront",34,52,"#f4f1ea"],
    ["hband","back",34,52,"#f4f1ea"],
    ["hband","sleeveL",22,34,"#f4f1ea"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","sleeveL",24,70,24,48,"#7a0a1c"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#7a0a1c"],
    ["mirror","legL","legR"],
    ["text","back","HOCHALM",48,92,8,"#f4f1ea",{"track":2}]
  ],
},
{
  code: 'g17', house: "Hochalm", name: "Yarrow", family: 'race',
  palette: { jacket: 0xe6318f, pants: 0xe6318f, helmet: 0x17181a, lens: 0xff8ac8, face: 0xf4f1ea, glove: 0x17181a, boot: 0x17161a, belt: 0xe6318f, strap: 0x17181a, pole: 0x17161a, poleBand: 0x17161a, accent: 0x17181a },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true },
  ops: [
    ["hband","chestFront",0,20,"#17181a"],
    ["hband","back",0,20,"#17181a"],
    ["hband","sleeveL",0,14,"#17181a"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","sleeveL",24,70,24,48,"#17181a"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#17181a"],
    ["mirror","legL","legR"],
    ["text","chestFront","HOCHALM",48,104,7,"#17181a",{"track":2}]
  ],
},
{
  code: 'g18', house: "Sette", name: "Azzurro", family: 'race',
  palette: { jacket: 0x0a3d91, pants: 0x0a3d91, helmet: 0x0a3d91, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x0a3d91, boot: 0x17161a, belt: 0x0a3d91, strap: 0x0a3d91, pole: 0x17161a, poleBand: 0x17161a, accent: 0x0c47a8, accent2: 0xd9dde3 },
  mats: { jacket: { metal: 0, rough: .55 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false,
    pants: "slim", shinGuards: true },
  ops: [
    ["hatch","chestFront",0,0,96,70,6,"#0c47a8",1],
    ["text","back","7",48,52,44,"#0c47a8",{"track":0,"weight":900}],
    ["text","chestFront","SETTE",70,26,6,"#d9dde3",{"track":1.5}],
    ["rect","sleeveL",24,70,24,48,"#08327a"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#08327a"],
    ["mirror","legL","legR"]
  ],
},
{
  code: 'g24', house: "Lark", name: "Hero", family: 'race',
  palette: { jacket: 0x121216, pants: 0x121216, helmet: 0xf6f8f8, lens: 0x2b3340, face: 0xf4f1ea, glove: 0x121216, boot: 0x17161a, belt: 0x121216, strap: 0xe01a2b, pole: 0xf4f1ea, poleBand: 0xe01a2b, accent: 0xe01a2b, poleGuards: 0xf4f1ea },
  mats: { jacket: { metal: 0, rough: .55 }, pole: { metal: .7, rough: .2 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: true, visor: false, guards: true, spine: false, belt: false,
    pants: "slim", goggles: "rimless", shinGuards: true, poleGuards: true },
  ops: [
    ["poly","chestFront",[[0,56],[96,100],[96,128],[0,128]],"#e01a2b"],
    ["poly","back",[[0,100],[96,56],[96,128],[0,128]],"#e01a2b"],
    ["hband","sleeveL",6,14,"#f4f1ea"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","sleeveL",24,70,24,48,"#0c0c10"],
    ["mirror","sleeveL","sleeveR"],
    ["rect","legL",6,72,20,46,"#0c0c10"],
    ["mirror","legL","legR"],
    ["mark","chestFront","lark",70,28,9,"#f4f1ea"],
    ["text","chestFront","LARK",48,44,9,"#f4f1ea",{"track":2}]
  ],
},
];
