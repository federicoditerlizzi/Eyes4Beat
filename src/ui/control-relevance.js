// Dimming explains an inactive setting without preventing edits or changing its value.
const titles=new WeakMap();
export function dimSetting(root,reason=''){
 if(!root)return;
 root.classList.toggle('isDimmed',!!reason);
 for(const node of [root,...root.querySelectorAll('input,select,button')]){
  if(reason){if(!titles.has(node))titles.set(node,{title:node.getAttribute('title'),tooltip:node.getAttribute('data-tooltip')});node.title=reason;if(node.hasAttribute('data-tooltip'))node.dataset.tooltip=reason}
  else if(titles.has(node)){const old=titles.get(node);for(const [key,value] of [['title',old.title],['data-tooltip',old.tooltip]]){if(value===null)node.removeAttribute(key);else node.setAttribute(key,value)}titles.delete(node)}
 }
}
export function lookFieldRelevant(look,path){
 if(path==='rotation.maxAngle')return look.rotation.mode==='angle';
 if(['rotation.maxSpeed','rotation.direction','rotation.returnToRest'].includes(path))return look.rotation.mode==='spin';
 if(['pulse.speed','pulse.width','pulse.chromatic'].includes(path))return look.pulse.mode==='shockwave';
 if(path==='particles.color')return look.particles.colorMode==='fixed';
 if(path==='particles.waveAmount')return ['wave-flow','depth-flow'].includes(look.particles.motion);
 if(path==='particles.jitterAmount')return look.particles.motion==='jitter-flow';
 if(path==='particles.depthOffset')return look.particles.motion==='depth-flow';
 if(path==='particles.streakSlant')return look.particles.style==='streaks';
 if(path.startsWith('particles.burst.')&&path!=='particles.burst.trigger')return look.particles.burst.trigger!=='none';
 if(['frame.edge','frame.overscan'].includes(path))return look.frame.fit!=='contain';
 if(path==='distortion.angle')return look.distortion.mode==='directional';
 return true;
}
export function updateLookRelevance(root,look){
 for(const row of root.querySelectorAll('[data-path]'))row.hidden=!lookFieldRelevant(look,row.dataset.path);
 updateBloomRelevance(root,root.dataset.bloomQuality||'high');
}
export function updateBloomRelevance(root,quality){
 root.dataset.bloomQuality=quality;
 dimSetting(root.querySelector('[data-look-group="bloom"]'),quality==='off'?'Bloom quality is Off on the rendering device. Enable it in Output settings to see these settings.':'');
}
