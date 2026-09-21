import { EASINGS, TRANSITIONS, WIPE_DIRECTIONS } from './transitions.js';

export const IMAGE_CONFIG_SCHEMA_VERSION = 3;
export const IMAGE_CONFIG_STORAGE_KEY = 'arv_v045_image_configs';
export const TRANSITION_CUT_THRESHOLD_SECONDS = 0.06;
export const IMAGE_TRIGGER_CLASSES = Object.freeze(['timed', 'event', 'manual']);
export const IMAGE_ORDER_MODES = Object.freeze(['sequential', 'ping-pong', 'random-no-repeat', 'shuffle']);
export const DWELL_BEAT_OPTIONS = Object.freeze([1, 2, 4, 8, 16, 32]);
export const TRANSITION_BEAT_OPTIONS = Object.freeze([.125, .25, .5, 1, 2, 4]);
export const BPM_CONFIDENCE_THRESHOLD = .35;

const transitionIds = new Set(TRANSITIONS.map(({ id }) => id));
const easingIds = new Set(EASINGS.map(({ id }) => id));
const wipeDirections = new Set(WIPE_DIRECTIONS.map(({ id }) => id));
const pickOrders = new Set(['cycle', 'random-no-repeat']);
const orderModes = new Set(IMAGE_ORDER_MODES);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function applyTransitionEasing(progress, easing = 'linear') {
  const x = clamp(numberOr(progress, 0), 0, 1);
  if (easing === 'ease-in-out') return x * x * (3 - 2 * x);
  if (easing === 'ease-out') return 1 - (1 - x) * (1 - x) * (1 - x);
  return x;
}

export function effectiveTransitionDuration(duration, dwell) {
  const requested = clamp(numberOr(duration, 2.2), 0.05, 8);
  const dwellLimit = Math.max(0, numberOr(dwell, requested)) * 0.8;
  return Math.min(requested, dwellLimit);
}

export function transitionRunsAsCut(transitionId, effectiveDuration) {
  return transitionId === 'cut' || effectiveDuration < TRANSITION_CUT_THRESHOLD_SECONDS;
}

export function classifyImageTrigger({ manual = false, mode = 'auto', source = 'energy' } = {}) {
  if (manual) return 'manual';
  return mode === 'mapped' && ['beat', 'kick', 'snare'].includes(source) ? 'event' : 'timed';
}

export function pickTransitionFromPool(config, state = {}, random = Math.random) {
  const pool = [...new Set((config?.pool || []).filter(id => transitionIds.has(id)))];
  const choices = pool.length ? pool : ['crossfade'];
  if (choices.length === 1) return { id: choices[0], state: { cycleIndex: 0, lastId: choices[0] } };
  if (config?.pickOrder === 'random-no-repeat') {
    const available = choices.filter(id => id !== state.lastId);
    const index = Math.min(available.length - 1, Math.floor(clamp(numberOr(random(), 0), 0, .999999) * available.length));
    const id = available[index];
    return { id, state: { cycleIndex: state.cycleIndex || 0, lastId: id } };
  }
  const index = Math.max(0, Math.floor(numberOr(state.cycleIndex, 0))) % choices.length;
  const id = choices[index];
  return { id, state: { cycleIndex: (index + 1) % choices.length, lastId: id } };
}

export function resolvePendingImageRequest(currentPending, nextRequest) {
  if (!nextRequest) return currentPending ? { ...currentPending } : null;
  return { ...nextRequest };
}

export function beatsToSeconds(beats, bpm) {
  return Math.max(0, numberOr(beats, 0)) * 60 / Math.max(1, numberOr(bpm, 120));
}

export function effectiveBeatDwell(beats, bpm, minimumSeconds = 2) {
  let effective = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, numberOr(beats, 1)))));
  while (beatsToSeconds(effective, bpm) < minimumSeconds) effective *= 2;
  return Math.min(32, effective);
}

export function quantizeToBeatGrid(earliestSeconds, anchorSeconds, periodSeconds) {
  const earliest = numberOr(earliestSeconds, 0);
  const period = Math.max(.001, numberOr(periodSeconds, .5));
  const anchor = numberOr(anchorSeconds, earliest);
  if (earliest <= anchor) return anchor;
  return anchor + Math.ceil((earliest - anchor - 1e-9) / period) * period;
}

export function resolveSequencerTempo({ bpm = 0, confidence = 0, lastReliableBpm = 0, threshold = BPM_CONFIDENCE_THRESHOLD } = {}) {
  if (numberOr(bpm, 0) > 0 && numberOr(confidence, 0) >= threshold) return { bpm: Number(bpm), source: 'live', lastReliableBpm: Number(bpm) };
  if (numberOr(lastReliableBpm, 0) > 0) return { bpm: Number(lastReliableBpm), source: 'last', lastReliableBpm: Number(lastReliableBpm) };
  return { bpm: 120, source: 'fallback', lastReliableBpm: 0 };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.min(index, Math.floor(clamp(numberOr(random(), 0), 0, .999999) * (index + 1)));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function nextSequenceIndex({ enabled = [], current = 0, direction = 1, mode = 'sequential', state = {}, random = Math.random } = {}) {
  const values = [...new Set(enabled)];
  if (!values.length) return { index: current, state: { ...state } };
  if (values.length === 1) return { index: values[0], state: { ...state, history: [values[0]], historyCursor: 0 } };
  const normalizedMode = orderModes.has(mode) ? mode : 'sequential';
  const nextState = { pingPongDirection: state.pingPongDirection || 1, shuffleQueue: [...(state.shuffleQueue || [])], shuffleInitialized: !!state.shuffleInitialized, history: [...(state.history || [current])], historyCursor: Number.isInteger(state.historyCursor) ? state.historyCursor : Math.max(0, (state.history || [current]).length - 1) };
  if ((normalizedMode === 'random-no-repeat' || normalizedMode === 'shuffle') && direction < 0) {
    nextState.historyCursor = Math.max(0, nextState.historyCursor - 1);
    return { index: nextState.history[nextState.historyCursor] ?? current, state: nextState };
  }
  if ((normalizedMode === 'random-no-repeat' || normalizedMode === 'shuffle') && nextState.historyCursor < nextState.history.length - 1) {
    nextState.historyCursor += 1;
    return { index: nextState.history[nextState.historyCursor], state: nextState };
  }
  let index;
  const position = Math.max(0, values.indexOf(current));
  if (normalizedMode === 'ping-pong') {
    if (direction < 0) index = values[(position - 1 + values.length) % values.length];
    else {
      let step = nextState.pingPongDirection;
      if (position + step >= values.length || position + step < 0) step *= -1;
      nextState.pingPongDirection = step;
      index = values[position + step];
    }
  } else if (normalizedMode === 'random-no-repeat') {
    const choices = values.filter(value => value !== current);
    index = choices[Math.min(choices.length - 1, Math.floor(clamp(numberOr(random(), 0), 0, .999999) * choices.length))];
  } else if (normalizedMode === 'shuffle') {
    nextState.shuffleQueue = nextState.shuffleQueue.filter(value => values.includes(value) && value !== current);
    if (!nextState.shuffleQueue.length) {
      nextState.shuffleQueue = shuffled(nextState.shuffleInitialized ? values : values.filter(value => value !== current), random);
      nextState.shuffleInitialized = true;
      if (nextState.shuffleQueue[0] === current) nextState.shuffleQueue.push(nextState.shuffleQueue.shift());
    }
    index = nextState.shuffleQueue.shift();
  } else index = values[(position + (direction < 0 ? -1 : 1) + values.length) % values.length];
  if (normalizedMode === 'random-no-repeat' || normalizedMode === 'shuffle') {
    nextState.history = nextState.history.slice(0, nextState.historyCursor + 1);
    nextState.history.push(index);
    nextState.historyCursor = nextState.history.length - 1;
  }
  return { index, state: nextState };
}

function normalizeTriggerConfig(source, fallback) {
  const rawPool = Array.isArray(source?.pool) ? source.pool : fallback.pool;
  const pool = [...new Set(rawPool.filter(id => transitionIds.has(id)))];
  return {
    pool: pool.length ? pool : [...fallback.pool],
    pickOrder: pickOrders.has(source?.pickOrder) ? source.pickOrder : fallback.pickOrder,
    duration: clamp(numberOr(source?.duration, fallback.duration), 0.05, 8),
    durationBeats: TRANSITION_BEAT_OPTIONS.includes(Number(source?.durationBeats)) ? Number(source.durationBeats) : fallback.durationBeats,
    easing: easingIds.has(source?.easing) ? source.easing : fallback.easing,
    wipeDirection: wipeDirections.has(source?.wipeDirection) ? source.wipeDirection : fallback.wipeDirection,
  };
}

function phaseOneTimedConfig(source, fallback) {
  const legacyDuration = source.duration ?? source.crossfade;
  return {
    pool: [transitionIds.has(source.transition) ? source.transition : (source.crossfade != null ? 'crossfade' : fallback.pool[0])],
    pickOrder: 'cycle',
    duration: clamp(numberOr(legacyDuration, fallback.duration), 0.05, 8),
    durationBeats: fallback.durationBeats,
    easing: easingIds.has(source.easing) ? source.easing : (source.crossfade != null ? 'linear' : fallback.easing),
    wipeDirection: wipeDirections.has(source.wipeDirection) ? source.wipeDirection : fallback.wipeDirection,
  };
}

export function normalizeImageConfig(config, defaults, imageCount) {
  const source = config && typeof config === 'object' ? config : {};
  const base = JSON.parse(JSON.stringify(defaults));
  base.mode = ['auto', 'manual', 'mapped'].includes(source.mode) ? source.mode : base.mode;
  base.source = source.source || base.source;
  base.timeBase = source.timeBase === 'beats' ? 'beats' : 'seconds';
  base.orderMode = orderModes.has(source.orderMode) ? source.orderMode : 'sequential';
  base.threshold = clamp(numberOr(source.threshold, base.threshold ?? 0.55), 0.05, 0.95);
  const fallbackTriggers = base.triggers;
  const phaseOne = !source.triggers && (source.transition != null || source.duration != null || source.crossfade != null);
  base.triggers = {
    timed: normalizeTriggerConfig(phaseOne ? phaseOneTimedConfig(source, fallbackTriggers.timed) : source.triggers?.timed, fallbackTriggers.timed),
    event: normalizeTriggerConfig(source.triggers?.event, fallbackTriggers.event),
    manual: normalizeTriggerConfig(source.triggers?.manual, fallbackTriggers.manual),
  };
  base.images = Array.from({ length: imageCount }, (_, index) => {
    const old = source.images?.[index] || {};
    const fallback = base.images?.[index] || { enabled: true, duration: [10, 10, 12, 9, 11][index % 5], order: index };
    return {
      enabled: old.enabled !== false,
      duration: clamp(numberOr(old.duration, fallback.duration), 2, 60),
      durationBeats: DWELL_BEAT_OPTIONS.includes(Number(old.durationBeats)) ? Number(old.durationBeats) : fallback.durationBeats,
      order: Number.isFinite(Number(old.order)) ? Number(old.order) : fallback.order,
    };
  });
  const sorted = base.images.map((image, index) => ({ index, order: image.order })).sort((a, b) => a.order - b.order || a.index - b.index);
  sorted.forEach((item, position) => { base.images[item.index].order = position; });
  delete base.transition;
  delete base.duration;
  delete base.easing;
  delete base.wipeDirection;
  delete base.crossfade;
  return base;
}

export function normalizeImageConfigStore(stored, defaults) {
  const source = Array.isArray(stored) ? stored : (Array.isArray(stored?.configs) ? stored.configs : []);
  return {
    schemaVersion: IMAGE_CONFIG_SCHEMA_VERSION,
    configs: defaults.map((defaultConfig, index) => normalizeImageConfig(source[index], defaultConfig, defaultConfig.images.length)),
  };
}
