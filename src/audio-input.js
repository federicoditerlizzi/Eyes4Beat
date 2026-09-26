import { dbToGain } from './input-calibration.js';
import { decodeFeatures, decodeDiagnostics } from './analysis/messages.js';
import analysisWorkletUrl from './analysis/worklet.js?worker&url';

export const INPUT_DEVICE_KEY = 'eyes4beat_input_device';

function safeDisconnect(node) {
  try { node?.disconnect(); } catch {}
}

function builtInLast(device) {
  return /built[- ]?in|internal|macbook|integrated/i.test(device.label || '') ? 1 : 0;
}

export function readableInputError(error) {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Live audio input requires HTTPS or localhost.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Audio input permission was denied. Allow access in the browser settings and try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'No matching audio input is available.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError' || error?.name === 'AbortError') return 'The audio input is busy or unavailable. Close other audio apps and try again.';
  return error?.message ? `Audio input error: ${error.message}` : 'Could not start the audio input.';
}

export class AudioInputController {
  constructor(audioElement, { onDeviceChange, onTrackEnded, onFeatures, onCalibration, onAnalysisError } = {}) {
    this.audio = audioElement;this.destroyed=false;this.contextReady=null;this.inputGeneration=0;
    this.onDeviceChange = onDeviceChange;
    this.onTrackEnded = onTrackEnded;this.onFeatures = onFeatures;this.onCalibration = onCalibration;this.analysisDiagnostics = null;this.diagnosticsEnabled = false;this.onAnalysisError = onAnalysisError;
    this.context = null;this.analysisNode = null;this.trimGain = null;this.silentPull = null;
    this.mediaSource = null;this.liveSource = null;this.liveStream = null;this.liveTrack = null;
    this.mode = 'file';this.deviceId = 'file';this.deviceLabel = '';
    this.boundDeviceChange = () => this.onDeviceChange?.();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.boundDeviceChange);
  }

  async ensureContext() {
    if(this.destroyed)throw new Error('Audio engine disposed');
    if(!this.contextReady)this.contextReady=this.createContext().catch(error=>{this.contextReady=null;throw error});
    await this.contextReady;
    if(this.destroyed)throw new Error('Audio engine disposed');
    if(this.context.state==='suspended')await this.context.resume();
    return this.context;
  }

  async createContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
      try {
        this.trimGain = this.context.createGain();
        if (!this.context.audioWorklet || !window.AudioWorkletNode) throw new Error('AudioWorklet is unavailable in this browser. Real-time analysis cannot start.');
        await this.context.audioWorklet.addModule(analysisWorkletUrl);
        if(this.destroyed)throw new Error('Audio engine disposed');
        this.analysisNode = new AudioWorkletNode(this.context, 'eyesforbeats-analysis', { processorOptions: { fftSize: 2048, hopSize: 512 } });
        this.analysisNode.port.onmessage = event => {
          const message = event.data;
          try {
            if (message.type === 'features') {
              const features = decodeFeatures(message);
              if (this.diagnosticsEnabled && this.analysisDiagnostics) Object.assign(features, this.analysisDiagnostics);
              this.onFeatures?.(features);
              if (features.overflow) this.onAnalysisError?.(new Error('Analysis event queue overflow: main thread stalled.'));
            } else if (message.type === 'diagnostics') this.analysisDiagnostics = decodeDiagnostics(message, this.context.sampleRate);
            else if (message.type === 'calibration-sample') this.onCalibration?.({ final: message.final, count: message.count, power: message.power, fftSize: message.fftSize, spectrum: message.payload.slice(0, message.bins) });
          } finally {
            if (message.payload) this.analysisNode.port.postMessage({ type: 'recycle', kind: message.type, slot: message.slot, payload: message.payload }, [message.payload.buffer]);
          }
        };
        this.setAnalysisDiagnostics(this.diagnosticsEnabled);
        this.analysisNode.onprocessorerror = event => this.onAnalysisError?.(event);
        this.silentPull = this.context.createGain();this.silentPull.gain.value = 0;
        this.trimGain.connect(this.analysisNode);this.analysisNode.connect(this.silentPull);this.silentPull.connect(this.context.destination);
      } catch (error) {
        await this.context.close().catch(()=>{});this.context = null;this.trimGain = null;this.analysisNode = null;this.silentPull = null;throw error;
      }
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  setTrimDb(db, immediate = false) {
    if (!this.trimGain || !this.context) return;
    const gain = dbToGain(db), now = this.context.currentTime;
    this.trimGain.gain.cancelScheduledValues(now);
    if (immediate) this.trimGain.gain.setValueAtTime(gain, now);
    else this.trimGain.gain.setTargetAtTime(gain, now, .025);
  }

  disconnectCurrentInput() {
    safeDisconnect(this.mediaSource);safeDisconnect(this.liveSource);this.liveSource = null;
  }

  stopLiveTracks() {
    if (this.liveTrack) this.liveTrack.onended = null;
    this.liveStream?.getTracks().forEach((track) => track.stop());
    this.liveStream = null;this.liveTrack = null;this.liveSource = null;
  }

  async activateFile() {
    await this.ensureContext();if(this.destroyed)return;this.inputGeneration++;this.disconnectCurrentInput();this.stopLiveTracks();
    if (!this.mediaSource) this.mediaSource = this.context.createMediaElementSource(this.audio);
    this.mediaSource.connect(this.context.destination);this.mediaSource.connect(this.trimGain);
    this.mode = 'file';this.deviceId = 'file';this.deviceLabel = 'Audio file';
    return this.diagnostics();
  }

  async activateLive(deviceId) {
    const generation=++this.inputGeneration;await this.ensureContext();if(this.destroyed)return;this.audio.pause();this.disconnectCurrentInput();this.stopLiveTracks();
    this.mode = 'live';this.deviceId = deviceId || 'default';this.deviceLabel = 'Audio input';
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    if(this.destroyed||generation!==this.inputGeneration){stream.getTracks().forEach(track=>track.stop());throw new Error('Audio input request superseded')}
    const track = stream.getAudioTracks()[0];
    if (!track) { stream.getTracks().forEach((item) => item.stop());throw new DOMException('No audio track returned', 'NotFoundError'); }
    this.liveStream = stream;this.liveTrack = track;this.liveSource = this.context.createMediaStreamSource(stream);this.liveSource.connect(this.trimGain);
    this.deviceId = track.getSettings().deviceId || deviceId || 'default';this.deviceLabel = track.label || 'Audio input';
    track.onended = () => { this.liveSource && safeDisconnect(this.liveSource);this.liveSource = null;this.onTrackEnded?.(this.deviceId); };
    return this.diagnostics();
  }

  get inputActive() {
    if (!this.analysisNode) return false;
    if (this.mode === 'file') return !this.audio.paused && !this.audio.ended;
    return this.liveTrack?.readyState === 'live' && this.liveTrack.enabled;
  }

  resetAnalysis(resetLayers = false) { this.analysisNode?.port.postMessage({ type: 'reset', resetLayers }); }
  setAnalysisDiagnostics(value) { this.diagnosticsEnabled = !!value;this.analysisNode?.port.postMessage({ type: 'diagnostics', value: this.diagnosticsEnabled }); }
  setAnalysisCalibration(value) { this.analysisNode?.port.postMessage({ type: 'calibration', value }); }
  setCalibrationCapture(value) { this.analysisNode?.port.postMessage({ type: 'capture-calibration', value: !!value }); }

  diagnostics() {
    const settings = this.liveTrack?.getSettings?.() || {};
    const processing = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];
    const warning = this.mode === 'live' && processing.some((key) => settings[key] !== false)
      ? 'Input processing is active or unsupported; analyzer dynamics may be compressed.' : '';
    return {
      mode: this.mode, deviceId: this.deviceId, label: this.deviceLabel || this.liveTrack?.label || '—',
      sampleRate: settings.sampleRate ?? this.context?.sampleRate ?? '—', channelCount: settings.channelCount ?? 'unsupported',
      echoCancellation: settings.echoCancellation ?? 'unsupported', noiseSuppression: settings.noiseSuppression ?? 'unsupported',
      autoGainControl: settings.autoGainControl ?? 'unsupported', baseLatency: this.context?.baseLatency ?? 'unsupported', warning,
    };
  }

  async enumerateInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    return devices.map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Audio input ${index + 1}`, builtIn: !!builtInLast(device) }))
      .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.label.localeCompare(b.label));
  }

  async destroy() {
    this.destroyed=true;this.inputGeneration++;
    this.disconnectCurrentInput();this.stopLiveTracks();navigator.mediaDevices?.removeEventListener?.('devicechange', this.boundDeviceChange);
    if(this.analysisNode){this.analysisNode.port.onmessage=null;this.analysisNode.onprocessorerror=null;this.analysisNode.port.close();safeDisconnect(this.analysisNode)}
    safeDisconnect(this.trimGain);safeDisconnect(this.silentPull);
    await this.context?.close?.().catch(()=>{});
  }
}
