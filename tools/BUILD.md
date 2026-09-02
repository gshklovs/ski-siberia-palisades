# This repository is a generated artifact — do not hand-edit it

Everything under `public/` is written by one script in a private research repo:

```
poi-lab/tools/export-red-dog/build.mjs --world siberia
```

Built from poi-lab commit `9d2545ee00037c99acda5ae1c5bdd393a937cab5` on `2026-09-02T06:13:52Z`.

A hand-edited change here is lost on the next bake, silently. If something in
`public/` is wrong, the fix belongs in one of four places in poi-lab:

| what is wrong | where the fix goes |
|---|---|
| the mountain — terrain, runs, trees, the cliff | `runs/siberia-palisades-A-raw-01/scene/` (then re-bake) |
| the game — physics, HUD, camera, gear | `bench/public/js/play/` (then re-bake) |
| what ships, and what the page says | `tools/export-red-dog/worlds/siberia.json` |
| the six Siberia name strings in the player | `tools/export-red-dog/patches/siberia/` |

## How the bake works

1. **Pin.** Every source file is read with `git show <pin>:<path>`. The working
   tree is never touched, so a parallel editing session cannot leak into a
   release.
2. **Allowlist.** `worlds/siberia.json` names every source file, its destination
   and its transform. There is no directory walk anywhere in the builder — a
   walk-and-filter would silently ship the next scratch directory somebody drops
   into the source repo. The build asserts afterwards that nothing landed in
   `public/` that the world file did not name.
3. **Transforms.** `copy`, `stub-module` (replace a module body with the named
   exports it must still provide) and `bundle-three`. There is no `crop-dem`
   here: this world's scene *is* its sector, so nothing is decimated.
4. **Flags, then patches.** The lab and this build are ONE product: every
   difference between them is one of four values — `guide`, `gearSet`,
   `debugHud`, `brand` — declared in `templates/index.html` and read once by
   `js/play/flags.js`. Nothing is forked.

   The six patches in `tools/export-red-dog/patches/siberia/` exist for one
   reason: `bench/public/js/play/` is **shared byte for byte with the Red Dog
   build**, so its six Red Dog identity strings cannot be edited upstream
   without changing what that site ships. They are rewritten here, at build
   time, for this world only — the brand fallback, the title card, the tab
   title, the pause header, the ski name and the bike name. Every hunk is
   anchored on exact source text and declared `count: 1`, so **the day somebody
   rewords one of them upstream this build fails** instead of quietly shipping a
   Red Dog string on a Siberia site.

   The two *scene* patches the Red Dog build uses do not apply here at all.
   Every one of their hunks is a pure function of that build's crop — the raster
   extent, the derived spawn block, the positional marker filter — and this
   world is not cropped.
5. **Spawn.** The run's own, shipped unchanged. `world.mjs` derives it at
   runtime from the Siberia Express top terminal, so a re-bake of the DEM moves
   the spawn with it for free.
6. **Gate.** `--gate` loads the built site headless and fails on any budget in
   the world file's `budget` block. **It has not been run against this world**:
   the gate's checks are still written against Red Dog's geography (its lifts,
   its markers, its race courses), so it would fail on that rather than on
   anything here. Threading `worlds/*.json`'s `gate` block through those checks
   is the outstanding work.

## What is different about this world

- **It is a raw run, not a merge.** Its scene is already the sector, so there is
  no crop: no ground raster patch, no marker filter, no derived spawn.
- **The hero is rock.** `cliff-data.mjs` has no counterpart in the Red Dog
  build.
- **One lift boards.** `world.mjs` declares Siberia Express only. Headwall
  Express is a landmark and the east end of the Reverse Traverse; its base sits
  533 m below this world's frame.
- **There are no waypoint signs.** This world declares no markers at all, so
  there are no `/slug` pretty paths and no `?spawn=<id>` targets beyond the
  default. That is the run as baked, not a filter eating them.
- **There is no guided course.** `guide.js` knows no course for this world, so
  the intro cards, the idle nudge and the lift quality-of-life all ship, and the
  tutorial and the two race courses simply do not exist here.

## The control surface

There are **four** documented keys, and they appear in exactly two places, with
identical wording: the intro card, and the ESC pause panel.

```
W A S D   move
  ← →     tricks in the air
   R      reset
   C      camera
```

The bottom-left legend strip carries six chips and they are the same keys.
Everything else the player can do still works and is simply not advertised —
SHIFT, SPACE, carve and snowplow are found in about four seconds by anyone who
has held a controller; `F` to board the chair is announced by the contextual
prompt under the crosshair *at the terminal*; and `E` / `I` / `H` stay hidden.
