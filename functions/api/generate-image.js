const BASE_PROMPT = `Create one cinematic 16:9 visual for EyesForBeats, an abstract live-music visual instrument. The image must work as a full-screen performance background: no text, no logos, no frames, no UI, no recognizable brands. Use a strong central or flowing composition, deep blacks, rich dimensional detail and controlled highlights. Leave enough continuous texture for subtle zoom, distortion, glow and particle overlays. The image belongs to a coherent archetype sequence and should feel sophisticated, immersive and suitable for a concert projection.`;

const ANIMATION_SEQUENCE_PROMPT = `Create one keyframe from a continuous cinematic animation for EyesForBeats, an abstract live-music visual instrument. The complete image series must depict consecutive moments from one evolving scene, not independent variations of the same idea. Preserve the identity and geometry of the subjects, camera position, lens, framing, environment, spatial layout, materials, palette and lighting across every frame. Change only the temporal state of the movement. Each frame must advance the same motion trajectory by one clear, proportionate step so that playing the images in order or blending between them creates a believable continuous evolution. Avoid camera cuts, reframing, sudden transformations, new objects or unrelated compositions. No text, logos, borders, UI or recognizable brands. Keep the frame suitable for full-screen concert projection and for subtle zoom, distortion, glow and particle overlays.`;

const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high']);

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function imageBlob(base64, type = 'image/webp') {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) return json({ error: 'Image generation is not configured.' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const prompt = String(body.prompt || '').trim().slice(0, 1200);
  const quality = ALLOWED_QUALITIES.has(body.quality) ? body.quality : 'medium';
  const sequencePosition = Math.max(1, Math.min(6, Number(body.sequencePosition) || 1));
  const sequenceTotal = Math.max(sequencePosition, Math.min(6, Number(body.sequenceTotal) || 1));
  const stopMotion = body.stopMotion === true;
  const loop = stopMotion && body.loop === true;
  if (prompt.length < 8) return json({ error: 'Describe the visual direction in a little more detail.' }, 400);

  const sequenceInstruction = stopMotion
    ? `This is keyframe ${sequencePosition} of ${sequenceTotal} in one continuous animation. ${sequencePosition === 1 ? 'Establish the scene, the initial temporal state and one unambiguous motion trajectory that can progress through all remaining keyframes.' : 'The first supplied image is the immediately preceding keyframe. Preserve its visual structure and advance the same motion trajectory by one evenly spaced temporal step.'} ${loop ? (sequencePosition === sequenceTotal ? 'This is the final keyframe of a cycle. Use the supplied loop-origin image as the state that comes immediately after this frame: position every moving element so the transition from this final state back to the origin continues the same trajectory without a visible jump. Do not simply duplicate the origin.' : 'The animation is cyclic. Distribute the movement across the full sequence so it naturally continues from the final keyframe back to the origin.') : 'The animation is progressive and does not need to return to its starting state.'}`
    : `This is image ${sequencePosition} of ${sequenceTotal}. Keep the same visual identity, palette and subject family across the sequence, but create a distinct composition and moment.`;
  const fullPrompt = `${stopMotion ? ANIMATION_SEQUENCE_PROMPT : BASE_PROMPT}\n\nUser visual direction: ${prompt}\n\n${sequenceInstruction}`;
  const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
  let endpoint = 'https://api.openai.com/v1/images/generations';
  let requestBody;
  const headers = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };

  if (stopMotion && sequencePosition > 1 && body.previousImage) {
    endpoint = 'https://api.openai.com/v1/images/edits';
    const form = new FormData();
    form.append('model', model);form.append('prompt', fullPrompt);form.append('n', '1');form.append('size', '1536x1024');form.append('quality', quality);form.append('output_format', 'webp');form.append('output_compression', '86');
    form.append('image[]', imageBlob(body.previousImage), 'previous-frame.webp');
    if (loop && body.firstImage) form.append('image[]', imageBlob(body.firstImage), 'loop-origin.webp');
    requestBody = form;
  } else {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify({
      model,
      prompt: fullPrompt,
      n: 1,
      size: '1536x1024',
      quality,
      output_format: 'webp',
      output_compression: 86,
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: requestBody,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('OpenAI image generation failed', response.status, result?.error?.code || 'unknown');
    return json({ error: result?.error?.message || 'Image generation failed.' }, response.status >= 500 ? 502 : 400);
  }

  const image = result?.data?.[0];
  if (!image?.b64_json) return json({ error: 'The image provider returned no image.' }, 502);
  return json({ image: image.b64_json, mimeType: 'image/webp' });
}

export function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}
