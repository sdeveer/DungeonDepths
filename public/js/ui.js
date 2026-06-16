// DOM panels: inventory, tooltips, toasts, death screen.
const UI = (() => {
  const $ = (sel) => document.querySelector(sel);

  const invPanel = $('#inv-panel');
  const skillPanel = $('#skill-panel');
  const tooltip = $('#tooltip');

  const SKILL_DESC = {
    cleave: 'A wide forward swing striking all foes in an arc.',
    whirl: 'Spin to strike every enemy around you.',
    leap: 'Leap to the cursor and crash down, damaging all nearby.',
    fireball: 'Hurl a bolt of flame that bursts on impact.',
    frost: 'A frozen blast that damages and chills nearby foes.',
    bolt: 'A bolt of lightning that pierces every enemy in a line.',
    fan: 'Throw a spread of daggers in a fan.',
    dash: 'Blink forward, cutting every enemy in your path.',
    flurry: 'A rapid storm of dagger strikes on a target.',
  };

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

  // Escape any HTML metacharacters before interpolating into innerHTML.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showTooltip(item, x, y) {
    const color = Shared.RARITY[item.rarity].color;
    let html = `<div class="tt-name" style="color:${color}">${esc(item.name)}</div>`;
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
    if (!invPanel.classList.contains('hidden')) hideSkillTree();
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

  // ---------------------------------------------------------------------
  // Skill tree

  function rankPips(rank, max) {
    let s = '';
    for (let i = 0; i < max; i++) s += i < rank ? '◆' : '◇';
    return s;
  }

  function refreshSkillTree() {
    if (!skillPanel || skillPanel.classList.contains('hidden')) return;
    const S = Game.S;
    if (!S.char) return;
    const cls = S.char.class;
    const skills = Shared.SKILLS[cls] || [];
    const owned = S.char.skills || {};
    const avail = Shared.skillPointsAvailable(S.char.level, owned);
    const base = S.derived ? (cls === 'mage' ? S.derived.fireballDmg : S.derived.meleeDmg) : 0;

    $('#skill-points').innerHTML =
      `Skill points: <b class="${avail > 0 ? 'pts-have' : ''}">${avail}</b>`;

    const list = $('#skill-list');
    list.innerHTML = '';
    for (const sk of skills) {
      const rank = owned[sk.id] || 0;
      const maxed = rank >= Shared.SKILL_MAX_RANK;
      const row = document.createElement('div');
      row.className = 'skill-row' + (rank === 0 ? ' locked' : '');

      const icon = document.createElement('div');
      icon.className = 'skill-icon';
      icon.style.backgroundImage = `url(img/sprites/${cls}-front-${sk.pose}.png)`;
      row.appendChild(icon);

      const dmg = Math.round(base * Shared.skillMult(sk, Math.max(1, rank)));
      const info = document.createElement('div');
      info.className = 'skill-info';
      info.innerHTML =
        `<div class="skill-name">${sk.icon} ${sk.name}` +
        `<span class="skill-key">${sk.key}</span></div>` +
        `<div class="skill-pips">${rankPips(rank, Shared.SKILL_MAX_RANK)}` +
        `<span class="skill-num"> ${rank}/${Shared.SKILL_MAX_RANK}</span></div>` +
        `<div class="skill-meta">~${dmg} dmg · ${sk.cost} mana · ${sk.cd}s</div>` +
        `<div class="skill-desc">${SKILL_DESC[sk.id] || ''}</div>`;
      row.appendChild(info);

      const btn = document.createElement('button');
      btn.className = 'skill-plus';
      btn.textContent = maxed ? 'MAX' : (rank === 0 ? 'Learn' : '+');
      btn.disabled = maxed || avail <= 0;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await Game.learnSkill(sk.id);
        refreshSkillTree();
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  function toggleSkillTree() {
    if (!skillPanel) return;
    skillPanel.classList.toggle('hidden');
    if (!skillPanel.classList.contains('hidden')) hideInventory();
    refreshSkillTree();
  }

  function hideSkillTree() { if (skillPanel) skillPanel.classList.add('hidden'); }

  return {
    toast, refreshInventory, toggleInventory, hideInventory, showDeath, hideDeath,
    refreshSkillTree, toggleSkillTree, hideSkillTree,
  };
})();
