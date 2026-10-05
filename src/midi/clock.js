import {BEAT_RELEASE_MS} from '../event-envelope.js';
// Pure MIDI messages use the event's DOMHighResTimeStamp (milliseconds), never
// callback arrival time. Channels are 1–16; raw 7-bit values are kept for the UI.
export function parseMidiMessage(data, timestamp) {
  if (!data?.length || !Number.isFinite(timestamp)) return null;
  const status=data[0], realtime={248:'clock',250:'start',251:'continue',252:'stop'}[status];
  if(realtime)return {type:realtime,timestamp};
  if(status===0xf2){const lo=data[1],hi=data[2];return Number.isInteger(lo)&&lo>=0&&lo<128&&Number.isInteger(hi)&&hi>=0&&hi<128?{type:'position',position:lo+(hi<<7),timestamp}:null}
  const kind=status>>4,channel=(status&15)+1,a=data[1],b=data[2];
  if(![8,9,11,12].includes(kind)||!Number.isInteger(a)||a<0||a>127)return null;
  if(kind===12)return {type:'program',channel,program:a,timestamp};
  if(!Number.isInteger(b)||b<0||b>127)return null;
  if(kind===11)return {type:'cc',channel,controller:a,value:b,intensity:b/127,timestamp};
  return {type:kind===8||b===0?'note-off':'note-on',channel,note:a,velocity:b,intensity:b/127,timestamp};
}

const phaseAt=(audio,now)=>(((audio?.phase||0)+(now-(audio?.receivedAt??now))*(audio?.bpm||0)/60000)%1+1)%1;
export class MidiClock {
  constructor(){this.reset()}
  reset(){this.lastClock=null;this.times=[];this.bpm=0;this.running=false;this.tick=-1;this.phase=0;this.awaitFirst=true;this.lastTransport=null;this.positionKnown=false;this.transportSeen=false;this.phaseEstimated=false;this.audioAligned=false;this.lastBeat=null;this.serial??=0}
  receive(event,audio=null){
    const {type,timestamp}=event;
    if(type==='position'||type==='start'||type==='continue'||type==='stop'){
      if(this.lastTransport!==null&&timestamp<this.lastTransport)return null;
      this.lastTransport=timestamp;this.transportSeen=true;
      if(type==='start'||type==='position'){
        this.tick=type==='position'?event.position*6:0;this.phase=(this.tick%24)/24;this.awaitFirst=true;this.positionKnown=true;this.phaseEstimated=false;this.lastBeat=null;
      }
      if(type!=='position')this.running=type!=='stop';
      if(type==='continue'&&!this.positionKnown)this.phaseEstimated=true;
      return null;
    }
    if(type!=='clock'||(this.lastClock!==null&&timestamp<=this.lastClock))return null;
    if(this.lastClock!==null&&timestamp-this.lastClock>=1000){this.times=[];this.bpm=0;if(!this.transportSeen){this.running=false;this.tick=-1;this.awaitFirst=true;this.audioAligned=false}}
    this.lastClock=timestamp;this.times.push(timestamp);if(this.times.length>49)this.times.shift();
    let steady=false;
    if(this.times.length>=7){
      const period=(timestamp-this.times[0])/(this.times.length-1),estimate=60000/(24*period);
      if(period>0&&estimate>=10&&estimate<=400){
        steady=this.times.slice(1).every((time,i)=>Math.abs(time-this.times[i]-period)<period*.35);
        this.bpm=this.bpm?this.bpm+(estimate-this.bpm)*.2:estimate;
      }
    }
    if(!this.running&&!this.transportSeen&&steady){this.running=true;this.phaseEstimated=true}
    // Count candidate ticks even before an inferred running clock has locked.
    if(this.running||!this.transportSeen){
      if(this.awaitFirst){if(this.tick<0)this.tick=0;this.awaitFirst=false}else this.tick++;
      if(this.phaseEstimated&&!this.audioAligned&&audio?.bpm>0){this.tick=Math.round(phaseAt(audio,timestamp)*24);this.audioAligned=true}
      this.phase=((this.tick%24)+24)%24/24;
      if(this.running&&this.tick%24===0){this.lastBeat={type:'beat',origin:'midi',intensity:1,timestamp:timestamp/1000,serial:++this.serial};return this.lastBeat}
    }
    return null;
  }
  snapshot(now){
    const present=this.lastClock!==null&&now-this.lastClock<1000&&now>=this.lastClock;
    const elapsed=present&&this.running&&this.bpm&&!this.awaitFirst?Math.min(1,Math.max(0,now-this.lastClock)*this.bpm*24/60000)/24:0;
    const beat=present&&this.running&&this.lastBeat?Math.exp(-Math.max(0,now-this.lastBeat.timestamp*1000)/BEAT_RELEASE_MS):0;
    return {present,bpm:this.bpm,phase:(this.phase+elapsed)%1,running:this.running,phaseEstimated:this.phaseEstimated,lastClock:this.lastClock,beat,lastBeat:this.lastBeat};
  }
}

export function resolveInputTempo(audio, midi, now) {
  if(midi.present&&midi.running)return {source:'midi',bpm:midi.bpm,confidence:1,phase:midi.phase,running:true,phaseEstimated:!!midi.phaseEstimated,anchorSec:midi.bpm?now/1000-midi.phase*60/midi.bpm:null};
  const bpm=audio?.bpm||0,elapsed=bpm?Math.max(0,now-(audio?.receivedAt??now))*bpm/60000:0;
  const phase=((audio?.phase||0)+elapsed)%1;
  return {source:bpm?'audio':'none',bpm,confidence:audio?.confidence||0,phase,running:bpm>0,anchorSec:bpm?now/1000-phase*60/bpm:null};
}
