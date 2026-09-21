export const vertexShaderSource=`#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;

export const fragmentShaderSource=`#version 300 es
precision highp float;
out vec4 fragColor;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime,uMorphA,uMorphB,uArchMix,uMapPulse,uDistAmt,uGlowAmt,uLumAmt,uSatAmt,uZoomAmt;
uniform int uArchA,uArchB;
uniform sampler2D tCurrentA,tCurrentB,tTargetA,tTargetB;

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
vec4 getPair(int slot, int a, vec2 uv, float m){
 vec2 q=parallax(warpUV(uv,a),a);
 if(slot==0) return mix(texture(tCurrentA,q),texture(tCurrentB,q),m);
 return mix(texture(tTargetA,q),texture(tTargetB,q),m);
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

 vec4 ca=getPair(0,uArchA,uv,uMorphA);
 vec4 cb=getPair(1,uArchB,uv,uMorphB);
 vec3 c=mix(grade(ca.rgb,uArchA),grade(cb.rgb,uArchB),uArchMix);
 float vig=smoothstep(1.0,.25,length(vUv-.5));
 c*=mix(.82,1.,vig);
 c=1.-exp(-c*1.08);
 fragColor=vec4(c,1.);
}`;
