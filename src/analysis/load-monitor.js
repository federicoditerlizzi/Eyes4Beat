// One-second rolling mean; require three consecutive overloaded seconds.
export class LoadMonitor {
  constructor(sampleRate) { this.sampleRate = sampleRate;this.averageMs = 0;this.overloadedSeconds = 0;this.mode = 0;this.overloaded = false; }
  observe(milliseconds, frames) {
    const seconds = frames / this.sampleRate, weight = 1 - Math.exp(-seconds);
    this.averageMs += (Math.max(0, milliseconds) - this.averageMs) * weight;
    this.overloaded = this.averageMs > seconds * 1000 * .4;
    if (this.overloaded) this.overloadedSeconds += seconds;else this.overloadedSeconds = 0;
    if (this.overloadedSeconds >= 3 && this.mode < 2) { this.mode++;this.overloadedSeconds = 0;return true; }
    return false;
  }
}
