export function hann(size) { return Float32Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1))); }

export class RealFFT {
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;this.real = new Float64Array(size);this.imag = new Float64Array(size);this.power = new Float64Array(size / 2 + 1);
    this.reversed = new Uint32Array(size);this.cos = new Float64Array(size / 2);this.sin = new Float64Array(size / 2);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) { let value = i, reversed = 0;for (let b = 0; b < bits; b++) { reversed = (reversed << 1) | (value & 1);value >>>= 1; }this.reversed[i] = reversed; }
    for (let i = 0; i < size / 2; i++) { this.cos[i] = Math.cos(-2 * Math.PI * i / size);this.sin[i] = Math.sin(-2 * Math.PI * i / size); }
  }
  transform(samples, window = null) {
    const size = this.size, real = this.real, imag = this.imag;
    for (let i = 0; i < size; i++) { real[this.reversed[i]] = samples[i] * (window ? window[i] : 1);imag[i] = 0; }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1, stride = size / length;
      for (let offset = 0; offset < size; offset += length) {
        for (let i = 0; i < half; i++) {
          const even = offset + i, odd = even + half, twiddle = i * stride;
          const wr = this.cos[twiddle], wi = this.sin[twiddle];
          const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
          real[odd] = real[even] - tr;imag[odd] = imag[even] - ti;real[even] += tr;imag[even] += ti;
        }
      }
    }
    const scale = 4 / (size * size);
    for (let i = 0; i < this.power.length; i++) this.power[i] = (real[i] * real[i] + imag[i] * imag[i]) * scale;
    return this.power;
  }
}
// Convenience API for offline callers. Real-time callers own a reusable plan.
export function fftReal(samples, window = null) { return new RealFFT(samples.length).transform(samples, window); }
