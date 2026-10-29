# Kaleidoscope and feedback

Pipeline: scene → kaleidoscope → feedback → bloom → vignette/tone composite.
Both effects run in the active engine, including the output window, and leave the
Canvas2D particles unchanged. Zero effective values bypass their draw calls and
allocate no new render targets. Factory and older imported looks default to off.

Enable segments / amount in LOOK, assign sources to Kaleido / Trails in ROUTING,
and raise their target intensity and reactivity. Trails multiplies the look amount
(capped at .98); Kaleido controls the wet mix while segment counts remain integers.
New targets have no automatic routing assignments. Negative weights use the same
unipolar inversion as the other effects. An inactive source leaves them neutral.

Feedback retains `amount ** (dt * 60)` of the prior frame. Zoom, rotation, drift
and hue shift are specified per 60 Hz frame and scaled by elapsed time. `max`
keeps bright accents; `mix` blends the current scene with transformed history.
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
- Route kick to Pulse and Trails, enable feedback, and check the decay of accents.
- Try tunnel feedback with zoom and rotation, then the mix blend and drift/hue.
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
