# Attribution

The MIT licence in `LICENSE` covers the **code**. The **data** this code renders
is licensed separately, and those licences are listed here.

## Terrain — USGS 3DEP

Elevation is the U.S. Geological Survey's 3D Elevation Program (3DEP)
lidar-derived DEM, baked into `public/scene/dem-data.mjs` as two frames: a tight
1400 m frame at its full native 1.3672 m/px, and a wider 3.1250 m/px surround.
Both read 100 % valid pixels over this sector — no voids, no fill. USGS 3DEP is a
work of the United States Government and is in the **public domain**.

> Terrain: U.S. Geological Survey, 3D Elevation Program.

## Trails and lifts — OpenStreetMap

Every run centreline and the Siberia Express lift line are derived from
OpenStreetMap, and the `osmWay` ids are carried through into
`public/scene/layout.mjs` so any geometry here can be traced back to the way it
came from. That includes the Palisades chutes — Main Chute, National Chute,
Extra Chute and Chimney — which are mapped as named `piste:type=downhill` ways.

OpenStreetMap data is licensed under the
[Open Data Commons Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
ODbL requires attribution to travel with the produced work, so this credit is
rendered **in the game** — on the intro card and in the pause panel — as well as
here:

> Trails and lifts © OpenStreetMap contributors, licensed under ODbL.

Derived geometry (the smoothed corridors, the piste stamp, the tree placement)
is a Produced Work under ODbL §4.5.

## What is *not* from a map

Two of this world's features have no upstream dataset at all, and are computed:

- **The Palisades cliff band and the east wall.** OpenStreetMap has no
  `natural=cliff` in this sector. `public/scene/cliff-data.mjs` is a field
  derived from 3DEP slope — a 621 m east–west band, 14–51 m of face at 29–63° —
  and the rock ribs are sculpted on top of it in code.
- **The Reverse Traverse.** Not in OSM. It is a least-cost path solved on the
  DEM from the Siberia Express top terminal east to the Headwall Express saddle:
  666 m, 2602.5–2646.4 m ASL.

Both are therefore derivatives of the public-domain 3DEP surface.

## Canopy

Tree cover in `public/scene/canopy-data.mjs` is per-cell density **statistics**
classified off a 2025-10-21 satellite scene of the sector. The imagery itself is
not redistributed and is not in this repository — what ships is numbers.

## three.js

Rendering is [three.js](https://threejs.org/) r180, MIT licensed,
© 2010–2025 three.js authors. It is vendored in `public/vendor/` rather than
loaded from a CDN, bundled and minified but otherwise unmodified.

## Names

*Palisades Tahoe*, *Siberia*, *Washeshu Peak*, *the Palisades*, *Sun Bowl*,
*Headwall*, *Olympic Valley* and the other run and lift names are used
**descriptively**, to identify the real places this terrain is a model of. Where
sources predating the 2021 rename say *Squaw Valley* or *Squaw Peak*, they mean
Palisades Tahoe and Washeshu Peak. This project is not affiliated with, endorsed
by, or sponsored by Palisades Tahoe or Alterra Mountain Company.

## What is *not* here

No photographs, no aerial imagery, no resort trail maps and no logos are
distributed with this repository. Every texture in the game is painted to a
`<canvas>` at runtime by code in `public/js/play/`. The forest, the rock and the
snow reads are derived from raster *statistics* baked to numbers — there is no
image file anywhere in `public/`.
