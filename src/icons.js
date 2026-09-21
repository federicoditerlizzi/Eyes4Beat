import {
  Activity, ArrowDown, ArrowUp, AudioLines, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, FileAudio, Images, Info, Keyboard, Maximize,
  Minimize, MonitorOff, OctagonAlert, Pause, Play, Plus, Save, ScreenShare,
  Trash2, Volume2, VolumeX, X, createElement, createIcons,
} from 'lucide';

const ICONS = {
  Activity, ArrowDown, ArrowUp, AudioLines, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, FileAudio, Images, Info, Keyboard, Maximize,
  Minimize, MonitorOff, OctagonAlert, Pause, Play, Plus, Save, ScreenShare,
  Trash2, Volume2, VolumeX, X,
};

const iconByName = {
  activity: Activity,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'audio-lines': AudioLines,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'file-audio': FileAudio,
  images: Images,
  info: Info,
  keyboard: Keyboard,
  maximize: Maximize,
  minimize: Minimize,
  'monitor-off': MonitorOff,
  'octagon-alert': OctagonAlert,
  pause: Pause,
  play: Play,
  plus: Plus,
  save: Save,
  'screen-share': ScreenShare,
  'trash-2': Trash2,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  x: X,
};

const svgAttrs = { 'aria-hidden': 'true', focusable: 'false', 'stroke-width': '2' };

export function initIcons(root = document) {
  createIcons({ icons: ICONS, root, attrs: svgAttrs });
}

export function icon(name, className = '') {
  const iconNode = iconByName[name];
  if (!iconNode) throw new Error(`Unknown Lucide icon: ${name}`);
  const element = createElement(iconNode, { ...svgAttrs, class: `lucide lucide-${name}${className ? ` ${className}` : ''}` });
  return element.outerHTML;
}
