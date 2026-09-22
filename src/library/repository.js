// Storage contract shared by the local implementation and a future remote adapter.
export class LibraryRepository {
  async listProjects() { throw new Error('Not implemented'); }
  async getProject(_id) { throw new Error('Not implemented'); }
  async createProject(_name) { throw new Error('Not implemented'); }
  async updateProject(_id, _changes) { throw new Error('Not implemented'); }
  async duplicateProject(_id, _name) { throw new Error('Not implemented'); }
  async deleteProject(_id) { throw new Error('Not implemented'); }
  async listArchetypes(_projectId) { throw new Error('Not implemented'); }
  async getArchetype(_id) { throw new Error('Not implemented'); }
  async createArchetype(_projectId, _data) { throw new Error('Not implemented'); }
  async updateArchetype(_id, _changes) { throw new Error('Not implemented'); }
  async duplicateArchetype(_id) { throw new Error('Not implemented'); }
  async deleteArchetype(_id) { throw new Error('Not implemented'); }
  async reorderArchetypes(_projectId, _ids) { throw new Error('Not implemented'); }
  async putMedia(_blob, _mime) { throw new Error('Not implemented'); }
  async getMedia(_id) { throw new Error('Not implemented'); }
  async importBatch(_batch) { throw new Error('Not implemented'); }
  async listLookPresets(_projectId) { throw new Error('Not implemented'); }
  async createLookPreset(_projectId, _name, _look) { throw new Error('Not implemented'); }
  async updateLookPreset(_id, _changes) { throw new Error('Not implemented'); }
  async deleteLookPreset(_id) { throw new Error('Not implemented'); }
  async getMeta() { throw new Error('Not implemented'); }
  async setActiveProject(_id) { throw new Error('Not implemented'); }
}
