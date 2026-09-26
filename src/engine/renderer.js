import { readOutputSettings, saveOutputSetting, RENDER_SCALE_KEY, normalizeRenderScale } from '../output-settings.js';
import { BLOOM_QUALITY_KEY, normalizeBloomQuality } from '../bloom.js';
import { BloomRenderer } from '../bloom-renderer.js';
import { blendBloom } from '../bloom.js';
import { extractMediaPalette } from '../media-palette.js';
import { vertexShaderSource, fragmentShaderSource } from '../shaders.js';
import { lookUniforms, NEUTRAL_LOOK } from '../looks.js';
import { rotationCoverAt, waveUniforms } from '../motion-effects.js';
const mediaUrl=source=>typeof source==='string'?source:source.url;
const mediaIsVideo=source=>typeof source!=='string'&&source.type?.startsWith('video/');
export function createRenderer(canvas,getMedia,onError){

const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'high-performance'});
if(!gl) throw new Error('WebGL2 is required. Try Chrome or Safari on a recent Mac.');


function sh(type,src){
 const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader)||'Unknown shader error';gl.deleteShader(shader);throw new Error(message)}
 return shader;
}
const requiredTextureUnits=4;
if(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)<requiredTextureUnits)throw new Error(`Eyes4Beat requires ${requiredTextureUnits} fragment texture units`);
let prog,sceneVao,sceneBuffer,bloomRenderer,contextLost=false,disposed=false;
const names=['uRotationA','uRotationB','uPulseA','uPulseB','uPulseShapeA','uPulseShapeB','uWavesA[0]','uWavesB[0]','uBreathPhase','uAspect','uFrameA','uFrameB','uRes','uTime','uMorphA','uMorphB','uTransA','uTransB','uSeedA','uSeedB','uParamA','uParamB','uWarpA','uWarpB','uWarpDirA','uWarpDirB','uGradeA','uGradeB','uArchMix','uMapPulse','uDistAmt','uLumAmt','uSatAmt','uZoomAmt','uSpiralAmt','uTilesAmt'];
const U={};
function initializeRenderer(){
 const vertexShader=sh(gl.VERTEX_SHADER,vertexShaderSource),fragmentShader=sh(gl.FRAGMENT_SHADER,fragmentShaderSource);
 prog=gl.createProgram();gl.attachShader(prog,vertexShader);gl.attachShader(prog,fragmentShader);gl.linkProgram(prog);
 if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)||'WebGL program link failed');
 gl.deleteShader(vertexShader);gl.deleteShader(fragmentShader);gl.useProgram(prog);
 sceneVao=gl.createVertexArray();gl.bindVertexArray(sceneVao);
 sceneBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,sceneBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
 names.forEach(n=>U[n]=gl.getUniformLocation(prog,n));
 ['tCurrentA','tCurrentB','tTargetA','tTargetB'].forEach((n,i)=>gl.uniform1i(gl.getUniformLocation(prog,n),i));
 bloomRenderer=new BloomRenderer(gl);
}
initializeRenderer();
const settings=readOutputSettings(globalThis.localStorage);
let bloomQuality=settings.quality,renderScale=settings.renderScale;
const onLost=event=>{event.preventDefault();contextLost=true;onError('WebGL context lost — waiting for restore')};
canvas.addEventListener('webglcontextlost',onLost);
const onRestored=()=>{
 if(disposed)return;
 try{
   initializeRenderer();
   for(let role=0;role<2;role++)for(let slot=0;slot<2;slot++){
     createTextureSlot(role,slot);
     const media=texMedia[role][slot];
     if(media&&(!(media instanceof HTMLVideoElement)||media.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA)){
       gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,media);
     }
   }
   bloomRenderer.resize(canvas.width,canvas.height,bloomQuality);contextLost=false;
 }catch(error){onError('Renderer recovery failed — reload the page');console.error(error)}
};
canvas.addEventListener('webglcontextrestored',onRestored);

const texObjs=Array.from({length:2},()=>[null,null]);
const texAspects=Array.from({length:2},()=>[1,1]);
const texMedia=Array.from({length:2},()=>[null,null]);
const texPalettes=Array.from({length:2},()=>[[],[]]),paletteCache=new Map();
function loadPalette(role,slot,media,source){const key=source?.mediaId||mediaUrl(source);if(!paletteCache.has(key))paletteCache.set(key,extractMediaPalette(media));texPalettes[role][slot]=paletteCache.get(key)}
function createTextureSlot(role,slot){
 const unit=role*2+slot;
 const tex=gl.createTexture();texObjs[role][slot]=tex;
 gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([12,16,22,255]));
}
for(let role=0;role<2;role++){createTextureSlot(role,0);createTextureSlot(role,1)}
function bindTextureSlot(role,slot){
 gl.activeTexture(gl.TEXTURE0+role*2+slot);gl.bindTexture(gl.TEXTURE_2D,texObjs[role][slot]);
}
function releaseTextureMedia(role,slot){
 const previous=texMedia[role][slot];
 if(previous instanceof HTMLVideoElement){previous.pause();previous.removeAttribute('src');previous.load()}
 texMedia[role][slot]=null;texPalettes[role][slot]=[];
}
const pendingMediaLoads=new Set(),pendingDecodes=new Set();
const slotTokens=[[0,0],[0,0]];
function releaseDecoded(media){if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute('src');media.load()}}
function decode(source){
 if(disposed)return Promise.resolve(null);
 if(!source||source.missing)return Promise.resolve({source,media:null});
 return new Promise(resolve=>{
  const video=mediaIsVideo(source),media=video?document.createElement('video'):new Image();
  const cancel=()=>finish(null),finish=result=>{pendingDecodes.delete(cancel);media.onload=null;media.onloadeddata=null;media.onerror=null;if(!result)releaseDecoded(media);resolve(result)};
  pendingDecodes.add(cancel);
  if(video){media.muted=true;media.loop=true;media.playsInline=true;media.preload='auto';media.onloadeddata=()=>finish({source,media})}
  else media.onload=()=>finish({source,media});
  media.onerror=()=>{onError('Unable to load media: '+source.name);finish({source,media:null})};
  media.src=mediaUrl(source);if(video)media.load();
 });
}
function commit(role,slot,decoded){
 if(disposed||!decoded){releaseDecoded(decoded?.media);return}
 releaseTextureMedia(role,slot);bindTextureSlot(role,slot);
 const {media,source}=decoded;texMedia[role][slot]=media;
 if(!media){texAspects[role][slot]=1;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([12,16,22,255]));return}
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,media);
 loadPalette(role,slot,media,source);texAspects[role][slot]=media instanceof HTMLVideoElement?media.videoWidth/Math.max(1,media.videoHeight):media.naturalWidth/Math.max(1,media.naturalHeight);
 if(media instanceof HTMLVideoElement)media.play().catch(()=>{});
}
function track(promise){pendingMediaLoads.add(promise);promise.finally(()=>pendingMediaLoads.delete(promise));return promise}
function trackedMediaLoad(role,slot,a,imgIdx){
 const token=++slotTokens[role][slot];
 return track(decode(getMedia(a,imgIdx)).then(decoded=>{if(token!==slotTokens[role][slot]||disposed)releaseDecoded(decoded?.media);else commit(role,slot,decoded)}));
}
function prepareRole(role,a,i0,i1){
 // Decode away from the live samplers; the caller commits both roles in one turn.
 return track(Promise.all([decode(getMedia(a,i0)),decode(getMedia(a,i1))]).then(items=>({
  commit(){for(let slot=0;slot<2;slot++){slotTokens[role][slot]++;commit(role,slot,items[slot])}},
  discard(){items.forEach(item=>releaseDecoded(item?.media))}
 })));
}
function invalidateLoads(){for(const row of slotTokens)for(let i=0;i<2;i++)row[i]++}
function dispose(){
 if(disposed)return;disposed=true;invalidateLoads();for(const cancel of [...pendingDecodes])cancel();
 canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);
 for(let role=0;role<2;role++)for(let slot=0;slot<2;slot++){releaseTextureMedia(role,slot);gl.deleteTexture(texObjs[role][slot])}
 bloomRenderer.dispose();gl.deleteBuffer(sceneBuffer);gl.deleteVertexArray(sceneVao);gl.deleteProgram(prog);paletteCache.clear();
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
}
function swapTextureSlots(role){
 [texPalettes[role][0],texPalettes[role][1]]=[texPalettes[role][1],texPalettes[role][0]];
 [texAspects[role][0],texAspects[role][1]]=[texAspects[role][1],texAspects[role][0]];
 const tmp=texObjs[role][0];texObjs[role][0]=texObjs[role][1];texObjs[role][1]=tmp;
 const media=texMedia[role][0];texMedia[role][0]=texMedia[role][1];texMedia[role][1]=media;
 bindTextureSlot(role,0);bindTextureSlot(role,1);
}
function refreshVideoTextures(){
 for(let role=0;role<2;role++)for(let slot=0;slot<2;slot++){
   const video=texMedia[role][slot];
   if(!(video instanceof HTMLVideoElement)||video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA||!video.videoWidth)continue;
   bindTextureSlot(role,slot);
   texAspects[role][slot]=video.videoWidth/Math.max(1,video.videoHeight);
   gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,video);
 }
}
function applyMotionUniforms(role,look,state,waves,elapsed=0,time=0){
 const rotation=look.rotation||NEUTRAL_LOOK.rotation,pulse=look.pulse||NEUTRAL_LOOK.pulse;
 gl.uniform2f(U['uRotation'+role],(state?.angle||0)*Math.PI/180,rotationCoverAt(state,rotation,canvas.width/canvas.height,time));
 gl.uniform4f(U['uPulse'+role],pulse.centerX,pulse.centerY,pulse.strength,pulse.speed);
 gl.uniform3f(U['uPulseShape'+role],pulse.mode==='shockwave'?1:0,pulse.width,pulse.chromatic);
 gl.uniform2fv(U['uWaves'+role+'[0]'],waveUniforms(waves||[]));
}
function draw({lookA,lookB,sequenceA,sequenceB,visualTime,motion,motionElapsed,breath,FinalG,archMix,transitioning}){
 bloomRenderer.beginScene(canvas.width,canvas.height,bloomQuality);
 gl.bindVertexArray(sceneVao);gl.useProgram(prog);
 for(let role=0;role<2;role++)for(let slot=0;slot<2;slot++)bindTextureSlot(role,slot);
 gl.uniform2f(U.uRes,canvas.width,canvas.height);
 gl.uniform1f(U.uTime,visualTime);
 gl.uniform1f(U.uBreathPhase,breath);

 applyMotionUniforms('A',lookA,motion?.rotationA,motion?.wavesA,motionElapsed,visualTime);applyMotionUniforms('B',lookB,motion?.rotationB,motion?.wavesB,motionElapsed,visualTime);

 const uniformsA=lookUniforms(lookA),uniformsB=lookUniforms(lookB);
 gl.uniform1f(U.uMorphA,sequenceA.blend);gl.uniform1f(U.uMorphB,sequenceB.blend);
 gl.uniform1i(U.uTransA,sequenceA.transitionShaderId);gl.uniform1i(U.uTransB,sequenceB.transitionShaderId);
 gl.uniform1f(U.uSeedA,sequenceA.seed);gl.uniform1f(U.uSeedB,sequenceB.seed);
 gl.uniform4fv(U.uParamA,sequenceA.param);gl.uniform4fv(U.uParamB,sequenceB.param);
 gl.uniform1f(U.uArchMix,transitioning?archMix:1);
 gl.uniform4fv(U.uWarpA,uniformsA.warp);gl.uniform4fv(U.uWarpB,uniformsB.warp);
 gl.uniform2fv(U.uWarpDirA,uniformsA.direction);gl.uniform2fv(U.uWarpDirB,uniformsB.direction);
 gl.uniform3fv(U.uFrameA,uniformsA.frame);gl.uniform3fv(U.uFrameB,uniformsB.frame);
 gl.uniform4fv(U.uGradeA,uniformsA.grade);gl.uniform4fv(U.uGradeB,uniformsB.grade);
 gl.uniform1f(U.uMapPulse,FinalG.pulse);
 gl.uniform1f(U.uDistAmt,FinalG.dist);gl.uniform1f(U.uLumAmt,FinalG.luma);gl.uniform1f(U.uSatAmt,FinalG.sat);gl.uniform1f(U.uZoomAmt,FinalG.zoom);
 gl.uniform1f(U.uSpiralAmt,FinalG.spiral);gl.uniform1f(U.uTilesAmt,FinalG.tiles);
 refreshVideoTextures();
 gl.uniform4f(U.uAspect,texAspects[0][0],texAspects[0][1],texAspects[1][0],texAspects[1][1]);
 gl.drawArrays(gl.TRIANGLES,0,3);
 const visualMix=transitioning?archMix:1;
 bloomRenderer.render(blendBloom(lookA.bloom,lookB.bloom,visualMix,FinalG.glow),uniformsA.vignette,uniformsB.vignette,visualMix);
}
return { draw, dispose, prepareRole, invalidateLoads, trackedMediaLoad, swapTextureSlots, releaseTextureMedia,
 waitForLoads:()=>Promise.all([...pendingMediaLoads]), clearPalette:()=>paletteCache.clear(),
 palette:(role,slot)=>texPalettes[role][slot], setQuality:value=>{bloomQuality=normalizeBloomQuality(value);saveOutputSetting(globalThis.localStorage,BLOOM_QUALITY_KEY,bloomQuality)},
 setRenderScale:value=>{renderScale=normalizeRenderScale(value);saveOutputSetting(globalThis.localStorage,RENDER_SCALE_KEY,renderScale)},
 get outputSettings(){return {quality:bloomQuality,renderScale}},
 get lost(){return contextLost}, get diagnostics(){return bloomRenderer.diagnostics},
 clear(){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT)},
 resize(){const w=Math.max(1,Math.floor(innerWidth*renderScale)),h=Math.max(1,Math.floor(innerHeight*renderScale));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}}
};
}
