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

test('concurrent archetype creation retains every id in project order', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const project = await repo.createProject('Concurrent');
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => repo.createArchetype(project.id, {
      name: `Scene ${index}`, look: NEUTRAL_LOOK, routingMap: blankMap(), imageConfig: defaultImageConfig(0), media: [],
    })));
    const order = (await repo.getProject(project.id)).archetypeOrder;
    assert.equal(order.length, created.length);
    assert.deepEqual(new Set(order), new Set(created.map(item => item.id)));
    assert.equal((await repo.getProject(project.id)).version, created.length + 1);
  } finally { await repo.close(); }
});

test('failed batch import rolls back project, archetypes and media', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const blob = new Blob(['frame'], { type: 'image/png' });
    await assert.rejects(repo.importBatch({ projectName: 'Broken import', archetypes: [{
      name: 'Broken scene', origin: { type: 'import', presetId: null }, look: { invalid: () => {} },
      routingMap: blankMap(), imageConfig: defaultImageConfig(1), musicPresets: [],
      media: [{ name: 'frame.png', mime: 'image/png', blob }],
    }] }));
    assert.deepEqual(await repo.listProjects(), []);
    assert.deepEqual(await repo.getAll('archetypes'), []);
    assert.deepEqual(await repo.getAll('media'), []);
  } finally { await repo.close(); }
});

test('failed import into an existing project leaves its order unchanged', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const project = await repo.createProject('Existing');
    const original = await repo.createArchetype(project.id, { name: 'Original', look: NEUTRAL_LOOK,
      routingMap: blankMap(), imageConfig: defaultImageConfig(0), media: [] });
    await assert.rejects(repo.importBatch({ projectId: project.id, archetypes: [{
      name: 'Bad', origin: { type: 'import', presetId: null }, look: { invalid: () => {} },
      routingMap: blankMap(), imageConfig: defaultImageConfig(0), musicPresets: [], media: [],
    }] }));
    assert.deepEqual((await repo.getProject(project.id)).archetypeOrder, [original.id]);
    assert.deepEqual((await repo.listArchetypes(project.id)).map(item => item.id), [original.id]);
  } finally { await repo.close(); }
});

test('failed composite delete leaves project and archetypes active', async () => {
  const repo = new LocalLibraryRepository(`test-${crypto.randomUUID()}`);
  try {
    const project = await repo.createProject('Keep');
    const item = await repo.createArchetype(project.id, { name: 'Keep scene', look: NEUTRAL_LOOK,
      routingMap: blankMap(), imageConfig: defaultImageConfig(0), media: [] });
    await assert.rejects(repo.serializeWrite(() => repo.write(['projects', 'archetypes'], (transaction, finish, abort) => {
      const store = transaction.objectStore('projects');
      store.put({ ...project, deletedAt: new Date().toISOString() });
      abort(new Error('Injected failure'));
      finish(null);
    })), /Injected failure/);
    assert.equal((await repo.getProject(project.id)).deletedAt, null);
    assert.equal((await repo.getArchetype(item.id)).deletedAt, null);
  } finally { await repo.close(); }
});

test('a schema upgrade in another tab closes the old connection', async () => {
  const name = `test-${crypto.randomUUID()}`;
  let notified = 0;
  const repo = new LocalLibraryRepository(name, () => { notified++; });
  await repo.database();
  const upgraded = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(notified, 1);
  upgraded.close();
  await repo.close();
});
