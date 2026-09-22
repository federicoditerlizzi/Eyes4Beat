const clamp = value => Math.max(0, Math.min(1, value));
export class TempoTracker {
  constructor(rate, { minBpm = 60, maxBpm = 200, seconds = 8 } = {}) { this.rate = rate;this.minBpm = minBpm;this.maxBpm = maxBpm;this.max = Math.ceil(rate * seconds);this.values = [];this.bpm = 0;this.confidence = 0;this.nextBeat = null;this.phase = 0;this.beat = false;this.lastEstimate = -Infinity; }
  correlation(lag) { let mean = this.values.reduce((a, b) => a + b, 0) / this.values.length, sum = 0, left = 0, right = 0;for (let i = lag; i < this.values.length; i++) { const a = this.values[i] - mean, b = this.values[i - lag] - mean;sum += a * b;left += a * a;right += b * b; }return sum / (Math.sqrt(left * right) + 1e-9); }
  estimate() {
    const minLag = Math.floor(this.rate * 60 / this.maxBpm), maxLag = Math.ceil(this.rate * 60 / this.minBpm), scores = new Float64Array(maxLag + 2);let bestLag = minLag, best = -Infinity, total = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { scores[lag] = this.correlation(lag);total += scores[lag];if (scores[lag] > best) { best = scores[lag];bestLag = lag; } }
    const half = Math.round(bestLag / 2), initialBpm = 60 * this.rate / bestLag;
    // Periodic trains often have nearly equal peaks at one and two beats. Prefer
    // the musically useful faster interpretation only when the estimate fell
    // below 80 BPM and the related half-lag peak is almost as strong.
    if (initialBpm < 80 && half >= minLag && scores[half] > best * .90) bestLag = half;
    const y0 = scores[bestLag - 1] || scores[bestLag], y1 = scores[bestLag], y2 = scores[bestLag + 1] || y1, denominator = y0 - 2 * y1 + y2;
    const offset = Math.abs(denominator) > 1e-9 ? .5 * (y0 - y2) / denominator : 0, lag = bestLag + Math.max(-.5, Math.min(.5, offset));
    const candidate = 60 * this.rate / lag, mean = total / (maxLag - minLag + 1), prominence = Math.max(0, y1 - mean);
    const correction=this.bpm&&Math.abs(candidate-this.bpm)>5?.48:.28;this.bpm = this.bpm ? this.bpm * (1-correction) + candidate * correction : candidate;this.confidence += (clamp(prominence / .45) - this.confidence) * .3;
  }
  push(onset, time) {
    this.values.push(onset);if (this.values.length > this.max) this.values.shift();this.beat = false;
    if (this.values.length >= this.rate * 4 && time - this.lastEstimate >= .5) { this.lastEstimate = time;this.estimate(); }
    if (this.bpm > 0) {
      const period = 60 / this.bpm;if (this.nextBeat == null) this.nextBeat = time + period;
      if (time >= this.nextBeat) { this.beat = true;while (this.nextBeat <= time) this.nextBeat += period; }
      const previous = this.nextBeat - period, error = time - previous;
      if (onset > .25 && Math.abs(error) < period * .2) this.nextBeat += error * .12;
      this.phase = ((time - (this.nextBeat - period)) / period + 1) % 1;
    } else this.phase = 0;
    return { bpm: this.bpm, confidence: this.confidence, phase: this.phase, beat: this.beat };
  }
  reset() { this.values.length = 0;this.bpm = 0;this.confidence = 0;this.nextBeat = null;this.phase = 0; }
}
