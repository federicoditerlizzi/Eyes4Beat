import { createRotationState, stepRotation, createWaveState, stepWaves, breathPhase } from '../motion-effects.js';
import { particleAlpha, spawnBurst, stepParticles } from '../particle-lifecycle.js';
import { particleSpeed } from '../looks.js';
export function createEffects(pcanvas,eventIntensity){
 const ctx=pcanvas.getContext('2d');
let particles=[];
const motionStates=new Map();
let uniforms=null;
function resetVisualEffects(){motionStates.clear();particles=[];uniforms=null;if(ctx)ctx.clearRect(0,0,pcanvas.width,pcanvas.height)}
function motionFor(id){if(!motionStates.has(id))motionStates.set(id,{rotation:createRotationState(),pulse:createWaveState()});return motionStates.get(id)}
function updateVisualEffects({time,dt,lookA,lookB,current,target,FinalG,panicActive,palette,BPM,latestAnalysis,lastFeatureAt,events}){
 const beats=events.filter(event=>event.type==='beat'&&eventIntensity(event)>0).length;
 for(const index of new Set([current,target])){
   const look=index===target?lookB:lookA,state=motionFor(index);
   stepRotation(state.rotation,look.rotation,FinalG.rotate,dt,time,beats,panicActive);
   stepWaves(state.pulse,look.pulse.mode==='shockwave'?FinalG.pulse:0,time,{panic:panicActive,lifetime:3/look.pulse.speed});
   if(look.pulse.mode!=='shockwave')state.pulse.waves=[];
 }
 if(!panicActive&&FinalG.parts>0){
   for(const event of events)if(event.type===lookB.particles.burst.trigger){
     const intensity=eventIntensity(event)*Math.min(1,FinalG.parts);
     if(intensity>0)spawnBurst(particles,lookB.particles,intensity,pcanvas.width,pcanvas.height,palette);
   }
 }
 stepParticles(particles,{wanted:Math.floor(150*lookB.particles.density*FinalG.parts),dt,time,width:pcanvas.width,height:pcanvas.height,look:lookB,amount:FinalG.parts,palette,panic:panicActive});
 const a=motionFor(current),b=motionFor(target);
 uniforms={breath:breathPhase(time,BPM,latestAnalysis?.tempo.phase||0,(performance.now()-lastFeatureAt)/1000),
   rotationA:a.rotation,rotationB:b.rotation,wavesA:a.pulse.waves,wavesB:b.pulse.waves};
}
function updateParticles(time,dt,look,FinalG){
 const settings=look.particles;
 ctx.clearRect(0,0,pcanvas.width,pcanvas.height);ctx.globalCompositeOperation='screen';
 const speed=particleSpeed(look,FinalG.parts);
 // Reuse palette/fixed CSS colors. Opacity never allocates an rgba string per particle.
 for(const color of new Set(particles.map(p=>p.color))){
   ctx.fillStyle=color;ctx.strokeStyle=color;
   for(const p of particles){
     if(p.color!==color)continue;
     ctx.globalAlpha=Math.min(1,(.08+.34*p.z)*p.level*particleAlpha(p));ctx.lineWidth=.6+p.z;
     if(settings.style==='streaks'){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-(8+18*p.z)*speed,p.y+settings.streakSlant);ctx.stroke()}
     else if(settings.style==='rings'){ctx.beginPath();ctx.arc(p.x,p.y,p.r*(1.5+p.z*2),0,Math.PI*2);ctx.stroke()}
     else{ctx.beginPath();ctx.arc(p.x,p.y,p.r*(.6+p.z),0,Math.PI*2);ctx.fill()}
   }
 }
 ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}
function resize(width,height){
 if(pcanvas.width!==width||pcanvas.height!==height){const sx=width/Math.max(1,pcanvas.width),sy=height/Math.max(1,pcanvas.height);
 for(const p of particles){p.x*=sx;p.y*=sy;p.vx*=sx;p.vy*=sy}pcanvas.width=width;pcanvas.height=height}
}
return {reset:resetVisualEffects,update:updateVisualEffects,draw:updateParticles,resize,
 uniforms:()=>uniforms,clear:()=>ctx.clearRect(0,0,pcanvas.width,pcanvas.height)};
}
