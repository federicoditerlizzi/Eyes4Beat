# MIDI foundation

The rendering engine owns MIDI access in both single-window and output-window operation. Input selection is remembered on the rendering device. Permission is requested on selection (or when restoring a remembered selection); MIDI defaults to OFF. Unplugging preserves the desired device; reconnecting reopens it. A uniquely matching name/manufacturer also handles a changed port ID.

MIDI event timestamps determine clock BPM and phase, independently of callback batching. Clock is 24 pulses per quarter note, smoothed across recent pulse intervals. A fresh clock overrides audio tempo; after one second without clock, the separately retained audio tempo resumes. Start resets position, Stop freezes phase, Continue resumes. Notes, velocity, CC and program changes appear in the monitor. No mappings are installed, and MIDI transport messages do not start or stop an audio file. API reference: [Web MIDI specification](https://www.w3.org/TR/webmidi/).

AUDIO NONE pauses the file, closes live tracks, suspends analysis and zeros audio sources. Loaded audio, trim and calibration remain available on returning to FILE/LIVE. MIDI runs independently. Browsers without Web MIDI display a Chrome/Edge explanation.

## Files changed for this task

- `src/midi/clock.js`, `src/midi/input.js`: parsing, clock arbitration, device ownership and persistence.
- `src/audio-input.js`, `src/engine/audio.js`: AUDIO NONE and engine handover.
- `src/engine/engine.js`, `src/engine/effects.js`: tempo state and phase consumption.
- `src/engine/protocol.js`, `src/engine/engine-session.js`, `src/engine/remote-transport.js`: commands and recovery.
- `index.html`, `src/main.js`, `src/styles.css`, `src/ui/engine-view.js`, `src/ui/workspace-layout.js`, `src/ui/midi-view.js`: INPUT sections, relevant indicators and MIDI monitor.
- `test/midi-clock.test.js`, `test/midi-input.test.js`, `test/engine-protocol.test.js`, `test/remote-transport.test.js`, `test/midi-app.html`, `test/engine-app.html`: pure, transport and browser regression checks.
- `AGENTS.md`, `docs/midi-foundation.md`: architecture and verification.

## Manual MPC checklist

- In Chrome/Edge, select the MPC in INPUT → MIDI. Verify clock at 90/120/140 BPM and beat phase; Start resets, Stop freezes, Continue resumes.
- Send notes with different velocities, CC and program changes; check monitor values.
- Stop sending clock while audio plays: audio tempo resumes after approximately one second.
- Unplug/replug the MPC and reload: the selected input reconnects without another selection.
- Set AUDIO NONE: audio indicators disappear, audio analysis stops, MIDI stays active. Return to FILE and LIVE and check trim/meter/calibration retention.
- Repeat with an output window: grant MIDI permission there, verify output clock and control monitor; reload control without interrupting MIDI. Close output and explicitly choose local operation.
- In Safari, verify the unsupported-browser message.

Automated tests use synthetic clocks, fake MIDI ports and isolated Chromium. Physical MPC timing and platform-specific USB reconnection still require the checks above.
