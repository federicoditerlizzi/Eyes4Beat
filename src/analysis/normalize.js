import { SortedHistory } from './history.js';
const clamp = value => Math.max(0, Math.min(1, value));
export class AdaptiveNormalizer {
  constructor(rate, { shortSeconds = 10, longSeconds = 60, minSpan = .25, responseScale = 1 } = {}) {
    this.attack = responseScale === 1 ? .35 : 1 - .65 ** responseScale;this.release = responseScale === 1 ? .045 : 1 - .955 ** responseScale;this.max = Math.ceil(rate * longSeconds);this.minimum = Math.ceil(rate * Math.min(2, shortSeconds));this.minSpan = minSpan;
    this.input = new Float64Array(1);this.history = new SortedHistory(this.max);this.recent = new SortedHistory(Math.ceil(this.max / 6));this.output = 0;this.range = { low: 0, high: 1 };
  }
  // Offline convenience API; the engine uses input/update to avoid boxed arguments.
  push(value) { this.input[0] = value;this.update();return this.output; }
  update() {
    const value = this.input[0];
    this.history.push(value);if (this.history.count < this.minimum) this.recent.push(value);
    const pool = this.history.count >= this.minimum ? this.history : this.recent;
    let low = pool.sorted[Math.floor(.15 * (pool.count - 1))], high = pool.sorted[Math.floor(.90 * (pool.count - 1))];
    if (high - low < this.minSpan) { const center = (low + high) / 2;low = center - this.minSpan * .35;high = center + this.minSpan * .65; }
    this.range.low = low;this.range.high = high;
    const target = clamp((value - low) / Math.max(1e-4, high - low));this.output += (target - this.output) * (target > this.output ? this.attack : this.release);
  }
  reset() { this.history.reset();this.recent.reset();this.output = 0; }
}
