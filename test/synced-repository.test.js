import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { SyncedLibraryRepository } from '../src/library/synced-repository.js';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const project = (id = crypto.randomUUID(), version = 1) => ({ id, owner_email: 'a@example.com', name: 'Show', visibility: 'private', archetypeOrder: [], version, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, updated_by: 'a@example.com' });
const archetype = (id, projectId, version = 1) => ({ id, projectId, name: 'Scene', origin: { type: 'blank' }, look: {}, routingMap: {}, imageConfig: {}, musicPresets: [], media: [], version, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, updated_by: 'a@example.com' });

class FakeApi {
  constructor() { this.changeSets = [];this.patches = [];this.media = new Map();this.failUpload = false;this.createdItems = []; }
  async changes(since) { this.lastSince = since;return this.changeSets.shift() || { projects: [], archetypes: [], lookPresets: [], serverTime: '2026-01-01T00:01:00.000Z' }; }
  async patchArchetype(id, data) { this.patches.push({ id, data });if (this.conflict) { const error = new Error('conflict');error.status = 409;error.current = this.conflict;throw error; }return { ...this.remote, id, ...data, version: data.if_version + 1, if_version: undefined, updated_by: 'a@example.com' }; }
  async headMedia(id) { return this.media.has(id); }
  async putMedia(id, blob) { if (this.failUpload) throw new Error('upload failed');this.media.set(id, blob); }
  async createProject(data) { this.currentProject = { ...project(data.id), name: data.name };return this.currentProject; }
  async createArchetype(projectId, data) { this.created = data;this.createdItems.push({ ...data, projectId, version: 1 });return { ...data, projectId, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
  async createLookPreset(_projectId, data) { return { ...data, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
  async project(id) { return { project: { ...(this.currentProject?.id === id ? this.currentProject : project(id)), archetypeOrder: this.createdItems.filter(item => item.projectId === id).map(item => item.id) }, archetypes: this.createdItems.filter(item => item.projectId === id), lookPresets: [] }; }
}
const repo = api => new SyncedLibraryRepository({ api, email: 'a@example.com' });

test('overlapping pulls ignore duplicates, apply newer values, deletions and removed projects', async () => {
  const api = new FakeApi(), sync = repo(api), p = project(), id = crypto.randomUUID();
  api.changeSets.push({ projects: [p], archetypes: [archetype(id, p.id, 2)], lookPresets: [], serverTime: '2026-01-01T00:01:00.000Z' });await sync.pull();
  api.changeSets.push({ projects: [], archetypes: [archetype(id, p.id, 1)], lookPresets: [], serverTime: '2026-01-01T00:02:00.000Z' });await sync.pull();assert.equal((await sync.getArchetype(id)).version, 2);
  api.changeSets.push({ projects: [{ id: p.id, removed: true }], archetypes: [], lookPresets: [], serverTime: '2026-01-01T00:03:00.000Z' });await sync.pull();assert.equal(await sync.getProject(p.id), undefined);
});

test('dirty changes survive offline and push after reconnect', async () => {
  const api = new FakeApi(), sync = repo(api), p = project(), item = archetype(crypto.randomUUID(), p.id);api.remote = item;
  await sync.cache.replaceRecord('archetypes', item);await sync.updateArchetype(item.id, { name: 'Mine' });assert.equal(Object.keys((await sync.syncMeta()).dirty).length, 1);
  sync.online = true;await sync.pushDirty();assert.equal(api.patches[0].data.if_version, 1);assert.equal((await sync.getArchetype(item.id)).name, 'Mine');assert.equal(Object.keys((await sync.syncMeta()).dirty).length, 0);
});

test('409 installs server state and restore requeues local fields', async () => {
  const api = new FakeApi(), sync = repo(api), p = project(), item = archetype(crypto.randomUUID(), p.id);api.remote = item;api.conflict = { ...item, name: 'Server', version: 2 };
  await sync.cache.replaceRecord('archetypes', item);await sync.updateArchetype(item.id, { name: 'Mine' });await sync.pushDirty();assert.equal((await sync.getArchetype(item.id)).name, 'Server');
  api.conflict = null;await sync.restoreConflict(`archetypes:${item.id}`);assert.equal((await sync.getArchetype(item.id)).name, 'Mine');assert.equal(api.patches.at(-1).data.if_version, 2);
});

test('live lock defers active-project changes then applies them', async () => {
  const api = new FakeApi(), sync = repo(api), p = project(), item = archetype(crypto.randomUUID(), p.id, 2);sync.activeProjectId = p.id;await sync.setLiveLock(true);
  api.changeSets.push({ projects: [p], archetypes: [item], lookPresets: [], serverTime: '2026-01-01T00:01:00.000Z' });await sync.pull();assert.equal(await sync.getArchetype(item.id), undefined);assert.equal((await sync.syncMeta()).deferred.length, 2);
  await sync.setLiveLock(false);assert.equal((await sync.getArchetype(item.id)).version, 2);
});

test('media HEAD skips upload and failed upload prevents archetype creation', async () => {
  const api = new FakeApi(), sync = repo(api), p = project(), blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
  await sync.cache.replaceRecord('projects', p);const saved = await sync.putMedia(blob, blob.type), ref = { mediaId: saved.id, name: 'x.png', mime: blob.type, size: blob.size };
  api.media.set(saved.id, blob);await sync.createArchetype(p.id, { ...archetype(crypto.randomUUID(), p.id), media: [ref] });assert.equal(api.media.size, 1);
  const second = await sync.putMedia(new Blob([new Uint8Array([2])], { type: 'image/png' }), 'image/png');api.failUpload = true;await assert.rejects(sync.createArchetype(p.id, { ...archetype(crypto.randomUUID(), p.id), media: [{ mediaId: second.id, name: 'y.png', mime: 'image/png', size: 1 }] }));assert.notEqual(api.created.id, second.id);
});

test('one-time local migration keeps project and archetype ids', async () => {
  const api = new FakeApi(), sync = repo(api), projectId = crypto.randomUUID(), archetypeId = crypto.randomUUID();
  const source = { listProjects: async () => [{ ...project(projectId), archetypeOrder: [archetypeId] }], listLookPresets: async () => [],
    listArchetypes: async () => [{ ...archetype(archetypeId, projectId), media: [] }], getMedia: async () => null };
  const ids = await sync.migrateLocalProjects(source);
  assert.deepEqual(ids, [projectId]);assert.equal(api.currentProject.id, projectId);assert.equal(api.createdItems[0].id, archetypeId);
});

test('different users have isolated IndexedDB caches', async () => {
  const id = crypto.randomUUID(), a = new SyncedLibraryRepository({ api: new FakeApi(), email: 'first@example.com' }), b = new SyncedLibraryRepository({ api: new FakeApi(), email: 'second@example.com' });
  await a.cache.replaceRecord('projects', project(id));
  assert.equal((await a.listProjects()).length, 1);assert.equal((await b.listProjects()).length, 0);
});
