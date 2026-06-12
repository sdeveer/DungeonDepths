// DOM panels: inventory, tooltips, toasts, death screen.
const UI = (() => {
  const $ = (sel) => document.querySelector(sel);

  const invPanel = $('#inv-panel');
  const tooltip = $('#tooltip');

  const KIND_ICONS = { weapon: '🗡️', armor: '🛡️', potion: '🧪' };
  const STAT_LABELS = {
    dmg: 'Damage', armor: 'Armor', str: 'Strength', int: 'Intellect',
    vit: 'Vitality', heal: 'Restores HP', mana: 'Restores Mana',
  };

  function toast(msg, color) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    if (color) el.style.color = color;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

  // ---------------------------------------------------------------------
  // Tooltip

  function showTooltip(item, x, y) {
    const color = Shared.RARITY[item.rarity].color;
    let html = `<div class="tt-name" style="color:${color}">${item.name}</div>`;
    html += `<div class="tt-kind">${item.rarity} ${item.kind}</div>`;
    for (const [k, v] of Object.entries(item.stats || {})) {
      html += `<div class="tt-stat">+${v} ${STAT_LABELS[k] || k}</div>`;
    }
    html += `<div class="hint">${item.kind === 'potion' ? 'Click to drink' : (item.equipped ? 'Click to unequip' : 'Click to equip')}</div>`;
    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    const rect = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(x - rect.width - 12, window.innerWidth - rect.width - 8)) + 'px';
    tooltip.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  }

  function hideTooltip() { tooltip.classList.add('hidden'); }

  // ---------------------------------------------------------------------
  // Inventory

  function cellFor(item) {
    const cell = document.createElement('div');
    cell.className = 'inv-cell' + (item.equipped ? ' equipped' : '');
    cell.textContent = KIND_ICONS[item.kind] || '?';
    cell.style.borderColor = item.equipped ? '#c8a24b' : Shared.RARITY[item.rarity].color + '55';
    cell.addEventListener('mouseenter', (ev) => showTooltip(item, ev.clientX, ev.clientY));
    cell.addEventListener('mousemove', (ev) => showTooltip(item, ev.clientX, ev.clientY));
    cell.addEventListener('mouseleave', hideTooltip);
    cell.addEventListener('click', (ev) => {
      hideTooltip();
      if (ev.shiftKey) Game.destroyItem(item);
      else Game.equipItem(item);
    });
    return cell;
  }

  function refreshInventory() {
    if (invPanel.classList.contains('hidden')) return;
    const S = Game.S;

    // Equipped slots.
    for (const kind of ['weapon', 'armor']) {
      const slot = $(`#slot-${kind} .slot-item`);
      const item = S.items.find((it) => it.equipped && it.kind === kind);
      if (item) {
        slot.textContent = item.name;
        slot.style.color = Shared.RARITY[item.rarity].color;
        slot.onmouseenter = (ev) => showTooltip(item, ev.clientX, ev.clientY);
        slot.onmouseleave = hideTooltip;
        slot.onclick = () => { hideTooltip(); Game.equipItem(item); };
      } else {
        slot.textContent = '— empty —';
        slot.style.color = '#4a4030';
        slot.onmouseenter = slot.onclick = null;
      }
    }

    // Stat sheet.
    const d = S.derived;
    $('#inv-stats').innerHTML = [
      `STR ${d.str}`, `INT ${d.int}`, `VIT ${d.vit}`,
      `Damage ${d.meleeDmg}`, `Armor ${d.armor}`, `Fireball ${d.fireballDmg}`,
      `HP ${Math.ceil(S.char.hp)}/${d.maxHp}`, `Mana ${Math.ceil(S.char.mana)}/${d.maxMana}`,
      `Gold ${S.char.gold}`,
    ].map((s) => `<span>${s}</span>`).join('');

    // Backpack grid (unequipped items).
    const grid = $('#inv-grid');
    grid.innerHTML = '';
    for (const item of S.items.filter((it) => !it.equipped)) {
      grid.appendChild(cellFor(item));
    }
    for (let i = S.items.filter((it) => !it.equipped).length; i < 24; i++) {
      const empty = document.createElement('div');
      empty.className = 'inv-cell';
      empty.style.cursor = 'default';
      grid.appendChild(empty);
    }
  }

  function toggleInventory() {
    invPanel.classList.toggle('hidden');
    hideTooltip();
    refreshInventory();
  }

  function hideInventory() {
    invPanel.classList.add('hidden');
    hideTooltip();
  }

  // ---------------------------------------------------------------------
  // Death screen

  function showDeath(stats) {
    $('#death-stats').innerHTML =
      `You fell on <b>depth ${stats.depth}</b> at <b>level ${stats.level}</b>.<br>` +
      `Monsters slain: <b>${stats.kills}</b><br>` +
      `Gold lost: <b style="color:#d8584a">${stats.goldLost}</b> · ` +
      `Gold remaining: <b style="color:#ffd34d">${stats.gold}</b>`;
    $('#screen-death').classList.remove('hidden');
    hideInventory();
  }

  function hideDeath() { $('#screen-death').classList.add('hidden'); }

  return { toast, refreshInventory, toggleInventory, hideInventory, showDeath, hideDeath };
})();
