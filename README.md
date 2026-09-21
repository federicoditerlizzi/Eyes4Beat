# Eyes4Beat

Browser-based visual instrument for live music performances. Eyes4Beat analyzes a locally loaded audio track and maps musical features to WebGL image treatments and a 2D particle layer.

## Requirements

- Node.js 20 or newer
- A recent WebGL2 browser

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, load an audio file, and use the routing matrix to connect musical sources to visual targets.

## Quality checks

```sh
npm test
npm run build
```

The production bundle is written to `dist/` and can be deployed to any static host.

## Project structure

```text
index.html                  Application shell
src/main.js                 Runtime orchestration and UI bindings
src/config.js               Archetypes, assets, labels and default routing
src/routing.js              Pure musical source → visual target engine
src/shaders.js              WebGL2 vertex and fragment shaders
src/custom-archetypes.js    IndexedDB persistence for user-created archetypes
src/styles.css              Application styles
public/assets/images/       Archetype source images
public/assets/brand/        EyesForBeats logo and favicon assets
test/routing.test.js        Routing invariants
legacy/index_v044.html      Archived single-file prototype
```

## Runtime model

The audio analyzer produces continuous musical states (`energy`, `density`, `drive`, `boombap`, `tension`, `bright`, `open`) and event states (`beat`, `kick`, `snare`). The routing matrix maps them to pulse, distortion, brightness, saturation, glow, particles and zoom.

Archetypes define visual identity and image sequencing. Named presets contain only musical configuration. With no active routed signal, visual targets return to their neutral state while the image sequence continues.

Audio files remain local to the browser and are never uploaded.

## Show mode

The header's **Show output** button opens a second same-origin browser window using `?show=1`. The controller window retains audio playback and the complete UI; the Show window renders only the WebGL and particle canvases. A `BroadcastChannel` sends the computed musical targets, active archetypes, transition progress and image-sequence state roughly 25 times per second. Audio is neither copied nor analyzed twice.

Move the Show window to the projector and double-click it (or press `F`) to request full screen. The controller button indicates when a Show peer is connected. Custom archetypes are loaded independently from the shared origin's IndexedDB; creating a new one asks an open Show window to reload its local media library.

## Live keyboard shortcuts

The controller supports direct archetype selection with `1–9`, `0` for archetype 10 and `Shift+1–9` for archetypes 11–19. Arrow keys or `A`/`D` move backward and forward cyclically. `Alt/Option+1–9` selects presets 1–9 for the active archetype, `Alt/Option+0` selects preset 10, and `Alt/Option` combined with arrows or A/D cycles its presets. `S` selects smooth transitions and `C` selects cuts. `?` opens the same compact reference available from the header keyboard button. Shortcuts ignore key repeat and are disabled in form fields, dialogs and the Show window. Rapid archetype requests are serialized and the most recent queued selection wins.

## Live safety controls

`B` or the **BLACKOUT** button toggles a fast black DOM overlay above both render canvases while keeping the controller UI, audio analysis and rendering active. `P` or **PANIC** latches a non-destructive safe state: visual targets are forced to neutral, an archetype transition completes immediately and image sequencing stops after any active image crossfade finishes. Releasing PANIC eases from neutral back to the current routed targets over 300 ms and restarts the current image dwell period. Neither control writes to presets, routing, localStorage or IndexedDB. The four plain functions are available as `window.EyesForBeatsSafety` for a future MIDI adapter.

## Custom archetypes

Use the creation button after the footer archetype list to build an archetype from local images and short videos. Videos play muted and loop through the same WebGL treatment as images. Choose a built-in visual language as the initial shader/particle vocabulary; routing and musical presets remain independent and editable. Custom media are stored locally in IndexedDB and restored on the same browser and origin. The creator limits videos to 25 MB each and the complete selection to 100 MB.

The creator can also generate image sequences through the server-side Cloudflare Pages Function at `/api/generate-image`. Generated images become normal local archetype media; the API key is never sent to the browser. For local Pages development, add `OPENAI_API_KEY=...` to a git-ignored `.dev.vars`, run `npm run build`, then `npx wrangler pages dev dist`. The optional `OPENAI_IMAGE_MODEL` binding defaults to `gpt-image-1.5`.

AI generation has an optional animation-sequence mode. Its first keyframe is a normal generation; every following keyframe uses the previous result as an image-edit reference to preserve the scene and advance one evenly spaced temporal step along the same motion trajectory. Optional loop mode also sends the first frame as a reference and instructs the final state to flow naturally back into the origin.

For production, configure the secret and redeploy:

```sh
npx wrangler pages secret put OPENAI_API_KEY
npm run deploy
```

Set account-level budgets and alerts in the OpenAI API dashboard as an additional spending safeguard.

## Private deployment

The production deployment is configured for Cloudflare Pages. `functions/_middleware.js` protects the entire application with HTTP Basic authentication using the encrypted `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` bindings. Never add these values to `wrangler.jsonc` or commit them to the repository.
