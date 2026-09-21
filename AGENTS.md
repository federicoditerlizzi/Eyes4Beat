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
- `src/shaders.js` owns the WebGL2 shader sources.
- `src/custom-archetypes.js` persists user-created archetypes and image/video blobs in IndexedDB.
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
9. `frame(now)` advances or freezes image sequencing according to PANIC, sends the safe target state to GLSL, draws a full-screen triangle, updates the 2D particle canvas, broadcasts Show state, and refreshes diagnostics.

The two rendering layers are:

- WebGL2 canvas `#gl`: image sampling, crossfades, UV warp/parallax, grading, glow, saturation, luminance, zoom, pulse, and vignette.
- Canvas 2D `#particles`: archetype-specific particle motion composited over WebGL.

## Show output architecture

`?show=1` starts a clean output window in which `.ui` is hidden and audio analysis/mapping/image sequencing are disabled. The controller remains authoritative and broadcasts `FinalG`, effective musical state, archetype transition state and image sequence snapshots over `eyesforbeats-show-v1`. The Show renderer keeps its own WebGL context, loads built-in or IndexedDB media into its own texture slots and applies the received state. Do not make the Show window analyze or play audio: that would introduce drift and duplicate sound output. `library-changed` reloads the Show window after a custom archetype is created.

Controller-only live shortcuts are resolved in `src/shortcuts.js`: number-row direct archetype selection, arrows or A/D archetype navigation, Alt/Option plus the same number/navigation keys for presets, S/C transition mode and `?` help. They must stay disabled for repeated keydown events, editable controls, open dialogs and Show mode. Archetype loading is serialized in `selectArchetype()` so rapid commands resolve to the latest queued selection without racing GPU texture uploads.

BLACKOUT and PANIC are latched live-safety controls. BLACKOUT is a DOM overlay independent of WebGL; PANIC uses the pure `src/show-safety.js` calculation to override routed targets without mutating configuration. While PANIC is active, archetype transitions resolve immediately and `updateImageSequence()` only finishes an already-running crossfade. B/P shortcuts follow the same typing, dialog, repeat and Show-mode guards as the other controller shortcuts. The controller broadcasts its blackout state and already-safe `FinalG` to an existing Show peer; no separate audio or safety calculation runs there.

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
- Every target has an intensity (`globalCtl`) and musical reactivity (`globalAuto`). They multiply the routed signal rather than adding autonomous animation.
- Per-archetype routing maps connect 10 sources to 7 targets. Weights range from -1.5 to +1.5.
- Routing uses raw normalized source values plus a square-root response curve so quieter signals remain visible. Beat, kick, and snare are event-like values. Negative weights invert unipolar effects and move bipolar targets below neutral.
- Resulting `FinalG` targets are `pulse`, `dist`, `luma`, `sat`, `glow`, `parts`, and `zoom`. Their neutral state is pulse/distortion/glow/particles = 0 and luminance/saturation/zoom = 1.
- If the selected input is inactive, all sources are disabled, routing is zero, or target intensity/reactivity is zero, the corresponding musical effect is neutral. FILE is active only during playback; LIVE is active only while its stream track is live. Image timers and crossfades remain independent.
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

Users can create additional archetypes from the footer action. A custom archetype contains a name, one or more image/video blobs, and a `templateIndex` selecting one built-in visual language. Videos are muted, looped and uploaded into the same live WebGL texture slots as still images. The template provides shader and particle interpretation only; the custom archetype receives its own routing, media sequence configuration and musical preset list.

The creator can also generate still-image sequences through `/api/generate-image`, a Cloudflare Pages Function that calls OpenAI with the server-side `OPENAI_API_KEY`. The endpoint generates one bounded 1536×1024 WebP per request; the client calls it sequentially to expose progress and limit response size. Generated images become ordinary `File` objects and remain in local IndexedDB. They are not currently shared across browsers or stored in R2/D1.

When animation-sequence mode is enabled, frame one uses the generations endpoint and later keyframes use the edits endpoint with the previous generated frame. Loop mode additionally supplies frame one as a reference and changes the sequence prompt so the final state continues naturally into the origin. The internal request flag remains `stopMotion` for compatibility. Without animation-sequence mode enabled, neither the animation prompt nor image references are used.

`current` is the rendered source archetype and `target` is the selected destination. In smooth mode the shader blends them over 6.5 seconds using `archMix`; cut mode changes immediately. Image crossfades within an archetype are independent of archetype transitions.

The `behavior` object currently affects particle quantity/motion; several fields (`warp`, `zoom`, `pan`, `glow`, `pulse`, `dir`) are descriptive or only partially consumed because much of the archetype behavior is hard-coded in GLSL conditionals.

## Image sequencing

`IMAGE_SETS` contains public asset paths for built-ins and object URLs for custom IndexedDB blobs. Image counts are variable. `imageConfigs` stores:

- sequence mode: `auto`, `manual`, or `mapped`;
- mapped source;
- crossfade duration and event threshold;
- per-image enabled state, dwell duration, and playback order.

Auto mode advances after the current image's dwell time. Mapped continuous sources choose a position from low to high. Mapped beat/kick/snare sources advance on a rising-edge threshold with a minimum dwell. Each active archetype uses two GPU texture slots for the current and next image; `seqStates` tracks loading and crossfade state.

## Persistence and compatibility

Routing maps, image-manager settings, and named per-archetype musical presets persist via `localStorage`:

- current keys: `arv_v043_routing_maps`, `arv_v043_image_configs`;
- musical presets: `arv_v044_music_presets` (source controls, target intensity/reactivity, PERF/CTX, global reactivity, and routing; never image sequencing);
- fallback migration keys: routing `v042`/`v041`, images `v042b`/`v042`.
- audio input device: `eyes4beat_input_device`;
- per-input analysis trim: `eyes4beat_input_trim`;
- per-input noise-floor profiles: `eyes4beat_input_calibrations`.

Most other UI settings reset on reload. Persistence is origin-specific, so `file://`, `localhost`, and a deployed host do not share configuration. If the schema changes, add normalization/migration rather than assuming saved data has the new shape.

## Renderer texture model

The renderer uses four fragment samplers: current A/B and target A/B. Only the two archetypes involved in a transition occupy GPU texture slots, so the number of user-created archetypes is no longer constrained by `MAX_TEXTURE_IMAGE_UNITS`. Custom archetypes send their built-in `templateIndex` to the shader and particle renderer while retaining their own image sequence.

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
- Built-in visual languages still require shader/particle work. User-created archetypes should go through the creator flow and use a built-in `templateIndex`; do not add permanent texture samplers.
- When changing audio heuristics, test with quiet, dense, transient-heavy, and beatless material; a change that looks good on one track can destabilize another.
- Preserve the separation between slow contextual motion and fast rhythmic accents: the code intentionally prevents micro-transients from driving the whole visual world.
- Check `git diff --stat` after edits and keep functional changes focused.

## Global UI style guide

- Header utility actions use compact, borderless icon-only controls. Do not add boxed text buttons to the header unless a specific product requirement calls for an exception.
- BLACKOUT, PANIC and AUDIO INPUT follow the same icon-only header pattern. Their active states must remain unmistakable through color, glow and the persistent safety badge rather than a permanent button outline.
- Panels, pages and dialogs use a borderless `×` icon for their close action. Keep text actions such as Create, Apply or Reset only when the wording represents a distinct decision, not merely dismissal.
- Every button must expose a useful hover tooltip. Icon-only actions require both an accessible `aria-label` and a visible `data-tooltip`; text buttons receive a native title fallback at runtime. Tooltips must describe the action, not the glyph.
- Reuse the global `.iconAction`, `.headerIcon` and `.closeAction` patterns. The preset action toolbar is the visual reference for compact utility controls.

## Suggested refactor path

Without changing behavior, a practical next sequence is:

1. Continue extracting `src/main.js` into audio analysis, persistence, image sequencing, renderer, particles and UI controllers.
2. Add browser-level smoke tests for WebGL initialization, archetype switching and repeated audio loads.
3. Add import/export of performance presets so configuration is portable across origins and machines.

Keep the single-file build available if portability for live performance remains a core goal; it can become a generated distribution artifact rather than the editable source.
