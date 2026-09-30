import { createPresetMenu } from './preset-menu.js';

// Both inspector tabs share the same label, menu and action layout.
export function createPresetBar(select,{label,save,update,...menuOptions}){
 const bar=select.closest('.lookPresetBar,.presetToolbar');
 bar.className='presetBar';
 const caption=bar.querySelector('label');caption.textContent=label;
 save.textContent='SAVE AS NEW';save.className='presetBarAction';
 const actions=document.createElement('div');actions.className='presetBarActions';actions.append(save);
 if(update){update.textContent='UPDATE';update.className='presetBarAction';actions.append(update)}
 bar.replaceChildren(caption,select,actions);
 const menu=createPresetMenu(select,{label,...menuOptions});
 return {...menu,setModified(value){select.dataset.modified=String(value);menu.refresh()}};
}
