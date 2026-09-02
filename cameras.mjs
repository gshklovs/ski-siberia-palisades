// Camera stations. Each match-view-N is posed at the reference photo of the
// same number in pois/siberia-palisades/photos/.
//
// GATE ORDER (COMPOSING rule 14): the two `palisades-face-from-foot` wides come
// FIRST — view-20 (SnowBrains 2014, the whole band from its foot with eight
// skiers on the crest for scale) and view-19 (the 2025 annotated panorama from
// further out, with a Siberia Express tower in frame to place the camera).
// Those two are independent sources fourteen months and eleven years apart of
// the same face from the same side; if the massing does not agree with them,
// nothing else in this build matters.

export function cameras(world) {
  const gz = world.terrainHeight;
  const L = world.landmarks;
  const at = (x, y, h) => [x, y, gz(x, y) + h];
  const TT = L.siberiaTop, BT = L.siberiaBase, HW = L.headwallTop, WP = L.washeshu;

  return {
    // ================= THE MASSING TRUTH — match these first ================
    // view-20: on the tracked apron under the wall, ~340 m out, looking S/SSE at
    // the main wall under the summit. The crest sits about a fifth down from the
    // top of frame; the apron fills the bottom half.
    // Scale check, done properly rather than by eye: the wall is 40 m and it
    // fills ~28 % of view-20's frame height, i.e. ~10.5 deg of a ~35 deg
    // vertical field, so the photographer stood about 40/tan(10.5) = 215 m out.
    // Also OFF the lift line — the first cut put this camera at (-205, +55),
    // which is directly under the Siberia Express cable, and a chair hung in
    // the top of the frame.
    // FRAMING, settled by proportion rather than by guessing a focal length.
    // The photograph's rock band is ~3.7 wide to 1 tall in frame; the built
    // band's crest-to-rock-foot relief along this bearing is 76 m (probed at
    // x = -268: crest z = 332 at y = -350, rock foot z = 256 at y = -260), so
    // the photograph is showing ~280 m of band, not the whole 621 m. The first
    // cut stood 295 m out and framed ~410 m; this stands 232 m out on the apron
    // and frames ~270 m, which is the same slice of wall.
    'match-view-20': {
      pos: at(-268, -118, 1.75), target: [-268, -335, 322], fov: 36, up: [0, 0, 1],
    },
    // view-19: further out on the bowl floor, ON the Siberia Express line (the
    // tower in the photo's corner is what places the camera), looking SW across
    // the whole 621 m band. Wider, flatter, the plateau skyline dead level.
    // view-19 is a STITCHED PANORAMA, ~100 deg of horizontal field, and no
    // rectilinear camera reproduces that framing — this is posed to the same
    // wall from the same side at the same apparent wall height, covering the
    // central ~270 m of the labelled span, and the REPORT says so.
    // ORIENTATION, settled against the bundle: README says view-19's
    // "left-to-right runs west -> east". It does not. Its labels put Extra
    // Chute LEFT of Main Chute, and in the OSM geometry Extra (x = -226) is
    // EAST of Main (x = -278); Chimney, the westernmost of the four, is the
    // feature the annotation puts off the frame's RIGHT. So view-19 reads
    // east -> west left to right, which is what a camera in the bowl looking
    // SOUTH at a north-facing wall must show. The camera below looks south.
    // Getting this backwards is the Eagle's Nest mirroring failure exactly.
    'match-view-19': {
      pos: at(-300, -60, 2.0), target: [-250, -340, 316], fov: 30, up: [0, 0, 1],
    },
    // view-18: the OFFICIAL second flight — the whole Washeshu / Palisades ridge
    // from the NORTH-EAST with Siberia Bowl below and the Sierra crest beyond.
    'match-view-18': {
      pos: at(420, 330, 300), target: [-300, -350, 300], fov: 42, up: [0, 0, 1],
    },

    // ===================== the official aerial pass ==========================
    // view-15: over the Siberia Express top terminal, the frame the resort put
    // its own Start Hike / Finish Hike labels on — i.e. the Reverse Traverse.
    'match-view-15': {
      pos: at(-560, 130, 210), target: [-260, -190, 280], fov: 46, up: [0, 0, 1],
    },
    // view-16: close on the cliff band with the resort's chute labels
    // (Extra / Tube-Box / Main / Chimney), looking S/SW and down.
    'match-view-16': {
      pos: at(-120, 90, 230), target: [-300, -320, 300], fov: 40, up: [0, 0, 1],
    },
    // view-17: aerial wide over the whole upper mountain — the bowl system,
    // the tree bands and the ridges. Massing and tree-pattern reference.
    'match-view-17': {
      pos: at(520, 560, 480), target: [-280, -280, 250], fov: 48, up: [0, 0, 1],
    },

    // ======================== the Siberia Bowl POV ===========================
    // view-9 — THE JOINT: from the top-terminal flat looking S/SE, the shed at
    // the foot of the dark rocky Washeshu knoll. The only ground frame in the
    // bundle that holds the lift and the cliff in one shot.
    // The "dark rocky knoll" here is NOT Washeshu Peak 400 m away — it is the
    // WEST END OF THE PALISADES BAND, which starts at x = -479, i.e. 33 m from
    // the top terminal (work/probe.py reads slope 39 deg and cliff weight 0.30
    // at (-478,-105)). That is what puts the shed "at the foot of" it in one
    // frame, and it is why this camera stands NW of the shed looking SE past it
    // rather than out at the summit.
    // Posed ON the line through the knoll and the shed, extended NW, so the
    // shed sits AT THE FOOT of the rock exactly as the caption says. The first
    // cut stood west of the terminal and put the knoll 20 deg to its right,
    // which is a different picture.
    'match-view-9': {
      pos: at(-531, -30, 2.0), target: [-497, -168, 288], fov: 55, up: [0, 0, 1],
    },
    // view-8: under the top-terminal canopy at the unload
    'match-view-8': {
      pos: at(TT[0] + 30, TT[1] + 14, 1.72), target: [TT[0], TT[1] - 1, TT[2] + 5.6],
      fov: 60, up: [0, 0, 1],
    },
    // view-10: dropping in at the top of Siberia Bowl looking ENE, with the
    // Palisades rock mass still in frame at the right
    // OFF the lift line: (-455,-75) is within a metre of the Siberia Express
    // corridor and a tower filled the left half of the first cut.
    'match-view-10': {
      pos: at(-438, -34, 1.72), target: [120, 380, 40], fov: 64, up: [0, 0, 1],
    },
    // view-11: upper bowl, open wind-textured snow, the far rim on the skyline
    'match-view-11': {
      pos: at(-300, 20, 1.72), target: [260, 420, 30], fov: 62, up: [0, 0, 1],
    },
    // view-12: mid bowl — a Siberia Express tower at the left and LAKE TAHOE on
    // the ENE horizon. The orientation frame for the whole bundle.
    // The bearing is not a guess: annotations.md puts Lake Tahoe on the ENE
    // horizon and terrain.mjs paints it at bearing 68 deg from north, 6-14 km
    // out, so this camera looks straight down that bearing from the middle of
    // the bowl. It is the orientation frame for the whole bundle.
    'match-view-12': {
      pos: at(-30, 160, 1.75), target: [2600, 1180, -30], fov: 58, up: [0, 0, 1],
    },
    // view-13: directly under the Siberia Express cable, rocky knoll behind at
    // upper left
    'match-view-13': {
      pos: at(180, 250, 1.72), target: [560, 470, 30], fov: 64, up: [0, 0, 1],
    },
    // view-14: the base terminal and the Gold Coast base flat
    'match-view-14': {
      pos: at(BT[0] - 60, BT[1] - 46, 1.72), target: [BT[0], BT[1] + 6, BT[2] + 6],
      fov: 58, up: [0, 0, 1],
    },

    // ===================== the cliff chain (views 1-7) =======================
    // view-1: walking the broad ridge east of the top terminal toward the cliff
    // — the ground view-15 labels "Start Hike".
    'match-view-1': {
      pos: at(-470, -125, 1.72), target: [-260, -230, 300], fov: 62, up: [0, 0, 1],
    },
    // view-3: standing on the cliff-top crest, the whole bowl beyond
    'match-view-3': {
      pos: at(-268, -300, 1.72), target: [60, 340, 60], fov: 62, up: [0, 0, 1],
    },
    // view-4: THE CLIFF FROM ABOVE — skiers on the crest, the snow horn and the
    // blocky ribs dropping away, the treed bowl beyond. The frame that welds the
    // on-cliff chain to all three wides through the ribs.
    // Stand ON the crest at its east end and look WEST along the band: the
    // ribs drop away to the right (north, into the bowl) and the crest runs on
    // ahead, which is the photograph's composition. The first cut stood on the
    // crest looking NNE straight down the bowl and put the rock at the frame's
    // right edge instead of under the camera.
    'match-view-4': {
      pos: at(-180, -378, 2.2), target: [-440, -330, 268], fov: 58, up: [0, 0, 1],
    },
    // view-5: inside the chute — steep snow between rock walls
    // INSIDE National Chute looking DOWN the throat, not out of its mouth at
    // the bowl: the first cut aimed 100 m past the chute's exit and framed the
    // basin instead of the two walls.
    'match-view-5': {
      pos: at(-183, -318, 1.72), target: [-172, -258, 246], fov: 66, up: [0, 0, 1],
    },
    // view-6: out of the chute onto the open apron under the cliff — standing on
    // the ground that fills the bottom half of view-20
    'match-view-6': {
      pos: at(-172, -170, 1.72), target: [180, 300, 40], fov: 64, up: [0, 0, 1],
    },

    // ========================== the lift chain ==============================
    // view-23: the entire Siberia Express lift line from below, towers and
    // chairs receding up the bowl
    'match-view-23': {
      pos: at(60, 180, 1.9), target: [TT[0], TT[1], TT[2] + 14], fov: 46, up: [0, 0, 1],
    },
    // view-24: the upper two-thirds of Siberia seen from High Camp, across the
    // basin — the only true side elevation of the bowl and the lift together
    'match-view-24': {
      pos: at(L.highCamp[0] + 10, L.highCamp[1] - 30, 22), target: [-350, -190, 270],
      fov: 44, up: [0, 0, 1],
    },
    // view-25: the top terminal on the ridge with distant peaks — the terminal
    // portrait this build's shed geometry is copied from
    'match-view-25': {
      pos: at(TT[0] + 132, TT[1] + 104, 58), target: [TT[0] - 24, TT[1] - 24, TT[2] + 8],
      fov: 40, up: [0, 0, 1],
    },

    // ======================= the east wall (26-30) ==========================
    // view-26: the dark rocky Headwall summit knoll with its signboard
    // The first cut stood 22 m from the Headwall shed and the terminal's own
    // name board filled the frame. This stands 95 m out on the crest, east of
    // the terminal, looking SW at the knoll and its signboard — which is what
    // the photograph is of.
    'match-view-26': {
      pos: at(96, -128, 1.72), target: [26, -192, HW[2] + 10], fov: 60, up: [0, 0, 1],
    },
    // view-27: THE TALUS FRAME — the ridge crest walked east, bare rubble in
    // late January, a big rock rib at the left, the valley and Sierra beyond
    'match-view-27': {
      pos: at(110, -128, 1.72), target: [420, -40, 190], fov: 64, up: [0, 0, 1],
    },
    // view-28: THE SLOT — a snow gully between two dark rock walls, opening onto
    // the mountains beyond
    // ON the gully floor, not 30 m out on the open slope beside it (the first
    // cut stood at (302,-68) with the corridor at y = -102 and the two walls
    // were simply not in frame). This sits on The Slot's own centreline looking
    // down the line at the bend, which is view-28's composition.
    'match-view-28': {
      pos: at(320, -107, 1.72), target: [442, -178, 186], fov: 62, up: [0, 0, 1],
    },
    // view-29: out of the gully, a skier against the rock wall at left
    // one pitch lower, still on The Slot, coming out of the gully
    'match-view-29': {
      pos: at(468, -104, 1.72), target: [610, 32, 20], fov: 62, up: [0, 0, 1],
    },

    // ==================== the Headwall terminal (31-36) =====================
    // view-31: under the Headwall Express top terminal canopy at the unload —
    // the EAST END of the Reverse Traverse
    'match-view-31': {
      pos: at(HW[0] + 26, HW[1] + 8, 1.72), target: [HW[0], HW[1], HW[2] + 5.4],
      fov: 62, up: [0, 0, 1],
    },
    // view-32: the terminal shed with the rocky knoll behind it, red fencing and
    // skiers for scale. Best ground frame of the traverse's east endpoint.
    'match-view-32': {
      pos: at(HW[0] + 32, HW[1] + 22, 1.9), target: [HW[0] - 18, HW[1] - 26, HW[2] + 9],
      fov: 56, up: [0, 0, 1],
    },
    // view-33: dropping the Headwall Face with chairs overhead, looking NE
    // across the whole valley — the widest horizon in the bundle
    'match-view-33': {
      pos: at(332, -18, 1.72), target: [1400, 800, 20], fov: 62, up: [0, 0, 1],
    },
    // view-36: BLUE SKY — the Headwall top with the snow-plastered rocky ridge,
    // the east end of the Washeshu / Palisades crest, running across frame
    'match-view-36': {
      pos: at(HW[0] + 62, HW[1] + 20, 1.72), target: [HW[0] - 120, HW[1] - 60, HW[2] + 30],
      fov: 60, up: [0, 0, 1],
    },

    // ========================== Sun Bowl (37-38) ============================
    // view-37: the Sun Bowl entrance gate — the rocky knoll with red warning
    // signboards and a rope line at its foot
    'match-view-37': {
      pos: at(38, -160, 1.72), target: [4, -196, gz(4, -196) + 2.4], fov: 52, up: [0, 0, 1],
    },
    // view-38: wide Sun Bowl looking S/SE, a long treed ridge across the frame
    'match-view-38': {
      pos: at(30, -215, 1.72), target: [520, -520, 60], fov: 60, up: [0, 0, 1],
    },

    // ========================== North Bowl (40-41) ==========================
    // view-40: dropping into North Bowl off the Headwall ridge — signboard post,
    // the rock crest at right, the Siberia basin opening below
    'match-view-40': {
      pos: at(140, -62, 1.9), target: [70, 700, 90], fov: 62, up: [0, 0, 1],
    },
    // view-41: North Bowl proper, the basin with tree bands and rock outcrops
    'match-view-41': {
      pos: at(128, -10, 1.72), target: [40, 700, 70], fov: 62, up: [0, 0, 1],
    },

    // ======================= the Reverse Traverse ===========================
    // view-21: the only ground photograph of the bench. UNPLACED in the bundle
    // by design — the pose here is the bench's own mid-point from
    // reverse-traverse.geojson, looking east along it with the cliff above and
    // right, which is the composition the caption describes. It is a
    // COMPOSITIONAL match, not a surveyed one, and is reported as such.
    // Stand ON the bench (the first cut stood 54 m north of it, on the open
    // apron, and the shelf was not in frame at all), at its west entrance,
    // looking EAST along it — so the cliff rock is above and to the RIGHT and
    // the timber sign frame of the photograph's left edge is where the kit
    // register puts it, which is the composition the caption describes.
    'match-view-21': {
      pos: at(-524, -132, 1.72), target: [-200, -222, 288], fov: 58, up: [0, 0, 1],
    },

    // ============================ top-downs =================================
    // exactly the 1400 m dem-tight / aerial.jpg frame, north up:
    // 2*1800*tan(21.29 deg) = 1400 m
    'match-aerial': { pos: [0, 0, 1800], target: [0, 0, 0], fov: 42.58, up: [0, 1, 0] },
    'topo-cliff': { pos: [-190, -230, 900], target: [-190, -230, 0], fov: 42, up: [0, 1, 0] },

    // ============================ first person ==============================
    'fp-spawn': { pos: at(TT[0] + 16, TT[1] + 8, 1.72), target: [WP[0] + 40, WP[1] + 60, 333], fov: 68, up: [0, 0, 1] },
    'fp-traverse-west': { pos: at(-470, -118, 1.72), target: [-200, -175, 250], fov: 68, up: [0, 0, 1] },
    'fp-traverse-mid': { pos: at(-300, -190, 1.72), target: [-40, -160, 268], fov: 68, up: [0, 0, 1] },
    'fp-under-cliff': { pos: at(-250, -215, 1.72), target: [-255, -320, 330], fov: 66, up: [0, 0, 1] },
    'fp-chute-throat': { pos: at(-192, -330, 1.72), target: [-180, -200, 200], fov: 70, up: [0, 0, 1] },
    'fp-crest': { pos: at(-235, -330, 1.72), target: [-200, -60, 210], fov: 68, up: [0, 0, 1] },
    'fp-bowl-mid': { pos: at(-220, 90, 1.72), target: [300, 430, 30], fov: 68, up: [0, 0, 1] },
    'fp-slot': { pos: at(330, -48, 1.72), target: [900, 320, 20], fov: 68, up: [0, 0, 1] },
    'fp-scree': { pos: at(150, -118, 1.72), target: [300, -70, 195], fov: 66, up: [0, 0, 1] },
    'fp-sun-gate': { pos: at(30, -166, 1.72), target: [6, -192, gz(6, -192) + 2.2], fov: 50, up: [0, 0, 1] },
    'fp-headwall-terminal': { pos: at(HW[0] + 40, HW[1] + 26, 1.72), target: [HW[0] - 2, HW[1] - 8, HW[2] + 6], fov: 58, up: [0, 0, 1] },
    'fp-top-terminal': { pos: at(TT[0] + 34, TT[1] + 20, 1.72), target: [TT[0] - 2, TT[1] - 2, TT[2] + 5.6], fov: 58, up: [0, 0, 1] },
    'fp-base-terminal': { pos: at(BT[0] - 34, BT[1] - 26, 1.72), target: [BT[0] + 2, BT[1] + 2, BT[2] + 5.6], fov: 58, up: [0, 0, 1] },
    'fp-run-sign': { pos: at(-486, -135, 1.62), target: [-497, -126, gz(-497, -126) + 2.0], fov: 34, up: [0, 0, 1] },

    // ============================== heroes ==================================
    'hero-palisades': { pos: at(-60, 260, 120), target: [-280, -320, 300], fov: 44, up: [0, 0, 1] },
    'hero-bowl': { pos: at(-620, 60, 200), target: [200, 400, 40], fov: 50, up: [0, 0, 1] },
    'hero-summit': { pos: at(-560, -560, 250), target: [-200, -240, 300], fov: 46, up: [0, 0, 1] },
    'hero-east-wall': { pos: at(560, -300, 220), target: [180, 80, 180], fov: 48, up: [0, 0, 1] },
    'hero-sector': { pos: at(760, 700, 620), target: [-260, -300, 260], fov: 44, up: [0, 0, 1] },
  };
}
