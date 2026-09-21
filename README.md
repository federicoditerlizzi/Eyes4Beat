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
