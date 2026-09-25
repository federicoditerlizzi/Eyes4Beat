// Routing registry: new event sources only need metadata here to appear in burst controls.
export const sourceRegistry=[
  ...['energy','density','drive','boombap','tension','bright','open'].map(id=>({id,kind:'continuous'})),
  ...['beat','kick','snare'].map(id=>({id,kind:'event'})),
];
export const routeSources=sourceRegistry.map(source=>source.id);
export function eventSourceIds(){return sourceRegistry.filter(source=>source.kind==='event').map(source=>source.id)}
export const routeTargets=['pulse','dist','luma','sat','glow','parts','zoom','rotate','spiral','tiles'];
export const sourceLabels={energy:'Energy',density:'Density',drive:'Drive',boombap:'BoomBap',tension:'Tension',bright:'Brightness',open:'Openness',beat:'Beat',kick:'Kick',snare:'Snare'};
export const targetLabels={pulse:'Pulse',dist:'Distortion',luma:'Brightness',sat:'Saturation',glow:'Glow',parts:'Particles',zoom:'Zoom',rotate:'Rotation',spiral:'Spiral',tiles:'Tile Shuffle'};
export function blankMap(){const m={};routeSources.forEach(s=>{m[s]={};routeTargets.forEach(t=>m[s][t]=0)});return m}
