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
    skeleton: { hp: 22,  dmg: 5,  xp: 9,   speed: 3.4, range: 1.3, label: 'Skeleton' },
    zombie:   { hp: 42,  dmg: 8,  xp: 12,  speed: 1.7, range: 1.3, label: 'Zombie' },
    demon:    { hp: 30,  dmg: 7,  xp: 16,  speed: 2.6, range: 6.0, label: 'Demon' },
    boss:     { hp: 260, dmg: 14, xp: 130, speed: 2.4, range: 1.7, label: 'Dungeon Lord' },
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

  return {
    CLASSES, ENEMIES, RARITY,
    FIREBALL_COST, HEAL_COST,
    xpForLevel, baseAttributes, derive, enemyStats, mitigate,
  };
});
