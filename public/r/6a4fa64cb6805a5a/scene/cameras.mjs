import { groundZ } from './ground.mjs';
import { RUNS } from './layout.mjs';
function line(name,fraction){const points=RUNS.find(run=>run.name===name).pts;return points[Math.min(points.length-1,Math.floor((points.length-1)*fraction))];}
function eye(point,height=1.7){return [point[0],point[1],groundZ(point[0],point[1])+height];}
export const cameras=[
  {id:'match-view-20',reference:20,position:eye([-245,-205]),target:[-270,-342,265],fov:52,note:'Estimated foot-of-face camera; winter massing comparison. Ribs remain too rounded and snow cover differs. Not an exact match.'},
  {id:'match-view-16',reference:16,position:[-235,-180,355],target:[-275,-325,302],fov:54,note:'Estimated aerial pose. OSM snow throats and DEM plateau; spring source compared with winter reconstruction. No surveyed camera extrinsics.'},
  {id:'match-view-9',reference:9,position:eye([-482,-75]),target:[-420,-235,308],fov:72,note:'Estimated top-terminal joint. Shed and summit relationship; operator hut remains simplified.'},
  {id:'match-view-25',reference:25,position:[-380,35,300],target:[-510,-110,281],fov:40,note:'Estimated terminal side view. Distant mountains outside the DEM are absent.'},
  {id:'match-view-23',reference:23,position:eye([470,360],3),target:[-500,-107,280],fov:36,note:'Estimated lift-line view. Fourteen Siberia towers; individual positions inferred, not survey-matched.'},
  {id:'match-view-10',reference:10,position:eye(line('Siberia Bowl',.05)),target:line('Siberia Bowl',.55),fov:72,note:'Approximate position along OSM descent, not time-to-distance recovered from video.'},
  {id:'match-view-12',reference:12,position:eye(line('Siberia Bowl',.32)),target:[1500,600,-150],fov:72,note:'Approximate mid-bowl orientation. Lake Tahoe and distant shoreline are not modeled.'},
  {id:'match-view-28',reference:28,position:eye(line('The Slot',.04)),target:line('The Slot',.20),fov:72,note:'OSM/DEM gully entrance. The photographic near-vertical rock walls are under-resolved at this mesh spacing.'},
  {id:'match-view-38',reference:38,position:eye(line('Sun Bowl',.08)),target:line('Sun Bowl',.65),fov:72,note:'Estimated Sun Bowl entrance look down the OSM line. Background beyond the mapped southern boundary is absent.'},
  {id:'match-view-40',reference:40,position:eye(line('North Bowl',0)),target:line('North Bowl',.75),fov:72,note:'Approximate North Bowl trailhead view. Signs and tree bands interpreted from source; no camera survey.'},
  {id:'hero-overview',position:[650,750,840],target:[-150,-90,185],fov:52,note:'Review overview; no reference-match claim.'},
  {id:'hero-bowl',position:eye([-475,-90],3),target:[330,300,85],fov:70,note:'Player-scale downhill view; no reference-match claim.'}
];
