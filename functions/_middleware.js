import { getUser } from './_lib/auth.js';

export async function onRequest(context) {
  try {
    context.data.user = await getUser(context.request, context.env);
  } catch {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required.' } }), {
      status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const response = await context.next();
  const protectedResponse = new Response(response.body, response);
  const mediaRead = /^\/api\/media\/[a-f\d]{64}$/i.test(new URL(context.request.url).pathname) &&
    ['GET', 'HEAD'].includes(context.request.method) && protectedResponse.ok;
  if (!mediaRead) protectedResponse.headers.set('Cache-Control', 'private, no-store');
  return protectedResponse;
}
