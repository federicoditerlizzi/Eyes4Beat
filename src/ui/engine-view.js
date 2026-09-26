// UI reads full engine snapshots; no AudioNodes, textures or runtime state are shared.
export function renderEngineState(state,{seeking=false,clipHoldUntil=0}={}){
 if(state.outputSettings){
  const {quality,renderScale}=state.outputSettings;
  document.getElementById('bloomQuality').value=quality;
  const slider=document.getElementById('renderScale');
  if(document.activeElement!==slider)slider.value=renderScale;
  document.getElementById('renderScaleValue').textContent=Math.round(Number(slider.value)*100)+'%';
 }
 const el=id=>document.getElementById(id),t=state.transport;
 const format=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
 const action=(id,label)=>{el(id).title=label;el(id).dataset.tooltip=label;el(id).setAttribute('aria-label',label)};
 action('play',t.paused?'Play':'Pause');action('mute',t.muted?'Unmute':'Mute');
 el('play').classList.toggle('playing',!t.paused);el('mute').classList.toggle('active',t.muted);
 for(const id of ['play','seek','mute','volume'])el(id).disabled=t.mode!=='file'||!t.loaded;
 if(!seeking){el('seek').value=t.duration>0?String(Math.round(t.currentTime/t.duration*1000)):'0';el('timeDisplay').textContent=format(t.currentTime)+' / '+format(t.duration)}
 el('trackName').textContent=t.trackName;
 for(const [id,active] of [['fileModeBtn',t.mode==='file'],['liveModeBtn',t.mode==='live'],['audioInputBtn',t.mode==='live']])el(id).classList.toggle('active',active);
 el('audioDevice').disabled=t.mode!=='live';el('startLiveInput').disabled=t.mode!=='live';
 const signature=JSON.stringify(t.devices);
 if(el('audioDevice').dataset.devices!==signature){el('audioDevice').dataset.devices=signature;el('audioDevice').replaceChildren();
  for(const device of t.devices){const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label+(device.builtIn?' · built-in':'');el('audioDevice').appendChild(option)}
  if(!t.devices.length){const option=document.createElement('option');option.value='';option.textContent='No audio inputs found';el('audioDevice').appendChild(option)}
 }
 if(document.activeElement!==el('audioDevice'))el('audioDevice').value=t.device;
 if(document.activeElement!==el('inputTrim'))el('inputTrim').value=String(t.trim);
 el('inputTrimValue').textContent=t.trim.toFixed(1)+' dB';el('audioInputStatus').textContent=t.status;
 const info=t.diagnostics,flag=value=>value===true?'ON':value===false?'OFF':'UNSUPPORTED';
 const latency=typeof info?.baseLatency==='number'?(info.baseLatency*1000).toFixed(1)+' ms':String(info?.baseLatency??'—');
 el('inputDiagnostics').textContent=info?`${info.mode.toUpperCase()} · ${info.label} · ${info.sampleRate} Hz · ${info.channelCount} ch · EC ${flag(info.echoCancellation)} · NS ${flag(info.noiseSuppression)} · AGC ${flag(info.autoGainControl)} · latency ${latency}`:'Waiting for source';
 el('inputDiagnostics').title=el('inputDiagnostics').textContent;
 el('inputWarning').textContent=t.warning||info?.warning||'';el('inputWarning').classList.toggle('active',!!el('inputWarning').textContent);
 el('calibrateNoise').disabled=t.calibrating;el('calibrationStatus').classList.toggle('calibrated',t.calibrated&&!t.calibrating);
 el('calibrationStatus').textContent=t.calibrating?'SILENCE · '+t.calibrationRemaining.toFixed(1)+' s':t.calibrated?'CALIBRATED':t.stale?'STALE · RECALIBRATE':'NOT CALIBRATED';
 el('calibrationHint').textContent=t.calibrated?'Noise floor is active for this input and trim.':t.stale?'Trim changed. Recalibrate with the instrument silent.':'Keep the instrument silent during calibration.';
 const features=state.analysis;
 if(features){
  const meter=features.meter,now=performance.now();
  el('inputLevelFill').style.width=Math.max(0,Math.min(100,(meter.peakDb+60)/60*100))+'%';el('inputRms').textContent='RMS '+meter.rmsDb.toFixed(1)+' dBFS';el('inputPeak').textContent='PEAK '+meter.peakDb.toFixed(1)+' dBFS';
  if(meter.peakDb>=-1)clipHoldUntil=now+1000;el('inputClip').classList.toggle('active',now<clipHoldUntil);
  el('analysisLoadWarning').textContent=features.overloaded?'Analysis CPU above 40% of the audio budget'+(features.mode===2?' · minimum resolution active':' · reducing resolution if sustained'):features.mode?'Analysis running at reduced resolution to protect audio':'';
  if(features.bands){
   const bands=Object.entries(features.bands).map(([name,value])=>{const [low,high]=features.bandRanges[name];return `${name} ${low}–${Math.round(high)} Hz ${value.toFixed(1)}`}).join(' · '),ranges=Object.entries(features.normalization).map(([name,value])=>`${name} ${value.low.toFixed(2)}…${value.high.toFixed(2)}`).join(' · ');
   el('analysisDiagnostics').textContent=`${t.sampleRate} Hz · worklet ${features.processingMs.toFixed(3)} ms/quantum · ${(features.processingMs/(128/t.sampleRate*1000)*100).toFixed(1)}% audio budget (${features.clock} clock) · mode ${['2048 FFT / 512 hop','2048 FFT / 1024 hop','1024 FFT / 1024 hop'][features.mode]} · ${bands} dBFS · onset ${features.onset.toFixed(3)} · BPM ${state.bpm?state.bpm.toFixed(1):'—'} · confidence ${state.bpmConfidence.toFixed(2)} · phase ${features.tempo.phase.toFixed(2)} · kick ${features.events.kick?'HIT':'—'} · snare ${features.events.snare?'HIT':'—'} · gate ${features.gate?'CLOSED':'OPEN'} · norm ${ranges}`;
   el('analysisDiagnostics').title=el('analysisDiagnostics').textContent;
  }
 }
 el('bloomDiagnostics').textContent=state.renderer+' · '+state.fps.toFixed(0)+' FPS';
 for(const [key,value] of Object.entries(state.finalG))el('gf-'+key).textContent=value.toFixed(2);
 for(const [letter,key] of [['E','energy'],['D','density'],['R','drive'],['K','boombap'],['T','tension'],['B','bright'],['O','open']]){el('v'+letter).textContent=state.eff[key].toFixed(2);el('f'+letter).style.width=(state.eff[key]*100)+'%'}
 for(const [label,value] of [['Beat',state.beat],['Kick',state.kick],['Snare',state.snare]]){el('v'+label).textContent=value.toFixed(2);el('f'+label).style.width=Math.min(1,value)*100+'%'}
 el('vBPM').textContent=state.bpm>0?Math.round(state.bpm):'--';el('fBpmConf').style.width=state.bpmConfidence*100+'%';
 el('vZoom').textContent=state.finalG.zoom.toFixed(2);el('fZoom').style.width=Math.max(0,Math.min(1,(state.finalG.zoom-.9)/.28))*100+'%';
 return clipHoldUntil;
}
