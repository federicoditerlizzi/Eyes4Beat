# Eyes4Beat — AI agent context

## Product intent

Eyes4Beat is a browser-based visual instrument for live music performances. It analyzes a locally loaded audio file or live audio input in real time and turns musical features into animated image treatments, particles, color/light changes, distortion, zoom, and rhythm accents. The current artifact is a prototype intended to be performed from a full-screen browser rather than a conventional multi-page web application.

## Repository status

- The maintained application is a Vite-powered vanilla JavaScript module project.
- `index.html` is the application shell and `src/styles.css` owns presentation.
- `src/main.js` orchestrates the UI, audio analysis, sequencing and render frame.
- `src/config.js` owns archetypes, image paths, routing labels and defaults.
- `src/routing.js` is the pure, tested source-to-target calculation module.
- `src/audio-input.js` owns the Web Audio graph, live capture, device enumeration and source switching.
- `src/input-calibration.js` owns pure trim, meter and noise-floor math.
- `src/transitions.js` is the single source of truth for media-transition ids, shader ids, labels, parameters and generated GLSL defines.
- `src/image-sequencer.js` owns pure easing, effective-duration, trigger classification, transition-pool and sequence-order selection, beat-time conversion/quantization, latest-pending resolution and image-config normalization/migration logic.
- `src/shaders.js` owns the WebGL2 shader sources.
- `src/custom-archetypes.js` persists user-created archetypes and image/video blobs in IndexedDB.
- `src/package-format.js` builds and validates versioned ZIP library backups with SHA-256 media deduplication; it does not import or mutate app data.
- `src/looks.js` owns per-archetype look normalization, six factory presets, shader uniforms and pure particle movement.
- `public/assets/images/` contains the 30 visual source images.
- `test/routing.test.js` covers essential routing invariants.
- `legacy/index_v044.html` is an archived reference, not the maintained entry point.

## Running and verifying

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

Run routing tests and create the production bundle with:

```sh
npm test
npm run build
```

Load an audio file through **LOAD AUDIO**; the app uses a blob URL and does not upload it. Audio playback must begin after user interaction because of browser autoplay rules.

## Architecture and runtime flow

Everything runs on the main browser thread:

1. The user selects either a local file in the hidden `<audio>` element or a live `MediaStream` audio input.
2. `AudioInputController` lazily creates/resumes an interactive-latency `AudioContext` and switches sources without recreating the shared analysis path.
3. Both sources feed `trimGain → AnalyserNode → silent pull gain → destination`. In FILE mode the media element source also feeds the destination for normal playback; in LIVE mode no audible route is created.
4. `analyze(now)` samples frequency and time-domain data at roughly 25 Hz, updates the post-trim meter, collects calibration samples when requested, then applies spectral and RMS noise-floor subtraction before the existing heuristics.
5. Musical state is represented at three time scales:
   - `Raw`: instantaneous measurements.
   - `Fast`: smoothed performance response (roughly 0.3–1 s).
   - `Context`: rolling phrase-level averages (3–15 s depending on feature).
6. The PERF/CTX slider blends `Fast` and `Context` into `S`.
7. `getEffectiveState()` applies each continuous source's enable/solo state and amount; Beat, Kick, and Snare have the same source controls in the routing stage.
8. `computeGlobalMapping()` routes sources through the current archetype's matrix only while `inputActive` is true: FILE requires active playback, LIVE requires a live stream track. `frame(now)` then passes the routed result through `applyPanicTargets()` before assigning the shader-facing `FinalG` controls.
9. `frame(now)` advances or freezes image sequencing according to PANIC, classifying automatic requests as timed or event triggers. Auto scheduling uses either seconds or a beat-grid deadline fixed after the previous change; it never follows tempo wobble frame by frame. Manual controls enter the same sequencer with the manual trigger class. It eases any active media-transition progress in JavaScript, sends the safe target and per-role transition state to GLSL, draws a full-screen triangle, updates the 2D particle canvas, broadcasts Show state, and refreshes diagnostics.

The two rendering layers are:

- WebGL2 canvas `#gl`: image sampling, configurable media transitions, UV warp/parallax, grading, glow, saturation, luminance, zoom, pulse, and vignette.
- Canvas 2D `#particles`: archetype-specific particle motion composited over WebGL.

## Show output architecture

`?show=1` starts a clean output window in which `.ui` is hidden and audio analysis/mapping/automatic image sequencing are disabled. The controller remains authoritative and broadcasts `FinalG`, effective musical state, archetype transition state and image sequence snapshots over `eyesforbeats-show-v1`. Media changes additionally send a `transition-start` event; the Show window loads its own destination slot and starts its local transition clock only when that load finishes. Periodic snapshots can reconstruct a missed start event but do not drive blend frame by frame. The Show renderer keeps its own WebGL context, loads built-in or IndexedDB media into its own texture slots and applies the received state. Do not make the Show window analyze or play audio: that would introduce drift and duplicate sound output. `library-changed` reloads the Show window after a custom archetype is created.

Controller-only live shortcuts are resolved in `src/shortcuts.js`: number-row direct archetype selection, arrows or A/D archetype navigation, Alt/Option plus the same number/navigation keys for presets, S/C transition mode and `?` help. They must stay disabled for repeated keydown events, editable controls, open dialogs and Show mode. Archetype loading is serialized in `selectArchetype()` so rapid commands resolve to the latest queued selection without racing GPU texture uploads.
Keep live shortcuts available while the Image Manager is open, but not when focus is in an editable control. Automatic media changes must update only its runtime status/current-card styling, not rebuild form controls: replacing a focused input during a performance steals focus and can turn numeric editing into an archetype shortcut.

BLACKOUT and PANIC are latched live-safety controls. BLACKOUT is a DOM overlay independent of WebGL; PANIC uses the pure `src/show-safety.js` calculation to override routed targets without mutating configuration. While PANIC is active, archetype transitions resolve immediately and `updateImageSequence()` only finishes an already-running media transition. B/P shortcuts follow the same typing, dialog, repeat and Show-mode guards as the other controller shortcuts. The controller broadcasts its blackout state and already-safe `FinalG` to an existing Show peer; no separate audio or safety calculation runs there.

## Musical feature model

Continuous sources exposed to the UI and routing matrix:

- `energy`: RMS-derived loudness.
- `density`: broadband/mid-band spectral occupancy.
- `drive`: transient flux plus low-frequency presence with memory.
- `boombap`: groove confidence derived from BPM confidence, percussive activity, and drive; it is not BPM itself.
- `tension`: brightness, transient flux, and mid-vs-low balance.
- `bright`: high-frequency emphasis relative to low frequencies.
- `open`: inverse-ish combination of density/tension with some brightness.

Rhythmic/event sources:

- `KickFast`: short envelope from low-band transient/presence.
- `SnareFast`: short envelope from mid/high transient/presence.
- `BeatPulse`: exponential pulse driven by the estimated beat clock.
- `BPM` and `BPMConfidence`: lightweight autocorrelation over a 12-second onset history, searching 65–155 BPM and recalculating about once per second.

Treat these as perceptual heuristics, not production-grade source separation or beat tracking.

## Control and modulation model

- Source On/Off, Amount, and Solo live in `modState` plus the `amt-*` inputs.
- Every target has On/Solo (`targetState`), intensity (`globalCtl`) and musical reactivity (`globalAuto`). On/Solo gates the target independently of the source controls; intensity and reactivity multiply the routed signal rather than adding autonomous animation. Any target Solo isolates the soloed targets, as in the source panel.
- Per-archetype routing maps connect 10 sources to 10 targets. Weights range from -1.5 to +1.5. Existing maps/presets without rotation, spiral or tile shuffle receive the new default connections without changing their old weights; those three intensity sliders default to zero.
- Routing uses raw normalized source values plus a square-root response curve so quieter signals remain visible. Beat, kick, and snare are event-like values. Negative weights invert unipolar effects and move bipolar targets below neutral.
- Resulting `FinalG` targets are `pulse`, `dist`, `luma`, `sat`, `glow`, `parts`, `zoom`, `rotate`, `spiral` and `tiles`. Their neutral state is pulse/distortion/glow/particles/rotation/spiral/tile shuffle = 0 and luminance/saturation/zoom = 1. Rotation and spiral transform image UVs; tile shuffle permutes a fixed 12×8 grid in the fragment shader, with no extra textures or CPU-side media work.
- If the selected input is inactive, all sources are disabled, routing is zero, or target intensity/reactivity is zero, the corresponding musical effect is neutral. FILE is active only during playback; LIVE is active only while its stream track is live. Image timers and media transitions remain independent.
- Beat, Kick, and Snare are regular routable sources with On, Solo, and Amount controls; there is no hidden rhythm-to-shader path.
- Reactivity is a coarse low/medium/high multiplier sent to both rendering layers.

## Archetypes and transitions

The app ships with six built-in archetypes:

1. Deep Drift
2. Funk Elastic
3. Organic Bloom
4. Dense Propulsion
5. Heart Pulse
6. Cyber Heart

An archetype is a purely visual world: its image sequence, chromatic identity, shader interpretation of each target, and particle vocabulary. It must not decide which musical feature drives a target. Musical behavior belongs to the routing matrix and named musical presets. Different archetypes may interpret the same target differently (for example bubbles, streaks, or geometric particles), but target intensity and reactivity remain user-controlled.

Users can create additional archetypes from the footer action. A custom archetype contains a name and one or more image/video blobs. **Start from Blank** creates a neutral look with empty routing; a factory preset seeds the look, routing and image config of the corresponding original profile. Existing customs retain `templateIndex` for migration/defaults only. Videos are muted, looped and uploaded into the same live WebGL texture slots as still images. Every custom archetype receives its own routing, media sequence configuration and musical preset list.
Only custom archetypes expose a trash action in the footer. After confirmation, deletion removes their IndexedDB record, object URLs and matching index in each parallel runtime/persistence array (routing maps, image configs, sequence states and music presets). If the deleted archetype is active, both renderer roles switch to built-in Deep Drift first; Show peers reload their library. Never leave the arrays out of alignment or offer deletion for built-ins.

The creator can also generate still-image sequences through `/api/generate-image`, a Cloudflare Pages Function that calls OpenAI with the server-side `OPENAI_API_KEY`. The endpoint generates one bounded 1536×1024 WebP per request; the client calls it sequentially to expose progress and limit response size. Generated images become ordinary `File` objects and remain in local IndexedDB. They are not currently shared across browsers or stored in R2/D1.

When animation-sequence mode is enabled, frame one uses the generations endpoint and later keyframes use the edits endpoint with the previous generated frame. Loop mode additionally supplies frame one as a reference and changes the sequence prompt so the final state continues naturally into the origin. The internal request flag remains `stopMotion` for compatibility. Without animation-sequence mode enabled, neither the animation prompt nor image references are used.

`current` is the rendered source archetype and `target` is the selected destination. In smooth mode the shader blends them over 6.5 seconds using `archMix`; cut mode changes immediately. That system is unchanged and separate from configurable media transitions within an archetype. The shader transition function is nevertheless role-based so the same library can be reused for archetype transitions later.

Per-archetype looks in `src/looks.js` replace the old `behavior` object and profile branches. The six factory looks preserve their original distortion, grading and particle constants. The LOOK editor applies changes live and persists them under `arv_v047_looks`; loading a factory or Blank preset overwrites only the current look after confirmation. Shader roles each receive warp and grading uniforms, while particles use the target archetype's look. Musical routing remains independent; an empty routing map triggers a LOOK-panel warning.

## Image sequencing

`IMAGE_SETS` contains public asset paths for built-ins and object URLs for custom IndexedDB blobs. Image counts are variable. Version 3 of the `imageConfigs` schema stores:

- sequence mode: `auto`, `manual`, or `mapped`;
- sequence order: `sequential`, `ping-pong`, `random-no-repeat`, or `shuffle`;
- time base: `seconds` or `beats`;
- mapped source;
- timed, event and manual transition pools, each with transition ids, cycle or random-no-repeat selection, seconds and beat durations, easing and wipe direction;
- mapped-event threshold;
- per-image enabled state, seconds and beat dwell duration, and playback order.

Auto mode advances after the current image's dwell time and uses the timed pool. In beat mode, dwell is promoted to a power-of-two beat count when necessary to preserve the two-second minimum, then the request is quantized against `beatAnchorSec`; tempo selection is reliable BPM, last reliable BPM, then 120. Mapped continuous sources choose a position from low to high and also use timed without applying order modes; mapped beat/kick/snare sources advance on a rising-edge threshold with their existing minimum dwell and use event. Buttons and `[`/`]` shortcuts use manual and bypass dwell. Sequence order applies to auto, mapped events and manual navigation; random/shuffle PREV traverses shown history. Each active archetype uses two GPU texture slots for the current and next image; `seqStates` tracks loading, transition metadata, order/history state, fixed auto deadline, last reliable tempo, per-pool pick state and locally eased progress. Destination media remains loaded on demand inside `requestImageChange()`. A request during a transition completes it before starting the new change; during loading, one latest-wins pending request is retained. PANIC blocks new advances while allowing an already-started transition to finish. Show mode does not schedule: it continues to follow controller transition-start messages.

## Persistence and compatibility

Routing maps, image-manager settings, and named per-archetype musical presets persist via `localStorage`:

- current keys: `arv_v043_routing_maps`, `arv_v045_image_configs` (an object containing `schemaVersion` and `configs`);
- musical presets: `arv_v044_music_presets` (source controls, target On/Solo/intensity/reactivity, PERF/CTX, global reactivity, and routing; never image sequencing). Presets saved before target On/Solo existed default to all targets enabled and no solos;
- fallback migration keys: routing `v042`/`v041`, images `v043`/`v042b`/`v042`. Phase-2 configs migrate to seconds plus sequential order without changing their existing dwell or transition values. Phase-1 single-transition values migrate into the timed pool with unchanged settings; event defaults to cut and manual to crossfade. Older `crossfade` values first become the equivalent timed crossfade with the same duration and linear easing.
- audio input device: `eyes4beat_input_device`;
- per-input analysis trim: `eyes4beat_input_trim`;
- per-input noise-floor profiles: `eyes4beat_input_calibrations`.
- per-archetype visual looks: `arv_v047_looks`, aligned with the runtime archetype list. Missing entries migrate from built-in index or custom `templateIndex`; Blank customs use the neutral look.

Most other UI settings reset on reload. Persistence is origin-specific, so `file://`, `localhost`, and a deployed host do not share configuration. If the schema changes, add normalization/migration rather than assuming saved data has the new shape.

## Library package v2

The archetype footer offers **EXPORT LIBRARY** and read-only **VERIFY PACKAGE**. Export snapshots each currently loaded archetype's normalized in-memory look, routing, image config and musical presets, plus legacy profile metadata and ordered media. Built-in files come from their asset URLs; custom Blobs come from IndexedDB. `src/package-format.js` writes `manifest.json` (`format: eyes4beat-package`, `formatVersion: 2`, `kind: legacy-library`), deduplicated uncompressed `media/<sha256>.<ext>` entries, and `raw/local-storage.json` containing keys beginning `arv_` or `eyes4beat`. Verification accepts legacy version 1 (without looks) and version 2. The ZIP is named `eyes4beat-library-YYYYMMDD-HHMM.zip`. There is no import path in this phase. Browser origins do not share data: back up each browser/computer separately before migration.

## Renderer texture model

The renderer uses four fragment samplers: current A/B and target A/B. Only the two archetypes involved in a transition occupy GPU texture slots, so the number of user-created archetypes is no longer constrained by `MAX_TEXTURE_IMAGE_UNITS`. Each role sends its own look uniforms to the shader; particle motion uses the target look. No profile integer is sent to rendering.

## Other risks and constraints

- Shader compilation, program linking and required texture units are checked during startup. A user-facing recovery screen is still desirable for live use.
- Audio analysis, DOM diagnostics, texture management, WebGL, and particles all share the main thread. Profile frame time on the actual performance machine.
- The WebGL render resolution is fixed at 78% of the viewport, while particles use full viewport resolution.
- Audio object URLs are revoked when replacing a file. The media-element source and shared trim/analyser path are created only once; leaving LIVE stops all stream tracks, and switching sources resets beat/BPM state.
- Fullscreen requests can reject and currently have no error handling.
- `src/main.js` still contains several runtime concerns; future extraction should prioritize audio analysis, persistence, image sequencing, renderer and UI controllers.
- UI becomes reduced below 900 px: diagnostics and the modulation lab are hidden. This is primarily a desktop performance UI.
- Pure routing invariants are covered by `test/routing.test.js`. Browser regression verification is still manual and should cover console errors, repeated audio loads, built-in/custom archetypes, both transition modes, variable-length image sequences, persistence after reload, routing reset/zero, fullscreen, and sustained playback.

## Safe editing guidance for future agents

- Work in the maintained Vite sources, not `legacy/index_v044.html`.
- Prefer targeted reads and small patches around the relevant JavaScript functions.
- Use `rg -n` to locate symbols, then patch the smallest possible region.
- Avoid unrelated full-file formatting so functional changes remain easy to review.
- Keep musical state names and routing keys stable unless a localStorage migration accompanies the rename.
- Extend visual language through the per-archetype look model. User-created archetypes should go through the creator flow; do not add permanent texture samplers.
- When changing audio heuristics, test with quiet, dense, transient-heavy, and beatless material; a change that looks good on one track can destabilize another.
- Preserve the separation between slow contextual motion and fast rhythmic accents: the code intentionally prevents micro-transients from driving the whole visual world.
- Check `git diff --stat` after edits and keep functional changes focused.

## Global UI style guide

- Header utility actions use compact, borderless icon-only controls. Do not add boxed text buttons to the header unless a specific product requirement calls for an exception.
- BLACKOUT, PANIC and AUDIO INPUT follow the same icon-only header pattern. Their active states must remain unmistakable through color, glow and the persistent safety badge rather than a permanent button outline.
- Panels, pages and dialogs use a borderless `×` icon for their close action. Keep text actions such as Create, Apply or Reset only when the wording represents a distinct decision, not merely dismissal.
- Every button must expose a useful hover tooltip. Icon-only actions require both an accessible `aria-label` and a visible `data-tooltip`; text buttons receive a native title fallback at runtime. Tooltips must describe the action, not the glyph.
- Reuse the global `.iconAction`, `.headerIcon` and `.closeAction` patterns. The preset action toolbar is the visual reference for compact utility controls.
- Use Lucide for all interface icons; do not introduce Unicode glyphs or emoji as controls. Static icons use `<i data-lucide="…">` and are initialized through the explicit subset in `src/icons.js`; runtime-generated markup uses its `icon(name)` helper. Icon-only buttons always retain an explicit action-oriented `aria-label` and tooltip.

## Suggested refactor path

Without changing behavior, a practical next sequence is:

1. Continue extracting `src/main.js` into audio analysis, persistence, image sequencing, renderer, particles and UI controllers.
2. Add browser-level smoke tests for WebGL initialization, archetype switching and repeated audio loads.
3. Add import/export of performance presets so configuration is portable across origins and machines.

Keep the single-file build available if portability for live performance remains a core goal; it can become a generated distribution artifact rather than the editable source.
