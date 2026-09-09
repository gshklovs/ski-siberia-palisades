// generated from lookbooks/rider/design/outfits.json by the 0037/seed converter — freeride house(s): Bootpack, Token
// palette: Lambert base colours (emissive = colour × 0.45 at runtime, spec §3); ops are op-space (outfits.md §2).
// 0037/fam-freeride polish on the baked body: the freeride torso is visible for op y 0–87 only (hem 0.99 m),
// the boot cuff swallows leg op y ≥ 107 — so chest marks sit at y ≈ 46 and the stacked hem band at 94–110.
export default [
{
  code: 'g06', house: "Bootpack", name: "Magma", family: 'freeride',
  palette: { jacket: 0x1e2226, pants: 0xc8501e, helmet: 0x17181a, lens: 0x3fa9c9, face: 0xf4f1ea, glove: 0x1e2226, boot: 0x17161a, belt: 0x0d7a6a, strap: 0xc8501e, pole: 0x17161a, poleBand: 0x17161a, beltEdge: 0xf4f1ea, beltBuckle: 0x2a9d8c },
  mats: { jacket: { metal: 0, rough: .9 }, pants: { metal: 0, rough: .9 } },
  flags: { torso: "bib", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: true,
    pants: "baggy", boot: "freeride" },
  ops: [
    ["poly","chestFront",[[34,0],[62,0],[58,88],[38,88]],"#c8501e"],
    ["straps","chestFront","#c8501e",6],
    ["straps","back","#c8501e",6],
    ["hband","chestFront",88,128,"#c8501e"],
    ["hband","back",88,128,"#c8501e"],
    ["text","chestFront","BTPK",48,46,7,"#3a1408",{"rot":90,"track":1}],
    ["hband","legL",94,110,"#963a16"],
    ["mirror","legL","legR"]
  ],
},
{
  code: 'g08', house: "Token", name: "Blackwood", family: 'freeride',
  palette: { jacket: 0x1d2433, pants: 0x6f8f4a, helmet: 0x17181a, lens: 0xffb020, face: 0xf4f1ea, glove: 0x1d2433, boot: 0x17161a, belt: 0x17161a, strap: 0x1d2433, pole: 0x17161a, poleBand: 0x17161a, beltEdge: 0xd8c39a, beltBuckle: 0x3a3a3a },
  mats: { jacket: { metal: 0, rough: .9 }, pants: { metal: 0, rough: .9 } },
  flags: { torso: "freeride", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: true,
    pants: "baggy", boot: "freeride" },
  ops: [
    ["mark","chestFront","tree",68,32,14,"#d8c39a"],
    ["hband","legL",94,110,"#4f6c33"],
    ["mirror","legL","legR"],
    ["text","back","TOKN",48,22,9,"#d8c39a",{"track":2}]
  ],
},
{
  code: 'g26', house: "Bootpack", name: "Rye", family: 'freeride',
  palette: { jacket: 0x1e2226, pants: 0xc2a878, helmet: 0x17181a, lens: 0xffb020, face: 0xf4f1ea, glove: 0x4d5638, boot: 0x17161a, belt: 0x17161a, strap: 0xc2a878, pole: 0x17161a, poleBand: 0x17161a, beltEdge: 0xd8c39a, beltBuckle: 0x3a3a3a },
  mats: { jacket: { metal: 0, rough: .9 }, pants: { metal: 0, rough: .9 } },
  flags: { torso: "bib", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: true,
    pants: "baggy", boot: "freeride" },
  ops: [
    ["poly","chestFront",[[34,0],[62,0],[58,88],[38,88]],"#c2a878"],
    ["straps","chestFront","#c2a878",6],
    ["straps","back","#c2a878",6],
    ["hband","chestFront",88,128,"#c2a878"],
    ["hband","back",88,128,"#c2a878"],
    ["text","chestFront","BTPK",48,46,7,"#5a4526",{"rot":90,"track":1}],
    ["hband","legL",94,110,"#9c8256"],
    ["rect","legL",14,40,12,30,"#b39a6b"],
    ["mirror","legL","legR"]
  ],
},
];
