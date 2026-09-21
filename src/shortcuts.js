export function resolvePerformanceShortcut(event, archetypeCount) {
  if (event.metaKey || event.ctrlKey) return null;
  const code = event.code || '';
  if (event.altKey) {
    if (event.shiftKey) return null;
    if (code === 'ArrowRight' || code === 'KeyD') return { type: 'preset-step', direction: 1 };
    if (code === 'ArrowLeft' || code === 'KeyA') return { type: 'preset-step', direction: -1 };
    if (code === 'Digit0') return { type: 'preset-select', index: 9 };
    const presetMatch = code.match(/^Digit([1-9])$/);
    return presetMatch ? { type: 'preset-select', index: Number(presetMatch[1]) - 1 } : null;
  }
  if (code === 'Slash' && event.shiftKey) return { type: 'help' };
  if (code === 'KeyB') return { type: 'safety', control: 'blackout' };
  if (code === 'KeyP') return { type: 'safety', control: 'panic' };
  if (code === 'ArrowRight' || code === 'KeyD') return { type: 'step', direction: 1 };
  if (code === 'ArrowLeft' || code === 'KeyA') return { type: 'step', direction: -1 };
  if (code === 'KeyS') return { type: 'transition', mode: 'smooth' };
  if (code === 'KeyC') return { type: 'transition', mode: 'cut' };
  if (code === 'Digit0' && !event.shiftKey && archetypeCount >= 10) return { type: 'select', index: 9 };
  const match = code.match(/^Digit([1-9])$/);
  if (!match) return null;
  const number = Number(match[1]);
  const index = event.shiftKey ? number + 9 : number - 1;
  return index < archetypeCount ? { type: 'select', index } : null;
}
