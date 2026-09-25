/** Screen UV -> centered texture UV: uv * scale + offset.
 * Overscan is a zoom factor of 1 + amount, applied after fitting.
 * Keep this math in sync with samplePair() in shaders.js.
 */
export function frameFit(imageAspect, screenAspect, fit = 'cover', overscan = 0) {
  const image = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const screen = Number.isFinite(screenAspect) && screenAspect > 0 ? screenAspect : 1;
  const ratio = screen / image;
  let scale = [1, 1];
  if (fit === 'cover') scale = [Math.min(1, ratio), Math.min(1, 1 / ratio)];
  else if (fit === 'contain') scale = [Math.max(1, ratio), Math.max(1, 1 / ratio)];
  const zoom = 1 + (Number.isFinite(overscan) ? Math.max(0, Math.min(.15, overscan)) : 0);
  scale = scale.map(value => value / zoom);
  return { scale, offset: scale.map(value => (1 - value) / 2) };
}

/** Reference edge handling; null represents the renderer's black background. */
export function frameUv(uv, imageAspect, screenAspect, frame = {}) {
  const { fit = 'cover', edge = 'mirror', overscan = 0 } = frame;
  const { scale, offset } = frameFit(imageAspect, screenAspect, fit, overscan);
  const mapped = uv.map((value, axis) => value * scale[axis] + offset[axis]);
  if (fit === 'contain' && mapped.some(value => value < 0 || value > 1)) return null;
  return mapped.map(value => edge === 'clamp' ? Math.max(0, Math.min(1, value)) :
    1 - Math.abs(((value % 2) + 2) % 2 - 1));
}
