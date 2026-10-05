# Project MIDI pads and Learn

Each project owns `midiSlots`: up to 16 `{id, name, bindings: [{note, channel}]}` records. Missing fields on existing projects/packages yield KICK, SNARE, HAT and PERC with empty bindings. IDs survive renames, project duplication and packages. Device selection remains in the rendering device's localStorage. D1 migration `0004_midi_slots.sql` adds a nullable JSON column; existing rows are normalized without a destructive rewrite.

Each slot registers an independent event source `MIDI · <name>` in routing, mapped image sources, particle burst triggers and diagnostics. Audio Kick/Snare remain separate. Note On velocity is divided by 127; Note Off and velocity-zero Note On do not fire or learn. Release shares the audio kick's 0.72-per-reference-hop exponential envelope. The UI flash has a longer visual decay for readability. Mapped MIDI image changes inspect timestamped hits, so render latency cannot turn an inside-hold hit into a valid trigger or lose a hit merely because its envelope decayed.

Learn is one-shot and runs entirely in the active engine. Notes match both channel (1–16) and number (0–127). Multiple notes can feed one slot. A duplicate proposes a move, retaining the original binding until MOVE is clicked; cancellation, project switching and stale confirmation tokens cannot steal bindings. Rename, delete slot and per-binding removal remain available in INPUT. Learn requires a connected device; Add slot is disabled at 16 with an explanation.

Engine snapshots and output recovery retain learned bindings. The controller persists changes through the existing local-first project sync. Reconnecting to an output also writes bindings learned while the control was absent. Export reads the latest persisted project after pending writes. Version-3 packages carry the optional project field; old v1/v2/v3 imports remain valid. Importing into an existing project merges slots by stable ID, preserves destination names, and moves imported note bindings to their imported slot; exceeding 16 is rejected rather than truncating data.

## Files changed in this task

- `src/midi/pads.js`, `src/midi/input.js`, `src/event-envelope.js`, `src/analysis/layers.js`: slots, Learn, timestamped events and shared envelope constant.
- `src/engine/engine.js`, `src/engine/sequencer.js`, `src/engine/protocol.js`, `src/engine/engine-session.js`, `src/engine/remote-transport.js`: commands, event consumption, full snapshots and recovery.
- `src/ui/midi-pads.js`, `src/main.js`, `index.html`, `src/styles.css`: slot editor, confirmation, activity and persistence integration.
- `src/library/local-repository.js`, `src/library/synced-repository.js`, `src/library/package-mapping.js`, `src/routing-presets.js`, `src/package-format.js`: project storage and source-preserving package normalization.
- `functions/_lib/service.js`, `migrations/0004_midi_slots.sql`: server validation and project sync schema.
- `test/midi-pads.test.js`, `test/midi-pads-app.html`, `test/engine-sequencer.test.js`, `test/engine-protocol.test.js`, `test/remote-transport.test.js`, `test/server-api.test.js`, `test/synced-repository.test.js`, `test/helpers/d1-sqlite.js`: unit, persistence, transport and browser regression tests.
- `AGENTS.md`, `docs/midi-pads.md`: architecture and verification.

## Manual MPC checklist

- Select the MPC in INPUT → MIDI. Learn KICK and two different pads on SNARE; verify note names/numbers/channels.
- Learn an already-bound note in another slot: CANCEL keeps it; MOVE transfers it. Remove one SNARE binding without removing the other.
- With AUDIO NONE, route MIDI · KICK to pulse. Compare soft and hard hits and observe the slot flash.
- Select MIDI slots for mapped image sequencing and particle bursts; verify hold time and event intensity.
- Rename/add/delete slots, reach the 16-slot limit, and verify registry selectors update while audio Kick/Snare remain available.
- Reload, switch projects and return, sync in a second browser, and export/import a project package: bindings and mappings remain.
- Repeat Learn and performance with output open. Reload the control, then close output and explicitly use the local engine: bindings remain and only the rendering window opens MIDI.

Automated browser checks use a simulated MIDI port. Physical MPC velocity response, USB timing and sustained live performance require this hardware checklist.
