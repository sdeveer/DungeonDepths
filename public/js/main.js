// Boot, screen flow (login → character select → game), input, and the
// requestAnimationFrame loop.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const show = (sel) => $(sel).classList.remove('hidden');
  const hide = (sel) => $(sel).classList.add('hidden');

  // -------------------------------------------------------------------
  // Login screen

  async function doAuth(register) {
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    const errEl = $('#login-error');
    errEl.textContent = '';
    try {
      if (register) await Net.register(username, password);
      else await Net.login(username, password);
      hide('#screen-login');
      await showCharSelect();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  $('#login-form').addEventListener('submit', (ev) => { ev.preventDefault(); doAuth(false); });
  $('#btn-register').addEventListener('click', () => doAuth(true));

  // -------------------------------------------------------------------
  // Character select

  let selectedClass = null;

  // Animated hero portraits on the character cards (staff glow, etc.).
  let portraits = [];
  setInterval(() => {
    if ($('#screen-chars').classList.contains('hidden')) return;
    const time = performance.now() / 1000;
    for (const p of portraits) {
      if (!p.canvas.isConnected) continue;
      Sprites.drawPortrait(p.canvas.getContext('2d'), p.canvas.width, p.look, p.cls, time);
    }
  }, 120);

  async function showCharSelect() {
    Game.stop();
    UI.hideInventory();
    hide('#screen-menu');
    hide('#screen-death');
    show('#screen-chars');
    hide('#char-create');
    $('#chars-error').textContent = '';

    const list = $('#char-list');
    list.innerHTML = '<div class="hint">Loading…</div>';
    try {
      const { characters } = await Net.listCharacters();
      portraits = [];
      list.innerHTML = characters.length ? '' : '<div class="hint">No heroes yet. Forge one below.</div>';
      for (const ch of characters) {
        const card = document.createElement('div');
        card.className = 'char-card';
        const portrait = document.createElement('canvas');
        portrait.className = 'char-portrait';
        portrait.width = portrait.height = 44;
        portraits.push({ canvas: portrait, look: Render.characterLook(ch), cls: ch.class });
        card.appendChild(portrait);
        const info = document.createElement('div');
        info.className = 'char-info';
        info.innerHTML =
          `<div class="char-name">${ch.name}</div>` +
          `<div class="char-meta">Level ${ch.level} ${Shared.CLASSES[ch.class].label}` +
          ` · depth ${ch.max_depth} · ${ch.gold} gold</div>`;
        card.appendChild(info);
        const del = document.createElement('button');
        del.className = 'char-del';
        del.textContent = '✕';
        del.title = 'Delete character';
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Permanently delete ${ch.name}?`)) return;
          await Net.deleteCharacter(ch.id).catch(() => {});
          showCharSelect();
        });
        card.appendChild(del);
        card.addEventListener('click', () => enterGame(ch.id));
        list.appendChild(card);
      }
    } catch (err) {
      if (err.status === 401) { hide('#screen-chars'); show('#screen-login'); return; }
      list.innerHTML = `<div class="error">${err.message}</div>`;
    }
  }

  // Fantasy name generator for random heroes (and the dice in the name field).
  const NAME_PARTS = {
    start: ['Kar', 'Bel', 'Mor', 'Thar', 'Ael', 'Dra', 'Gor', 'Lyr', 'Vex',
            'Sar', 'Ulf', 'Mir', 'Ash', 'Ber', 'Cal', 'Dur', 'Fen', 'Isol'],
    mid: ['an', 'en', 'ar', 'or', 'ith', 'ash', 'un', 'el', 'ad', 'og', 'ya', ''],
    end: ['ius', 'a', 'os', 'eth', 'wyn', 'ik', 'mar', 'is', 'grim', 'dor', 'ra', 'na'],
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function generateName() {
    let name = pick(NAME_PARTS.start) + pick(NAME_PARTS.mid) + pick(NAME_PARTS.end);
    return name.slice(0, 16);
  }

  // One click: roll a name and class, create the hero, jump into the game.
  // Retries on name collisions within the account.
  $('#btn-random-char').addEventListener('click', async () => {
    const errEl = $('#chars-error');
    errEl.textContent = '';
    const cls = pick(Object.keys(Shared.CLASSES));
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const { character } = await Net.createCharacter(generateName(), cls);
        await enterGame(character.id);
        return;
      } catch (err) {
        if (err.status !== 409) { errEl.textContent = err.message; return; }
      }
    }
    errEl.textContent = 'Could not find a free name — try again';
  });

  $('#btn-new-char').addEventListener('click', () => {
    const creating = !$('#char-create').classList.contains('hidden');
    if (!creating) {
      show('#char-create');
      $('#char-name').focus();
      return;
    }
    createCharacter();
  });

  document.querySelectorAll('.class-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.class-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedClass = btn.dataset.class;
      if ($('#char-name').value.trim()) createCharacter();
    });
  });

  async function createCharacter() {
    const name = $('#char-name').value.trim();
    const errEl = $('#chars-error');
    if (!name) { errEl.textContent = 'Name your hero first'; return; }
    if (!selectedClass) { errEl.textContent = 'Choose a class'; return; }
    try {
      const { character } = await Net.createCharacter(name, selectedClass);
      $('#char-name').value = '';
      await enterGame(character.id);
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  $('#btn-logout').addEventListener('click', async () => {
    await Net.logout().catch(() => {});
    hide('#screen-chars');
    show('#screen-login');
  });

  // -------------------------------------------------------------------
  // Game

  async function enterGame(charId) {
    try {
      const { character, items } = await Net.loadCharacter(charId);
      hide('#screen-chars');
      Game.start(character, items);
    } catch (err) {
      $('#chars-error').textContent = err.message;
    }
  }

  // Mouse: click / hold to move, click enemies to attack.
  let mouseDown = false;
  let lastMouse = { x: 0, y: 0 };

  Render.canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    mouseDown = true;
    lastMouse = { x: ev.clientX, y: ev.clientY };
    const w = Render.screenToWorld(ev.clientX, ev.clientY);
    Game.commandMove(w.x, w.y);
  });
  Render.canvas.addEventListener('mousemove', (ev) => {
    lastMouse = { x: ev.clientX, y: ev.clientY };
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  Render.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // Holding the button keeps the character moving toward the cursor.
  setInterval(() => {
    if (mouseDown && Game.S.running && !Game.S.paused) {
      const w = Render.screenToWorld(lastMouse.x, lastMouse.y);
      Game.commandMove(w.x, w.y);
    }
  }, 180);

  // Cast the class skill in slot `idx` (Q/W/E) toward the cursor.
  function castSkillAt(idx) {
    const w = Render.screenToWorld(lastMouse.x, lastMouse.y);
    Game.castSkill(idx, w.x, w.y);
  }

  window.addEventListener('keydown', (ev) => {
    if (!Game.S.running) return;
    if (ev.target.tagName === 'INPUT') return;
    switch (ev.key.toLowerCase()) {
      case 'q': castSkillAt(0); break;
      case 'w': castSkillAt(1); break;
      case 'e': castSkillAt(2); break;
      case 'r': Game.castHeal(); break;
      case 'i':
        UI.toggleInventory();
        break;
      case 'escape':
        if (Game.S.deathPending) break;
        Game.S.paused = !Game.S.paused;
        $('#screen-menu').classList.toggle('hidden', !Game.S.paused);
        break;
    }
  });

  // Menu buttons.
  $('#btn-resume').addEventListener('click', () => {
    Game.S.paused = false;
    hide('#screen-menu');
  });
  $('#btn-char-select').addEventListener('click', async () => {
    await Game.save();
    Game.S.paused = false;
    showCharSelect();
  });
  $('#btn-menu-logout').addEventListener('click', async () => {
    await Game.save();
    await Net.logout().catch(() => {});
    Game.stop();
    Game.S.paused = false;
    hide('#screen-menu');
    show('#screen-login');
  });

  $('#btn-respawn').addEventListener('click', () => {
    UI.hideDeath();
    Game.respawn();
  });

  // Save on tab close.
  window.addEventListener('beforeunload', () => {
    if (Game.S.running && Game.S.char) {
      Net.beaconSave(Game.S.char.id, Game.saveState());
    }
  });

  // -------------------------------------------------------------------
  // Main loop (60fps via requestAnimationFrame)

  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    Game.update(dt);
    Render.frame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // -------------------------------------------------------------------
  // Boot: skip login if the session cookie is still valid.

  (async () => {
    try {
      const { user } = await Net.me();
      if (user) {
        hide('#screen-login');
        await showCharSelect();
      }
    } catch (err) { /* stay on login screen */ }
  })();
})();
