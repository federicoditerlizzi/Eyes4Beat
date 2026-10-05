// Audio kick release is 0.72 per reference 512-sample hop at 48 kHz.
export const KICK_RELEASE=.72;
export const PAD_RELEASE_MS=-(512/48000)*1000/Math.log(KICK_RELEASE);
