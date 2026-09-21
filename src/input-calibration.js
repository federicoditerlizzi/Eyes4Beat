export const SILENCE_DBFS = -96;

export function dbToGain(db) {
  return Math.pow(10, Number(db) / 20);
}

export function gainToDb(value, floor = SILENCE_DBFS) {
  return value > 0 ? Math.max(floor, 20 * Math.log10(value)) : floor;
}

export function computeDbfsMeter(timeDomain) {
  if (!timeDomain?.length) return { rms: 0, peak: 0, rmsDb: SILENCE_DBFS, peakDb: SILENCE_DBFS };
  let power = 0, peak = 0;
  for (const sample of timeDomain) {
    const value = (sample - 128) / 128;
    power += value * value;peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(power / timeDomain.length);
  return { rms, peak, rmsDb: gainToDb(rms), peakDb: gainToDb(peak) };
}

export function averageNoiseFloor(samples) {
  if (!samples?.length) return { rms: 0, bins: new Float32Array(0) };
  const binCount = samples[0].bins.length;
  const bins = new Float32Array(binCount);
  let rms = 0;
  for (const sample of samples) {
    rms += sample.rms;
    for (let i = 0; i < binCount; i++) bins[i] += sample.bins[i] || 0;
  }
  for (let i = 0; i < binCount; i++) bins[i] /= samples.length;
  return { rms: rms / samples.length, bins };
}

export function spectralSubtract(input, floor, margin = 2) {
  const output = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) output[i] = Math.max(0, Math.round(input[i] - ((floor?.[i] || 0) + margin)));
  return output;
}

export function subtractRmsNoise(rms, floorRms, gateMultiplier = 1.5) {
  if (!(rms > 0) || rms < floorRms * gateMultiplier) return 0;
  return Math.sqrt(Math.max(0, rms * rms - floorRms * floorRms));
}
