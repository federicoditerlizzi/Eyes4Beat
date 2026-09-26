# Engine and remote output — steps 1–3

The control starts with a local engine. Opening `?output=1` transfers ownership to the output: there is one renderer, one audio graph and one analysis worklet. Closing output shows a disconnect notice. Only the user-selected Use this window action restores a local engine. Deployment follows verification of step three.

## Ownership

- `src/main.js`: UI, editable copies of project settings, repository/sync, persistence debounce, previews, packages and shortcuts.
- `src/ui/engine-view.js`: paints transport, input, analysis and renderer diagnostics from full snapshots.
- `src/engine/engine.js`: sole command entry point, runtime project data, routing, frame clock, safety and lifecycle.
- `src/engine/renderer.js`: WebGL resources, textures/video/palettes, scene pass, bloom composite and context recovery.
- `src/engine/audio.js`: audio element, AudioInputController, playback/live input, trim and calibration. The existing analysis worklet and algorithms are unchanged.
- `src/engine/sequencer.js`: extracted sequence scheduling, transition state, history and media loading coordination.
- `src/engine/effects.js`: extracted motion integration, waves, particles.

The engine opens its own read connection to the same-origin cache named in `loadProject`. It resolves media IDs to blobs and creates its own URLs. UI preview URLs and engine texture URLs have separate lifetimes. Repository writes and synchronization stay in the UI.

## Wire boundary

`LocalTransport.send(type, payload)` creates a protocol-v1 command with a monotonically increasing `seq`. Validation rejects unsupported values and malformed command payloads. Both directions are structured-cloned, including each event subscriber, so editable UI state cannot mutate engine state by reference.

The engine buffers out-of-order sequences, rejects duplicates, and consumes failed commands without wedging the queue. Async project loads complete before the next queued command; archetype and image-selection intents start their existing asynchronous loaders in command order and retain their previous latest-pending behavior. Audio operations likewise start without blocking safety commands while a permission prompt is pending. Full snapshots describe loading and the eventual result. No texture handles, AudioNodes, HTML elements or callbacks cross the wire.

State events contain `protocol`, a monotonically increasing `version`, `appliedSeq`, and a complete `state`. Periodic snapshots are limited to once every 50 ms; command completion also publishes state so editors and transport receive immediate acknowledgement. State contains transport and input status, current/target IDs, image sequencing/timing, safety, target values, analysis, FPS and bloom diagnostics. Stale snapshot versions are ignored by both transports. Errors are separate messages.

| UI action | Command |
| --- | --- |
| Open/reload/import/duplicate/reorder/delete project or archetype | `loadProject` after UI repository operation |
| Edit look/routing/image settings/presets or rename archetype | `updateArchetype`, immediately before save debounce |
| Source and target controls, PERF/CTX, reactivity, apply music preset | `setControls` |
| Archetype button or shortcut | `selectArchetype` |
| Image next/previous/test or disable current image | `imageStep`, `imageGoto` |
| Smooth/cut buttons or shortcut | `setTransition` |
| Load file, play/pause, seek, volume, mute | `audioLoad`, `audioPlay`, `audioPause`, `audioSeek`, `audioVolume`, `audioMute` |
| Input panel, device selection, FILE/LIVE | `enumerateInputs`, `setInput` |
| Trim, calibration, clear calibration | `setTrim`, `calibrate`, `clearCalibration` |
| Blackout, PANIC, Live Lock | `setSafety` (UI additionally persists sync Live Lock) |
| Bloom quality, diagnostics visibility | `setQuality`, `setDiagnostics` |
| Engine handover/fallback audio | `audioRestore` |

Panel opening/closing, fullscreen, repository-only actions, preset naming, file dialogs, AI generation and ZIP export do not change engine state; they remain UI operations. Their resulting runtime changes use the commands above.

## Automated verification

- `npm test`: original algorithm tests plus protocol validation, reordered/duplicate sequences, async failure recovery, snapshot isolation/versioning, command coverage and the UI/engine ownership boundary.
- `test/engine-sequencer.test.js`: latest-pending media load, PANIC/project-switch during a load, cut and beat dwell behavior.
- `test/motion-webgl.html`, `test/motion-app.html`: shader/neutral rendering, look persistence and PANIC smoke checks.
- `test/engine-app.html`: isolated localhost browser test using a synthetic WAV and a fake media device. Covers cache load, immediate edits and debounced save, media navigation, beat settings, archetypes, mapping, shortcuts, file transport, trim/calibration, quality, safety and Live Lock.

Browser smoke tests create an isolated test account/cache. Run only on localhost in a disposable browser profile. For the live-input test, Chrome must use `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`. Real hardware and production sync are not replaced by these checks.

## Manual regression checklist

Compare with the previous build using the same project and audio file.

- [ ] Projects: create, switch, rename, duplicate, reorder/delete archetypes, delete project, empty project, sharing, sync, offline cache, conflict restore and Live Lock deferral.
- [ ] Packages and creator: import older/current ZIP, export/verify, media upload/preview/removal, factory/Blank/project-preset creation and generated images.
- [ ] Archetypes: buttons and rapid selections, smooth/cut, duplicate/rename/delete, footer collapse, musical presets save/apply/update/delete.
- [ ] Look editor: every ROTATION, PULSE, BLOOM, FRAME, DISTORTION, COLOR, PARTICLES/BURST control changes live; presets replace/save/rename/delete; persistence after reload.
- [ ] Routing: source assignment, positive/negative weight, zero/reset, source/target On/Solo, amount, intensity, reactivity and PERF/CTX.
- [ ] Image Manager: mode, source, threshold, order, dwell, enabled images, next/previous, all transition pools/TEST/easing/directions, seconds/beats, focused controls during automatic advances.
- [ ] Renderer: images/video, aspect/edge handling, resize, bloom quality off/low/high, motion and particles, context loss/recovery, neutral output.
- [ ] File audio: repeated loads, play/pause/end, seek while playing/paused, mute and volume; analysis remains independent of playback volume.
- [ ] Live audio: device selection, permissions denied, reconnect of the same device, FILE/LIVE switching, no speaker monitoring, trim, calibration/clear/stale calibration.
- [ ] Safety: BLACKOUT independent of WebGL; PANIC immediately clears motion/particles, freezes advances and eases targets on release; safety controls during rapid media selection.
- [ ] Shortcuts: archetype/media/preset navigation, smooth/cut, B/P/Live Lock/help; typing, dialogs, repeated keydowns and output guards.
- [ ] Other panels: open/close/fullscreen, diagnostics/tooltip/readouts and input meters; no focus theft.
- [ ] Remote output: follow the second-screen checklist below.

## MessageChannel and ownership transfer

The controller opens an output with a random session nonce. The hello check requires the exact WindowProxy, same origin, protocol version and nonce. Only then is one MessagePort transferred. The destination responds ready with authoritative recovery data when reattaching; LocalTransport and RemoteTransport share send/subscribe/dispose. The host maps remote and output-local safety commands onto one sequence. Commands receive acknowledgements; full status snapshots remain versioned, with stale versions ignored. Blob requests/replies use the same private port and do not enter the command queue, so a project load waiting for a missing blob cannot deadlock it.

EngineSession keeps the current project payload updated with immediate unsaved edits and retains the audio Blob. It stops the existing engine before creating the destination. Project/selection/media positions, controls, safety, quality, diagnostics and audio transport are replayed; commands entered during the handover are buffered and delivered afterward. The output requires its own one-time audio click. File playback restores the last reported position; a closed output may lose up to one status interval plus connection-detection latency. Live capture is reopened on the chosen device in the new engine. Effects restart on explicit local takeover; no particle or effect replication exists. Reloading control preserves the running output engine and does not restart effects, reload textures, or seek audio.

Disposal includes pending image/video cancellation, staged-media discard, GPU resources, RAF, audio element, live tracks, analysis node/port, AudioContext, listeners, cache connection and object URLs. Selection loads stage both roles and commit together, with stale selection/generation guards.

## Second-screen manual checklist

- [ ] Open output on a second screen, confirm only Click to start and fullscreen controls, click once and enter fullscreen.
- [ ] Play/pause/seek a file from control; verify audio comes only from output and control has no running AudioContext or animation loop.
- [ ] Select a live device in control; grant permission in output; verify device list, trim, calibration and input-loss/reconnect.
- [ ] Repeatedly switch archetypes and images, including while videos load and during transitions: no previous-image flash or late upload.
- [ ] Edit looks, routing and musical controls while playing; verify immediate output response and saved settings after reload.
- [ ] Toggle blackout/PANIC from control and with B/P in output; verify both UI and output agree and PANIC clears motion immediately.
- [ ] Close output mid-file playback: a disconnect notice appears; choose Use this window and control resumes at approximately the same position with the same project, selection, image and settings; repeat with live input.
- [ ] Reopen/close repeatedly, block a popup, close before Click to start, and close during media loading; verify no orphan audio or renderer.
- [ ] Compare GPU/CPU at 1080p on the target laptop against the previous two-renderer implementation. Measure with the same media, audio, quality and effects; browser smoke tests do not establish hardware performance.

## Files changed for output ownership

- `index.html`, `src/entry.js`, `src/output.js`, `src/main.js`, `src/styles.css`
- `src/ui/output-controller.js`
- `src/engine/remote-transport.js`, `src/engine/engine-session.js`, `src/engine/local-transport.js`, `src/engine/protocol.js`
- `src/engine/engine.js`, `src/engine/audio.js`, `src/engine/renderer.js`, `src/engine/sequencer.js`, `src/engine/effects.js`
- `src/audio-input.js`, `src/library/runtime.js`, `src/motion-effects.js`, `src/particle-lifecycle.js`
- `test/remote-transport.test.js`, `test/engine-protocol.test.js`, `test/engine-sequencer.test.js`, `test/engine-app.html`, `test/motion-app.html`, `test/library-runtime.test.js`, `test/motion-effects.test.js`, `test/particle-lifecycle.test.js`
- `AGENTS.md`, `docs/engine-refactor.md`

## Step three: preview and resilience

The output host owns the engine for its entire lifetime, independently of MessagePorts. Controller pagehide detaches only; it never closes output or disposes its engine. Reload discovery uses BroadcastChannel only to announce the stored random nonce. Output answers through its same-origin opener, which establishes a new MessageChannel. The host keeps command configuration and the latest full engine snapshot. Reattachment adopts those into the UI and its replay journal without sending commands back to the running engine. Audio Blobs are retained for an explicit later local takeover.

The host allows at most one unacknowledged status message, retaining the latest snapshot while a controller is busy. RemoteTransport checks heartbeats every 500 ms with a 2 s timeout; delayed controller timers receive a fresh grace period before declaring failure. Pagehide sends an immediate close notice. Outstanding commands reject with an acknowledgement-uncertain message; new commands while disconnected reject with an actionable visible message. Reopen replaces the old output; Use this window explicitly resumes locally. Neither failure path silently starts a second audio graph.

Preview includes WebGL, particles and blackout, copied in the output draw callback to an output-owned 2D canvas. Control obtains that canvas through the same-origin window reference and calls captureStream(30) for a muted video. Unsupported capture falls back to ImageBitmap at 4 fps, with every bitmap closed. Hidden or disabled preview stops tracks and output copies. It does not change engine rendering or audio. Transport diagnostics report heartbeat age and last acknowledged command round-trip time.

### Additional files changed in step three

- `index.html`, `src/main.js`, `src/output.js`, `src/styles.css`
- `src/engine/engine.js`, `src/engine/engine-session.js`, `src/engine/remote-transport.js`
- `src/ui/output-controller.js`, `src/ui/output-preview.js`
- `test/remote-transport.test.js`, `test/engine-app.html`
- `AGENTS.md`, `README.md`, `docs/engine-refactor.md`

### Resilience manual checklist

- [ ] Preview visible and synchronized, including particles, blackout, resizing and source aspect ratio; toggle off/on.
- [ ] Hide control: preview stops; reveal it: preview resumes. Test fallback in a browser without canvas stream capture.
- [ ] Reload control during file playback and live input: output continues, UI restores selection, look/routing, controls, safety and playback position without reloading the engine.
- [ ] Close control: output keeps playing; exercise local B/P and fullscreen.
- [ ] Close output: Output disconnected notice, no automatic playback locally; try a command and verify visible rejection.
- [ ] Reopen output; click to start. Separately choose Use this window and verify local takeover.
- [ ] Kill the output renderer process: heartbeat timeout shows disconnection; reopen and restore.
- [ ] Run both windows for 30 minutes with file/video media, live edits and transitions; monitor heartbeat/RTT, memory, tracks, FPS and GPU/CPU on the actual performance laptop.

Automated smoke coverage includes real two-window reload and controller close, preview capture and forced bitmap fallback, visibility suspension, authoritative controls/look adoption, disconnect error and explicit local takeover. Fake-port tests cover dropped heartbeat, ordered reconnection and bounded status queues. These checks do not substitute for the 30-minute hardware soak or an OS-level renderer kill.
