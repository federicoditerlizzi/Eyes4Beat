import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankMap } from '../src/config.js';
import { FACTORY_LOOKS, NEUTRAL_LOOK } from '../src/looks.js';
import { buildProjectRuntime, defaultImageConfig, resolveShowIndexes, starterRoutingForOrigin } from '../src/library/runtime.js';
import { mapImportedMedia, prepareImportedArchetype } from '../src/library/package-mapping.js';
import { buildLibraryPackage, readPackage, verifyLibraryPackage } from '../src/package-format.js';

test('project order builds aligned runtime arrays and id-based show indexes', () => {
  const project = { id: 'project', archetypeOrder: ['b', 'a'] };
  const records = ['a', 'b'].map(id => ({ id, projectId: 'project', name: id, origin: { type: 'blank' },
    look: NEUTRAL_LOOK, routingMap: blankMap(), imageConfig: defaultImageConfig(1), musicPresets: [],
    media: [{ mediaId: `media-${id}`, name: id, mime: 'image/png', size: 1 }] }));
  const runtime = buildProjectRuntime(project, records);
  assert.deepEqual(runtime.archetypes.map(item => item.id), ['b', 'a']);
  assert.deepEqual(runtime.IMAGE_SETS, [['media-b'], ['media-a']]);
  assert.deepEqual(resolveShowIndexes({ projectId: 'project', currentId: 'a', targetId: 'b' }, 'project', runtime.idToIndex), { current: 1, target: 0 });
  assert.equal(resolveShowIndexes({ projectId: 'other', currentId: 'a', targetId: 'b' }, 'project', runtime.idToIndex), null);
  assert.equal(buildProjectRuntime({ id: 'empty', archetypeOrder: [] }, []).archetypes.length, 0);
});

test('missing media resolves to a placeholder without dropping the archetype', () => {
  const project = { id: 'project', archetypeOrder: ['scene'] };
  const record = { id: 'scene', projectId: project.id, name: 'Scene', origin: { type: 'blank' },
    look: NEUTRAL_LOOK, routingMap: blankMap(), imageConfig: defaultImageConfig(2), musicPresets: [],
    media: [{ mediaId: 'missing', name: 'lost.png', mime: 'image/png' }, { mediaId: 'present', name: 'good.png', mime: 'image/png' }] };
  const runtime = buildProjectRuntime(project, [record], media => media.mediaId === 'present' ? { url: 'blob:present' } : null);
  assert.equal(runtime.archetypes.length, 1);
  assert.equal(runtime.IMAGE_SETS[0][0].missing, true);
  assert.equal(runtime.IMAGE_SETS[0][0].name, 'lost.png');
  assert.equal(runtime.IMAGE_SETS[0][1].url, 'blob:present');
});

test('factory starter routing and imported source mapping preserve reordered image settings', () => {
  assert.deepEqual(starterRoutingForOrigin({ type: 'factory', presetId: FACTORY_LOOKS[0].id }), FACTORY_LOOKS[0].starter.routingMap);
  const source = { name: 'Reordered', profile: 2, routingMap: blankMap(), musicPresets: [],
    imageConfig: { ...defaultImageConfig(3), images: [
      { enabled: false, duration: 5, order: 2 }, { enabled: true, duration: 7, order: 0 }, { enabled: false, duration: 9, order: 1 },
    ] }, media: [{ name: 'one', sourceIndex: 1 }, { name: 'two', sourceIndex: 2 }, { name: 'three', sourceIndex: 0 }] };
  assert.deepEqual(mapImportedMedia(source).imageConfig.images.map(item => item.duration), [7, 9, 5]);
  const withoutIndexes = { ...source, media: source.media.map(({ name }) => ({ name })) };
  assert.deepEqual(mapImportedMedia(withoutIndexes).imageConfig.images.map(item => item.duration), [7, 9, 5]);
  const imported = prepareImportedArchetype(withoutIndexes, 1);
  assert.equal(imported.look.particles.motion, FACTORY_LOOKS[2].look.particles.motion);
  assert.deepEqual(imported.imageConfig.images.map(item => item.enabled), [true, false, false]);
});

test('project v3 ZIP round trip preserves settings and ordered media', async () => {
  const original = { id: 'old-id', name: 'Loop', origin: { type: 'factory', presetId: FACTORY_LOOKS[1].id },
    look: FACTORY_LOOKS[1].look, routingMap: FACTORY_LOOKS[1].starter.routingMap,
    imageConfig: { ...defaultImageConfig(2), images: [{ enabled: false, duration: 8, durationBeats: 4, order: 1 }, { enabled: true, duration: 12, durationBeats: 4, order: 0 }] },
    musicPresets: [{ name: 'Low', enabled: { energy: false } }],
    media: [{ name: 'second.png', mime: 'image/png', sourceIndex: 0, bytes: new TextEncoder().encode('second') },
      { name: 'first.png', mime: 'image/png', sourceIndex: 1, bytes: new TextEncoder().encode('first') }] };
  const built = await buildLibraryPackage({ archetypes: [original], kind: 'project', project: { name: 'Live' },
    lookPresets: [{ id: 'preset', name: 'Color', look: NEUTRAL_LOOK }], appVersion: 'test', userAgent: 'test' });
  assert.equal((await verifyLibraryPackage(built.zip)).valid, true);
  const { manifest, files } = readPackage(built.zip);
  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.project.name, 'Live');
  const imported = prepareImportedArchetype(manifest.archetypes[0], 3);
  assert.equal(imported.name, original.name);
  assert.deepEqual(imported.look, original.look);
  assert.deepEqual(imported.routingMap, original.routingMap);
  assert.deepEqual(imported.musicPresets, original.musicPresets);
  assert.deepEqual(imported.imageConfig.images, original.imageConfig.images);
  assert.deepEqual(imported.media.map(item => item.name), original.media.map(item => item.name));
  assert.deepEqual(imported.media.map(item => new TextDecoder().decode(files[item.path])), ['second', 'first']);
});
