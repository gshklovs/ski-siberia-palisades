# Siberia Express

Ski **Siberia** and **the Palisades** at Palisades Tahoe, in a browser tab. No
install, no account, no loading a 200 MB game.

You unload at the top of the Siberia Express, at the west end of the Reverse
Traverse, facing the dark rock of Washeshu Peak. Press **W**.

**→ [play it](https://ski-siberia-palisades.vercel.app)**

---

## Controls

| | |
|---|---|
| `W A S D` | move — on skis, `A`/`D` carve and `S` snowplows |
| `MOUSE` | look |
| `← →` | spin, in the air |
| `SPACE` | jump |
| `SHIFT` | sprint / brake |
| `C` | camera — first person ↔ chase |
| `F` | ride the chairlift, standing at the base terminal |
| `R` | respawn |
| `ESC` | pause |

On a phone: drag the **left** half to carve, the **right** half to look, tap to
jump, swipe ← → in the air for spins.

---

## A note on the name

Since 2021 **Palisades Tahoe** is the name of the whole resort. In here, *the
Palisades* means only what it meant before that: the cliff band on the north
face of **Washeshu Peak**, above the Reverse Traverse. That rock is the reason
this world exists.

## What this actually is

The mountain is not modelled by hand. It is **measured**.

- **The ground is real.** Elevation is USGS 3DEP lidar, carried at its full
  native 1.37 m/px across the playable frame — no decimation, so the terrain
  function reproduces 3DEP exactly at every DEM sample and the only loss is
  Int16 decimetre quantisation (±0.05 m). It is that resolution that lets the
  Palisades survive meshing at all: at 1.37 m/px the DEM resolves the
  escarpment's envelope, 14–51 m of face at 29–63°.
- **The runs are real.** Every centreline and the Siberia Express lift line are
  OpenStreetMap geometry, carried with their `osmWay` ids — Siberia Bowl,
  Siberia Ridge Line, Racers, Newport, The Slot, Headwall Face, Hogsback, Light
  Tower, Sun Bowl, North Bowl, and the chutes themselves: Main, National, Extra
  and Chimney.
- **The Reverse Traverse is derived.** OSM does not have it, so it is a
  least-cost path on the DEM from the Siberia Express top terminal east to the
  Headwall Express saddle — 666 m at a mean gradient of about −2 %.
- **The rock is derived too.** OSM has no `natural=cliff` anywhere in this
  sector, so the cliff and scree field is computed from DEM slope and sculpted
  in code. There is no rock texture; there is no rock mesh anybody drew.
- **The trees are real-ish.** Canopy density is read off a satellite scene and
  classified per cell, so where the photograph shows a glade, there is a glade.

Total download: about 2 MB compressed. It is a static site — there is no server.

## Tech notes

- three.js r180, vendored (never a CDN), bundled and minified.
- ES modules + an importmap. No build step to run it: `npm run dev` is just a
  static file server.
- Zero network calls after the initial load. Zero image assets — every texture
  is painted to a `<canvas>` at runtime.
- The terrain, the collision floor and the physics all read **one** height
  function, so there is nothing you can see that you cannot stand on, and no
  invisible wall anywhere.
- Ski off the edge of the world and the ground quietly runs out; you are put
  back at the top. There is no boundary to hit.

Generated from a private research repo (`poi-lab`) by one script, from commit
`ccddce5f65` on `2026-09-02T19:35:48Z`. Nothing in here is hand-edited; a re-bake of the
terrain regenerates the whole tree.

## Run it locally

```sh
npm run dev          # http://localhost:3000
```

Any static file server works. **`file://` will not** — ES modules and importmaps
are blocked by CORS on the `file:` scheme, and it will fail for a reason that has
nothing to do with this project.

## Licence and credits

- **Code** — MIT, see [`LICENSE`](LICENSE).
- **Terrain** — USGS 3DEP, public domain.
- **Trails and lifts** — © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- **three.js** — MIT, © 2010–2025 three.js authors.

Full detail in [`ATTRIBUTION.md`](ATTRIBUTION.md).

Resort, run and lift names are used **descriptively**, to identify the real
places this terrain is a model of. Not affiliated with, endorsed by, or
sponsored by Palisades Tahoe or Alterra Mountain Company.
