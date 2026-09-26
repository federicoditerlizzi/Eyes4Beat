import {RemoteTransport,isOutputHello} from '../engine/remote-transport.js';
import {PROTOCOL_VERSION} from '../engine/protocol.js';
import {createOutputPreview} from './output-preview.js';

const SESSION_KEY='eyes4beat_output_session';
export function createOutputController(session,{button,readMedia,onAdopt=async()=>{},onStatus=()=>{}}){
 let output=null,remote=null,token=sessionStorage.getItem(SESSION_KEY),connecting=false,handshakeTimer=null,discoverResolve=null,initialDiscovery=false;
 const notice=document.getElementById('outputNotice'),message=document.getElementById('outputMessage'),metrics=document.getElementById('outputDiagnostics');
 const preview=createOutputPreview({button:document.getElementById('previewBtn'),video:document.getElementById('outputPreview'),canvas:document.getElementById('outputPreviewFallback'),onError:text=>status(text)});
 function status(text,connected=false){button.title=text;button.dataset.tooltip=text;button.classList.toggle('connected',connected);document.body.classList.toggle('remoteControl',connected||session.disconnected);onStatus(text)}
 function disconnected(){
  if(session.disconnected)return;session.markDisconnected();preview.disconnect();remote=null;
  notice.hidden=false;message.textContent='Output disconnected';status('Output disconnected');metrics.textContent='Output disconnected';
 }
 window.addEventListener('message',async event=>{
  if(connecting||!token||!isOutputHello(event,output||event.source,location.origin,token))return;
  // Only the stored unguessable nonce allows rediscovery after controller reload.
  if(remote&&!remote.closed&&!initialDiscovery)return;
  output=event.source;connecting=true;clearTimeout(handshakeTimer);
  let next;
  try{
   await session.switchTo(async()=>{
    const channel=new MessageChannel();next=new RemoteTransport(channel.port1,{onMediaRequest:readMedia,onDisconnect:disconnected,onMetrics:data=>{metrics.textContent=`Heartbeat ${Math.round(data.heartbeatAge)} ms · command RTT ${data.rtt==null?'—':data.rtt.toFixed(1)+' ms'}`}});
    output.postMessage({type:'output-connect',protocol:PROTOCOL_VERSION,session:token},location.origin,[channel.port2]);
    await Promise.race([next.ready,new Promise((_,reject)=>{handshakeTimer=setTimeout(()=>reject(new Error('Output did not become ready')),8000)})]);clearTimeout(handshakeTimer);
    return next;
   },{adopt:'available',fallback:false});remote=next;
   const adopt=!!next.recovery;
   if(adopt)await onAdopt(next.recovery);
   notice.hidden=true;status('Output connected',true);preview.connect(output);
   discoverResolve?.(next.recovery);discoverResolve=null;
  }catch(error){next?.detach();session.disconnected=false;disconnected();message.textContent='Output disconnected · '+error.message;discoverResolve?.(null);discoverResolve=null}
  finally{connecting=false;initialDiscovery=false}
 });
 function open(){
  if(connecting)return;
  if(output&&!output.closed&&remote&&!remote.closed){output.focus();return}
  // Reopening explicitly replaces a crashed/unresponsive output, avoiding two engines.
  if(output&&!output.closed)output.close();remote?.detach();remote=null;
  token=crypto.randomUUID();sessionStorage.setItem(SESSION_KEY,token);
  const url=new URL(location.href);url.search='';url.searchParams.set('output','1');url.searchParams.set('session',token);
  output=window.open(url,'eyes4beat-output','popup,width=1280,height=720');
  if(!output){status('Allow pop-ups to open the output');notice.hidden=false;message.textContent='Allow pop-ups to open the output';return}
  status('Connecting output…');handshakeTimer=setTimeout(()=>{if(!remote&&!connecting){disconnected()}},10000);
 }
 button.onclick=open;document.getElementById('reopenOutput').onclick=open;
 document.getElementById('useLocalOutput').onclick=async()=>{
  try{if(output&&!output.closed)output.close();remote?.detach();remote=null;output=null;sessionStorage.removeItem(SESSION_KEY);token=null;preview.disconnect();await session.useLocal();notice.hidden=true;status('Open output window');metrics.textContent='Local engine'}
  catch(error){message.textContent=error.message}
 };
 const monitor=setInterval(()=>{if(output?.closed&&!connecting)disconnected()},250);
 const discovery=new BroadcastChannel('eyes4beat-output-discovery-v1');
 window.addEventListener('pagehide',()=>{clearInterval(monitor);clearTimeout(handshakeTimer);preview.stop();remote?.detach();discovery.close()});
 return {
  discover(){
   if(!token)return Promise.resolve(null);initialDiscovery=true;
   return new Promise(resolve=>{discoverResolve=resolve;discovery.postMessage({type:'control-announce',session:token});
    handshakeTimer=setTimeout(async()=>{if(connecting)return;await session.transport.dispose();disconnected();initialDiscovery=false;discoverResolve?.(null);discoverResolve=null},2000);
   });
  },
  close:()=>output?.close()
 };
}
