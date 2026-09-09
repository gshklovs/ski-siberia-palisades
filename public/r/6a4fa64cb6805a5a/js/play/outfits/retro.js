// generated from lookbooks/rider/design/outfits.json by the 0037/seed converter — retro house(s): Hotdogger, Goat-Mentor
// palette: Lambert base colours (emissive = colour × 0.45 at runtime, spec §3); ops are op-space (outfits.md §2), verbatim.
export default [
{
  code: 'g10', house: "Hotdogger", name: "Fresh", family: 'retro',
  palette: { jacket: 0xff2fa0, pants: 0x19c3d8, helmet: 0xffe600, lens: 0xff8a00, face: 0xf4f1ea, glove: 0xffe600, boot: 0xf4f1ea, belt: 0x2a1c5a, strap: 0x2a1c5a, pole: 0xf4f1ea, poleBand: 0xf4f1ea, accent: 0xffe600, beltEdge: 0xffe600, beltBuckle: 0xffe600 },
  mats: { jacket: { metal: 0, rough: .6 } },
  flags: { torso: "race", helmet: "cap", hood: false, chinBar: false, visor: true, guards: false, spine: false, belt: true,
    pants: "baggy", bloused: true },
  ops: [
    // hips (rider:hips, torso v > 0.78) paint from chestFront/back: cyan below the belt so the belt is the split
    ["hband","chestFront",99,128,"#19c3d8"],
    ["hband","back",99,128,"#19c3d8"],
    ["zig","chestFront",56,14,4,8,"#ffe600"],
    ["zig","back",56,14,4,8,"#ffe600"],
    ["hband","sleeveL",40,52,"#19c3d8"],
    ["hband","sleeveL",52,60,"#ffe600"],
    ["mirror","sleeveL","sleeveR"],
    ["hband","legL",22,34,"#ff2fa0"],
    ["hband","legL",34,40,"#ffe600"],
    ["mirror","legL","legR"],
    ["text","back","HOTDOG",48,22,9,"#ffe600",{"track":2}]
  ],
},
{
  // specs/0040 §E — one colour, no marks: every wearable key is 0xff0066, only the
  // lens and the face keep their own tone. ops: [] so the prefill IS the look.
  code: 'g30', house: "Goat-Mentor", name: "Suit", family: 'retro',
  palette: { jacket: 0xff0066, pants: 0xff0066, sleeve: 0xff0066, helmet: 0xff0066, lens: 0x1a1c22, face: 0xf4f1ea, glove: 0xff0066, boot: 0xff0066, belt: 0xff0066, strap: 0xff0066, pole: 0xff0066, poleBand: 0xff0066 },
  mats: { jacket: { metal: 0, rough: .75 } },
  flags: { torso: "race", helmet: "dome", hood: false, chinBar: false, visor: false, guards: false, spine: false, belt: false, pants: "slim" },
  ops: [],
},
];
