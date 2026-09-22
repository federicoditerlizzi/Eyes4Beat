import { LibraryRepository } from './repository.js';
import { LocalLibraryRepository } from './local-repository.js';
import { LibraryApiClient } from './api-client.js';
import { cacheUserKey, mergeRestoredChanges, overlapCursor, shouldApplyRemote } from './sync-logic.js';

export const LAST_SYNC_USER_KEY = 'eyes4beat_last_sync_user';
const epoch = new Date(0).toISOString();
const copy = value => structuredClone(value);
const cacheName = email => `eyes4beat-cache-${cacheUserKey(email || 'offline')}`;
const normalizeProject = value => ({ ...value, ownerEmail: value.owner_email ?? value.ownerEmail ?? null, updatedAt: value.updated_at ?? value.updatedAt, createdAt: value.created_at ?? value.createdAt, deletedAt: value.deleted_at ?? value.deletedAt ?? null });
const normalizeArchetype = value => ({ ...value, updatedAt: value.updated_at ?? value.updatedAt, createdAt: value.created_at ?? value.createdAt, deletedAt: value.deleted_at ?? value.deletedAt ?? null });
const normalizePreset = normalizeArchetype;

export class SyncedLibraryRepository extends LibraryRepository {
  constructor({ api = new LibraryApiClient(), email = localStorage.getItem(LAST_SYNC_USER_KEY) || '', onState = () => {}, onLibraryChanged = () => {}, readOnly = false } = {}) {
    super();this.api = api;this.email = email.toLowerCase();this.cache = new LocalLibraryRepository(cacheName(this.email), onLibraryChanged);
    this.onState = onState;this.onLibraryChanged = onLibraryChanged;this.readOnly = readOnly;this.online = navigator.onLine !== false;
    this.state = { status: this.online ? 'syncing' : 'offline', email: this.email, lastSync: null, pending: 0, liveLock: false };
    this.pushTimer = null;this.syncing = null;this.pollTimer = null;this.activeProjectId = null;
    if (!readOnly) { addEventListener('online', () => { this.online = true;void this.sync(); });addEventListener('offline', () => this.setState({ status: 'offline' })); }
  }
  setState(changes) { Object.assign(this.state, changes);this.onState({ ...this.state }); }
  async syncMeta() { return (await this.cache.get('meta', 'sync')) || { key: 'sync', cursor: epoch, dirty: {}, conflicts: {}, deferred: [] }; }
  async saveSyncMeta(meta) { await this.cache.replaceRecord('meta', meta);this.setState({ pending: Object.keys(meta.dirty || {}).length + (meta.deferred?.length || 0) }); }
  async initialize() {
    if (this.readOnly) return;
    try {
      const identity = await this.api.me();this.online = true;
      if (identity.email.toLowerCase() !== this.email) {
        await this.cache.close();this.email = identity.email.toLowerCase();localStorage.setItem(LAST_SYNC_USER_KEY, this.email);
        this.cache = new LocalLibraryRepository(cacheName(this.email), this.onLibraryChanged);this.setState({ email: this.email });this.onLibraryChanged({ userChanged: true });
      }
      await this.sync();this.startPolling();
    } catch (error) {
      if (error.status === 401) this.setState({ status: 'session-expired' });
      else { this.online = false;this.setState({ status: 'offline' }); }
    }
  }
  startPolling() { clearInterval(this.pollTimer);this.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') void this.sync(); }, 30000); }
  async sync() {
    if (this.readOnly || this.syncing) return this.syncing;
    this.syncing = (async () => {
      this.setState({ status: 'syncing' });
      try { await this.pushDirty();await this.pull();this.online = true;this.setState({ status: 'synced', lastSync: new Date().toISOString() }); }
      catch (error) { if (error.status === 401) this.setState({ status: 'session-expired' });else { this.online = false;this.setState({ status: 'offline' }); }throw error; }
      finally { this.syncing = null; }
    })();return this.syncing;
  }
  async pull() {
    const meta = await this.syncMeta(), changes = await this.api.changes(overlapCursor(meta.cursor));
    const dirty = meta.dirty || {}, deferred = meta.deferred || [];
    for (const remote of changes.projects || []) {
      if (remote.removed || remote.deleted_at) { await this.cache.removeProjectCache(remote.id);continue; }
      if (this.state.liveLock && remote.id === this.activeProjectId) { deferred.push({ store: 'projects', value: remote });continue; }
      if (!dirty[`projects:${remote.id}`] && shouldApplyRemote(await this.cache.getProject(remote.id), remote)) await this.cache.replaceRecord('projects', normalizeProject(remote));
    }
    for (const [store, values, normalizer] of [['archetypes', changes.archetypes || [], normalizeArchetype], ['lookPresets', changes.lookPresets || [], normalizePreset]]) for (const remote of values) {
      const active = remote.projectId === this.activeProjectId;
      if (this.state.liveLock && active) { deferred.push({ store, value: remote });continue; }
      if (remote.deleted_at) await this.cache.removeRecord(store, remote.id);
      else if (!dirty[`${store}:${remote.id}`] && shouldApplyRemote(await this.cache.get(store, remote.id), remote)) await this.cache.replaceRecord(store, normalizer(remote));
    }
    meta.cursor = changes.serverTime;meta.deferred = deferred;await this.saveSyncMeta(meta);this.onLibraryChanged({ remote: true });
  }
  async applyDeferred() {
    const meta = await this.syncMeta(), pending = meta.deferred || [];meta.deferred = [];
    for (const item of pending) {
      if (item.value.removed || item.value.deleted_at) item.store === 'projects' ? await this.cache.removeProjectCache(item.value.id) : await this.cache.removeRecord(item.store, item.value.id);
      else await this.cache.replaceRecord(item.store, item.store === 'projects' ? normalizeProject(item.value) : normalizeArchetype(item.value));
    }
    await this.saveSyncMeta(meta);this.onLibraryChanged({ deferredApplied: true });
  }
  async setLiveLock(value) { this.setState({ liveLock: !!value });if (!value) await this.applyDeferred();return this.state.liveLock; }
  requireNetwork() { if (!this.online || ['offline', 'session-expired'].includes(this.state.status)) throw new Error('This action requires a network connection. Your cached projects remain available.'); }
  afterSuccessfulWrite() { queueMicrotask(() => this.pull().catch(() => {})); }
  async markDirty(store, id, changes, baseVersion) {
    const meta = await this.syncMeta(), key = `${store}:${id}`, prior = meta.dirty[key];meta.dirty[key] = { store, id, baseVersion: prior?.baseVersion ?? baseVersion, changes: { ...(prior?.changes || {}), ...copy(changes) } };
    await this.saveSyncMeta(meta);clearTimeout(this.pushTimer);this.pushTimer = setTimeout(() => void this.sync().catch(() => {}), 1000);
  }
  async localEdit(store, id, changes) {
    const current = await this.cache.get(store, id);if (!current) throw new Error('Record not found');
    const next = { ...current, ...copy(changes), id: current.id, version: current.version, updatedAt: new Date().toISOString() };
    await this.cache.replaceRecord(store, next);await this.markDirty(store, id, changes, current.version);return next;
  }
  async pushDirty() {
    if (!this.online) return;
    const meta = await this.syncMeta();
    for (const [key, item] of Object.entries(meta.dirty || {})) {
      try {
        let remote;if (item.store === 'projects') remote = await this.api.patchProject(item.id, { ...item.changes, if_version: item.baseVersion });
        else if (item.store === 'archetypes') remote = await this.api.patchArchetype(item.id, { ...item.changes, if_version: item.baseVersion });
        else remote = await this.api.patchLookPreset(item.id, { ...item.changes, if_version: item.baseVersion });
        await this.cache.replaceRecord(item.store, item.store === 'projects' ? normalizeProject(remote) : normalizeArchetype(remote));delete meta.dirty[key];
      } catch (error) {
        if (error.status !== 409) throw error;
        meta.conflicts[key] = { localChanges: item.changes, server: error.current };delete meta.dirty[key];
        await this.cache.replaceRecord(item.store, item.store === 'projects' ? normalizeProject(error.current) : normalizeArchetype(error.current));
        this.onState({ ...this.state, conflict: { key, name: error.current.name, updatedBy: error.current.updated_by } });
      }
    }
    await this.saveSyncMeta(meta);
  }
  async restoreConflict(key) {
    const meta = await this.syncMeta(), conflict = meta.conflicts?.[key];if (!conflict) return;
    const [store, id] = key.split(':');const restored = mergeRestoredChanges(store === 'projects' ? normalizeProject(conflict.server) : normalizeArchetype(conflict.server), conflict.localChanges);
    await this.cache.replaceRecord(store, restored);delete meta.conflicts[key];meta.dirty[key] = { store, id, baseVersion: conflict.server.version, changes: conflict.localChanges };await this.saveSyncMeta(meta);await this.sync();
  }
  listProjects() { return this.cache.listProjects(); } getProject(id) { return this.cache.getProject(id); }
  listArchetypes(id) { return this.cache.listArchetypes(id); } getArchetype(id) { return this.cache.getArchetype(id); }
  listLookPresets(id) { return this.cache.listLookPresets(id); } getMedia(id) { return this.cache.getMedia(id); }
  getMeta() { return this.cache.getMeta(); }
  async setActiveProject(id) { this.activeProjectId = id;return this.cache.setActiveProject(id); }
  async putMedia(blob, mime) { return this.cache.putMedia(blob, mime); }
  updateProject(id, changes) { return this.localEdit('projects', id, changes); }
  updateArchetype(id, changes) { return this.localEdit('archetypes', id, changes); }
  updateLookPreset(id, changes) { return this.localEdit('lookPresets', id, changes); }
  async hydrateProject(id, onProgress = () => {}) {
    const records = await this.cache.listArchetypes(id), refs = [...new Set(records.flatMap(item => item.media.map(media => media.mediaId)))];let done = 0;
    for (const mediaId of refs) if (!await this.cache.getMedia(mediaId)) { try { const blob = await this.api.getMedia(mediaId);await this.cache.replaceRecord('media', { id: mediaId, blob, mime: blob.type, size: blob.size, createdAt: new Date().toISOString() }); } catch {}onProgress(++done, refs.length); }
    return this.projectReadyOffline(id);
  }
  async projectReadyOffline(id) { for (const item of await this.cache.listArchetypes(id)) for (const ref of item.media) if (!await this.cache.getMedia(ref.mediaId)) return false;return true; }
  async ensureMedia(refs) { let done = 0;for (const ref of refs) { if (!await this.api.headMedia(ref.mediaId)) { const saved = await this.cache.getMedia(ref.mediaId);if (!saved?.blob) throw new Error(`Missing local media: ${ref.name}`);await this.api.putMedia(ref.mediaId, saved.blob); }this.onState({ ...this.state, mediaProgress: { done: ++done, total: refs.length } }); } }
  async refreshProject(id) { const snapshot = await this.api.project(id);await this.cache.replaceRecord('projects', normalizeProject(snapshot.project));for (const item of snapshot.archetypes) await this.cache.replaceRecord('archetypes', normalizeArchetype(item));for (const item of snapshot.lookPresets) await this.cache.replaceRecord('lookPresets', normalizePreset(item));return normalizeProject(snapshot.project); }
  async createProject(name, options = {}) { this.requireNetwork();const item = normalizeProject(await this.api.createProject({ id: options.id, name, visibility: options.visibility }));await this.cache.replaceRecord('projects', item);this.afterSuccessfulWrite();return item; }
  async deleteProject(id) { this.requireNetwork();const current = await this.cache.getProject(id);await this.api.deleteProject(id, current.version);await this.cache.removeProjectCache(id);this.afterSuccessfulWrite();return current; }
  async duplicateProject(id, name) { this.requireNetwork();const source = await this.cache.getProject(id);const created = normalizeProject(await this.api.duplicateProject(id, name || `${source.name} copy`));await this.refreshProject(created.id);this.afterSuccessfulWrite();return created; }
  async reorderArchetypes(id, ids) { this.requireNetwork();const current = await this.cache.getProject(id);const item = normalizeProject(await this.api.patchProject(id, { archetypeOrder: ids, if_version: current.version }));await this.cache.replaceRecord('projects', item);this.afterSuccessfulWrite();return item; }
  async setProjectVisibility(id, visibility) { this.requireNetwork();const current = await this.cache.getProject(id);const item = normalizeProject(await this.api.patchProject(id, { visibility, if_version: current.version }));await this.cache.replaceRecord('projects', item);this.afterSuccessfulWrite();return item; }
  async createArchetype(projectId, data) { this.requireNetwork();await this.ensureMedia(data.media || []);const item = normalizeArchetype(await this.api.createArchetype(projectId, data));await this.cache.replaceRecord('archetypes', item);await this.refreshProject(projectId);this.afterSuccessfulWrite();return item; }
  async deleteArchetype(id) { this.requireNetwork();const item = await this.cache.getArchetype(id);await this.api.deleteArchetype(id, item.version);await this.cache.removeRecord('archetypes', id);await this.refreshProject(item.projectId);this.afterSuccessfulWrite();return item; }
  async duplicateArchetype(id) { this.requireNetwork();const item = normalizeArchetype(await this.api.duplicateArchetype(id));await this.cache.replaceRecord('archetypes', item);await this.refreshProject(item.projectId);this.afterSuccessfulWrite();return item; }
  async createLookPreset(projectId, name, look, options = {}) { this.requireNetwork();const item = normalizePreset(await this.api.createLookPreset(projectId, { id: options.id, name, look }));await this.cache.replaceRecord('lookPresets', item);this.afterSuccessfulWrite();return item; }
  async deleteLookPreset(id) { this.requireNetwork();const item = await this.cache.get('lookPresets', id);await this.api.deleteLookPreset(id, item.version);await this.cache.removeRecord('lookPresets', id);this.afterSuccessfulWrite();return item; }
  async importBatch({ projectId = null, projectName, archetypes, lookPresets = [] }) {
    this.requireNetwork();let project = projectId ? await this.cache.getProject(projectId) : await this.createProject(projectName);const createdArchetypes = [], createdPresets = [];
    try { for (const entry of archetypes) { for (const media of entry.media) { const saved = await this.cache.putMedia(media.blob, media.mime);media.mediaId = saved.id;media.size = saved.size; }createdArchetypes.push(await this.createArchetype(project.id, entry)); }for (const item of lookPresets) createdPresets.push(await this.createLookPreset(project.id, item.name, item.look)); }
    catch (error) {
      if (!projectId) try { await this.deleteProject(project.id); } catch {}
      else { for (const item of createdArchetypes.reverse()) try { await this.deleteArchetype(item.id); } catch {}for (const item of createdPresets.reverse()) try { await this.deleteLookPreset(item.id); } catch {} }
      throw error;
    }
    project = await this.refreshProject(project.id);return { project, archetypes: await this.listArchetypes(project.id), lookPresets: await this.listLookPresets(project.id) };
  }
  async migrateLocalProjects(source) {
    this.requireNetwork();const migrated = [];
    for (const localProject of await source.listProjects()) {
      const project = await this.createProject(localProject.name, { id: localProject.id, visibility: localProject.visibility });
      try {
        for (const preset of await source.listLookPresets(localProject.id)) await this.createLookPreset(project.id, preset.name, preset.look, { id: preset.id });
        const records = new Map((await source.listArchetypes(localProject.id)).map(item => [item.id, item]));
        for (const archetypeId of localProject.archetypeOrder) {
          const item = records.get(archetypeId);if (!item) continue;
          for (const ref of item.media) { const saved = await source.getMedia(ref.mediaId);if (!saved?.blob) throw new Error(`Missing media ${ref.name}`);await this.cache.replaceRecord('media', saved); }
          await this.createArchetype(project.id, { ...item, id: item.id });
        }
        migrated.push(project.id);
      } catch (error) { try { await this.deleteProject(project.id); } catch {}throw error; }
    }
    return migrated;
  }
}
