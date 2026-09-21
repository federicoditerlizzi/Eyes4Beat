import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/generate-image.js';

function request(body) {
  return new Request('https://example.test/api/generate-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('image generation requires a configured API key', async () => {
  const response = await onRequestPost({ request: request({ prompt: 'A detailed nebula' }), env: {} });
  assert.equal(response.status, 503);
});

test('image generation validates short prompts before calling the provider', async () => {
  const response = await onRequestPost({ request: request({ prompt: 'short' }), env: { OPENAI_API_KEY: 'test' } });
  assert.equal(response.status, 400);
});

test('image generation constrains provider options and returns the image', async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_url, options) => {
    providerBody = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
  };
  try {
    const response = await onRequestPost({
      request: request({ prompt: 'Translucent violet organisms floating in darkness', quality: 'invalid', sequencePosition: 2, sequenceTotal: 4 }),
      env: { OPENAI_API_KEY: 'test' },
    });
    assert.equal(response.status, 200);
    assert.equal(providerBody.n, 1);
    assert.equal(providerBody.quality, 'medium');
    assert.equal(providerBody.size, '1536x1024');
    assert.match(providerBody.prompt, /image 2 of 4/i);
    assert.deepEqual(await response.json(), { image: 'aW1hZ2U=', mimeType: 'image/webp' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('animation keyframes edit the previous image and optionally reference the loop origin', async () => {
  const originalFetch = globalThis.fetch;
  let providerUrl;
  let providerBody;
  globalThis.fetch = async (url, options) => {
    providerUrl = url;providerBody = options.body;
    return Response.json({ data: [{ b64_json: 'ZnJhbWU=' }] });
  };
  try {
    const response = await onRequestPost({
      request: request({
        prompt: 'A clay creature slowly opening like a flower', quality: 'low', sequencePosition: 4, sequenceTotal: 4,
        stopMotion: true, loop: true, previousImage: 'cHJldmlvdXM=', firstImage: 'b3JpZ2lu',
      }),
      env: { OPENAI_API_KEY: 'test' },
    });
    assert.equal(response.status, 200);
    assert.match(providerUrl, /images\/edits$/);
    assert.ok(providerBody instanceof FormData);
    assert.equal(providerBody.getAll('image[]').length, 2);
    assert.match(providerBody.get('prompt'), /continuous cinematic animation/i);
    assert.match(providerBody.get('prompt'), /final keyframe/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
