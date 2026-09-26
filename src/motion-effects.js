export const BURST_DEFAULTS = Object.freeze({ trigger: 'none', amount: 32, speed: 160, spread: 1, origin: 'center' });
export const ROTATION_DEFAULTS = Object.freeze({ mode: 'angle', maxAngle: 90, maxSpeed: 90, direction: 'cw', returnToRest: true, fill: 0 });
export const PULSE_DEFAULTS = Object.freeze({ mode: 'breath', centerX: .5, centerY: .5, strength: 1, speed: 1, width: .12, chromatic: 0 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
export function createRotationState() { return { angle: 0, velocity: 0, sign: 1, idleSince: null, restAngle: 0, active: false, coverFrom: 0, coverTo: 0, coverStartedAt: 0 }; }
/** Rotation activity envelope, continuous even when activity reverses mid-fade. */
export function rotationActivityAt(state, now) {
  if (!state || state.coverStartedAt == null) return 0;
  return state.coverFrom + (state.coverTo - state.coverFrom) * smooth((now - state.coverStartedAt) / .5);
}
export function rotationCoverAt(state, settings, aspect, now) {
  return 1 + (rotationCover(settings, aspect) - 1) * rotationActivityAt(state, now);
}
/** Degrees; dt and now in seconds. Caller supplies discrete beat events, not a held envelope. */
export function stepRotation(state, settings, drive, dt, now, beats = 0, panic = false) {
  if (panic) return Object.assign(state, createRotationState());
  if (settings.direction === 'flip-on-beat' && beats % 2) state.sign *= -1;
  const sign = settings.direction === 'ccw' ? -1 : settings.direction === 'cw' ? 1 : state.sign;
  const amount = clamp(drive / 1.5, 0, 1);
  state.velocity = settings.mode === 'spin' ? sign * settings.maxSpeed * amount : 0;
  if (amount > .00001) {
    state.idleSince = null;
    state.angle = settings.mode === 'spin' ? wrapAngle(state.angle + state.velocity * dt) : sign * settings.maxAngle * amount;
    state.active = settings.mode === 'spin' ? settings.maxSpeed > 0 : settings.maxAngle > 0;
  } else if (settings.returnToRest) {
    if (state.idleSince === null) { state.idleSince = now; state.restAngle = wrapAngle(state.angle); }
    const t = (now - state.idleSince - 1) / 2;
    state.angle = state.restAngle * (1 - smooth(t));
    if (t >= 1) { state.angle = 0; state.active = false; }
  } else if (settings.mode === 'angle') {
    state.angle = 0; state.active = false; state.idleSince = null;
  }
  const coverTarget = state.active ? 1 : 0;
  if (coverTarget !== state.coverTo) {
    state.coverFrom = rotationActivityAt(state, now);
    state.coverTo = coverTarget;
    state.coverStartedAt = now;
  }
  return state;
}
/** Fixed cover for the whole configured angle range, never the instantaneous angle.
 * Spin uses the requested 45-degree reference; shader mirror handles wider-format corners.
 */
export function rotationCover(settings, aspect) {
  const ratio = Math.max(aspect, 1 / aspect), limit = Math.min(Math.PI / 2, settings.maxAngle * Math.PI / 180);
  const angle = settings.mode === 'spin' ? Math.PI / 4 : Math.min(limit, Math.atan(ratio));
  const fullCover = Math.max(1, Math.cos(angle) + ratio * Math.sin(angle));
  return 1 + (fullCover - 1) * clamp(settings.fill ?? 0, 0, 1);
}
export function createWaveState() { return { armed: true, last: -Infinity, serial: 0, current: null, waves: [] }; }
export function stepWaves(state, value, now, { panic = false, lifetime = 5, high = .2, low = .08, interval = .09 } = {}) {
  if (panic) { Object.assign(state, createWaveState()); return state; }
  state.waves = state.waves.filter(wave => now - wave.start < lifetime);
  if (value <= low) { state.armed = true; state.current = null; }
  if (state.armed && value >= high) {
    state.armed = false;
    if (now - state.last < interval) return state;
    const wave = { id: ++state.serial, start: now, strength: value };
    if (state.waves.length === 4) state.waves.shift();
    state.waves.push(wave); state.last = now; state.armed = false; state.current = wave.id;
  } else if (!state.armed) {
    const current = state.waves.find(wave => wave.id === state.current);
    if (current) current.strength = Math.max(current.strength, value);
  }
  return state;
}
export function waveUniforms(waves) {
  const data = new Float32Array(8); for (let i = 0; i < 4; i++) data[i * 2] = -1000;
  waves.slice(-4).forEach((wave, i) => { data[i * 2] = wave.start; data[i * 2 + 1] = wave.strength; }); return data;
}
export function breathPhase(now, bpm, phase = 0, elapsed = 0) {
  return bpm > 0 ? ((phase + elapsed * bpm / 60) % 1) * Math.PI * 2 : now * 6;
}
