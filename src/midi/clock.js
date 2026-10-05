// Pure MIDI messages use the event's DOMHighResTimeStamp (milliseconds), never
// callback arrival time. Channels are 1–16; raw 7-bit values are kept for the UI.
export function parseMidiMessage(data, timestamp) {
  if (!data?.length || !Number.isFinite(timestamp)) return null;
  const status=data[0], realtime={248:'clock',250:'start',251:'continue',252:'stop'}[status];
  if(realtime)return {type:realtime,timestamp};
  const kind=status>>4,channel=(status&15)+1,a=data[1],b=data[2];
  if(![8,9,11,12].includes(kind)||!Number.isInteger(a)||a<0||a>127)return null;
  if(kind===12)return {type:'program',channel,program:a,timestamp};
  if(!Number.isInteger(b)||b<0||b>127)return null;
  if(kind===11)return {type:'cc',channel,controller:a,value:b,intensity:b/127,timestamp};
  return {type:kind===8||b===0?'note-off':'note-on',channel,note:a,velocity:b,intensity:b/127,timestamp};
}

export class MidiClock {
  constructor(){this.reset()}
  reset(){this.lastClock=null;this.times=[];this.bpm=0;this.running=false;this.tick=-1;this.phase=0;this.awaitFirst=true;this.lastTransport=null}
  receive(event){
    const {type,timestamp}=event;
    if(type==='start'||type==='continue'||type==='stop'){
      if(this.lastTransport!==null&&timestamp<this.lastTransport)return;
      this.lastTransport=timestamp;
      if(type==='start'){this.tick=-1;this.phase=0;this.awaitFirst=true}
      this.running=type!=='stop';return;
    }
    if(type!=='clock'||(this.lastClock!==null&&timestamp<this.lastClock))return;
    if(this.lastClock!==null&&timestamp-this.lastClock>=1000){this.times=[];this.bpm=0}
    this.lastClock=timestamp;this.times.push(timestamp);if(this.times.length>49)this.times.shift();
    if(this.times.length>=7){
      const intervals=this.times.length-1,period=(timestamp-this.times[0])/intervals;
      if(period>0){const estimate=60000/(24*period);if(estimate>=10&&estimate<=400)this.bpm=this.bpm?this.bpm+(estimate-this.bpm)*.2:estimate}
    }
    if(this.running){
      if(this.awaitFirst){if(this.tick<0)this.tick=0;this.awaitFirst=false}else this.tick++;
      this.phase=((this.tick%24)+24)%24/24;
    }
  }
  snapshot(now){
    const present=this.lastClock!==null&&now-this.lastClock<1000&&now>=this.lastClock;
    const elapsed=present&&this.running&&this.bpm&&!this.awaitFirst?Math.min(1,Math.max(0,now-this.lastClock)*this.bpm*24/60000)/24:0;
    return {present,bpm:this.bpm,phase:(this.phase+elapsed)%1,running:this.running,lastClock:this.lastClock};
  }
}

export function resolveInputTempo(audio, midi, now) {
  if(midi.present&&midi.bpm>0)return {source:'midi',bpm:midi.bpm,confidence:1,phase:midi.phase,running:midi.running,anchorSec:now/1000-midi.phase*60/midi.bpm};
  const bpm=audio?.bpm||0,elapsed=bpm?Math.max(0,now-(audio?.receivedAt??now))*bpm/60000:0;
  const phase=((audio?.phase||0)+elapsed)%1;
  return {source:bpm?'audio':'none',bpm,confidence:audio?.confidence||0,phase,running:bpm>0,anchorSec:bpm?now/1000-phase*60/bpm:null};
}
