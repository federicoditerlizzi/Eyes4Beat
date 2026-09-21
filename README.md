# Eyes4Beat

Browser-based visual instrument for live music performances. Eyes4Beat analyzes a local audio file or a live audio input and maps musical features to WebGL image treatments and a 2D particle layer.

## Requirements

- Node.js 20 or newer
- A recent WebGL2 browser

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, load an audio file, and use the routing matrix to connect musical sources to visual targets.

Custom archetypes can be removed with the trash icon on their footer card. Confirming permanently deletes that archetype's locally stored media, sequence settings, routing and musical presets from this browser. The six built-in archetypes cannot be deleted. If the deleted archetype is active, the app switches to Deep Drift; playback continues. An open Show window refreshes its library automatically.

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
src/icons.js                Bundled Lucide subset and runtime icon helper
src/transitions.js          Media-transition catalogue and GLSL ids
src/image-sequencer.js      Easing, duration and config migration logic
src/shaders.js              WebGL2 vertex and fragment shaders
src/custom-archetypes.js    IndexedDB persistence for user-created archetypes
src/styles.css              Application styles
public/assets/images/       Archetype source images
public/assets/brand/        EyesForBeats logo and favicon assets
test/routing.test.js        Routing invariants
test/image-sequencer.test.js Transition and migration invariants
legacy/index_v044.html      Archived single-file prototype
```

## Runtime model

The audio analyzer produces continuous musical states (`energy`, `density`, `drive`, `boombap`, `tension`, `bright`, `open`) and event states (`beat`, `kick`, `snare`). The routing matrix maps them to pulse, distortion, brightness, saturation, glow, particles and zoom.

Archetypes define visual identity and image sequencing. Named presets contain only musical configuration. With no active routed signal, visual targets return to their neutral state while the image sequence continues.

Audio files remain local to the browser and are never uploaded.

## Image transitions

Each archetype has three media-transition pools in the Image Manager. **TIMED** serves auto sequencing and continuous mapped sources; **EVENT** serves Beat, Kick and Snare; **MANUAL** serves the previous/next controls and `[`/`]` shortcuts. Every pool can contain multiple transition styles, selected either cyclically or randomly without immediate repetition, and has independent duration, easing, wipe direction and TEST action. Available styles are cut, crossfade, dip to black/white, luma and noise dissolves, directional wipe, iris, zoom through and glitch cut.

Transition duration is limited to 80% of the current image dwell so the destination remains readable; durations below roughly 60 ms become cuts. Easing is computed in JavaScript and the WebGL shader receives the eased progress plus a stable transition type, seed and parameters. The library in `src/transitions.js` is the single source of truth for UI labels and GLSL numeric identifiers.

The Show window receives a transition-start event and runs the effect using its own clock after its destination media has loaded. Periodic frame state remains only as a recovery path if that event is missed.

A new request during a running transition completes that transition immediately before starting the next one. While destination media is loading, only the most recent pending request is retained. Automatic requests still respect their existing dwell limits; manual navigation bypasses dwell timing.

Each archetype also selects a sequence order: sequential, ping-pong, random without consecutive repeats, or shuffle. Shuffle creates a new random permutation for each cycle and prevents a repeat at the cycle boundary. In random and shuffle modes, PREV follows the history of images actually shown. Continuous mapped mode remains a direct level-to-position mapping.

The time base can be seconds or beats. Beat dwell values are 1, 2, 4, 8, 16 or 32 beats; values shorter than two seconds at the scheduled tempo are promoted to the next power of two. Transition durations use 1/8, 1/4, 1/2, 1, 2 or 4 beats. Auto changes are requested on the next beat-grid boundary, then begin when on-demand media loading completes. A reliable detected tempo is preferred, followed by the last reliable tempo and finally a visible 120 BPM fallback. The schedule is fixed after each change rather than recalculated on every frame.

## Live input

Open **AUDIO INPUT**, choose **LIVE INPUT**, select the USB audio interface or built-in input, then start it. Live input is analyzed but is never routed to the browser speakers, avoiding feedback and duplicate monitoring; keep monitoring the instrument through the PA or audio interface. USB/line-level interfaces are listed before the built-in microphone.

Set **Analysis trim** so normal performance peaks sit roughly between −18 and −6 dBFS without lighting **CLIP**. Trim changes analysis sensitivity only and never changes file playback volume. With the instrument silent, run **CALIBRATE NOISE (3 s)**; the stored noise profile is subtracted before the existing musical feature analysis. Recalibrate after changing trim or the physical gain staging. Device, per-input trim and per-input calibration are restored locally in the same browser.

Browser audio capture requires HTTPS or `localhost`. The diagnostics panel reports the actual input settings returned by the browser. If echo cancellation, noise suppression or automatic gain control cannot be confirmed off, the UI warns that input dynamics may be compressed.

## Show mode

The header's **Show output** button opens a second same-origin browser window using `?show=1`. The controller window retains audio playback and the complete UI; the Show window renders only the WebGL and particle canvases. A `BroadcastChannel` sends the computed musical targets, active archetypes, transition progress and image-sequence state roughly 25 times per second. Audio is neither copied nor analyzed twice.

Move the Show window to the projector and double-click it (or press `F`) to request full screen. The controller button indicates when a Show peer is connected. Custom archetypes are loaded independently from the shared origin's IndexedDB; creating a new one asks an open Show window to reload its local media library.

## Live keyboard shortcuts

The controller supports direct archetype selection with `1–9`, `0` for archetype 10 and `Shift+1–9` for archetypes 11–19. Arrow keys or `A`/`D` move backward and forward cyclically. `Alt/Option+1–9` selects presets 1–9 for the active archetype, `Alt/Option+0` selects preset 10, and `Alt/Option` combined with arrows or A/D cycles its presets. `[` and `]` select previous/next media through the manual transition pool. `S` selects smooth transitions and `C` selects cuts. `?` opens the same compact reference available from the header keyboard button. Shortcuts ignore key repeat and are disabled in form fields, dialogs and the Show window. Rapid archetype requests are serialized and the most recent queued selection wins.

## Live safety controls

`B` or the **BLACKOUT** button toggles a fast black DOM overlay above both render canvases while keeping the controller UI, audio analysis and rendering active. `P` or **PANIC** latches a non-destructive safe state: visual targets are forced to neutral, an archetype transition completes immediately and image sequencing stops after any active media transition finishes. Releasing PANIC eases from neutral back to the current routed targets over 300 ms and restarts the current image dwell period. Neither control writes to presets, routing, localStorage or IndexedDB. The four plain functions are available as `window.EyesForBeatsSafety` for a future MIDI adapter.

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
