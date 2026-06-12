const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function requireAuth(req, res, next) {
  if (!req.session || !req.session.accountId) {
    return res.status(401).json({ error: 'not logged in' });
  }
  next();
}

router.post('/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!USERNAME_RE.test(username || '')) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, digits or _' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
    const { username, password } = req.body || {};
    const { rows } = await db.query('SELECT * FROM accounts WHERE username = $1', [username || '']);
    const ok = rows.length > 0 && await bcrypt.compare(password || '', rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
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
