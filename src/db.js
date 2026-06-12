const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://game:change-me-db-password@localhost:5432/game',
});

// Wait for postgres to accept connections, then apply the schema.
// schema.sql is idempotent, so this doubles as the migration step.
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  let lastErr;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await pool.query(schema);
      console.log('Database schema ready');
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

module.exports = { pool, init, query: (...args) => pool.query(...args) };
