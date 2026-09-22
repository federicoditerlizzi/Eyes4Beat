export class LibraryApiError extends Error {
  constructor(message, status, payload) { super(message);Object.assign(this, { status, payload, current: payload?.current }); }
}

export class LibraryApiClient {
  constructor(base = '') { this.base = base; }
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(this.base + path, { method, headers: body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
    const payload = method === 'HEAD' ? null : await response.json().catch(() => null);
    if (!response.ok) throw new LibraryApiError(payload?.error?.message || `Server request failed (${response.status})`, response.status, payload);
    return payload;
  }
  me() { return this.request('/api/me'); }
  projects() { return this.request('/api/projects'); }
  project(id) { return this.request(`/api/projects/${id}`); }
  createProject(data) { return this.request('/api/projects', { method: 'POST', body: data }); }
  patchProject(id, data) { return this.request(`/api/projects/${id}`, { method: 'PATCH', body: data }); }
  deleteProject(id, version) { return this.request(`/api/projects/${id}?if_version=${version}`, { method: 'DELETE' }); }
  duplicateProject(id, name) { return this.request(`/api/projects/${id}/duplicate`, { method: 'POST', body: { name } }); }
  createArchetype(projectId, data) { return this.request(`/api/projects/${projectId}/archetypes`, { method: 'POST', body: data }); }
  patchArchetype(id, data) { return this.request(`/api/archetypes/${id}`, { method: 'PATCH', body: data }); }
  deleteArchetype(id, version) { return this.request(`/api/archetypes/${id}?if_version=${version}`, { method: 'DELETE' }); }
  duplicateArchetype(id, name) { return this.request(`/api/archetypes/${id}/duplicate`, { method: 'POST', body: name ? { name } : {} }); }
  createLookPreset(projectId, data) { return this.request(`/api/projects/${projectId}/look-presets`, { method: 'POST', body: data }); }
  patchLookPreset(id, data) { return this.request(`/api/look-presets/${id}`, { method: 'PATCH', body: data }); }
  deleteLookPreset(id, version) { return this.request(`/api/look-presets/${id}?if_version=${version}`, { method: 'DELETE' }); }
  changes(since) { return this.request(`/api/changes?since=${encodeURIComponent(since)}`); }
  headMedia(id) { return this.request(`/api/media/${id}`, { method: 'HEAD' }).then(() => true).catch(error => error.status === 404 ? false : Promise.reject(error)); }
  putMedia(id, blob) { return this.request(`/api/media/${id}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } }); }
  async getMedia(id) { const response = await fetch(this.base + `/api/media/${id}`);if (!response.ok || response.redirected || !/^(image|video)\//.test(response.headers.get('Content-Type') || '')) throw new LibraryApiError(`Media download failed (${response.status})`, response.status);return response.blob(); }
}
