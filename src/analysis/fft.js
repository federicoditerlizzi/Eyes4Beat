export function hann(size) { return Float32Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1))); }

export function fftReal(samples, window = null) {
  const size = samples.length;if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
  const real = new Float64Array(size), imag = new Float64Array(size);
  for (let index = 0; index < size; index++) real[index] = samples[index] * (window?.[index] ?? 1);
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;for (; reversed & bit; bit >>= 1) reversed ^= bit;reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]];
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let wr = 1, wi = 0;
      for (let index = 0; index < length / 2; index++) {
        const even = offset + index, odd = even + length / 2;
        const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;imag[odd] = imag[even] - ti;real[even] += tr;imag[even] += ti;
        [wr, wi] = [wr * wr0 - wi * wi0, wr * wi0 + wi * wr0];
      }
    }
  }
  const power = new Float64Array(size / 2 + 1), scale = 2 / size;
  for (let index = 0; index < power.length; index++) power[index] = (real[index] ** 2 + imag[index] ** 2) * scale * scale;
  return power;
}
