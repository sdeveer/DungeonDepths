const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const db = require('./db');
const authRoutes = require('./auth');
const gameRoutes = require('./game');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

async function main() {
  await db.init();

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieSession({
    name: 'sid',
    keys: [SECRET],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
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
