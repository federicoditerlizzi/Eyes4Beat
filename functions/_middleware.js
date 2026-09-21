function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="EyesForBeats", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const expectedUser = context.env.BASIC_AUTH_USERNAME;
  const expectedPassword = context.env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return new Response('Authentication is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const header = context.request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized();

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (separator < 0 || username !== expectedUser || password !== expectedPassword) return unauthorized();
  } catch {
    return unauthorized();
  }

  const response = await context.next();
  const protectedResponse = new Response(response.body, response);
  protectedResponse.headers.set('Cache-Control', 'private, no-store');
  return protectedResponse;
}
