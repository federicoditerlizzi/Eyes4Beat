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
export function blendPost(a,b,mix){
 const blend=(x,y)=>Object.fromEntries(Object.keys(x).map(k=>[k,typeof x[k]==='number'?x[k]+(y[k]-x[k])*mix:(mix<.5?x[k]:y[k])]));
 const kaleido=blend(a.kaleido,b.kaleido);kaleido.segments=(mix<.5?a:b).kaleido.segments;
 return {kaleido,feedback:blend(a.feedback,b.feedback)};
}
