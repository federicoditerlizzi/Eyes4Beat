import { stepParticle } from './looks.js';
export { BURST_DEFAULTS } from './motion-effects.js';
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function particleAlpha(p) {
  return smooth(p.age / .25) * smooth((p.life - p.age) / .65) * (p.release == null ? 1 : 1 - smooth(p.release / .65));
}
function createParticle(width, height, settings, palette, random) {
  return { x: random() * width, y: random() * height, z: random(), r: 1 + random() * 2.3,
    vx: 0, vy: 0, age: 0, life: 5 + random() * 5, phase: random() * 100, release: null, burst: false,
    color: settings.colorMode === 'palette' && palette.length ? palette[Math.floor(random() * palette.length)] : settings.color,
    level: 1 };
}
export function spawnBurst(particles, settings, intensity, width, height, palette = [], random = Math.random) {
  const burst = settings.burst, count = Math.min(1000 - particles.length, Math.round(burst.amount * Math.max(0, intensity)));
  const origin = burst.origin === 'random' ? [random() * width, random() * height] : [width / 2, height / 2];
  const heading = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const p = createParticle(width, height, settings, palette, random), angle = heading + (random() - .5) * Math.PI * 2 * burst.spread;
    const speed = burst.speed * (.5 + random() * .5) * intensity;
    Object.assign(p, { x: origin[0], y: origin[1], vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      burst: true, life: 1 + random() * 1.5, level: Math.min(1.8, intensity) });particles.push(p);
  }
  return Math.max(0, count);
}
/** Retiring particles remain until their release envelope ends. No alpha coupling to live count. */
export function stepParticles(particles, { wanted, dt, time, width, height, look, amount, palette = [], panic = false, spawn = true }, random = Math.random) {
  if (panic) { particles.length = 0; return particles; }
  let alive = 0;
  for (const p of particles) if (!p.burst && p.release == null) {
    if (alive++ >= wanted) p.release = 0;
  }
  if (spawn) for (let i = alive; i < wanted && particles.length < 1000; i++) {
    const p = createParticle(width, height, look.particles, palette, random); p.level = Math.min(1.8, amount); particles.push(p);
  }
  let write = 0;
  for (const p of particles) {
    p.age += dt;if (p.release != null) p.release += dt;
    if (p.age >= p.life || p.release >= .65) continue;
    if (p.burst) {
      // Analytic drag keeps burst motion independent of frame rate.
      const drag = Math.exp(-1.8 * dt), distance = (1 - drag) / 1.8;
      p.x += p.vx * distance; p.y += p.vy * distance;p.vx *= drag;p.vy *= drag;
    } else {
      const old = stepParticle({ ...p, life: p.phase }, look, time * 1000, width, height, amount, random);
      p.x = Math.abs(old.x-p.x)>width/2 ? old.x : p.x+(old.x-p.x)*Math.min(3,dt*60);
      p.y = Math.abs(old.y-p.y)>height/2 ? old.y : p.y+(old.y-p.y)*Math.min(3,dt*60);
    }
    particles[write++] = p;
  }
  particles.length = write;return particles;
}
