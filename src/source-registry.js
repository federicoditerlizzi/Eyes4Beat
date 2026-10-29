export const AUDIO_SOURCES = Object.freeze([
  ...Object.entries({ level: 'Level', low: 'Low', bright: 'Brightness', motion: 'Motion', full: 'Fullness' })
    .map(([id, label]) => Object.freeze({ id, label, kind: 'continuous', group: 'audio' })),
  ...['beat', 'kick', 'snare'].map(id => Object.freeze({ id, label: id[0].toUpperCase() + id.slice(1), kind: 'event', group: 'audio' })),
]);
const builtinIds = new Set(AUDIO_SOURCES.map(source => source.id));
const reservedIds = new Set(['constructor', 'prototype', 'none', 'energy', 'density', 'drive', 'tension', 'boombap', 'open']);
export const isBuiltinAudioSource = id => builtinIds.has(id);
export const sourceRegistry = [];
// Live derived views retained for routing loops; never a second source definition.
export const sourceIds = [], sourceLabels = {};
const listeners = new Set();

export function validSourceDefinition(source) {
  return !!source && typeof source.id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(source.id)
    && !reservedIds.has(source.id) && !Object.hasOwn(Object.prototype, source.id) && ['continuous', 'event'].includes(source.kind)
    && typeof source.label === 'string' && !!source.label.trim()
    && typeof source.group === 'string' && !!source.group.trim();
}
function definition(source) {
  if (!validSourceDefinition(source)) throw new Error('Invalid source metadata');
  const { id, label, kind, group } = source;
  return Object.freeze({ id, label, kind, group });
}
function refreshViews() {
  sourceIds.splice(0, sourceIds.length, ...sourceRegistry.map(source => source.id));
  for (const key of Object.keys(sourceLabels)) delete sourceLabels[key];
  for (const source of sourceRegistry) sourceLabels[source.id] = source.label;
}
export const accentSourceId=id=>id+'_accent';
export const accentParentId=id=>getSource(id)?.group==='accent'?id.slice(0,-7):null;
function deriveAccents(){
 const bases=sourceRegistry.filter(source=>source.group!=='accent');
 const derived=bases.filter(source=>source.kind==='event').map(source=>definition({id:accentSourceId(source.id),label:source.label+' · accent',kind:'event',group:'accent'}));
 if(derived.some(source=>bases.some(base=>base.id===source.id)))throw new Error('Reserved accent source id');
 sourceRegistry.splice(0,sourceRegistry.length,...bases,...derived);
}
function changed() {
  deriveAccents();refreshViews();
  for (const listener of listeners) listener(getSources());
}
export function getSources() { return sourceRegistry.map(source => ({ ...source })); }
export function getSource(id) { return sourceRegistry.find(source => source.id === id); }
export const extensionDefinitions = () => getSources().filter(source => !isBuiltinAudioSource(source.id));
export function registerSource(source) {
  const item = definition(source);
  if (getSource(item.id)) throw new Error('Source already registered: ' + item.id);
  if(item.group==='accent'||item.id.endsWith('_accent')||getSource(accentSourceId(item.id)))throw new Error('Reserved accent source id');
  sourceRegistry.push(item);changed();
  return () => unregisterSource(item.id);
}
export function unregisterSource(id) {
  const index = sourceRegistry.findIndex(source => source.id === id);
  if (index < 0) return false;
  if(sourceRegistry[index].group==='accent')return false;
  sourceRegistry.splice(index, 1);changed();return true;
}
export function subscribeSources(listener) { listeners.add(listener);return () => listeners.delete(listener); }
export function eventSourceIds() { return sourceRegistry.filter(source => source.kind === 'event').map(source => source.id); }
export function replaceSources(sources) {
  const next = sources.map(definition);
  if (new Set(next.map(source => source.id)).size !== next.length) throw new Error('Duplicate source');
  const prior=sourceRegistry.slice();sourceRegistry.splice(0,sourceRegistry.length,...next);
  try{deriveAccents()}catch(error){sourceRegistry.splice(0,sourceRegistry.length,...prior);throw error}
  if(JSON.stringify(sourceRegistry)===JSON.stringify(prior))return;
  changed();
}

// Server normalization is synchronous and scoped to a record: extension metadata
// never leaks to another request and cannot register a device input on the server.
export function withSourceDefinitions(definitions, normalize) {
  const extra = (definitions || []).map(definition), prior = sourceRegistry.slice();
  try {
    for (const source of extra) if (!getSource(source.id)) sourceRegistry.push(source);
    deriveAccents();refreshViews();return normalize();
  } finally { sourceRegistry.splice(0, sourceRegistry.length, ...prior);refreshViews(); }
}
replaceSources(AUDIO_SOURCES);
