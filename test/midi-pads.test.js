import {PAD_RELEASE_MS} from '../src/event-envelope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {MidiPads,defaultMidiSlots,normalizeMidiSlots,midiSourceDefinitions,syncMidiSources,mergeMidiSlots} from '../src/midi/pads.js';
import {AUDIO_SOURCES,replaceSources,getSource,withSourceDefinitions} from '../src/source-registry.js';
import {LocalLibraryRepository} from '../src/library/local-repository.js';
import {buildLibraryPackage,verifyLibraryPackage} from '../src/package-format.js';
import {prepareImportedArchetype} from '../src/library/package-mapping.js';
import {normalizeLook} from '../src/looks.js';
const hit=(note,velocity=127,channel=1,timestamp=100)=>({type:'note-on',note,velocity,channel,timestamp});
test('Learn is one-shot, supports several notes and preserves velocity and event timestamps',()=>{
 const pads=new MidiPads();pads.load('p',defaultMidiSlots());const id=pads.slots[1].id;
 pads.learn(id);assert.equal(pads.receive({...hit(38),type:'note-off'}),null);assert.equal(pads.learning,id);
 const event=pads.receive(hit(38,64));assert.equal(event.intensity,64/127);assert.equal(event.timestamp,.1);assert.equal(pads.learning,null);
 pads.receive(hit(39));assert.equal(pads.slots[1].bindings.length,1);pads.learn(id);pads.receive(hit(40,100,2));assert.equal(pads.slots[1].bindings.length,2);
 assert.equal(pads.receive(hit(40,127,1)),null);assert.equal(pads.receive(hit(40,127,2)).type,id);
 assert.equal(pads.values(100)[id],1);assert.ok(Math.abs(pads.values(100+PAD_RELEASE_MS)[id]-Math.exp(-1))<1e-12);
});
test('Duplicate bindings remain in the original slot until token-confirmed move; cancel and stale confirmations are safe',()=>{
 const pads=new MidiPads();pads.load('p');const [a,b]=pads.slots;
 pads.learn(a.id);pads.receive(hit(36));pads.learn(b.id);pads.receive(hit(36));
 assert.equal(a.bindings.length,1);assert.equal(b.bindings.length,0);const token=pads.pending.token;
 assert.equal(pads.confirm(token+1,true),false);pads.confirm(token,false);assert.equal(a.bindings.length,1);
 pads.learn(b.id);pads.receive(hit(36));pads.confirm(pads.pending.token,true);assert.equal(a.bindings.length,0);assert.equal(b.bindings.length,1);
 pads.learn(a.id);pads.receive(hit(36));const old=pads.pending.token;pads.load('another');assert.equal(pads.confirm(old,true),false);
});
test('Defaults, slot limits, registry labels and independent audio sources',()=>{
 const slots=defaultMidiSlots();assert.deepEqual(slots.map(s=>s.name),['KICK','SNARE','HAT','PERC']);syncMidiSources(slots);
 assert.equal(getSource(slots[0].id).label,'MIDI · KICK');assert.equal(getSource('kick').group,'audio');syncMidiSources([]);assert.equal(getSource(slots[0].id),undefined);replaceSources(AUDIO_SOURCES);
 assert.throws(()=>normalizeMidiSlots(Array.from({length:17},(_,i)=>({id:'midi_pad_'+i,name:'PAD',bindings:[]}))));
 slots[0].bindings=[{note:36,channel:1}];slots[1].bindings=[{note:36,channel:1}];assert.throws(()=>normalizeMidiSlots(slots));
});
test('Project MIDI slots survive local reload, duplicate, v3 package round-trip and imported mappings',async()=>{
 const repo=new LocalLibraryRepository('midi-test-'+crypto.randomUUID()),slots=defaultMidiSlots();slots[0].bindings=[{note:36,channel:10}];slots[1].bindings=[{note:38,channel:10},{note:40,channel:10}];
 const project=await repo.createProject('MPC');await repo.updateProject(project.id,{midiSlots:slots});assert.deepEqual((await repo.getProject(project.id)).midiSlots,slots);
 const duplicate=await repo.duplicateProject(project.id);assert.deepEqual(duplicate.midiSlots,slots);
 const record={id:'scene',name:'Scene',origin:{type:'blank',sourceDefinitions:midiSourceDefinitions(slots)},look:normalizeLook({}),routingMap:{[slots[0].id]:{pulse:1}},imageConfig:{mode:'mapped',source:slots[0].id,images:[]},musicPresets:[],media:[]};
 const pack=await buildLibraryPackage({kind:'project',project:{name:'MPC',midiSlots:slots},archetypes:[record]});assert.equal((await verifyLibraryPackage(pack.zip)).valid,true);
 replaceSources(AUDIO_SOURCES);const imported=prepareImportedArchetype(pack.manifest.archetypes[0],3,pack.manifest.project.midiSlots);
 assert.equal(imported.routingMap[slots[0].id].pulse,1);assert.equal(imported.imageConfig.source,slots[0].id);
 const result=await repo.importBatch({projectName:'Imported',midiSlots:pack.manifest.project.midiSlots,archetypes:[imported]});assert.deepEqual(result.project.midiSlots,slots);
 assert.equal((await repo.listArchetypes(result.project.id))[0].routingMap[slots[0].id].pulse,1);
 assert.deepEqual(mergeMidiSlots(defaultMidiSlots(),slots),slots);await repo.close();
});
