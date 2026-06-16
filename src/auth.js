const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// A throwaway hash compared against when a username doesn't exist, so login
// takes the same time whether or not the account is real (no timing oracle).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Lightweight in-memory throttle for auth endpoints: a per-key sliding
// window. Keyed by client IP to blunt online brute force and mass signup.
const attempts = new Map();
function throttle(key, max, windowMs) {
  const now = Date.now();
  let rec = attempts.get(key);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; attempts.set(key, rec); }
  rec.count += 1;
  return rec.count <= max;
}
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
}, 60000);
if (sweep.unref) sweep.unref();

function requireAuth(req, res, next) {
  if (!req.session || !req.session.accountId) {
    return res.status(401).json({ error: 'not logged in' });
  }
  next();
}

router.post('/register', async (req, res, next) => {
  try {
    if (!throttle(`reg:${req.ip}`, 5, 60000)) {
      return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    const { username, password } = req.body || {};
    if (!USERNAME_RE.test(username || '')) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, digits or _' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    req.session.accountId = rows[0].id;
    req.session.username = rows[0].username;
    res.json({ username: rows[0].username });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    if (!throttle(`login:${req.ip}`, 10, 60000)) {
      return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    const { username, password } = req.body || {};
    const { rows } = await db.query('SELECT * FROM accounts WHERE username = $1', [username || '']);
    // Always run a comparison (against a dummy hash when the user is unknown)
    // so timing doesn't reveal whether the username exists.
    const hash = rows.length > 0 ? rows[0].password_hash : DUMMY_HASH;
    const match = await bcrypt.compare(password || '', hash);
    if (!rows.length || !match) return res.status(401).json({ error: 'Invalid username or password' });
    req.session.accountId = rows[0].id;
    req.session.username = rows[0].username;
    res.json({ username: rows[0].username });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.accountId) return res.json({ user: null });
  res.json({ user: { username: req.session.username } });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
