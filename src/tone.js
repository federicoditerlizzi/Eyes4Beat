import { NEUTRAL_LOOK, lookUniforms } from './looks.js';
import { NEUTRAL_TARGETS } from './routing.js';

// Shared with GLSL so reference tests and rendering use the same knee and safety ceiling.
export const TONE_KNEE = .8;
export const COLOR_SAFETY_MAX = 4;
export function highlightShoulder(x) {
  return x <= TONE_KNEE ? x : TONE_KNEE + (1 - TONE_KNEE) *
    (1 - Math.exp(-(x - TONE_KNEE) / (1 - TONE_KNEE)));
}
export function toneColor(color) {
  const peak = Math.max(...color);
  return peak <= TONE_KNEE ? [...color] : color.map(value => value * highlightShoulder(peak) / peak);
}
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function vignetteFactor(uv, resolution, { amount, softness }) {
  const shortSide = Math.max(1, Math.min(...resolution));
  const radius = Math.hypot(...uv.map((value, i) => (value - .5) * resolution[i] / shortSide));
  return 1 - amount * smoothstep(1 - softness, 1, radius);
}
/** CPU reference of grade -> per-look vignette -> output shoulder. */
export function outputColor(color, { look = NEUTRAL_LOOK, targets = NEUTRAL_TARGETS,
  uv = [.5, .5], resolution = [1920, 1080], coverage = 1 } = {}) {
  const { grade, vignette } = lookUniforms(look);
  const luminance = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  let c = color.map((value, i) => value * grade[0] + grade[i + 1] * coverage);
  const luma = luminance(c);
  c = c.map(value => Math.min(COLOR_SAFETY_MAX, (luma * (1 - targets.sat) + value * targets.sat) * targets.luma));
  const factor = vignetteFactor(uv, resolution, { amount: vignette[0], softness: vignette[1] });
  return toneColor(c.map(value => value * factor));
}
