import {MidiClock,parseMidiMessage} from './clock.js';
export const MIDI_DEVICE_KEY='eyes4beat_midi_input';
// Only the active visual engine constructs this owner of MIDIAccess and ports.
export class MidiInput {
  constructor({navigator=globalThis.navigator,storage=globalThis.localStorage,onEvent=()=>{}}={}){
    this.navigator=navigator;this.storage=storage;this.clock=new MidiClock();this.access=null;this.request=null;this.port=null;this.opening=null;this.disposed=false;this.generation=0;this.activity=[];this.serial=0;this.error='';this.busy=false;
    this.supported=typeof navigator?.requestMIDIAccess==='function';this.selection=null;
    try{const saved=JSON.parse(storage.getItem(MIDI_DEVICE_KEY)||'null');if(saved&&typeof saved.id==='string')this.selection=saved}catch{}
    this.onStateChange=()=>{void this.reconcile().catch(error=>{this.error=error.message})};
    this.onMessage=event=>{const message=parseMidiMessage(event.data,event.timeStamp);if(!message)return;this.clock.receive(message);onEvent(message);
      if(message.type!=='clock'){this.activity.unshift({...message,id:++this.serial});if(this.activity.length>12)this.activity.pop()}
    };
  }
  save(){try{this.storage.setItem(MIDI_DEVICE_KEY,JSON.stringify(this.selection))}catch{}}
  async enumerate(){
    if(!this.supported||this.disposed)return;
    if(!this.access){
      this.busy=true;this.error='';
      try{
        this.request??=this.navigator.requestMIDIAccess({sysex:false});const access=await this.request;
        if(this.disposed)return;
        this.access=access;access.onstatechange=this.onStateChange;
      }catch(error){this.request=null;this.error=error.name==='NotAllowedError'?'MIDI permission denied. Allow MIDI access in the browser and retry.':error.message;return}
      finally{this.busy=false}
    }
    await this.reconcile();
  }
  async select(id){
    const generation=++this.generation,device=this.access?.inputs.get(id);
    this.selection=id?{id,name:device?.name||'',manufacturer:device?.manufacturer||''}:null;this.save();
    this.clock.reset();this.activity=[];this.error='';await this.detach();
    if(id&&!this.disposed&&generation===this.generation)await this.enumerate();
  }
  async detach(){const port=this.port;this.port=null;if(port){port.onmidimessage=null;await port.close().catch(()=>{})}}
  async reconcile(){
    if(this.disposed||!this.access)return;
    const ports=[...this.access.inputs.values()].filter(port=>port.state==='connected');
    let match=this.selection&&ports.find(port=>port.id===this.selection.id);
    if(!match&&this.selection?.name){const same=ports.filter(port=>port.name===this.selection.name&&(port.manufacturer||'')===this.selection.manufacturer);if(same.length===1)match=same[0]}
    match??=null;
    if(match===this.port||(match&&match===this.opening))return;
    const generation=++this.generation;await this.detach();this.clock.reset();
    if(!match||this.disposed||generation!==this.generation)return;
    this.opening=match;
    try{
      await match.open();
      if(this.disposed||generation!==this.generation){await match.close();return}
      this.port=match;this.selection={id:match.id,name:match.name||'',manufacturer:match.manufacturer||''};this.save();
      match.onmidimessage=this.onMessage;this.error='';
    }catch(error){this.error='MIDI input unavailable: '+error.message}
    finally{if(this.opening===match)this.opening=null;if(!this.disposed&&generation!==this.generation)void this.reconcile()}
  }
  async initialize(){if(this.selection)await this.enumerate()}
  snapshot(now){return {supported:this.supported,access:!!this.access,busy:this.busy,selected:this.selection?.id||'',selectedName:this.selection?.name||'',connected:!!this.port&&this.port.state==='connected',error:this.error,
    devices:this.access?[...this.access.inputs.values()].filter(port=>port.state==='connected').map(port=>({id:port.id,name:port.name||'MIDI input',manufacturer:port.manufacturer||''})):[],clock:this.clock.snapshot(now),activity:this.activity};}
  async dispose(){this.disposed=true;this.generation++;if(this.access)this.access.onstatechange=null;await this.detach();this.clock.reset()}
}
