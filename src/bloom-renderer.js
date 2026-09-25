import { bloomMipSizes, normalizeBloomQuality } from './bloom.js';
import { TONE_KNEE, COLOR_SAFETY_MAX } from './tone.js';

const vertex = `#version 300 es
out vec2 vUv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const header = `#version 300 es
precision highp float;
in vec2 vUv;out vec4 fragColor;
uniform sampler2D uInput,uDetail;
uniform vec2 uStep;
`;
const down = header + `
uniform bool uBright;uniform float uThreshold,uKnee;
vec3 fetchBright(vec2 uv){
 vec3 c=texture(uInput,uv).rgb;
 if(!uBright)return c;
 float peak=max(c.r,max(c.g,c.b));
 if(peak<=uThreshold-uKnee)return vec3(0.);
 float soft=clamp(peak-uThreshold+uKnee,0.,2.*uKnee);
 float energy=max(peak-uThreshold,uKnee>0.?soft*soft/(4.*uKnee):0.);
 return c*(clamp(energy,0.,max(0.,peak))/max(peak,.00001));
}
void main(){
 vec3 c=fetchBright(vUv+uStep*vec2(-1.,-1.))+fetchBright(vUv+uStep*vec2(1.,-1.));
 c+=fetchBright(vUv+uStep*vec2(-1.,1.))+fetchBright(vUv+uStep*vec2(1.,1.));
 fragColor=vec4(c*.25,1.);
}`;
const up = header + `
uniform float uRadius;
void main(){
 vec3 c=texture(uInput,vUv).rgb*4.;
 c+=(texture(uInput,vUv+vec2(uStep.x,0.)).rgb+texture(uInput,vUv-vec2(uStep.x,0.)).rgb)*2.;
 c+=(texture(uInput,vUv+vec2(0.,uStep.y)).rgb+texture(uInput,vUv-vec2(0.,uStep.y)).rgb)*2.;
 c+=texture(uInput,vUv+uStep).rgb+texture(uInput,vUv-uStep).rgb;
 c+=texture(uInput,vUv+uStep*vec2(-1.,1.)).rgb+texture(uInput,vUv+uStep*vec2(1.,-1.)).rgb;
 // Normalized accumulation keeps energy stable as the spread/quality changes.
 fragColor=vec4(mix(texture(uDetail,vUv).rgb,c/16.,uRadius),1.);
}`;
const composite = header + `
uniform float uIntensity,uMix;uniform vec3 uTint;
uniform vec2 uRes,uVignetteA,uVignetteB;
float vignette(vec2 settings){
 vec2 p=(vUv-.5)*uRes/max(1.,min(uRes.x,uRes.y));
 return 1.-settings.x*smoothstep(1.-settings.y,1.,length(p));
}
void main(){
 vec3 c=texture(uInput,vUv).rgb;
 if(uIntensity>0.)c+=texture(uDetail,vUv).rgb*uIntensity*uTint;
 c=min(c,vec3(${COLOR_SAFETY_MAX.toFixed(1)}));
 c*=mix(vignette(uVignetteA),vignette(uVignetteB),uMix);
 const float knee=${TONE_KNEE.toFixed(1)};
 float peak=max(c.r,max(c.g,c.b));
 if(peak>knee)c*=(knee+(1.-knee)*(1.-exp(-(peak-knee)/(1.-knee))))/peak;
 fragColor=vec4(c,1.);
}`;

/** Owns only post-processing GL resources; the scene renderer owns its media slots. */
export class BloomRenderer {
  constructor(gl) {
    this.gl = gl; this.quality = 'high'; this.width = 0; this.height = 0;
    this.targets = []; this.down = []; this.up = []; this.gpuMs = null; this.query = null;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.vao = gl.createVertexArray();
    this.programs = [down, up, composite].map(source => this.program(source));
  }
  program(source) {
    const gl = this.gl, program = gl.createProgram();
    for (const [type, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, source]]) {
      const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const uniforms = {};
    for (const name of ['uInput','uDetail','uStep','uBright','uThreshold','uKnee','uRadius','uIntensity','uTint','uRes','uVignetteA','uVignetteB','uMix']) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }
  target(width, height) {
    const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.hdr ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); throw new Error('Bloom framebuffer incomplete');
    }
    const result = { texture, framebuffer, width, height }; this.targets.push(result); return result;
  }
  releaseTargets() {
    for (const t of this.targets) { this.gl.deleteFramebuffer(t.framebuffer); this.gl.deleteTexture(t.texture); }
    this.targets = []; this.down = []; this.up = [];
  }
  resize(width, height, quality) {
    quality = normalizeBloomQuality(quality);
    if (width === this.width && height === this.height && quality === this.quality) return;
    this.releaseTargets(); this.width = width; this.height = height; this.quality = quality;
    try { this.scene = this.target(width, height); }
    catch (error) {
      if (!this.hdr) throw error;
      this.hdr = false; this.scene = this.target(width, height);
    }
  }
  beginScene(width, height, quality) {
    this.resize(width, height, quality);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.scene.framebuffer);
    this.gl.viewport(0, 0, width, height);
  }
  use(index, output, input, detail = input) {
    const gl = this.gl, { program, uniforms: u } = this.programs[index];
    gl.bindVertexArray(this.vao); gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output?.framebuffer || null);
    gl.viewport(0, 0, output?.width || this.width, output?.height || this.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, detail.texture);
    gl.uniform1i(u.uInput, 0); gl.uniform1i(u.uDetail, 1); return u;
  }
  render(settings, vignetteA, vignetteB, mix) {
    const gl = this.gl, intensity = this.quality === 'off' ? 0 : settings.intensity;
    if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) this.gpuMs = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(this.query); this.query = null;
    }
    let result = this.scene, measuring = false;
    if (intensity > 0) {
      if (!this.down.length) {
        const sizes = bloomMipSizes(this.width, this.height, this.quality);
        this.down = sizes.map(([w,h]) => this.target(w,h));
        this.up = sizes.slice(0,-1).map(([w,h]) => this.target(w,h));
      }
      if (this.timer && !this.query) { this.query = gl.createQuery(); gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query); measuring = true; }
      for (let i = 0; i < this.down.length; i++) {
        const u = this.use(0, this.down[i], result);
        gl.uniform2f(u.uStep, (1 + settings.stretch * 7) / result.width, 1 / result.height);
        gl.uniform1i(u.uBright, i === 0); gl.uniform1f(u.uThreshold, settings.threshold); gl.uniform1f(u.uKnee, settings.knee);
        gl.drawArrays(gl.TRIANGLES, 0, 3); result = this.down[i];
      }
      for (let i = this.up.length - 1; i >= 0; i--) {
        const u = this.use(1, this.up[i], result, this.down[i]);
        gl.uniform2f(u.uStep, (1 + settings.stretch * 7) / result.width, 1 / result.height);
        gl.uniform1f(u.uRadius, settings.radius * .95);
        gl.drawArrays(gl.TRIANGLES, 0, 3); result = this.up[i];
      }
      if (measuring) gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    }
    const u = this.use(2, null, this.scene, result);
    gl.uniform1f(u.uIntensity, intensity); gl.uniform3fv(u.uTint, settings.tint);
    gl.uniform2f(u.uRes, this.width, this.height); gl.uniform2fv(u.uVignetteA, vignetteA); gl.uniform2fv(u.uVignetteB, vignetteB); gl.uniform1f(u.uMix, mix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.active = intensity > 0;
  }
  get diagnostics() {
    return `${this.quality} · ${this.hdr ? 'RGBA16F' : 'RGBA8 fallback'} · ${this.active ? `${this.down.length} levels` : 'bloom bypassed'} · bloom GPU ${this.active && this.gpuMs != null ? this.gpuMs.toFixed(2) + ' ms' : '—'}`;
  }
  dispose() {
    this.releaseTargets();
    for (const p of this.programs) this.gl.deleteProgram(p.program);
    this.gl.deleteVertexArray(this.vao); if (this.query) this.gl.deleteQuery(this.query);
  }
}
