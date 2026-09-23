import { SortedHistory } from './history.js';
export class AdaptiveTrigger {
  constructor({ historySize = 150, multiplier = 2.5, refractorySeconds = .06 } = {}) {
    this.history = new SortedHistory(historySize);this.multiplier = multiplier;this.refractorySeconds = refractorySeconds;this.lastAt = -Infinity;
    this.input = new Float64Array(2);this.result = { trigger: false, threshold: 0, strength: 0 };
  }
  push(value, time) { this.input[0] = value;this.input[1] = time;this.update();return this.result; }
  update() {
    const value = this.input[0], time = this.input[1];
    this.history.push(value);
    const sorted = this.history.sorted, count = this.history.count, middle = Math.floor(count / 2), median = sorted[middle];
    // Merge the two already sorted halves by distance from the median.
    let left = middle - 1, right = middle, deviation = 0;
    for (let i = 0; i <= middle; i++) {
      if (left < 0) { deviation = sorted[right] - median;right++; }
      else if (right >= count) { deviation = median - sorted[left];left--; }
      else if (median - sorted[left] < sorted[right] - median) { deviation = median - sorted[left];left--; }
      else { deviation = sorted[right] - median;right++; }
    }
    if (deviation === 0) deviation = 1e-6;
    const threshold = median + this.multiplier * deviation;
    const trigger = count > 12 && value > Math.max(threshold, 1e-5) && time - this.lastAt >= this.refractorySeconds;
    if (trigger) this.lastAt = time;
    this.result.trigger = trigger;this.result.threshold = threshold;this.result.strength = Math.max(0, Math.min(1, (value - median) / Math.max(deviation * 8, 1e-5)));return this.result;
  }
  reset() { this.history.reset();this.lastAt = -Infinity; }
}

export function spectralFlux(logMagnitudes, previous) {
  let flux = 0;for (let index = 0; index < logMagnitudes.length; index++) flux += Math.max(0, logMagnitudes[index] - (previous?.[index] || 0));return flux / logMagnitudes.length;
}
