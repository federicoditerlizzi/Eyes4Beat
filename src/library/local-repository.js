import { sha256 } from '../package-format.js';
import { LibraryRepository } from './repository.js';

export const LIBRARY_DATABASE = 'eyes4beat-library';
export const LIBRARY_SCHEMA_VERSION = 1;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const copy = value => structuredClone(value);

export class LocalLibraryRepository extends LibraryRepository {
  constructor(name = LIBRARY_DATABASE) { super(); this.name = name; this.connection = null; }

  async database() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, LIBRARY_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ['projects', 'archetypes', 'media', 'lookPresets', 'meta']) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.connection;
  }

  async request(store, mode, operation) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || request?.error);
      transaction.onabort = () => reject(transaction.error || new Error('Library transaction aborted'));
    });
  }

  get(store, key) { return this.request(store, 'readonly', objectStore => objectStore.get(key)); }
  getAll(store) { return this.request(store, 'readonly', objectStore => objectStore.getAll()); }
  put(store, value) { return this.request(store, 'readwrite', objectStore => objectStore.put(value)); }

  async listProjects() { return (await this.getAll('projects')).filter(project => !project.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  getProject(projectId) { return this.get('projects', projectId); }
  async createProject(name) {
    const date = now(), project = { id: id(), name: String(name).trim(), ownerId: null, visibility: 'private', archetypeOrder: [], createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!project.name) throw new Error('Project name is required');
    await this.put('projects', project); return project;
  }
  async updateProject(projectId, changes) {
    const current = await this.getProject(projectId);
    if (!current || current.deletedAt) throw new Error('Project not found');
    const next = { ...current, ...copy(changes), id: current.id, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
    await this.put('projects', next); return next;
  }
  async deleteProject(projectId) {
    const project = await this.updateProject(projectId, { deletedAt: now() });
    for (const archetype of await this.listArchetypes(projectId)) await this.updateArchetype(archetype.id, { deletedAt: now() });
    for (const preset of await this.listLookPresets(projectId)) await this.updateLookPreset(preset.id, { deletedAt: now() });
    if ((await this.getMeta()).lastActiveProjectId === projectId) await this.setActiveProject(null);
    return project;
  }
  async duplicateProject(projectId, name) {
    const source = await this.getProject(projectId);
    if (!source || source.deletedAt) throw new Error('Project not found');
    const duplicate = await this.createProject(name || `${source.name} copy`);
    const presetIds = new Map();
    for (const preset of await this.listLookPresets(projectId)) {
      const created = await this.createLookPreset(duplicate.id, preset.name, preset.look);
      presetIds.set(preset.id, created.id);
    }
    const originals = new Map((await this.listArchetypes(projectId)).map(item => [item.id, item]));
    for (const archetypeId of source.archetypeOrder) {
      const item = originals.get(archetypeId);if (!item) continue;
      const origin = copy(item.origin);
      if (origin.type === 'project-preset' && presetIds.has(origin.presetId)) origin.presetId = presetIds.get(origin.presetId);
      await this.createArchetype(duplicate.id, { ...copy(item), origin });
    }
    return this.getProject(duplicate.id);
  }

  async listArchetypes(projectId) { return (await this.getAll('archetypes')).filter(item => item.projectId === projectId && !item.deletedAt); }
  getArchetype(archetypeId) { return this.get('archetypes', archetypeId); }
  async createArchetype(projectId, data) {
    const project = await this.getProject(projectId);if (!project || project.deletedAt) throw new Error('Project not found');
    const date = now(), item = { id: id(), projectId, name: String(data.name || '').trim(),
      origin: copy(data.origin || { type: 'blank', presetId: null }), look: copy(data.look), routingMap: copy(data.routingMap),
      imageConfig: copy(data.imageConfig), musicPresets: copy(data.musicPresets || []), media: copy(data.media || []),
      createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!item.name) throw new Error('Archetype name is required');
    await this.put('archetypes', item);
    await this.updateProject(projectId, { archetypeOrder: [...project.archetypeOrder, item.id] });
    return item;
  }
  async updateArchetype(archetypeId, changes) {
    const current = await this.getArchetype(archetypeId);
    if (!current || current.deletedAt) throw new Error('Archetype not found');
    const next = { ...current, ...copy(changes), id: current.id, projectId: current.projectId, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
    await this.put('archetypes', next); return next;
  }
  async duplicateArchetype(archetypeId) {
    const item = await this.getArchetype(archetypeId);
    if (!item || item.deletedAt) throw new Error('Archetype not found');
    return this.createArchetype(item.projectId, { ...copy(item), name: `${item.name} copy`, origin: copy(item.origin) });
  }
  async deleteArchetype(archetypeId) {
    const item = await this.getArchetype(archetypeId);
    if (!item || item.deletedAt) throw new Error('Archetype not found');
    await this.updateArchetype(archetypeId, { deletedAt: now() });
    const project = await this.getProject(item.projectId);
    await this.updateProject(item.projectId, { archetypeOrder: project.archetypeOrder.filter(value => value !== archetypeId) });
  }
  async reorderArchetypes(projectId, ids) {
    const project = await this.getProject(projectId);
    if (!project || project.deletedAt) throw new Error('Project not found');
    if (ids.length !== project.archetypeOrder.length || new Set(ids).size !== ids.length || ids.some(value => !project.archetypeOrder.includes(value))) throw new Error('Invalid archetype order');
    return this.updateProject(projectId, { archetypeOrder: [...ids] });
  }

  async putMedia(blob, mime = blob.type || 'application/octet-stream') {
    const mediaId = await sha256(await blob.arrayBuffer());
    const existing = await this.getMedia(mediaId);if (existing) return existing;
    const item = { id: mediaId, blob, mime, size: blob.size, createdAt: now() };
    await this.put('media', item);return item;
  }
  getMedia(mediaId) { return this.get('media', mediaId); }

  async listLookPresets(projectId) { return (await this.getAll('lookPresets')).filter(item => item.projectId === projectId && !item.deletedAt); }
  async createLookPreset(projectId, name, look) {
    const project = await this.getProject(projectId);if (!project || project.deletedAt) throw new Error('Project not found');
    const date = now(), preset = { id: id(), projectId, name: String(name).trim(), look: copy(look), createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!preset.name) throw new Error('Preset name is required');
    await this.put('lookPresets', preset);return preset;
  }
  async updateLookPreset(presetId, changes) {
    const current = await this.get('lookPresets', presetId);
    if (!current || current.deletedAt) throw new Error('Preset not found');
    const next = { ...current, ...copy(changes), id: current.id, projectId: current.projectId, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
    await this.put('lookPresets', next);return next;
  }
  async deleteLookPreset(presetId) { return this.updateLookPreset(presetId, { deletedAt: now() }); }

  async getMeta() { return (await this.get('meta', 'settings')) || { key: 'settings', schemaVersion: LIBRARY_SCHEMA_VERSION, lastActiveProjectId: null }; }
  async setActiveProject(projectId) { const meta = await this.getMeta();await this.put('meta', { ...meta, lastActiveProjectId: projectId }); }
  async close() { (await this.database()).close();this.connection = null; }
}
