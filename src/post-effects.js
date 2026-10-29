// CPU reference for the polar folding used by the post shader.
export function kaleidoUV([u,v], {segments=0,centerX=.5,centerY=.5,mirror=true}, angle=0, aspect=1) {
 if(!segments)return [u,v];
 const x=(u-centerX)*aspect,y=v-centerY,r=Math.hypot(x,y),width=2*Math.PI/segments;
 let a=((Math.atan2(y,x)-angle)%width+width)%width;
 if(mirror)a=Math.min(a,width-a);
 a+=angle;
 return [centerX+r*Math.cos(a)/aspect,centerY+r*Math.sin(a)];
}
export function feedbackDecay(amount,dt){return Math.pow(Math.max(0,Math.min(.98,amount)),Math.max(0,dt)*60)}
// Mirrored repeat, including negative coordinates and multiple boundary crossings.
export function mirrorFeedbackUV(uv){return uv.map(v=>1-Math.abs(((v%2)+2)%2-1))}
const clamp=(v,max)=>Math.max(0,Math.min(max,v));
export function effectivePost(post,targets={},enabled=true){
 if(!enabled)return {kaleido:0,feedback:0};
 return {
  kaleido:post.kaleido.segments>0?clamp(post.kaleido.mix+(targets.kaleido||0),1)*(post.kaleidoFade??1):0,
  feedback:clamp(post.feedback.amount+(targets.trails||0)*(.98-post.feedback.amount),.98),
 };
}
export function blendPost(a,b,mix){
 const blend=(x,y)=>Object.fromEntries(Object.keys(x).map(k=>[k,typeof x[k]==='number'?x[k]+(y[k]-x[k])*mix:x[k]&&typeof x[k]==='object'?blend(x[k],y[k]):(mix<.5?x[k]:y[k])]));
 // Swap discrete shape settings only at zero wet mix, including routed modulation.
 const kaleido=(mix<.5?a:b).kaleido;
 const feedback=blend(a.feedback,b.feedback);
 feedback.flow.octaves=(mix<.5?a:b).feedback.flow.octaves;
 return {kaleido,kaleidoFade:Math.abs(2*mix-1)*(kaleido.structuralDip??1),feedback};
}
