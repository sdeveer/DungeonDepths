// Core game state and simulation. Rendering lives in render.js, DOM panels
// in ui.js. The server owns xp/gold/level/items; this file simulates combat
// and reports kills/saves to the API.
const Game = (() => {
  const T = Dungeon.T;

  const S = {
    running: false,
    paused: false,
    deathPending: false,
    char: null,        // server character record (mirrors API shape)
    items: [],         // full inventory, kept in sync with the server
    derived: null,     // Shared.derive output
    level: null,       // current dungeon level
    fog: null,         // { discovered: Uint8Array, visible: Uint8Array }
    player: null,
    enemies: [],
    projectiles: [],
    floaters: [],      // floating damage numbers / texts
    time: 0,
    saveTimer: 0,
    fountainCooldown: 0,
    descendLock: 0,    // avoid re-triggering stairs while standing on them
  };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const variance = (n) => Math.max(1, Math.round(n * (0.85 + Math.random() * 0.3)));

  // Body radii for wall collision and entity separation, in tiles. Must stay
  // under 0.5 so bodies fit through 1-tile corridors.
  const PLAYER_RADIUS = 0.3;
  const enemyRadius = (e) => (e.type === 'boss' ? 0.42 : 0.3);

  // Move an entity toward (nx, ny) keeping its body clear of walls, sliding
  // along a wall when the direct move is blocked.
  function tryMove(ent, nx, ny, r) {
    if (!Dungeon.boxWalkable(S.level, ent.x, ent.y, r)) {
      // Already overlapping a wall (e.g. a position saved before collision
      // had a radius): fall back to point collision so it can walk free.
      if (Dungeon.walkable(S.level, nx, ny)) { ent.x = nx; ent.y = ny; }
      return;
    }
    if (Dungeon.boxWalkable(S.level, nx, ny, r)) { ent.x = nx; ent.y = ny; }
    else if (Dungeon.boxWalkable(S.level, nx, ent.y, r)) ent.x = nx;
    else if (Dungeon.boxWalkable(S.level, ent.x, ny, r)) ent.y = ny;
  }

  function addFloater(x, y, text, color, big) {
    S.floaters.push({ x, y, text, color, big: !!big, t: 0 });
  }

  function recomputeDerived() {
    const equipped = S.items.filter((it) => it.equipped);
    S.derived = Shared.derive(S.char.class, S.char.level, equipped);
    S.char.hp = Math.min(S.char.hp, S.derived.maxHp);
    S.char.mana = Math.min(S.char.mana, S.derived.maxMana);
  }

  function spawnEnemies(level) {
    S.enemies = level.enemies.map((e) => {
      const stats = Shared.enemyStats(e.type, level.depth);
      return {
        type: e.type, x: e.x, y: e.y,
        hp: stats.hp, maxHp: stats.hp, stats,
        aggro: false, attackCd: 0, volleyCd: 0, flash: 0,
        path: null, repathCd: 0,
        dead: false, deadT: 0, reported: false,
      };
    });
  }

  function enterDepth(depth, { spawnAt } = {}) {
    S.level = Dungeon.generate(S.char.seed, depth);
    S.char.depth = depth;
    if (depth > S.char.maxDepth) S.char.maxDepth = depth;
    S.fog = {
      discovered: new Uint8Array(S.level.w * S.level.h),
      visible: new Uint8Array(S.level.w * S.level.h),
    };
    spawnEnemies(S.level);
    S.projectiles = [];
    S.floaters = [];

    let px = S.level.entry.x + 0.5, py = S.level.entry.y + 0.5;
    if (spawnAt && Dungeon.walkable(S.level, spawnAt.x, spawnAt.y)) {
      if (Dungeon.boxWalkable(S.level, spawnAt.x, spawnAt.y, PLAYER_RADIUS)) {
        px = spawnAt.x; py = spawnAt.y;
      } else {
        // Saved position hugs a wall (pre-collision-radius save): recenter.
        px = Math.floor(spawnAt.x) + 0.5; py = Math.floor(spawnAt.y) + 0.5;
      }
    }
    S.player = {
      x: px, y: py, facing: 0,
      path: null, moveTarget: null, target: null,
      attackCd: 0, fireballCd: 0, healCd: 0, hitFlash: 0, swing: 0,
    };
    S.descendLock = 1.0;

    // Story flavor on first entering each environment band.
    const FLAVOR = {
      1: 'The dead whisper beneath the town…',
      5: 'The earth itself swallows the light…',
      10: 'Black water seeps between the stones…',
      15: 'The air burns. Something ancient stirs below…',
    };
    if (depth === 0) UI.toast('The town of Last Light. Rest, then descend.', '#c8a24b');
    else UI.toast(`${Render.placeName(depth)} — Depth ${depth}`, '#a89878');
    if (FLAVOR[depth]) UI.toast(FLAVOR[depth], '#b89fe8');
    if (depth > 0 && depth % 5 === 0) UI.toast('A terrible presence dwells here…', '#ff5040');
  }

  function start(charData, items) {
    S.char = charData;
    S.items = items;
    recomputeDerived();
    S.char.hp = Math.max(1, Math.min(S.char.hp, S.derived.maxHp));
    S.char.mana = Math.min(S.char.mana, S.derived.maxMana);

    const spawnAt = (charData.posX || charData.posY)
      ? { x: charData.posX, y: charData.posY } : null;
    enterDepth(charData.depth, { spawnAt });
    S.running = true;
    S.paused = false;
    S.deathPending = false;
    S.saveTimer = 0;
  }

  function stop() { S.running = false; }

  // -------------------------------------------------------------------------
  // Persistence

  function saveState() {
    if (!S.char) return null;
    return {
      hp: Math.round(S.char.hp), mana: Math.round(S.char.mana),
      depth: S.char.depth, x: S.player.x, y: S.player.y,
    };
  }

  async function save() {
    const state = saveState();
    if (state) await Net.save(S.char.id, state).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Player actions

  function commandMove(wx, wy) {
    if (!S.running || S.paused || S.deathPending) return;
    // Clicking an enemy targets it.
    let best = null, bestD = 0.8;
    for (const e of S.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      S.player.target = best;
      S.player.moveTarget = null;
      return;
    }
    S.player.target = null;
    const path = Dungeon.findPath(S.level, S.player.x, S.player.y, wx, wy);
    if (path) {
      S.player.path = path;
      // Walk to the exact click point inside the final tile — but only if the
      // body fits there; clicks flush against a wall keep the tile center.
      if (Dungeon.boxWalkable(S.level, wx, wy, PLAYER_RADIUS)) {
        if (path.length === 0) S.player.path = [{ x: wx, y: wy }];
        else path[path.length - 1] = { x: wx, y: wy };
      }
    }
  }

  function castFireball(wx, wy) {
    const p = S.player;
    if (!S.running || S.paused || S.deathPending) return;
    if (p.fireballCd > 0) return;
    if (S.char.mana < Shared.FIREBALL_COST) {
      UI.toast('Not enough mana', '#7a8ccf');
      return;
    }
    S.char.mana -= Shared.FIREBALL_COST;
    p.fireballCd = 0.6;
    p.swing = 0.18;
    const ang = Math.atan2(wy - p.y, wx - p.x);
    p.facing = ang;
    S.projectiles.push({
      x: p.x, y: p.y, vx: Math.cos(ang) * 11, vy: Math.sin(ang) * 11,
      dmg: S.derived.fireballDmg, friendly: true, life: 2.5, kind: 'fireball',
    });
  }

  function castHeal() {
    const p = S.player;
    if (!S.running || S.paused || S.deathPending) return;
    if (p.healCd > 0) return;
    if (S.char.mana < Shared.HEAL_COST) {
      UI.toast('Not enough mana', '#7a8ccf');
      return;
    }
    if (S.char.hp >= S.derived.maxHp) return;
    S.char.mana -= Shared.HEAL_COST;
    p.healCd = 1.5;
    p.swing = 0.18;
    const amount = S.derived.healAmount;
    S.char.hp = Math.min(S.derived.maxHp, S.char.hp + amount);
    addFloater(p.x, p.y - 0.6, `+${amount}`, '#5ad06a');
  }

  // -------------------------------------------------------------------------
  // Combat resolution

  function damageEnemy(e, amount) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.15;
    e.aggro = true;
    addFloater(e.x, e.y - 0.7, `${amount}`, '#ffdf8a');
    if (e.hp <= 0) {
      e.dead = true;
      e.deadT = 0;
      if (S.player.target === e) S.player.target = null;
      reportKill(e);
    }
  }

  async function reportKill(e) {
    if (e.reported) return;
    e.reported = true;
    S.char.kills++;
    try {
      const r = await Net.kill(S.char.id, e.type);
      S.char.xp = r.xp;
      S.char.xpNext = r.xpNext;
      S.char.gold = r.gold;
      addFloater(e.x, e.y - 0.3, `+${r.goldGain} gold`, '#ffd34d');
      addFloater(e.x, e.y - 1.0, `+${r.xpGain} xp`, '#b89fe8');
      if (r.leveledUp) {
        S.char.level = r.level;
        recomputeDerived();
        S.char.hp = S.derived.maxHp;
        S.char.mana = S.derived.maxMana;
        addFloater(S.player.x, S.player.y - 1.2, 'LEVEL UP!', '#ffd34d', true);
        UI.toast(`You are now level ${r.level}!`, '#ffd34d');
      }
      for (const item of r.items || []) {
        S.items.push(item);
        UI.toast(`You found: ${item.name}`, Shared.RARITY[item.rarity].color);
      }
      if (r.items && r.items.length) UI.refreshInventory();
      if (e.type === 'boss') UI.toast('The Dungeon Lord is slain!', '#ff9a3d');
    } catch (err) {
      // Rate-limited or offline: the kill still happened visually; rewards
      // are just skipped this time.
    }
  }

  function damagePlayer(rawDmg) {
    if (S.deathPending) return;
    const dmg = Shared.mitigate(variance(rawDmg), S.derived.armor);
    S.char.hp -= dmg;
    S.player.hitFlash = 0.2;
    Render.shake(4);
    addFloater(S.player.x, S.player.y - 0.7, `-${dmg}`, '#ff5a4a');
    if (S.char.hp <= 0) {
      S.char.hp = 0;
      S.deathPending = true;
      handleDeath();
    }
  }

  async function handleDeath() {
    let goldLost = 0;
    try {
      const r = await Net.death(S.char.id);
      goldLost = r.goldLost;
      S.char.gold = r.gold;
      S.char.deaths = r.deaths;
    } catch (err) { /* show the screen regardless */ }
    // Let the death-collapse animation play before the screen drops.
    await new Promise((r) => setTimeout(r, 1100));
    UI.showDeath({
      level: S.char.level, depth: S.level.depth, kills: S.char.kills,
      goldLost, gold: S.char.gold,
    });
  }

  function respawn() {
    S.deathPending = false;
    recomputeDerived();
    S.char.hp = S.derived.maxHp;
    S.char.mana = S.derived.maxMana;
    enterDepth(0);
    save();
  }

  // -------------------------------------------------------------------------
  // Inventory (delegates to the server, then mirrors the result locally)

  async function equipItem(item) {
    if (item.kind === 'potion') {
      try {
        const r = await Net.usePotion(S.char.id, item.id);
        S.items = S.items.filter((it) => it.id !== item.id);
        S.char.hp = r.hp; S.char.mana = r.mana;
        if (r.heal) addFloater(S.player.x, S.player.y - 0.6, `+${r.heal}`, '#5ad06a');
        if (r.manaGain) addFloater(S.player.x, S.player.y - 0.6, `+${r.manaGain}`, '#6b8cff');
      } catch (err) { UI.toast(err.message, '#d8584a'); }
    } else if (item.equipped) {
      try {
        await Net.unequip(S.char.id, item.id);
        item.equipped = false;
      } catch (err) { UI.toast(err.message, '#d8584a'); }
    } else {
      try {
        await Net.equip(S.char.id, item.id);
        for (const it of S.items) if (it.kind === item.kind) it.equipped = false;
        item.equipped = true;
      } catch (err) { UI.toast(err.message, '#d8584a'); }
    }
    recomputeDerived();
    UI.refreshInventory();
  }

  async function destroyItem(item) {
    try {
      await Net.dropItem(S.char.id, item.id);
      S.items = S.items.filter((it) => it.id !== item.id);
      recomputeDerived();
      UI.refreshInventory();
    } catch (err) { UI.toast(err.message, '#d8584a'); }
  }

  // -------------------------------------------------------------------------
  // Simulation

  function moveAlongPath(ent, path, speed, dt, r) {
    if (!path || path.length === 0) return false;
    const wp = path[0];
    const dx = wp.x - ent.x, dy = wp.y - ent.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (d <= step) {
      tryMove(ent, wp.x, wp.y, r);
      path.shift();
    } else {
      tryMove(ent, ent.x + (dx / d) * step, ent.y + (dy / d) * step, r);
      ent.facing = Math.atan2(dy, dx);
    }
    return true;
  }

  // Straight-line steering with wall sliding (for enemies with LOS).
  function steerToward(ent, tx, ty, speed, dt, r) {
    const dx = tx - ent.x, dy = ty - ent.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    const step = Math.min(speed * dt, d);
    tryMove(ent, ent.x + (dx / d) * step, ent.y + (dy / d) * step, r);
    ent.facing = Math.atan2(dy, dx);
  }

  // Push living enemies out of each other so packs don't collapse into a
  // single overlapping sprite.
  function separateEnemies() {
    for (let i = 0; i < S.enemies.length; i++) {
      const a = S.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < S.enemies.length; j++) {
        const b = S.enemies[j];
        if (b.dead) continue;
        const minD = enemyRadius(a) + enemyRadius(b);
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
        const push = (minD - d) / 2;
        tryMove(a, a.x - (dx / d) * push, a.y - (dy / d) * push, enemyRadius(a));
        tryMove(b, b.x + (dx / d) * push, b.y + (dy / d) * push, enemyRadius(b));
      }
    }
  }

  function updatePlayer(dt) {
    const p = S.player;
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.fireballCd = Math.max(0, p.fireballCd - dt);
    p.healCd = Math.max(0, p.healCd - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.swing = Math.max(0, p.swing - dt);

    // Regen.
    S.char.hp = Math.min(S.derived.maxHp, S.char.hp + S.derived.hpRegen * dt);
    S.char.mana = Math.min(S.derived.maxMana, S.char.mana + S.derived.manaRegen * dt);

    // Attack the chosen target, chasing it if needed.
    if (p.target) {
      if (p.target.dead) { p.target = null; }
      else {
        const d = dist(p, p.target);
        if (d <= 1.5) {
          p.path = null;
          p.facing = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          if (p.attackCd <= 0) {
            p.attackCd = 1 / S.derived.attackSpeed;
            p.swing = 0.18;
            damageEnemy(p.target, variance(S.derived.meleeDmg));
          }
        } else {
          if (!p.path || p.repathCd <= 0) {
            p.path = Dungeon.findPath(S.level, p.x, p.y, p.target.x, p.target.y);
            p.repathCd = 0.4;
          }
          p.repathCd = (p.repathCd || 0) - dt;
          moveAlongPath(p, p.path, S.derived.moveSpeed, dt, PLAYER_RADIUS);
        }
        return;
      }
    }
    moveAlongPath(p, p.path, S.derived.moveSpeed, dt, PLAYER_RADIUS);
  }

  function updateEnemy(e, dt) {
    if (e.dead) { e.deadT += dt; return; }
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.volleyCd = Math.max(0, e.volleyCd - dt);
    e.flash = Math.max(0, e.flash - dt);
    e.attackT = Math.max(0, (e.attackT || 0) - dt); // attack-pose timer
    e.repathCd -= dt;

    const p = S.player;
    const d = dist(e, p);
    const los = d < 12 && Dungeon.lineOfSight(S.level, e.x, e.y, p.x, p.y);

    if (!e.aggro) {
      if (d < 7 && los) e.aggro = true;
      else return;
    }

    const isRanged = e.type === 'demon';
    const wantRange = isRanged ? 5.0 : e.stats.range * 0.9;

    if (isRanged && los && d <= 6.5) {
      // Hold position and shoot.
      if (e.attackCd <= 0) {
        e.attackCd = 1.6;
        e.attackT = 0.4;
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        S.projectiles.push({
          x: e.x, y: e.y, vx: Math.cos(ang) * 7, vy: Math.sin(ang) * 7,
          dmg: e.stats.dmg, friendly: false, life: 3, kind: 'shadowbolt',
        });
      }
      e.facing = Math.atan2(p.y - e.y, p.x - e.x);
      if (d < 2.2) steerToward(e, e.x - (p.x - e.x), e.y - (p.y - e.y), e.stats.speed * 0.7, dt, enemyRadius(e));
      return;
    }

    if (d > wantRange) {
      if (los) {
        steerToward(e, p.x, p.y, e.stats.speed, dt, enemyRadius(e));
      } else {
        if (!e.path || e.path.length === 0 || e.repathCd <= 0) {
          e.path = Dungeon.findPath(S.level, e.x, e.y, p.x, p.y);
          e.repathCd = 0.7;
        }
        moveAlongPath(e, e.path, e.stats.speed, dt, enemyRadius(e));
      }
    } else if (e.attackCd <= 0 && d <= e.stats.range) {
      e.attackCd = e.type === 'boss' ? 1.0 : 1.3;
      e.attackT = 0.4;
      damagePlayer(e.stats.dmg);
    }

    // Boss: periodic projectile volley on top of melee.
    if (e.type === 'boss' && los && e.volleyCd <= 0) {
      e.volleyCd = 3.5;
      e.attackT = 0.4;
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      for (const off of [-0.35, 0, 0.35]) {
        S.projectiles.push({
          x: e.x, y: e.y,
          vx: Math.cos(base + off) * 6.5, vy: Math.sin(base + off) * 6.5,
          dmg: Math.round(e.stats.dmg * 0.8), friendly: false, life: 3, kind: 'shadowbolt',
        });
      }
    }
  }

  // Returns true if the projectile hit a target at its current position.
  function projectileHit(pr) {
    if (pr.friendly) {
      for (const e of S.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - pr.x, e.y - pr.y) < 0.55) {
          pr.life = 0;
          // Small splash so a fireball can clear a tight pack.
          for (const o of S.enemies) {
            if (o.dead) continue;
            if (Math.hypot(o.x - pr.x, o.y - pr.y) < 1.1) damageEnemy(o, variance(pr.dmg));
          }
          return true;
        }
      }
      return false;
    }
    if (Math.hypot(S.player.x - pr.x, S.player.y - pr.y) < 0.45) {
      pr.life = 0;
      damagePlayer(pr.dmg);
      return true;
    }
    return false;
  }

  // Substepped so fast projectiles can't tunnel through a wall tile, slip
  // through the diagonal gap where two wall corners meet, or skip past a
  // target in a single frame.
  function stepProjectile(pr, dt) {
    const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 0.2));
    for (let i = 0; i < steps; i++) {
      const ox = pr.x, oy = pr.y;
      pr.x += (pr.vx * dt) / steps;
      pr.y += (pr.vy * dt) / steps;
      if (!Dungeon.walkable(S.level, pr.x, pr.y)) {
        pr.x = ox; pr.y = oy; pr.life = 0;
        return;
      }
      const otx = Math.floor(ox), oty = Math.floor(oy);
      const ntx = Math.floor(pr.x), nty = Math.floor(pr.y);
      if (otx !== ntx && oty !== nty &&
          !Dungeon.walkable(S.level, ntx + 0.5, oty + 0.5) &&
          !Dungeon.walkable(S.level, otx + 0.5, nty + 0.5)) {
        pr.x = ox; pr.y = oy; pr.life = 0;
        return;
      }
      if (projectileHit(pr)) return;
    }
  }

  function updateProjectiles(dt) {
    for (const pr of S.projectiles) {
      pr.life -= dt;
      if (pr.life <= 0) { pr.life = 0; continue; }
      stepProjectile(pr, dt);
    }
    S.projectiles = S.projectiles.filter((pr) => pr.life > 0);
  }

  function updateTiles(dt) {
    S.descendLock = Math.max(0, S.descendLock - dt);
    S.fountainCooldown = Math.max(0, S.fountainCooldown - dt);
    const tile = Dungeon.tileAt(S.level, S.player.x, S.player.y);

    if (tile === T.STAIRS && S.descendLock <= 0) {
      enterDepth(S.level.depth + 1);
      save();
      return;
    }
    if (tile === T.PORTAL && S.descendLock <= 0) {
      const target = Math.max(1, S.char.maxDepth);
      UI.toast(`The portal pulls you to depth ${target}…`, '#b878ff');
      enterDepth(target);
      save();
      return;
    }
    // Fountain heals when standing nearby (town only).
    if (S.level.depth === 0 && S.fountainCooldown <= 0) {
      for (let ty = 0; ty < S.level.h; ty++) {
        for (let tx = 0; tx < S.level.w; tx++) {
          if (S.level.map[ty * S.level.w + tx] !== T.FOUNTAIN) continue;
          if (Math.hypot(tx + 0.5 - S.player.x, ty + 0.5 - S.player.y) < 1.6) {
            if (S.char.hp < S.derived.maxHp || S.char.mana < S.derived.maxMana) {
              S.char.hp = S.derived.maxHp;
              S.char.mana = S.derived.maxMana;
              addFloater(S.player.x, S.player.y - 0.8, 'Refreshed!', '#6fd8e8');
              S.fountainCooldown = 3;
            }
          }
        }
      }
    }
  }

  const VISION_RADIUS = 8;

  function updateFog() {
    const { w, h } = S.level;
    const fog = S.fog;
    fog.visible.fill(0);
    const px = Math.floor(S.player.x), py = Math.floor(S.player.y);
    const r = VISION_RADIUS;
    for (let ty = Math.max(0, py - r); ty <= Math.min(h - 1, py + r); ty++) {
      for (let tx = Math.max(0, px - r); tx <= Math.min(w - 1, px + r); tx++) {
        const dx = tx + 0.5 - S.player.x, dy = ty + 0.5 - S.player.y;
        if (dx * dx + dy * dy > r * r) continue;
        if (!Dungeon.lineOfSight(S.level, S.player.x, S.player.y, tx + 0.5, ty + 0.5)) continue;
        const i = ty * w + tx;
        fog.visible[i] = 1;
        fog.discovered[i] = 1;
      }
    }
  }

  function updateFloaters(dt) {
    for (const f of S.floaters) f.t += dt;
    S.floaters = S.floaters.filter((f) => f.t < 1.2);
  }

  function update(dt) {
    if (!S.running || S.paused || S.deathPending) return;
    S.time += dt;

    const ox = S.player.x, oy = S.player.y;
    updatePlayer(dt);
    S.player.moving = Math.hypot(S.player.x - ox, S.player.y - oy) > 1e-4;
    for (const e of S.enemies) {
      const ex = e.x, ey = e.y;
      updateEnemy(e, dt);
      e.moving = Math.hypot(e.x - ex, e.y - ey) > 1e-4;
    }
    separateEnemies();
    updateProjectiles(dt);
    updateTiles(dt);
    updateFog();
    updateFloaters(dt);

    // Autosave every 30 seconds.
    S.saveTimer += dt;
    if (S.saveTimer >= 30) {
      S.saveTimer = 0;
      save();
    }
  }

  return {
    S, start, stop, update, save, saveState,
    commandMove, castFireball, castHeal, respawn,
    equipItem, destroyItem, recomputeDerived,
    VISION_RADIUS,
  };
})();
