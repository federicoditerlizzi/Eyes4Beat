import { NEUTRAL_TARGETS } from './routing.js';

const TARGET_KEYS = Object.keys(NEUTRAL_TARGETS);

export function applyPanicTargets(routedTargets, { panic = false, releaseStartedAt = null, now = 0, duration = 300 } = {}) {
  if (panic) return { ...NEUTRAL_TARGETS };
  const routed = { ...NEUTRAL_TARGETS, ...routedTargets };
  if (releaseStartedAt == null) return routed;
  const progress = Math.max(0, Math.min(1, (now - releaseStartedAt) / Math.max(1, duration)));
  const eased = progress * progress * (3 - 2 * progress);
  return Object.fromEntries(TARGET_KEYS.map((key) => [key, NEUTRAL_TARGETS[key] + (routed[key] - NEUTRAL_TARGETS[key]) * eased]));
}
