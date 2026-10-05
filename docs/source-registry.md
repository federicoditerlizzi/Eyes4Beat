# Musical sources and runtime registry

The audio catalog now contains five independent continuous sources (`level`, `low`, `bright`, `motion`, `full`) and three intensity events (`beat`, `kick`, `snare`). BPM is tempo state, not a routing source. Fullness uses spectral entropy; kick/snare intensity and event timestamps survive worklet batching, and envelopes decay between hits.

Register input metadata through `src/source-registry.js`. In a running control window, integrations can use:

```js
const sources = window.EyesForBeatsSources;
sources.register({ id: 'midiPad', label: 'MIDI Pad', kind: 'event', group: 'midi' });
await sources.publish({ midiPad: 0.7 });
sources.unregister('midiPad');
```

This is the integration boundary; it does not implement MIDI device access. Modules should register their sources before loading saved data. Registrations flow to all selectors, presets, diagnostics and the output engine; engine-origin registrations flow back to control. Unregister clears assignments. Extensions are validated with record-scoped metadata on the server without a database schema change.

## Migration

| Old id | New id | Adjustment |
| --- | --- | --- |
| energy | level | same weight/controls |
| drive | low | now low-band balance only |
| tension | motion | now spectral flux only |
| density | full | now continuous entropy |
| open | full | invert routing weights and source amount |
| boombap | none | drop assignment |
| unknown/unregistered | none | drop assignment |

Brightness and beat/kick/snare ids remain unchanged. Migration covers records, routing presets, image source, particle burst trigger and import preparation for package versions 1, 2 and 3. If several legacy rows merge, a canonical nonzero weight wins; otherwise the strongest absolute legacy weight wins. Existing performances may need retuning.

## Verification

- `npm test`: 186 tests pass, including synthetic bass/high-frequency signals, transient motion, continuous fullness sweeps, hit-strength intensities, registry/migration, protocol/recovery and server persistence.
- Browser fixtures: `test/workspace-layout.html`, `test/engine-app.html`, `test/source-registry-ui.html` cover the existing UI, remote output/audio/reconnection, and dynamic source selectors, presets, publication and removal.
- The warmed DSP benchmark retains reusable storage and reports no sampled analysis allocations. Sorted histories accept typed input to avoid numeric argument boxing without changing detector formulas.

## Manual checklist

- [ ] Open existing archetypes and play varied music: confirm they still react; retune amounts/thresholds for the new definitions.
- [ ] ROUTING: check five continuous sources and three events, assign each, use On/Solo/Amount, save and recall a routing preset, reload.
- [ ] IMAGES mapped source: check registry labels, continuous mapping versus event threshold/transition controls.
- [ ] LOOK particles: check event sources in burst trigger options and intensity-sensitive bursts.
- [ ] Diagnostics: five continuous meters, three event envelopes, BPM separately; no ZOOM source meter.
- [ ] Import an old v1/v2/v3 package; confirm migrated routing and source controls, inverted open/full amounts and dropped boombap assignments.
- [ ] Open output, publish an extension source, confirm routing matches local mode; reload control and reconnect.
- [ ] Register/unregister an extension: verify rows/options appear/disappear everywhere and removed assignments become None.

## Files changed

- `AGENTS.md`
- `docs/source-registry.md`
- `functions/_lib/service.js`
- `index.html`
- `src/analysis/engine.js`
- `src/analysis/history.js`
- `src/analysis/layers.js`
- `src/analysis/messages.js`
- `src/analysis/normalize.js`
- `src/analysis/onset.js`
- `src/config.js`
- `src/engine/engine-session.js`
- `src/engine/engine.js`
- `src/engine/protocol.js`
- `src/engine/remote-transport.js`
- `src/engine/sequencer.js`
- `src/image-sequencer.js`
- `src/library/runtime.js`
- `src/library/synced-repository.js`
- `src/looks.js`
- `src/main.js`
- `src/routing-presets.js`
- `src/source-migration.js`
- `src/source-registry.js`
- `src/ui/engine-view.js`
- `src/ui/look-editor.js`
- `src/ui/source-controls.js`
- `src/ui/workspace-layout.js`
- `test/analysis-engine.test.js`
- `test/analysis-worklet.test.js`
- `test/engine-app.html`
- `test/engine-protocol.test.js`
- `test/engine-sequencer.test.js`
- `test/remote-transport.test.js`
- `test/routing-preset-ui.html`
- `test/routing-presets.test.js`
- `test/routing.test.js`
- `test/server-api.test.js`
- `test/source-registry-ui.html`
- `test/source-registry.test.js`
- `test/workspace-layout.html`
