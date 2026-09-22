import { blankMap } from '../../src/config.js';
import { normalizeLook } from '../../src/looks.js';
import { normalizeImageConfigStore } from '../../src/image-sequencer.js';
import { defaultImageConfig, normalizeMusicPresets, normalizeRoutingMap } from '../../src/library/runtime.js';

const MAX_JSON = 1024 * 1024;
const MAX_MEDIA = 50 * 1024 * 1024;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/i;
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value);
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const first = (db, sql, ...values) => stmt(db, sql, ...values).first();
const all = async (db, sql, ...values) => (await stmt(db, sql, ...values).all()).results;

class ApiError extends Error {
  constructor(status, code, message, current) { super(message); Object.assign(this, { status, code, current }); }
}
const fail = (status, code, message, current) => { throw new ApiError(status, code, message, current); };
const answer = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
const nonempty = (value, field) => typeof value === 'string' && value.trim().length && value.trim().length <= 160 ? value.trim() : fail(400, 'invalid_input', `${field} is required (max 160 characters)`);
const id = value => value == null ? crypto.randomUUID() : UUID.test(value) ? value : fail(400, 'invalid_input', 'Expected a UUID');
const version = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fail(400, 'invalid_input', 'if_version must be a positive integer');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail(400, 'invalid_input', 'Expected an object');
const visibility = value => ['private', 'shared'].includes(value) ? value : fail(400, 'invalid_input', 'Invalid visibility');
const jsonColumn = value => value == null ? null : parse(value);
function project(row) { return row && { id: row.id, owner_email: row.owner_email, name: row.name, visibility: row.visibility, archetypeOrder: parse(row.archetype_order), created_at: row.created_at, updated_at: row.updated_at, version: row.version, deleted_at: row.deleted_at, updated_by: row.updated_by }; }
function archetype(row) { return row && { id: row.id, projectId: row.project_id, name: row.name, origin: jsonColumn(row.origin), look: jsonColumn(row.look), routingMap: jsonColumn(row.routing_map), imageConfig: jsonColumn(row.image_config), musicPresets: jsonColumn(row.music_presets), media: jsonColumn(row.media), created_at: row.created_at, updated_at: row.updated_at, version: row.version, deleted_at: row.deleted_at, updated_by: row.updated_by }; }
function preset(row) { return row && { id: row.id, projectId: row.project_id, name: row.name, look: jsonColumn(row.look), created_at: row.created_at, updated_at: row.updated_at, version: row.version, deleted_at: row.deleted_at, updated_by: row.updated_by }; }
const canRead = (row, email) => row && !row.deleted_at && (row.owner_email === email || row.visibility === 'shared');
async function readable(db, projectId, email) {
  const row = await first(db, 'SELECT * FROM projects WHERE id = ?', projectId);
  if (!canRead(row, email)) fail(404, 'not_found', 'Project not found');
  return row;
}
async function currentVersion(db, table, recordId, requested, convert) {
  const row = await first(db, `SELECT * FROM ${table} WHERE id = ?`, recordId);
  if (!row || row.deleted_at) fail(404, 'not_found', 'Record not found');
  if (row.version !== version(requested)) fail(409, 'version_conflict', 'Record was changed', convert(row));
  return row;
}
function guard(db, condition, values = []) {
  return [stmt(db, `INSERT OR REPLACE INTO write_guards(id,ok) VALUES ('write',CASE WHEN ${condition} THEN 1 ELSE 0 END)`, ...values)];
}
async function batch(db, statements) { return db.batch(statements); }
async function readBounded(request, limit) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > limit) fail(413, 'too_large', `Body exceeds ${limit} bytes`);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); fail(413, 'too_large', `Body exceeds ${limit} bytes`); }
    chunks.push(value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'invalid_content_type', 'Expected application/json');
  try { return object(parse(new TextDecoder().decode(await readBounded(request, MAX_JSON)))); }
  catch (error) { if (error instanceof ApiError) throw error; fail(400, 'invalid_json', 'Invalid JSON body'); }
}
function mediaRefs(value) {
  if (!Array.isArray(value) || value.length > 500) fail(400, 'invalid_input', 'media must be an array of at most 500 items');
  return value.map(item => {
    object(item);
    if (!SHA.test(item.mediaId || '')) fail(400, 'invalid_input', 'Invalid mediaId');
    return { mediaId: item.mediaId.toLowerCase(), name: nonempty(item.name, 'media name'), mime: MIMES.has(item.mime) ? item.mime : fail(400, 'invalid_input', 'Invalid media MIME'), size: Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= MAX_MEDIA ? item.size : fail(400, 'invalid_input', 'Invalid media size') };
  });
}
async function mediaAllowed(db, mediaId, email) {
  return first(db, "SELECT 1 AS allowed FROM media m WHERE m.id=? AND (m.uploaded_by=? OR EXISTS (SELECT 1 FROM media_uploaders mu WHERE mu.media_id=m.id AND mu.email=?) OR EXISTS (SELECT 1 FROM archetype_media am JOIN archetypes a ON a.id=am.archetype_id JOIN projects p ON p.id=a.project_id WHERE am.media_id=m.id AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))) LIMIT 1", mediaId, email, email, email);
}
async function checkMedia(db, refs, email) {
  for (const ref of refs) {
    const row = await first(db, 'SELECT id,mime,size FROM media WHERE id = ?', ref.mediaId);
    if (!row || row.mime !== ref.mime || row.size !== ref.size) fail(400, 'missing_media', `Media ${ref.mediaId} is missing or has different metadata`);
    if (!await mediaAllowed(db, ref.mediaId, email)) fail(403, 'forbidden', 'Media is not accessible');
  }
}
const mediaLinks = (db, archetypeId, refs) => [stmt(db, 'DELETE FROM archetype_media WHERE archetype_id = ?', archetypeId), ...new Set(refs.map(ref => ref.mediaId)).values()].map((value, index) => index ? stmt(db, 'INSERT INTO archetype_media(archetype_id,media_id) VALUES (?,?)', archetypeId, value) : value);
function normalizedArchetype(data) {
  const refs = mediaRefs(data.media);
  const fallback = defaultImageConfig(refs.length);
  const config = normalizeImageConfigStore({ configs: [data.imageConfig] }, [fallback]).configs[0];
  return { name: nonempty(data.name, 'name'), origin: object(data.origin), look: normalizeLook(data.look), routingMap: normalizeRoutingMap(data.routingMap, blankMap()), imageConfig: config, musicPresets: normalizeMusicPresets(data.musicPresets), media: refs };
}
function insertArchetype(db, row) { return stmt(db, 'INSERT INTO archetypes(id,project_id,name,origin,look,routing_map,image_config,music_presets,media,created_at,updated_at,version,deleted_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', row.id, row.projectId, row.name, json(row.origin), json(row.look), json(row.routingMap), json(row.imageConfig), json(row.musicPresets), json(row.media), row.created_at, row.updated_at, row.version, row.deleted_at, row.updated_by); }
function insertPreset(db, row) { return stmt(db, 'INSERT INTO look_presets(id,project_id,name,look,created_at,updated_at,version,deleted_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?)', row.id, row.projectId, row.name, json(row.look), row.created_at, row.updated_at, row.version, row.deleted_at, row.updated_by); }

export async function serveApi(request, db, bucket, user) {
  try { return await route(request, db, bucket, user); }
  catch (error) {
    if (error instanceof ApiError) return answer({ error: { code: error.code, message: error.message }, ...(error.current ? { current: error.current } : {}) }, error.status);
    if (/CHECK constraint failed: write_guards/.test(String(error))) return answer({ error: { code: 'version_conflict', message: 'Record changed during write; reload and retry' } }, 409);
    if (/UNIQUE constraint failed/.test(String(error))) return answer({ error: { code: 'conflict', message: 'Record already exists' } }, 409);
    console.error('Library API error', error);
    return answer({ error: { code: 'internal_error', message: 'Request failed' } }, 500);
  }
}

async function route(request, db, bucket, user) {
  if (!user?.email) fail(401, 'unauthorized', 'Authentication required');
  if (!db || !bucket) fail(503, 'not_configured', 'Library storage is not configured');
  const url = new URL(request.url), segments = url.pathname.split('/').filter(Boolean), method = request.method, email = user.email;
  if (segments[0] !== 'api') fail(404, 'not_found', 'Not found');
  const at = (name, count) => segments[1] === name && segments.length === count;
  if (at('me', 2) && method === 'GET') {
    const date = now();
    await stmt(db, 'INSERT INTO users(email,first_seen_at,last_seen_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET last_seen_at=excluded.last_seen_at', email, date, date).run();
    return answer({ email });
  }
  if (at('projects', 2) && method === 'GET') {
    const rows = await all(db, "SELECT p.*, (SELECT COUNT(*) FROM archetypes a WHERE a.project_id=p.id AND a.deleted_at IS NULL) AS archetype_count FROM projects p WHERE p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared') ORDER BY p.created_at", email);
    return answer(rows.map(row => ({ ...project(row), archetypeCount: row.archetype_count })));
  }
  if (at('projects', 2) && method === 'POST') {
    const data = await body(request), projectId = id(data.id), date = now(), name = nonempty(data.name, 'name'), access = visibility(data.visibility ?? 'private');
    await stmt(db, 'INSERT INTO projects(id,owner_email,name,visibility,archetype_order,created_at,updated_at,version,deleted_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)', projectId, email, name, access, '[]', date, date, 1, null, email).run();
    return answer(project(await first(db, 'SELECT * FROM projects WHERE id=?', projectId)), 201);
  }
  if (segments[1] === 'projects' && segments.length >= 3) return projectRoute(request, db, segments, url, email);
  if (segments[1] === 'archetypes' && segments.length >= 3) return archetypeRoute(request, db, segments, url, email);
  if (segments[1] === 'look-presets' && segments.length === 3) return presetRoute(request, db, segments, url, email);
  if (segments[1] === 'media' && segments.length === 3) return mediaRoute(request, db, bucket, segments[2], email);
  if (at('changes', 2) && method === 'GET') return changesRoute(db, url, email);
  fail(404, 'not_found', 'Not found');
}

async function projectRoute(request, db, segments, url, email) {
  const projectId = segments[2], method = request.method;
  if (!UUID.test(projectId)) fail(400, 'invalid_input', 'Invalid project id');
  const source = await readable(db, projectId, email);
  if (segments.length === 3 && method === 'GET') {
    const archetypes = await all(db, 'SELECT * FROM archetypes WHERE project_id=? AND deleted_at IS NULL', projectId);
    const byId = new Map(archetypes.map(row => [row.id, row]));
    const presets = await all(db, 'SELECT * FROM look_presets WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at', projectId);
    return answer({ project: project(source), archetypes: parse(source.archetype_order).map(key => byId.get(key)).filter(Boolean).map(archetype), lookPresets: presets.map(preset) });
  }
  if (segments.length === 3 && method === 'PATCH') {
    const data = await body(request);
    await currentVersion(db, 'projects', projectId, data.if_version, project);
    if (data.visibility !== undefined && source.owner_email !== email) fail(403, 'forbidden', 'Only the owner can change visibility');
    const name = data.name === undefined ? source.name : nonempty(data.name, 'name');
    const access = data.visibility === undefined ? source.visibility : visibility(data.visibility);
    const order = data.archetypeOrder === undefined ? parse(source.archetype_order) : data.archetypeOrder;
    if (!Array.isArray(order) || order.some(value => !UUID.test(value)) || new Set(order).size !== order.length) fail(400, 'invalid_input', 'Invalid archetypeOrder');
    const oldOrder = parse(source.archetype_order);
    if (order.length !== oldOrder.length || order.some(value => !oldOrder.includes(value))) fail(400, 'invalid_input', 'archetypeOrder must contain exactly the existing ids');
    const date = now(), statements = [
      guard(db, '(SELECT version FROM projects WHERE id=?)=?', [projectId, source.version])[0],
      stmt(db, 'UPDATE projects SET name=?,visibility=?,archetype_order=?,version=version+1,updated_at=?,updated_by=? WHERE id=?', name, access, json(order), date, email, projectId),
    ];
    if (access !== source.visibility) statements.push(stmt(db, 'INSERT INTO visibility_events(project_id,changed_at,from_visibility,to_visibility) VALUES (?,?,?,?)', projectId, date, source.visibility, access));
    await batch(db, statements);
    return answer(project(await first(db, 'SELECT * FROM projects WHERE id=?', projectId)));
  }
  if (segments.length === 3 && method === 'DELETE') {
    if (source.owner_email !== email) fail(403, 'forbidden', 'Only the owner can delete a project');
    await currentVersion(db, 'projects', projectId, url.searchParams.get('if_version'), project);
    const date = now();
    await batch(db, [
      guard(db, '(SELECT version FROM projects WHERE id=?)=?', [projectId, source.version])[0],
      stmt(db, 'UPDATE projects SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?', date, date, email, projectId),
      stmt(db, 'UPDATE archetypes SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE project_id=? AND deleted_at IS NULL', date, date, email, projectId),
      stmt(db, 'UPDATE look_presets SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE project_id=? AND deleted_at IS NULL', date, date, email, projectId),
    ]);
    return answer({ deleted: true });
  }
  if (segments.length === 4 && segments[3] === 'duplicate' && method === 'POST') {
    const data = await body(request), date = now(), newId = crypto.randomUUID(), name = nonempty(data.name ?? `${source.name} copy`, 'name');
    const originals = await all(db, 'SELECT * FROM archetypes WHERE project_id=? AND deleted_at IS NULL', projectId);
    const originalsById = new Map(originals.map(row => [row.id, row]));
    const presets = await all(db, 'SELECT * FROM look_presets WHERE project_id=? AND deleted_at IS NULL', projectId);
    const presetIds = new Map(presets.map(row => [row.id, crypto.randomUUID()]));
    const copied = parse(source.archetype_order).map(key => originalsById.get(key)).filter(Boolean).map(row => {
      const item = archetype(row), origin = { ...item.origin };
      if (origin.type === 'project-preset' && presetIds.has(origin.presetId)) origin.presetId = presetIds.get(origin.presetId);
      return { ...item, id: crypto.randomUUID(), projectId: newId, origin, created_at: date, updated_at: date, version: 1, deleted_at: null, updated_by: email };
    });
    await batch(db, [
      guard(db, "EXISTS(SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND (owner_email=? OR visibility='shared'))", [projectId, email])[0],
      stmt(db, 'INSERT INTO projects(id,owner_email,name,visibility,archetype_order,created_at,updated_at,version,deleted_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)', newId, email, name, 'private', json(copied.map(item => item.id)), date, date, 1, null, email),
      ...presets.map(row => insertPreset(db, { ...preset(row), id: presetIds.get(row.id), projectId: newId, created_at: date, updated_at: date, version: 1, deleted_at: null, updated_by: email })),
      ...copied.flatMap(item => [insertArchetype(db, item), ...mediaLinks(db, item.id, item.media).slice(1)]),
    ]);
    return answer(project(await first(db, 'SELECT * FROM projects WHERE id=?', newId)), 201);
  }
  if (segments.length === 4 && segments[3] === 'archetypes' && method === 'POST') {
    const data = await body(request), normalized = normalizedArchetype(data), itemId = id(data.id), date = now();
    await checkMedia(db, normalized.media, email);
    const item = { ...normalized, id: itemId, projectId, created_at: date, updated_at: date, version: 1, deleted_at: null, updated_by: email };
    await batch(db, [
      guard(db, "EXISTS(SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND (owner_email=? OR visibility='shared'))", [projectId, email])[0],
      insertArchetype(db, item),
      ...mediaLinks(db, itemId, normalized.media).slice(1),
      stmt(db, "UPDATE projects SET archetype_order=json_insert(archetype_order,'$[#]',?),version=version+1,updated_at=?,updated_by=? WHERE id=?", itemId, date, email, projectId),
    ]);
    return answer(item, 201);
  }
  if (segments.length === 4 && segments[3] === 'look-presets' && method === 'POST') {
    const data = await body(request), date = now(), itemId = id(data.id), name = nonempty(data.name, 'name');
    const row = { id: itemId, projectId, name, look: normalizeLook(data.look), created_at: date, updated_at: date, version: 1, deleted_at: null, updated_by: email };
    await batch(db, [guard(db, "EXISTS(SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND (owner_email=? OR visibility='shared'))", [projectId, email])[0], insertPreset(db, row)]);
    return answer(row, 201);
  }
  fail(404, 'not_found', 'Not found');
}

async function archetypeRoute(request, db, segments, url, email) {
  const itemId = segments[2], method = request.method;
  if (!UUID.test(itemId)) fail(400, 'invalid_input', 'Invalid archetype id');
  const source = await first(db, 'SELECT * FROM archetypes WHERE id=? AND deleted_at IS NULL', itemId);
  if (!source) fail(404, 'not_found', 'Archetype not found');
  await readable(db, source.project_id, email);
  if (segments.length === 3 && method === 'PATCH') {
    const data = await body(request); await currentVersion(db, 'archetypes', itemId, data.if_version, archetype);
    const original = archetype(source), merged = { ...original, ...data }, normalized = normalizedArchetype(merged);
    await checkMedia(db, normalized.media, email);
    const date = now();
    await batch(db, [
      guard(db, "EXISTS(SELECT 1 FROM archetypes a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.version=? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))", [itemId, source.version, email])[0],
      stmt(db, 'UPDATE archetypes SET name=?,origin=?,look=?,routing_map=?,image_config=?,music_presets=?,media=?,version=version+1,updated_at=?,updated_by=? WHERE id=?', normalized.name, json(normalized.origin), json(normalized.look), json(normalized.routingMap), json(normalized.imageConfig), json(normalized.musicPresets), json(normalized.media), date, email, itemId),
      ...mediaLinks(db, itemId, normalized.media),
    ]);
    return answer(archetype(await first(db, 'SELECT * FROM archetypes WHERE id=?', itemId)));
  }
  if (segments.length === 3 && method === 'DELETE') {
    await currentVersion(db, 'archetypes', itemId, url.searchParams.get('if_version'), archetype);
    const date = now();
    await batch(db, [
      guard(db, "EXISTS(SELECT 1 FROM archetypes a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.version=? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))", [itemId, source.version, email])[0],
      stmt(db, 'UPDATE archetypes SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?', date, date, email, itemId),
      stmt(db, "UPDATE projects SET archetype_order=(SELECT coalesce(json_group_array(value),'[]') FROM (SELECT value FROM json_each(projects.archetype_order) WHERE value<>? ORDER BY CAST(key AS INTEGER))),updated_at=?,updated_by=?,version=version+1 WHERE id=?", itemId, date, email, source.project_id),
    ]);
    return answer({ deleted: true });
  }
  if (segments.length === 4 && segments[3] === 'duplicate' && method === 'POST') {
    const data = await body(request), date = now(), newId = crypto.randomUUID(), original = archetype(source);
    const item = { ...original, id: newId, name: nonempty(data.name ?? `${source.name} copy`, 'name'), created_at: date, updated_at: date, version: 1, deleted_at: null, updated_by: email };
    await batch(db, [
      guard(db, "EXISTS(SELECT 1 FROM archetypes a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))", [itemId, email])[0],
      insertArchetype(db, item), ...mediaLinks(db, newId, item.media).slice(1),
      stmt(db, "UPDATE projects SET archetype_order=json_insert(archetype_order,'$[#]',?),updated_at=?,updated_by=?,version=version+1 WHERE id=?", newId, date, email, source.project_id),
    ]);
    return answer(item, 201);
  }
  fail(404, 'not_found', 'Not found');
}

async function presetRoute(request, db, segments, url, email) {
  const itemId = segments[2], method = request.method;
  if (!UUID.test(itemId)) fail(400, 'invalid_input', 'Invalid preset id');
  const source = await first(db, 'SELECT * FROM look_presets WHERE id=? AND deleted_at IS NULL', itemId);
  if (!source) fail(404, 'not_found', 'Preset not found');
  await readable(db, source.project_id, email);
  if (method === 'PATCH') {
    const data = await body(request); await currentVersion(db, 'look_presets', itemId, data.if_version, preset);
    const name = data.name === undefined ? source.name : nonempty(data.name, 'name');
    const look = data.look === undefined ? jsonColumn(source.look) : normalizeLook(data.look);
    const date = now();
    await batch(db, [guard(db, "EXISTS(SELECT 1 FROM look_presets lp JOIN projects p ON p.id=lp.project_id WHERE lp.id=? AND lp.version=? AND lp.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))", [itemId, source.version, email])[0], stmt(db, 'UPDATE look_presets SET name=?,look=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?', name, json(look), date, email, itemId)]);
    return answer(preset(await first(db, 'SELECT * FROM look_presets WHERE id=?', itemId)));
  }
  if (method === 'DELETE') {
    await currentVersion(db, 'look_presets', itemId, url.searchParams.get('if_version'), preset);
    const date = now();
    await batch(db, [guard(db, "EXISTS(SELECT 1 FROM look_presets lp JOIN projects p ON p.id=lp.project_id WHERE lp.id=? AND lp.version=? AND lp.deleted_at IS NULL AND p.deleted_at IS NULL AND (p.owner_email=? OR p.visibility='shared'))", [itemId, source.version, email])[0], stmt(db, 'UPDATE look_presets SET deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?', date, date, email, itemId)]);
    return answer({ deleted: true });
  }
  fail(404, 'not_found', 'Not found');
}

async function mediaRoute(request, db, bucket, mediaId, email) {
  if (!SHA.test(mediaId)) fail(400, 'invalid_input', 'Invalid SHA-256 id');
  const method = request.method, key = `media/${mediaId.toLowerCase()}`;
  if (method === 'PUT') {
    const mime = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (!MIMES.has(mime)) fail(415, 'invalid_media_type', 'Unsupported media type');
    const bytes = await readBounded(request, MAX_MEDIA);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== mediaId.toLowerCase()) fail(400, 'hash_mismatch', 'Media hash does not match id');
    const existing = await first(db, 'SELECT * FROM media WHERE id=?', hash);
    if (existing) {
      if (existing.size !== bytes.byteLength || existing.mime !== mime) fail(409, 'conflict', 'Existing media has different metadata');
      if (bucket.head && !await bucket.head(key)) await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
      await stmt(db, 'INSERT OR IGNORE INTO media_uploaders(media_id,email) VALUES (?,?)', hash, email).run();
      return answer({ id: hash, stored: false });
    }
    await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    try { await stmt(db, 'INSERT INTO media(id,mime,size,uploaded_by,created_at) VALUES (?,?,?,?,?)', hash, mime, bytes.byteLength, email, now()).run(); }
    catch (error) { if (!/UNIQUE constraint failed/.test(String(error))) throw error; }
    await stmt(db, 'INSERT OR IGNORE INTO media_uploaders(media_id,email) VALUES (?,?)', hash, email).run();
    return answer({ id: hash, stored: true }, 201);
  }
  if (method === 'HEAD' || method === 'GET') {
    const row = await first(db, 'SELECT * FROM media WHERE id=?', mediaId.toLowerCase());
    if (!row) fail(404, 'not_found', 'Media not found');
    const permitted = await mediaAllowed(db, row.id, email);
    if (!permitted) fail(404, 'not_found', 'Media not found');
    const headers = { 'Content-Type': row.mime, 'Content-Length': String(row.size), 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (method === 'HEAD') return new Response(null, { status: 200, headers });
    const object = await bucket.get(key);
    if (!object) fail(404, 'not_found', 'Media object not found');
    return new Response(object.body, { headers });
  }
  fail(404, 'not_found', 'Not found');
}

async function changesRoute(db, url, email) {
  const since = url.searchParams.get('since');
  if (!since || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString() !== since) fail(400, 'invalid_input', 'since must be an ISO timestamp');
  const serverTime = now();
  const projectRows = await all(db, `SELECT * FROM projects p WHERE p.updated_at>? AND p.updated_at<=? AND (p.owner_email=? OR p.visibility='shared' OR EXISTS (SELECT 1 FROM visibility_events v WHERE v.project_id=p.id AND v.changed_at>? AND v.from_visibility='shared'))`, since, serverTime, email, since);
  const projects = projectRows.map(row => row.owner_email !== email && row.visibility !== 'shared' ? { id: row.id, removed: true, updated_at: row.updated_at } : project(row));
  const archetypes = (await all(db, "SELECT a.* FROM archetypes a JOIN projects p ON p.id=a.project_id WHERE a.updated_at>? AND a.updated_at<=? AND (p.owner_email=? OR p.visibility='shared')", since, serverTime, email)).map(archetype);
  const lookPresets = (await all(db, "SELECT lp.* FROM look_presets lp JOIN projects p ON p.id=lp.project_id WHERE lp.updated_at>? AND lp.updated_at<=? AND (p.owner_email=? OR p.visibility='shared')", since, serverTime, email)).map(preset);
  return answer({ projects, archetypes, lookPresets, serverTime });
}
