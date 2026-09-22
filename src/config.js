export const IMAGE_SETS = [
 [
  "assets/images/deep-drift-01.webp",
  "assets/images/deep-drift-02.webp",
  "assets/images/deep-drift-03.webp",
  "assets/images/deep-drift-04.webp",
  "assets/images/deep-drift-05.webp"
 ],
 [
  "assets/images/funk-elastic-01.webp",
  "assets/images/funk-elastic-02.webp",
  "assets/images/funk-elastic-03.webp",
  "assets/images/funk-elastic-04.webp",
  "assets/images/funk-elastic-05.webp"
 ],
 [
  "assets/images/organic-bloom-01.webp",
  "assets/images/organic-bloom-02.webp",
  "assets/images/organic-bloom-03.webp",
  "assets/images/organic-bloom-04.webp",
  "assets/images/organic-bloom-05.webp"
 ],
 [
  "assets/images/dense-propulsion-01.webp",
  "assets/images/dense-propulsion-02.webp",
  "assets/images/dense-propulsion-03.webp",
  "assets/images/dense-propulsion-04.webp",
  "assets/images/dense-propulsion-05.webp"
 ],
 [
  "assets/images/heart-pulse-01.webp",
  "assets/images/heart-pulse-02.webp",
  "assets/images/heart-pulse-03.webp",
  "assets/images/heart-pulse-04.webp",
  "assets/images/heart-pulse-05.webp"
 ],
 [
  "assets/images/cyber-heart-01.png",
  "assets/images/cyber-heart-02.png",
  "assets/images/cyber-heart-03.png",
  "assets/images/cyber-heart-04.png",
  "assets/images/cyber-heart-05.png"
 ]
];
export const archetypes = [
 {name:'DEEP DRIFT'}, {name:'FUNK ELASTIC'}, {name:'ORGANIC BLOOM'},
 {name:'DENSE PROPULSION'}, {name:'HEART PULSE'}, {name:'CYBER HEART'}
];

export const routeSources=['energy','density','drive','boombap','tension','bright','open','beat','kick','snare'];
export const routeTargets=['pulse','dist','luma','sat','glow','parts','zoom','rotate','spiral','tiles'];
export const sourceLabels={energy:'Energy',density:'Density',drive:'Drive',boombap:'BoomBap',tension:'Tension',bright:'Brightness',open:'Openness',beat:'Beat',kick:'Kick',snare:'Snare'};
export const targetLabels={pulse:'Pulse',dist:'Distortion',luma:'Brightness',sat:'Saturation',glow:'Glow',parts:'Particles',zoom:'Zoom',rotate:'Rotation',spiral:'Spiral',tiles:'Tile Shuffle'};
export function blankMap(){const m={};routeSources.forEach(s=>{m[s]={};routeTargets.forEach(t=>m[s][t]=0)});return m}
function makeMap(entries){const m=blankMap();entries.forEach(([s,t,v])=>m[s][t]=v);m.energy.rotate=.45;m.drive.spiral=.55;m.kick.tiles=.7;return m}
export const defaultRoutingMaps=[
 makeMap([['energy','luma',.55],['bright','glow',.70],['open','luma',.38],['open','glow',.28],['open','zoom',-.25],['tension','dist',.38],['density','parts',.42],['kick','pulse',.28],['snare','glow',.34]]),
 makeMap([['energy','pulse',.72],['energy','zoom',.18],['drive','pulse',.42],['boombap','luma',.38],['boombap','sat',.20],['density','parts',.55],['tension','dist',.42],['kick','pulse',.55],['snare','glow',.46]]),
 makeMap([['energy','sat',.35],['energy','luma',.18],['bright','glow',.55],['bright','luma',.28],['open','glow',.42],['open','zoom',-.38],['density','parts',.45],['kick','pulse',.20],['snare','glow',.24]]),
 makeMap([['energy','dist',.58],['energy','pulse',.48],['energy','zoom',.28],['boombap','dist',.38],['boombap','zoom',.15],['tension','dist',.68],['density','parts',.78],['drive','parts',.32],['kick','pulse',.68],['snare','luma',.55],['snare','glow',.48]]),
 makeMap([['energy','luma',.48],['energy','sat',.42],['energy','pulse',.35],['boombap','zoom',.14],['tension','dist',.45],['bright','glow',.55],['density','parts',.48],['kick','pulse',.88],['snare','glow',.58],['snare','luma',.40]]),
 makeMap([['energy','pulse',.72],['energy','glow',.44],['energy','luma',.28],['density','parts',.36],['boombap','sat',.32],['boombap','zoom',.18],['tension','dist',.40],['bright','glow',.62],['open','zoom',-.12],['kick','pulse',1.10],['snare','glow',.52]])
];
