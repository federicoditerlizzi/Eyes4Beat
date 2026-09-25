# Eyes4Beat — AI agent context

## Product intent

Eyes4Beat is a browser-based visual instrument for live music performances. It analyzes a locally loaded audio file or live audio input in real time and turns musical features into animated image treatments, particles, color/light changes, distortion, zoom, and rhythm accents. The current artifact is a prototype intended to be performed from a full-screen browser rather than a conventional multi-page web application.

## Repository status

- The maintained application is a Vite-powered vanilla JavaScript module project.
- `index.html` is the application shell and `src/styles.css` owns presentation.
- `src/main.js` orchestrates the UI, audio analysis, sequencing and render frame.
- `src/config.js` owns routing sources, targets, labels and the blank map; it no longer defines the runtime library.
- `src/routing.js` is the pure, tested source-to-target calculation module.
- `src/audio-input.js` owns the Web Audio graph, live capture, device enumeration and source switching.
- `src/input-calibration.js` owns pure trim, meter and noise-floor math.
- `src/transitions.js` is the single source of truth for media-transition ids, shader ids, labels, parameters and generated GLSL defines.
- `src/image-sequencer.js` owns pure easing, effective-duration, trigger classification, transition-pool and sequence-order selection, beat-time conversion/quantization, latest-pending resolution and image-config normalization/migration logic.
- `src/shaders.js` owns the WebGL2 shader sources.
- `src/library/local-repository.js` owns all active library IndexedDB access; `src/library/runtime.js` builds renderer arrays by project order and resolves ID-based Show messages; `src/library/package-mapping.js` normalizes imported archetypes.
- `src/legacy/` and `src/custom-archetypes.js` read the old library only for export. `public/assets/images/` contains the 30 legacy built-in images.
- `src/package-format.js` builds, reads and verifies ZIP packages with SHA-256 media deduplication.
- `src/looks.js` owns look normalization, six factory looks with starter routing/image source, shader uniforms and pure particle movement.
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

Rendering and UI run on the main browser thread; audio feature extraction runs at audio rate in an `AudioWorklet`:

1. The user selects either a local file in the hidden `<audio>` element or a live `MediaStream` audio input.
2. `AudioInputController` lazily creates/resumes an interactive-latency `AudioContext` and switches sources without recreating the shared analysis path.
3. Both sources feed `trimGain → AudioWorkletNode → silent pull gain → destination`. In FILE mode the media element source also feeds the destination for normal playback; in LIVE mode no audible route is created. AudioWorklet support is mandatory and failure is shown explicitly.
4. `src/analysis/worklet.js` feeds raw mono PCM to the pure `AnalysisEngine` using a 2048-sample Hann window and 512-sample hop. Analysis and Fast/Context updates retain the hop cadence (about 94 Hz at 48 kHz); compact transferable feature snapshots are coalesced to about 50 Hz with ordered timestamped event batches. `frame(now)` only reads the most recent result. Calibration removes RMS power and per-bin spectral power before detectors and normalization; every calibration hop contributes to power sums, including the final partial batch. Spectra and diagnostic extras otherwise cross to the main thread only while diagnostics are visible, at most 10 Hz.
5. Musical state is represented at three time scales:
   - `Raw`: instantaneous measurements.
   - `Fast`: smoothed performance response (roughly 0.3–1 s).
   - `Context`: rolling phrase-level averages (3–15 s depending on feature).
6. The PERF/CTX slider blends `Fast` and `Context` into `S`.
7. `getEffectiveState()` applies each continuous source's enable/solo state and amount; Beat, Kick, and Snare have the same source controls in the routing stage.
8. `computeGlobalMapping()` routes sources through the current archetype's matrix only while `inputActive` is true: FILE requires active playback, LIVE requires a live stream track. `frame(now)` then passes the routed result through `applyPanicTargets()` before assigning the shader-facing `FinalG` controls.
9. Opening a project reads ordered archetypes through the repository and rebuilds parallel runtime arrays plus an ID/index map. `frame(now)` advances or freezes image sequencing according to PANIC, classifying automatic requests as timed or event triggers. Auto scheduling uses either seconds or a beat-grid deadline fixed after the previous change; it never follows tempo wobble frame by frame. Manual controls enter the same sequencer with the manual trigger class. It eases any active media-transition progress in JavaScript, sends the safe target and per-role transition state to GLSL, draws a full-screen triangle, updates the 2D particle canvas, broadcasts Show state, and refreshes diagnostics. Zero archetypes clear both canvases dark while analysis continues.

The analysis hot path owns reusable FFT plans, typed ring buffers, exact rolling order statistics and a borrowed feature object. Offline callers retaining frames must clone them. `layers.js` preserves the hop-domain Fast/Context formulas; `messages.js` defines the binary layout and event batching. Transfer ownership alternates between two buffers returned by `AudioInputController`; do not reuse detached buffers or allocate replacements when the UI is stalled. `load-monitor.js` measures a rolling quantum cost (millisecond clock fallback when necessary), then degrades 512→1024 hop and 2048→1024 FFT after sustained overload. All modes are preallocated and state migration is spread over quanta. Calibration holds one FFT resolution until its final acknowledgement. `scripts/analysis-benchmark.js` warms complete histories before testing time and heap; tests run serially to avoid contaminating the timing check.

Pure analysis lives under `src/analysis/`: radix-2 FFT, Hz-based power bands, onset/event detectors, adaptive normalizers, phase-locked tempo tracking and the engine. Bands are sub 20–60, bass 60–120, low-mid 120–400, mid 400–2000, high-mid 2–6 kHz, high 6–12 kHz and air 12 kHz–Nyquist. Levels and loudness are dBFS; formulas must not combine linear power with dB values. Tempo uses an 8-second onset history, interpolated autocorrelation over 60–200 BPM and gently corrected beat phase. Keep this module set free of DOM, Web Audio and timers so synthetic PCM tests remain deterministic.

The scene renderer now writes to an offscreen RGBA16F framebuffer when `EXT_color_buffer_float` is available (RGBA8 fallback). `src/bloom-renderer.js` owns a soft bright-pass, six-level half-resolution downsample/tent-upsample chain (low: three levels starting at quarter resolution), and final scene + tinted bloom, per-look vignette and highlight-only tone composite. `glow` drives bloom intensity plus `look.bloom.base`; zero effective intensity bypasses the entire bloom chain. `src/bloom.js` owns pure threshold, mip-size and look-blending helpers. Quality is device-local in `eyes4beat_bloom_quality` (off/low/high), shared with Show via storage events. Diagnostics show format, quality, FPS and asynchronous bloom GPU timing when supported. Resize and context restoration recreate render targets; restored media slots are re-uploaded. The GPU budget must be checked on the performance laptop.

The two rendering layers are:

- WebGL2 canvas `#gl`: image sampling, configurable media transitions, UV warp/parallax, grading, glow, saturation, luminance, zoom, pulse, and vignette.
- Canvas 2D `#particles`: archetype-specific particle motion composited over WebGL.

## Show output architecture

`?show=1` starts a clean output window in which `.ui` is hidden and audio analysis/mapping/automatic image sequencing are disabled. The controller remains authoritative and broadcasts active project ID, current/target archetype IDs, `FinalG`, effective musical state, transition state and image sequence snapshots over `eyesforbeats-show-v1`. Media changes additionally send a `transition-start` event; the Show window loads its own destination slot and starts its local transition clock only when that load finishes. Periodic snapshots can reconstruct a missed start event but do not drive blend frame by frame. The Show renderer keeps its own WebGL context and reads the same-origin local project/media records. `library-changed` reopens the active project after structural edits. Do not make Show analyze or play audio.

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
- Per-archetype routing maps assign at most one of 10 sources to each target. The full-screen target editor offers one source selector and amount per target; a source may drive multiple targets. Legacy maps, imports and resets keep the strongest absolute weight for each target (ties use routeSources order), preserving its sign. Weights range from -1.5 to +1.5. Existing maps/presets without rotation, spiral or tile shuffle receive the new default connections without changing their old weights; those three intensity sliders default to zero.
- Routing uses raw normalized source values plus a square-root response curve so quieter signals remain visible. Beat, kick, and snare are event-like values. Negative weights invert unipolar effects and move bipolar targets below neutral.
- Resulting `FinalG` targets are `pulse`, `dist`, `luma`, `sat`, `glow`, `parts`, `zoom`, `rotate`, `spiral` and `tiles`. Their neutral state is pulse/distortion/glow/particles/rotation/spiral/tile shuffle = 0 and luminance/saturation/zoom = 1. Rotation and spiral transform image UVs; tile shuffle permutes a fixed 12×8 grid in the fragment shader, with no extra textures or CPU-side media work.
- If the selected input is inactive, all sources are disabled, routing is zero, or target intensity/reactivity is zero, the corresponding musical effect is neutral. FILE is active only during playback; LIVE is active only while its stream track is live. Image timers and media transitions remain independent.
- Beat, Kick, and Snare are regular routable sources with On, Solo, and Amount controls; there is no hidden rhythm-to-shader path.
- Reactivity is a coarse low/medium/high multiplier sent to both rendering layers.

## Archetypes and transitions

The six former built-in archetypes now exist only as factory looks and legacy export assets:

1. Deep Drift
2. Funk Elastic
3. Organic Bloom
4. Dense Propulsion
5. Heart Pulse
6. Cyber Heart

An archetype is a purely visual world: its image sequence, chromatic identity, shader interpretation of each target, and particle vocabulary. It must not decide which musical feature drives a target. Musical behavior belongs to the routing matrix and named musical presets. Different archetypes may interpret the same target differently (for example bubbles, streaks, or geometric particles), but target intensity and reactivity remain user-controlled.

First launch starts with no projects; create one or import a package. A project orders its archetypes by stable UUID. The footer creator requires image/video media and offers Blank, a factory starter (look + routing + image source), or a project look preset (look only, empty routing). Videos are muted and looped in the same WebGL texture slots as images. Footer actions rename, duplicate, reorder and soft-delete any project archetype. Project switching rebuilds all parallel runtime arrays by ID, resets current/target/transition state and releases previous object URLs. A project with no archetypes renders dark. The legacy six assets remain available only through the export panel.

The creator can also generate still-image sequences through `/api/generate-image`, a Cloudflare Pages Function that calls OpenAI with the server-side `OPENAI_API_KEY`. The endpoint generates one bounded 1536×1024 WebP per request; the client calls it sequentially to expose progress and limit response size. Generated images become ordinary `File` objects and remain in local IndexedDB. They are not currently shared across browsers or stored in R2/D1.

When animation-sequence mode is enabled, frame one uses the generations endpoint and later keyframes use the edits endpoint with the previous generated frame. Loop mode additionally supplies frame one as a reference and changes the sequence prompt so the final state continues naturally into the origin. The internal request flag remains `stopMotion` for compatibility. Without animation-sequence mode enabled, neither the animation prompt nor image references are used.

`current` is the rendered source archetype and `target` is the selected destination. In smooth mode the shader blends them over 6.5 seconds using `archMix`; cut mode changes immediately. That system is unchanged and separate from configurable media transitions within an archetype. The shader transition function is nevertheless role-based so the same library can be reused for archetype transitions later.

Per-archetype looks in `src/looks.js` replace the old `behavior` object and profile branches. The six factory looks preserve their original distortion, grading and particle constants. The LOOK editor applies changes live and persists them in the archetype repository record; loading a factory, Blank or project preset overwrites only the current look after confirmation. Project look presets can be saved, renamed and soft-deleted. Shader roles each receive warp and grading uniforms, while particles use the target archetype's look. Musical routing remains independent; an empty routing map triggers a LOOK-panel warning.

## Image sequencing

Runtime `IMAGE_SETS` contains object URLs built from the active project's content-addressed IndexedDB media. Image counts are variable. Version 3 of the `imageConfigs` schema stores:

- sequence mode: `auto`, `manual`, or `mapped`;
- sequence order: `sequential`, `ping-pong`, `random-no-repeat`, or `shuffle`;
- time base: `seconds` or `beats`;
- mapped source;
- timed, event and manual transition pools, each with transition ids, cycle or random-no-repeat selection, seconds and beat durations, easing and wipe direction;
- mapped-event threshold;
- per-image enabled state, seconds and beat dwell duration, and playback order.

Auto mode advances after the current image's dwell time and uses the timed pool. In beat mode, dwell is promoted to a power-of-two beat count when necessary to preserve the two-second minimum, then the request is quantized against `beatAnchorSec`; tempo selection is reliable BPM, last reliable BPM, then 120. Mapped continuous sources choose a position from low to high and also use timed without applying order modes; mapped beat/kick/snare sources advance on a rising-edge threshold with their existing minimum dwell and use event. Buttons and `[`/`]` shortcuts use manual and bypass dwell. Sequence order applies to auto, mapped events and manual navigation; random/shuffle PREV traverses shown history. Each active archetype uses two GPU texture slots for the current and next image; `seqStates` tracks loading, transition metadata, order/history state, fixed auto deadline, last reliable tempo, per-pool pick state and locally eased progress. Destination media remains loaded on demand inside `requestImageChange()`. A request during a transition completes it before starting the new change; during loading, one latest-wins pending request is retained. PANIC blocks new advances while allowing an already-started transition to finish. Show mode does not schedule: it continues to follow controller transition-start messages.

## Persistence and compatibility

Phase 3 server storage lives in `functions/_lib/` with Pages routes under `functions/api/`. The D1 `DB` binding uses `migrations/0001_init.sql` and `0002_media_uploaders.sql`; R2 `MEDIA` stores `media/<sha256>`. Server rows use ISO timestamps, monotonically increasing versions, soft deletion and `updated_by`. Project reads are owner-or-shared; project contents can be edited by any reader; deletion and visibility are owner-only. Media reads require uploader ownership or a live archetype reference in a readable project; upload grants for deduplicated hashes are tracked separately. Composite D1 writes use `batch()` and guard checks to roll back stale versions. `/api/changes` includes tombstones and visibility-removal markers. The Access middleware verifies `Cf-Access-Jwt-Assertion` using cached JWKS, audience, issuer, expiry and `ALLOWED_EMAILS`; `DEV_USER_EMAIL` is accepted only on localhost/127.0.0.1.

Phase 4 client sync is implemented by `src/library/synced-repository.js`, which retains the `LibraryRepository` contract and reuses `LocalLibraryRepository` for per-user IndexedDB caches named `eyes4beat-cache-<email-hash>`. `src/library/api-client.js` is the HTTP boundary and `sync-logic.js` contains cursor/version/cache-key logic. The server is authoritative. Cache sync metadata stores cursor, durable dirty edits, conflicts and Live Lock deferred changes. Pull overlaps the cursor by ten seconds and applies only greater versions. Setting edits are local-first and debounced; structural operations and imports are network-first. Media upload uses HEAD/PUT before archetype creation and opening a project hydrates missing blobs for offline performance. Live Lock defers active-project remote records; Show mode reads the last user's cache but never calls the server. The old `eyes4beat-library` is only read by the one-time account migration and is never deleted. Legacy v1/v2 and project v3 package imports must remain unchanged.

All active library reads and writes use `LocalLibraryRepository` against IndexedDB `eyes4beat-library` (schema 1). Stores are `projects`, `archetypes`, `media`, `lookPresets`, and `meta`. Projects and archetypes have UUIDs, version/updatedAt fields and soft-deletion timestamps; media records are shared by SHA-256 and are not purged on deletion. `meta` remembers the last active project. Repository writes are serialized; operations that change an archetype and its project order (and project deletion/import) use one IndexedDB transaction. A versionchange event closes the old connection and asks the performer to reload. Look, routing, image config and music-preset edits are debounced about 500 ms and written by archetype ID. Failed edits remain queued with a visible Retry action; pagehide/hidden events trigger a best-effort flush. `src/library/repository.js` is the abstract boundary for a future remote implementation. The old `eyesforbeats/custom-archetypes` database and `arv_` localStorage keys remain untouched and are read only by legacy export.

Device-local settings remain in localStorage: `eyes4beat_input_device`, `eyes4beat_input_trim`, `eyes4beat_input_calibrations`, `eyesforbeats_footer_collapsed`, and `eyes4beat_project_last_exported` (per-project ISO dates). Startup requests `navigator.storage.persist()` when available and reports its result and `navigator.storage.estimate()` usage/quota in the project panel. Browser storage may still be cleared, so regular ZIP exports are necessary. Missing media records resolve to neutral placeholder sources rather than aborting project open; their archetypes appear in a non-blocking notice and missing slots are skipped by sequencing when valid media remain. Musical presets still contain source/target controls, routing, PERF/CTX and reactivity, but not image sequencing. Persistence is origin-specific; localhost and deployed hosts do not share the library.

## Library packages

`src/package-format.js` builds and verifies `eyes4beat-package` ZIPs with deduplicated uncompressed `media/<sha256>.<ext>` entries. Legacy-library v1/v2 packages remain supported; v1 looks derive from the stored profile. Project packages use version 3 and include project name, archetypes in project order, project look presets, all settings and `sourceIndex` on every media entry. `src/library/package-mapping.js` reconstructs source alignment for older packages lacking `sourceIndex` by the media order `(imageConfig.images[i].order, i)`. Import validates checksums before showing per-archetype selection and creates new IDs; `repository.importBatch()` commits project, selected archetypes, presets and media atomically, including imports into an existing project. It never mutates legacy storage. Legacy export can still package the old built-ins and old browser data, with `raw/local-storage.json` as a forensic snapshot. Use VERIFY PACKAGE for read-only checks. Browser origins do not share data; back up each origin separately.

## Motion effects and particles

`src/motion-effects.js` owns controller-side rotation velocity integration, direction/beat flips, rest easing, constant cover scale and four-slot hysteretic shockwave state. Angles use degrees in JavaScript and radians in GLSL; clocks use seconds. Per-role rotation and pulse uniforms apply before the shared texture fit. Breath follows the analysis beat phase when BPM is available. `sourceRegistry` in `src/config.js` marks event sources; burst selectors and normalization use `eventSourceIds()` rather than a hardcoded list.

`src/particle-lifecycle.js` owns particle age/life, release fades, bounded radial bursts with drag and normalized Show snapshots. Bursts consume ordered analysis events, respect source controls and the routed particles target, and never fire with that target at zero. `src/media-palette.js` extracts up to five colors from a 32×32 media sample once on load (the first decoded frame for video); palette entries follow texture-slot swaps. Particle CSS colors are reused; opacity uses `globalAlpha`. PANIC immediately clears rotation, waves and particles. Controller frames broadcast integrated rotation, wave starts/strengths, a shared visual clock/beat phase and compact authoritative particle snapshots. Show replays these states and does not detect events or integrate rotation independently.

## Renderer texture model

The renderer uses four fragment samplers: current A/B and target A/B. Only the two archetypes involved in a transition occupy GPU texture slots, so the number of user-created archetypes is no longer constrained by `MAX_TEXTURE_IMAGE_UNITS`. Each role sends its own look uniforms to the shader; particle motion uses the target look. No profile integer is sent to rendering.

## Other risks and constraints

- Shader compilation, program linking and required texture units are checked during startup. A user-facing recovery screen is still desirable for live use.
- FFT, detection, tempo and normalization run in the AudioWorklet; DOM diagnostics, texture management, WebGL and particles remain on the main thread. Profile both worklet and frame CPU on the actual performance machine.
- The WebGL render resolution is fixed at 78% of the viewport, while particles use full viewport resolution.
- Audio object URLs are revoked when replacing a file. The media-element source and shared trim/worklet path are created only once; leaving LIVE stops all stream tracks, and switching sources resets detector/beat/BPM state.
- Fullscreen requests can reject and currently have no error handling.
- `src/main.js` still contains several runtime concerns; future extraction should prioritize persistence, image sequencing, renderer and UI controllers.
- UI becomes reduced below 900 px: diagnostics and the modulation lab are hidden. This is primarily a desktop performance UI.
- Pure routing invariants are covered by `test/routing.test.js`. Browser regression verification is still manual and should cover console errors, repeated audio loads, built-in/custom archetypes, both transition modes, variable-length image sequences, persistence after reload, routing reset/zero, fullscreen, and sustained playback.

## Safe editing guidance for future agents

- Work in the maintained Vite sources, not `legacy/index_v044.html`.
- Prefer targeted reads and small patches around the relevant JavaScript functions.
- Use `rg -n` to locate symbols, then patch the smallest possible region.
- Avoid unrelated full-file formatting so functional changes remain easy to review.
- Keep musical state names and routing keys stable unless a repository/package migration accompanies the rename.
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
