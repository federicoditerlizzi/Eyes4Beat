import { COLOR_SAFETY_MAX } from './tone.js';
import { TRANSITION_GLSL_DEFINES } from './transitions.js';

export const vertexShaderSource=`#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;

export const fragmentShaderSource=`#version 300 es
precision highp float;
out vec4 fragColor;
in vec2 vUv;
uniform vec2 uRes;
uniform vec4 uAspect;
uniform vec3 uFrameA,uFrameB;
uniform vec2 uRotationA,uRotationB;
uniform vec4 uPulseA,uPulseB;
uniform vec3 uPulseShapeA,uPulseShapeB;
uniform vec2 uWavesA[4],uWavesB[4];
uniform float uBreathPhase;
uniform float uTime,uMorphA,uMorphB,uArchMix,uMapPulse,uDistAmt,uLumAmt,uSatAmt,uZoomAmt,uSpiralAmt,uTilesAmt;
uniform float uSeedA,uSeedB;
uniform int uTransA,uTransB;
uniform vec4 uParamA,uParamB,uWarpA,uWarpB,uGradeA,uGradeB;
uniform vec2 uWarpDirA,uWarpDirB;
uniform sampler2D tCurrentA,tCurrentB,tTargetA,tTargetB;

${TRANSITION_GLSL_DEFINES}

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
vec2 warpUV(vec2 uv,vec4 warp,vec2 direction){
 float t=uTime;
 float amp=warp.x; float speed=warp.y;
 vec2 dir=warp.z>.5?normalize(uv-.5)*warp.w:direction;
 vec2 p=uv*3.2;
 float n1=noise(p+vec2(t*speed,-t*speed*.6));
 float n2=noise(p*1.7+vec2(-t*speed*.45,t*speed*.7));
 uv += vec2(n1-.5,n2-.5)*amp*uDistAmt;
 uv += dir*(sin(t*.45+uv.y*6.)*.0035*uDistAmt);
 return uv;
}
vec2 parallax(vec2 uv){
 vec2 c=uv-.5;
 vec2 q=c/max(.72,uZoomAmt);
 return q+.5;
}
vec2 imageEffectsUV(vec2 uv,vec2 rotation){
 float aspect=uRes.x/max(1.,uRes.y);
 if(rotation.y>1.||abs(rotation.x)>.000001){
   float c=cos(rotation.x),s=sin(rotation.x);
   vec2 p=(uv-.5)*vec2(aspect,1.);
   uv=vec2(c*p.x-s*p.y,s*p.x+c*p.y)/vec2(aspect,1.)/max(1.,rotation.y)+.5;
 }
 if(uSpiralAmt>.001){
   vec2 p=(uv-.5)*vec2(aspect,1.);
   float angle=uSpiralAmt*2.3*(1.-smoothstep(.05,.65,length(p)));
   float c=cos(angle),s=sin(angle);
   uv=vec2(c*p.x-s*p.y,s*p.x+c*p.y)/vec2(aspect,1.)+.5;
 }
 if(uTilesAmt>.001){
   vec2 grid=vec2(12.,8.),position=clamp(uv,vec2(0.),vec2(.999999))*grid;
   vec2 tile=floor(position);
   float index=tile.y*grid.x+tile.x;
   float shuffled=mod(index*37.+17.,96.);
   vec2 sourceTile=vec2(mod(shuffled,grid.x),floor(shuffled/grid.x));
   vec2 shuffledUv=(sourceTile+fract(position))/grid;
   uv=mix(uv,shuffledUv,step(hash(tile+vec2(13.,71.)),clamp(uTilesAmt/1.5,0.,1.)));
 }
 return uv;
}
// UV scale/offset mirrors frameFit() in frame-fit.js. fit: cover=0, contain=1, stretch=2.
vec4 samplePair(int slot,int image,vec2 uv){
 vec3 frame=slot==0?uFrameA:uFrameB;
 float aspect=slot==0?(image==0?uAspect.x:uAspect.y):(image==0?uAspect.z:uAspect.w);
 float ratio=(uRes.x/max(1.,uRes.y))/max(.000001,aspect);
 vec2 scale=vec2(1.);
 if(frame.x<.5)scale=vec2(min(1.,ratio),min(1.,1./ratio));
 else if(frame.x<1.5)scale=vec2(max(1.,ratio),max(1.,1./ratio));
 uv=(uv-.5)*scale/(1.+frame.z)+.5;
 // Zero coverage keeps the black background free of grading/tint, before edge wrapping.
 if(frame.x>.5&&frame.x<1.5&&(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))))return vec4(0.);
 if(frame.y<.5)uv=1.-abs(mod(uv,2.)-1.);
 else uv=clamp(uv,vec2(0.),vec2(1.));
 if(slot==0){if(image==0)return texture(tCurrentA,uv);return texture(tCurrentB,uv);}
 if(image==0)return texture(tTargetA,uv);return texture(tTargetB,uv);
}
vec4 transitionPair(int slot,vec2 uv,float p,int transitionType,float seed,vec4 param){
 vec4 a=samplePair(slot,0,uv),b=samplePair(slot,1,uv);
 if(p<=0.)return a;if(p>=1.)return b;
 if(transitionType==TRANS_CUT)return b;
 if(transitionType==TRANS_CROSSFADE)return mix(a,b,p);
 if(transitionType==TRANS_DIP_BLACK){if(p<=.5)return a*(1.-p*2.);return b*((p-.5)*2.);}
 if(transitionType==TRANS_DIP_WHITE){if(p<=.5)return mix(a,vec4(1.),p*2.);return mix(vec4(1.),b,(p-.5)*2.);}
 float edge=max(.002,param.y);
 if(transitionType==TRANS_LUMA_DISSOLVE){
   float luma=dot(b.rgb,vec3(.2126,.7152,.0722));
   float mask=smoothstep(1.-p-edge,1.-p+edge,luma);
   return mix(a,b,mask);
 }
 if(transitionType==TRANS_NOISE_DISSOLVE){
   float mask=smoothstep(1.-p-edge,1.-p+edge,hash(floor(uv*320.)+seed));
   return mix(a,b,mask);
 }
 if(transitionType==TRANS_WIPE){
   float axis=uv.x;
   if(param.x<.5)axis=uv.x;else if(param.x<1.5)axis=1.-uv.x;else if(param.x<2.5)axis=uv.y;else axis=1.-uv.y;
   return mix(a,b,1.-smoothstep(p-edge,p+edge,axis));
 }
 if(transitionType==TRANS_IRIS){
   float radius=length(uv-.5)/.70710678;
   return mix(a,b,1.-smoothstep(p-edge,p+edge,radius));
 }
 if(transitionType==TRANS_ZOOM_THROUGH){
   vec2 uvA=(uv-.5)/(1.+p*.85)+.5;
   vec2 uvB=(uv-.5)*(1.+(1.-p)*.55)+.5;
   return mix(samplePair(slot,0,uvA),samplePair(slot,1,uvB),smoothstep(0.,1.,p));
 }
 if(transitionType==TRANS_GLITCH_CUT){
   float envelope=sin(p*3.14159265);
   float block=hash(vec2(floor(uv.y*18.+seed*7.),floor((uTime+seed)*20.)));
   float offset=(block-.5)*max(.025,param.z)*envelope;
   vec2 shifted=uv+vec2(offset,0.);
   int image=p<.5?0:1;
   float split=.014*envelope;
   vec4 center=samplePair(slot,image,shifted);
   return vec4(samplePair(slot,image,shifted+vec2(split,0.)).r,center.g,samplePair(slot,image,shifted-vec2(split,0.)).b,center.a);
 }
 return mix(a,b,p);
}
vec4 getPair(int slot,vec4 warp,vec2 direction,vec2 uv,float progress,int transitionType,float seed,vec4 param){
 vec4 pulse=slot==0?uPulseA:uPulseB;
 vec3 shape=slot==0?uPulseShapeA:uPulseShapeB;
 vec2 metric=uRes/max(1.,min(uRes.x,uRes.y));
 vec2 centered=(uv-pulse.xy)*metric;
 float radius=length(centered),split=0.;
 vec2 radial=centered/max(.00001,radius)/metric;
 if(shape.x<.5){
   float core=exp(-radius*5.)*uMapPulse*pulse.z;
   float wave=(.72+.28*sin(uBreathPhase))*core;
   uv=pulse.xy+(uv-pulse.xy)*(1.-.034*wave)+radial*.0045*core;
 }else{
   float ring=0.;
   for(int i=0;i<4;i++){
     vec2 wave=slot==0?uWavesA[i]:uWavesB[i];
     float age=uTime-wave.x;
     if(age>=0.&&wave.y>0.){
       float front=age*pulse.w;
       float band=exp(-pow((radius-front)/max(.01,shape.y),2.));
       ring+=band*wave.y*pulse.z*exp(-front*1.8)*(1.-smoothstep(2.,3.,front));
     }
   }
   uv+=radial*.065*ring;split=shape.z*.02*ring;
 }
 vec2 rotation=slot==0?uRotationA:uRotationB;
 vec2 q=imageEffectsUV(parallax(warpUV(uv,warp,direction)),rotation);
 vec4 center=transitionPair(slot,q,progress,transitionType,seed,param);
 if(split>.00001){
   center.r=transitionPair(slot,q+radial*split,progress,transitionType,seed,param).r;
   center.b=transitionPair(slot,q-radial*split,progress,transitionType,seed,param).b;
 }
 return center;
}
vec3 grade(vec3 c,vec4 grading,float coverage){
 c=c*grading.x+grading.yzw*coverage;
 float l=dot(c,vec3(.2126,.7152,.0722));
 c = mix(vec3(l), c, uSatAmt);
 c *= uLumAmt;
 // Safety ceiling before the highlight shoulder.
 c = min(c, vec3(${COLOR_SAFETY_MAX.toFixed(1)}));
 return c;
}
void main(){
 vec2 uv=vUv;
 vec4 ca=getPair(0,uWarpA,uWarpDirA,uv,uMorphA,uTransA,uSeedA,uParamA);
 vec4 cb=getPair(1,uWarpB,uWarpDirB,uv,uMorphB,uTransB,uSeedB,uParamB);
 vec3 c=mix(grade(ca.rgb,uGradeA,ca.a),grade(cb.rgb,uGradeB,cb.a),uArchMix);
 fragColor=vec4(c,1.);
}`;
