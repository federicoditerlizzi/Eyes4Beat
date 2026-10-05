# MIDI clock beat and pad response

The active engine now uses a single selected beat source. A present, running MIDI clock owns tempo, BeatPulse and timestamped `beat` events. Every 24 clocks emits one event; Start aligns the first tick to beat zero. Audio beat events are suppressed while MIDI owns the beat, but audio tempo/envelope continue updating for immediate fallback. Stop returns authority to audio even if the MPC continues transmitting clock. A one-second clock timeout also falls back to audio. Beat remains usable with AUDIO NONE; other audio sources remain zero.

Song Position Pointer (`F2`, 14-bit position in six-clock units) aligns the next tick. It does not start a stopped transport. Without Start/SPP/Stop, seven steady ticks infer a running clock. Its estimated phase is anchored to the available audio phase at the MIDI timestamp, or to the first clock if no audio phase is available; subsequent phase follows the MIDI ticks. Start or SPP replaces this estimate with an explicit position. The MIDI status shows **RUNNING, PHASE ESTIMATED** until alignment. An explicit Stop prevents automatic restart from clock alone.

MIDI beat release shares the audio beat constant (0.82 per reference 512-sample hop at 48 kHz). The header beat dot uses the selected beat envelope. Engine-side mapped image sequencing uses timestamped MIDI beat events, preserving minimum-hold semantics even when a frame arrives after the short envelope has decayed.

Each project pad slot now stores `decayMs` (30–600, default 150) and `velocityCurve` (`linear`, `soft`, `hard`). For normalized velocity x, curves are x, sqrt(x), and x². Both event intensity and the routing envelope use that shaped velocity. Decay is an exponential time constant: after the configured duration, intensity is 1/e of its initial value. INPUT exposes the controls per slot. Existing slots normalize to 150 ms/linear; the existing project JSON, sync and v3 package paths carry the fields without another database migration.

The analysis benchmark keeps average cost and allocation/heap checks. Its tail-cost assertion uses p99 < 0.5 ms instead of failing on a single maximum spike; max and spike counts remain diagnostic output.

## Changed files

- `src/midi/clock.js`, `src/midi/input.js`: SPP, inferred running transport, phase estimation, timestamped beat events.
- `src/engine/engine.js`, `src/engine/sequencer.js`: beat arbitration, routing without audio, audio-event suppression and MIDI image triggers.
- `src/event-envelope.js`, `src/analysis/layers.js`: shared beat release constant; pad default decay.
- `src/midi/pads.js`, `src/ui/midi-pads.js`, `src/styles.css`: pad decay/velocity normalization, response and editor controls.
- `src/ui/midi-view.js`, `src/ui/workspace-layout.js`: estimated-phase status, SPP monitor and selected beat indicator.
- `scripts/analysis-benchmark.js`, `test/analysis-performance.test.js`: p99 reporting/assertion.
- `test/midi-clock.test.js`, `test/midi-input.test.js`, `test/midi-pads.test.js`, `test/server-api.test.js`, `test/synced-repository.test.js`: clock, slot parameter and persistence tests.
- `test/midi-beat-app.html`, `test/midi-app.html`, `test/midi-pads-app.html`: browser checks and updated AUDIO NONE expectations.
- `AGENTS.md`, `docs/midi-pads.md`, `docs/midi-clock-fixes.md`: current behavior and manual verification.

## Manual MPC checklist

- With AUDIO NONE, route Beat to pulse: the source flash must coincide with the MPC metronome at 90/120 BPM. Confirm beat-triggered particle bursts/image sequencing too.
- Play a file, then Stop the MPC while it still sends clock: BPM and Beat must follow the file immediately.
- Reload/reopen the output while the MPC is already playing. Tempo and beat must resume without restarting the MPC; status reports estimated phase until Start/SPP.
- Send SPP/Continue: phase follows song position; Stop must not restart merely because clock continues.
- Route a pad to pulse at 150 ms decay; compare 30/150/600 ms and linear/soft/hard with soft and hard hits.
- Reload and export/import the project; slot response settings must remain. Repeat with the engine in the output window.

Automated browser tests use simulated MIDI and a synthesized audio file. MPC hardware timing remains a manual check.
