import { BLOOM_QUALITY_KEY, normalizeBloomQuality } from './bloom.js';
export const RENDER_SCALE_KEY='eyes4beat_render_scale';
export function normalizeRenderScale(value){
 if(value===null||value===''||!Number.isFinite(Number(value)))return .78;
 return Math.max(.5,Math.min(1,Number(value)));
}
export function readOutputSettings(storage){
 try{return {quality:normalizeBloomQuality(storage.getItem(BLOOM_QUALITY_KEY)),renderScale:normalizeRenderScale(storage.getItem(RENDER_SCALE_KEY))}}
 catch{return {quality:'high',renderScale:.78}}
}
export function saveOutputSetting(storage,key,value){try{storage.setItem(key,String(value))}catch{}}
