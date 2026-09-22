import { loadCustomArchetypes } from '../custom-archetypes.js';
import { IMAGE_CONFIG_STORAGE_KEY, normalizeImageConfigStore } from '../image-sequencer.js';
import { FACTORY_LOOKS, LOOK_STORAGE_KEY, lookForArchetype, normalizeLook } from '../looks.js';
import { defaultImageConfig, normalizeRoutingMap } from '../library/runtime.js';
import { LEGACY_IMAGE_SETS, LEGACY_NAMES } from './library.js';

function savedJson(keys) {
  for (const key of keys) try { const value = localStorage.getItem(key);if(value)return JSON.parse(value) } catch {}
  return null;
}

export async function legacyDataAvailable() {
  for (let index = 0; index < localStorage.length; index++) if (localStorage.key(index)?.startsWith('arv_')) return true;
  return (await loadCustomArchetypes()).length > 0;
}

export async function collectLegacyLibrary({ builtinsOnly = false } = {}) {
  const customs = builtinsOnly ? [] : await loadCustomArchetypes();
  const sourceSets = [...LEGACY_IMAGE_SETS, ...customs.map(record => record.media || record.images || [])];
  const names = [...LEGACY_NAMES, ...customs.map(record => record.name)];
  const routing = builtinsOnly ? [] : savedJson(['arv_v043_routing_maps','arv_v042_routing_maps','arv_v041_routing_maps']) || [];
  const storedConfigs = builtinsOnly ? null : savedJson([IMAGE_CONFIG_STORAGE_KEY,'arv_v043_image_configs','arv_v042b_image_configs','arv_v042_image_configs']);
  const presets = builtinsOnly ? [] : savedJson(['arv_v044_music_presets']) || [];
  const storedLooks = builtinsOnly ? [] : savedJson([LOOK_STORAGE_KEY]) || [];
  const defaults = sourceSets.map((set, index) => defaultImageConfig(set.length, FACTORY_LOOKS[customs[index - 6]?.templateIndex ?? index]?.starter.imageSource));
  const configs = normalizeImageConfigStore(storedConfigs || { configs: defaults }, defaults).configs;
  return names.map((name, index) => {
    const record = customs[index - 6], profile = record?.templateIndex ?? index;
    const factory = FACTORY_LOOKS[profile] || FACTORY_LOOKS[0], mediaSources = sourceSets[index];
    const media = configs[index].images.map((image, sourceIndex) => ({ sourceIndex, order: image.order ?? sourceIndex }))
      .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex).map(({ sourceIndex }) => {
        const source = mediaSources[sourceIndex];
        return typeof source === 'string' ? { sourceIndex, name: source.split('/').at(-1), mime: '', url: new URL(source, location.href).href } :
          { sourceIndex, name: source.name || `media-${sourceIndex + 1}`, mime: source.type || 'application/octet-stream', blob: source };
      });
    return { kind: record ? 'custom' : 'builtin', legacyIndex: index, legacyId: record?.id || factory.id,
      name, profile: Math.min(5,Math.max(0,profile)), templateIndex: record?.templateIndex ?? null, behavior: {},
      look: normalizeLook(storedLooks[index] || lookForArchetype(record ? { customId: record.id, templateIndex: record.templateIndex } : {}, index)),
      routingMap: normalizeRoutingMap(routing[index], factory.starter.routingMap), imageConfig: configs[index],
      musicPresets: Array.isArray(presets[index]) ? presets[index] : [], media };
  });
}
