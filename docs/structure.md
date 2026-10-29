# Accents and structural modulation

Each base event source has a derived event source `<id>_accent` labelled
`<label> · accent`, including every project MIDI pad. Accents are generated only
by the active engine. Registration, removal, renaming, output recovery and scoped
package/server normalization derive the catalog consistently; accents never derive
further accents and cannot be externally published.

The event-time detector compares the original intensity strictly against 1.35 ×
the median of the previous eight events from that source. It also accents the first
event, or one after a gap of at least two beats with tempo, or one second without
tempo. Zero-intensity / stale events are ignored. History is updated for every
valid hit, including non-accents. Accents retain the original intensity and expose
an independent decaying routing envelope. STRUCTURE exposes ratio (1–4) and gap
(.25–16 beats); these settings are stored in routing controls/presets.

ROUTING → STRUCTURE stores up to eight rows per archetype, also saved/recalled by
routing presets. Missing lists in older records/packages default to empty. Each
row chooses a registered event trigger, bounded parameter, min/max, cycle values,
random or random-walk mode, duration (50–2000 ms, default 300), and curve. Step size
is shown only for random walk; values only for cycle. Continuous choices are offsets
except the distortion amplitude multiplier. Segment counts and direction/seed
choices are absolute discrete values. Multiple continuous offsets accumulate in
row order and are clamped to the look's limits.

Allowed vocabulary is exported by `src/structure.js`: kaleido segments and angle
offset, distortion amplitude multiplier and angle offset, spiral amount offset
and direction, rotation direction, feedback zoom/rotate offsets, tile permutation
seed. Direction values are −1 / +1; a rotation direction override affects the
existing spin mode. A tile seed chooses a shifted bijection of the same 12×8 grid.

The engine owns states keyed by archetype and row ID. Events choose targets and
elapsed-time easing reaches them at the configured duration. Segments keep the
old count during the first half of a dip, change at zero wet mix, and fade back in;
routed kaleido cannot bypass the dip. Consecutive requests preserve the current
dip level. Neither offsets nor temporary fields are written into saved looks.
Changing a row configuration resets its runtime offsets. Archetype switches ease
outgoing/incoming offsets to base; PANIC resets them immediately. Event sources'
On/Solo/Amount gating applies to structural triggers. Input source resets discard
audio-derived events without discarding MIDI events.

Scene uniforms carry each role's spiral offset/direction and tile seed; distortion
and rotation reuse their role-specific look uniforms. Kaleido postprocessing
receives the structural angle offset and dip multiplier. These stay in the active
engine in an output window; only settings and compact row status cross snapshots.
UI editor fields are never rebuilt by runtime snapshots.

## Verification

- `npm test`: detector median/ratio/gap, source lifecycle and scoped catalogs,
  random-walk bounds, cycle ordering, easing endpoints, dip midpoint with routing,
  PANIC/reset and archetype independence, parameter bounds, old packages, two
  saved/recallable lists in IndexedDB, protocol validation and relevance.
- `/test/structure-app.html`: actual engine event ingestion using an extension
  event, accent vs ordinary hits, snapshots, segment changes, PANIC, archetype
  switches, and the STRUCTURE editor.
- `/test/structure-ui.html`: complete control UI, two routing preset recalls,
  persisted lists and focused-field retention during engine snapshots.

Manual hardware checks:

- Route normal MIDI · KICK to Pulse only. Set kaleido segments 6, Mix 1; add a
  STRUCTURE cycle triggered by MIDI · KICK · accent, range 6–8, values `6, 8`.
  Normal repeated kicks should only pulse. A stronger kick or one following a
  two-beat gap should advance the segment cycle through a smooth dip.
- Trigger a distortion angle offset cycle `-90, 90` from Snare with a nonzero
  distortion look and an active routed Distortion target.
- Recall two routing presets with distinct lists and verify editor/runtime behavior.
- Press PANIC and confirm offsets return to the saved look immediately.
- Repeat in an output window, including controller reload/reconnect; check live
  MIDI timing and FPS on the show laptop.

## Files changed

- `src/accents.js`, `src/source-registry.js`, `src/midi/pads.js`: accent detector
  and derived source lifecycle.
- `src/structure.js`: vocabulary, normalization and pure runtime.
- `src/routing-presets.js`: list/settings persistence and modified comparison.
- `src/engine/engine.js`, `src/engine/protocol.js`, `src/engine/sequencer.js`:
  event handling, safety, per-archetype lifecycle, snapshots and validation.
- `src/engine/renderer.js`, `src/shaders.js`, `src/bloom-renderer.js`,
  `src/post-effects.js`: role uniforms, tile seed, structural kaleido angle/dip.
- `src/main.js`, `src/ui/structure-editor.js`, `index.html`, `src/styles.css`:
  STRUCTURE UI, relevance and routing preset integration.
- `test/structure.test.js`, `test/structure-app.html`, `test/structure-ui.html`:
  pure, engine and full UI regressions.
- `docs/structure.md`: behavior and manual checklist.
