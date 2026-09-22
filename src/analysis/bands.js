export const BAND_DEFINITIONS = Object.freeze([
  ['sub', 20, 60], ['bass', 60, 120], ['lowMid', 120, 400], ['mid', 400, 2000],
  ['highMid', 2000, 6000], ['high', 6000, 12000], ['air', 12000, Infinity],
]);
export const powerToDb = power => power > 1e-12 ? Math.max(-120, 10 * Math.log10(power)) : -120;
export const amplitudeToDb = amplitude => amplitude > 1e-6 ? Math.max(-120, 20 * Math.log10(amplitude)) : -120;

function integrateRange(spectrum, sampleRate, fftSize, low, rawHigh) {
  const nyquist = sampleRate / 2, high = Math.min(rawHigh, nyquist), hzPerBin = sampleRate / fftSize;
  if (high <= low) return 0;
  const first = Math.max(1, Math.floor(low / hzPerBin - .5)), last = Math.min(spectrum.length - 1, Math.ceil(high / hzPerBin + .5));let sum = 0;
  for (let index = first; index <= last; index++) {
    const binLow = Math.max(0, (index - .5) * hzPerBin), binHigh = Math.min(nyquist, (index + .5) * hzPerBin), overlap = Math.max(0, Math.min(high, binHigh) - Math.max(low, binLow));
    if (overlap) sum += spectrum[index] * overlap / hzPerBin;
  }
  return sum;
}

export function bandPowers(spectrum, sampleRate, fftSize) {
  const nyquist = sampleRate / 2, powers = {}, levels = {};
  for (const [name, low, rawHigh] of BAND_DEFINITIONS) {
    powers[name] = integrateRange(spectrum, sampleRate, fftSize, low, Math.min(rawHigh, nyquist));levels[name] = powerToDb(powers[name]);
  }
  return { powers, levels };
}

export function rangePower(spectrum, sampleRate, fftSize, low, high) {
  return integrateRange(spectrum, sampleRate, fftSize, low, high);
}

export function spectralCentroid(spectrum, sampleRate, fftSize) {
  let weighted = 0, total = 0;for (let index = 1; index < spectrum.length; index++) { const magnitude = Math.sqrt(spectrum[index]);total += magnitude;weighted += magnitude * index * sampleRate / fftSize; }
  return total ? weighted / total : 0;
}
