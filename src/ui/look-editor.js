import { LOOK_FIELDS, FACTORY_LOOKS, NEUTRAL_LOOK, normalizeLook } from '../looks.js';
import { eventSourceIds, sourceLabels } from '../config.js';
import { assignedSource } from '../routing.js';

export const LOOK_GROUPS=[
 ['color','COLOR',null,['gain','tint','tintAmount'],[['gain','Gain'],['tint','Tint'],['tintAmount','Tint amount'],['amount','Vignette amount','vignette'],['softness','Vignette softness','vignette']]],
 ['distortion','DISTORTION','dist',['amplitude','speed','mode'],[['amplitude','Amplitude'],['speed','Speed'],['mode','Mode'],['angle','Angle (degrees)'],['directionStrength','Direction strength']]],
 ['particles','PARTICLES','parts',['density','speed','style'],[['density','Density'],['speed','Speed'],['style','Style'],['motion','Motion'],['color','Color'],['colorMode','Color mode'],['motionFactor','Motion factor'],['waveAmount','Wave amount'],['jitterAmount','Jitter amount'],['depthOffset','Depth offset'],['streakSlant','Streak slant'],['trigger','Burst trigger','particles.burst'],['amount','Burst amount','particles.burst'],['speed','Burst speed','particles.burst'],['spread','Burst spread','particles.burst'],['origin','Burst origin','particles.burst']]],
 ['bloom','BLOOM','glow',['base','threshold','radius'],[['base','Base'],['threshold','Threshold'],['radius','Radius'],['knee','Knee'],['tint','Tint'],['stretch','Stretch']]],
 ['pulse','PULSE','pulse',['mode','strength','speed'],[['mode','Mode'],['strength','Strength'],['speed','Speed'],['centerX','Center X'],['centerY','Center Y'],['width','Width'],['chromatic','Chromatic']]],
 ['rotation','ROTATION','rotate',['mode','maxAngle','maxSpeed'],[['mode','Mode'],['maxAngle','Max angle (deg)'],['maxSpeed','Max speed (deg/s)'],['fill','Fill'],['direction','Direction'],['returnToRest','Return to rest']]],
 ['frame','FRAME',null,['fit','edge','overscan'],[['fit','Fit'],['edge','Edge'],['overscan','Overscan']]],
];
const OPEN_KEY='eyes4beat_look_groups';
export function readGroupState(storage){try{const data=JSON.parse(storage.getItem(OPEN_KEY)||'{}');return data&&typeof data==='object'?data:{}}catch{return {}}}
function store(storage,key,value){try{storage.setItem(key,JSON.stringify(value))}catch{}}
export function startingLook(record,presets,storage,scope=''){
 const factory=FACTORY_LOOKS.find(p=>record.origin?.type==='factory'&&p.id===record.origin.presetId);
 if(factory)return normalizeLook(factory.look);
 if(record.origin?.type==='blank')return normalizeLook(NEUTRAL_LOOK);
 const key='eyes4beat_look_start:'+scope+':'+record.id;
 try{const saved=JSON.parse(storage.getItem(key)||'null');if(saved)return normalizeLook(saved)}catch{}
 const preset=presets.find(p=>record.origin?.type==='project-preset'&&p.id===record.origin.presetId);
 const look=normalizeLook(preset?.look||record.look||NEUTRAL_LOOK);store(storage,key,look);return look;
}
export function resetLookGroup(look,start,group){
 const next=structuredClone(look);next[group]=structuredClone(start[group]);
 if(group==='color')next.vignette=structuredClone(start.vignette);
 return normalizeLook(next);
}
export function updateLookRoutingHints(root,map){
 for(const [,title,target] of LOOK_GROUPS){if(!target)continue;
  const node=root.querySelector('[data-routing-target="'+target+'"]');if(!node)continue;
  const source=assignedSource(map,target);
  node.textContent=source?'← '+sourceLabels[source]:'not routed · ROUTING';
  node.title=title+' · '+(source?'Edit '+sourceLabels[source]+' routing':'Assign a source')+' (R)';
 }
}
export function renderLookControls({root,getLook,onChange,start,storage=localStorage,map,openRouting}){
 root.replaceChildren();const state=readGroupState(storage);
 const create=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node};
 function remember(details,key,fallback){details.open=typeof state[key]==='boolean'?state[key]:fallback;details.addEventListener('toggle',()=>{if(!details.isConnected)return;state[key]=details.open;store(storage,OPEN_KEY,state)})}
 for(const [group,title,target,primary,fields] of LOOK_GROUPS){
  const section=create('details','lookGroup lookDisclosure inspectorSection');section.dataset.lookGroup=group;remember(section,group,true);
  const heading=create('summary','lookGroupHeader sectionHeader');heading.append(create('span','lookGroupTitle',title));
  if(target){const hint=create('button','lookRouteHint');hint.type='button';hint.dataset.routingTarget=target;hint.onclick=e=>{e.preventDefault();openRouting()};heading.append(hint)}
  const reset=create('button','lookGroupReset','Reset');reset.type='button';reset.title='Reset '+title.toLowerCase()+' to starting look';reset.setAttribute('aria-label',reset.title);
  reset.onclick=e=>{e.preventDefault();onChange(resetLookGroup(getLook(),start,group));renderLookControls({root,getLook,onChange,start,storage,map,openRouting})};heading.append(reset);section.append(heading);
  const body=create('div','lookGroupBody sectionBody'),advanced=create('details','lookAdvanced');advanced.append(create('summary','','Advanced'));remember(advanced,group+'.advanced',false);section.append(body);
  for(const [key,label,fieldGroup=group] of fields){
   const path=fieldGroup.split('.'),read=look=>path.reduce((value,part)=>value[part],look)[key],value=read(getLook());
   const row=create('div','lookField');row.dataset.field=key;row.dataset.path=fieldGroup+'.'+key;row.append(create('span','lookFieldCaption',label));
   const aria=title.toLowerCase()+' '+label.toLowerCase();
   const choices=key==='mode'?(group==='rotation'?['angle','spin']:group==='pulse'?['breath','shockwave']:['directional','radial']):
    ({direction:['cw','ccw','flip-on-beat'],colorMode:['fixed','palette'],trigger:['none',...eventSourceIds()],origin:['center','random'],fit:['cover','contain','stretch'],edge:['mirror','clamp'],style:['dots','rings','streaks'],motion:['rise','wave-flow','radial','jitter-flow','depth-flow']})[key];
   const apply=value=>{const next=structuredClone(getLook());path.reduce((v,p)=>v[p],next)[key]=value;onChange(normalizeLook(next));return read(getLook())};
   if(LOOK_FIELDS[fieldGroup]?.[key]){
    const [min,max,step]=LOOK_FIELDS[fieldGroup][key],control=create('div','lookSliderControl'),slider=create('input','lookSlider'),display=create('button','lookValue'),editor=create('input','lookValueEditor');
    slider.type='range';editor.type='number';for(const input of [slider,editor]){input.min=min;input.max=max;input.step=step;input.value=value}
    slider.setAttribute('aria-label',aria);editor.setAttribute('aria-label','Edit '+aria+' value');editor.hidden=true;
    display.type='button';display.title='Edit '+label.toLowerCase()+' value';display.setAttribute('aria-label',display.title);
    const show=value=>{slider.value=value;display.textContent=String(Number(Number(value).toFixed(4)))};
    show(value);slider.oninput=()=>show(apply(slider.valueAsNumber));
    display.onclick=()=>{editor.value=read(getLook());editor.hidden=false;display.hidden=true;editor.focus();editor.select()};
    editor.oninput=()=>{if(Number.isFinite(editor.valueAsNumber))show(apply(editor.valueAsNumber))};
    editor.onblur=()=>{show(read(getLook()));editor.hidden=true;display.hidden=false};
    editor.onkeydown=e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();editor.blur();display.focus()}};
    control.append(slider,display,editor);row.append(control);
   }else if(choices){
    const segments=create('div','lookSegments');segments.setAttribute('role','group');segments.setAttribute('aria-label',aria);
    // A hidden select keeps the existing editor input contract for integrations.
    const input=create('select','');input.hidden=true;input.setAttribute('aria-label',aria);
    for(const choice of choices){const option=document.createElement('option');option.value=choice;option.textContent=choice;input.append(option);
     const b=create('button','',choice.replaceAll('-',' '));b.type='button';b.dataset.value=choice;b.title=label+': '+choice;b.setAttribute('aria-pressed',String(value===choice));b.onclick=()=>{input.value=choice;input.dispatchEvent(new Event('input',{bubbles:true}))};segments.append(b)}
    input.value=value;input.oninput=()=>{apply(input.value);for(const b of segments.children)b.setAttribute('aria-pressed',String(b.dataset.value===input.value));if(group==='distortion'&&key==='mode')section.querySelector('[data-field=angle]').hidden=input.value!=='directional'};
    row.append(segments,input);
   }else{
    const input=create('input',typeof value==='boolean'?'':'lookSwatch');input.type=typeof value==='boolean'?'checkbox':'color';input.setAttribute('aria-label',aria);
    if(input.type==='checkbox')input.checked=value;else input.value=value;
    input.oninput=()=>apply(input.type==='checkbox'?input.checked:input.value);row.append(input);
   }
   (fieldGroup===group&&primary.includes(key)?body:advanced).append(row);
  }
  if(advanced.children.length>1)body.append(advanced);
  if(group==='distortion')section.querySelector('[data-field=angle]').hidden=getLook().distortion.mode!=='directional';
  root.append(section);
 }
 updateLookRoutingHints(root,map);
}
