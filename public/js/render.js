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

  // Environment themes by depth band, Diablo II act style. Town walls reuse
  // the crypt tileset.
  function themeFor(depth) {
    if (depth === 0) return 'town';
    if (depth < 5) return 'crypt';
    if (depth < 10) return 'cave';
    if (depth < 15) return 'sunken';
    return 'hell';
  }
  const THEME_INFO = {
    town:   { name: 'Town of Last Light', tint: null },
    crypt:  { name: 'The Catacombs',      tint: 'rgba(30,50,110,0.07)' },
    cave:   { name: 'The Hollow Caves',   tint: 'rgba(110,70,30,0.07)' },
    sunken: { name: 'The Drowned Halls',  tint: 'rgba(20,110,80,0.08)' },
    hell:   { name: 'The Burning Depths', tint: 'rgba(150,20,5,0.11)' },
  };
  const THEME_DECOR = {
    crypt:  ['sarcophagus', 'bones', 'pillar'],
    cave:   ['stalagmite', 'rubble', 'bones'],
    sunken: ['pillar', 'rubble', 'bones'],
    hell:   ['statue', 'skulls', 'rubble'],
  };
  const DECOR_SCALE = {
    sarcophagus: 1.9, pillar: 1.8, statue: 2.1, stalagmite: 1.8,
    rubble: 1.3, bones: 0.9, skulls: 1.0,
  };

  // AI-generated terrain textures (ComfyUI). Tiles fall back to the
  // procedural flat-shaded look until the images load (or if they 404).
  const TERRAIN_SOURCES = {
    themes: {
      crypt:  { floors: ['floor-a', 'floor-b', 'floor-c', 'floor-d'], walls: ['wall-a', 'wall-b'], cap: 'cap' },
      cave:   { floors: ['cave-floor-a', 'cave-floor-b'], walls: ['cave-wall'], cap: 'cave-cap' },
      sunken: { floors: ['sunken-floor-a', 'sunken-floor-b'], walls: ['sunken-wall'], cap: 'sunken-cap' },
      hell:   { floors: ['hell-floor-a', 'hell-floor-b'], walls: ['hell-wall'], cap: 'hell-cap' },
    },
    cobbles: ['cobble-a', 'cobble-b'],
    stairs: 'stairs',
    stairsDown: 'stairs-down',
    fountain: 'fountain',
    trapPlate: 'trap-plate',
    trapSpikes: 'trap-spikes',
    decor: ['torch', 'sarcophagus', 'bones', 'pillar', 'stalagmite', 'rubble', 'statue', 'skulls'],
  };
  const terrain = { themes: {}, cobbles: [], stairs: null, stairsDown: null, fountain: null, trapPlate: null, trapSpikes: null, decor: {} };
  {
    const load = (name, cb) => {
      const im = new Image();
      im.onload = () => cb(im);
      im.src = `img/terrain/${name}.png`;
    };
    for (const [tname, set] of Object.entries(TERRAIN_SOURCES.themes)) {
      const t = { floors: [], walls: [], cap: null };
      terrain.themes[tname] = t;
      set.floors.forEach((n, i) => load(n, (im) => { t.floors[i] = im; }));
      set.walls.forEach((n, i) => load(n, (im) => { t.walls[i] = im; }));
      load(set.cap, (im) => { t.cap = im; });
    }
    TERRAIN_SOURCES.cobbles.forEach((n, i) => load(n, (im) => { terrain.cobbles[i] = im; }));
    load(TERRAIN_SOURCES.stairs, (im) => { terrain.stairs = im; });
    load(TERRAIN_SOURCES.stairsDown, (im) => { terrain.stairsDown = im; });
    load(TERRAIN_SOURCES.fountain, (im) => { terrain.fountain = im; });
    load(TERRAIN_SOURCES.trapPlate, (im) => { terrain.trapPlate = im; });
    load(TERRAIN_SOURCES.trapSpikes, (im) => { terrain.trapSpikes = im; });
    for (const n of TERRAIN_SOURCES.decor) load(n, (im) => { terrain.decor[n] = im; });
  }

  // Fog state per tile: hidden, remembered, or in view. Distance falloff
  // and flicker are handled by the smooth screen-space darkness pass, so
  // tiles in view render at full light.
  function lightAt(S, tx, ty) {
    const i = ty * S.level.w + tx;
    if (!S.fog.discovered[i]) return 0;
    if (!S.fog.visible[i]) return 0.3;
    return 1;
  }

  // Smooth torchlight: a radial darkness gradient pinned to the player,
  // squashed to the iso plane, with a soft flame flicker.
  function drawDarkness(S) {
    const ps = worldToScreen(S.player.x, S.player.y);
    const flicker = 1 + Math.sin(S.time * 9) * 0.025 + Math.sin(S.time * 23) * 0.015;
    const R = Game.VISION_RADIUS * TW * 0.62 * flicker;
    ctx.save();
    ctx.translate(ps.x, ps.y - TH / 2);
    ctx.scale(1, 0.55);
    const g = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.8, 'rgba(2,3,8,0.55)');
    g.addColorStop(1, 'rgba(2,3,8,0.84)');
    ctx.fillStyle = g;
    ctx.fillRect(-canvas.width * 2, -canvas.height * 4, canvas.width * 4, canvas.height * 8);
    ctx.restore();
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

    const theme = themeFor(S.level.depth);
    const tset = terrain.themes[theme];
    const pool = theme === 'town' ? terrain.cobbles : (tset ? tset.floors : []);
    const tex = tile === T.STAIRS && terrain.stairs
      ? terrain.stairs
      : pool[((tx * 7 + ty * 13) >>> 0) % (pool.length || 1)];

    if (tex) {
      // Texture squashed into the diamond; clipping keeps the seams exact.
      ctx.save();
      diamondPath(s);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      // Sample one quadrant per tile: larger texture features at this
      // scale, and neighboring tiles stop looking like exact copies.
      const q = ((tx * 31 + ty * 17) >>> 0) % 4;
      const half = tex.width / 2;
      ctx.drawImage(tex, (q & 1) * half, (q >> 1) * half, half, half,
        s.x - TW / 2, s.y, TW, TH);
      ctx.restore();
      // Fog overlay (smooth lighting is a separate screen-space pass).
      diamondPath(s);
      ctx.fillStyle = `rgba(4,6,12,${Math.min(0.95, 1 - light)})`;
      ctx.fill();
      // Living ground: lava veins pulse in hell, water glints when drowned.
      if (light > 0.5 && tile === T.FLOOR) {
        if (theme === 'hell' && n > 0.45) {
          ctx.globalCompositeOperation = 'lighter';
          diamondPath(s);
          ctx.fillStyle = `rgba(255,80,15,${0.05 + 0.05 * Math.sin(S.time * 2.2 + tx * 1.7 + ty * 2.3)})`;
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else if (theme === 'sunken' && n > 0.6) {
          ctx.globalCompositeOperation = 'lighter';
          diamondPath(s);
          ctx.fillStyle = `rgba(120,210,235,${0.03 + 0.03 * Math.sin(S.time * 1.6 + tx * 2.9 + ty * 1.3)})`;
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    } else {
      // Procedural fallback: cold gray-blue stone with per-tile variation.
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
    }

    if (tile === T.PORTAL) drawPortal(S, tx, ty, light);
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
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, TH * 1.4 * pulse);
    g.addColorStop(0, `rgba(220,160,255,${0.95 * light})`);
    g.addColorStop(0.6, `rgba(140,60,220,${0.7 * light})`);
    g.addColorStop(1, 'rgba(60,10,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, TW * 0.45 * pulse, TH * 0.7 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFountain(S, tx, ty, light) {
    const c = worldToScreen(tx + 0.5, ty + 0.5);
    if (terrain.fountain) {
      // Soft magical glow at the base; the fountain itself is a sprite
      // object drawn depth-sorted in pass 2.
      const shimmer = 0.5 + Math.sin(S.time * 3) * 0.12;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(70,160,220,${shimmer * light * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, TW * 0.4, TH * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
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

  function drawFountainObject(S, tx, ty, light) {
    const img = terrain.fountain;
    const c = worldToScreen(tx + 0.5, ty + 0.5);
    const ht = TH * 2.4;
    const wd = ht * (img.width / img.height);
    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, c.x - wd / 2, c.y + TH / 2 - ht, wd, ht);
    ctx.restore();
  }

  // The descent to the next level: the staircase sprite plus a pulsing
  // beacon and animated chevrons so the exit reads clearly from across a room.
  function drawStairsObject(S, tx, ty, light) {
    const c = worldToScreen(tx + 0.5, ty + 0.5);
    const lit = Math.min(1, light + 0.2);

    // Rising glow beacon from the stairwell.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.7 + Math.sin(S.time * 3) * 0.3;
    const g = ctx.createRadialGradient(c.x, c.y - TH, 2, c.x, c.y - TH, TW * 1.15 * pulse);
    g.addColorStop(0, `rgba(150,200,255,${0.34 * lit})`);
    g.addColorStop(0.5, `rgba(90,150,255,${0.13 * lit})`);
    g.addColorStop(1, 'rgba(20,40,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - TW * 1.3, c.y - TH * 3.2, TW * 2.6, TH * 5);
    ctx.restore();

    // The staircase sprite.
    const img = terrain.stairsDown;
    if (img) {
      const ht = TH * 2.9;
      const wd = ht * (img.width / img.height);
      ctx.save();
      ctx.globalAlpha = lit;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, c.x - wd / 2, c.y + TH * 0.45 - ht, wd, ht);
      ctx.restore();
    }

    // Chevrons spawning above and drifting down into the stairwell.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#a8d4ff';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const phase = (S.time * 1.4 + i * 0.34) % 1;
      const cy = c.y - TH * 2.5 + phase * TH * 1.3;
      ctx.globalAlpha = lit * (1 - phase) * 0.9;
      ctx.beginPath();
      ctx.moveTo(c.x - 11, cy);
      ctx.lineTo(c.x, cy + 8);
      ctx.lineTo(c.x + 11, cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // An armed trap's pressure plate, clipped flat into its tile with a faint
  // pulsing warning glow (gold-tinted for the cursed gold trap).
  function drawTrapPlate(S, tr, light) {
    const img = terrain.trapPlate;
    if (!img) return;
    const s = worldToScreen(Math.floor(tr.x), Math.floor(tr.y));
    ctx.save();
    diamondPath(s);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.min(1, light + 0.1);
    ctx.drawImage(img, s.x - TW / 2, s.y, TW, TH);
    ctx.restore();
    // Warning shimmer in the runes.
    const c = worldToScreen(tr.x, tr.y);
    const pulse = 0.4 + Math.abs(Math.sin(S.time * 3)) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const col = tr.kind === 'gold' ? '255,200,80' : '255,70,40';
    const g = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, TW * 0.5);
    g.addColorStop(0, `rgba(${col},${0.22 * pulse * Math.min(1, light + 0.2)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, TW * 0.5, TH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Sprung iron spikes, drawn as a depth-sorted object after a spike trap fires.
  function drawTrapSpikes(S, tr, light) {
    const img = terrain.trapSpikes;
    if (!img) return;
    const c = worldToScreen(tr.x, tr.y);
    const pop = Math.min(1, tr.t / 0.12); // quick jab up
    const ht = TH * 1.7 * pop;
    const wd = ht * (img.width / img.height);
    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, c.x - wd / 2, c.y + TH * 0.25 - ht, wd, ht);
    ctx.restore();
  }

  function drawDecor(S, d, light) {
    const kinds = THEME_DECOR[themeFor(S.level.depth)];
    const img = kinds && terrain.decor[kinds[d.kind % kinds.length]];
    if (!img) return;
    const s = worldToScreen(d.x, d.y);
    const ht = TH * (DECOR_SCALE[kinds[d.kind % kinds.length]] || 1.4);
    const wd = ht * (img.width / img.height);
    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, s.x - wd / 2, s.y + TH * 0.25 - ht, wd, ht);
    ctx.restore();
  }

  // Wall-mounted torch with a flickering glow, hung on the left face.
  function drawTorch(S, tx, ty, light) {
    const img = terrain.decor.torch;
    if (!img) return;
    const s = worldToScreen(tx, ty);
    const cx = s.x - TW / 4, cy = s.y + TH * 0.75 - WALL_H * 0.35;
    const ht = WALL_H * 0.65;
    const wd = ht * (img.width / img.height);
    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.25);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, cx - wd / 2, cy - ht / 2, wd, ht);
    ctx.restore();
    const flicker = 0.8 + Math.sin(S.time * 13 + tx * 5 + ty * 3) * 0.12
                  + Math.sin(S.time * 29 + tx) * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy - ht * 0.3, 2, cx, cy - ht * 0.3, TW * 0.9 * flicker);
    g.addColorStop(0, `rgba(255,170,60,${0.32 * Math.min(1, light * 2)})`);
    g.addColorStop(0.5, `rgba(255,120,30,${0.12 * Math.min(1, light * 2)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - TW, cy - ht * 0.3 - TW, TW * 2, TW * 2);
    ctx.restore();
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

    const tset = terrain.themes[themeFor(S.level.depth)] || terrain.themes.crypt;
    const wallTex = tset.walls[((tx * 5 + ty * 11) >>> 0) % (tset.walls.length || 1)];
    if (wallTex && tset.cap) {
      // Texture each face inside its clipped polygon; per-face brightness
      // (cap lit, left dimmer, right darkest) via a darkness overlay.
      const face = (pts, tex, shade) => {
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        const path = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
        };
        ctx.save();
        path();
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        const q = ((tx * 13 + ty * 29) >>> 0) % 4;
        const half = tex.width / 2;
        ctx.drawImage(tex, (q & 1) * half, (q >> 1) * half, half, half,
          x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
        ctx.restore();
        path();
        ctx.fillStyle = `rgba(4,6,12,${Math.min(0.95, 1 - shade * light)})`;
        ctx.fill();
      };
      const up = (p) => ({ x: p.x, y: p.y - WALL_H });
      face([up(D), up(C), C, D], wallTex, 0.7);
      face([up(C), up(B), B, C], wallTex, 0.45);
      face([up(A), up(B), up(C), up(D)], tset.cap, 1.0);
      // Crisp top edge.
      ctx.strokeStyle = `rgba(0,0,0,${0.4 * light})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y - WALL_H);
      ctx.lineTo(B.x, B.y - WALL_H);
      ctx.lineTo(C.x, C.y - WALL_H);
      ctx.lineTo(D.x, D.y - WALL_H);
      ctx.closePath();
      ctx.stroke();
      return;
    }

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
    if (light < 0.5) return; // enemies only show in direct view, not memory
    const look = ENEMY_LOOKS[e.type];
    const r = look.size * E;
    const s = worldToScreen(e.x, e.y); // feet position

    // Dying: play the collapse frame, fading out over the corpse decal.
    if (e.dead) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, light + 0.15) * Math.max(0, 1 - e.deadT / 0.9);
      Sprites.drawEnemySprite(ctx, e.type, s.x, s.y, r * 3.1, false, 'death');
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = Math.min(1, light + 0.15);
    drawShadow(s, r);

    const flash = e.flash > 0;
    const by = s.y - r;                 // body center, raised off the ground
    let pose = 'idle';
    if (e.attackT > 0) pose = 'attack';
    else if (e.moving && Math.sin(S.time * 9 + (e.x + e.y) * 2) > 0) pose = 'walk';
    // Image sprite when available; procedural shapes otherwise.
    if (!Sprites.drawEnemySprite(ctx, e.type, s.x, s.y, r * 3.1, flash, pose)) {
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
    }

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
    const opts = {
      x: s.x, y: s.y, scale: E * 0.36,
      facing: p.facing, moving: !!p.moving, time: S.time,
      swing: p.swing > 0 ? 1 - p.swing / (p.swingMax || 0.18) : -1,
      skillPose: p.skillPose,
      look: characterLook(S.char), cls: S.char.class,
      hasWeapon: S.items.some((it) => it.equipped && it.kind === 'weapon'),
      hasArmor: S.items.some((it) => it.equipped && it.kind === 'armor'),
      flash: p.hitFlash > 0,
      dead: S.deathPending,
    };
    // Image sprites when available for this class; procedural otherwise.
    if (!Sprites.drawHeroSprite(ctx, opts)) Sprites.drawHero(ctx, opts);
  }

  function drawProjectiles(S) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const PR_COLORS = {
      fireball:  ['rgba(255,240,180,1)', 'rgba(255,140,40,0.9)', 'rgba(200,40,0,0)', 9],
      bolt:      ['rgba(235,245,255,1)', 'rgba(110,180,255,0.9)', 'rgba(30,80,220,0)', 8],
      knife:     ['rgba(245,245,250,1)', 'rgba(180,190,205,0.85)', 'rgba(80,90,110,0)', 5],
      shadowbolt:['rgba(220,180,255,1)', 'rgba(140,40,200,0.8)', 'rgba(60,0,100,0)', 7],
    };
    for (const pr of S.projectiles) {
      const s = worldToScreen(pr.x, pr.y);
      s.y -= E * 0.4; // projectiles fly at chest height
      const [c0, c1, c2, r] = PR_COLORS[pr.kind] || PR_COLORS.shadowbolt;
      const g = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, r * 1.8);
      g.addColorStop(0, c0);
      g.addColorStop(0.4, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Transient skill visuals: expanding novas, slams, slashes, dash streaks.
  function drawEffects(S) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fx of S.effects) {
      const k = Math.min(1, fx.t / fx.dur);
      const c = worldToScreen(fx.x, fx.y);
      const cy = c.y - TH * 0.6;
      if (fx.kind === 'nova' || fx.kind === 'frost' || fx.kind === 'slam') {
        const rad = (fx.radius || 2) * (TW / 2) * (0.25 + k * 0.95);
        const a = (1 - k) * 0.8;
        const col = fx.kind === 'frost' ? '120,210,255' : fx.kind === 'slam' ? '255,180,90' : '210,220,255';
        ctx.lineWidth = Math.max(2, TH * 0.3 * (1 - k));
        ctx.strokeStyle = `rgba(${col},${a})`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (fx.kind !== 'nova') {
          ctx.fillStyle = `rgba(${col},${a * 0.22})`;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fx.kind === 'cleave') {
        const reach = (fx.range || 2) * (TW / 2);
        const wc = Math.cos(fx.ang), ws = Math.sin(fx.ang);
        let dx = wc - ws, dy = (wc + ws) / 2; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const a = Math.atan2(dy, dx);
        ctx.strokeStyle = `rgba(235,240,255,${(1 - k) * 0.85})`;
        ctx.lineWidth = Math.max(2, TH * 0.28);
        ctx.beginPath();
        ctx.ellipse(c.x, cy, reach, reach * 0.5, a, -0.85 + k * 0.7, 0.85 + k * 0.7);
        ctx.stroke();
      } else if (fx.kind === 'dashline') {
        const c2 = worldToScreen(fx.x2, fx.y2);
        ctx.strokeStyle = `rgba(${fx.color || '200,200,255'},${(1 - k) * 0.7})`;
        ctx.lineWidth = Math.max(2, TH * 0.5 * (1 - k));
        ctx.beginPath();
        ctx.moveTo(c.x, cy); ctx.lineTo(c2.x, c2.y - TH * 0.6); ctx.stroke();
      } else if (fx.kind === 'slash') {
        const off = TH * 0.7;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.9})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(c.x - off, cy - TH * 0.3 - off * 0.5);
        ctx.lineTo(c.x + off, cy - TH * 0.3 + off * 0.5);
        ctx.stroke();
      } else if (fx.kind === 'heal') {
        const rad = TW * 0.4 * (0.4 + k);
        ctx.fillStyle = `rgba(90,220,120,${(1 - k) * 0.35})`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - TH * 0.7, rad, rad * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'firetrap') {
        // A column of fire bursting up from the floor.
        const h = TH * 3 * (0.3 + k * 0.7);
        const wd = (fx.radius || 1.5) * TW * 0.5 * (1 - k * 0.3);
        const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y - h);
        g.addColorStop(0, `rgba(255,230,150,${(1 - k) * 0.9})`);
        g.addColorStop(0.5, `rgba(255,130,30,${(1 - k) * 0.7})`);
        g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - h / 2, wd, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'curse') {
        // Cursed gold sparkle swirling up from the rune.
        const rad = (fx.radius || 1.4) * (TW / 2) * (0.3 + k);
        ctx.strokeStyle = `rgba(255,205,90,${(1 - k) * 0.8})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = S.time * 4 + i * 1.05;
          const rr = rad * (0.4 + 0.5 * ((k + i / 6) % 1));
          ctx.fillStyle = `rgba(255,220,120,${(1 - k) * 0.8})`;
          ctx.fillRect(c.x + Math.cos(a) * rr - 1, c.y + Math.sin(a) * rr * 0.5 - TH * k - 1, 2, 2);
        }
      }
    }
    ctx.restore();
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
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(ps.x, ps.y, TH, ps.x, ps.y, TW * 5 * flicker);
    glow.addColorStop(0, 'rgba(255,170,70,0.12)');
    glow.addColorStop(0.5, 'rgba(255,130,40,0.05)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Theme color grading: each environment gets its own cast.
    const tint = THEME_INFO[themeFor(S.level.depth)].tint;
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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

  // Ambient particles per environment: rising embers in hell, drifting
  // dust in crypts and caves, falling drips in the Drowned Halls, and
  // wandering fireflies in town.
  const PARTICLE_THEMES = {
    hell:   { n: 36, mode: 'rise' },
    crypt:  { n: 22, mode: 'dust', color: '170,180,215' },
    cave:   { n: 22, mode: 'dust', color: '205,165,110' },
    sunken: { n: 20, mode: 'drip' },
    town:   { n: 16, mode: 'firefly' },
  };
  const particles = [];
  let particleTheme = null;
  function drawParticles(S) {
    const theme = themeFor(S.level.depth);
    const cfg = PARTICLE_THEMES[theme];
    if (!cfg) { particles.length = 0; particleTheme = null; return; }
    if (particleTheme !== theme) {
      particleTheme = theme;
      particles.length = 0;
      for (let i = 0; i < cfg.n; i++) {
        particles.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), p: Math.random() * 6.28 });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of particles) {
      let x = e.x * canvas.width, w = 2, h = 2;
      const y = e.y * canvas.height;
      if (cfg.mode === 'rise') {
        e.y -= 0.0009 * e.s;
        if (e.y < 0) { e.y = 1; e.x = Math.random(); }
        x += Math.sin(S.time * 2 + e.p) * 9;
        const a = 0.28 + Math.sin(S.time * 5 + e.p) * 0.16;
        ctx.fillStyle = `rgba(255,${(120 + e.s * 70) | 0},40,${Math.max(0.05, a)})`;
      } else if (cfg.mode === 'dust') {
        e.y += 0.00012 * e.s;
        e.x += 0.00008 * Math.sin(S.time * 0.7 + e.p);
        if (e.y > 1) { e.y = 0; e.x = Math.random(); }
        const a = 0.04 + Math.abs(Math.sin(S.time * 0.9 + e.p)) * 0.07;
        ctx.fillStyle = `rgba(${cfg.color},${a})`;
      } else if (cfg.mode === 'drip') {
        e.y += 0.004 * e.s;
        if (e.y > 1) { e.y = 0; e.x = Math.random(); }
        w = 1; h = 7;
        ctx.fillStyle = `rgba(140,200,230,${0.1 + e.s * 0.08})`;
      } else { // firefly
        x += Math.sin(S.time * 0.8 + e.p) * 30;
        const a = Math.max(0, Math.sin(S.time * 1.4 + e.p)) * 0.35;
        ctx.fillStyle = `rgba(255,210,120,${a})`;
      }
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
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

    // Ability bar: basic attack, three class skills (Q/W/E), and heal (R).
    const p = S.player;
    const skills = Shared.SKILLS[S.char.class] || [];
    const slots = [{ key: 'LMB', icon: '⚔️', ready: true, cd: 0 }];
    for (const sk of skills) {
      slots.push({
        key: sk.key, icon: sk.icon,
        ready: S.char.mana >= sk.cost && (p.skillCd[sk.id] || 0) <= 0,
        cd: (p.skillCd[sk.id] || 0) / sk.cd,
      });
    }
    slots.push({ key: 'R', icon: '❤️', ready: S.char.mana >= Shared.HEAL_COST && p.healCd <= 0, cd: p.healCd / 1.5 });

    const size = 46, gap = 9;
    const totalW = slots.length * size + (slots.length - 1) * gap;
    let sx = W / 2 - totalW / 2;
    const ay = H - PANEL_H / 2 - size / 2 - 4;
    for (const s of slots) {
      drawAbilityButton(sx, ay, size, s.key, s.ready, s.cd, s.icon);
      sx += size + gap;
    }

    // Controls hint at the panel's bottom edge.
    ctx.font = '11px Georgia';
    ctx.fillStyle = 'rgba(140,125,100,0.65)';
    const names = skills.map((sk) => `${sk.key} ${sk.name}`).join(' · ');
    ctx.fillText(`Click: move/attack · ${names} · R Heal · I Inventory · Esc Menu`, W / 2, H - 6);

    // Top-left: location, gold, hero.
    ctx.textAlign = 'left';
    ctx.font = '16px Georgia';
    ctx.fillStyle = '#c8a24b';
    const place = S.level.depth === 0
      ? 'Town of Last Light'
      : `${THEME_INFO[themeFor(S.level.depth)].name} — Depth ${S.level.depth}`;
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
    // Impact shake.
    const sh = Math.max(0, shakeEnd - S.time) / 0.3 * shakeMag;
    if (sh > 0.05) {
      cam.x += Math.sin(S.time * 71) * sh;
      cam.y += Math.cos(S.time * 93) * sh * 0.7;
    }

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

    // Armed trap plates lie flat on the floor (sprung spikes are objects,
    // depth-sorted with entities in pass 2).
    for (const tr of S.level.traps || []) {
      if (!tr.armed) continue;
      const light = lightAt(S, Math.floor(tr.x), Math.floor(tr.y));
      if (light <= 0) continue;
      if (!onScreen(worldToScreen(tr.x, tr.y), TW)) continue;
      drawTrapPlate(S, tr, light);
    }

    // Pass 2: wall blocks and living entities, depth-sorted so walls
    // correctly occlude whatever stands behind them.
    const drawables = [];
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const tile = map[ty * w + tx];
        const isFountainObj = tile === T.FOUNTAIN && terrain.fountain;
        const isStairsObj = tile === T.STAIRS && terrain.stairsDown;
        if (tile !== T.WALL && !isFountainObj && !isStairsObj) continue;
        const light = lightAt(S, tx, ty);
        if (light <= 0) continue;
        if (!onScreen(worldToScreen(tx, ty), TW + WALL_H)) continue;
        if (isFountainObj) {
          drawables.push({ depth: tx + ty + 1, fountain: { tx, ty, light } });
          continue;
        }
        if (isStairsObj) {
          drawables.push({ depth: tx + ty + 1, stairs: { tx, ty, light } });
          continue;
        }
        // Sort walls by their tile center: an entity standing in front of
        // (south/east of) the block sorts after it, behind sorts before it.
        // Using the bottom corner instead draws walls over characters
        // standing just in front of them.
        drawables.push({ depth: tx + ty + 1, wall: { tx, ty, light } });
        // Sparse torches on walls that face an open floor tile below.
        const n = tileNoise(tx, ty);
        if (n > 0.8 && n < 0.92 && ty + 1 < h && map[(ty + 1) * w + tx] !== T.WALL) {
          drawables.push({ depth: tx + ty + 1.01, torch: { tx, ty, light } });
        }
      }
    }
    for (const d of S.level.decor || []) {
      const light = lightAt(S, Math.floor(d.x), Math.floor(d.y));
      if (light <= 0) continue;
      if (!onScreen(worldToScreen(d.x, d.y), TW)) continue;
      drawables.push({ depth: d.x + d.y, decor: d, light });
    }
    for (const tr of S.level.traps || []) {
      if (!(tr.sprung && tr.kind === 'spike')) continue;
      const light = lightAt(S, Math.floor(tr.x), Math.floor(tr.y));
      if (light <= 0) continue;
      if (!onScreen(worldToScreen(tr.x, tr.y), TW)) continue;
      drawables.push({ depth: tr.x + tr.y, spikes: tr, light });
    }
    for (const e of S.enemies) {
      // Dying enemies stay in the scene briefly for their collapse frame.
      if (!e.dead || e.deadT < 0.9) drawables.push({ depth: e.x + e.y, enemy: e });
    }
    drawables.push({ depth: S.player.x + S.player.y, player: true });
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) {
      if (d.wall) drawWallBlock(S, d.wall.tx, d.wall.ty, d.wall.light);
      else if (d.torch) drawTorch(S, d.torch.tx, d.torch.ty, d.torch.light);
      else if (d.fountain) drawFountainObject(S, d.fountain.tx, d.fountain.ty, d.fountain.light);
      else if (d.stairs) drawStairsObject(S, d.stairs.tx, d.stairs.ty, d.stairs.light);
      else if (d.spikes) drawTrapSpikes(S, d.spikes, d.light);
      else if (d.decor) drawDecor(S, d.decor, d.light);
      else if (d.enemy) drawEnemy(S, d.enemy);
      else drawPlayer(S);
    }

    drawProjectiles(S);
    drawEffects(S);
    drawDarkness(S);
    drawFloaters(S);
    drawAtmosphere(S);
    drawParticles(S);
    drawTransition(S);
    drawHUD(S);
  }

  // Level-change animation: a swirling vortex fades to black at the midpoint
  // (when the level swaps), then opens back up, with the destination named.
  function drawTransition(S) {
    const tr = S.transition;
    if (!tr) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    // Closing (out) ramps 0->1 by the swap midpoint; opening (in) 1->0 after.
    const cover = tr.t < tr.mid
      ? (tr.t / tr.mid)
      : 1 - (tr.t - tr.mid) / (tr.dur - tr.mid);
    const k = Math.max(0, Math.min(1, cover));

    // Swirling energy ring that tightens as it closes.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tone = tr.kind === 'portal' ? [200, 130, 255] : [120, 180, 255];
    const spin = S.time * 3;
    const maxR = Math.hypot(W, H) * 0.6;
    for (let i = 0; i < 5; i++) {
      const rr = maxR * (1 - k) * (0.4 + i * 0.16) + 24;
      const a = k * 0.5 * (1 - i / 6);
      ctx.strokeStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${a})`;
      ctx.lineWidth = 6 + i * 2;
      ctx.beginPath();
      for (let s = 0; s <= 1; s += 0.05) {
        const ang = spin + i * 0.6 + s * Math.PI * 2;
        const r = rr * (0.6 + 0.4 * s);
        const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.62;
        s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Darkness closing in from the edges (radial).
    const g = ctx.createRadialGradient(cx, cy, maxR * (1 - k) * 0.5, cx, cy, maxR);
    g.addColorStop(0, `rgba(2,3,8,${k * 0.2})`);
    g.addColorStop(0.6, `rgba(2,3,8,${k})`);
    g.addColorStop(1, `rgba(2,3,8,${Math.min(1, k + 0.2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Destination label, brightest at the darkest point.
    const label = tr.target === 0 ? 'Town of Last Light'
      : `${placeName(tr.target)} — Depth ${tr.target}`;
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px Georgia';
    ctx.fillStyle = `rgba(232,220,192,${k})`;
    ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
    ctx.fillText(label, cx, cy);
    ctx.shadowBlur = 0;
  }

  let shakeMag = 0, shakeEnd = 0;
  function shake(mag) {
    shakeMag = mag;
    shakeEnd = Game.S.time + 0.3;
  }

  function placeName(depth) {
    return THEME_INFO[themeFor(depth)].name;
  }

  return { canvas, frame, screenToWorld, characterLook, placeName, shake, TS: TW };
})();
