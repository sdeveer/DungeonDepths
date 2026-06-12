const express = require('express');
const db = require('./db');
const loot = require('./loot');
const Shared = require('../public/js/shared');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const MAX_INVENTORY = 40;

// ---------------------------------------------------------------------------
// Helpers

async function loadCharacter(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'bad character id' });
    return null;
  }
  const { rows } = await db.query(
    'SELECT * FROM characters WHERE id = $1 AND account_id = $2',
    [id, req.session.accountId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'character not found' });
    return null;
  }
  return rows[0];
}

async function equippedItems(charId) {
  const { rows } = await db.query(
    'SELECT * FROM items WHERE character_id = $1 AND equipped = true', [charId]
  );
  return rows;
}

async function deriveFor(char) {
  return Shared.derive(char.class, char.level, await equippedItems(char.id));
}

function publicChar(char) {
  return {
    id: char.id, name: char.name, class: char.class,
    level: char.level, xp: char.xp, xpNext: Shared.xpForLevel(char.level),
    gold: char.gold, hp: char.hp, mana: char.mana,
    depth: char.depth, maxDepth: char.max_depth,
    posX: char.pos_x, posY: char.pos_y, seed: char.seed,
    deaths: char.deaths, kills: char.kills,
  };
}

// Token bucket per character to stop kill-spam cheating: at most ~2.5
// validated kills per second sustained, burst of 6 (a fireball can clear
// a small pack at once).
const killBuckets = new Map();
function allowKill(charId) {
  const now = Date.now();
  let b = killBuckets.get(charId);
  if (!b) { b = { tokens: 6, last: now }; killBuckets.set(charId, b); }
  b.tokens = Math.min(6, b.tokens + (now - b.last) / 1000 * 2.5);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------------------
// Characters

router.get('/characters', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, class, level, depth, max_depth, gold, seed
         FROM characters WHERE account_id = $1 ORDER BY created_at`,
      [req.session.accountId]
    );
    res.json({ characters: rows });
  } catch (err) { next(err); }
});

router.post('/characters', async (req, res, next) => {
  try {
    const { name, class: cls } = req.body || {};
    if (typeof name !== 'string' || !/^[a-zA-Z0-9 _-]{2,16}$/.test(name.trim())) {
      return res.status(400).json({ error: 'Name must be 2-16 letters/digits' });
    }
    if (!Shared.CLASSES[cls]) return res.status(400).json({ error: 'Invalid class' });

    const derived = Shared.derive(cls, 1, []);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const { rows } = await db.query(
      `INSERT INTO characters (account_id, name, class, hp, mana, seed)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.session.accountId, name.trim(), cls, derived.maxHp, derived.maxMana, seed]
    );
    const char = rows[0];
    for (const it of loot.starterItems(cls)) {
      await db.query(
        'INSERT INTO items (character_id, kind, name, rarity, stats, equipped) VALUES ($1,$2,$3,$4,$5,$6)',
        [char.id, it.kind, it.name, it.rarity, JSON.stringify(it.stats), it.equipped]
      );
    }
    res.json({ character: publicChar(char) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You already have a character with that name' });
    next(err);
  }
});

router.delete('/characters/:id', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    await db.query('DELETE FROM characters WHERE id = $1', [char.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/characters/:id', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const { rows: items } = await db.query(
      'SELECT id, kind, name, rarity, stats, equipped FROM items WHERE character_id = $1 ORDER BY id',
      [char.id]
    );
    res.json({ character: publicChar(char), items });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Saves. Only transient state is client-writable; xp/gold/level/items are
// owned by the server. hp/mana are clamped to the server-derived maximums.

router.post('/characters/:id/save', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const { hp, mana, depth, x, y } = req.body || {};
    const derived = await deriveFor(char);

    const newDepth = Number.isInteger(depth)
      ? Math.max(0, Math.min(depth, char.max_depth + 1))
      : char.depth;
    const newHp = Math.max(0, Math.min(Math.round(Number(hp) || 0), derived.maxHp));
    const newMana = Math.max(0, Math.min(Math.round(Number(mana) || 0), derived.maxMana));

    await db.query(
      `UPDATE characters SET hp=$1, mana=$2, depth=$3, max_depth=GREATEST(max_depth,$3),
              pos_x=$4, pos_y=$5, updated_at=now() WHERE id=$6`,
      [newHp, newMana, newDepth, Number(x) || 0, Number(y) || 0, char.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Kills: the client reports a kill, the server decides the rewards based on
// its own record of the character's depth — never trusting client numbers.

router.post('/characters/:id/kill', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const { type } = req.body || {};
    if (!Shared.ENEMIES[type]) return res.status(400).json({ error: 'unknown enemy type' });
    if (!allowKill(char.id)) return res.status(429).json({ error: 'too many kills reported' });

    const isBoss = type === 'boss';
    const depth = Math.max(1, char.depth);
    if (isBoss && depth % 5 !== 0) return res.status(400).json({ error: 'no boss at this depth' });

    const xpGain = Shared.enemyStats(type, depth).xp;
    const goldGain = loot.rollGold(depth, isBoss);

    // Apply XP and resolve level-ups server-side.
    let level = char.level;
    let xp = char.xp + xpGain;
    let leveledUp = false;
    while (xp >= Shared.xpForLevel(level)) {
      xp -= Shared.xpForLevel(level);
      level++;
      leveledUp = true;
    }

    // Roll loot; respect the inventory cap.
    const { rows: countRows } = await db.query(
      'SELECT count(*)::int AS n FROM items WHERE character_id = $1', [char.id]
    );
    let slotsFree = MAX_INVENTORY - countRows[0].n;
    const droppedItems = [];
    for (const it of loot.rollKillLoot(depth, isBoss)) {
      if (slotsFree <= 0) break;
      slotsFree--;
      const { rows } = await db.query(
        `INSERT INTO items (character_id, kind, name, rarity, stats)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, kind, name, rarity, stats, equipped`,
        [char.id, it.kind, it.name, it.rarity, JSON.stringify(it.stats)]
      );
      droppedItems.push(rows[0]);
    }

    await db.query(
      `UPDATE characters SET xp=$1, level=$2, gold=gold+$3, kills=kills+1, updated_at=now()
       WHERE id=$4`,
      [xp, level, goldGain, char.id]
    );

    res.json({ xpGain, goldGain, gold: char.gold + goldGain, xp, level, xpNext: Shared.xpForLevel(level), leveledUp, items: droppedItems });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Death: lose 15% of gold, return to town (depth 0).

router.post('/characters/:id/death', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const goldLost = Math.floor(char.gold * 0.15);
    const derived = await deriveFor(char);
    await db.query(
      `UPDATE characters SET gold=gold-$1, depth=0, hp=$2, mana=$3, deaths=deaths+1,
              pos_x=0, pos_y=0, updated_at=now() WHERE id=$4`,
      [goldLost, derived.maxHp, derived.maxMana, char.id]
    );
    res.json({ goldLost, gold: char.gold - goldLost, deaths: char.deaths + 1 });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Inventory

async function loadItem(req, res, char) {
  const itemId = parseInt(req.params.itemId, 10);
  const { rows } = await db.query(
    'SELECT * FROM items WHERE id = $1 AND character_id = $2', [itemId, char.id]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'item not found' });
    return null;
  }
  return rows[0];
}

router.post('/characters/:id/items/:itemId/equip', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const item = await loadItem(req, res, char);
    if (!item) return;
    if (item.kind === 'potion') return res.status(400).json({ error: 'potions cannot be equipped' });

    await db.query(
      'UPDATE items SET equipped=false WHERE character_id=$1 AND kind=$2', [char.id, item.kind]
    );
    await db.query('UPDATE items SET equipped=true WHERE id=$1', [item.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/characters/:id/items/:itemId/unequip', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const item = await loadItem(req, res, char);
    if (!item) return;
    await db.query('UPDATE items SET equipped=false WHERE id=$1', [item.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Drinking a potion consumes it; the effect amount comes from the server.
router.post('/characters/:id/items/:itemId/use', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const item = await loadItem(req, res, char);
    if (!item) return;
    if (item.kind !== 'potion') return res.status(400).json({ error: 'not a potion' });

    await db.query('DELETE FROM items WHERE id=$1', [item.id]);
    const derived = await deriveFor(char);
    const heal = item.stats.heal || 0;
    const mana = item.stats.mana || 0;
    const newHp = Math.min(derived.maxHp, char.hp + heal);
    const newMana = Math.min(derived.maxMana, char.mana + mana);
    await db.query('UPDATE characters SET hp=$1, mana=$2 WHERE id=$3', [newHp, newMana, char.id]);
    res.json({ hp: newHp, mana: newMana, heal, manaGain: mana });
  } catch (err) { next(err); }
});

router.delete('/characters/:id/items/:itemId', async (req, res, next) => {
  try {
    const char = await loadCharacter(req, res);
    if (!char) return;
    const item = await loadItem(req, res, char);
    if (!item) return;
    await db.query('DELETE FROM items WHERE id=$1', [item.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
