// Siberia / the Palisades, Palisades Tahoe — the layout register.
//
// ============================================================================
// WORLD FRAME — ONE TRANSFORM, DECLARED HERE, USED BY EVERYTHING
// ============================================================================
//   projection : Web-Mercator (EPSG:3857) scaled to GROUND metres by cos(lat0)
//                x = (merc_x - merc_x0) * cos(lat0)
//                y = (merc_y - merc_y0) * cos(lat0)
//   origin     : 39.18375, -120.26625  — the exact centre of the dem-tight.tif
//                / aerial.jpg frame (they share their EPSG:3857 bbox to the
//                metre, per pois/siberia-palisades/frames.json), so imagery and
//                terrain register 1:1 with no resampling and no eyeballing.
//   z datum    : z = 0 at 2366.0 m ASL — the Siberia Express BASE terminal.
//                3DEP reads 2366.3 m at the OSM way's own base node.
//   axes       : ENU. +X east, +Y north, +Z up. `world.mjs` declares up:'z'
//                and the player converts (x,y,z)_ENU -> (x,z,-y)_three.
//   units      : metres.
//
// Residuals of this transform against the six tie points annotations.md
// publishes (work/bake.py prints them, work/anchors.json stores them):
//   max aerial-pixel error 0.7 px = 0.22 m; DEM elevation at all six within
//   +0.07 m of the stated value. The bundle's own registration residual against
//   the imagery is 1.6-7.5 m (mean 4.5), inside the aerial's stated 8.47 m
//   accuracy — that is the real error bar; 0.22 m is only the arithmetic.
// ============================================================================
//
// Everything below is either (a) baked straight out of the input bundle
// (runs-data.mjs <- siberia-runs.geojson + reverse-traverse.geojson), or
// (b) explicitly marked and justified in REPORT.md. No run geometry is drawn
// by hand anywhere in this build.

import { OSM_FEATURES, byName } from './runs-data.mjs';

export const ORIGIN_LAT = 39.18375, ORIGIN_LON = -120.26625, Z_DATUM = 2366.0;

// ---------------------------------------------------------------- anchors
// lat/lon from annotations.md's tie-point table, through the transform above.
// Z here is 3DEP at that point, relative to Z_DATUM.
export const A = {
  siberiaTop:   [-511.6, -109.8, 279.1],   // Siberia Express top     2645.1 m
  siberiaBase:  [ 494.4,  416.1,   0.3],   // Siberia Express base    2366.3 m
  headwallTop:  [  43.7, -152.2, 266.0],   // Headwall Express top    2632.0 m
  washeshuOsm:  [-292.5, -335.1, 332.7],   // Washeshu Peak OSM node  2698.7 m
  washeshuDem:  [-313.8, -373.9, 333.0],   // 3DEP high point         2699.0 m
  highCamp:     [ 102.7,  599.5,  59.4],   // Gold Coast Funitel top  2425.4 m
  goldCoastBase:[ 154.5,  472.3,  46.4],   // Gold Coast Express base 2412.4 m
};

// WASHESHU PEAK, and the one conflict in the bundle that had to be decided.
// OSM's peak node carries ele=2706 and the printed figure is 8,885 ft = 2708 m.
// USGS 3DEP lidar says 2699.0 m at a high point 40 m from the OSM node. This
// build is 3DEP everywhere, so the summit here is 2699.0 m and the published
// numbers are ~8 m high. (annotations.md and README.md both resolve it the same
// way; the lift's 0.2 m vertical agreement is what earns the DEM that trust.)
export const SUMMIT_M = 2699.0;

// ------------------------------------------------------------------- runs
// style drives the ground treatment, the colour read and the tree field:
//   bowl     open alpine basin — barely pulled, no corduroy, no tree cut.
//            Siberia Bowl, Sun Bowl, North Bowl are BASINS, not corridors.
//   groomed  corridor flattened toward its own smoothed profile, corduroy
//   traverse gentle graded lane
//   bench    the Reverse Traverse: hard pull + a dig, so it HOLDS a traverse
//   cat      narrow bench cut across the fall line (Yellow Trail)
//   chute    a narrow snow ribbon carved through the cliff's rock (the four
//            Palisades chutes). Cuts a groove in the rib field of cliff.mjs.
//   gully    The Slot: a snow ribbon with rock walls raised either side
//   glade    treed and skiable, thinned to spacing
//   sparse   OSM centreline carried, ground barely touched, NO invented art.
//            This is rule 8 made mechanical: Hogsback, Light Tower and Kitchen
//            Wall are here because the bundle has no coverage of their bodies.
//
// WIDTHS. work/widths.py walks each OSM vertex's normal on the anchor aerial's
// open/canopy mask, exactly the way the Red Dog pass did. In this sector that
// method REPORTS ITS OWN FAILURE and the failure is the finding: above ~2600 m
// there is no forest, so there is no corridor edge, so every probe runs to the
// 120 m cutoff. Runs are therefore split two ways and each carries its source:
//   MEASURED  — the walk terminated on both sides for a majority of vertices.
//               Only the lower, treed runs qualify.
//   ENVELOPE  — the walk saturated. The number is a DECLARED bowl/chute
//               envelope, not a measurement, and `widthSrc` says so.
// No width in this file is a bare guess; every one names where it came from.
const R = (o) => ({ inferred: false, sign: true, style: 'groomed', ...o });
const P = (n) => byName[n].pts;

export const RUNS = [
  // ---------------------------------------------------- the Siberia core
  R({ id: 'siberia-bowl', name: 'SIBERIA BOWL', diff: 'black', style: 'bowl',
      width: 120, widthSrc: 'ENVELOPE — aerial walk bounded on only 7/20 vertices ' +
        '(median 56.7 m) because the upper bowl has no treeline; the lower half ' +
        'that IS bounded reads 40-77 m. Carried at 120 m as the open basin views ' +
        '10/11/17/20 show, not as a cut lane.',
      pts: P('Siberia Bowl'), osmWay: 'way/249144516', hero: true }),
  R({ id: 'siberia-ridge-line', name: 'SIBERIA RIDGE LINE', diff: 'blue', style: 'traverse',
      width: 46, widthSrc: 'ENVELOPE — 0/6 vertices bounded, all six in open ground',
      pts: P('Siberia Ridge Line'), osmWay: 'way/553033657' }),
  R({ id: 'racers', name: 'RACERS', diff: 'blue', style: 'groomed',
      width: 42, widthSrc: 'ENVELOPE — 1/6 bounded; runs the treeline edge of the bowl',
      pts: P('Racers'), osmWay: 'way/553033599' }),
  R({ id: 'newport', name: 'NEWPORT', diff: 'blue', style: 'groomed',
      width: 46, widthSrc: 'ENVELOPE — 9/28 bounded, median 32.2 (p75 56.0); the ' +
        'bounded samples are all on its lower, treed half',
      pts: P('Newport'), osmWay: 'way/249144509' }),
  R({ id: 'yellow-trail', name: 'YELLOW TRAIL', diff: 'blue', style: 'cat',
      width: 44, widthSrc: 'MEASURED — aerial median 44.1 m, 8/9 vertices bounded, 8 in open',
      pts: P('Yellow Trail'), osmWay: 'way/553033654' }),

  // -------------------------------------------- the Palisades cliff chutes
  // The four OSM lines through the band. Chimney / Main / Extra are confirmed
  // by three sources each (OSM + the resort's own labels in view-16 + the
  // view-19 panorama) and get name boards. NATIONAL CHUTE is "probable" on two
  // weak votes (OSM, and the title of the clip views 1-7 come from) — it is
  // BUILT and NOT LABELLED. The other fifteen features view-19 names are
  // single-source: they are not features in this world at all, only rock.
  R({ id: 'chimney', name: 'CHIMNEY', diff: 'black', style: 'chute',
      width: 18, widthSrc: 'ENVELOPE — 1/6 bounded; chute width from view-5 (inside ' +
        'the chute, skis in frame) and view-16',
      pts: P('Chimney'), osmWay: 'way/1103347775' }),
  R({ id: 'main-chute', name: 'MAIN', diff: 'black', style: 'chute',
      width: 22, widthSrc: 'ENVELOPE — 1/7 bounded; from views 5, 16, 19, 20',
      pts: P('Main Chute'), osmWay: 'way/1103347933' }),
  R({ id: 'extra-chute', name: 'EXTRA', diff: 'black', style: 'chute',
      width: 20, widthSrc: 'ENVELOPE — 1/6 bounded; from views 5, 16, 19, 20',
      pts: P('Extra Chute'), osmWay: 'way/1103347934' }),
  R({ id: 'national-chute', name: 'NATIONAL CHUTE', diff: 'black', style: 'chute',
      width: 16, sign: false,
      widthSrc: 'ENVELOPE — 0/5 bounded; the narrowest of the four, from view-5, ' +
        'which is shot inside it',
      note: 'NAME IS PROBABLE (OSM + the POV clip title only) — built, deliberately unlabelled',
      pts: P('National Chute'), osmWay: 'way/1103347935' }),

  // ------------------------------------------------------- the east wall
  R({ id: 'the-slot', name: 'THE SLOT', diff: 'black', style: 'gully',
      width: 26, widthSrc: 'ENVELOPE — 3/13 bounded; the gully width is view-28, ' +
        'the frame that defines this line (a snow ribbon between two rock walls)',
      pts: P('The Slot'), osmWay: 'way/248622377' }),
  R({ id: 'headwall-face', name: 'HEADWALL FACE', diff: 'black', style: 'bowl',
      width: 90, widthSrc: 'MEASURED (weak) — aerial median 127.4 m on 3/7 bounded ' +
        'vertices; carried at 90 m, the open face of views 33/34',
      pts: P('Headwall Face'), osmWay: 'way/248622379' }),
  R({ id: 'north-bowl', name: 'NORTH BOWL', diff: 'black', style: 'bowl',
      width: 95, widthSrc: 'ENVELOPE — 1/5 bounded at 101.5 m; the basin of views 40/41',
      pts: P('North Bowl'), osmWay: 'way/553033659' }),

  // ------------------------------------------------------------ Sun Bowl
  R({ id: 'sun-bowl', name: 'SUN BOWL', diff: 'black', style: 'bowl',
      width: 110, widthSrc: 'ENVELOPE — 4/12 bounded, median 145.6 m; the open ' +
        'south-facing basin of view-38, carried at 110 m',
      pts: P('Sun Bowl'), osmWay: 'way/249144508' }),

  // --------------------------------------------- HONEST-SPARSE (rule 8)
  // These three keep their OSM geometry and get nothing else. Hogsback and
  // Light Tower: the supplement pass placed their HEADS (views 26/27/31/32 all
  // stand at the trailhead the three east-wall lines share) but no clip on the
  // channel descends either, checked against a 1,288-entry listing. Kitchen
  // Wall has ZERO photographic coverage of any kind. Building art on them would
  // be decoration, so there is none: centreline, a skiable surface, no signs,
  // no furniture, no sculpted rock beyond what 3DEP itself carries.
  R({ id: 'hogsback', name: 'HOGSBACK', diff: 'black', style: 'sparse',
      width: 46, sign: false, sparse: true,
      widthSrc: 'ENVELOPE — 1/9 bounded at 46.2 m',
      note: 'HONEST-SPARSE: head placed (views 26/27/31/32), body unphotographed',
      pts: P('Hogsback'), osmWay: 'way/248622441' }),
  R({ id: 'light-tower', name: 'LIGHT TOWER', diff: 'black', style: 'sparse',
      width: 34, sign: false, sparse: true,
      widthSrc: 'ENVELOPE — 4/15 bounded, median 104.0 m, wildly scattered; carried ' +
        'narrow because it is the steepest line on the wall (30.8 deg)',
      note: 'HONEST-SPARSE: head placed, body unphotographed. Steepest thing on the east wall',
      pts: P('Light Tower'), osmWay: 'way/887934094' }),
  R({ id: 'kitchen-wall', name: 'KITCHEN WALL', diff: 'black', style: 'sparse',
      width: 40, sign: false, sparse: true,
      widthSrc: 'ENVELOPE — 3/17 bounded; no photograph of this line exists in the bundle',
      note: 'HONEST-SPARSE: ZERO photographic coverage. OSM geometry only ' +
        '(way/1494112085, tagged piste:name= not name=)',
      pts: P('Kitchen Wall'), osmWay: 'way/1494112085' }),

  // ------------------------------------------------------ the bench itself
  // NOT AN OSM WAY. reverse-traverse.geojson is a least-cost path on 3DEP from
  // the Siberia Express top terminal east to the Headwall Express top terminal,
  // shipped by the scout with "confidence": "probable" and good to about
  // +/-30 m laterally. Its EXISTENCE is confirmed three ways (view-21's caption,
  // the resort's own Start Hike / Finish Hike labels in view-15, published
  // prose); only the alignment between the two endpoints is probable.
  // It is built as the skiable bench it is: 666 m, mean 7.0 deg, max 20.6 deg.
  R({ id: 'reverse-traverse', name: 'REVERSE TRAVERSE', diff: 'black', style: 'bench',
      width: 14, inferred: true, probable: true,
      widthSrc: 'ENVELOPE — the walk saturates on 414/419 raw vertices. 14 m is the ' +
        'shelf of view-21 (one skier crossing, two more dropping onto it)',
      note: 'DEM-derived, "probable", +/-30 m lateral',
      pts: P('Reverse Traverse') }),

  // ------------------------------------------------- context inside the frame
  // Named OSM pistes that fall inside the terrain frame but outside the sector.
  // No signs, no furniture — they exist so the bowl drains somewhere real.
  R({ id: 'gold-coast', name: 'GOLD COAST', diff: 'green', style: 'groomed',
      width: 53, sign: false, context: true,
      widthSrc: 'MEASURED — aerial median 53.2 m, 19/20 bounded', pts: P('Gold Coast') }),
  R({ id: 'gold-coast-face', name: 'GOLD COAST FACE', diff: 'blue', style: 'groomed',
      width: 46, sign: false, context: true,
      widthSrc: 'MEASURED — aerial median 45.5 m, 4/4 bounded', pts: P('Gold Coast Face') }),
  R({ id: 'easy-slider', name: 'EASY SLIDER', diff: 'green', style: 'groomed',
      width: 95, sign: false, context: true,
      widthSrc: 'MEASURED — aerial median 95.2 m, 8/11 bounded', pts: P('Easy Slider') }),
  R({ id: 'mainline', name: 'MAINLINE', diff: 'blue', style: 'groomed',
      width: 34, sign: false, context: true,
      widthSrc: 'MEASURED (weak) — median 18.2 m on 8/9 bounded, p75 91; carried at 34 m',
      pts: P('Mainline') }),
  R({ id: 'mystery', name: 'MYSTERY', diff: 'blue', style: 'glade',
      width: 30, sign: false, context: true,
      widthSrc: 'MEASURED — median 1.4 m, only 2/6 vertices in open ground: this line ' +
        'is UNDER CANOPY, so it is built as a glade at the pod glade convention',
      pts: P('Mystery') }),
  R({ id: 'emigrant', name: 'EMIGRANT', diff: 'blue', style: 'groomed',
      width: 40, sign: false, context: true,
      widthSrc: 'ENVELOPE — leaves the frame west; no reliable walk', pts: P('Emigrant') }),
  R({ id: 'cornice-bowl', name: 'CORNICE BOWL', diff: 'black', style: 'bowl',
      width: 80, sign: false, context: true,
      widthSrc: 'ENVELOPE — 1/4 bounded at 67.9 m; the runout of view-30', pts: P('Cornice Bowl') }),
];
export const runById = Object.fromEntries(RUNS.map((r) => [r.id, r]));

// ------------------------------------------------------------------ lifts
export const LIFTS = [
  {
    // OSM way 29414891 "Siberia Express", v4 last edited 2021-05-25.
    // A 2015 LEITNER-POMA DETACHABLE SIX-PACK that replaced a 1985 Poma quad on
    // the SAME corridor — which is why a way older than the rebuild is still the
    // right line, and the proof is metric: draping this geometry on 3DEP gives
    // 278.8 m of vertical against skiresort.com's published 279 m (0.07 %) and
    // 1167.8 m of slope length against two published figures of 1188 / 1172.6 m.
    // TERMINALS SIT EXACTLY ON THE OSM END NODES: 39.187488,-120.260520 (base,
    // 3DEP 2366.3 m) and 39.182764,-120.272179 (top, 3DEP 2645.1 m). Nothing is
    // nudged by eye.
    // 14 towers, 2,400 pph, 1,000 ft/min = 5.08 m/s (annotations.md landmarks).
    // 2400 pph / 6 seats = 400 chairs/h; at 5.08 m/s that is 45.7 m of spacing —
    // both numbers are published, not chosen.
    id: 'siberia-express', name: 'SIBERIA', osmWay: 29414891,
    pts: P('Siberia Express'),
    towers: 14, seats: 6, chairSpacing: 45.7, speed: 5.08, core: true, swath: 28,
    built: 2015, maker: 'LEITNER POMA',
  },
  {
    // OSM way for Headwall Express. Only its TOP TERMINAL is in this world, and
    // it is here because it is a landmark, not because the lift is: the terminal
    // shed with the dark rocky knoll behind it is the sector's crossroads,
    // photographed on three separate days by four separate clips (views 26, 31,
    // 32, 36, 40), and it is the EAST END OF THE REVERSE TRAVERSE. The line
    // itself climbs 533 m out of Squaw Creek from x = +1506, far outside the
    // frame, so it is clipped at the core edge and the cable simply leaves.
    id: 'headwall-express', name: 'HEADWALL', osmWay: null,
    pts: P('Headwall Express'), clipX: 690,
    towers: 6, seats: 6, chairSpacing: 46, speed: 5.0, core: false, swath: 26,
    topOnly: true,
  },
];

// ---------------------------------------------------- man-made kit register
// annotations.md, "fill kit": on the whole upper ridge the ONLY man-made
// objects are the signage and closure furniture. That is the entire list, and
// this is it — no invented buildings, no invented lodges, no invented fences.
// Each entry names the view it is built from.
export const RIDGE_KIT = [
  { id: 'sun-bowl-gate', kind: 'warningBoards', at: [10, -178], yaw: 200,
    view: 'view-37', note: 'rocky knoll carrying red warning signboards on timber posts ' +
      'with a rope line strung at its foot; skiers waiting' },
  { id: 'headwall-knoll-sign', kind: 'signboard', at: [30, -186], yaw: 20,
    view: 'view-26', note: 'the dark rocky Headwall summit knoll with its signboard, on ' +
      'the crest just above the top terminal' },
  { id: 'north-bowl-gate', kind: 'gate', at: [151, -124], yaw: 350,
    view: 'view-40', note: 'signboard post and a gate at the North Bowl entrance' },
  { id: 'headwall-apron-fence', kind: 'snowFence', at: [43.7, -152.2], yaw: 60,
    view: 'view-32', note: 'orange/red snow fencing along the Headwall terminal apron' },
  { id: 'traverse-sign-frame', kind: 'timberFrame', at: [-497, -117], yaw: 100,
    view: 'view-21', note: 'the timber sign frame at the left of the only ground ' +
      'photograph of the Reverse Traverse' },
];

// --------------------------------------------------------- the base block
// GOLD COAST / HIGH CAMP, at the frame's north edge. annotations.md: "the
// Funitel top terminal and lodge complex at 2425 m ... the biggest building in
// the frame (~90 m) and the thing that appears at the bottom of every shot
// taken from the bowl" (views 7, 14). Massing only — the aerial gives the
// footprint, and nothing in this bundle photographs the building close up, so
// it is a block, not a portrait.
export const BUILDINGS = [
  // [x, y, sx, sy, storeys, yawDeg, kind]
  [102.7, 599.5, 90, 34, 3, -6, 'lodge'],     // High Camp / Funitel top complex
  [ 60.0, 566.0, 40, 26, 2, -4, 'lodge'],
  [154.5, 472.3, 26, 16, 1, 12, 'hut'],       // Gold Coast Express base station hut
  [470.0, 430.0, 18, 12, 1, 20, 'hut'],       // Siberia Express base operator hut
];

// --------------------------------------------------------- terrain extents
// CORE holds everything skiable: the Siberia Express line end to end, the whole
// cliff band, Washeshu Peak, the east wall down to The Slot's runout, the
// Reverse Traverse and the Sun Bowl entrance.
// x1 = 850, not 700: THE SLOT runs out to x = 808, and the first cut stopped
// the stamp raster at x = 768 — which left an 11-16 m step where the gully
// walls simply ended. The headless ride hit it at 29 m/s, launched, and took
// the run's only respawn of the whole test set. A corridor must be inside the
// raster that carves it, end to end.
export const CORE = { x0: -640, x1: 850, y0: -470, y1: 540 };
export const TIGHT = { x0: -700, x1: 700, y0: -700, y1: 700 };        // dem-tight frame
export const WIDE = { x0: -1319.6, x1: 1880.4, y0: -1015.6, y1: 2184.4 };  // dem-wide frame
export const FAR_R = 15000;                                            // backdrop radius

// RIM — the soft end-of-data ring OUTSIDE the 3200 m dem-wide frame. Collidable,
// so leaving the wide frame is a long coast-out, never a fall through the floor.
export const RIM = { pad: 1100, step: 130, holdM: 700, riseM: 300 };

// THE CLIFF BOX. Everything cliff.mjs sculpts and everything terrain.mjs meshes
// at cliff resolution is inside this. It is the annotations.md band
// (lon -120.2718..-120.2646 at lat 39.180-39.183 = 621 m of easting) grown to
// carry Kitchen Wall east and the apron north, plus the east wall's own box.
export const CLIFF_BOX = { x0: -520, x1: 300, y0: -470, y1: 20 };
export const EAST_BOX = { x0: -20, x1: 460, y0: -350, y1: 90 };

export const inCoreBox = (x, y, pad = 0) =>
  x > CORE.x0 + pad && x < CORE.x1 - pad && y > CORE.y0 + pad && y < CORE.y1 - pad;
export const inBox = (B, x, y, pad = 0) =>
  x > B.x0 - pad && x < B.x1 + pad && y > B.y0 - pad && y < B.y1 + pad;

export { OSM_FEATURES, byName };
