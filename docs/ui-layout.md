# Workspace layout verification

Changed files: index.html; src/main.js; src/icons.js; src/styles.css; src/ui/workspace-layout.js; AGENTS.md; test/workspace-layout.html; this document.

The layout module moves existing controls and preserves their handlers. Rendering, audio, routing and output commands remain unchanged. PERFORM only changes UI visibility.

Manual checklist:
- Project dropdown: select/create/rename/duplicate/delete projects, account/sync/Live Lock status, import/export and collapsed legacy export; verify package remains in the archetype bar.
- Audio group: play/pause, mute, FILE/LIVE, BPM and beat indicator. Audio panel: load/seek/volume, live device, trim and calibration.
- Live group: BLACKOUT, PANIC, LIVE LOCK, SMOOTH/CUT; verify active colors and shortcuts.
- Output group: open/focus/reopen, connected/disconnected indication, preview and fullscreen. Menu: diagnostics, output settings, keyboard guide.
- Active archetype edit (E): LOOK editing and look presets; ROUTING contains Routing presets (select/create/update/delete), SOURCES, then TARGETS with assignment dropdowns, on/intensity/reactivity/solo/live controls; IMAGES contains sequencing/media/transitions. E/R/I open these three tabs; U is unused.
- Change archetype with every tab open: title and contents follow selection. Keep editing numeric fields: shortcuts must not fire.
- Open each side panel and press Escape. Only one side panel should be visible.
- Q/PERFORM: editing disappears, active-source meters remain, archetype buttons grow, audio/safety/navigation continue. Exit restores editing access.
- Repeat with output connected, after control reload, and after output disconnection.
- At 1280px: header groups, all inspector tabs, project/audio panels and dialogs stay inside viewport with no horizontal overflow. Scroll long forms.

Inspector consistency checks:
- Switch LOOK / ROUTING / IMAGES: toolbar position, padding and control heights match.
- Scroll each body: presets or sequence controls remain fixed above it.
- Check section chevrons, info tooltips, warnings and centered icon hover backgrounds.
- At 1280 px, no toolbar overflow; PERFORM still hides the inspector.

Header checks: FILE seek/time/volume in the header; LIVE replaces timeline with input meter; About shows package version; six groups remain on one line at 1280 px and wide screens, with seek consuming spare width. PERFORM retains Audio, Live, View and brand only.
