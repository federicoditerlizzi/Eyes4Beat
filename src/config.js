export const routeSources=['energy','density','drive','boombap','tension','bright','open','beat','kick','snare'];
export const routeTargets=['pulse','dist','luma','sat','glow','parts','zoom','rotate','spiral','tiles'];
export const sourceLabels={energy:'Energy',density:'Density',drive:'Drive',boombap:'BoomBap',tension:'Tension',bright:'Brightness',open:'Openness',beat:'Beat',kick:'Kick',snare:'Snare'};
export const targetLabels={pulse:'Pulse',dist:'Distortion',luma:'Brightness',sat:'Saturation',glow:'Glow',parts:'Particles',zoom:'Zoom',rotate:'Rotation',spiral:'Spiral',tiles:'Tile Shuffle'};
export function blankMap(){const m={};routeSources.forEach(s=>{m[s]={};routeTargets.forEach(t=>m[s][t]=0)});return m}
