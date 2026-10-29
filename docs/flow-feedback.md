# Flow feedback

Feedback history can be advected before it is sampled. The displacement is
`-flow(uv, time) * strength * dt * 60`, composed after the existing zoom, rotation
and drift transform, then mirrored at the image edges. Particles remain separate.
The active engine owns this processing in both control and output-window modes.

`feedback.flow` defaults to `{ strength: 0, scale: 2, speed: .3, octaves: 3,
source: 'noise' }`. Strength is bounded to 0–.01 per 60 Hz frame, scale .5–8,
speed 0–2, and octave count is an integer 1–4. Existing looks, factory presets
and older packages receive these off defaults.

LOOK → FEEDBACK has Amount, Flow strength and Flow scale as primary controls.
Speed, octaves and source are in Advanced. Flow settings hide when the look's
feedback amount is zero. Image mode hides noise-only speed/octaves.

ROUTING → Flow uses the same base-plus-routed-share rule as Trails:
`effectiveStrength = clamp(base + routedFlow * (.01 - base), 0, .01)`.
Base strength is visible without routing whenever feedback is active. The new
target starts with no assigned source, with intensity/reactivity 1; older presets
receive those control defaults. On/Solo/Amount and target gates work as usual.

Noise mode takes the analytic curl of animated fBm made from quintic value noise.
The scalar field's gradient has continuous derivatives at lattice boundaries.
Octave derivatives are weighted and divided by a constant octave-weight sum;
there is no spatially varying velocity normalization that would break the curl's
zero divergence. Coordinates and output velocity account for viewport aspect.
Scale changes field frequency; speed translates the evolving field in time.

Image mode samples current scene luminance in four directions, using a physical
sampling radius `.01 / scale`. Rotating that central-difference gradient by 90°
streams history along contours. The current scene includes kaleido and transitions;
its sampling also mirrors at edges. No extra textures or render targets are used.

Zero strength selects the original feedback shader, with no noise arithmetic or
additional luminance reads. Feedback off skips the entire pass. Flow never runs
on an unseeded frame or after a sufficiently long RAF pause has erased history.
PANIC bypasses it and clears feedback history through the existing safety path.
Resize, render scale, project changes and context restoration retain the existing
feedback-history cleanup behavior. Bloom quality Off does not disable flow.

## Verification

- `npm test`: finite-difference divergence at multiple aspects/octaves, lattice/time
  continuity, exact dt scaling of a fixed field, subpixel-close one-second moving
  trajectories at 30/60/120 FPS for the ink preset, synthetic image-gradient
  perpendicularity, normalization/imports, nested look blending, routing and gates.
- `/test/post-effects.html`: actual GPU noise/image displacement on patterned
  history, original-shader selection at strength zero, feedback/PANIC bypass,
  combined kaleido/feedback, mirrored edges and GL error checks.

A changing flow field is integrated once per frame; exact dt scaling does not
imply bit-identical resampled history images at different frame rates.

Manual show-laptop checklist:

- Feedback Amount .9, blend Mix, Flow strength .004, scale 2: observe melting ink
  and the image reforming as history decays.
- Route Level to Flow and verify stronger motion without removing the base amount.
- On a high-contrast picture, set source Image and check streaming along contours.
- Combine with six-segment kaleido, zoom/rotate/drift and bloom.
- PANIC immediately clears history and disables flow; release returns to base.
- Check output-window rendering and measure FPS at 1080p on the show laptop.

## Files changed

- `src/flow-field.js`: pure CPU reference, effective strength and shared GLSL field.
- `src/bloom-renderer.js`: flow feedback shader variant and uniforms.
- `src/looks.js`: defaults, nested fields, normalization and factory compatibility.
- `src/post-effects.js`: nested flow blending with discrete octaves/source.
- `src/config.js`, `src/routing.js`: Flow target, neutral and routing computation.
- `src/main.js`, `index.html`: target controls and old-preset defaults.
- `src/ui/look-editor.js`, `src/ui/control-relevance.js`: FEEDBACK controls/relevance.
- `test/flow-field.test.js`: pure flow reference and routing tests.
- `test/post-effects.html`: GPU flow tests.
- `test/look-editor.test.js`, `test/post-effects.test.js`, `test/show-safety.test.js`:
  nested primary-control, model and safety expectations.
- `docs/flow-feedback.md`: implementation and manual checklist.
