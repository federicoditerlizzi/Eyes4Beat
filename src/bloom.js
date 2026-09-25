export const BLOOM_DEFAULTS = Object.freeze({ base: 0, threshold: .75, knee: .5, radius: .6, tint: '#ffffff', stretch: 0 });
export const BLOOM_QUALITY_KEY = 'eyes4beat_bloom_quality';
export const normalizeBloomQuality = value => ['off', 'low', 'high'].includes(value) ? value : 'high';

/** Bright-pass energy, with a quadratic soft knee of absolute width knee. */
export function softThreshold(brightness, threshold, knee) {
  if (brightness <= threshold - knee) return 0;
  const soft = Math.max(0, Math.min(2 * knee, brightness - threshold + knee));
  return Math.min(Math.max(0, brightness), Math.max(brightness - threshold, knee > 0 ? soft * soft / (4 * knee) : 0, 0));
}
export function bloomMipSizes(width, height, quality = 'high') {
  if (quality === 'off') return [];
  const divisor = quality === 'low' ? 4 : 2, count = quality === 'low' ? 3 : 6;
  let w = Math.max(1, Math.floor(width / divisor)), h = Math.max(1, Math.floor(height / divisor));
  const sizes = [];
  for (let i = 0; i < count; i++) {
    sizes.push([w, h]);
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
  }
  return sizes;
}
export function blendBloom(a = BLOOM_DEFAULTS, b = BLOOM_DEFAULTS, mix = 1, glow = 0) {
  const lerp = (x, y) => x + (y - x) * mix;
  const tint = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const ta = tint(a.tint), tb = tint(b.tint);
  return { intensity: Math.max(0, lerp(a.base, b.base) + glow),
    threshold: lerp(a.threshold, b.threshold), knee: lerp(a.knee, b.knee),
    radius: lerp(a.radius, b.radius), stretch: lerp(a.stretch, b.stretch), tint: ta.map((v, i) => lerp(v, tb[i])) };
}
