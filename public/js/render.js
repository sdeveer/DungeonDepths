// All canvas drawing: Diablo II-style isometric world, entities, lighting/fog,
// and the stone control-panel HUD. Game logic stays on a square grid; this
// file projects it to a 2:1 isometric view.
const Render = (() => {
  const TW = 64;        // iso tile width (px)
  const TH = 32;        // iso tile height (px)
  const WALL_H = 42;    // wall block height (px)
  const E = 38;         // entity scale (px)
  const T = Dungeon.T;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Camera: player's iso position is pinned to the screen center (slightly
  // above center to leave room for the control panel).
  let cam = { x: 0, y: 0 };
  const isoX = (wx, wy) => (wx - wy) * (TW / 2);
  const isoY = (wx, wy) => (wx + wy) * (TH / 2);

  function worldToScreen(wx, wy) {
    return { x: isoX(wx, wy) - cam.x, y: isoY(wx, wy) - cam.y };
  }
  function screenToWorld(sx, sy) {
    const dx = sx + cam.x, dy = sy + cam.y;
    return { x: dx / TW + dy / TH, y: dy / TH - dx / TW };
  }

  // Cheap deterministic per-tile noise for floor variation.
  const tileNoise = (x, y) => ((x * 73856093) ^ (y * 19349663)) % 100 / 100;

  function lightAt(S, tx, ty) {
    const i = ty * S.level.w + tx;
    if (!S.fog.discovered[i]) return 0;
    if (!S.fog.visible[i]) return 0.13;
    const d = Math.hypot(tx + 0.5 - S.player.x, ty + 0.5 - S.player.y);
    const flicker = 1 + Math.sin(S.time * 9 + tx * 3 + ty * 5) * 0.04;
    return Math.max(0.2, Math.min(1, (1.15 - d / Game.VISION_RADIUS) * flicker));
  }

  // ---------------------------------------------------------------------
  // World tiles

  function diamondPath(s) {
    // s = projected top corner of the tile (corner at world (tx,ty)).
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);                       // top
    ctx.lineTo(s.x + TW / 2, s.y + TH / 2);     // right
    ctx.lineTo(s.x, s.y + TH);                  // bottom
    ctx.lineTo(s.x - TW / 2, s.y + TH / 2);     // left
    ctx.closePath();
  }

  const stone = (v, light) =>
    `rgb(${v * light | 0},${(v - 4) * light | 0},${(v - 8) * light | 0})`;

  function drawFloorTile(S, tx, ty, tile, light) {
    const s = worldToScreen(tx, ty);
    const n = tileNoise(tx, ty);

    // Cold gray-blue dungeon stone with slight per-tile variation.
    const v = 52 + n * 18;
    diamondPath(s);
    ctx.fillStyle = `rgb(${(v - 6) * light | 0},${(v - 4) * light | 0},${v * light | 0})`;
    ctx.fill();
    // Grout.
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * light})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Occasional cracked slab.
    if (n > 0.8) {
      ctx.strokeStyle = `rgba(0,0,0,${0.3 * light})`;
      ctx.beginPath();
      ctx.moveTo(s.x - TW * 0.15, s.y + TH * 0.35);
      ctx.lineTo(s.x + TW * 0.1, s.y + TH * 0.6);
      ctx.stroke();
    }

    if (tile === T.STAIRS) drawStairs(s, light);
    else if (tile === T.PORTAL) drawPortal(S, tx, ty, light);
    else if (tile === T.FOUNTAIN) drawFountain(S, tx, ty, light);
  }

  function drawStairs(s, light) {
    // A dark pit with steps descending toward the bottom corner.
    diamondPath(s);
    ctx.fillStyle = `rgba(0,0,0,${0.8 * light})`;
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const f = 1 - i * 0.26;
      const oy = s.y + (TH / 2) * (1 - f) + i * 2;
      ctx.fillStyle = `rgba(${78 - i * 20},${64 - i * 16},${48 - i * 12},${light})`;
      ctx.beginPath();
      ctx.moveTo(s.x, oy);
      ctx.lineTo(s.x + (TW / 2) * f, oy + (TH / 2) * f);
      ctx.lineTo(s.x, oy + TH * f);
      ctx.lineTo(s.x - (TW / 2) * f, oy + (TH / 2) * f);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPortal(S, tx, ty, light) {
    const c = worldToScreen(tx + 0.5, ty + 0.5);
    const pulse = 1 + Math.sin(S.time * 4) * 0.12;
    const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, TH * 1.4 * pulse);
    g.addColorStop(0, `rgba(220,160,255,${0.95 * light})`);
    g.addColorStop(0.6, `rgba(140,60,220,${0.7 * light})`);
    g.addColorStop(1, 'rgba(60,10,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, TW * 0.45 * pulse, TH * 0.7 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFountain(S, tx, ty, light) {
    const c = worldToScreen(tx + 0.5, ty + 0.5);
    ctx.fillStyle = `rgba(70,60,50,${light})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, TW * 0.36, TH * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    const shimmer = 0.7 + Math.sin(S.time * 3) * 0.15;
    ctx.fillStyle = `rgba(70,160,220,${shimmer * light})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, TW * 0.26, TH * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Raised isometric wall block: lit top cap, two shaded front faces.
  function drawWallBlock(S, tx, ty, light) {
    const s = worldToScreen(tx, ty);
    const n = tileNoise(tx, ty);
    const v = 58 + n * 14;
    const A = { x: s.x, y: s.y };
    const B = { x: s.x + TW / 2, y: s.y + TH / 2 };
    const C = { x: s.x, y: s.y + TH };
    const D = { x: s.x - TW / 2, y: s.y + TH / 2 };

    // Left face (lit a bit warmer, as if by torchlight).
    ctx.fillStyle = stone(v * 0.55, light);
    ctx.beginPath();
    ctx.moveTo(D.x, D.y - WALL_H); ctx.lineTo(C.x, C.y - WALL_H);
    ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y);
    ctx.closePath(); ctx.fill();

    // Right face (darkest).
    ctx.fillStyle = stone(v * 0.34, light);
    ctx.beginPath();
    ctx.moveTo(C.x, C.y - WALL_H); ctx.lineTo(B.x, B.y - WALL_H);
    ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y);
    ctx.closePath(); ctx.fill();

    // Brick seams on the faces.
    ctx.strokeStyle = `rgba(0,0,0,${0.3 * light})`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const fy = -WALL_H + (WALL_H / 3) * i;
      ctx.beginPath();
      ctx.moveTo(D.x, D.y + fy); ctx.lineTo(C.x, C.y + fy); ctx.lineTo(B.x, B.y + fy);
      ctx.stroke();
    }

    // Top cap.
    ctx.fillStyle = stone(v, light);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y - WALL_H);
    ctx.lineTo(B.x, B.y - WALL_H);
    ctx.lineTo(C.x, C.y - WALL_H);
    ctx.lineTo(D.x, D.y - WALL_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${0.4 * light})`;
    ctx.stroke();
  }

  // ---------------------------------------------------------------------
  // Entities (layered shapes, no image assets)

  const ENEMY_LOOKS = {
    skeleton: { body: '#cfc8b8', head: '#e8e0d0', eye: '#80e0ff', size: 0.32 },
    zombie:   { body: '#5a7a45', head: '#739158', eye: '#d8e860', size: 0.36 },
    demon:    { body: '#7a2520', head: '#963028', eye: '#ffd040', size: 0.36, horns: true },
    boss:     { body: '#581815', head: '#7a201a', eye: '#ff3820', size: 0.62, horns: true },
  };

  // Per-character generated appearance, derived from the character's seed so
  // each hero looks unique but consistent across sessions.
  const CLASS_CLOAKS = {
    warrior: ['#8a98b8', '#9a8878', '#788a98', '#a8a0b0', '#7a8898'],
    mage:    ['#9a6fd8', '#7a5fc8', '#b87fd8', '#6a8fd8', '#8f6ab8'],
    rogue:   ['#5f9a62', '#7a9a4f', '#4f8a72', '#8aa05a', '#6a8a52'],
  };
  const SKIN_TONES = ['#d8b890', '#c89878', '#a87858', '#e8c8a8', '#8a6848', '#caa080'];
  const HAIR_COLORS = ['#2a201a', '#4a3320', '#7a5a30', '#9a9a9a', '#a03020', '#d8c080'];

  function characterLook(char) {
    const s = char.seed >>> 0;
    const cloaks = CLASS_CLOAKS[char.class] || CLASS_CLOAKS.warrior;
    return {
      cloak: cloaks[s % cloaks.length],
      skin: SKIN_TONES[(s >> 3) % SKIN_TONES.length],
      hair: HAIR_COLORS[(s >> 7) % HAIR_COLORS.length],
      bald: (s >> 11) % 5 === 0,
    };
  }

  function drawShadow(s, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCorpse(S, e) {
    const light = lightAt(S, Math.floor(e.x), Math.floor(e.y));
    if (light < 0.15) return;
    const r = ENEMY_LOOKS[e.type].size * E;
    const a = Math.max(0, 0.5 - e.deadT * 0.1) * light;
    if (a <= 0) return;
    const s = worldToScreen(e.x, e.y);
    ctx.fillStyle = `rgba(40,10,8,${a})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemy(S, e) {
    const light = lightAt(S, Math.floor(e.x), Math.floor(e.y));
    if (light < 0.2) return;
    const look = ENEMY_LOOKS[e.type];
    const r = look.size * E;
    const s = worldToScreen(e.x, e.y); // feet position

    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.15);
    drawShadow(s, r);

    const flash = e.flash > 0;
    const by = s.y - r;                 // body center, raised off the ground
    // Body.
    ctx.fillStyle = flash ? '#ffffff' : look.body;
    ctx.beginPath();
    ctx.ellipse(s.x, by, r * 0.8, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head.
    ctx.fillStyle = flash ? '#ffffff' : look.head;
    ctx.beginPath();
    ctx.arc(s.x, by - r * 0.9, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Horns.
    if (look.horns) {
      ctx.strokeStyle = flash ? '#ffffff' : '#d8c8a8';
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(s.x - r * 0.45, by - r * 1.15);
      ctx.quadraticCurveTo(s.x - r * 0.8, by - r * 1.6, s.x - r * 0.55, by - r * 1.85);
      ctx.moveTo(s.x + r * 0.45, by - r * 1.15);
      ctx.quadraticCurveTo(s.x + r * 0.8, by - r * 1.6, s.x + r * 0.55, by - r * 1.85);
      ctx.stroke();
    }
    // Glowing eyes.
    ctx.fillStyle = look.eye;
    ctx.beginPath();
    ctx.arc(s.x - r * 0.2, by - r * 0.95, r * 0.09, 0, Math.PI * 2);
    ctx.arc(s.x + r * 0.2, by - r * 0.95, r * 0.09, 0, Math.PI * 2);
    ctx.fill();

    // HP bar when wounded.
    if (e.hp < e.maxHp) {
      const bw = r * 2.2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(s.x - bw / 2, by - r * 1.9, bw, 4);
      ctx.fillStyle = e.type === 'boss' ? '#ff4030' : '#c03828';
      ctx.fillRect(s.x - bw / 2, by - r * 1.9, bw * Math.max(0, e.hp / e.maxHp), 4);
    }
    ctx.restore();

    // Target ring on the ground.
    if (S.player.target === e) {
      ctx.strokeStyle = 'rgba(255,80,60,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * 1.2, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPlayer(S) {
    const p = S.player;
    const s = worldToScreen(p.x, p.y); // feet position
    Sprites.drawHero(ctx, {
      x: s.x, y: s.y, scale: E * 0.36,
      facing: p.facing, moving: !!p.moving, time: S.time,
      swing: p.swing > 0 ? 1 - p.swing / 0.18 : -1,
      look: characterLook(S.char), cls: S.char.class,
      hasWeapon: S.items.some((it) => it.equipped && it.kind === 'weapon'),
      hasArmor: S.items.some((it) => it.equipped && it.kind === 'armor'),
      flash: p.hitFlash > 0,
    });
  }

  function drawProjectiles(S) {
    for (const pr of S.projectiles) {
      const s = worldToScreen(pr.x, pr.y);
      s.y -= E * 0.4; // projectiles fly at chest height
      const fire = pr.kind === 'fireball';
      const r = fire ? 9 : 7;
      const g = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, r * 1.8);
      if (fire) {
        g.addColorStop(0, 'rgba(255,240,180,1)');
        g.addColorStop(0.4, 'rgba(255,140,40,0.9)');
        g.addColorStop(1, 'rgba(200,40,0,0)');
      } else {
        g.addColorStop(0, 'rgba(220,180,255,1)');
        g.addColorStop(0.4, 'rgba(140,40,200,0.8)');
        g.addColorStop(1, 'rgba(60,0,100,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFloaters(S) {
    ctx.textAlign = 'center';
    for (const f of S.floaters) {
      const s = worldToScreen(f.x, f.y);
      s.y -= E * 1.2 + f.t * 34;
      const alpha = Math.max(0, 1 - f.t / 1.2);
      ctx.font = f.big ? 'bold 24px Georgia' : 'bold 15px Georgia';
      ctx.fillStyle = 'rgba(0,0,0,' + alpha * 0.8 + ')';
      ctx.fillText(f.text, s.x + 1, s.y + 1);
      ctx.fillStyle = f.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(f.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------
  // Atmosphere

  function drawAtmosphere(S) {
    const ps = worldToScreen(S.player.x, S.player.y);
    // Warm torch glow around the player.
    const flicker = 1 + Math.sin(S.time * 11) * 0.03 + Math.sin(S.time * 23) * 0.02;
    const glow = ctx.createRadialGradient(ps.x, ps.y, TH, ps.x, ps.y, TW * 5 * flicker);
    glow.addColorStop(0, 'rgba(255,170,70,0.10)');
    glow.addColorStop(0.5, 'rgba(255,130,40,0.04)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Vignette.
    const vr = Math.max(canvas.width, canvas.height) * 0.75;
    const vig = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, vr * 0.45,
      canvas.width / 2, canvas.height / 2, vr);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Red pulse when hurt or low on health.
    const lowHp = S.char.hp / S.derived.maxHp < 0.25;
    if (S.player.hitFlash > 0 || lowHp) {
      const a = Math.max(S.player.hitFlash * 1.2, lowHp ? 0.12 + Math.sin(S.time * 5) * 0.06 : 0);
      const red = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, vr * 0.3,
        canvas.width / 2, canvas.height / 2, vr * 0.9);
      red.addColorStop(0, 'rgba(120,0,0,0)');
      red.addColorStop(1, `rgba(150,10,5,${Math.min(0.5, a)})`);
      ctx.fillStyle = red;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---------------------------------------------------------------------
  // HUD — Diablo II-style stone control panel across the bottom.

  const PANEL_H = 92;

  function drawOrb(cx, cy, radius, ratio, colors, label) {
    // Socket.
    ctx.fillStyle = '#0c0907';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#2a2014';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
    ctx.stroke();

    // Liquid fill, clipped to the orb, rising with ratio.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#140a08';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    const top = cy + radius - ratio * radius * 2;
    const g = ctx.createLinearGradient(0, top, 0, cy + radius);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, top, radius * 2, radius * 2);
    // Surface shine.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx - radius * 0.3, cy - radius * 0.45, radius * 0.4, radius * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = 'bold 14px Georgia';
    ctx.fillStyle = '#e8dcc0';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(label, cx, cy + 4);
    ctx.shadowBlur = 0;
  }

  function drawAbilityButton(x, y, size, key, ready, cdRatio, icon) {
    ctx.fillStyle = '#13100c';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = ready ? '#6a5436' : '#3a2e1e';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);

    ctx.textAlign = 'center';
    ctx.font = `${size * 0.5}px serif`;
    ctx.globalAlpha = ready ? 1 : 0.35;
    ctx.fillText(icon, x + size / 2, y + size * 0.62);
    ctx.globalAlpha = 1;

    if (cdRatio > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y, size, size * cdRatio);
    }
    ctx.font = 'bold 11px Georgia';
    ctx.fillStyle = '#c8a24b';
    ctx.fillText(key, x + size - 7, y + size - 4);
  }

  function drawPanel(W, H) {
    const py = H - PANEL_H;
    // Stone slab.
    const g = ctx.createLinearGradient(0, py, 0, H);
    g.addColorStop(0, '#372d20');
    g.addColorStop(0.12, '#2a2218');
    g.addColorStop(1, '#15100a');
    ctx.fillStyle = g;
    ctx.fillRect(0, py, W, PANEL_H);

    // Gold trim and shadow line along the top edge.
    ctx.fillStyle = '#6a5436';
    ctx.fillRect(0, py, W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, py + 2, W, 1);

    // Carved seams and rivets for texture.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let x = 90; x < W - 90; x += 140) {
      ctx.beginPath();
      ctx.moveTo(x, py + 10);
      ctx.lineTo(x, H - 8);
      ctx.stroke();
    }
    ctx.fillStyle = '#574531';
    for (const rx of [10, W - 10]) {
      ctx.beginPath();
      ctx.arc(rx, py + 10, 3, 0, Math.PI * 2);
      ctx.arc(rx, H - 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHUD(S) {
    const W = canvas.width, H = canvas.height;
    drawPanel(W, H);

    // Orbs embedded in the panel ends, bulging above it like in D2.
    const orbR = 52;
    const orbY = H - PANEL_H / 2 - 12;
    drawOrb(orbR + 26, orbY, orbR,
      Math.max(0, S.char.hp / S.derived.maxHp),
      ['#e04030', '#6a0a08'],
      `${Math.ceil(S.char.hp)}`);
    drawOrb(W - orbR - 26, orbY, orbR,
      Math.max(0, S.char.mana / S.derived.maxMana),
      ['#3858e8', '#0a1260'],
      `${Math.ceil(S.char.mana)}`);

    // XP bar riding the top edge of the panel.
    const bw = Math.min(560, W - 340);
    const bx = W / 2 - bw / 2, by = H - PANEL_H - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(bx, by, bw, 9);
    ctx.fillStyle = '#9a7c2e';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.min(1, S.char.xp / S.char.xpNext), 7);
    ctx.strokeStyle = '#4a3826';
    ctx.strokeRect(bx, by, bw, 9);
    ctx.textAlign = 'center';
    ctx.font = '12px Georgia';
    ctx.fillStyle = '#b0a288';
    ctx.fillText(`Level ${S.char.level}  ·  ${S.char.xp} / ${S.char.xpNext} XP`, W / 2, by - 4);

    // Ability slots centered in the panel.
    const size = 48, gap = 10;
    const ax = W / 2 - (size * 3 + gap * 2) / 2, ay = H - PANEL_H / 2 - size / 2 - 4;
    const p = S.player;
    drawAbilityButton(ax, ay, size, 'LMB', true, 0, '⚔');
    drawAbilityButton(ax + size + gap, ay, size, 'Q',
      S.char.mana >= Shared.FIREBALL_COST, p.fireballCd / 0.6, '🔥');
    drawAbilityButton(ax + (size + gap) * 2, ay, size, 'W',
      S.char.mana >= Shared.HEAL_COST, p.healCd / 1.5, '✚');

    // Controls hint at the panel's bottom edge.
    ctx.font = '11px Georgia';
    ctx.fillStyle = 'rgba(140,125,100,0.65)';
    ctx.fillText('Click: move/attack · Q: fireball · W: heal · I: inventory · Esc: menu', W / 2, H - 6);

    // Top-left: location, gold, hero.
    ctx.textAlign = 'left';
    ctx.font = '16px Georgia';
    ctx.fillStyle = '#c8a24b';
    const place = S.level.depth === 0 ? 'Town of Last Light' : `Dungeon — Depth ${S.level.depth}`;
    ctx.fillText(place, 18, 30);
    ctx.font = '14px Georgia';
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(`◉ ${S.char.gold} gold`, 18, 52);
    ctx.fillStyle = '#6f6450';
    ctx.fillText(`${S.char.name} · ${Shared.CLASSES[S.char.class].label}`, 18, 72);

    // Boss health banner.
    const boss = S.enemies.find((e) => e.type === 'boss' && !e.dead && e.aggro);
    if (boss) {
      const bbw = Math.min(500, W * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(W / 2 - bbw / 2, 24, bbw, 16);
      ctx.fillStyle = '#a01810';
      ctx.fillRect(W / 2 - bbw / 2 + 2, 26, (bbw - 4) * Math.max(0, boss.hp / boss.maxHp), 12);
      ctx.strokeStyle = '#4a3826';
      ctx.strokeRect(W / 2 - bbw / 2, 24, bbw, 16);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px Georgia';
      ctx.fillStyle = '#e8c0b0';
      ctx.fillText('Dungeon Lord', W / 2, 56);
    }
  }

  // ---------------------------------------------------------------------

  function onScreen(s, margin) {
    return s.x > -margin && s.x < canvas.width + margin &&
           s.y > -margin && s.y < canvas.height + margin;
  }

  function frame() {
    const S = Game.S;
    ctx.fillStyle = '#050403';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!S.running || !S.level) return;

    // Pin the player slightly above screen center (panel covers the bottom).
    cam.x = isoX(S.player.x, S.player.y) - canvas.width / 2;
    cam.y = isoY(S.player.x, S.player.y) - (canvas.height - PANEL_H) / 2;

    const { w, h, map } = S.level;

    // Pass 1: floors and ground decals.
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const tile = map[ty * w + tx];
        if (tile === T.WALL) continue;
        const light = lightAt(S, tx, ty);
        if (light <= 0) continue;
        if (!onScreen(worldToScreen(tx, ty), TW)) continue;
        drawFloorTile(S, tx, ty, tile, light);
      }
    }
    for (const e of S.enemies) if (e.dead) drawCorpse(S, e);

    // Pass 2: wall blocks and living entities, depth-sorted so walls
    // correctly occlude whatever stands behind them.
    const drawables = [];
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        if (map[ty * w + tx] !== T.WALL) continue;
        const light = lightAt(S, tx, ty);
        if (light <= 0) continue;
        if (!onScreen(worldToScreen(tx, ty), TW + WALL_H)) continue;
        // Sort walls by their tile center: an entity standing in front of
        // (south/east of) the block sorts after it, behind sorts before it.
        // Using the bottom corner instead draws walls over characters
        // standing just in front of them.
        drawables.push({ depth: tx + ty + 1, wall: { tx, ty, light } });
      }
    }
    for (const e of S.enemies) {
      if (!e.dead) drawables.push({ depth: e.x + e.y, enemy: e });
    }
    drawables.push({ depth: S.player.x + S.player.y, player: true });
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) {
      if (d.wall) drawWallBlock(S, d.wall.tx, d.wall.ty, d.wall.light);
      else if (d.enemy) drawEnemy(S, d.enemy);
      else drawPlayer(S);
    }

    drawProjectiles(S);
    drawFloaters(S);
    drawAtmosphere(S);
    drawHUD(S);
  }

  return { canvas, frame, screenToWorld, characterLook, TS: TW };
})();
