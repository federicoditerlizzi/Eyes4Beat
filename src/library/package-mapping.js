import { BLOOM_DEFAULTS } from '../bloom.js';
import { blankMap } from '../config.js';
import { normalizeImageConfigStore } from '../image-sequencer.js';
import { lookForProfile, normalizeLook } from '../looks.js';
import { defaultImageConfig, normalizeMusicPresets, normalizeRoutingMap } from './runtime.js';

export function mapImportedMedia(archetype) {
  const originalImages = archetype.imageConfig?.images || [];
  const playbackOrder = originalImages.map((image, index) => ({ index, order: image.order ?? index }))
    .sort((a, b) => a.order - b.order || a.index - b.index).map(item => item.index);
  const media = archetype.media.map((item, position) => ({ ...item,
    sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : (playbackOrder[position] ?? position) }));
  const mappedImages = media.map((item, position) => structuredClone(originalImages[item.sourceIndex] ||
    defaultImageConfig(media.length).images[position]));
  return { media, imageConfig: { ...structuredClone(archetype.imageConfig || {}), images: mappedImages } };
}

export function prepareImportedArchetype(archetype, formatVersion) {
  const mapped = mapImportedMedia(archetype);
  const factoryIndex = Number.isInteger(archetype.profile) ? archetype.profile : 0;
  const fallback = defaultImageConfig(mapped.media.length);
  const imageConfig = normalizeImageConfigStore({ configs: [mapped.imageConfig] }, [fallback]).configs[0];
  const routingMap = normalizeRoutingMap(archetype.routingMap, blankMap());
  return { name: archetype.name, origin: { type: 'import', presetId: archetype.legacyId || archetype.id || null,
    sourceId: archetype.id || archetype.legacyId || null, startingRoutingMap: structuredClone(routingMap) },
    look: normalizeLook({ ...(formatVersion === 1 ? lookForProfile(factoryIndex) : (archetype.look || lookForProfile(factoryIndex))),
      bloom: archetype.look?.bloom || BLOOM_DEFAULTS }),
    routingMap, imageConfig, musicPresets: normalizeMusicPresets(archetype.musicPresets),
    media: mapped.media };
}
