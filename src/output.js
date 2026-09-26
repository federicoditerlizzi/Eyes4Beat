import './styles.css';
import {createVisualEngine} from './engine/engine.js';
import {hostEnginePort} from './engine/remote-transport.js';
import {PROTOCOL_VERSION} from './engine/protocol.js';
import {icon} from './icons.js';

const session=new URLSearchParams(location.search).get('session');
document.body.className='outputMode';
for(const child of [...document.body.children])if(!['gl','particles','blackoutOverlay'].includes(child.id))child.remove();
const start=document.createElement('button');start.className='outputStart';start.id='outputStart';start.textContent='Click to start';start.title='Enable audio in this output window';start.disabled=true;
const fullscreen=document.createElement('button');fullscreen.className='iconAction headerIcon outputFullscreen';fullscreen.id='outputFullscreen';fullscreen.innerHTML=icon('maximize');fullscreen.setAttribute('aria-label','Full screen');fullscreen.dataset.tooltip='Full screen';
document.body.append(start,fullscreen);
let host=null,started=false,safety={blackout:false,panic:false};
const announce=()=>window.opener?.postMessage({type:'output-hello',protocol:PROTOCOL_VERSION,session},location.origin);
const helloTimer=setInterval(()=>{if(!host)announce()},250);announce();
const discovery=new BroadcastChannel('eyes4beat-output-discovery-v1');
discovery.onmessage=({data})=>{if(data?.type==='control-announce'&&data.session===session)announce()};
// Copy after the draw while the WebGL buffer is valid. Particles and blackout
// belong to the same preview, without forcing preserveDrawingBuffer on WebGL.
const preview=document.createElement('canvas');preview.id='outputCapture';preview.hidden=true;document.body.append(preview);
const previewContext=preview.getContext('2d',{alpha:false});let previewRate=0,lastPreview=0;
window.EyesForBeatsPreview={canvas:preview,setRate(rate){previewRate=[0,4,30].includes(rate)?rate:0}};
function capturePreview(){
 const now=performance.now();if(!previewRate||now-lastPreview<1000/previewRate)return;lastPreview=now;
 try{const source=document.getElementById('gl');if(preview.width!==source.width||preview.height!==source.height){preview.width=source.width;preview.height=source.height}
 previewContext.drawImage(source,0,0,preview.width,preview.height);
 previewContext.drawImage(document.getElementById('particles'),0,0,preview.width,preview.height);
 if(safety.blackout){previewContext.fillStyle='#000';previewContext.fillRect(0,0,preview.width,preview.height)}
 }catch{previewRate=0}
}
window.addEventListener('message',event=>{
 if(event.source!==window.opener||event.origin!==location.origin||event.data?.type!=='output-connect'||event.data.protocol!==PROTOCOL_VERSION||event.data.session!==session||event.ports.length!==1)return;
 if(host){host.attach(event.ports[0]);return}
 host=hostEnginePort(event.ports[0],options=>createVisualEngine({...options,emit:event=>{
  if(event.type==='state')safety={blackout:event.state.blackout,panic:event.state.panic};options.emit(event);
 }}),{canvas:document.getElementById('gl'),particleCanvas:document.getElementById('particles'),blackoutOverlay:document.getElementById('blackoutOverlay'),audioLocked:true,onRendered:capturePreview});
 start.disabled=false;
});
start.onclick=async()=>{
 if(!host||started)return;start.disabled=true;
 try{await host.unlock();started=true;start.remove()}catch(error){start.textContent='Click to retry · '+error.message;start.disabled=false}
};
fullscreen.onclick=()=>{const action=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();action.catch(()=>{})};
document.addEventListener('fullscreenchange',()=>{const label=document.fullscreenElement?'Exit full screen':'Full screen';fullscreen.setAttribute('aria-label',label);fullscreen.dataset.tooltip=label});
document.addEventListener('keydown',event=>{
 if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.target?.matches?.('input,textarea,select,[contenteditable=true]'))return;
 const control=event.key.toLowerCase()==='b'?'blackout':event.key.toLowerCase()==='p'?'panic':null;
 if(control&&host){event.preventDefault();safety[control]=!safety[control];void host.send('setSafety',{control,value:safety[control]})}
});
window.addEventListener('pagehide',()=>{clearInterval(helloTimer);discovery.close();previewRate=0;void host?.dispose()});
