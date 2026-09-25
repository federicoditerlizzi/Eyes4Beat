/** Quantized histogram with distance suppression, on a small RGBA downscale. */
export function dominantColors(pixels, count = 5) {
  const bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = rgb.map(v => v >> 4).join(':');
    const bin = bins.get(key) || { count: 0, sum: [0,0,0] };bin.count++;
    rgb.forEach((v, j) => bin.sum[j] += v);bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((a,b) => b.count - a.count).map(bin => bin.sum.map(v => Math.round(v / bin.count)));
  const chosen = [];
  for (const rgb of ranked) {
    if (chosen.every(other => Math.hypot(...rgb.map((v,i) => v-other[i])) > 45)) chosen.push(rgb);
    if (chosen.length === count) break;
  }
  return chosen.map(rgb => '#' + rgb.map(v => v.toString(16).padStart(2,'0')).join(''));
}
/** Called once when a media slot loads; video uses its first decoded frame. */
export function extractMediaPalette(media) {
  try {
    const canvas = document.createElement('canvas');canvas.width = 32;canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });ctx.drawImage(media,0,0,32,32);
    return dominantColors(ctx.getImageData(0,0,32,32).data);
  } catch { return []; }
}
