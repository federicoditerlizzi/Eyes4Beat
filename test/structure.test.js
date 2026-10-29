import test from 'node:test';
import assert from 'node:assert/strict';
import { AccentDetector, normalizeAccentSettings } from '../src/accents.js';
import { getSources, getSource, registerSource, unregisterSource, replaceSources, withSourceDefinitions } from '../src/source-registry.js';
import { normalizeStructures, StructureRuntime, STRUCTURE_PARAMETERS, structureFieldRelevant } from '../src/structure.js';
import { normalizeLook } from '../src/looks.js';
import { effectivePost, blendPost } from '../src/post-effects.js';
import { normalizeMusicPresets, normalizeRoutingRecord, routingPresetModified } from '../src/routing-presets.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';
import { LocalLibraryRepository } from '../src/library/local-repository.js';
import { command } from '../src/engine/protocol.js';
import { indexedDB } from 'fake-indexeddb';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const event=(intensity,timestamp,type='kick')=>({type,intensity,timestamp});
const look=()=>normalizeLook({kaleido:{segments:6,mix:1},distortion:{amplitude:.08,angle:10},feedback:{zoom:.005,rotate:.5}});
const row=(patch={})=>normalizeStructures([{id:'row',trigger:'kick',parameter:'feedback.rotate',min:-1,max:1,mode:'cycle',values:[-1,1],durationMs:300,curve:'linear',...patch}])[0];
test('every event has exactly one derived accent, labels track metadata and removal',()=>{
 const before=getSources();
 try{
  for(const s of before.filter(s=>s.kind==='event'&&s.group!=='accent'))assert.equal(getSource(s.id+'_accent').label,s.label+' · accent');
  registerSource({id:'structurePad',label:'MIDI · KICK',kind:'event',group:'midi-pad'});
  assert.equal(getSource('structurePad_accent').label,'MIDI · KICK · accent');assert.equal(getSource('structurePad_accent_accent'),undefined);
  replaceSources(getSources().map(s=>s.id==='structurePad'?{...s,label:'Renamed'}:s));assert.equal(getSource('structurePad_accent').label,'Renamed · accent');
  unregisterSource('structurePad');assert.equal(getSource('structurePad_accent'),undefined);
  withSourceDefinitions([{id:'scopedPad',label:'Scoped',kind:'event',group:'midi-pad'}],()=>assert.equal(getSource('scopedPad_accent').kind,'event'));
 }finally{replaceSources(before)}
 assert.deepEqual(getSources(),before);
});
test('accent ratio uses the median of the last eight prior events, retaining original intensity',()=>{
 const detector=new AccentDetector();assert.equal(detector.process(event(.4,0)).intensity,.4);
 for(let i=1;i<=8;i++)assert.equal(detector.process(event(.4,i*.1)),null);
 assert.equal(detector.process(event(.54,.9)),null,'strictly greater than ratio × median');
 const accent=detector.process(event(.8,1));assert.equal(accent.type,'kick_accent');assert.equal(accent.intensity,.8);
 // Eight quiet events evict the louder history.
 for(let i=1;i<=8;i++)detector.process(event(.1,1+i*.05));
 assert.equal(detector.process(event(.2,1.45)).intensity,.2);
 assert.equal(detector.process(event(.9,.1)),null,'stale timestamps are ignored');
 assert.equal(detector.process(event(.9,1.5),{ratio:4,gapBeats:2}).intensity,.9);
});
test('accent gaps use beats with tempo, one second without it, independently per source',()=>{
 const d=new AccentDetector(),settings={ratio:4,gapBeats:2};d.process(event(.5,0),settings,120);
 assert.equal(d.process(event(.5,.999),settings,120),null);assert.ok(d.process(event(.5,1.999),settings,120));
 d.reset();d.process(event(.5,0),settings,60);assert.equal(d.process(event(.5,1.5),settings,60),null);assert.ok(d.process(event(.5,3.5),settings,60));
 d.reset();d.process(event(.5,0),settings,0);assert.equal(d.process(event(.5,.999),settings,0),null);assert.ok(d.process(event(.5,1.999),settings,0));
 assert.ok(d.process(event(.1,2,'snare'),settings,120));
 assert.deepEqual(normalizeAccentSettings(),{ratio:1.35,gapBeats:2});
});
test('random walk stays in its range after repeated triggers; parameters are bounded',()=>{
 let flip=false;const r=new StructureRuntime(()=>{flip=!flip;return flip?.99:.01});
 const rows=[row({mode:'random-walk',step:5})];const base=look();
 for(let i=0;i<100;i++){r.trigger('a',rows,base,event(1,i),i*400);const v=r.apply('a',rows,base,i*400+300).feedback.rotate;assert.ok(v>=-.5&&v<=1.5)}
 const normalized=normalizeStructures(Array.from({length:12},()=>row()));assert.equal(normalized.length,8);assert.equal(new Set(normalized.map(r=>r.id)).size,8);
 assert.deepEqual(normalizeStructures([{parameter:'arbitrary.path'}]),[]);
});
test('cycle order, frame-independent easing, and endpoint timing',()=>{
 for(const curve of ['linear','smoothstep','ease-in','ease-out']){
  const r=new StructureRuntime(),rows=[row({curve})],base=look();
  r.trigger('a',rows,base,event(1,0),100);
  near(r.apply('a',rows,base,100).feedback.rotate,.5);
  near(r.apply('a',rows,base,400).feedback.rotate,-.5);
  near(r.apply('a',rows,base,900).feedback.rotate,-.5);
  r.trigger('a',rows,base,event(1,1),1000);near(r.apply('a',rows,base,1300).feedback.rotate,1.5);
  r.trigger('a',rows,base,event(1,2),1400);near(r.apply('a',rows,base,1700).feedback.rotate,-.5);
 }
});
test('discrete segments change only at the dip minimum, including routed kaleido',()=>{
 const r=new StructureRuntime(),rows=[row({parameter:'kaleido.segments',min:6,max:8,values:[8,6]})],base=look();
 r.trigger('a',rows,base,event(1,0),0);
 const pre=r.apply('a',rows,base,149),mid=r.apply('a',rows,base,150),end=r.apply('a',rows,base,300);
 assert.equal(pre.kaleido.segments,6);assert.equal(mid.kaleido.segments,8);assert.equal(mid.kaleido.structuralDip,0);assert.equal(end.kaleido.structuralDip,1);
 assert.equal(effectivePost(blendPost(mid,mid,1),{kaleido:1}).kaleido,0);
 assert.deepEqual(base,look(),'saved look is untouched');
});
test('PANIC resets instantly and archetype release eases to base with independent offsets',()=>{
 const r=new StructureRuntime(),rows=[row()],base=look();r.trigger('a',rows,base,event(1,0),0);
 near(r.apply('a',rows,base,300).feedback.rotate,-.5);assert.deepEqual(r.apply('b',rows,base,300),base);
 r.release('a',base,300);near(r.apply('a',rows,base,450).feedback.rotate,0);assert.deepEqual(r.apply('a',rows,base,600),base);
 r.trigger('a',rows,base,event(1,1),700);r.reset();assert.deepEqual(r.apply('a',rows,base,701),base);
});
test('all vocabulary parameters apply within look limits and unrelated events do nothing',()=>{
 const base=look();
 for(const [parameter,p] of Object.entries(STRUCTURE_PARAMETERS)){
  const rows=[row({parameter,min:p.min,max:p.max,values:[p.max]})],r=new StructureRuntime();
  r.trigger('a',rows,base,event(1,0,'snare'),0);assert.deepEqual(r.apply('a',rows,base,400),base);
  r.trigger('a',rows,base,event(1,0),0);const out=r.apply('a',rows,base,400);
  assert.ok(out.distortion.amplitude<=.12);assert.ok(out.distortion.angle<=180);assert.ok(out.feedback.zoom<=.01);assert.ok(out.feedback.rotate<=3);
 }
 assert.equal(structureFieldRelevant(row(),'values'),true);assert.equal(structureFieldRelevant(row(),'step'),false);
 assert.equal(structureFieldRelevant(row({mode:'random-walk'}),'step'),true);
});
test('presets and old packages preserve or default structure, including modified comparison',()=>{
 const rows=[row({trigger:'kick_accent',parameter:'kaleido.segments',min:6,max:8,values:[6,8]})];
 const presets=normalizeMusicPresets([{name:'A',structure:rows},{name:'B',structure:[]},{name:'Old'}]);
 assert.deepEqual(presets[0].structure,rows);assert.deepEqual(presets[2].structure,[]);
 assert.equal(routingPresetModified({structure:[]},presets[0]),true);
 for(const version of [1,2,3]){
  const imported=prepareImportedArchetype({name:'A',media:[],musicPresets:presets,routingControls:{structure:rows}},version);
  assert.deepEqual(imported.musicPresets[0].structure,rows);assert.deepEqual(imported.routingControls.structure,rows);
 }
 assert.deepEqual(normalizeRoutingRecord({musicPresets:[{name:'Old'}]}).musicPresets[0].structure,[]);
});
test('repository save/recall retains two different structural presets',async()=>{
 globalThis.indexedDB=indexedDB;const repo=new LocalLibraryRepository('structure-'+Date.now());
 try{
  const project=await repo.createProject('Structures');
  const structures=[row({trigger:'kick_accent'})],other=[row({trigger:'snare',parameter:'distortion.angle',min:-90,max:90,values:[-90,90]})];
  const presets=normalizeMusicPresets([{name:'A',structure:structures},{name:'B',structure:other}]);
  const a=await repo.createArchetype(project.id,{name:'A',media:[],musicPresets:presets,routingControls:{structure:structures}});
  const saved=await repo.getArchetype(a.id);assert.deepEqual(saved.musicPresets.map(p=>p.structure),[structures,other]);
  await repo.updateArchetype(a.id,{routingControls:{structure:saved.musicPresets[1].structure}});
  assert.deepEqual((await repo.getArchetype(a.id)).routingControls.structure,other);
 }finally{await repo.close()}
});
test('wire validates structural lists and supports older controls',()=>{
 const controls={enabled:{},solo:{},amounts:{},intensity:{},reactivity:{},targetEnabled:{},targetSolo:{},ctxPerf:0,globalReact:1};
 assert.ok(command(1,'setControls',{controls}));assert.ok(command(1,'setControls',{controls:{...controls,structure:[row()],accent:normalizeAccentSettings()}}));
 assert.throws(()=>command(1,'setControls',{controls:{...controls,structure:Array(9).fill(row())}}));
 assert.throws(()=>command(1,'setControls',{controls:{...controls,structure:[{...row(),parameter:'constructor'}]}}));
});

test('retriggered segment dip retains its current level even if the new target cancels the change',()=>{
 const runtime=new StructureRuntime(),base=look(),rows=[row({parameter:'kaleido.segments',min:6,max:8,values:[8,6]})];
 runtime.trigger('a',rows,base,event(1,0),0);const before=runtime.apply('a',rows,base,100);
 runtime.trigger('a',rows,base,event(1,.1),100);const after=runtime.apply('a',rows,base,100);
 near(after.kaleido.structuralDip,before.kaleido.structuralDip);assert.equal(after.kaleido.segments,6);
 near(runtime.apply('a',rows,base,400).kaleido.structuralDip,1);
});
test('scoped MIDI accent structures survive inactive-project reads and old/current imports',()=>{
 const definition={id:'scopedKick',label:'MIDI · KICK',kind:'event',group:'midi-pad'};
 const record={name:'Scoped',origin:{sourceDefinitions:[definition]},media:[],routingControls:{structure:[{id:'s',trigger:'scopedKick_accent',parameter:'kaleido.segments',min:6,max:8,mode:'cycle',values:[6,8]}]},musicPresets:[]};
 assert.equal(normalizeRoutingRecord(record).routingControls.structure[0].trigger,'scopedKick_accent');
 for(const version of [1,2,3])assert.equal(prepareImportedArchetype(record,version).routingControls.structure[0].trigger,'scopedKick_accent');
 assert.equal(getSource('scopedKick'),undefined);assert.equal(getSource('scopedKick_accent'),undefined);
 const walk=row({parameter:'kaleido.segments',min:6,max:8,mode:'random-walk'});assert.equal(walk.step,1);
});

test('editing another structural row preserves an existing offset',()=>{
 const runtime=new StructureRuntime(),base=look(),first=row();runtime.trigger('a',[first],base,event(1,0),0);
 const other=row({id:'other',trigger:'snare',parameter:'feedback.zoom',min:-.005,max:.005,values:[.005]});
 near(runtime.apply('a',[first,other],base,400).feedback.rotate,-.5);
 const edited={...first,values:[.5]};assert.equal(runtime.apply('a',[edited,other],base,400),base);
});
