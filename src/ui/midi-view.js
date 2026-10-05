function describe(event){
 const channel=event.channel?'CH '+event.channel+' · ':'';
 if(event.type==='note-on'||event.type==='note-off')return channel+(event.type==='note-on'?'NOTE ON ':'NOTE OFF ')+event.note+' · velocity '+event.velocity;
 if(event.type==='cc')return channel+'CC '+event.controller+' · '+event.value;
 if(event.type==='position')return 'SONG POSITION '+event.position+' · '+(event.position*6)+' clocks';
 if(event.type==='program')return channel+'PROGRAM '+event.program;
 return event.type.toUpperCase();
}
export function renderMidiState(midi){
 if(!midi)return;
 const select=document.getElementById('midiDevice'),status=document.getElementById('midiStatus'),clock=document.getElementById('midiClockStatus'),monitor=document.getElementById('midiActivity');
 const signature=JSON.stringify([midi.devices,midi.selected,midi.selectedName,midi.access,midi.supported]);
 if(select.dataset.devices!==signature){
  select.dataset.devices=signature;select.replaceChildren(new Option('OFF',''));
  for(const device of midi.devices)select.add(new Option(device.name+(device.manufacturer?' · '+device.manufacturer:''),device.id));
  if(midi.selected&&!midi.devices.some(device=>device.id===midi.selected))select.add(new Option((midi.selectedName||'Selected device')+' · disconnected',midi.selected));
  if(midi.supported&&!midi.access)select.add(new Option('Choose MIDI input…','__request__'));
 }
 select.value=midi.selected;select.disabled=!midi.supported||midi.busy;
 select.title=!midi.supported?'Web MIDI is unavailable. Use Chrome or Edge.':midi.busy?'Waiting for MIDI permission on the rendering window.':'Select a MIDI input on the rendering device';
 status.textContent=!midi.supported?'Web MIDI is unavailable in this browser. Use Chrome or Edge.':midi.busy?'Allow MIDI access in the rendering window.':midi.error||(!midi.selected?(midi.access&&!midi.devices.length?'MIDI off · no input devices found.':'MIDI off.'):(midi.connected?'Connected · '+(midi.selectedName||'MIDI input'):'Disconnected · waiting for the selected device.'));
 clock.hidden=!midi.selected;clock.textContent=(midi.clock.present&&midi.clock.bpm?'Clock '+midi.clock.bpm.toFixed(1)+' BPM':'No clock · audio tempo fallback')+' · '+(midi.clock.running?(midi.clock.phaseEstimated?'RUNNING, PHASE ESTIMATED':'RUNNING'):'STOPPED · audio tempo fallback');
 monitor.hidden=!midi.selected;
 const activity=JSON.stringify(midi.activity);
 if(monitor.dataset.activity!==activity){monitor.dataset.activity=activity;monitor.replaceChildren();
  if(!midi.activity.length){const empty=document.createElement('span');empty.textContent='Waiting for notes or CC…';monitor.append(empty)}
  for(const event of midi.activity){const row=document.createElement('div');row.textContent=describe(event);row.title='MIDI event timestamp: '+event.timestamp.toFixed(2)+' ms';monitor.append(row)}
 }
}
