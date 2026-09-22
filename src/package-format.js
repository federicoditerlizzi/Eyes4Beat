import { unzipSync, zipSync } from 'fflate';

export const PACKAGE_FORMAT = 'eyes4beat-package';
export const PACKAGE_VERSION = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MIME_EXTENSIONS = {
  'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg',
  'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

export function mediaExtension(name = '', mime = '') {
  const type = mime.toLowerCase().split(';')[0];
  if (MIME_EXTENSIONS[type]) return MIME_EXTENSIONS[type];
  const suffix = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  return suffix && ['avif', 'gif', 'jpeg', 'jpg', 'mov', 'mp4', 'png', 'svg', 'webm', 'webp'].includes(suffix) ? suffix : 'bin';
}

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildLibraryPackage({ archetypes, localStorage = {}, appVersion, userAgent, exportedAt = new Date().toISOString() }, onProgress = () => {}) {
  const files = {};
  const pathsByHash = new Map();
  let processed = 0;
  const total = archetypes.reduce((sum, archetype) => sum + archetype.media.length, 0);
  const entries = [];
  for (const archetype of archetypes) {
    const media = [];
    for (const item of archetype.media) {
      const bytes = item.bytes instanceof Uint8Array ? item.bytes : new Uint8Array(item.bytes);
      const hash = await sha256(bytes);
      let path = pathsByHash.get(hash);
      if (!path) {
        path = `media/${hash}.${mediaExtension(item.name, item.mime)}`;
        pathsByHash.set(hash, path);
        files[path] = [bytes, { level: 0 }];
      }
      media.push({ path, name: item.name, mime: item.mime, size: bytes.byteLength, sha256: hash });
      await onProgress(++processed, total);
    }
    entries.push({ ...archetype, media });
  }
  const manifest = { format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, kind: 'legacy-library', exportedAt, appVersion, userAgent, archetypes: entries };
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2));
  files['raw/local-storage.json'] = encoder.encode(JSON.stringify(localStorage, null, 2));
  return { manifest, zip: zipSync(files, { level: 6 }), uniqueMediaCount: pathsByHash.size,
    mediaBytes: [...pathsByHash.values()].reduce((sum, path) => sum + files[path][0].byteLength, 0) };
}

export async function verifyLibraryPackage(zipBytes) {
  const files = unzipSync(zipBytes);
  if (!files['manifest.json']) throw new Error('manifest.json is missing');
  let manifest;
  try { manifest = JSON.parse(decoder.decode(files['manifest.json'])); }
  catch { throw new Error('manifest.json is not valid JSON'); }
  if (manifest.format !== PACKAGE_FORMAT || manifest.kind !== 'legacy-library' || !Array.isArray(manifest.archetypes)) {
    throw new Error('Not an Eyes4Beat library package');
  }
  const supported = manifest.formatVersion === 1 || manifest.formatVersion === PACKAGE_VERSION;
  const missingFiles = [], checksumMismatches = [], invalidEntries = [];
  const checked = new Set();
  for (const archetype of manifest.archetypes) {
    if (!['builtin', 'custom'].includes(archetype.kind) || !Number.isInteger(archetype.legacyIndex) ||
      typeof archetype.legacyId !== 'string' || typeof archetype.name !== 'string' ||
      !Number.isInteger(archetype.profile) || !archetype.behavior || !archetype.routingMap ||
      !archetype.imageConfig || !Array.isArray(archetype.musicPresets) ||
      (manifest.formatVersion === 2 && (!archetype.look?.distortion || !archetype.look?.color || !archetype.look?.particles))) {
      invalidEntries.push(archetype.name || 'Malformed archetype');
    }
    if (!Array.isArray(archetype.media)) { invalidEntries.push(archetype.name || 'Unnamed archetype'); continue; }
    for (const item of archetype.media) {
      if (!/^media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(item.path || '') || item.sha256 !== item.path.split('/')[1].split('.')[0] ||
        typeof item.name !== 'string' || typeof item.mime !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0) {
        invalidEntries.push(item.path || 'Invalid media path'); continue;
      }
      if (checked.has(item.path)) {
        if (files[item.path]?.byteLength !== item.size) checksumMismatches.push(item.path);
        continue;
      }
      checked.add(item.path);
      const bytes = files[item.path];
      if (!bytes) missingFiles.push(item.path);
      else if (bytes.byteLength !== item.size || await sha256(bytes) !== item.sha256) checksumMismatches.push(item.path);
    }
  }
  if (!files['raw/local-storage.json']) missingFiles.push('raw/local-storage.json');
  else try { const data = JSON.parse(decoder.decode(files['raw/local-storage.json'])); if (!data || Array.isArray(data) || typeof data !== 'object') invalidEntries.push('raw/local-storage.json'); }
    catch { invalidEntries.push('raw/local-storage.json'); }
  return { formatVersion: manifest.formatVersion, supported,
    archetypeCount: manifest.archetypes.length, mediaCount: checked.size, missingFiles, checksumMismatches, invalidEntries,
    valid: supported && !missingFiles.length && !checksumMismatches.length && !invalidEntries.length };
}
