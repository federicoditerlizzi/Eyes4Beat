import {getSources} from '../source-registry.js';
export function renderSourceControls(modState){
 const head=document.querySelector('.pHead'),parent=head.parentElement,sources=getSources(),ids=new Set(sources.map(s=>s.id));
 for(const row of parent.querySelectorAll('[data-p]'))if(!ids.has(row.dataset.p))row.remove();
 for(const source of sources){
  const k=source.id;let row=parent.querySelector('[data-p="'+k+'"]');
  if(!row){row=document.createElement('div');row.className='pRow';row.dataset.p=k;
   row.innerHTML='<span></span><input class="onCheck" type="checkbox"><input type="range" min="-1.5" max="1.5" step="0.01"><button class="soloBtn">S</button><span></span>';
   const [caption,on,amount,solo,value]=row.children;on.dataset.on=k;on.checked=modState.enabled[k]!==false;amount.id='amt-'+k;amount.value='1';amount.dataset.sourceAmount=k;solo.dataset.solo=k;solo.setAttribute('aria-label','Solo '+source.label);solo.setAttribute('aria-pressed',String(!!modState.solo[k]));value.id='show-'+k;value.textContent='1.00';
   on.onchange=()=>modState.enabled[k]=on.checked;solo.onclick=()=>{modState.solo[k]=!modState.solo[k];solo.classList.toggle('active',modState.solo[k]);solo.setAttribute('aria-pressed',String(modState.solo[k]))};amount.oninput=()=>value.textContent=(+amount.value).toFixed(2);
   modState.enabled[k]??=true;modState.solo[k]??=false;
  }
  row.children[0].textContent=source.label;row.children[1].setAttribute('aria-label','Enable '+source.label);row.children[2].setAttribute('aria-label',source.label+' amount');row.children[3].title='Solo '+source.label;parent.append(row);
 }
 for(const field of ['enabled','solo'])for(const id of Object.keys(modState[field]))if(!ids.has(id))delete modState[field][id];
 const select=document.getElementById('imageSource'),selected=select.value;select.replaceChildren(new Option('None','none'),...sources.map(s=>new Option(s.label,s.id)));select.value=ids.has(selected)?selected:'none';
 const bpm=document.getElementById('vBPM').closest('.row'),panel=bpm.parentElement;
 for(const row of panel.querySelectorAll('.row'))if(row!==bpm)row.remove();
 for(const source of sources){const row=document.createElement('div');row.className='row';row.dataset.diagnosticSource=source.id;row.innerHTML='<span></span><div class="meter"><div class="fill"></div></div><span>0.00</span>';row.children[0].textContent=source.label;panel.insertBefore(row,bpm)}
 const info=panel.querySelector('.infoTip');if(info)info.dataset.tooltip='Normalized source values. Events carry decaying intensity; BPM is tempo state.';
}
