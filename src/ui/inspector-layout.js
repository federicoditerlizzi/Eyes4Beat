// Shared inspector structure. Existing controls are moved, retaining their handlers.
export function setupInspectorLayout(){
 const el=id=>document.getElementById(id);
 const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node};
 function section(label,nodes){
  const root=make('details','inspectorSection');root.open=true;
  const header=make('summary','sectionHeader');header.textContent=label;
  const body=make('div','sectionBody');body.append(...nodes);root.append(header,body);return root;
 }
 function tab(panel,primary,actions,content){
  panel.classList.add('inspectorTabPage');
  const toolbar=make('div','tabToolbar'),left=make('div','tabPrimary'),right=make('div','tabActions'),body=make('div','tabBody');
  left.append(...primary);right.append(...actions);toolbar.append(left,right);body.append(...content);panel.replaceChildren(toolbar,body);return body;
 }
 const look=el('lookPanel'),lookInfo=look.querySelector('.infoTip');
 lookInfo.dataset.tooltip+=' Distortion requires an active routed target. Changes save automatically.';
 const warning=el('lookRoutingWarning');warning.className='inspectorBanner';
 tab(look,[look.querySelector('.presetBar')],[lookInfo],[warning,el('lookFields')]);
 const routing=el('routingPanel'),lab=el('lab'),routingInfo=lab.querySelector('.infoTip').cloneNode(true);
 routingInfo.classList.remove('accordionInfo');routingInfo.setAttribute('aria-label','About routing');
 tab(routing,[routing.querySelector('.presetDock')],[routingInfo],[lab]);
 for(const group of lab.querySelectorAll('.labAccordion')){
  group.className='inspectorSection';group.querySelector('summary').className='sectionHeader';
  const info=group.querySelector('.infoTip');info.classList.remove('accordionInfo');group.querySelector('summary').append(info);
  group.querySelector('.accordionBody').classList.add('sectionBody');
 }
 const images=el('imagePanel'),info=images.querySelector('.infoTip'),controls=images.querySelector('.imageSequenceControls');
 const primary=[...controls.children].slice(0,3);
 const body=tab(images,primary,[info,el('openImageTutorial')],[el('beatTimeStatus'),section('MAPPING',[controls]),section('TRANSITIONS',[el('triggerTransitionControls')]),section('MEDIA',[images.querySelector('.carouselToolbar'),el('imageGrid')])]);
 body.classList.add('imageManagerBody');el('beatTimeStatus').classList.add('inspectorBanner');
 for(const info of document.querySelectorAll('.tabActions .infoTip'))info.classList.add('tipLeft');
}
