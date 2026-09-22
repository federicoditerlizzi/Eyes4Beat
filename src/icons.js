import {
  Activity, ArrowDown, ArrowUp, AudioLines, BookOpen, ChevronDown, ChevronLeft, Copy,
  ChevronRight, ChevronUp, Download, FileAudio, FileCheck2, FolderOpen, Images, Info, Keyboard, Maximize,
  Lock, Minimize, MonitorOff, OctagonAlert, Pause, Pencil, Play, Plus, Save, ScreenShare, SlidersHorizontal, UserRound,
  Trash2, Volume2, VolumeX, X, createElement, createIcons,
} from 'lucide';

const ICONS = {
  Activity, ArrowDown, ArrowUp, AudioLines, BookOpen, ChevronDown, ChevronLeft, Copy,
  ChevronRight, ChevronUp, Download, FileAudio, FileCheck2, FolderOpen, Images, Info, Keyboard, Maximize,
  Lock, Minimize, MonitorOff, OctagonAlert, Pause, Pencil, Play, Plus, Save, ScreenShare, SlidersHorizontal, UserRound,
  Trash2, Volume2, VolumeX, X,
};

const iconByName = {
  activity: Activity,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'audio-lines': AudioLines,
  'book-open': BookOpen,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  copy: Copy,
  download: Download,
  'file-audio': FileAudio,
  'file-check-2': FileCheck2,
  'folder-open': FolderOpen,
  images: Images,
  info: Info,
  keyboard: Keyboard,
  lock: Lock,
  maximize: Maximize,
  minimize: Minimize,
  'monitor-off': MonitorOff,
  'octagon-alert': OctagonAlert,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  save: Save,
  'screen-share': ScreenShare,
  'sliders-horizontal': SlidersHorizontal,
  'trash-2': Trash2,
  'user-round': UserRound,
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
