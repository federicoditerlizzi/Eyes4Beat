// Fixed storage with exact rolling order statistics; no per-update copies/sorts.
export class SortedHistory {
  constructor(capacity) { this.values = new Float64Array(capacity);this.sorted = new Float64Array(capacity);this.count = 0;this.head = 0;this.selections = new Uint32Array(capacity); }
  push(value) {
    const sorted = this.sorted;let count = this.count;
    if (count === this.values.length) {
      const old = this.values[this.head];let lo = 0, hi = count;
      while (lo < hi) { const mid = (lo + hi) >>> 1;if (sorted[mid] < old) lo = mid + 1;else hi = mid; }
      sorted.copyWithin(lo, lo + 1, count);count--;
    }
    this.values[this.head] = value;this.head = (this.head + 1) % this.values.length;
    let lo = 0, hi = count;
    while (lo < hi) { const mid = (lo + hi) >>> 1;if (sorted[mid] < value) lo = mid + 1;else hi = mid; }
    sorted.copyWithin(lo + 1, lo, count);sorted[lo] = value;this.count = count + 1;
  }
  copyFrom(source, stride = 1) {
    this.reset();source.selections.fill(0);
    const start = source.count === source.values.length ? source.head : 0;
    const skip = Math.max(0, source.count - this.values.length * stride);
    for (let i = skip; i < source.count; i += stride) {
      const value = source.values[(start + i) % source.values.length];this.values[this.count++] = value;
      let lo = 0, hi = source.count;
      while (lo < hi) { const mid = (lo + hi) >>> 1;if (source.sorted[mid] < value) lo = mid + 1;else hi = mid; }
      source.selections[lo]++;
    }
    let write = 0;
    for (let i = 0; i < source.count; i++) for (let n = 0; n < source.selections[i]; n++) this.sorted[write++] = source.sorted[i];
    this.head = this.count % this.values.length;
  }
  reset() { this.count = 0;this.head = 0; }
}
export class EventHistory {
  constructor(capacity = 512) { this.values = new Float64Array(capacity);this.head = 0;this.length = 0;this.input = new Float64Array(2); }
  at(index) { return this.values[(this.head + index) % this.values.length]; }
  push(time) { this.input[0] = time;this.append(); }
  append(active = true) { if (!active) return;this.values[(this.head + this.length) % this.values.length] = this.input[0];if (this.length < this.values.length) this.length++;else this.head = (this.head + 1) % this.values.length; }
  expire() { const before = this.input[0] - 8;while (this.length && this.values[this.head] <= before) { this.head = (this.head + 1) % this.values.length;this.length--; } }
  reset() { this.head = 0;this.length = 0;this.input.fill(0); }
  snapshot() { return Array.from({ length: this.length }, (_, i) => this.at(i)); }
}
