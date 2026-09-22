import { serveApi } from './service.js';

export async function handleApi(context) {
  return serveApi(context.request, context.env.DB, context.env.MEDIA, context.data.user);
}
