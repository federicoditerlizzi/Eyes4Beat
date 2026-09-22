import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, zipSync } from 'fflate';
import { buildLibraryPackage, mediaExtension, verifyLibraryPackage } from '../src/package-format.js';

const bytes = new TextEncoder().encode('shared media data');
const archetype = name => ({ kind: 'builtin', legacyIndex: 0, legacyId: 'deep-drift', name,
  profile: 0, templateIndex: null, behavior: { warp: .2 }, routingMap: { energy: { pulse: 1 } },
  look: { distortion: {}, color: {}, particles: {} }, imageConfig: { mode: 'auto' }, musicPresets: [{ name: 'Live' }],
  media: [{ name: 'frame.webp', mime: 'image/webp', bytes }] });

test('media extensions use MIME and safe name fallbacks', () => {
  assert.equal(mediaExtension('frame.jpg', 'image/webp'), 'webp');
  assert.equal(mediaExtension('movie.mp4', ''), 'mp4');
  assert.equal(mediaExtension('unknown.exe', ''), 'bin');
});

test('build, zip, unzip and validate a deduplicated library', async () => {
  const result = await buildLibraryPackage({ archetypes: [archetype('Deep Drift'), archetype('Copy')],
    localStorage: { arv_test: 'saved' }, appVersion: '0.1.0', userAgent: 'test' });
  assert.equal(result.uniqueMediaCount, 1);
  assert.equal(result.manifest.archetypes[0].media[0].path, result.manifest.archetypes[1].media[0].path);
  const files = unzipSync(result.zip);
  assert.equal(JSON.parse(new TextDecoder().decode(files['raw/local-storage.json'])).arv_test, 'saved');
  assert.equal(Object.keys(files).filter(path => path.startsWith('media/')).length, 1);
  assert.equal((await verifyLibraryPackage(result.zip)).valid, true);
  assert.equal(result.manifest.formatVersion, 2);
  assert.deepEqual(result.manifest.archetypes[0].look, archetype('Deep Drift').look);
});

test('version-one packages remain verifiable', async () => {
  const result = await buildLibraryPackage({ archetypes: [archetype('Deep Drift')], appVersion: '0.1.0', userAgent: 'test' });
  const files = unzipSync(result.zip);
  const manifest = result.manifest;
  manifest.formatVersion = 1;
  delete manifest.archetypes[0].look;
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const report = await verifyLibraryPackage(zipSync(files));
  assert.equal(report.valid, true);
  assert.equal(report.formatVersion, 1);
});

test('verification detects missing and corrupted media', async () => {
  const result = await buildLibraryPackage({ archetypes: [archetype('Deep Drift')], appVersion: '0.1.0', userAgent: 'test' });
  const path = result.manifest.archetypes[0].media[0].path;
  const missing = unzipSync(result.zip); delete missing[path];
  assert.deepEqual((await verifyLibraryPackage(zipSync(missing))).missingFiles, [path]);
  const corrupt = unzipSync(result.zip); corrupt[path] = new TextEncoder().encode('corrupted media');
  assert.deepEqual((await verifyLibraryPackage(zipSync(corrupt))).checksumMismatches, [path]);
});
