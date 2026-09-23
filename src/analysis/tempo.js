const clamp = value => Math.max(0, Math.min(1, value));
export class TempoTracker {
  constructor(rate, { minBpm = 60, maxBpm = 200, seconds = 8 } = {}) {
    this.rate = rate;this.minBpm = minBpm;this.maxBpm = maxBpm;this.max = Math.ceil(rate * seconds);
    this.values = new Float64Array(this.max);this.count = 0;this.head = 0;this.sum = 0;
    this.minLag = Math.floor(rate * 60 / maxBpm);this.maxLag = Math.ceil(rate * 60 / minBpm);
    this.scores = new Float64Array(this.maxLag + 2);
    this.products = new Float64Array(this.maxLag + 1);this.left = new Float64Array(this.maxLag + 1);this.right = new Float64Array(this.maxLag + 1);
    this.leftSquare = new Float64Array(this.maxLag + 1);this.rightSquare = new Float64Array(this.maxLag + 1);
    this.bpm = 0;this.confidence = 0;this.nextBeat = NaN;this.phase = 0;this.beat = false;this.lastEstimate = -Infinity;
    this.input = new Float64Array(2);this.estimateStats = new Float64Array(2);this.result = { bpm: 0, confidence: 0, phase: 0, beat: false };
  }
  correlation(lag) { this.updateCorrelation(lag);return this.scores[lag]; }
  updateCorrelation(lag) {
    const mean = this.sum / this.count, count = this.count - lag;
    const sum = this.products[lag] - mean * (this.left[lag] + this.right[lag]) + count * mean * mean;
    const left = Math.max(0, this.leftSquare[lag] - 2 * mean * this.left[lag] + count * mean * mean);
    const right = Math.max(0, this.rightSquare[lag] - 2 * mean * this.right[lag] + count * mean * mean);
    this.scores[lag] = sum / (Math.sqrt(left * right) + 1e-9);
  }
  estimate() {
    const minLag = this.minLag, maxLag = this.maxLag, scores = this.scores, stats = this.estimateStats;let bestLag = minLag;stats[0] = -Infinity;stats[1] = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { this.updateCorrelation(lag);stats[1] += scores[lag];if (scores[lag] > stats[0]) { stats[0] = scores[lag];bestLag = lag; } }
    const best = stats[0], total = stats[1];
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
  updateHistory() {
    const onset = this.input[0];
    // Maintain the exact correlation sufficient statistics in O(lags) per hop.
    // Estimation no longer performs an O(history * lags) burst every .5 seconds.
    const full = this.count === this.max, oldest = this.values[this.head];
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      if (full) {
        const a = this.values[(this.head + lag) % this.max], b = oldest;
        this.products[lag] -= a * b;this.left[lag] -= a;this.right[lag] -= b;this.leftSquare[lag] -= a * a;this.rightSquare[lag] -= b * b;
      }
      if (this.count >= lag) {
        const b = this.values[(this.head + this.count - lag) % this.max];
        this.products[lag] += onset * b;this.left[lag] += onset;this.right[lag] += b;this.leftSquare[lag] += onset * onset;this.rightSquare[lag] += b * b;
      }
    }
    if (full) { this.sum -= oldest;this.values[this.head] = onset;this.head = (this.head + 1) % this.max; }
    else { this.values[(this.head + this.count) % this.max] = onset;this.count++; }
    this.sum += onset;
  }
  push(onset, time) { this.input[0] = onset;this.input[1] = time;this.update();return this.result; }
  update() {
    const onset = this.input[0], time = this.input[1];
    this.updateHistory();this.beat = false;
    if (this.count >= this.rate * 4 && time - this.lastEstimate >= .5) { this.lastEstimate = time;this.estimate(); }
    if (this.bpm > 0) {
      const period = 60 / this.bpm;if (!Number.isFinite(this.nextBeat)) this.nextBeat = time + period;
      if (time >= this.nextBeat) { this.beat = true;while (this.nextBeat <= time) this.nextBeat += period; }
      const previous = this.nextBeat - period, error = time - previous;
      if (onset > .25 && Math.abs(error) < period * .2) this.nextBeat += error * .12;
      this.phase = ((time - (this.nextBeat - period)) / period + 1) % 1;
    } else this.phase = 0;
    this.result.bpm = this.bpm;this.result.confidence = this.confidence;this.result.phase = this.phase;this.result.beat = this.beat;return this.result;
  }
  reset() {
    this.count = 0;this.head = 0;this.sum = 0;this.products.fill(0);this.left.fill(0);this.right.fill(0);this.leftSquare.fill(0);this.rightSquare.fill(0);
    this.bpm = 0;this.confidence = 0;this.nextBeat = NaN;this.phase = 0;this.beat = false;this.lastEstimate = -Infinity;
  }
}
