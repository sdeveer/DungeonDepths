// Shared balance formulas — single source of truth, loaded by BOTH the
// Node server (require) and the browser (script tag, as window.Shared).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const CLASSES = {
    warrior: {
      label: 'Warrior',
      base:   { str: 10, int: 4,  vit: 11 },
      growth: { str: 3,  int: 1,  vit: 2 },
      attackSpeed: 1.0, moveSpeed: 4.2,
    },
    mage: {
      label: 'Mage',
      base:   { str: 4,  int: 13, vit: 7 },
      growth: { str: 1,  int: 3,  vit: 1.5 },
      attackSpeed: 0.9, moveSpeed: 4.2,
    },
    rogue: {
      label: 'Rogue',
      base:   { str: 7,  int: 7,  vit: 8 },
      growth: { str: 2,  int: 2,  vit: 1.5 },
      attackSpeed: 1.5, moveSpeed: 4.8,
    },
  };

  // XP required to go from `level` to `level + 1`.
  function xpForLevel(level) {
    return Math.floor(45 * Math.pow(level, 1.5));
  }

  // Attribute totals for a class at a level, before items.
  function baseAttributes(cls, level) {
    const c = CLASSES[cls];
    return {
      str: Math.floor(c.base.str + c.growth.str * (level - 1)),
      int: Math.floor(c.base.int + c.growth.int * (level - 1)),
      vit: Math.floor(c.base.vit + c.growth.vit * (level - 1)),
    };
  }

  // Full derived sheet for a character with a list of equipped items.
  function derive(cls, level, equippedItems) {
    const a = baseAttributes(cls, level);
    let weaponDmg = 0, armor = 0;
    for (const it of equippedItems || []) {
      const s = it.stats || {};
      a.str += s.str || 0;
      a.int += s.int || 0;
      a.vit += s.vit || 0;
      weaponDmg += s.dmg || 0;
      armor += s.armor || 0;
    }
    return {
      str: a.str, int: a.int, vit: a.vit, armor,
      maxHp: 70 + a.vit * 7,
      maxMana: 25 + a.int * 5,
      meleeDmg: 5 + Math.round(a.str * 1.3) + weaponDmg,
      fireballDmg: 10 + Math.round(a.int * 1.8),
      healAmount: 25 + a.int * 2,
      attackSpeed: CLASSES[cls].attackSpeed,
      moveSpeed: CLASSES[cls].moveSpeed,
      hpRegen: 0.6 + a.vit * 0.02,
      manaRegen: 1.2 + a.int * 0.06,
    };
  }

  const FIREBALL_COST = 10;
  const HEAL_COST = 14;

  const ENEMIES = {
    // Originals
    skeleton: { hp: 22,  dmg: 5,  xp: 9,   speed: 3.4, range: 1.3, label: 'Skeleton' },
    zombie:   { hp: 42,  dmg: 8,  xp: 12,  speed: 1.7, range: 1.3, label: 'Zombie' },
    demon:    { hp: 30,  dmg: 7,  xp: 16,  speed: 2.6, range: 6.0, label: 'Demon', ranged: true, projectile: 'shadowbolt' },
    boss:     { hp: 260, dmg: 14, xp: 130, speed: 2.4, range: 1.7, label: 'Dungeon Lord' },
    // The Catacombs
    ghoul:    { hp: 28,  dmg: 6,  xp: 11,  speed: 3.9, range: 1.3, label: 'Ghoul' },
    archer:   { hp: 20,  dmg: 6,  xp: 13,  speed: 2.6, range: 7.0, label: 'Skeleton Archer', ranged: true, projectile: 'arrow' },
    wraith:   { hp: 18,  dmg: 7,  xp: 14,  speed: 4.3, range: 1.4, label: 'Wraith' },
    // The Hollow Caves
    spider:   { hp: 24,  dmg: 5,  xp: 12,  speed: 4.7, range: 1.2, label: 'Cave Spider' },
    goblin:   { hp: 34,  dmg: 7,  xp: 13,  speed: 3.1, range: 1.3, label: 'Goblin' },
    bat:      { hp: 14,  dmg: 4,  xp: 10,  speed: 5.0, range: 1.2, label: 'Giant Bat' },
    troll:    { hp: 75,  dmg: 12, xp: 24,  speed: 1.6, range: 1.6, label: 'Cave Troll' },
    // The Drowned Halls
    drowned:  { hp: 62,  dmg: 10, xp: 21,  speed: 1.5, range: 1.3, label: 'Drowned Dead' },
    lurker:   { hp: 40,  dmg: 9,  xp: 18,  speed: 2.9, range: 1.4, label: 'Deep Lurker' },
    slime:    { hp: 52,  dmg: 6,  xp: 15,  speed: 1.3, range: 1.2, label: 'Ooze' },
    // The Burning Depths
    imp:      { hp: 22,  dmg: 8,  xp: 17,  speed: 3.0, range: 6.0, label: 'Imp', ranged: true, projectile: 'firebolt' },
    hellhound:{ hp: 32,  dmg: 10, xp: 19,  speed: 5.0, range: 1.3, label: 'Hellhound' },
    brute:    { hp: 95,  dmg: 16, xp: 30,  speed: 1.8, range: 1.7, label: 'Demon Brute' },
  };

  // Difficulty scaling with dungeon depth.
  function enemyStats(type, depth) {
    const base = ENEMIES[type];
    const mult = 1 + 0.35 * Math.max(0, depth - 1);
    return {
      ...base,
      hp: Math.round(base.hp * mult),
      dmg: Math.round(base.dmg * (1 + 0.22 * Math.max(0, depth - 1))),
      xp: Math.round(base.xp * (1 + 0.30 * Math.max(0, depth - 1))),
    };
  }

  // Damage reduction from armor (diminishing returns, capped at 70%).
  function mitigate(dmg, armor) {
    const reduction = Math.min(0.7, armor / (armor + 40));
    return Math.max(1, Math.round(dmg * (1 - reduction)));
  }

  const RARITY = {
    common:    { color: '#d8d8d8', mult: 1.0 },
    magic:     { color: '#6b8cff', mult: 1.2 },
    rare:      { color: '#ffd34d', mult: 1.45 },
    legendary: { color: '#ff9a3d', mult: 1.8 },
  };

  // Battle skills per class. Three active skills each (keys Q/W/E); a
  // universal Heal sits on R. `kind` selects the mechanic in game.js, `mult`
  // scales the relevant base damage (fireballDmg for the mage, meleeDmg
  // otherwise). Used by both the client (cast logic, HUD) — single source.
  const SKILLS = {
    warrior: [
      { id: 'cleave', key: 'Q', name: 'Cleave',     icon: '🪓', cost: 5,  cd: 1.0, pose: 'cleave', kind: 'arc',        mult: 1.4, range: 2.4, arc: 1.3 },
      { id: 'whirl',  key: 'W', name: 'Whirlwind',  icon: '🌀', cost: 12, cd: 3.2, pose: 'whirl',  kind: 'nova',       mult: 1.0, radius: 2.7 },
      { id: 'leap',   key: 'E', name: 'Leap Slam',  icon: '⬇️', cost: 14, cd: 5.0, pose: 'leap',   kind: 'leap',       mult: 1.7, radius: 2.3, reach: 5 },
    ],
    mage: [
      { id: 'fireball', key: 'Q', name: 'Fireball',   icon: '🔥', cost: 10, cd: 0.6, pose: 'cast',  kind: 'projectile', mult: 1.0,  speed: 11 },
      { id: 'frost',    key: 'W', name: 'Frost Nova', icon: '❄️', cost: 16, cd: 4.0, pose: 'frost', kind: 'nova',       mult: 0.85, radius: 3.3, slow: 2.5 },
      { id: 'bolt',     key: 'E', name: 'Chain Bolt', icon: '⚡', cost: 14, cd: 1.5, pose: 'bolt',  kind: 'pierce',     mult: 0.95, speed: 17 },
    ],
    rogue: [
      { id: 'fan',    key: 'Q', name: 'Fan of Knives', icon: '🔪', cost: 7,  cd: 0.9, pose: 'fan',    kind: 'spread', mult: 0.7,  speed: 12, count: 5, spread: 0.95 },
      { id: 'dash',   key: 'W', name: 'Shadow Dash',   icon: '💨', cost: 11, cd: 2.4, pose: 'dash',   kind: 'dash',   mult: 1.3,  reach: 5, width: 1.2 },
      { id: 'flurry', key: 'E', name: 'Blade Flurry',  icon: '🗡', cost: 9,  cd: 1.8, pose: 'flurry', kind: 'flurry', mult: 0.55, hits: 5, range: 2.0 },
    ],
  };

  // Skill tree: each class skill can be ranked 1..SKILL_MAX_RANK by spending
  // points earned on level-up (one per level). A skill at rank 0 is unlearned
  // and cannot be cast. Higher ranks scale a skill's damage.
  const SKILL_MAX_RANK = 5;

  // Damage multiplier for a skill at a given rank (rank 1 = base, +30%/rank).
  function skillMult(skill, rank) {
    return skill.mult * (1 + 0.3 * Math.max(0, rank - 1));
  }
  // Total points earned by a level (1 per level; level 1 starts with one).
  function skillPointsTotal(level) { return level; }
  function skillPointsSpent(skills) {
    let s = 0;
    for (const k in (skills || {})) s += skills[k];
    return s;
  }
  function skillPointsAvailable(level, skills) {
    return Math.max(0, skillPointsTotal(level) - skillPointsSpent(skills));
  }

  return {
    CLASSES, ENEMIES, RARITY, SKILLS, SKILL_MAX_RANK,
    FIREBALL_COST, HEAL_COST,
    xpForLevel, baseAttributes, derive, enemyStats, mitigate,
    skillMult, skillPointsTotal, skillPointsSpent, skillPointsAvailable,
  };
});
