// Procedural Diablo II-style character art. Heroes are drawn as layered
// vector "paper dolls": class-distinct silhouettes, seed-based palettes,
// walk/attack animation, and equipped gear visible on the model.
// No image assets — everything is canvas paths and gradients.
const Sprites = (() => {

  const OUTLINE = '#0d0a08';

  function shade(hex, f) {
    // Lighten (f > 1) or darken (f < 1) a #rrggbb color.
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function ell(ctx, cx, cy, rx, ry, fill, outline) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function limb(ctx, x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineCap = 'round';
    ctx.lineWidth = width + 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  // -----------------------------------------------------------------------
  // Weapons

  function drawSword(ctx, hx, hy, ang, u) {
    const len = u * 1.7;
    const tx = hx + Math.cos(ang) * len, ty = hy + Math.sin(ang) * len;
    // Blade with outline and a bright edge highlight.
    limb(ctx, hx, hy, tx, ty, u * 0.16, '#b8c0cc');
    ctx.strokeStyle = '#e8eef8';
    ctx.lineWidth = u * 0.05;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    // Crossguard.
    const gx = hx + Math.cos(ang) * u * 0.35, gy = hy + Math.sin(ang) * u * 0.35;
    const pa = ang + Math.PI / 2;
    limb(ctx, gx - Math.cos(pa) * u * 0.3, gy - Math.sin(pa) * u * 0.3,
         gx + Math.cos(pa) * u * 0.3, gy + Math.sin(pa) * u * 0.3, u * 0.12, '#8a6a2a');
    // Pommel.
    ell(ctx, hx - Math.cos(ang) * u * 0.18, hy - Math.sin(ang) * u * 0.18, u * 0.12, u * 0.12, '#8a6a2a');
  }

  function drawDagger(ctx, hx, hy, ang, u) {
    const len = u * 0.85;
    limb(ctx, hx, hy, hx + Math.cos(ang) * len, hy + Math.sin(ang) * len, u * 0.12, '#c8d0da');
    ell(ctx, hx, hy, u * 0.1, u * 0.1, '#5a4326');
  }

  function drawStaff(ctx, hx, hy, lean, u, time) {
    const bx = hx - lean * u * 0.15, by = hy + u * 0.9;   // butt on the ground
    const tx = hx + lean * u * 0.35, ty = hy - u * 1.9;   // tip above shoulder
    limb(ctx, bx, by, tx, ty, u * 0.14, '#6a4e2c');
    // Arcane orb with a pulsing glow.
    const pulse = 1 + Math.sin(time * 6) * 0.15;
    const g = ctx.createRadialGradient(tx, ty, 0.5, tx, ty, u * 0.55 * pulse);
    g.addColorStop(0, 'rgba(220,240,255,0.95)');
    g.addColorStop(0.4, 'rgba(110,170,255,0.8)');
    g.addColorStop(1, 'rgba(40,80,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(tx, ty, u * 0.55 * pulse, 0, Math.PI * 2); ctx.fill();
    ell(ctx, tx, ty, u * 0.18, u * 0.18, '#bfe0ff', true);
  }

  function drawShield(ctx, cx, cy, u) {
    ell(ctx, cx, cy, u * 0.42, u * 0.55, '#6a4e2c', true);
    ell(ctx, cx, cy, u * 0.28, u * 0.38, '#7a5e38');
    ell(ctx, cx, cy, u * 0.1, u * 0.1, '#a8b0bc', true); // metal boss
  }

  // -----------------------------------------------------------------------
  // The hero

  // opts: { x, y (feet), scale, facing (world rad), moving, time, swing (0..1
  //         attack progress or -1), look, cls, hasWeapon, hasArmor, flash }
  function drawHero(ctx, o) {
    const u = o.scale;
    const t = o.time || 0;

    // World facing -> screen facing under the 2:1 iso projection.
    const wc = Math.cos(o.facing || 0), ws = Math.sin(o.facing || 0);
    let fx = wc - ws, fy = (wc + ws) / 2;
    const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const side = fx >= 0 ? 1 : -1;     // which side the weapon hand shows on
    const away = fy < -0.45;           // facing away from the camera
    const px = -fy, py = fx;           // screen-space perpendicular

    const walk = o.moving ? Math.sin(t * 11) : 0;
    const bob = o.moving ? Math.abs(Math.cos(t * 11)) * u * 0.14 : 0;

    const X = o.x, Y = o.y;
    const hipY = Y - u * 1.05 - bob;
    const shoulderY = Y - u * 2.0 - bob;
    const headY = Y - u * 2.55 - bob;
    const robe = o.cls === 'mage';

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(X, Y, u * 1.05, u * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (hidden under the mage's robe).
    if (!robe) {
      const stride = walk * u * 0.42;
      const hipL = { x: X - px * u * 0.26, y: hipY };
      const hipR = { x: X + px * u * 0.26, y: hipY };
      const pants = shade(o.look.cloak, 0.55);
      limb(ctx, hipL.x, hipL.y, hipL.x + fx * stride, Y - u * 0.15, u * 0.3, pants);
      limb(ctx, hipR.x, hipR.y, hipR.x - fx * stride, Y - u * 0.15, u * 0.3, pants);
      // Boots.
      ell(ctx, hipL.x + fx * stride, Y - u * 0.12, u * 0.22, u * 0.14, '#241a12');
      ell(ctx, hipR.x - fx * stride, Y - u * 0.12, u * 0.22, u * 0.14, '#241a12');
    }

    // Rogue cape, hanging behind the body.
    if (o.cls === 'rogue') {
      const sway = walk * u * 0.12;
      ctx.fillStyle = shade(o.look.cloak, 0.45);
      ctx.beginPath();
      ctx.moveTo(X - u * 0.5 - px * u * 0.2, shoulderY + u * 0.1);
      ctx.quadraticCurveTo(X - px * u * 0.5 + sway, hipY, X - u * 0.45 + sway, Y - u * 0.2);
      ctx.lineTo(X + u * 0.35 + sway, Y - u * 0.25);
      ctx.quadraticCurveTo(X + px * u * 0.3, hipY, X + u * 0.45 - px * u * 0.2, shoulderY + u * 0.15);
      ctx.closePath();
      ctx.fill();
    }

    // Off-hand gear behind the torso when facing away.
    const offX = X - px * side * u * 0.78, offY = Y - u * 1.35 - bob;
    if (away && o.cls === 'warrior') drawShield(ctx, offX, offY, u);

    // Torso.
    if (robe) {
      // Robe: shoulders flaring to a swaying hem at the ground.
      const sway = walk * u * 0.18;
      const g = ctx.createLinearGradient(X, shoulderY, X, Y);
      g.addColorStop(0, shade(o.look.cloak, 1.05));
      g.addColorStop(1, shade(o.look.cloak, 0.5));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(X - u * 0.55, shoulderY + u * 0.15);
      ctx.quadraticCurveTo(X - u * 0.85, hipY, X - u * 0.8 + sway, Y - u * 0.1);
      ctx.lineTo(X + u * 0.8 + sway, Y - u * 0.1);
      ctx.quadraticCurveTo(X + u * 0.85, hipY, X + u * 0.55, shoulderY + u * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2; ctx.stroke();
      // Rope belt.
      limb(ctx, X - u * 0.5, hipY, X + u * 0.5, hipY, u * 0.08, '#a8924e');
    } else {
      const g = ctx.createLinearGradient(X, shoulderY, X, hipY);
      g.addColorStop(0, shade(o.look.cloak, 1.1));
      g.addColorStop(1, shade(o.look.cloak, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(X - u * 0.62, shoulderY + u * 0.12);
      ctx.quadraticCurveTo(X - u * 0.55, hipY, X - u * 0.38, hipY + u * 0.18);
      ctx.lineTo(X + u * 0.38, hipY + u * 0.18);
      ctx.quadraticCurveTo(X + u * 0.55, hipY, X + u * 0.62, shoulderY + u * 0.12);
      ctx.quadraticCurveTo(X, shoulderY - u * 0.25, X - u * 0.62, shoulderY + u * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2; ctx.stroke();
      // Belt with buckle.
      limb(ctx, X - u * 0.42, hipY, X + u * 0.42, hipY, u * 0.14, '#3a2a18');
      ell(ctx, X, hipY, u * 0.1, u * 0.1, '#a8924e');
    }

    // Armor: breastplate sheen and pauldrons when armor is equipped
    // (warriors always look at least lightly armored).
    if (o.hasArmor || o.cls === 'warrior') {
      const metal = o.hasArmor ? '#9aa6b6' : shade(o.look.cloak, 1.25);
      if (o.hasArmor && !robe) {
        const g = ctx.createLinearGradient(X - u * 0.4, shoulderY, X + u * 0.4, hipY);
        g.addColorStop(0, '#b8c2d0');
        g.addColorStop(0.5, '#79858f');
        g.addColorStop(1, '#525c66');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(X, shoulderY + u * 0.5, u * 0.42, u * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ell(ctx, X - u * 0.55, shoulderY + u * 0.08, u * 0.26, u * 0.2, metal, true);
      ell(ctx, X + u * 0.55, shoulderY + u * 0.08, u * 0.26, u * 0.2, metal, true);
    }

    // Head.
    ell(ctx, X, headY, u * 0.48, u * 0.48, o.look.skin, true);

    if (o.cls === 'mage') {
      // Deep hood; only a shadowed face shows.
      ctx.fillStyle = shade(o.look.cloak, 0.7);
      ctx.beginPath();
      ctx.arc(X, headY - u * 0.05, u * 0.56, Math.PI * 0.85, Math.PI * 2.15);
      ctx.quadraticCurveTo(X + u * 0.5, headY + u * 0.45, X, headY + u * 0.5);
      ctx.quadraticCurveTo(X - u * 0.5, headY + u * 0.45, X - u * 0.55, headY + u * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2; ctx.stroke();
      if (!away) {
        ctx.fillStyle = 'rgba(10,6,4,0.75)';
        ctx.beginPath();
        ctx.ellipse(X + fx * u * 0.08, headY + u * 0.08, u * 0.3, u * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        // Glinting eyes in the hood's dark.
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(X + fx * u * 0.1 - u * 0.14, headY + u * 0.02, u * 0.08, u * 0.08);
        ctx.fillRect(X + fx * u * 0.1 + u * 0.08, headY + u * 0.02, u * 0.08, u * 0.08);
      }
    } else if (o.cls === 'warrior' && o.look.bald) {
      // Full helm with a visor slit.
      ell(ctx, X, headY - u * 0.04, u * 0.52, u * 0.5, '#8a96a6', true);
      if (!away) {
        ctx.fillStyle = '#1a1410';
        ctx.fillRect(X + fx * u * 0.12 - u * 0.26, headY - u * 0.02, u * 0.52, u * 0.1);
      }
      limb(ctx, X, headY - u * 0.5, X, headY - u * 0.85, u * 0.1, '#c03020'); // crest
    } else {
      // Hair (or a bare scalp for bald rogues).
      if (!o.look.bald) {
        ctx.fillStyle = o.look.hair;
        ctx.beginPath();
        ctx.arc(X, headY - u * 0.08, u * 0.46, Math.PI * 0.95, Math.PI * 2.05);
        ctx.quadraticCurveTo(X + u * 0.5, headY + u * 0.2, X + u * 0.3, headY + u * 0.25);
        ctx.lineTo(X - u * 0.3, headY + u * 0.25);
        ctx.quadraticCurveTo(X - u * 0.5, headY + u * 0.2, X - u * 0.46, headY);
        ctx.closePath();
        ctx.fill();
      }
      if (!away) {
        // Simple face: eyes only, D2 sprites never showed much more.
        ctx.fillStyle = '#241a12';
        ctx.fillRect(X + fx * u * 0.1 - u * 0.13, headY + u * 0.02, u * 0.07, u * 0.07);
        ctx.fillRect(X + fx * u * 0.1 + u * 0.07, headY + u * 0.02, u * 0.07, u * 0.07);
      }
    }

    // Weapon hand and weapon.
    const sAng = Math.atan2(fy, fx);
    const swingAng = o.swing >= 0 ? sAng - 0.9 + o.swing * 1.8 : sAng + 0.5;
    const hx = X + px * side * u * 0.72, hy = Y - u * 1.45 - bob;

    if (o.hasWeapon) {
      if (o.cls === 'warrior') drawSword(ctx, hx, hy, swingAng, u);
      else if (o.cls === 'rogue') {
        drawDagger(ctx, hx, hy, swingAng, u);
        drawDagger(ctx, X - px * side * u * 0.72, hy + u * 0.1, swingAng + 0.6, u);
      } else drawStaff(ctx, hx, hy, fx, u, t);
    }
    // Fist / hand.
    ell(ctx, hx, hy, u * 0.16, u * 0.16, o.look.skin, true);

    // Off-hand gear in front when facing the camera.
    if (!away && o.cls === 'warrior') drawShield(ctx, offX, offY, u);

    // Hit flash overlay.
    if (o.flash) {
      ctx.fillStyle = 'rgba(255,90,70,0.5)';
      ctx.beginPath();
      ctx.ellipse(X, Y - u * 1.4, u * 1.1, u * 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // -----------------------------------------------------------------------
  // Optional AI-generated pixel-art sprites (rendered with ComfyUI, chroma-
  // keyed to transparency). When a class has a fully loaded set,
  // drawHeroSprite draws it and returns true; otherwise the caller falls
  // back to the procedural paper doll above.

  const SPRITE_SOURCES = {};
  for (const cls of ['warrior', 'mage', 'rogue']) {
    SPRITE_SOURCES[cls] = {};
    for (const dir of ['front', 'back', 'side']) {
      SPRITE_SOURCES[cls][dir] = {
        idle: `img/sprites/${cls}-${dir}.png`,
        walk: `img/sprites/${cls}-${dir}-walk.png`,
        attack: `img/sprites/${cls}-${dir}-attack.png`,
        windup: `img/sprites/${cls}-${dir}-windup.png`,
        hit: `img/sprites/${cls}-${dir}-hit.png`,
      };
    }
    // Death collapse exists as a single (front) frame per class.
    SPRITE_SOURCES[cls].front.death = `img/sprites/${cls}-death.png`;
  }
  for (const enemy of ['skeleton', 'zombie', 'demon', 'boss']) {
    SPRITE_SOURCES[enemy] = {
      front: {
        idle: `img/sprites/${enemy}.png`,
        walk: `img/sprites/${enemy}-walk.png`,
        attack: `img/sprites/${enemy}-attack.png`,
        death: `img/sprites/${enemy}-death.png`,
      },
    };
  }

  const spriteCache = {};
  for (const [name, dirs] of Object.entries(SPRITE_SOURCES)) {
    spriteCache[name] = {};
    for (const [dir, poses] of Object.entries(dirs)) {
      spriteCache[name][dir] = {};
      for (const [pose, src] of Object.entries(poses)) {
        const img = new Image();
        img.onload = () => { spriteCache[name][dir][pose] = img; };
        img.src = src;
      }
    }
  }

  function drawHeroSprite(ctx, o) {
    const set = spriteCache[o.cls];
    if (!set || !set.front.idle || !set.back.idle || !set.side.idle) return false;
    const u = o.scale;
    const t = o.time || 0;

    // Same world facing -> screen facing mapping as drawHero.
    const wc = Math.cos(o.facing || 0), ws = Math.sin(o.facing || 0);
    let fx = wc - ws, fy = (wc + ws) / 2;
    const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;

    const dir = fy < -0.45 ? 'back' : (Math.abs(fx) > 0.7 ? 'side' : 'front');
    const poses = set[dir];
    const flip = dir === 'side' && fx > 0; // side art faces left

    // Pose priority: death > attack (wind-up then strike) > hit flinch >
    // walk cycle > idle. Missing frames fall back to idle.
    let img = poses.idle;
    let isDeath = false;
    if (o.dead && set.front.death) { img = set.front.death; isDeath = true; }
    else if (o.swing >= 0) {
      img = (o.swing < 0.5 ? (poses.windup || poses.attack) : poses.attack) || poses.idle;
    } else if (o.flash && poses.hit) img = poses.hit;
    else if (o.moving && poses.walk && Math.sin(t * 11) > 0) img = poses.walk;

    const bob = o.moving && !o.dead ? Math.abs(Math.cos(t * 11)) * u * 0.14 : 0;
    // Attack: a short lunge toward the facing direction sells the swing.
    const lunge = o.swing >= 0 && !o.dead ? Math.sin(o.swing * Math.PI) * u * 0.4 : 0;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, u * 1.05, u * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Collapsed poses are short and wide; height-normalizing them like a
    // standing frame would inflate the body.
    const ht = u * (isDeath ? 2.3 : 3.4);
    const wd = ht * (img.width / img.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(o.x + fx * lunge, o.y + fy * lunge * 0.5 - bob);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -wd / 2, -ht, wd, ht);
    ctx.restore();

    if (o.flash && !o.dead) {
      // Softer red wash when a dedicated flinch frame carries the hit.
      ctx.fillStyle = `rgba(255,90,70,${poses.hit ? 0.22 : 0.5})`;
      ctx.beginPath();
      ctx.ellipse(o.x, o.y - u * 1.4, u * 1.1, u * 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return true;
  }

  // Draws an enemy image sprite anchored at the feet; returns false when the
  // image isn't loaded so the caller can fall back to procedural shapes.
  // `pose` is one of idle/walk/attack/death; missing poses use idle, except
  // death which draws nothing without its frame (the corpse decal remains).
  function drawEnemySprite(ctx, type, x, y, height, flash, pose) {
    const poses = spriteCache[type] && spriteCache[type].front;
    if (!poses) return false;
    if (pose === 'death' && !poses.death) return false;
    const img = poses[pose] || poses.idle;
    if (!img) return false;
    const wd = height * (img.width / img.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (flash) ctx.filter = 'brightness(2.2)';
    ctx.drawImage(img, x - wd / 2, y - height, wd, height);
    ctx.restore();
    return true;
  }

  // Animated portrait for the character select screen.
  function drawPortrait(ctx, size, look, cls, time) {
    ctx.clearRect(0, 0, size, size);
    // Murky candle-lit backdrop.
    const g = ctx.createRadialGradient(size / 2, size * 0.4, 2, size / 2, size * 0.4, size * 0.7);
    g.addColorStop(0, '#3a2c1c');
    g.addColorStop(1, '#120d08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const img = spriteCache[cls] && spriteCache[cls].front.idle;
    if (img) {
      const ht = size * 0.9;
      const wd = ht * (img.width / img.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, (size - wd) / 2, size * 0.96 - ht, wd, ht);
      ctx.imageSmoothingEnabled = true;
      return;
    }
    drawHero(ctx, {
      x: size / 2, y: size * 0.92, scale: size / 3.6,
      facing: 1.9, moving: false, time,
      swing: -1, look, cls, hasWeapon: true, hasArmor: false, flash: false,
    });
  }

  return { drawHero, drawHeroSprite, drawEnemySprite, drawPortrait };
})();
