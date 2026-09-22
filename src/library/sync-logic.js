export const SYNC_OVERLAP_MS = 10000;
export function overlapCursor(cursor) { return new Date(Math.max(0, Date.parse(cursor || 0) - SYNC_OVERLAP_MS)).toISOString(); }
export function shouldApplyRemote(cached, remote) { return !cached || Number(remote.version || 0) > Number(cached.version || 0); }
export function cacheUserKey(email) {
  let hash = 2166136261;for (const char of String(email).trim().toLowerCase()) { hash ^= char.charCodeAt(0);hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function mergeRestoredChanges(server, localChanges) { return { ...structuredClone(server), ...structuredClone(localChanges), id: server.id, projectId: server.projectId }; }
