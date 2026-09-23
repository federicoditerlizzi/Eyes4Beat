import { assignedSource, assignTarget } from '../routing.js';
import { blankMap, routeSources, routeTargets } from '../config.js';
import { normalizeImageConfigStore } from '../image-sequencer.js';
import { FACTORY_LOOKS, normalizeLook } from '../looks.js';

const copy = value => structuredClone(value);

export function starterRoutingForOrigin(origin) {
  if (origin?.type === 'factory') {
    const preset = FACTORY_LOOKS.find(item => item.id === origin.presetId);
    return normalizeRoutingMap(preset?.starter.routingMap);
  }
  if (origin?.type === 'import' && origin.startingRoutingMap) return normalizeRoutingMap(origin.startingRoutingMap);
  return blankMap();
}

export function normalizeRoutingMap(source, fallback = blankMap()) {
  const map = blankMap();
  for (const src of routeSources) for (const target of routeTargets) {
    const value = Number(source?.[src]?.[target]);
    map[src][target] = Number.isFinite(value) ? Math.max(-1.5, Math.min(1.5, value)) : Number(fallback?.[src]?.[target]) || 0;
  }
  for (const target of routeTargets) {
    const selected = assignedSource(map, target);
    assignTarget(map, target, selected, selected ? map[selected][target] : 0);
  }
  return map;
}

export function defaultImageConfig(count, imageSource = 'boombap') {
  const transition = (pool, duration = 2.2) => ({ pool, pickOrder: 'cycle', duration, durationBeats: .5, easing: 'linear', wipeDirection: 'left' });
  return { mode: 'auto', source: imageSource, timeBase: 'seconds', orderMode: 'sequential',
    triggers: { timed: transition(['crossfade']), event: transition(['cut'], .05), manual: transition(['crossfade']) }, threshold: .55,
    images: Array.from({ length: count }, (_, index) => ({ enabled: true, duration: [10,10,12,9,11][index % 5], durationBeats: 4, order: index })) };
}

export function normalizeMusicPresets(value) {
  return Array.isArray(value) ? value.filter(preset => preset && typeof preset.name === 'string' && preset.name.trim())
    .map(preset => copy(preset)) : [];
}

export function buildProjectRuntime(project, records, mediaSource = media => media.mediaId) {
  const byId = new Map(records.filter(item => !item.deletedAt && item.projectId === project.id).map(item => [item.id, item]));
  const ordered = project.archetypeOrder.map(id => byId.get(id)).filter(Boolean);
  const ids = ordered.map(item => item.id), idToIndex = new Map(ids.map((id, index) => [id, index]));
  const archetypes = ordered.map(item => ({ id: item.id, name: item.name, origin: copy(item.origin) }));
  const imageSets = ordered.map(item => item.media.map(media => mediaSource(media) ?? {
    url: null, type: media.mime, name: media.name, mediaId: media.mediaId, missing: true,
  }));
  const defaultRoutingMaps = ordered.map(item => starterRoutingForOrigin(item.origin));
  const routingMaps = ordered.map((item, index) => normalizeRoutingMap(item.routingMap, defaultRoutingMaps[index]));
  const defaultImageConfigs = ordered.map((item, index) => defaultImageConfig(item.media.length,
    FACTORY_LOOKS.find(preset => preset.id === item.origin?.presetId)?.starter.imageSource || 'boombap'));
  const imageConfigs = normalizeImageConfigStore({ configs: ordered.map(item => item.imageConfig) }, defaultImageConfigs).configs;
  return { ids, idToIndex, archetypes, IMAGE_SETS: imageSets, defaultRoutingMaps, routingMaps,
    defaultImageConfigs, imageConfigs, musicPresets: ordered.map(item => normalizeMusicPresets(item.musicPresets)),
    looks: ordered.map(item => normalizeLook(item.look)) };
}

export function resolveShowIndexes(state, activeProjectId, idToIndex) {
  if (!state || state.projectId !== activeProjectId) return null;
  const current = idToIndex.get(state.currentId), target = idToIndex.get(state.targetId);
  return Number.isInteger(current) && Number.isInteger(target) ? { current, target } : null;
}
