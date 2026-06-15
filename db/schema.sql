-- Dungeon Depths schema. Applied automatically by the server on startup
-- (every statement is idempotent, so re-running is safe).

CREATE TABLE IF NOT EXISTS accounts (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
    id         SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    class      TEXT NOT NULL CHECK (class IN ('warrior', 'mage', 'rogue')),
    level      INTEGER NOT NULL DEFAULT 1,
    xp         INTEGER NOT NULL DEFAULT 0,
    gold       INTEGER NOT NULL DEFAULT 25,
    hp         INTEGER NOT NULL,
    mana       INTEGER NOT NULL,
    depth      INTEGER NOT NULL DEFAULT 0,
    max_depth  INTEGER NOT NULL DEFAULT 0,
    pos_x      REAL NOT NULL DEFAULT 0,
    pos_y      REAL NOT NULL DEFAULT 0,
    seed       INTEGER NOT NULL,
    deaths     INTEGER NOT NULL DEFAULT 0,
    kills      INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS items (
    id           SERIAL PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('weapon', 'armor', 'potion')),
    name         TEXT NOT NULL,
    rarity       TEXT NOT NULL CHECK (rarity IN ('common', 'magic', 'rare', 'legendary')),
    stats        JSONB NOT NULL DEFAULT '{}',
    equipped     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skill-tree ranks per character: { "<skillId>": rank, ... }. Added here
-- (idempotent) so existing databases pick it up on the next boot.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
CREATE INDEX IF NOT EXISTS idx_items_character ON items(character_id);
