import { AudioInputController, INPUT_DEVICE_KEY, readableInputError } from '../audio-input.js';

const TRIM_KEY='eyes4beat_input_trim',CALIBRATION_KEY='eyes4beat_input_calibrations';
export function createEngineAudio({locked=false,onFeatures,onReset,onError}){
 const audio=document.createElement('audio');audio.preload='metadata';
 let disposed=false,queue=Promise.resolve();const deferred=[];
 let url=null,fileName='',inputMode='file',lostDevice='',selectedDevice='',devices=[],info=null,status='',warning='',calibrationRun=null;
 let trims={},calibrations={};
 try{trims=JSON.parse(localStorage.getItem(TRIM_KEY)||'{}')||{};calibrations=JSON.parse(localStorage.getItem(CALIBRATION_KEY)||'{}')||{};selectedDevice=localStorage.getItem(INPUT_DEVICE_KEY)||''}catch{}
 const controller=new AudioInputController(audio,{onFeatures:features=>{
   if(calibrationRun&&performance.now()>=calibrationRun.endsAt&&!calibrationRun.finishing)finishCalibration();
   onFeatures(features);
 },onDeviceChange:async()=>{await enumerate();if(inputMode==='live'&&lostDevice&&devices.some(d=>d.deviceId===lostDevice))await activateLive(lostDevice)},
 onTrackEnded:id=>{lostDevice=id;onReset(true);controller.resetAnalysis(true);status='Input lost. Waiting for the same device to reconnect…';info=controller.diagnostics()},
 onCalibration:sample=>{if(calibrationRun){if(sample.count)calibrationRun.samples.push(sample);if(sample.final&&calibrationRun.finishing)finishCalibration()}},
 onAnalysisError:()=>{warning='Audio analysis stopped. Reload the page before performing.';onError(warning)}});
 const key=()=>inputMode==='live'?(controller.deviceId||selectedDevice||'default'):'file';
 const trim=()=>Number(trims[key()]??0);
 const calibration=()=>{const item=calibrations[key()];return item&&Number(item.trimDb)===trim()?item:null};
 function save(){try{localStorage.setItem(TRIM_KEY,JSON.stringify(trims));localStorage.setItem(CALIBRATION_KEY,JSON.stringify(calibrations))}catch{}}
 function applyTrim(){controller.setTrimDb(trim(),true);controller.setAnalysisCalibration(calibration())}
 function reset(){onReset();controller.resetAnalysis()}
 async function enumerate(){try{
  devices=(await controller.enumerateInputs()).map(d=>({deviceId:d.deviceId,label:d.label,builtIn:d.builtIn}));
  if(!devices.some(d=>d.deviceId===selectedDevice))selectedDevice=devices[0]?.deviceId||'';
 }catch(error){status=readableInputError(error)}return devices}
 async function activateLive(device=selectedDevice){
  inputMode='live';audio.pause();status='Requesting audio input…';reset();
  try{info=await controller.activateLive(device||undefined);controller.setAnalysisCalibration(calibration());lostDevice='';selectedDevice=device||info.deviceId;
   if(selectedDevice)try{localStorage.setItem(INPUT_DEVICE_KEY,selectedDevice)}catch{}
   await enumerate();status='Live input active · not routed to speakers.';applyTrim();
  }catch(error){status=readableInputError(error);info=controller.diagnostics()}
 }
 async function activateFile(){inputMode='file';lostDevice='';reset();
  try{await controller.activateFile();controller.setAnalysisCalibration(calibration());applyTrim();info=controller.diagnostics();status=audio.src?'File mode ready.':'Choose an audio file.'}
  catch(error){status=readableInputError(error)}
 }
 function finishCalibration(){
  if(calibrationRun&&!calibrationRun.finishing){calibrationRun.finishing=true;controller.setCalibrationCapture(false);return}
  if(!calibrationRun?.samples.length){calibrationRun=null;status='Calibration failed: no audio samples received.';return}
  const count=calibrationRun.samples.reduce((sum,sample)=>sum+sample.count,0),binCount=calibrationRun.samples.find(sample=>sample.spectrum)?.spectrum?.length||0,bins=new Array(binCount).fill(0);
  for(const sample of calibrationRun.samples)for(let index=0;index<binCount;index++)bins[index]+=(sample.spectrum?.[index]||0)/count;
  const rms=Math.sqrt(calibrationRun.samples.reduce((sum,sample)=>sum+sample.power,0)/count);calibrations[key()]={rms,bins,trimDb:trim(),createdAt:Date.now()};save();calibrationRun=null;controller.setAnalysisCalibration(calibration());
 }
 async function apply(type,p){
  if(disposed)return;
  switch(type){
   case 'audioRestore':
    if(p.blob)await apply('audioLoad',{blob:p.blob,name:p.name||'Audio file',autoplay:false});
    if(disposed)return;
    audio.volume=p.volume;audio.muted=p.muted;
    if(Number.isFinite(audio.duration))audio.currentTime=Math.min(p.currentTime,audio.duration);
    if(p.mode==='live')await activateLive(p.device);else if(p.blob)await activateFile();
    if(p.trim!=null)setTrim(p.trim);
    if(!disposed&&p.mode==='file'&&!p.paused&&p.blob)try{await audio.play()}catch{status='Press play to resume audio.'}
    break;
   case 'audioLoad':if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(p.blob);audio.src=url;fileName=p.name.replace(/\.[^.]+$/,'');await metadata();if(disposed)return;await activateFile();if(p.autoplay!==false)try{await audio.play()}catch{status='File loaded. Press play to start.'}break;
   case 'audioPlay':if(inputMode==='file'){await controller.ensureContext();if(disposed)return;applyTrim();await audio.play()}break;
   case 'audioPause':audio.pause();break;
   case 'audioSeek':if(Number.isFinite(audio.duration))audio.currentTime=p.fraction*audio.duration;break;
   case 'audioVolume':audio.volume=p.value;if(p.value>0)audio.muted=false;break;
   case 'audioMute':audio.muted=p.value;break;
   case 'setInput':if(p.mode==='file')await activateFile();else await activateLive(p.device);if(p.trim!=null)setTrim(p.trim);break;
   case 'setTrim':setTrim(p.value);break;
   case 'enumerateInputs':await enumerate();break;
   case 'calibrate':if(!controller.inputActive){status='Start playback or live input before calibrating.';break}calibrationRun={endsAt:performance.now()+3000,samples:[]};controller.setCalibrationCapture(true);break;
   case 'clearCalibration':delete calibrations[key()];save();controller.setAnalysisCalibration(null);break;
   case 'setDiagnostics':controller.setAnalysisDiagnostics(p.enabled);break;
  }
 }
 function setTrim(value){trims[key()]=value;save();controller.setTrimDb(value);if(calibrationRun){calibrationRun=null;controller.setCalibrationCapture(false)}}
 function snapshot(){return {locked,mode:inputMode,loaded:!!audio.src,paused:audio.paused,muted:audio.muted,volume:audio.volume,currentTime:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:0,fileName,
  trackName:inputMode==='file'?(fileName||'No track loaded'):lostDevice?'LIVE: INPUT LOST':controller.inputActive?'LIVE: '+info?.label:'LIVE INPUT UNAVAILABLE',
  device:selectedDevice,devices,trim:trim(),diagnostics:info,status,warning,calibrated:!!calibration(),stale:!!calibrations[key()]&&!calibration(),
  calibrating:!!calibrationRun,calibrationRemaining:calibrationRun?Math.max(0,(calibrationRun.endsAt-performance.now())/1000):0,sampleRate:controller.context?.sampleRate||0};}
 function metadata(){if(audio.readyState>=1)return Promise.resolve();return new Promise(resolve=>{
  const finish=()=>{audio.removeEventListener('loadedmetadata',finish);audio.removeEventListener('error',finish);audio.removeEventListener('emptied',finish);resolve()};
  audio.addEventListener('loadedmetadata',finish);audio.addEventListener('error',finish);audio.addEventListener('emptied',finish);
 })}
 function command(type,p={}){
  if(disposed)return Promise.reject(new Error('Audio disposed'));
  if(locked&&!['enumerateInputs','setDiagnostics'].includes(type)){deferred.push({type,p});status='Click to start in the output window.';return Promise.resolve()}
  const task=queue.then(()=>apply(type,p));queue=task.catch(()=>{});return task;
 }
 async function unlock(){
  if(disposed)return;await controller.ensureContext();if(disposed)return;locked=false;
  for(const item of deferred.splice(0))await command(item.type,item.p);
 }
 async function dispose(){
  if(disposed)return;disposed=true;deferred.length=0;audio.pause();audio.removeAttribute('src');audio.load();
  if(url)URL.revokeObjectURL(url);await controller.destroy();
 }
 return {controller,command,snapshot,unlock,dispose};
}
