// Procedural dungeon generation: rooms + corridors on a tile grid.
// Layouts are deterministic per (character seed, depth) so a saved position
// is still valid after reloading.
const Dungeon = (() => {
  const T = { WALL: 0, FLOOR: 1, STAIRS: 2, PORTAL: 3, FOUNTAIN: 4 };

  // Deterministic PRNG (mulberry32).
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function carveRoom(map, w, room) {
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++)
        map[y * w + x] = T.FLOOR;
  }

  function carveCorridor(map, w, x1, y1, x2, y2, rand) {
    // L-shaped corridor, random elbow direction.
    const horizFirst = rand() < 0.5;
    const carve = (x, y) => { map[y * w + x] = map[y * w + x] === T.WALL ? T.FLOOR : map[y * w + x]; };
    if (horizFirst) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) carve(x, y1);
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) carve(x2, y);
    } else {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) carve(x1, y);
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) carve(x, y2);
    }
  }

  function center(room) {
    return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
  }

  // Town: a small safe hub with a fountain (full heal), stairs to depth 1,
  // and a portal that jumps to the deepest level reached.
  function generateTown() {
    const w = 26, h = 18;
    const map = new Array(w * h).fill(T.WALL);
    carveRoom(map, w, { x: 2, y: 2, w: w - 4, h: h - 4 });
    map[8 * w + 12] = T.FOUNTAIN;  // central plaza fountain
    map[8 * w + 20] = T.STAIRS;    // stairs down, east side
    map[3 * w + 4] = T.PORTAL;     // recall portal, northwest

    // Hand-placed town dressing (purely visual decor, drawn depth-sorted).
    // `sprite` names a town prop image; positions frame the fountain plaza.
    const decor = [
      // Buildings along the back of the plaza.
      { x: 6.8, y: 3.0, sprite: 'house' },
      { x: 11.0, y: 2.8, sprite: 'inn' },
      { x: 16.5, y: 3.0, sprite: 'smithy' },
      { x: 21.0, y: 3.3, sprite: 'house' },
      { x: 13.6, y: 3.0, sprite: 'banner' },
      { x: 23.0, y: 5.6, sprite: 'tree' },
      { x: 3.4, y: 5.6, sprite: 'tree' },
      // Market: stalls with vendors, a cart, townsfolk.
      { x: 7.5, y: 11.6, sprite: 'stall' },
      { x: 8.9, y: 11.1, sprite: 'merchant' },
      { x: 17.8, y: 11.6, sprite: 'stall' },
      { x: 16.6, y: 5.9, sprite: 'smith' },
      { x: 13.6, y: 12.3, sprite: 'villager' },
      { x: 10.4, y: 12.7, sprite: 'wagon' },
      // Lamp posts around the plaza edges.
      { x: 4.5, y: 7.0, sprite: 'lamppost' },
      { x: 20.5, y: 7.2, sprite: 'lamppost' },
      { x: 4.5, y: 12.2, sprite: 'lamppost' },
      { x: 20.5, y: 12.2, sprite: 'lamppost' },
      // Clutter.
      { x: 6.5, y: 5.6, sprite: 'barrel' },
      { x: 18.7, y: 5.6, sprite: 'crates' },
      { x: 14.6, y: 13.4, sprite: 'signpost' },
    ];

    return {
      w, h, map, depth: 0,
      entry: { x: 12, y: 13 },
      rooms: [{ x: 2, y: 2, w: w - 4, h: h - 4 }],
      enemies: [],
      decor,
      traps: [],
    };
  }

  function generate(seed, depth) {
    if (depth === 0) return generateTown();

    const rand = rng((seed ^ Math.imul(depth, 2654435761)) >>> 0);
    const w = 46 + Math.min(18, depth * 2);
    const h = 40 + Math.min(14, depth);
    const map = new Array(w * h).fill(T.WALL);

    // Place non-overlapping rooms.
    const rooms = [];
    const targetRooms = 7 + Math.min(6, Math.floor(depth / 2));
    for (let tries = 0; tries < 120 && rooms.length < targetRooms; tries++) {
      const rw = 5 + Math.floor(rand() * 6);
      const rh = 4 + Math.floor(rand() * 5);
      const rx = 1 + Math.floor(rand() * (w - rw - 2));
      const ry = 1 + Math.floor(rand() * (h - rh - 2));
      const room = { x: rx, y: ry, w: rw, h: rh };
      const overlaps = rooms.some((o) =>
        rx < o.x + o.w + 1 && rx + rw + 1 > o.x && ry < o.y + o.h + 1 && ry + rh + 1 > o.y);
      if (!overlaps) rooms.push(room);
    }

    for (const room of rooms) carveRoom(map, w, room);
    for (let i = 1; i < rooms.length; i++) {
      const a = center(rooms[i - 1]), b = center(rooms[i]);
      carveCorridor(map, w, a.x, a.y, b.x, b.y, rand);
    }

    // Entry in the first room; stairs in the room farthest from it.
    const entry = center(rooms[0]);
    let farthest = rooms[0], bestDist = -1;
    for (const room of rooms) {
      const c = center(room);
      const d = (c.x - entry.x) ** 2 + (c.y - entry.y) ** 2;
      if (d > bestDist) { bestDist = d; farthest = room; }
    }
    const stairs = center(farthest);
    map[stairs.y * w + stairs.x] = T.STAIRS;

    // Enemy roster by depth band, matching the environment theme.
    const types =
      depth < 5  ? ['skeleton', 'skeleton', 'zombie', 'ghoul', 'archer', 'wraith'] :
      depth < 10 ? ['spider', 'goblin', 'bat', 'troll', 'wraith', 'archer'] :
      depth < 15 ? ['drowned', 'lurker', 'slime', 'troll', 'drowned'] :
                   ['demon', 'imp', 'hellhound', 'brute', 'hellhound'];
    // Themed minions flanking the boss.
    const minion = depth < 5 ? 'skeleton' : depth < 10 ? 'goblin' : depth < 15 ? 'lurker' : 'hellhound';

    // Populate enemies (never in the entry room).
    const isBossLevel = depth % 5 === 0;
    const enemies = [];
    for (const room of rooms) {
      if (room === rooms[0]) continue;
      const isBossRoom = isBossLevel && room === farthest;
      if (isBossRoom) {
        const c = center(farthest);
        enemies.push({ type: 'boss', x: c.x + 0.5, y: c.y - 1.5 });
        // Boss minions.
        enemies.push({ type: minion, x: c.x - 1.5, y: c.y + 0.5 });
        enemies.push({ type: minion, x: c.x + 2.5, y: c.y + 0.5 });
        continue;
      }
      const count = 1 + Math.floor(rand() * (2 + Math.min(3, depth / 3)));
      for (let i = 0; i < count; i++) {
        const ex = room.x + 0.5 + Math.floor(rand() * room.w);
        const ey = room.y + 0.5 + Math.floor(rand() * room.h);
        if (map[Math.floor(ey) * w + Math.floor(ex)] !== T.FLOOR) continue;
        enemies.push({ type: types[Math.floor(rand() * types.length)], x: ex, y: ey });
      }
    }

    // Scatter decorative props on room floors (purely visual; the renderer
    // maps `kind` to theme-specific artwork).
    const decor = [];
    for (const room of rooms) {
      const count = Math.floor(rand() * 2.5);
      for (let i = 0; i < count; i++) {
        const dx = room.x + 1 + Math.floor(rand() * Math.max(1, room.w - 2));
        const dy = room.y + 1 + Math.floor(rand() * Math.max(1, room.h - 2));
        if (map[dy * w + dx] !== T.FLOOR) continue;
        if (Math.abs(dx + 0.5 - entry.x) + Math.abs(dy + 0.5 - entry.y) < 2.5) continue;
        decor.push({ x: dx + 0.5, y: dy + 0.5, kind: Math.floor(rand() * 3) });
      }
    }

    // A limited number of traps, placed on open floor away from the entry.
    // Deterministic via the same seeded rng, so a level's traps are stable.
    const traps = [];
    const TRAP_KINDS = ['spike', 'flame', 'gold'];
    const trapCount = Math.min(4, 1 + Math.floor(rand() * (1 + depth / 4)));
    for (let tries = 0; tries < 90 && traps.length < trapCount; tries++) {
      const room = rooms[1 + Math.floor(rand() * Math.max(1, rooms.length - 1))];
      if (!room) break;
      const tx = room.x + 1 + Math.floor(rand() * Math.max(1, room.w - 2));
      const ty = room.y + 1 + Math.floor(rand() * Math.max(1, room.h - 2));
      if (map[ty * w + tx] !== T.FLOOR) continue;
      if (Math.abs(tx + 0.5 - entry.x) + Math.abs(ty + 0.5 - entry.y) < 4) continue;
      if (traps.some((t) => Math.abs(t.x - tx) < 1.5 && Math.abs(t.y - ty) < 1.5)) continue;
      traps.push({ x: tx + 0.5, y: ty + 0.5, kind: TRAP_KINDS[Math.floor(rand() * TRAP_KINDS.length)], armed: true, t: 0 });
    }

    return { w, h, map, depth, entry, rooms, enemies, decor, traps };
  }

  const tileAt = (lvl, x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= lvl.w || ty >= lvl.h) return T.WALL;
    return lvl.map[ty * lvl.w + tx];
  };
  const walkable = (lvl, x, y) => tileAt(lvl, x, y) !== T.WALL;

  // Wall collision for a body with radius r: tests the four corners of the
  // bounding box (sufficient while r < 0.5, when the box spans ≤ 4 tiles).
  const boxWalkable = (lvl, x, y, r) =>
    walkable(lvl, x - r, y - r) && walkable(lvl, x + r, y - r) &&
    walkable(lvl, x - r, y + r) && walkable(lvl, x + r, y + r);

  // Bresenham line-of-sight between tile centers.
  function lineOfSight(lvl, x0, y0, x1, y1) {
    let tx0 = Math.floor(x0), ty0 = Math.floor(y0);
    const tx1 = Math.floor(x1), ty1 = Math.floor(y1);
    const dx = Math.abs(tx1 - tx0), dy = Math.abs(ty1 - ty0);
    const sx = tx0 < tx1 ? 1 : -1, sy = ty0 < ty1 ? 1 : -1;
    let err = dx - dy;
    while (tx0 !== tx1 || ty0 !== ty1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; tx0 += sx; }
      if (e2 < dx) { err += dx; ty0 += sy; }
      if ((tx0 !== tx1 || ty0 !== ty1) && !walkable(lvl, tx0, ty0)) return false;
    }
    return true;
  }

  // A* pathfinding on the grid (8-directional, no corner cutting).
  function findPath(lvl, sx, sy, tx, ty) {
    sx = Math.floor(sx); sy = Math.floor(sy);
    tx = Math.floor(tx); ty = Math.floor(ty);
    if (!walkable(lvl, tx, ty)) return null;
    if (sx === tx && sy === ty) return [];

    const { w, h } = lvl;
    const key = (x, y) => y * w + x;
    const open = [{ x: sx, y: sy, g: 0, f: 0 }];
    const gScore = new Map([[key(sx, sy), 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    const heur = (x, y) => Math.hypot(x - tx, y - ty);
    let iterations = 0;

    while (open.length > 0 && iterations++ < 4000) {
      // Pop lowest f (linear scan; maps are small).
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      const ck = key(cur.x, cur.y);
      if (cur.x === tx && cur.y === ty) {
        const path = [];
        let k = ck;
        while (cameFrom.has(k)) {
          path.unshift({ x: (k % w) + 0.5, y: Math.floor(k / w) + 0.5 });
          k = cameFrom.get(k);
        }
        return path;
      }
      if (closed.has(ck)) continue;
      closed.add(ck);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!walkable(lvl, nx, ny)) continue;
          // No cutting corners diagonally past walls.
          if (dx !== 0 && dy !== 0 && (!walkable(lvl, cur.x + dx, cur.y) || !walkable(lvl, cur.x, cur.y + dy))) continue;
          const nk = key(nx, ny);
          if (closed.has(nk)) continue;
          const g = cur.g + (dx !== 0 && dy !== 0 ? 1.41 : 1);
          if (g < (gScore.get(nk) ?? Infinity)) {
            gScore.set(nk, g);
            cameFrom.set(nk, ck);
            open.push({ x: nx, y: ny, g, f: g + heur(nx, ny) });
          }
        }
      }
    }
    return null;
  }

  return { T, generate, tileAt, walkable, boxWalkable, lineOfSight, findPath };
})();
