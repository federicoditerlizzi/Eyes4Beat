# LOOK editor verification

Changed for this update: src/main.js, src/styles.css, src/ui/look-editor.js, test/look-editor.test.js, test/look-editor.html, AGENTS.md, docs/look-editor.md.

The existing normalization, immediate engine update and debounced repository save remain unchanged. No look fields or rendering algorithms changed.

Reset uses the archetype's factory/Blank origin. Project presets and imports have a device-local baseline captured on project load. Older imports do not carry the original creation look: their first loaded look is the baseline. COLOR includes vignette, PARTICLES includes burst, and unrelated groups are preserved.

Manual checklist:
- Open LOOK: COLOR, DISTORTION, PARTICLES, BLOOM, PULSE, ROTATION, FRAME appear in that order.
- Collapse/open groups and Advanced, switch archetypes and reload: device preferences survive.
- Move every slider; click its value and type a precise value. Verify live rendering and persistence.
- Exercise every segmented option, return-to-rest checkbox and color swatch.
- Open Advanced: verify vignette, directional controls, particle motion/color/burst, bloom knee/tint/stretch, pulse center/width/chromatic and rotation direction/fill/rest.
- Reset each group: only that group returns to its starting values.
- Follow a routing hint; change its source or clear the route; reopen LOOK and verify the hint. COLOR and FRAME have no hint.
- Load Blank, factory and project presets; save/rename/delete a project look preset from the top controls.
- Repeat live editing with the output window connected.
