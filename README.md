# Dungeon Depths

![Dungeon Depths banner](public/img/banner.png)

A self-hostable, browser-based action RPG inspired by Diablo. Click your way
through procedurally generated dungeons, slay skeletons, zombies and demons,
fight a boss every 5 depths, and hoard randomized loot — with all progress
persisted to PostgreSQL.

Everything is rendered with plain HTML5 Canvas and vanilla JavaScript in a
Diablo II-style isometric view (2:1 diamond tiles, raised wall blocks,
depth-sorted occlusion) — no frameworks, no image assets.

## Quick start

Requirements: Docker with the compose plugin.

```bash
cp .env.example .env
# Edit .env: set SESSION_SECRET and POSTGRES_PASSWORD to your own values!
docker compose up -d --build
```

Open http://localhost:3000, create an account, forge a hero, descend.

The database schema is created automatically on first start, and character
data lives in the `pgdata` named volume — `docker compose down` and upgrades
won't lose progress (only `docker compose down -v` will).

## Controls

| Input | Action |
| --- | --- |
| Left click / hold | Move (click an enemy to attack it) |
| Q | Fireball toward the cursor (costs mana) |
| W | Heal (costs mana) |
| I | Toggle inventory |
| Shift + click item | Destroy item |
| Esc | Pause menu (save & exit) |

## How it plays

- You start in the **Town of Last Light**: a fountain fully restores you,
  stairs lead to depth 1, and a purple portal jumps straight to the deepest
  level you've reached.
- Dungeons are procedurally generated (rooms + corridors) and shrouded in fog
  of war with a torch-glow vision radius. Find the stairs to descend.
- Enemies scale with depth; every 5th depth holds a **Dungeon Lord** boss.
- Loot has four rarity tiers — common (white), magic (blue), rare (yellow),
  legendary (orange) — with randomized stats.
- The **🎲 Random Hero** button on the character select screen generates a
  hero with a rolled fantasy name and class. Every character also gets a
  unique appearance (cloak, skin and hair) derived from its seed.
- Dying costs 15% of your gold and sends you back to town. Progress
  (level, XP, gold, inventory, depth) auto-saves every 30 seconds and on
  logout/death/tab-close.

## Architecture

```
├── docker-compose.yml   # game (Node.js, :3000) + db (postgres:16, named volume)
├── Dockerfile
├── db/
│   └── schema.sql       # idempotent schema, applied by the server on boot
├── src/                 # Express server + REST API
│   ├── server.js        # entrypoint, sessions, static hosting
│   ├── db.js            # pg pool + schema migration on startup
│   ├── auth.js          # register/login/logout (bcrypt + signed cookie)
│   ├── game.js          # characters, saves, kills, inventory API
│   └── loot.js          # server-side item generation
└── public/              # vanilla JS canvas client
    ├── index.html
    ├── style.css
    └── js/
        ├── shared.js    # balance formulas shared by server AND client
        ├── net.js       # REST wrapper
        ├── dungeon.js   # procedural generation, A*, line of sight
        ├── game.js      # simulation: combat, AI, fog, autosave
        ├── render.js    # canvas renderer + HUD
        ├── ui.js        # inventory / tooltips / death screen
        └── main.js      # screens, input, rAF loop
```

### Anti-cheat model

The client simulates combat for responsiveness, but the server is
authoritative for everything that persists:

- **XP, gold, levels and items** are only ever computed server-side. The
  client reports "I killed a skeleton" and the server rolls rewards using its
  *own* record of the character's depth — client-supplied numbers are ignored.
- Kill reports go through a per-character token bucket (~2.5 kills/sec
  sustained), so a script spamming the endpoint gains little.
- Saves only carry transient state (HP, mana, position, depth); HP/mana are
  clamped to server-derived maximums and depth can only advance one level
  past the deepest verified depth.
- Item stats are rolled in `src/loot.js`; equipping, drinking potions and
  level-up math all happen in SQL-backed endpoints.

This won't stop a determined cheater in a single-player-style game (nothing
client-driven ever fully can), but it makes the trivial attacks — gold/XP
injection, item forging, instant max level — impossible.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Host port the game is published on |
| `SESSION_SECRET` | — | Secret for signing session cookies. **Change it.** |
| `POSTGRES_USER` | `game` | Database user |
| `POSTGRES_PASSWORD` | — | Database password. **Change it.** |
| `POSTGRES_DB` | `game` | Database name |

## Development without Docker

You need Node 18+ and a local PostgreSQL:

```bash
npm install
DATABASE_URL=postgres://game:secret@localhost:5432/game \
SESSION_SECRET=dev-secret node src/server.js
```

## Operations

```bash
docker compose logs -f game        # server logs
docker compose exec db psql -U game game   # poke at the database
docker compose down                # stop (data persists)
docker compose down -v             # stop AND WIPE all save data
```

Back up saves with:

```bash
docker compose exec db pg_dump -U game game > backup.sql
```
