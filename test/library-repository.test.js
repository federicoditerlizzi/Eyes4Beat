import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalLibraryRepository } from '../src/library/local-repository.js';
import { NEUTRAL_LOOK } from '../src/looks.js';
import { blankMap } from '../src/config.js';
import { defaultImageConfig } from '../src/library/runtime.js';

test('project and archetype CRUD use soft deletes and versioned writes', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const project = await repo.createProject('Set A');
    assert.equal(project.version, 1);
    assert.equal(project.ownerId, null);
    assert.equal(project.visibility, 'private');
    const renamed = await repo.updateProject(project.id, { name: 'Set B' });
    assert.equal(renamed.version, 2);
    const archetype = await repo.createArchetype(project.id, { name: 'Pulse', look: NEUTRAL_LOOK,
      routingMap: blankMap(), imageConfig: defaultImageConfig(0), media: [] });
    assert.deepEqual((await repo.getProject(project.id)).archetypeOrder, [archetype.id]);
    assert.equal((await repo.updateArchetype(archetype.id, { name: 'Pulse 2' })).version, 2);
    await repo.deleteArchetype(archetype.id);
    assert.equal((await repo.listArchetypes(project.id)).length, 0);
    assert.ok((await repo.getArchetype(archetype.id)).deletedAt);
    await repo.deleteProject(project.id);
    assert.equal((await repo.listProjects()).length, 0);
    assert.ok((await repo.getProject(project.id)).deletedAt);
  } finally { await repo.close(); }
});

test('media is content-addressed and duplicates share its record', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const blob = new Blob(['same image'], { type: 'image/png' });
    const first = await repo.putMedia(blob), second = await repo.putMedia(blob);
    assert.equal(first.id, second.id);
    const project = await repo.createProject('Original');
    const preset = await repo.createLookPreset(project.id, 'Shared look', NEUTRAL_LOOK);
    const item = await repo.createArchetype(project.id, { name: 'Scene', look: NEUTRAL_LOOK,
      origin: { type: 'project-preset', presetId: preset.id }, routingMap: blankMap(), imageConfig: defaultImageConfig(1), media: [{ mediaId: first.id, name: 'scene.png', mime: 'image/png', size: blob.size }] });
    const copy = await repo.duplicateArchetype(item.id);
    assert.notEqual(copy.id, item.id);
    assert.equal(copy.media[0].mediaId, first.id);
    const projectCopy = await repo.duplicateProject(project.id);
    const copies = await repo.listArchetypes(projectCopy.id);
    assert.equal(copies.length, 2);
    assert.ok(copies.every(entry => entry.media[0].mediaId === first.id));
    const copiedPreset = (await repo.listLookPresets(projectCopy.id))[0];
    assert.notEqual(copiedPreset.id, preset.id);
    assert.equal(copies[0].origin.presetId, copiedPreset.id);
    assert.equal((await repo.getMedia(first.id)).size, blob.size);
  } finally { await repo.close(); }
});

test('project look presets are versioned and soft-deleted', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const project = await repo.createProject('Looks');
    const preset = await repo.createLookPreset(project.id, 'Soft', NEUTRAL_LOOK);
    assert.equal((await repo.updateLookPreset(preset.id, { name: 'Hard' })).version, 2);
    await repo.deleteLookPreset(preset.id);
    assert.equal((await repo.listLookPresets(project.id)).length, 0);
    assert.ok((await repo.get('lookPresets', preset.id)).deletedAt);
  } finally { await repo.close(); }
});
