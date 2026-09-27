# Workspace layout verification

Changed files: index.html; src/main.js; src/icons.js; src/styles.css; src/ui/workspace-layout.js; AGENTS.md; test/workspace-layout.html; this document.

The layout module moves existing controls and preserves their handlers. Rendering, audio, routing and output commands remain unchanged. PERFORM only changes UI visibility.

Manual checklist:
- Project dropdown: select/create/rename/duplicate/delete projects, account/sync/Live Lock status, import/export and collapsed legacy export; verify package remains in the archetype bar.
- Audio group: play/pause, mute, FILE/LIVE, BPM and beat indicator. Audio panel: load/seek/volume, live device, trim and calibration.
- Live group: BLACKOUT, PANIC, LIVE LOCK, SMOOTH/CUT; verify active colors and shortcuts.
- Output group: open/focus/reopen, connected/disconnected indication, preview and fullscreen. Menu: diagnostics, output settings, keyboard guide.
- Active archetype edit (E): LOOK editing and look presets; ROUTING source/amount/reset/zero; IMAGES sequencing/media/transitions; PRESETS save/update/delete/select and source/target controls.
- Change archetype with every tab open: title and contents follow selection. Keep editing numeric fields: shortcuts must not fire.
- Open each side panel and press Escape. Only one side panel should be visible.
- Q/PERFORM: editing disappears, active-source meters remain, archetype buttons grow, audio/safety/navigation continue. Exit restores editing access.
- Repeat with output connected, after control reload, and after output disconnection.
- At 1280px: header groups, all inspector tabs, project/audio panels and dialogs stay inside viewport with no horizontal overflow. Scroll long forms.
