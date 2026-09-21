import { TRANSITION_GLSL_DEFINES } from './transitions.js';

export const vertexShaderSource=`#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;

export const fragmentShaderSource=`#version 300 es
precision highp float;
out vec4 fragColor;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime,uMorphA,uMorphB,uArchMix,uMapPulse,uDistAmt,uGlowAmt,uLumAmt,uSatAmt,uZoomAmt;
uniform float uSeedA,uSeedB;
uniform int uArchA,uArchB,uTransA,uTransB;
uniform vec4 uParamA,uParamB;
uniform sampler2D tCurrentA,tCurrentB,tTargetA,tTargetB;

${TRANSITION_GLSL_DEFINES}

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
vec2 warpUV(vec2 uv,int a){
 float t=uTime;
 float amp=0.0; float speed=0.0; vec2 dir=vec2(0.);
 if(a==0){amp=.018; speed=.12; dir=vec2(.35,.12);}
 if(a==1){amp=.035; speed=.28; dir=vec2(.85,.15);}
 if(a==2){amp=.028; speed=.16; dir=normalize(uv-.5);}
 if(a==3){amp=.045; speed=.34; dir=vec2(.72,-.2);}
 if(a==4){amp=.036; speed=.22; dir=normalize(uv-.5);}
 if(a==5){amp=.034; speed=.27; dir=normalize(uv-.5);}
 vec2 p=uv*3.2;
 float n1=noise(p+vec2(t*speed,-t*speed*.6));
 float n2=noise(p*1.7+vec2(-t*speed*.45,t*speed*.7));
 uv += vec2(n1-.5,n2-.5)*amp*uDistAmt;
 uv += dir*(sin(t*.45+uv.y*6.)*.0035*uDistAmt);
 return uv;
}
vec2 parallax(vec2 uv,int a){
 vec2 c=uv-.5;
 vec2 q=c/max(.72,uZoomAmt);
 return q+.5;
}
vec4 samplePair(int slot,int image,vec2 uv){
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
vec4 getPair(int slot,int a,vec2 uv,float progress,int transitionType,float seed,vec4 param){
 vec2 q=parallax(warpUV(uv,a),a);
 return transitionPair(slot,q,progress,transitionType,seed,param);
}
vec3 grade(vec3 c,int a){
 float lum=dot(c,vec3(.2126,.7152,.0722));
 float glow=smoothstep(.55,.95,lum)*.62;
 c += c*glow*uGlowAmt;
 if(a==0){ c*=.96; c.b+=.025; }
 if(a==1){ c.g+=.020; c*=1.02; }
 if(a==2){ c*=1.04; c+=vec3(.012,.008,.020); }
 if(a==3){ c*=1.02; c.r+=.020; }
 if(a==4){ c*=1.01; c.r+=.040; c.b+=.012; }
 if(a==5){ c*=1.02; c.r+=.030; c.b+=.035; }
 float l=dot(c,vec3(.2126,.7152,.0722));
 c = mix(vec3(l), c, uSatAmt);
 c *= uLumAmt;
 // Slightly friendlier highlight response when brightness/saturation are driven up.
 c = min(c, vec3(4.0));
 return c;
}
void main(){
 vec2 uv=vUv;
 vec2 cUv = uv - .5;
 float r = length(cUv);
 float pulseCore = exp(-r*5.0) * uMapPulse;
 float pulseWave = (0.72 + 0.28*sin(uTime*6.0)) * pulseCore;
 uv = cUv * (1.0 - 0.034*pulseWave) + .5;
 uv += normalize(cUv + vec2(.0001)) * 0.0045 * pulseCore;

 vec4 ca=getPair(0,uArchA,uv,uMorphA,uTransA,uSeedA,uParamA);
 vec4 cb=getPair(1,uArchB,uv,uMorphB,uTransB,uSeedB,uParamB);
 vec3 c=mix(grade(ca.rgb,uArchA),grade(cb.rgb,uArchB),uArchMix);
 float vig=smoothstep(1.0,.25,length(vUv-.5));
 c*=mix(.82,1.,vig);
 c=1.-exp(-c*1.08);
 fragColor=vec4(c,1.);
}`;
