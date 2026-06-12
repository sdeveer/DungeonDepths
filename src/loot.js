// Server-side loot generation. All item stats are rolled here so clients
// can never fabricate gear.
const Shared = require('../public/js/shared');

const WEAPON_BASES = ['Short Sword', 'War Axe', 'Iron Mace', 'Bone Staff', 'Cleaver', 'Great Blade', 'Dirk'];
const ARMOR_BASES = ['Leather Vest', 'Chain Shirt', 'Scale Mail', 'Dark Robe', 'Plate Cuirass', 'Bone Harness'];
const PREFIX = { magic: 'Fine', rare: 'Runed', legendary: 'Ancient' };
const SUFFIXES = ['of the Bear', 'of Embers', 'of the Fox', 'of Blood', 'of the Crypt', 'of Storms'];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rollRarity(bossBonus) {
  const r = Math.random() * (bossBonus ? 0.55 : 1); // bosses skip most common rolls
  if (r < 0.03) return 'legendary';
  if (r < 0.13) return 'rare';
  if (r < 0.40) return 'magic';
  return 'common';
}

const AFFIX_POOL = ['str', 'int', 'vit', 'armor'];

function rollEquipment(depth, bossBonus) {
  const rarity = rollRarity(bossBonus);
  const mult = Shared.RARITY[rarity].mult;
  const kind = Math.random() < 0.5 ? 'weapon' : 'armor';
  const stats = {};

  if (kind === 'weapon') {
    stats.dmg = Math.max(1, Math.round((2 + depth * 1.3) * mult * rand(0.8, 1.2)));
  } else {
    stats.armor = Math.max(1, Math.round((2 + depth * 1.1) * mult * rand(0.8, 1.2)));
  }

  const affixCount = { common: 0, magic: 1, rare: 2, legendary: 3 }[rarity];
  const pool = [...AFFIX_POOL];
  for (let i = 0; i < affixCount; i++) {
    const affix = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const value = Math.max(1, Math.round((1 + depth * 0.5) * mult * rand(0.7, 1.3)));
    stats[affix] = (stats[affix] || 0) + value;
  }

  let name = kind === 'weapon' ? pick(WEAPON_BASES) : pick(ARMOR_BASES);
  if (PREFIX[rarity]) name = `${PREFIX[rarity]} ${name}`;
  if (rarity === 'rare' || rarity === 'legendary') name = `${name} ${pick(SUFFIXES)}`;

  return { kind, name, rarity, stats };
}

function rollPotion(depth) {
  if (Math.random() < 0.6) {
    return { kind: 'potion', name: 'Health Potion', rarity: 'common', stats: { heal: 35 + depth * 9 } };
  }
  return { kind: 'potion', name: 'Mana Potion', rarity: 'common', stats: { mana: 25 + depth * 6 } };
}

// Returns a list of items dropped for one kill (may be empty).
function rollKillLoot(depth, isBoss) {
  const drops = [];
  if (isBoss) {
    drops.push(rollEquipment(depth, true));
    drops.push(rollPotion(depth));
  } else {
    if (Math.random() < 0.20) drops.push(rollEquipment(depth, false));
    if (Math.random() < 0.14) drops.push(rollPotion(depth));
  }
  return drops;
}

function rollGold(depth, isBoss) {
  const base = randInt(2, 7) * (1 + depth * 0.4);
  return Math.round(isBoss ? base * 8 : base);
}

function starterItems(cls) {
  const weapons = {
    warrior: { kind: 'weapon', name: 'Rusty Sword', rarity: 'common', stats: { dmg: 3 } },
    mage:    { kind: 'weapon', name: 'Gnarled Staff', rarity: 'common', stats: { dmg: 2, int: 1 } },
    rogue:   { kind: 'weapon', name: 'Bent Dagger', rarity: 'common', stats: { dmg: 2 } },
  };
  return [
    { ...weapons[cls], equipped: true },
    { kind: 'potion', name: 'Health Potion', rarity: 'common', stats: { heal: 35 }, equipped: false },
    { kind: 'potion', name: 'Health Potion', rarity: 'common', stats: { heal: 35 }, equipped: false },
  ];
}

module.exports = { rollKillLoot, rollGold, starterItems };
