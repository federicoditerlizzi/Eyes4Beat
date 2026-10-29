import { sourceIds as routeSources } from './source-registry.js';
export { sourceRegistry, sourceIds as routeSources, sourceLabels, eventSourceIds, registerSource, unregisterSource, subscribeSources } from './source-registry.js';
export const routeTargets=['pulse','dist','luma','sat','glow','parts','zoom','rotate','spiral','tiles','trails','kaleido'];

export const targetLabels={pulse:'Pulse',dist:'Distortion',luma:'Brightness',sat:'Saturation',glow:'Glow',parts:'Particles',zoom:'Zoom',rotate:'Rotation',spiral:'Spiral',tiles:'Tile Shuffle',trails:'Trails',kaleido:'Kaleido'};
export function blankMap(){const m={};routeSources.forEach(s=>{m[s]={};routeTargets.forEach(t=>m[s][t]=0)});return m}
