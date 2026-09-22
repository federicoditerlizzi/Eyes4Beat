import { sha256 } from '../package-format.js';
import { LibraryRepository } from './repository.js';

export const LIBRARY_DATABASE = 'eyes4beat-library';
export const LIBRARY_SCHEMA_VERSION = 1;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const copy = value => structuredClone(value);

export class LocalLibraryRepository extends LibraryRepository {
  constructor(name = LIBRARY_DATABASE, onVersionChange = () => {}) { super(); this.name = name; this.connection = null; this.writeQueue = Promise.resolve(); this.onVersionChange = onVersionChange; }

  async database() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, LIBRARY_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ['projects', 'archetypes', 'media', 'lookPresets', 'meta']) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.connection = null; this.onVersionChange(); };
        resolve(request.result);
      };
      request.onerror = () => { this.connection = null; reject(request.error); };
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
  replaceRecord(store, value) { return this.serializeWrite(() => this.write([store], (transaction, finish) => { transaction.objectStore(store).put(copy(value));finish(value); })); }
  removeRecord(store, key) { return this.serializeWrite(() => this.write([store], (transaction, finish) => { transaction.objectStore(store).delete(key);finish(key); })); }
  removeProjectCache(projectId) { return this.serializeWrite(() => this.write(['projects', 'archetypes', 'lookPresets'], (transaction, finish) => {
    transaction.objectStore('projects').delete(projectId);
    for (const storeName of ['archetypes', 'lookPresets']) {
      const store = transaction.objectStore(storeName);store.getAll().onsuccess = event => event.target.result.filter(item => item.projectId === projectId).forEach(item => store.delete(item.id));
    }
    finish(projectId);
  })); }
  serializeWrite(action) {
    const result = this.writeQueue.then(action);
    this.writeQueue = result.catch(() => {});
    return result;
  }
  async write(stores, operation) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite');
      let result, failure;
      const finish = value => { result = value; };
      const abort = error => { failure = error; transaction.abort(); };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Library transaction aborted'));
      transaction.onerror = () => { failure ||= transaction.error; };
      try { operation(transaction, finish, abort); } catch (error) { abort(error); }
    });
  }
  put(store, value) { return this.serializeWrite(() => this.write(store, (transaction, finish) => { transaction.objectStore(store).put(value);finish(value.id || value.key); })); }

  async listProjects() { return (await this.getAll('projects')).filter(project => !project.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  getProject(projectId) { return this.get('projects', projectId); }
  async createProject(name) {
    const date = now(), project = { id: id(), name: String(name).trim(), ownerId: null, visibility: 'private', archetypeOrder: [], createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!project.name) throw new Error('Project name is required');
    await this.put('projects', project); return project;
  }
  async updateProject(projectId, changes) {
    return this.serializeWrite(() => this.write(['projects'], (transaction, finish, abort) => {
      const store = transaction.objectStore('projects');
      store.get(projectId).onsuccess = event => {
        const current = event.target.result;
        if (!current || current.deletedAt) return abort(new Error('Project not found'));
        const next = { ...current, ...copy(changes), id: current.id, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
        store.put(next);finish(next);
      };
    }));
  }
  async deleteProject(projectId) {
    return this.serializeWrite(() => this.write(['projects', 'archetypes', 'lookPresets', 'meta'], (transaction, finish, abort) => {
      const projects = transaction.objectStore('projects'), archetypes = transaction.objectStore('archetypes');
      const presets = transaction.objectStore('lookPresets'), meta = transaction.objectStore('meta');
      const results = {}, receive = (key, request) => { request.onsuccess = () => { results[key] = request.result; if (Object.keys(results).length === 4) apply(); }; };
      receive('project', projects.get(projectId));receive('archetypes', archetypes.getAll());receive('presets', presets.getAll());receive('meta', meta.get('settings'));
      function apply() {
        const current = results.project;if (!current || current.deletedAt) return abort(new Error('Project not found'));
        const date = now(), project = { ...current, deletedAt: date, updatedAt: date, version: current.version + 1 };
        projects.put(project);
        for (const item of results.archetypes.filter(item => item.projectId === projectId && !item.deletedAt))
          archetypes.put({ ...item, deletedAt: date, updatedAt: date, version: item.version + 1 });
        for (const item of results.presets.filter(item => item.projectId === projectId && !item.deletedAt))
          presets.put({ ...item, deletedAt: date, updatedAt: date, version: item.version + 1 });
        if (results.meta?.lastActiveProjectId === projectId) meta.put({ ...results.meta, lastActiveProjectId: null });
        finish(project);
      }
    }));
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
    const date = now(), item = { id: id(), projectId, name: String(data.name || '').trim(),
      origin: copy(data.origin || { type: 'blank', presetId: null }), look: copy(data.look), routingMap: copy(data.routingMap),
      imageConfig: copy(data.imageConfig), musicPresets: copy(data.musicPresets || []), media: copy(data.media || []),
      createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!item.name) throw new Error('Archetype name is required');
    return this.serializeWrite(() => this.write(['projects', 'archetypes'], (transaction, finish, abort) => {
      const projects = transaction.objectStore('projects');
      projects.get(projectId).onsuccess = event => {
        const project = event.target.result;if (!project || project.deletedAt) return abort(new Error('Project not found'));
        transaction.objectStore('archetypes').put(item);
        projects.put({ ...project, archetypeOrder: [...project.archetypeOrder, item.id], version: project.version + 1, updatedAt: now() });
        finish(item);
      };
    }));
  }
  async updateArchetype(archetypeId, changes) {
    return this.serializeWrite(() => this.write(['archetypes'], (transaction, finish, abort) => {
      const store = transaction.objectStore('archetypes');
      store.get(archetypeId).onsuccess = event => {
        const current = event.target.result;if (!current || current.deletedAt) return abort(new Error('Archetype not found'));
        const next = { ...current, ...copy(changes), id: current.id, projectId: current.projectId, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
        store.put(next);finish(next);
      };
    }));
  }
  async duplicateArchetype(archetypeId) {
    return this.serializeWrite(() => this.write(['projects', 'archetypes'], (transaction, finish, abort) => {
      const archetypes = transaction.objectStore('archetypes'), projects = transaction.objectStore('projects');
      archetypes.get(archetypeId).onsuccess = event => {
        const source = event.target.result;if (!source || source.deletedAt) return abort(new Error('Archetype not found'));
        projects.get(source.projectId).onsuccess = projectEvent => {
          const project = projectEvent.target.result;if (!project || project.deletedAt) return abort(new Error('Project not found'));
          const date = now(), duplicate = { ...copy(source), id: id(), name: `${source.name} copy`, createdAt: date, updatedAt: date, version: 1, deletedAt: null };
          archetypes.put(duplicate);projects.put({ ...project, archetypeOrder: [...project.archetypeOrder, duplicate.id], updatedAt: date, version: project.version + 1 });finish(duplicate);
        };
      };
    }));
  }
  async deleteArchetype(archetypeId) {
    return this.serializeWrite(() => this.write(['projects', 'archetypes'], (transaction, finish, abort) => {
      const archetypes = transaction.objectStore('archetypes'), projects = transaction.objectStore('projects');
      archetypes.get(archetypeId).onsuccess = event => {
        const item = event.target.result;if (!item || item.deletedAt) return abort(new Error('Archetype not found'));
        projects.get(item.projectId).onsuccess = projectEvent => {
          const project = projectEvent.target.result;if (!project || project.deletedAt) return abort(new Error('Project not found'));
          const date = now();archetypes.put({ ...item, deletedAt: date, updatedAt: date, version: item.version + 1 });
          projects.put({ ...project, archetypeOrder: project.archetypeOrder.filter(value => value !== archetypeId), updatedAt: date, version: project.version + 1 });finish(item);
        };
      };
    }));
  }
  async reorderArchetypes(projectId, ids) {
    return this.serializeWrite(() => this.write(['projects', 'archetypes'], (transaction, finish, abort) => {
      const projects = transaction.objectStore('projects');
      projects.get(projectId).onsuccess = event => {
        const project = event.target.result;if (!project || project.deletedAt) return abort(new Error('Project not found'));
        if (ids.length !== project.archetypeOrder.length || new Set(ids).size !== ids.length || ids.some(value => !project.archetypeOrder.includes(value))) return abort(new Error('Invalid archetype order'));
        const next = { ...project, archetypeOrder: [...ids], updatedAt: now(), version: project.version + 1 };projects.put(next);finish(next);
      };
    }));
  }

  async putMedia(blob, mime = blob.type || 'application/octet-stream') {
    const mediaId = await sha256(await blob.arrayBuffer());
    const item = { id: mediaId, blob, mime, size: blob.size, createdAt: now() };
    return this.serializeWrite(() => this.write(['media'], (transaction, finish) => {
      const store = transaction.objectStore('media');store.get(mediaId).onsuccess = event => {
        if (!event.target.result) store.put(item);finish(event.target.result || item);
      };
    }));
  }
  getMedia(mediaId) { return this.get('media', mediaId); }

  async importBatch({ projectId = null, projectName = '', archetypes: entries, lookPresets = [] }) {
    const date = now(), destinationId = projectId || id(), mediaRecords = new Map();
    const archetypeRecords = [];
    for (const source of entries) {
      const media = [];
      for (const ref of source.media) {
        const mediaId = await sha256(await ref.blob.arrayBuffer());
        if (!mediaRecords.has(mediaId)) mediaRecords.set(mediaId, { id: mediaId, blob: ref.blob, mime: ref.mime, size: ref.blob.size, createdAt: date });
        media.push({ mediaId, name: ref.name, mime: ref.mime, size: ref.blob.size });
      }
      archetypeRecords.push({ id: id(), projectId: destinationId, name: source.name, origin: source.origin,
        look: source.look, routingMap: source.routingMap, imageConfig: source.imageConfig,
        musicPresets: source.musicPresets, media, createdAt: date, updatedAt: date, version: 1, deletedAt: null });
    }
    const presetRecords = lookPresets.map(source => ({ id: id(), projectId: destinationId, name: source.name, look: source.look,
      createdAt: date, updatedAt: date, version: 1, deletedAt: null }));
    if (!projectId && !String(projectName).trim()) throw new Error('Project name is required');
    return this.serializeWrite(() => this.write(['projects', 'archetypes', 'lookPresets', 'media'], (transaction, finish, abort) => {
      const projects = transaction.objectStore('projects'), media = transaction.objectStore('media');
      projects.get(destinationId).onsuccess = event => {
        const existing = event.target.result;
        if (projectId && (!existing || existing.deletedAt)) return abort(new Error('Project not found'));
        if (!projectId && existing) return abort(new Error('Project already exists'));
        const project = existing ? { ...existing, archetypeOrder: [...existing.archetypeOrder, ...archetypeRecords.map(item => item.id)],
          version: existing.version + 1, updatedAt: date } : { id: destinationId, name: String(projectName).trim(), ownerId: null,
          visibility: 'private', archetypeOrder: archetypeRecords.map(item => item.id), createdAt: date, updatedAt: date, version: 1, deletedAt: null };
        for (const item of mediaRecords.values()) media.get(item.id).onsuccess = mediaEvent => { if (!mediaEvent.target.result) media.put(item); };
        for (const item of presetRecords) transaction.objectStore('lookPresets').put(item);
        for (const item of archetypeRecords) transaction.objectStore('archetypes').put(item);
        projects.put(project);finish({ project, archetypes: archetypeRecords, lookPresets: presetRecords });
      };
    }));
  }

  async listLookPresets(projectId) { return (await this.getAll('lookPresets')).filter(item => item.projectId === projectId && !item.deletedAt); }
  async createLookPreset(projectId, name, look) {
    const date = now(), preset = { id: id(), projectId, name: String(name).trim(), look: copy(look), createdAt: date, updatedAt: date, version: 1, deletedAt: null };
    if (!preset.name) throw new Error('Preset name is required');
    return this.serializeWrite(() => this.write(['projects', 'lookPresets'], (transaction, finish, abort) => {
      transaction.objectStore('projects').get(projectId).onsuccess = event => {
        const project = event.target.result;if (!project || project.deletedAt) return abort(new Error('Project not found'));
        transaction.objectStore('lookPresets').put(preset);finish(preset);
      };
    }));
  }
  async updateLookPreset(presetId, changes) {
    return this.serializeWrite(() => this.write(['lookPresets'], (transaction, finish, abort) => {
      const store = transaction.objectStore('lookPresets');
      store.get(presetId).onsuccess = event => {
        const current = event.target.result;if (!current || current.deletedAt) return abort(new Error('Preset not found'));
        const next = { ...current, ...copy(changes), id: current.id, projectId: current.projectId, createdAt: current.createdAt, version: current.version + 1, updatedAt: now() };
        store.put(next);finish(next);
      };
    }));
  }
  async deleteLookPreset(presetId) { return this.updateLookPreset(presetId, { deletedAt: now() }); }

  async getMeta() { return (await this.get('meta', 'settings')) || { key: 'settings', schemaVersion: LIBRARY_SCHEMA_VERSION, lastActiveProjectId: null }; }
  async setActiveProject(projectId) { return this.serializeWrite(() => this.write(['meta'], (transaction, finish) => {
    const store = transaction.objectStore('meta');store.get('settings').onsuccess = event => {
      const meta = event.target.result || { key: 'settings', schemaVersion: LIBRARY_SCHEMA_VERSION };
      store.put({ ...meta, lastActiveProjectId: projectId });finish(projectId);
    };
  })); }
  async close() { if (this.connection) (await this.connection).close();this.connection = null; }
}
