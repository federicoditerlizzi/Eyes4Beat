# Kaleidoscope and feedback

Pipeline: scene → kaleidoscope → feedback → bloom → vignette/tone composite.
Both effects run in the active engine, including the output window, and leave the
Canvas2D particles unchanged. Zero effective values bypass their draw calls and
allocate no new render targets. Factory and older imported looks default to off.

Enable segments and Mix / Amount in LOOK to see effects without routing.
Kaleido uses `clamp(look.mix + routedKaleido, 0, 1)`; Trails adds to the base
amount through `clamp(base + routedTrails * (.98 - base), 0, .98)`.
New targets have no automatic routing assignments. During archetype transitions,
A's complete kaleido shape fades out over the first half, then B's fades in over
the second half. Discrete settings switch only at zero wet mix, even with routing.

Feedback retains `amount ** (dt * 60)` of the prior frame. Zoom, rotation, drift
and hue shift are specified per 60 Hz frame and scaled by elapsed time. `max`
keeps bright accents; `mix` (the default when unspecified) blends the current scene with transformed history.
Rotation is bounded to ±3 degrees/frame, zoom and drift to ±.01/frame, and hue
shift to 0–.01/frame. Feedback UVs mirror at every edge rather than filling black.
The first enabled frame seeds history directly from the scene. A bypass invalidates
history so re-enabling cannot resurrect old imagery. History textures use the same
RGBA16F / RGBA8 capability choice as bloom.

OUTPUT SETTINGS → Feedback is device-local, enabled by default, independently of
bloom quality. It is sent through the engine protocol, retained during handover,
and reflected in output snapshots. PANIC immediately clears history and gates both
passes. Project loads, resize/render-scale changes and context restoration discard
history. BLACKOUT still uses its independent overlay.

## Verification

- `npm test`: UV fold continuity (mirrored segment boundaries and midpoints),
  mirror/center/aspect/rotation, decay at 30/60/120 FPS, defaults/clamps/imports,
  relevance, routing gates, protocol and device settings.
- Open `/test/post-effects.html` in the Vite server: shader compilation, unchanged
  default pixels, lazy targets, combined passes, decay/clear, device bypass,
  mix/transform, bloom, resize and RGBA8 fallback with GL error checks.

Manual show-laptop checklist (still required):

- Compare all factory looks with defaults; images and transitions stay unchanged.
- With no routing, set six kaleido segments and Mix 1; check visible folding.
- With no routing, set feedback Amount above zero and blend mix on images.
- Route kick to Pulse and Trails and check the added response.
- Try tunnel feedback with zoom .005 and rotation .5 deg/frame.
- Transition between archetypes with different segment counts; no visible shape snap.
- Try six kaleido segments on images, videos, media and archetype transitions.
- PANIC removes trails immediately and both effects stay off until released.
- Resize, change render scale, switch project and restore a lost WebGL context;
  no old trail should reappear.
- Check the output window and preview match, including Feedback toggle/reconnect.
- Measure FPS at 1080p on the show laptop with bloom, feedback and kaleido enabled.
  The browser smoke test does not establish this GPU budget.

## Files changed

- `src/post-effects.js`: pure UV reference, decay and look blending.
- `src/bloom-renderer.js`: post shaders, lazy targets, ping-pong history and composite input.
- `src/engine/renderer.js`: pipeline integration, device toggle and resize cleanup.
- `src/engine/engine.js`: frame timing, PANIC and project cleanup, toggle command.
- `src/engine/protocol.js`: validated Feedback command.
- `src/engine/engine-session.js`: replay of the Feedback preference.
- `src/looks.js`: parameters, defaults, normalization and factory compatibility.
- `src/config.js`, `src/routing.js`: target registration, labels, neutral values and calculations.
- `src/output-settings.js`: device-local Feedback preference.
- `index.html`, `src/main.js`: target rows, setting controls and preset compatibility.
- `src/ui/look-editor.js`, `src/ui/control-relevance.js`: LOOK groups and relevance.
- `src/ui/engine-view.js`: snapshot-driven setting display.
- `test/post-effects.test.js`: pure post-effect regression tests.
- `test/post-effects.html`: browser GPU smoke test.
- `test/look-editor.test.js`, `test/output-settings.test.js`, `test/show-safety.test.js`:
  updated schema expectations and safety coverage.
- `test/remote-transport.test.js`: Feedback preference replay after a failed handover.
- `docs/post-effects.md`: behavior, verification and manual checklist.
