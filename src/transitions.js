export const TRANSITIONS = Object.freeze([
  { id: 'cut', shaderId: 0, label: 'Cut', defaultParams: { softEdge: 0 } },
  { id: 'crossfade', shaderId: 1, label: 'Crossfade', defaultParams: { softEdge: 0 } },
  { id: 'dip-black', shaderId: 2, label: 'Dip to black', defaultParams: { softEdge: 0 } },
  { id: 'dip-white', shaderId: 3, label: 'Dip to white', defaultParams: { softEdge: 0 } },
  { id: 'luma-dissolve', shaderId: 4, label: 'Luma dissolve', defaultParams: { softEdge: 0.08 } },
  { id: 'noise-dissolve', shaderId: 5, label: 'Noise dissolve', defaultParams: { softEdge: 0.08 } },
  { id: 'wipe', shaderId: 6, label: 'Wipe', defaultParams: { softEdge: 0.06 } },
  { id: 'iris', shaderId: 7, label: 'Iris', defaultParams: { softEdge: 0.07 } },
  { id: 'zoom-through', shaderId: 8, label: 'Zoom through', defaultParams: { softEdge: 0 } },
  { id: 'glitch-cut', shaderId: 9, label: 'Glitch cut', defaultParams: { softEdge: 0, glitchAmount: 0.075 } },
]);

export const EASINGS = Object.freeze([
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in-out', label: 'Ease in/out' },
  { id: 'ease-out', label: 'Ease out' },
]);

export const WIPE_DIRECTIONS = Object.freeze([
  { id: 'left', label: 'Left', shaderValue: 0 },
  { id: 'right', label: 'Right', shaderValue: 1 },
  { id: 'up', label: 'Up', shaderValue: 2 },
  { id: 'down', label: 'Down', shaderValue: 3 },
  { id: 'random', label: 'Random', shaderValue: -1 },
]);

const transitionMap = new Map(TRANSITIONS.map((transition) => [transition.id, transition]));
const directionMap = new Map(WIPE_DIRECTIONS.map((direction) => [direction.id, direction]));

export function getTransition(id) {
  return transitionMap.get(id) || transitionMap.get('crossfade');
}

export function transitionShaderId(id) {
  return getTransition(id).shaderId;
}

export function resolveTransitionParam(id, wipeDirection = 'left', seed = 0) {
  const transition = getTransition(id);
  let direction = directionMap.get(wipeDirection)?.shaderValue ?? 0;
  if (direction < 0) direction = Math.floor(Math.abs(Math.sin(seed * 91.733)) * 4) % 4;
  return [direction, transition.defaultParams.softEdge || 0, transition.defaultParams.glitchAmount || 0, 0];
}

export const TRANSITION_GLSL_DEFINES = TRANSITIONS
  .map(({ id, shaderId }) => `#define TRANS_${id.replaceAll('-', '_').toUpperCase()} ${shaderId}`)
  .join('\n');
