export class AdaptiveTrigger {
  constructor({ historySize = 150, multiplier = 2.5, refractorySeconds = .06 } = {}) { this.values = [];this.historySize = historySize;this.multiplier = multiplier;this.refractorySeconds = refractorySeconds;this.lastAt = -Infinity; }
  push(value, time) {
    this.values.push(value);if (this.values.length > this.historySize) this.values.shift();
    const sorted = [...this.values].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] || 0;
    const deviations = sorted.map(item => Math.abs(item - median)).sort((a, b) => a - b), deviation = deviations[Math.floor(deviations.length / 2)] || 1e-6;
    const threshold = median + this.multiplier * deviation;
    const trigger = this.values.length > 12 && value > Math.max(threshold, 1e-5) && time - this.lastAt >= this.refractorySeconds;
    if (trigger) this.lastAt = time;return { trigger, threshold, strength: Math.max(0, Math.min(1, (value - median) / Math.max(deviation * 8, 1e-5))) };
  }
  reset() { this.values.length = 0;this.lastAt = -Infinity; }
}

export function spectralFlux(logMagnitudes, previous) {
  let flux = 0;for (let index = 0; index < logMagnitudes.length; index++) flux += Math.max(0, logMagnitudes[index] - (previous?.[index] || 0));return flux / logMagnitudes.length;
}
