export const FLOW_DEFAULTS=Object.freeze({strength:0,scale:2,speed:.3,octaves:3,source:'noise'});
export function effectiveFlowStrength(flow,share=0,enabled=true){
 const base=flow?.strength??0;return enabled?Math.max(0,Math.min(.01,base+share*(.01-base))):0;
}
const fract=x=>x-Math.floor(x);
const hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453);
const fade=x=>x*x*x*(x*(x*6-15)+10);
const derivative=x=>30*x*x*(x-1)*(x-1);
// Analytic gradient of quintic value noise: continuous derivatives at grid seams.
export function noiseGradient(x,y){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1),cross=a-b-c+d;
 return [(b-a+cross*fade(fy))*derivative(fx),(c-a+cross*fade(fx))*derivative(fy)];
}
const mirror=v=>1-Math.abs(((v%2)+2)%2-1);
export function flowVector(uv,time,settings=FLOW_DEFAULTS,aspect=1,luminance){
 const {scale,speed,octaves,source}={...FLOW_DEFAULTS,...settings};let gx=0,gy=0;
 if(source==='image'){
  if(!luminance)return [0,0];
  const h=.01/scale,sample=(u,v)=>luminance([mirror(u),mirror(v)]);
  gx=(sample(uv[0]+h/aspect,uv[1])-sample(uv[0]-h/aspect,uv[1]))*.5;
  gy=(sample(uv[0],uv[1]+h)-sample(uv[0],uv[1]-h))*.5;
 }else{
  let amplitude=.5,frequency=1,total=0;
  for(let i=0;i<octaves;i++){
   const g=noiseGradient((uv[0]-.5)*aspect*scale*frequency+time*speed*.17+19*i,(uv[1]-.5)*scale*frequency+time*speed*.11+7*i);
   const weight=amplitude*frequency;gx+=g[0]*weight;gy+=g[1]*weight;total+=weight;frequency*=2;amplitude*=.5;
  }
  gx/=total;gy/=total;
 }
 // Curl in physical, aspect-correct coordinates, converted back to UV velocity.
 return [gy/aspect,-gx];
}
export function flowDisplacement(vector,strength,dt){return vector.map(v=>-v*strength*Math.max(0,dt)*60)}
export function advectFeedbackUV(uv,time,settings,dt,aspect=1,luminance){
 const delta=flowDisplacement(flowVector(uv,time,settings,aspect,luminance),settings.strength,dt);return uv.map((v,i)=>v+delta[i]);
}
// Same analytic field as the CPU reference; no finite-difference noise texture reads.
export const FLOW_GLSL=`
uniform vec4 uFlow; // strength, scale, frames, octaves
uniform float uFlowTime;uniform int uFlowSource;
float flowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 flowGradient(vec2 p){
 vec2 i=floor(p),f=fract(p),q=f*f*f*(f*(f*6.-15.)+10.),dq=30.*f*f*(f-1.)*(f-1.);
 float a=flowHash(i),b=flowHash(i+vec2(1.,0.)),c=flowHash(i+vec2(0.,1.)),d=flowHash(i+1.);
 float crossTerm=a-b-c+d;
 return vec2((b-a+crossTerm*q.y)*dq.x,(c-a+crossTerm*q.x)*dq.y);
}
float flowLuminance(vec2 uv){return dot(texture(uInput,1.-abs(mod(uv,2.)-1.)).rgb,vec3(.2126,.7152,.0722));}
vec2 feedbackFlow(vec2 uv,float aspect){
 vec2 gradient=vec2(0.);
 if(uFlowSource==1){
  float h=.01/uFlow.y;
  gradient=vec2(flowLuminance(uv+vec2(h/aspect,0.))-flowLuminance(uv-vec2(h/aspect,0.)),flowLuminance(uv+vec2(0.,h))-flowLuminance(uv-vec2(0.,h)))*.5;
 }else{
  float amplitude=.5,frequency=1.,total=0.;
  for(int i=0;i<4;i++){
   if(i>=int(uFlow.w))break;
   vec2 p=(uv-.5)*vec2(aspect,1.)*uFlow.y*frequency+uFlowTime*vec2(.17,.11)+float(i)*vec2(19.,7.);
   float weight=amplitude*frequency;gradient+=flowGradient(p)*weight;total+=weight;frequency*=2.;amplitude*=.5;
  }
  gradient/=total;
 }
 return vec2(gradient.y/aspect,-gradient.x);
}
`;
