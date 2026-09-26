import test from 'node:test';
import assert from 'node:assert/strict';
import { particleAlpha, spawnBurst, stepParticles } from '../src/particle-lifecycle.js';
import { NEUTRAL_LOOK, normalizeLook } from '../src/looks.js';
import { dominantColors } from '../src/media-palette.js';
const look=normalizeLook({...NEUTRAL_LOOK,particles:{...NEUTRAL_LOOK.particles,density:1}});
const context={wanted:10,dt:0,time:0,width:800,height:600,look,amount:1};
test('particle count reductions retire particles with a fade rather than deleting instantly',()=>{
 const particles=[];stepParticles(particles,context,()=>.5);assert.equal(particles.length,10);
 stepParticles(particles,{...context,wanted:2,dt:.1});assert.equal(particles.length,10);assert.equal(particles.filter(p=>p.release!=null).length,8);
 stepParticles(particles,{...context,wanted:2,dt:.6});assert.equal(particles.length,2);
});
test('lifecycle fades in and out and natural deaths expire',()=>{
 assert.equal(particleAlpha({age:0,life:2,release:null}),0);
 assert.equal(particleAlpha({age:1,life:2,release:null}),1);
 assert.ok(particleAlpha({age:1.8,life:2,release:null})<.5);
 assert.equal(particleAlpha({age:2,life:2,release:null}),0);
 const particles=[];stepParticles(particles,{...context,wanted:1},()=>.5);
 stepParticles(particles,{...context,wanted:0,dt:10});assert.equal(particles.length,0);
});
test('bursts scale count by intensity, use radial velocity/drag, expire and respect cap',()=>{
 const settings={...look.particles,burst:{trigger:'kick',amount:40,speed:100,spread:1,origin:'center'}},p=[];
 assert.equal(spawnBurst(p,settings,.5,800,600,[],()=>.5),20);
 assert.ok(p.every(item=>item.x===400&&item.y===300&&item.burst));
 const speed=Math.hypot(p[0].vx,p[0].vy);
 stepParticles(p,{...context,wanted:0,dt:.1});assert.ok(Math.hypot(p[0].vx,p[0].vy)<speed);
 stepParticles(p,{...context,wanted:0,dt:3});assert.equal(p.length,0);
 spawnBurst(p,settings,100,800,600,[],()=>.5);assert.equal(p.length,1000);
 stepParticles(p,{...context,panic:true});assert.equal(p.length,0);
});
test('palette particles use cached media colors',()=>{
 const p=[],palette=['#ff0000','#00ff00','#0000ff'];
 stepParticles(p,{...context,wanted:3,palette,look:normalizeLook({...look,particles:{...look.particles,colorMode:'palette'}})},()=>.5);
 assert.ok(p.every(item=>palette.includes(item.color)));

});
test('dominant palette ignores transparent pixels and yields separated media colors',()=>{
 const pixels=new Uint8Array([255,0,0,255,250,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255,0,255,255,255,255,0,255,0]);
 const palette=dominantColors(pixels);assert.equal(palette.length,5);assert.ok(!palette.includes('#ff00ff'));assert.ok(palette.includes('#00ff00'));
});
