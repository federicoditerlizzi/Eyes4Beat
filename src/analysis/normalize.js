const clamp = value => Math.max(0, Math.min(1, value));
const percentile = (values, p) => { if (!values.length) return 0;const sorted = [...values].sort((a, b) => a - b);return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]; };

export class AdaptiveNormalizer {
  constructor(rate, { shortSeconds = 10, longSeconds = 60, minSpan = .25 } = {}) { this.max = Math.ceil(rate * longSeconds);this.minimum = Math.ceil(rate * Math.min(2, shortSeconds));this.minSpan = minSpan;this.values = [];this.output = 0;this.range = { low: 0, high: 1 }; }
  push(value) {
    this.values.push(value);if (this.values.length > this.max) this.values.shift();
    const recent = this.values.slice(-Math.min(this.values.length, Math.ceil(this.max / 6))), pool = this.values.length >= this.minimum ? this.values : recent;
    let low = percentile(pool, .15), high = percentile(pool, .90);if(high-low<this.minSpan){const center=(low+high)/2;low=center-this.minSpan*.35;high=center+this.minSpan*.65}this.range = { low, high };
    const target = clamp((value - low) / Math.max(1e-4, high - low));this.output += (target - this.output) * (target > this.output ? .35 : .045);return this.output;
  }
  reset() { this.values.length = 0;this.output = 0; }
}
