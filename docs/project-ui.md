# Project UI verification

Files changed: index.html; src/main.js; src/icons.js; src/styles.css; src/ui/workspace-layout.js; src/ui/project-ui.js; test/workspace-layout.html; test/project-ui.html; test/project-ui.test.js; AGENTS.md; docs/project-ui.md.

Project switching is separate from Library row actions. Rename, duplicate, visibility, delete and export receive the clicked project's record/id; only switching, creating/importing, or deleting the current project changes selection. Share/delete use the same owner check and server authorization as before. Repository and sync implementations are unchanged.

Manual checklist:
- J: dropdown anchors below the project name, highlights the current project and shows visibility, shared owner and offline badges.
- Navigate with arrows and Enter; switch closes the dropdown. Escape/outside click closes it.
- Library: on a non-current project, rename, duplicate, toggle sharing, export and delete; the playing project remains selected. Inspect the exported package's project name and media.
- Projects shared by someone else have rename/duplicate/export, with share/delete absent. Server permissions remain authoritative.
- New project and Import package work from Library; New project also works from the switcher.
- Backup and legacy starts collapsed and contains storage/quota, latest export, legacy and built-in exports.
- Account avatar/K opens email, global sync, last sync, Sync now and Sign out.
- Current project dot: green synced, amber pending, blue ready offline, gray offline with missing media, red session/conflict/save error. Edits/conflicts in another project do not mark the current project pending/error.
- At 1280px, header, anchored menus and centered Library stay within the viewport.
- Repeat switching with output connected; inspector follows the selected project's archetypes.
