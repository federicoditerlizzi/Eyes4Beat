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

In Musical Targets, each effect has independent On and Solo controls beside its intensity and reactivity sliders. Switching a target off returns only that effect to its neutral value; Solo isolates one or more targets. Musical presets save these switches as well as the slider values.

Custom archetypes can be removed with the trash icon on their footer card. Confirming permanently deletes that archetype's locally stored media, sequence settings, routing and musical presets from this browser. The six built-in archetypes cannot be deleted. If the deleted archetype is active, the app switches to Deep Drift; playback continues. The active engine receives the updated project records.

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
src/config.js               Routing sources, targets and labels
src/looks.js                Factory look catalog and starter routing
src/library/                Project repository, runtime mapping and package import mapping
src/legacy/                 Read-only old-library exporter and built-in assets
src/routing.js              Pure musical source → visual target engine
src/icons.js                Bundled Lucide subset and runtime icon helper
src/transitions.js          Media-transition catalogue and GLSL ids
src/image-sequencer.js      Easing, duration and config migration logic
src/shaders.js              WebGL2 vertex and fragment shaders
src/custom-archetypes.js    Legacy IndexedDB reader (export only)
src/styles.css              Application styles
public/assets/images/       Archetype source images
public/assets/brand/        EyesForBeats logo and favicon assets
test/routing.test.js        Routing invariants
test/image-sequencer.test.js Transition and migration invariants
legacy/index_v044.html      Archived single-file prototype
```

## Runtime model

The audio analyzer produces continuous musical states (`energy`, `density`, `drive`, `boombap`, `tension`, `bright`, `open`) and event states (`beat`, `kick`, `snare`). The routing matrix maps them to pulse, distortion, brightness, saturation, glow, particles, zoom, rotation, spiral and tile shuffle. The three new image effects start at zero intensity so existing visuals do not change until enabled with their sliders. By default, Energy drives rotation, Drive drives spiral and Kick drives tile shuffle; these connections can be edited in the matrix. Tile shuffle rearranges a fixed 12×8 grid in the shader and does not create or load extra media.

Archetypes define visual identity and image sequencing. Named presets contain only musical configuration. With no active routed signal, visual targets return to their neutral state while the image sequence continues.

Audio files remain local to the browser and are never uploaded.

## Image transitions

Each archetype has three media-transition pools in the Image Manager. **TIMED** serves auto sequencing and continuous mapped sources; **EVENT** serves Beat, Kick and Snare; **MANUAL** serves the previous/next controls and `[`/`]` shortcuts. Every pool can contain multiple transition styles, selected either cyclically or randomly without immediate repetition, and has independent duration, easing, wipe direction and TEST action. Available styles are cut, crossfade, dip to black/white, luma and noise dissolves, directional wipe, iris, zoom through and glitch cut.

Transition duration is limited to 80% of the current image dwell so the destination remains readable; durations below roughly 60 ms become cuts. Easing is computed in JavaScript and the WebGL shader receives the eased progress plus a stable transition type, seed and parameters. The library in `src/transitions.js` is the single source of truth for UI labels and GLSL numeric identifiers.

Media transitions run entirely in the active engine, including when it is hosted in the output window. No frame or transition replication is used.

A new request during a running transition completes that transition immediately before starting the next one. While destination media is loading, only the most recent pending request is retained. Automatic requests still respect their existing dwell limits; manual navigation bypasses dwell timing.

Each archetype also selects a sequence order: sequential, ping-pong, random without consecutive repeats, or shuffle. Shuffle creates a new random permutation for each cycle and prevents a repeat at the cycle boundary. In random and shuffle modes, PREV follows the history of images actually shown. Continuous mapped mode remains a direct level-to-position mapping.

The time base can be seconds or beats. Beat dwell values are 1, 2, 4, 8, 16 or 32 beats; values shorter than two seconds at the scheduled tempo are promoted to the next power of two. Transition durations use 1/8, 1/4, 1/2, 1, 2 or 4 beats. Auto changes are requested on the next beat-grid boundary, then begin when on-demand media loading completes. A reliable detected tempo is preferred, followed by the last reliable tempo and finally a visible 120 BPM fallback. The schedule is fixed after each change rather than recalculated on every frame.

## Live input

Open **AUDIO INPUT**, choose **LIVE INPUT**, select the USB audio interface or built-in input, then start it. Live input is analyzed but is never routed to the browser speakers, avoiding feedback and duplicate monitoring; keep monitoring the instrument through the PA or audio interface. USB/line-level interfaces are listed before the built-in microphone.

Set **Analysis trim** so normal performance peaks sit roughly between −18 and −6 dBFS without lighting **CLIP**. Trim changes analysis sensitivity only and never changes file playback volume. With the instrument silent, run **CALIBRATE NOISE (3 s)**; the stored noise profile is subtracted before the existing musical feature analysis. Recalibrate after changing trim or the physical gain staging. Device, per-input trim and per-input calibration are restored locally in the same browser.

Browser audio capture requires HTTPS or `localhost`. The diagnostics panel reports the actual input settings returned by the browser. If echo cancellation, noise suppression or automatic gain control cannot be confirmed off, the UI warns that input dynamics may be compressed.

### Audio analysis engine

Audio is analyzed in a fixed-rate `AudioWorklet`, independent of rendering performance. A 2048-sample Hann-window FFT with a 512-sample hop produces physical Hz bands: sub 20–60, bass 60–120, low-mid 120–400, mid 400–2000, high-mid 2–6 kHz, high 6–12 kHz and air 12 kHz to Nyquist. Loudness and bands use dBFS consistently. Adaptive normalization compares the current performance with short- and long-term ranges, so trim and programme level changes affect the controls much less than before; noise calibration gates and subtracts the measured floor first.

Kick detection follows a 40–110 Hz time-domain envelope, while snare/clap detection combines 200–400 Hz body with 2–8 kHz spectral flux. Tempo uses an 8-second onset history, sub-bin autocorrelation in the 60–200 BPM range and a phase-locked beat grid. The public routing sources and their 0–1/event contracts have not changed. Existing presets still load unchanged, but the corrected scales can make a light re-tuning of weights and reactivity worthwhile.

Diagnostics show the detected sample rate, every band's frequency range and dBFS level, onset, BPM/confidence/phase, kick and snare events, gate state and active normalization ranges. Browsers without AudioWorklet support show an explicit error because render-loop analysis is intentionally not used as a degraded fallback.

## Output window

The header's output button opens `?output=1`. Move it to the second screen, click **Click to start** once to enable audio, and use its fullscreen control. Output owns the only renderer, audio graph and analysis worklet; control sends commands over a private MessageChannel. File audio travels as a Blob and live-device permission belongs to output. B/P safety shortcuts also work there.

Control displays a toggleable, muted 30 fps preview, including particles and blackout; browsers without stream capture use low-rate snapshots. Preview stops while control is hidden. Reloading or closing control leaves output running. A reloaded control reattaches and adopts the output's authoritative state. If output closes or stops responding for about two seconds, **Output disconnected** offers **Reopen** or **Use this window**. Local audio/rendering resumes only when explicitly selected. Diagnostics include heartbeat age and command latency. See [engine documentation and manual checks](docs/engine-refactor.md).

## Live keyboard shortcuts

The controller supports direct archetype selection with `1–9`, `0` for archetype 10 and `Shift+1–9` for archetypes 11–19. Arrow keys or `A`/`D` move backward and forward cyclically. `Alt/Option+1–9` selects presets 1–9 for the active archetype, `Alt/Option+0` selects preset 10, and `Alt/Option` combined with arrows or A/D cycles its presets. `[` and `]` select previous/next media through the manual transition pool. `S` selects smooth transitions and `C` selects cuts. `?` opens the same compact reference available from the header keyboard button. Shortcuts ignore key repeat and are disabled in form fields, dialogs and the output window. Rapid archetype requests are serialized and the most recent queued selection wins.

## Live safety controls

`B` or the **BLACKOUT** button toggles a fast black DOM overlay above both render canvases while keeping the controller UI, audio analysis and rendering active. `P` or **PANIC** latches a non-destructive safe state: visual targets are forced to neutral, an archetype transition completes immediately and image sequencing stops after any active media transition finishes. Releasing PANIC eases from neutral back to the current routed targets over 300 ms and restarts the current image dwell period. Neither control writes to presets, routing, localStorage or IndexedDB. The four plain functions are available as `window.EyesForBeatsSafety` for a future MIDI adapter.

## Custom archetypes

On first start, create a project or import a package. Use the footer creation button to build an archetype from local images and short videos. Videos play muted and loop through the same WebGL treatment as images. **Start from Blank** for a neutral look and empty musical routing, choose one of six factory presets for its look and starter routing, or choose a project look preset for its look alone. At least one media file is required. Projects, archetypes, looks, routing, image settings, presets and content-addressed media live in the local `eyes4beat-library` IndexedDB database. The creator limits videos to 25 MB each and the complete selection to 100 MB.

The header project switcher opens another project without restarting audio; the adjacent project panel creates, renames, duplicates, deletes and exports projects. Archetypes in the footer can be renamed, duplicated, reordered and soft-deleted. Empty projects render dark while audio analysis continues. All data remains private to this browser and origin; no account or sync is implemented yet.

## Archetype looks

Every archetype owns editable distortion, color and particle parameters. Open **LOOK** in the header to change them live; edits are saved to that archetype in the project repository. The six original visual profiles are factory presets with matching rendering constants. **Load preset** replaces only the current look after confirmation; project look presets can be saved, renamed and deleted. A blank look has no distortion, color tint or particles. Distortion still requires a routed, active Distortion musical target. The editor warns when the archetype has no musical routing at all.

The creator can also generate image sequences through the server-side Cloudflare Pages Function at `/api/generate-image`. Generated images become normal local archetype media; the API key is never sent to the browser. For local Pages development, add `OPENAI_API_KEY=...` to a git-ignored `.dev.vars`, run `npm run build`, then `npx wrangler pages dev dist`. The optional `OPENAI_IMAGE_MODEL` binding defaults to `gpt-image-1.5`.

AI generation has an optional animation-sequence mode. Its first keyframe is a normal generation; every following keyframe uses the previous result as an image-edit reference to preserve the scene and advance one evenly spaced temporal step along the same motion trajectory. Optional loop mode also sends the first frame as a reference and instructs the final state to flow naturally back into the origin.

For production, configure the secret and redeploy:

```sh
npx wrangler pages secret put OPENAI_API_KEY
npm run deploy
```

Set account-level budgets and alerts in the OpenAI API dashboard as an additional spending safeguard.

## Backup and export

Use **EXPORT PROJECT** in the project panel to download a v3 ZIP with the ordered archetypes, project look presets, settings and all media. **IMPORT PACKAGE** accepts v1/v2 legacy-library backups and v3 projects, validates checksums first and lets you select archetypes and a new or existing destination project. Legacy data is never modified: if it exists in this browser, the panel offers **EXPORT LIBRARY**; **EXPORT BUILT-INS** is always available. Identical media are stored once per ZIP and once in the local library by SHA-256. Keep a copy outside browser storage.

Use **VERIFY PACKAGE** to check a saved ZIP without changing the app. The report includes archetype and media counts, format version, missing files and checksum mismatches. Data is per browser and origin, so export separately from every browser/computer where you have worked (including localhost and the deployed site).

Until account sync exists, the browser database is the only live copy. On startup the app requests persistent storage when supported and shows the result plus estimated usage/quota in the project panel; persistence is not guaranteed, so export projects regularly. The panel also shows each project's last export date on this device. A missing media record no longer prevents a project opening: it appears as a neutral placeholder, is skipped by sequencing when other media exist, and is identified in the Image Manager. Save errors show **Not saved — retry**; pending settings are also flushed when the page is hidden or closed. Project import writes its selected records in one transaction, so a failed import does not leave half a project.

## Cloudflare Access and server library (phase 3)

The server is now the project source of truth, while each signed-in user has an isolated IndexedDB cache named `eyes4beat-cache-<email-hash>`. Cached projects render immediately and remain usable without a network connection. The last signed-in email selects the offline cache before `/api/me` completes; a different authenticated user switches to a different cache. Legacy v1/v2 and project v3 packages import into server projects without changing their format. Keep exporting ZIP backups.

For Pages, protect the production and preview hosts with a Cloudflare Access application (One-time PIN is sufficient for invited users). Set Pages secrets `ACCESS_TEAM_DOMAIN` (for example `team.cloudflareaccess.com`), `ACCESS_AUD` (one or more comma-separated application audience tags), and `ALLOWED_EMAILS` (comma-separated invited email addresses). The middleware verifies the Access assertion's signature, audience, issuer, expiry and email on every request, including `/api/generate-image`. The allowlist is a second check in addition to Access policy. Never commit secrets.

Create the D1 database `eyesforbeats` and R2 bucket `eyesforbeats-media`, then replace `REPLACE_WITH_D1_ID` in `wrangler.jsonc` with the real D1 ID. The `DB` and `MEDIA` bindings are defined there. Apply the schema with `npx wrangler d1 migrations apply eyesforbeats --local` for local development and `npx wrangler d1 migrations apply eyesforbeats --remote` for production. For local Pages development, place `DEV_USER_EMAIL=you@example.com` and (if testing generation) `OPENAI_API_KEY=...` in git-ignored `.dev.vars`, run `npm run build`, then `npx wrangler pages dev dist`. The development identity bypass works only on `localhost` or `127.0.0.1`; it cannot be used on a deployed host. Restart local dev with a different `DEV_USER_EMAIL` to test a second user.

The JSON API has `/api/me`, `/api/projects`, `/api/projects/:id`, nested archetype/look-preset creation and duplication, `/api/archetypes/:id`, `/api/look-presets/:id`, `/api/changes?since=<ISO>`, and content-addressed `/api/media/:sha256` (PUT/HEAD/GET). Project and record updates require `if_version`; stale writes return HTTP 409 with the current record. Shared projects can be edited by invited users, but only the owner can delete a project or change visibility. Media upload is capped at 50 MB and checked against its SHA-256 path. A user who uploads bytes already stored under that hash is recorded as another authorized uploader; merely knowing a private hash grants no access. D1 stores metadata; R2 stores media bytes.

### Sync and offline performances

`SyncedLibraryRepository` composes the local cache with the API. Setting edits are cached immediately, survive reload as dirty records and are pushed after about one second or on reconnect. Pull uses `/api/changes` with a ten-second overlap and version checks, polls every 30 seconds while visible, and also runs on focus, visibility changes and successful writes. Conflicts install the server version and offer **Restore my version**. Structural changes, sharing, imports and media creation require a connection. Before archetype creation, cached media are checked with HEAD and only missing hashes are uploaded; project opening downloads missing media. **Ready offline** means every referenced media blob is cached. An expired Access session leaves the cache usable and asks for a reload; **Sign out** uses `/cdn-cgi/access/logout`.

**Live Lock** (`L`) defers incoming changes for the active project during a performance while local edits continue to sync. Its badge counts deferred records. Unlocking writes them to the cache and applies their visual state when the performer next selects an archetype. On first authenticated launch after upgrading, the app offers to upload projects from the old `eyes4beat-library` database; IDs and media are retained and the old database is never deleted automatically.
