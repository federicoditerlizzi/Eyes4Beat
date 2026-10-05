import {KICK_RELEASE} from '../event-envelope.js';
export const FEATURE_KEYS = ['level', 'low', 'bright', 'motion', 'full'];
const FAST = [.30, .26, .18, .30, .22];
const CONTEXT = [.18, .15, .10, .15, .12];
const SECONDS = [3, 4, 6, 4, 6];

// The former main-thread Fast/Context calculations, still evaluated every hop.
export class MusicalLayers {
  constructor(rate) {
    this.capacity = Math.ceil(rate * 20) + 2;
    this.times = new Float64Array(this.capacity);this.values = new Float64Array(this.capacity * 7);
    this.heads = new Uint32Array(7);this.counts = new Uint32Array(7);this.sums = new Float64Array(7);
    this.fast = new Float64Array(7);this.context = new Float64Array(7);this.write = 0;this.timestamp = 0;this.kick = 0;this.snare = 0;this.beat = 0;this.reset();
  }
  reset() { this.heads.fill(0);this.counts.fill(0);this.sums.fill(0);this.fast.fill(0);this.context.fill(0);this.write = 0;this.timestamp = 0;this.kick = 0;this.snare = 0;this.beat = 0; }
  rebase() { for (let i = 0; i < this.capacity; i++) this.times[i] -= this.timestamp;this.timestamp = 0; }
  push(features, hopScale = 1) {
    const time = features.timestamp;this.timestamp = time;
    this.times[this.write] = time;
    for (let k = 0; k < FEATURE_KEYS.length; k++) {
      const value = features.rawValues[k];
      this.values[this.write * 7 + k] = value;this.sums[k] += value;this.counts[k]++;
      while (this.counts[k] > 1 && this.times[this.heads[k]] < time - SECONDS[k]) {
        this.sums[k] -= this.values[this.heads[k] * 7 + k];this.heads[k] = (this.heads[k] + 1) % this.capacity;this.counts[k]--;
      }
      this.fast[k] += (value - this.fast[k]) * (1 - (1 - FAST[k]) ** hopScale);
      this.context[k] += (this.sums[k] / this.counts[k] - this.context[k]) * (1 - (1 - CONTEXT[k]) ** hopScale);
    }
    this.write = (this.write + 1) % this.capacity;
    const eventValues=features.eventValues;
    const kick=eventValues?eventValues[1]:Number(features.events.kick),snare=eventValues?eventValues[2]:Number(features.events.snare),beat=eventValues?eventValues[0]:Number(features.events.beat);
    this.kick = kick ? kick : this.kick * KICK_RELEASE ** hopScale;this.snare = snare ? snare : this.snare * .70 ** hopScale;
    this.beat = beat ? 1 : this.beat * .82 ** hopScale;
  }
}
