import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

export async function getUser(request, env, options = {}) {
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (local && env.DEV_USER_EMAIL) return { email: String(env.DEV_USER_EMAIL).trim().toLowerCase() };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const audiences = list(env.ACCESS_AUD);
  const allowed = list(env.ALLOWED_EMAILS).map(email => email.toLowerCase());
  if (!token || !domain || !audiences.length || !allowed.length || !/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(domain))
    throw new Error('Access is not configured or token is missing');
  const url = new URL(`https://${domain}/cdn-cgi/access/certs`);
  const jwks = options.jwks || keySets.get(domain) || createRemoteJWKSet(url);
  if (!options.jwks) keySets.set(domain, jwks);
  const { payload } = await jwtVerify(token, jwks, { audience: audiences, issuer: `https://${domain}` });
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !allowed.includes(email)) throw new Error('Email is not allowed');
  return { email };
}
