import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { serveApi } from '../functions/_lib/service.js';
import { SqliteD1, FakeR2 } from './helpers/d1-sqlite.js';

const alice = 'alice@example.com', bob = 'bob@example.com';
function fixture() {
  const db = new SqliteD1(), media = new FakeR2();
  const call = async (email, method, path, data, headers = {}) => {
    const url = `http://localhost${path}`;
    const request = new Request(url, { method, headers: data && !(data instanceof Uint8Array) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: data === undefined ? undefined : data instanceof Uint8Array ? data : JSON.stringify(data) });
    const response = await serveApi(request, db, media, { email });
    return { status: response.status, data: method === 'HEAD' ? null : await response.json().catch(() => null), response };
  };
  return { db, media, call };
}
const createProject = async (call, email = alice, name = 'Show') => (await call(email, 'POST', '/api/projects', { name })).data;
const archetypeData = mediaId => ({ name: 'Scene', origin: { type: 'blank', presetId: null }, look: {}, routingMap: {}, imageConfig: {}, musicPresets: [], media: mediaId ? [{ mediaId, name: 'still.png', mime: 'image/png', size: 3 }] : [] });
const upload = async (call, email = alice) => {
  const bytes = new Uint8Array([1, 2, 3]), hash = createHash('sha256').update(bytes).digest('hex');
  const result = await call(email, 'PUT', `/api/media/${hash}`, bytes, { 'Content-Type': 'image/png' });
  assert.equal(result.status, 201); return hash;
};

test('private projects stay private; shared projects can be edited but not deleted by guests', async () => {
  const { call, db } = fixture();
  const p = await createProject(call);
  assert.equal((await call(bob, 'GET', '/api/projects')).data.length, 0);
  assert.equal((await call(bob, 'GET', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await call(bob, 'PATCH', `/api/projects/${p.id}`, { visibility: 'shared', if_version: 1 })).status, 404);
  const shared = await call(alice, 'PATCH', `/api/projects/${p.id}`, { visibility: 'shared', if_version: 1 });
  assert.equal(shared.status, 200);
  assert.equal((await call(bob, 'PATCH', `/api/projects/${p.id}`, { name: 'Edited', if_version: 2 })).status, 200);
  assert.equal((await call(bob, 'DELETE', `/api/projects/${p.id}?if_version=3`)).status, 403);
  assert.equal((await call(bob, 'PATCH', `/api/projects/${p.id}`, { visibility: 'private', if_version: 3 })).status, 403);
  assert.equal((await call(alice, 'PATCH', `/api/projects/${p.id}`, { name: 'Old', if_version: 2 })).status, 409);
  db.close();
});

test('atomic create, duplicate and soft-delete keep order and media links', async () => {
  const { call, db } = fixture();
  const p = await createProject(call), mediaId = await upload(call);
  const created = await call(alice, 'POST', `/api/projects/${p.id}/archetypes`, archetypeData(mediaId));
  assert.equal(created.status, 201);
  const item = created.data;
  assert.equal((await call(alice, 'GET', `/api/projects/${p.id}`)).data.project.archetypeOrder.length, 1);
  const copy = await call(alice, 'POST', `/api/archetypes/${item.id}/duplicate`, {});
  assert.equal(copy.status, 201);
  assert.equal((await call(alice, 'GET', `/api/projects/${p.id}`)).data.project.archetypeOrder.length, 2);
  assert.equal((await call(alice, 'DELETE', `/api/archetypes/${item.id}?if_version=1`)).status, 200);
  assert.equal((await call(alice, 'GET', `/api/projects/${p.id}`)).data.project.archetypeOrder.length, 1);
  const projectCopy = await call(alice, 'POST', `/api/projects/${p.id}/duplicate`, { name: 'Copy' });
  assert.equal(projectCopy.status, 201);
  assert.equal((await call(alice, 'GET', `/api/projects/${projectCopy.data.id}`)).data.archetypes.length, 1);
  const before = (await call(alice, 'GET', `/api/projects/${p.id}`)).data.project.version;
  const missingId = randomUUID();
  const failed = await call(alice, 'POST', `/api/projects/${p.id}/archetypes`, { ...archetypeData(), id: missingId, media: [{ mediaId: 'a'.repeat(64), name: 'x', mime: 'image/png', size: 3 }] });
  assert.equal(failed.status, 400);
  assert.equal((await call(alice, 'GET', `/api/projects/${p.id}`)).data.project.version, before);
  db.close();
});

test('a database failure inside an archetype batch rolls back its project-order update', async () => {
  const { call, db } = fixture(), p = await createProject(call);
  db.sqlite.exec("CREATE TRIGGER reject_archetype BEFORE INSERT ON archetypes BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
  const failed = await call(alice, 'POST', `/api/projects/${p.id}/archetypes`, archetypeData());
  assert.equal(failed.status, 500);
  const after = (await call(alice, 'GET', `/api/projects/${p.id}`)).data;
  assert.equal(after.project.version, 1);
  assert.deepEqual(after.project.archetypeOrder, []);
  assert.deepEqual(after.archetypes, []);
  db.close();
});

test('media hash, mime, size and read permissions', async () => {
  const { call, db } = fixture();
  const p = await createProject(call), bytes = new Uint8Array([1, 2, 3]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal((await call(alice, 'PUT', `/api/media/${'0'.repeat(64)}`, bytes, { 'Content-Type': 'image/png' })).status, 400);
  assert.equal((await call(alice, 'PUT', `/api/media/${hash}`, bytes, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call(alice, 'PUT', `/api/media/${hash}`, bytes, { 'Content-Type': 'image/png', 'Content-Length': String(50 * 1024 * 1024 + 1) })).status, 413);
  await upload(call);
  assert.equal((await call(bob, 'HEAD', `/api/media/${hash}`)).status, 404);
  assert.equal((await call(alice, 'HEAD', `/api/media/${hash}`)).status, 200);
  const privateBobProject = await createProject(call, bob, 'Bob');
  assert.equal((await call(bob, 'POST', `/api/projects/${privateBobProject.id}/archetypes`, archetypeData(hash))).status, 403);
  assert.equal((await call(bob, 'PUT', `/api/media/${hash}`, bytes, { 'Content-Type': 'image/png' })).status, 200);
  assert.equal((await call(bob, 'HEAD', `/api/media/${hash}`)).status, 200);
  await call(alice, 'POST', `/api/projects/${p.id}/archetypes`, archetypeData(hash));
  assert.equal((await call('charlie@example.com', 'GET', `/api/media/${hash}`)).status, 404);
  await call(alice, 'PATCH', `/api/projects/${p.id}`, { visibility: 'shared', if_version: 2 });
  assert.equal((await call('charlie@example.com', 'HEAD', `/api/media/${hash}`)).status, 200);
  db.close();
});

test('changes include deletion and visibility removal', async () => {
  const { call, db } = fixture();
  const since = new Date(Date.now() - 5000).toISOString();
  const p = await createProject(call);
  const shared = await call(alice, 'PATCH', `/api/projects/${p.id}`, { visibility: 'shared', if_version: 1 });
  assert.equal(shared.status, 200);
  const item = (await call(bob, 'POST', `/api/projects/${p.id}/archetypes`, archetypeData())).data;
  await call(bob, 'DELETE', `/api/archetypes/${item.id}?if_version=1`);
  const changed = await call(bob, 'GET', `/api/changes?since=${encodeURIComponent(since)}`);
  assert.equal(changed.data.archetypes[0].deleted_at !== null, true);
  const current = (await call(alice, 'GET', `/api/projects/${p.id}`)).data.project;
  await call(alice, 'PATCH', `/api/projects/${p.id}`, { visibility: 'private', if_version: current.version });
  const removed = await call(bob, 'GET', `/api/changes?since=${encodeURIComponent(since)}`);
  assert.deepEqual(removed.data.projects[0].removed, true);
  db.close();
});

test('project deletion atomically tombstones its archetypes and look presets', async () => {
  const { call, db } = fixture();
  const p = await createProject(call);
  const item = (await call(alice, 'POST', `/api/projects/${p.id}/archetypes`, archetypeData())).data;
  const preset = (await call(alice, 'POST', `/api/projects/${p.id}/look-presets`, { name: 'Blue', look: {} })).data;
  const current = (await call(alice, 'GET', `/api/projects/${p.id}`)).data.project;
  assert.equal((await call(alice, 'DELETE', `/api/projects/${p.id}?if_version=${current.version}`)).status, 200);
  assert.equal((await call(alice, 'GET', `/api/projects/${p.id}`)).status, 404);
  assert.equal(db.sqlite.prepare('SELECT deleted_at FROM archetypes WHERE id=?').get(item.id).deleted_at !== null, true);
  assert.equal(db.sqlite.prepare('SELECT deleted_at FROM look_presets WHERE id=?').get(preset.id).deleted_at !== null, true);
  db.close();
});

test('routing preset ids and active selection persist through API updates and project reads',async()=>{
 const {call}=fixture(),p=await createProject(call);
 const created=await call(alice,'POST',`/api/projects/${p.id}/archetypes`,{...archetypeData(),musicPresets:[{name:'Old',amounts:{level:.5}}]});
 assert.equal(created.status,201);const a=created.data,presetId=a.musicPresets[0].id;assert.ok(presetId);
 const selected=await call(alice,'PATCH',`/api/archetypes/${a.id}`,{if_version:a.version,activeRoutingPresetId:presetId,routingControls:{amounts:{level:.7}}});assert.equal(selected.status,200);
 const renamed=await call(alice,'PATCH',`/api/archetypes/${a.id}`,{if_version:selected.data.version,name:'Renamed'});assert.equal(renamed.data.activeRoutingPresetId,presetId);
 const snapshot=await call(alice,'GET',`/api/projects/${p.id}`);assert.equal(snapshot.data.archetypes[0].musicPresets[0].id,presetId);assert.equal(snapshot.data.archetypes[0].routingControls.amounts.level,.7);
});

test('extension sources persist through server normalization using record-scoped metadata',async()=>{
 const {call,db}=fixture();try{
 const p=await createProject(call),data=archetypeData();
 data.origin.sourceDefinitions=[{id:'pad',label:'Pad',kind:'event',group:'midi'}];
 data.routingMap={pad:{pulse:.7},unknown:{glow:1},energy:{dist:.5}};
 data.musicPresets=[{name:'Pad',amounts:{pad:.6,open:.3},routing:{pad:{pulse:.7}}}];
 data.imageConfig={mode:'mapped',source:'pad'};data.look={particles:{burst:{trigger:'pad'}}};
 const created=await call(alice,'POST',`/api/projects/${p.id}/archetypes`,data);assert.equal(created.status,201);
 assert.equal(created.data.routingMap.pad.pulse,.7);assert.equal(created.data.routingMap.level.dist,.5);assert.equal(created.data.routingMap.unknown,undefined);
 assert.equal(created.data.imageConfig.source,'pad');assert.equal(created.data.look.particles.burst.trigger,'pad');
 const read=await call(alice,'GET',`/api/projects/${p.id}`),record=read.data.archetypes[0];
 assert.equal(record.musicPresets[0].amounts.pad,.6);assert.equal(record.musicPresets[0].amounts.full,-.3);
 const other=await call(alice,'POST',`/api/projects/${p.id}/archetypes`,{...archetypeData(),routingMap:{pad:{pulse:1}}});assert.equal(other.data.routingMap.pad,undefined,'metadata does not leak across records');
 }finally{db.close()}
});

test('project MIDI slots sync, duplicate and reject invalid or duplicate note bindings',async()=>{
 const {call,db}=fixture();
 const slots=[{id:'midi_pad_kick',name:'KICK',bindings:[{note:36,channel:10}]}];
 const p=(await call(alice,'POST','/api/projects',{name:'MPC',midiSlots:slots})).data;
 assert.deepEqual(p.midiSlots,slots);
 const next=[...slots,{id:'midi_pad_snare',name:'SNARE',bindings:[{note:38,channel:10},{note:40,channel:10}]}];
 const updated=await call(alice,'PATCH',`/api/projects/${p.id}`,{midiSlots:next,if_version:1});assert.equal(updated.status,200);assert.deepEqual(updated.data.midiSlots,next);
 const changes=await call(alice,'GET','/api/changes?since=2020-01-01T00:00:00.000Z');assert.deepEqual(changes.data.projects.find(x=>x.id===p.id).midiSlots,next);
 const duplicate=await call(alice,'POST',`/api/projects/${p.id}/duplicate`,{});assert.deepEqual(duplicate.data.midiSlots,next);
 const bad=structuredClone(next);bad[1].bindings.push({note:36,channel:10});assert.equal((await call(alice,'PATCH',`/api/projects/${p.id}`,{midiSlots:bad,if_version:2})).status,400);
 assert.deepEqual((await call(alice,'GET',`/api/projects/${p.id}`)).data.project.midiSlots,next);db.close();
});
