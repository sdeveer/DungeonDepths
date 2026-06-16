const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const db = require('./db');
const authRoutes = require('./auth');
const gameRoutes = require('./game');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// Refuse to run with a weak/default session secret in production: a known
// signing key lets anyone forge a session cookie for any account. In dev we
// only warn, so local play still works out of the box.
const SECRET = process.env.SESSION_SECRET || '';
const WEAK_SECRET = SECRET.length < 16 ||
  SECRET === 'change-me-to-a-long-random-string' ||
  SECRET === 'dev-secret-change-me';
if (WEAK_SECRET) {
  const msg = 'SESSION_SECRET is missing, default, or too short (need >= 16 random chars)';
  if (PROD) { console.error(`FATAL: ${msg}. Refusing to start.`); process.exit(1); }
  console.warn(`WARNING: ${msg}. Set a strong SESSION_SECRET before deploying.`);
}

// Conservative security headers. The CSP matches this app exactly: scripts
// and styles are same-origin, images are self or data: URIs, and the page
// may not be framed (clickjacking).
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  next();
}

async function main() {
  await db.init();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // honor X-Forwarded-* from a TLS-terminating proxy
  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieSession({
    name: 'sid',
    keys: [SECRET || 'dev-insecure-secret'],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    // Set SECURE_COOKIES=true when serving over HTTPS (behind a TLS proxy).
    secure: process.env.SECURE_COOKIES === 'true',
  }));

  app.use('/api', authRoutes);
  app.use('/api', gameRoutes);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  app.listen(PORT, () => console.log(`Dungeon Depths listening on :${PORT}`));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
