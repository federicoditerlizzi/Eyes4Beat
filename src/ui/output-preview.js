export function createOutputPreview({button,video,canvas,onError=()=>{}}){
 let output=null,stream=null,timer=null,enabled=true,generation=0,busy=false;
 function stop(){generation++;clearInterval(timer);timer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;video.hidden=canvas.hidden=true;try{output?.EyesForBeatsPreview?.setRate(0)}catch{}}
 async function start(){
  stop();button.setAttribute('aria-pressed',String(enabled));button.disabled=!output;
  if(!enabled||document.hidden||!output)return;
  const api=output.EyesForBeatsPreview;if(!api)return;const token=generation;
  try{
   api.setRate(30);if(!api.canvas.captureStream)throw new Error('Capture unavailable');
   stream=api.canvas.captureStream(30);video.srcObject=stream;await video.play();
   if(token!==generation)return;video.hidden=false;stream.getVideoTracks()[0].onended=()=>{if(token===generation)fallback(api,token)};
  }catch{if(token===generation)fallback(api,token)}
 }
 function fallback(api,token){
  stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;video.hidden=true;api.setRate(4);canvas.hidden=false;
  timer=setInterval(async()=>{if(busy||token!==generation)return;busy=true;let bitmap;
   try{bitmap=await createImageBitmap(api.canvas);if(token!==generation)return;canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0)}
   catch(error){onError('Preview unavailable: '+error.message);stop()}finally{bitmap?.close();busy=false}
  },250);
 }
 button.onclick=()=>{enabled=!enabled;void start()};document.addEventListener('visibilitychange',()=>void start());
 return {connect(win){output=win;void start()},disconnect(){stop();output=null;button.disabled=true},stop};
}
