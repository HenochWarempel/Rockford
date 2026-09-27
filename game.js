'use strict';
/* ============================================================
   ROCKFORD — a Boulder Dash-style cave digger, built for
   mobile (Android) as an installable web app.
   ============================================================ */

/* ---------------- Tiles ---------------- */
const T = {
  EMPTY: 0, DIRT: 1, STEEL: 2, BRICK: 3, BOULDER: 4,
  DIAMOND: 5, EXIT_CLOSED: 6, EXIT_OPEN: 7, AMOEBA: 8,
};

const DIRS = {
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy: 1 },
  left:  { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
// order used for firefly/butterfly turning logic: up, right, down, left
const TURN_ORDER = [ [0,-1], [1,0], [0,1], [-1,0] ];

/* ---------------- RNG (deterministic per level) ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- Level generation ---------------- */
const LEVEL_COUNT = 6;
const LEVEL_NAMES = ['GROT A', 'GROT B', 'GROT C', 'GROT D', 'GROT E', 'GROT F'];

function generateLevel(levelIndex) {
  const rnd = mulberry32(1000 + levelIndex * 7919);
  const iw = 18 + levelIndex * 2;
  const ih = 12 + Math.floor(levelIndex * 1.2);
  const W = iw + 2, H = ih + 2;

  const grid = new Uint8Array(W * H).fill(T.DIRT);
  const idx = (x, y) => y * W + x;
  const inInterior = (x, y) => x >= 1 && x <= iw && y >= 1 && y <= ih;

  // border
  for (let x = 0; x < W; x++) { grid[idx(x, 0)] = T.STEEL; grid[idx(x, H - 1)] = T.STEEL; }
  for (let y = 0; y < H; y++) { grid[idx(0, y)] = T.STEEL; grid[idx(W - 1, y)] = T.STEEL; }

  const playerStart = { x: 2, y: 2 };
  const exitPos = { x: iw - 1, y: ih - 1 };

  const clearArea = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (inInterior(x, y)) grid[idx(x, y)] = T.EMPTY;
  };
  clearArea(playerStart.x, playerStart.y, 1);
  clearArea(exitPos.x, exitPos.y, 1);

  // random-walk tunnel carving for an organic cave feel
  const walks = 8 + levelIndex * 2;
  const walkLen = iw + ih;
  for (let w = 0; w < walks; w++) {
    let x = 1 + Math.floor(rnd() * iw);
    let y = 1 + Math.floor(rnd() * ih);
    for (let s = 0; s < walkLen; s++) {
      if (inInterior(x, y)) grid[idx(x, y)] = T.EMPTY;
      const dir = TURN_ORDER[Math.floor(rnd() * 4)];
      const nx = x + dir[0], ny = y + dir[1];
      if (inInterior(nx, ny)) { x = nx; y = ny; }
    }
  }

  const reserved = new Set([idx(playerStart.x, playerStart.y), idx(exitPos.x, exitPos.y)]);
  const placeRandom = (tile, count, allowedTiles) => {
    let placed = 0, attempts = 0;
    const cells = [];
    while (placed < count && attempts < count * 40) {
      attempts++;
      const x = 1 + Math.floor(rnd() * iw);
      const y = 1 + Math.floor(rnd() * ih);
      const i = idx(x, y);
      if (reserved.has(i)) continue;
      if (Math.abs(x - playerStart.x) + Math.abs(y - playerStart.y) < 3) continue;
      if (!allowedTiles.includes(grid[i])) continue;
      grid[i] = tile;
      cells.push({ x, y });
      placed++;
    }
    return cells;
  };

  const diamondsNeeded = 8 + levelIndex * 3;
  const diamondsPlaced = diamondsNeeded + 5 + Math.floor(rnd() * 4);
  const boulderCount = 12 + levelIndex * 5;

  placeRandom(T.BOULDER, boulderCount, [T.DIRT, T.EMPTY]);
  const diamondCells = placeRandom(T.DIAMOND, diamondsPlaced, [T.DIRT, T.EMPTY]);
  if (diamondCells.length < diamondsNeeded) {
    // guarantee enough diamonds exist even if placement ran out of room
    placeRandom(T.DIAMOND, diamondsNeeded - diamondCells.length, [T.DIRT]);
  }

  grid[idx(exitPos.x, exitPos.y)] = T.EXIT_CLOSED;
  grid[idx(playerStart.x, playerStart.y)] = T.EMPTY;

  const fireflyCount = levelIndex >= 1 ? 1 + Math.floor((levelIndex - 1) / 2) : 0;
  const butterflyCount = levelIndex >= 2 ? 1 + Math.floor((levelIndex - 2) / 2) : 0;
  const hasAmoeba = levelIndex >= 3;

  const takenSpots = new Set();
  const farSpots = (count, minDist) => {
    const spots = [];
    let attempts = 0;
    while (spots.length < count && attempts < 400) {
      attempts++;
      const x = 1 + Math.floor(rnd() * iw);
      const y = 1 + Math.floor(rnd() * ih);
      const i = idx(x, y);
      if (grid[i] !== T.EMPTY || takenSpots.has(i)) continue;
      if (Math.abs(x - playerStart.x) + Math.abs(y - playerStart.y) < minDist) continue;
      takenSpots.add(i);
      spots.push({ x, y });
    }
    return spots;
  };

  const fireflySpots = farSpots(fireflyCount, 6);
  const butterflySpots = farSpots(butterflyCount, 6);
  let amoebaSeed = null;
  if (hasAmoeba) {
    const s = farSpots(1, 5)[0];
    if (s) { amoebaSeed = s; grid[idx(s.x, s.y)] = T.AMOEBA; }
  }

  const timeLimit = Math.max(90, 180 - levelIndex * 12);

  return {
    width: W, height: H, grid,
    playerStart, exitPos,
    diamondsNeeded,
    timeLimit,
    fireflies: fireflySpots.map(p => ({ type: 'firefly', x: p.x, y: p.y, heading: 0, alive: true })),
    butterflies: butterflySpots.map(p => ({ type: 'butterfly', x: p.x, y: p.y, heading: 0, alive: true })),
    amoebaSeed,
  };
}

/* ---------------- Game state ---------------- */
const TICK_MS = 170;
const MAX_LIVES = 3;

const state = {
  screen: 'title',
  levelIndex: 0,
  lives: MAX_LIVES,
  score: 0,
  running: false,
  paused: false,
};

let level = null;         // static level template (regenerated per attempt with same seed)
let grid, W, H;
let player, entities, amoeba, exitTile;
let diamondsNeeded, diamondsCollected;
let levelStartMs, timeLimitMs, timeLeftSec;
let tickAccumulator = 0, lastFrameTime = 0;
let fallingFlags;          // Uint8Array parallel to grid
let amoebaStall = 0;
let particles = [];
let toastTimer = 0;
let heldDir = null;
let camera = { x: 0, y: 0 };
let viewport = { cols: 10, rows: 14, tile: 32 };
let gameOverReason = '';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');

/* ---------------- Level (re)load ---------------- */
function loadLevel(levelIndex, keepScore) {
  level = generateLevel(levelIndex);
  grid = level.grid.slice();
  W = level.width; H = level.height;
  fallingFlags = new Uint8Array(W * H);
  player = { x: level.playerStart.x, y: level.playerStart.y, alive: true, facing: 'down' };
  entities = level.fireflies.concat(level.butterflies).map(e => ({ ...e }));
  amoeba = new Set();
  if (level.amoebaSeed) amoeba.add(level.amoebaSeed.y * W + level.amoebaSeed.x);
  amoebaStall = 0;
  diamondsNeeded = level.diamondsNeeded;
  diamondsCollected = 0;
  timeLimitMs = level.timeLimit * 1000;
  levelStartMs = performance.now();
  timeLeftSec = level.timeLimit;
  particles = [];
  heldDir = null;
  camera.x = player.x; camera.y = player.y;
  if (!keepScore) { /* score persists across lives/levels by design */ }
  updateHud();
  document.getElementById('level-title').textContent = LEVEL_NAMES[levelIndex] || `GROT ${levelIndex + 1}`;
  document.getElementById('level-goal').textContent =
    `Verzamel ${diamondsNeeded} diamanten\nTijd: ${level.timeLimit}s`;
}

/* ---------------- Helpers ---------------- */
const idxOf = (x, y) => y * W + x;
const inBounds = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const tileAt = (x, y) => inBounds(x, y) ? grid[idxOf(x, y)] : T.STEEL;
const isRound = t => t === T.BOULDER || t === T.DIAMOND;

function entityAt(x, y) {
  return entities.find(e => e.alive && e.x === x && e.y === y) || null;
}

function showToast(msg, ms = 1400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = ms;
}

function spawnExplosion(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    particles.push({
      x: x + 0.5, y: y + 0.5,
      vx: Math.cos(ang) * (1.5 + Math.random()), vy: Math.sin(ang) * (1.5 + Math.random()),
      life: 500 + Math.random() * 200, maxLife: 700, color,
    });
  }
}

/* ---------------- Player actions ---------------- */
function tryPlayerMove(dir) {
  if (!player.alive) return;
  const d = DIRS[dir];
  if (!d) return;
  player.facing = dir;
  const nx = player.x + d.dx, ny = player.y + d.dy;
  if (!inBounds(nx, ny)) return;
  const t = tileAt(nx, ny);

  if (t === T.STEEL || t === T.BRICK) return;

  if (t === T.DIRT) {
    grid[idxOf(nx, ny)] = T.EMPTY;
    movePlayerTo(nx, ny);
    return;
  }
  if (t === T.EMPTY) { movePlayerTo(nx, ny); return; }

  if (t === T.DIAMOND) {
    grid[idxOf(nx, ny)] = T.EMPTY;
    diamondsCollected++;
    state.score += 15;
    movePlayerTo(nx, ny);
    checkExitOpen();
    return;
  }

  if (t === T.BOULDER) {
    if (dir !== 'left' && dir !== 'right') return; // can only push sideways
    if (fallingFlags[idxOf(nx, ny)]) return;       // can't push a falling boulder
    const bx = nx + d.dx, by = ny;
    if (!inBounds(bx, by) || tileAt(bx, by) !== T.EMPTY || entityAt(bx, by)) return;
    grid[idxOf(bx, by)] = T.BOULDER;
    grid[idxOf(nx, ny)] = T.EMPTY;
    movePlayerTo(nx, ny);
    return;
  }

  if (t === T.EXIT_OPEN) { movePlayerTo(nx, ny); levelComplete(); return; }
  if (t === T.EXIT_CLOSED) return;

  if (t === T.AMOEBA) { killPlayer('door de amoebe'); return; }
  // anything else (shouldn't happen) blocks
}

function movePlayerTo(x, y) {
  const enemy = entityAt(x, y);
  if (enemy) { killPlayer('door een monster'); return; }
  player.x = x; player.y = y;
}

function killPlayer(reason) {
  if (!player.alive) return;
  player.alive = false;
  gameOverReason = reason;
  spawnExplosion(player.x, player.y, '#ffcc33');
}

function checkExitOpen() {
  if (diamondsCollected >= diamondsNeeded) {
    const i = findTileIndex(T.EXIT_CLOSED);
    if (i >= 0) { grid[i] = T.EXIT_OPEN; showToast('💎 Uitgang open!'); }
  }
}
function findTileIndex(tile) {
  for (let i = 0; i < grid.length; i++) if (grid[i] === tile) return i;
  return -1;
}

/* ---------------- Physics: falling & rolling ---------------- */
function updatePhysics() {
  const newFalling = new Uint8Array(W * H);
  for (let y = H - 2; y >= 1; y--) {
    for (let x = 1; x < W - 1; x++) {
      const i = idxOf(x, y);
      const t = grid[i];
      if (!isRound(t)) continue;
      const below = idxOf(x, y + 1);
      const belowTile = grid[below];

      if (belowTile === T.EMPTY) {
        if (player.x === x && player.y === y + 1) {
          killPlayer('verpletterd door een rotsblok');
          continue;
        }
        const enemy = entityAt(x, y + 1);
        if (enemy) {
          enemy.alive = false;
          spawnExplosion(enemy.x, enemy.y, enemy.type === 'butterfly' ? '#66d1ff' : '#ff5a4d');
          if (enemy.type === 'butterfly') explodeToDiamonds(enemy.x, enemy.y);
          continue; // rock stays put this tick, falls next tick
        }
        grid[below] = t;
        grid[i] = T.EMPTY;
        newFalling[below] = 1;
        continue;
      }

      if (isRound(belowTile)) {
        const leftEmpty = tileAt(x - 1, y) === T.EMPTY && tileAt(x - 1, y + 1) === T.EMPTY && !entityAt(x - 1, y);
        const rightEmpty = tileAt(x + 1, y) === T.EMPTY && tileAt(x + 1, y + 1) === T.EMPTY && !entityAt(x + 1, y);
        if (leftEmpty) {
          grid[idxOf(x - 1, y)] = t; grid[i] = T.EMPTY; newFalling[idxOf(x - 1, y)] = 1;
        } else if (rightEmpty) {
          grid[idxOf(x + 1, y)] = t; grid[i] = T.EMPTY; newFalling[idxOf(x + 1, y)] = 1;
        }
        continue;
      }
      // resting on solid ground / amoeba / player-not-below -> stays
    }
  }
  fallingFlags = newFalling;
}

function explodeToDiamonds(cx, cy) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      const t = tileAt(x, y);
      if (t === T.EMPTY || t === T.DIRT) grid[idxOf(x, y)] = T.DIAMOND;
    }
  }
}

/* ---------------- Enemies ---------------- */
function updateEnemies() {
  for (const e of entities) {
    if (!e.alive) continue;
    // proximity kill
    for (const [dx, dy] of TURN_ORDER) {
      if (player.alive && player.x === e.x + dx && player.y === e.y + dy) {
        killPlayer('door een monster'); break;
      }
    }
    if (!player.alive) continue;

    const order = e.type === 'firefly' ? [-1, 0, 1, 2] : [1, 0, -1, 2]; // left,straight,right,back  /  right,straight,left,back
    let moved = false;
    for (const turn of order) {
      const heading = (e.heading + (turn === 2 ? 2 : turn) + 4) % 4;
      const [dx, dy] = TURN_ORDER[heading];
      const nx = e.x + dx, ny = e.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (player.x === nx && player.y === ny) { killPlayer('door een monster'); moved = true; break; }
      if (tileAt(nx, ny) === T.EMPTY && !entityAt(nx, ny)) {
        e.heading = heading; e.x = nx; e.y = ny; moved = true; break;
      }
    }
    // if nothing worked, entity simply waits in place
  }
  entities = entities.filter(e => e.alive);
}

/* ---------------- Amoeba ---------------- */
const AMOEBA_MAX = 45;
const AMOEBA_STALL_LIMIT = 30;
function updateAmoeba() {
  if (amoeba.size === 0) return;
  if (amoeba.size >= AMOEBA_MAX) {
    for (const i of amoeba) grid[i] = T.BOULDER;
    amoeba.clear();
    showToast('🪨 De amoebe is overwoekerd!');
    return;
  }
  const snapshot = Array.from(amoeba);
  let grew = false;
  for (const i of snapshot) {
    if (Math.random() > 0.22) continue;
    const x = i % W, y = Math.floor(i / W);
    const dirs = TURN_ORDER.slice().sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const t = tileAt(nx, ny);
      if ((t === T.DIRT || t === T.EMPTY) && !entityAt(nx, ny)) {
        grid[idxOf(nx, ny)] = T.AMOEBA;
        amoeba.add(idxOf(nx, ny));
        grew = true;
        if (player.alive && player.x === nx && player.y === ny) killPlayer('opgeslokt door de amoebe');
        break;
      }
    }
  }
  if (grew) { amoebaStall = 0; } else {
    amoebaStall++;
    if (amoebaStall > AMOEBA_STALL_LIMIT) {
      for (const i of amoeba) grid[i] = T.DIAMOND;
      amoeba.clear();
      showToast('💎 De amoebe is verstard tot diamant!');
    }
  }
}

/* ---------------- Tick loop ---------------- */
function tick() {
  if (heldDir) tryPlayerMove(heldDir);
  if (player.alive) {
    updatePhysics();
    updateEnemies();
    updateAmoeba();
    checkExitOpen();
  }

  timeLeftSec = Math.max(0, Math.ceil((timeLimitMs - (performance.now() - levelStartMs)) / 1000));
  if (timeLeftSec <= 0 && player.alive) killPlayer('de tijd is op');

  if (!player.alive) { onPlayerDeath(); }
  updateHud();
}

let gameOverFinal = false;
function onPlayerDeath() {
  state.running = false;
  setTimeout(() => {
    state.lives--;
    updateHud();
    if (state.lives <= 0) {
      gameOverFinal = true;
      showScreen('screen-over');
      document.getElementById('over-title').textContent = 'Game Over';
      document.getElementById('over-stats').textContent =
        `Gestorven ${gameOverReason}.\nScore: ${state.score}`;
      document.getElementById('btn-retry').textContent = '↺ Opnieuw beginnen';
    } else {
      gameOverFinal = false;
      showScreen('screen-over');
      document.getElementById('over-title').textContent = `Nog ${state.lives} leven over`;
      document.getElementById('over-stats').textContent = `Gestorven ${gameOverReason}.`;
      document.getElementById('btn-retry').textContent = '↺ Doorgaan';
    }
  }, 550);
}

function levelComplete() {
  state.running = false;
  const bonus = timeLeftSec * 3 + 100;
  state.score += bonus;
  setTimeout(() => {
    showScreen('screen-clear');
    document.getElementById('clear-stats').textContent =
      `Diamanten: ${diamondsCollected}/${diamondsNeeded}\nTijdbonus: +${timeLeftSec * 3}\nScore: ${state.score}`;
  }, 300);
}

/* ---------------- HUD ---------------- */
function updateHud() {
  document.getElementById('hud-diamonds').textContent = `💎 ${diamondsCollected}/${diamondsNeeded}`;
  document.getElementById('hud-score').textContent = `★ ${state.score}`;
  const timeEl = document.getElementById('hud-time');
  timeEl.textContent = `⏱ ${timeLeftSec}`;
  timeEl.classList.toggle('low-time', timeLeftSec <= 20);
  document.getElementById('hud-lives').textContent = `♥ ${state.lives}`;
}

/* ---------------- Rendering ---------------- */
function resizeCanvas() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const desiredTile = 30;
  let cols = Math.max(7, Math.min(W, Math.round(w / desiredTile)));
  let rows = Math.max(7, Math.min(H, Math.round(h / desiredTile)));
  const tile = Math.max(8, Math.floor(Math.min(w / cols, h / rows)));
  viewport.cols = cols; viewport.rows = rows; viewport.tile = tile;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cols * tile * dpr;
  canvas.height = rows * tile * dpr;
  canvas.style.width = (cols * tile) + 'px';
  canvas.style.height = (rows * tile) + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (grid) resizeCanvas(); });

const COLORS = {
  bg: '#0d0906',
  dirt1: '#5a3a1e', dirt2: '#6b4626',
  steel: '#4a4a52', steelDark: '#2c2c33',
  brick: '#7a3b2e', brickDark: '#4a2016',
  boulder: '#8d8d97', boulderDark: '#55555e', boulderHi: '#c8c8d4',
  diamond: '#48e0ff', diamondHi: '#e8fdff',
  exitClosed: '#3a2a10', exitOpen: '#ffd23f',
  amoeba: '#3fbf5f',
  player: '#ffcc33',
  firefly: '#ff4d3d',
  butterfly: '#7a6bff',
};

function drawTile(t, px, py, ts, frame) {
  if (t === T.EMPTY) return;
  if (t === T.DIRT) {
    ctx.fillStyle = COLORS.dirt1; ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = COLORS.dirt2;
    const sp = ts / 8;
    for (let i = 0; i < 4; i++) {
      const ox = ((i * 37 + px) % (ts - sp)) , oy = ((i * 59 + py) % (ts - sp));
      ctx.fillRect(px + ox * 0.15 + sp, py + oy * 0.15 + sp, sp, sp);
    }
    return;
  }
  if (t === T.STEEL) {
    ctx.fillStyle = COLORS.steelDark; ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = COLORS.steel;
    ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
    ctx.strokeStyle = COLORS.steelDark; ctx.lineWidth = Math.max(1, ts * 0.06);
    ctx.strokeRect(px + ts * 0.2, py + ts * 0.2, ts * 0.6, ts * 0.6);
    return;
  }
  if (t === T.BRICK) {
    ctx.fillStyle = COLORS.brickDark; ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = COLORS.brick;
    ctx.fillRect(px + 1, py + 1, ts * 0.46, ts * 0.44);
    ctx.fillRect(px + ts * 0.52, py + 1, ts * 0.46, ts * 0.44);
    ctx.fillRect(px + ts * 0.26, py + ts * 0.52, ts * 0.46, ts * 0.44);
    return;
  }
  if (t === T.BOULDER) {
    const cx = px + ts / 2, cy = py + ts / 2, r = ts * 0.42;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, COLORS.boulderHi); g.addColorStop(1, COLORS.boulderDark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (t === T.DIAMOND) {
    const cx = px + ts / 2, cy = py + ts / 2, r = ts * 0.38;
    const glow = 0.7 + 0.3 * Math.sin(frame / 220 + px * 0.1);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, COLORS.diamondHi); g.addColorStop(1, COLORS.diamond);
    ctx.fillStyle = g; ctx.globalAlpha = glow;
    ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    ctx.restore();
    return;
  }
  if (t === T.EXIT_CLOSED || t === T.EXIT_OPEN) {
    const open = t === T.EXIT_OPEN;
    ctx.fillStyle = open ? COLORS.exitOpen : COLORS.exitClosed;
    ctx.globalAlpha = open ? (0.6 + 0.4 * Math.sin(frame / 150)) : 1;
    ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, ts - 4, ts - 4);
    return;
  }
  if (t === T.AMOEBA) {
    const cx = px + ts / 2, cy = py + ts / 2;
    const pulse = 0.75 + 0.25 * Math.sin(frame / 180 + (px + py) * 0.05);
    ctx.fillStyle = COLORS.amoeba;
    ctx.globalAlpha = pulse;
    ctx.beginPath(); ctx.arc(cx, cy, ts * 0.44, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
}

function drawPlayer(px, py, ts) {
  const cx = px + ts / 2, cy = py + ts / 2;
  ctx.fillStyle = COLORS.player;
  ctx.beginPath(); ctx.arc(cx, cy, ts * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2410';
  const eyeOffX = player.facing === 'left' ? -ts * 0.12 : player.facing === 'right' ? ts * 0.12 : 0;
  const eyeOffY = player.facing === 'up' ? -ts * 0.12 : player.facing === 'down' ? ts * 0.08 : 0;
  ctx.beginPath();
  ctx.arc(cx - ts * 0.12 + eyeOffX, cy - ts * 0.05 + eyeOffY, ts * 0.06, 0, Math.PI * 2);
  ctx.arc(cx + ts * 0.12 + eyeOffX, cy - ts * 0.05 + eyeOffY, ts * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(e, px, py, ts, frame) {
  const cx = px + ts / 2, cy = py + ts / 2;
  const flick = 0.85 + 0.15 * Math.sin(frame / 60 + e.x * 3);
  ctx.fillStyle = e.type === 'firefly' ? COLORS.firefly : COLORS.butterfly;
  ctx.globalAlpha = flick;
  if (e.type === 'firefly') {
    ctx.beginPath(); ctx.arc(cx, cy, ts * 0.36, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx - ts * 0.2, cy, ts * 0.22, ts * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + ts * 0.2, cy, ts * 0.22, ts * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function render(now) {
  const frame = now;
  // smooth camera follow
  const targetX = clamp(player.x - viewport.cols / 2 + 0.5, 0, Math.max(0, W - viewport.cols));
  const targetY = clamp(player.y - viewport.rows / 2 + 0.5, 0, Math.max(0, H - viewport.rows));
  camera.x += (targetX - camera.x) * 0.15;
  camera.y += (targetY - camera.y) * 0.15;

  const ts = viewport.tile;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, viewport.cols * ts, viewport.rows * ts);

  const camCol = Math.floor(camera.x), camRow = Math.floor(camera.y);
  const offX = -(camera.x - camCol) * ts, offY = -(camera.y - camRow) * ts;

  for (let ry = -1; ry <= viewport.rows; ry++) {
    for (let rx = -1; rx <= viewport.cols; rx++) {
      const gx = camCol + rx, gy = camRow + ry;
      if (!inBounds(gx, gy)) continue;
      drawTile(grid[idxOf(gx, gy)], rx * ts + offX, ry * ts + offY, ts, frame);
    }
  }

  for (const e of entities) {
    if (!e.alive) continue;
    const rx = (e.x - camCol) * ts + offX, ry = (e.y - camRow) * ts + offY;
    if (rx < -ts || ry < -ts || rx > viewport.cols * ts || ry > viewport.rows * ts) continue;
    drawEnemy(e, rx, ry, ts, frame);
  }

  if (player.alive) {
    const rx = (player.x - camCol) * ts + offX, ry = (player.y - camRow) * ts + offY;
    drawPlayer(rx, ry, ts);
  }

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const rx = (p.x - camCol) * ts + offX, ry = (p.y - camRow) * ts + offY;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(rx - 2, ry - 2, 4, 4);
    ctx.globalAlpha = 1;
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------------- Main loop ---------------- */
function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  if (!lastFrameTime) lastFrameTime = now;
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) document.getElementById('toast').classList.remove('show');
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (state.running && !state.paused) {
    tickAccumulator += dt;
    while (tickAccumulator >= TICK_MS) { tickAccumulator -= TICK_MS; tick(); }
  }

  if (grid) render(now);
}
requestAnimationFrame(frameLoop);

/* ---------------- Screens ---------------- */
function showScreen(id) {
  document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  if (id) document.getElementById(id).classList.remove('hidden');
  state.screen = id;
}

function startGame(fromLevel) {
  state.levelIndex = fromLevel;
  state.lives = MAX_LIVES;
  state.score = 0;
  beginLevelIntro();
}

function beginLevelIntro() {
  loadLevel(state.levelIndex);
  document.getElementById('btn-retry').textContent = '↺ Opnieuw';
  showScreen('screen-level');
}

function actuallyStartLevel() {
  state.running = true;
  state.paused = false;
  lastFrameTime = 0;
  tickAccumulator = 0;
  showScreen(null);
}

/* ---------------- Input ---------------- */
function bindHold(el, dir) {
  const start = (ev) => { ev.preventDefault(); heldDir = dir; el.classList.add('active'); };
  const end = (ev) => { if (ev) ev.preventDefault(); if (heldDir === dir) heldDir = null; el.classList.remove('active'); };
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);
}
bindHold(document.getElementById('btn-up'), 'up');
bindHold(document.getElementById('btn-down'), 'down');
bindHold(document.getElementById('btn-left'), 'left');
bindHold(document.getElementById('btn-right'), 'right');

const KEY_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
window.addEventListener('keydown', (e) => {
  const dir = KEY_DIR[e.key];
  if (dir) { heldDir = dir; e.preventDefault(); }
  if (e.key === 'Escape' || e.key === 'p') togglePause();
});
window.addEventListener('keyup', (e) => {
  const dir = KEY_DIR[e.key];
  if (dir && heldDir === dir) heldDir = null;
});

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  showScreen(state.paused ? 'screen-pause' : null);
}

/* ---------------- Menu wiring ---------------- */
document.getElementById('btn-start').onclick = () => startGame(0);
document.getElementById('btn-howto').onclick = () => showScreen('screen-howto');
document.getElementById('btn-howto-back').onclick = () => showScreen('screen-title');
document.getElementById('btn-level-go').onclick = () => { resizeCanvas(); actuallyStartLevel(); };
document.getElementById('btn-pause').onclick = () => togglePause();
document.getElementById('btn-resume').onclick = () => togglePause();
document.getElementById('btn-restart').onclick = () => { state.paused = false; beginLevelIntro(); };
document.getElementById('btn-quit').onclick = () => { state.running = false; state.paused = false; showScreen('screen-title'); };
document.getElementById('btn-next').onclick = () => {
  state.levelIndex++;
  if (state.levelIndex >= LEVEL_COUNT) {
    showScreen('screen-win');
    document.getElementById('win-stats').textContent = `Eindscore: ${state.score}`;
  } else { beginLevelIntro(); }
};
document.getElementById('btn-retry').onclick = () => {
  if (gameOverFinal) { startGame(state.levelIndex); } else { beginLevelIntro(); }
};
document.getElementById('btn-menu').onclick = () => showScreen('screen-title');
document.getElementById('btn-win-menu').onclick = () => showScreen('screen-title');

/* ---------------- Debug hook (state inspection only, no gameplay effect) ---------------- */
window.__rockford = {
  get state() { return state; },
  get player() { return player; },
  get diamondsCollected() { return diamondsCollected; },
  get diamondsNeeded() { return diamondsNeeded; },
  get entities() { return entities; },
  forceExitOpen() { const i = findTileIndex(T.EXIT_CLOSED); if (i >= 0) grid[i] = T.EXIT_OPEN; },
  teleportPlayer(x, y) { player.x = x; player.y = y; },
  gotoLevel(i) { state.levelIndex = i; state.lives = MAX_LIVES; state.score = 0; loadLevel(i); resizeCanvas(); actuallyStartLevel(); },
  kill(reason) { killPlayer(reason || 'debug'); },
  get exitPos() { return level.exitPos; },
};

/* ---------------- Boot ---------------- */
showScreen('screen-title');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
