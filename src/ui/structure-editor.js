import { getSources } from '../source-registry.js';
import { normalizeStructures, STRUCTURE_PARAMETERS, STRUCTURE_CURVES, structureFieldRelevant } from '../structure.js';
import { normalizeAccentSettings } from '../accents.js';
/** Rebuilt only on explicit list/selector changes, never on runtime snapshots. */
export function createStructureEditor({root,getValue,onChange}){
 const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node};
 function field(parent,label,input){const row=make('label');row.className='structureField';row.append(make('span',label),input);parent.append(row);input.setAttribute('aria-label',label);return row}
 function number(value,min,max,step,change){const input=make('input');input.type='number';Object.assign(input,{value,min,max,step});input.onchange=()=>{if(Number.isFinite(input.valueAsNumber))change(input.valueAsNumber)};return input}
 function select(value,choices,change){const input=make('select');for(const [id,label] of choices){const option=make('option',label);option.value=id;input.append(option)}input.value=value;input.onchange=()=>change(input.value);return input}
 function commit(value){onChange({structure:normalizeStructures(value.structure),accent:normalizeAccentSettings(value.accent)})}
 function render(){
  root.replaceChildren();const value=getValue(),rows=normalizeStructures(value.structure),accent=normalizeAccentSettings(value.accent);
  const settings=make('div');settings.className='structureAccentSettings';
  field(settings,'Accent ratio',number(accent.ratio,1,4,.05,ratio=>commit({...getValue(),accent:{...getValue().accent,ratio}})));
  field(settings,'Accent gap (beats)',number(accent.gapBeats,.25,16,.25,gapBeats=>commit({...getValue(),accent:{...getValue().accent,gapBeats}})));root.append(settings);
  const events=[['none','None'],...getSources().filter(s=>s.kind==='event').map(s=>[s.id,s.label])];
  rows.forEach((row,index)=>{
   const card=make('div');card.className='structureRow';card.dataset.structureId=row.id;
   const heading=make('div');heading.className='structureHeading';heading.append(make('strong','Modulation '+(index+1)));
   const remove=make('button','Remove');remove.type='button';remove.onclick=()=>{commit({...getValue(),structure:getValue().structure.filter(r=>r.id!==row.id)});render()};heading.append(remove);card.append(heading);
   const patch=(changes,rebuild=false)=>{commit({...getValue(),structure:getValue().structure.map(r=>r.id===row.id?{...r,...changes}:r)});if(rebuild)render()};
   field(card,'Trigger',select(row.trigger,events,trigger=>patch({trigger})));
   field(card,'Parameter',select(row.parameter,Object.entries(STRUCTURE_PARAMETERS).map(([id,p])=>[id,p.label]),parameter=>patch({parameter,min:undefined,max:undefined,step:undefined,values:undefined},true)));
   const p=STRUCTURE_PARAMETERS[row.parameter],step=p.discrete?1:.001;
   field(card,'Minimum',number(row.min,p.min,p.max,step,min=>patch({min})));
   field(card,'Maximum',number(row.max,p.min,p.max,step,max=>patch({max})));
   field(card,'Mode',select(row.mode,[['random-walk','Random walk'],['random','Random'],['cycle','Cycle']],mode=>patch({mode},true)));
   const stepField=field(card,'Step size',number(row.step,0,p.max-p.min,step,step=>patch({step})));stepField.hidden=!structureFieldRelevant(row,'step');
   const values=make('input');values.type='text';values.value=row.values.join(', ');values.onchange=()=>{const parsed=values.value.split(',').map(s=>s.trim()).filter(Boolean).map(Number);if(parsed.length&&parsed.every(Number.isFinite))patch({values:parsed})};
   field(card,'Cycle values',values).hidden=!structureFieldRelevant(row,'values');
   field(card,'Easing (ms)',number(row.durationMs,50,2000,10,durationMs=>patch({durationMs})));
   field(card,'Curve',select(row.curve,STRUCTURE_CURVES.map(id=>[id,id]),curve=>patch({curve})));
   root.append(card);
  });
  const add=make('button','ADD MODULATION');add.id='addStructure';add.type='button';add.disabled=rows.length>=8;add.onclick=()=>{commit({...getValue(),structure:[...getValue().structure,{id:crypto.randomUUID(),trigger:'none',parameter:'kaleido.segments',mode:'cycle',min:6,max:8,values:[6,8]}]});render()};root.append(add);
 }
 return {render};
}
