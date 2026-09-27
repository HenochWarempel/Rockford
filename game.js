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
let activeCtx = ctx; // swapped to the title-art canvas while drawing the menu backdrop
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
          killPlayer('door een vallend rotsblok');
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
        if (player.alive && player.x === nx && player.y === ny) killPlayer('door de amoebe');
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
  if (timeLeftSec <= 0 && player.alive) killPlayer('omdat de tijd op is');

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
      document.getElementById('over-title').textContent = 'Spel voorbij';
      document.getElementById('over-stats').textContent =
        `Gestorven ${gameOverReason}.\nScore: ${state.score}`;
      document.getElementById('btn-retry').textContent = '↺ Opnieuw beginnen';
    } else {
      gameOverFinal = false;
      showScreen('screen-over');
      document.getElementById('over-title').textContent = `Nog ${state.lives} ${state.lives === 1 ? 'leven' : 'levens'} over`;
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

/* ---------------- Title-screen backdrop (same pixel sprites, decorative) ---------------- */
const titleCanvas = document.getElementById('title-art');
const titleCtx = titleCanvas.getContext('2d');
let titleTileSize = 32;

function titleArtVisible() {
  return !document.getElementById('screen-title').classList.contains('hidden') ||
         !document.getElementById('screen-howto').classList.contains('hidden');
}

function renderTitleArt(frame) {
  if (!titleArtVisible()) return;
  const rect = titleCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const wantW = Math.max(1, Math.round(rect.width * dpr));
  const wantH = Math.max(1, Math.round(rect.height * dpr));
  if (titleCanvas.width !== wantW || titleCanvas.height !== wantH) {
    titleCanvas.width = wantW; titleCanvas.height = wantH;
    titleTileSize = Math.max(20, Math.round(rect.width / 13));
  }
  activeCtx = titleCtx;
  activeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, ts = titleTileSize;
  activeCtx.clearRect(0, 0, w, h);
  const cols = Math.ceil(w / ts) + 1, rows = Math.ceil(h / ts) + 1;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const hash = Math.abs(Math.sin(rx * 12.9898 + ry * 78.233) * 43758.5453) % 1;
      const px = rx * ts, py = ry * ts;
      if (hash < 0.08) drawSprite(SPR.boulder, px, py, ts);
      else if (hash < 0.16) drawSprite(SPR.diamond, px, py, ts, DIAMOND_SHIMMER[Math.floor(frame / 200 + rx + ry) % DIAMOND_SHIMMER.length]);
      else drawDirt(px, py, ts, rx, ry);
    }
  }
  activeCtx = ctx;
}

const COLORS = { bg: '#0d0906' };

/* ---- Retro EGA-style pixel palette (8x8 sprite blocks, chunky like the original) ---- */
const PALETTE = {
  k: '#000000',            // outline
  G: '#cfd2da', g: '#93969f', d: '#54565d',      // boulder hi / mid / shadow
  C: '#3be2ff', c: '#0f8fb0', W: '#f2ffff',      // diamond cyan / deep facet / hi
  R: '#b84a34', r: '#7a2f1f', M: '#1c0d06',      // brick / brick shadow / mortar
  S: '#a7b0ba', s: '#5c6570', D: '#2a2f36',      // steel hi / mid / dark (rivets)
  o1: '#6b4626', o2: '#5a3a1e', o3: '#4a2f18',   // dirt base / mid / dark flecks
  Y: '#ffd400', y: '#c79a00',                    // helmet
  n: '#f2c68a', x: '#3a2410',                    // face / visor-eyes
  B: '#3059c9', b: '#1c3a8a',                    // suit
  F: '#ff5540', f: '#a30f08',                    // firefly
  P: '#9a7bff', p: '#5230c9',                    // butterfly
  A: '#3ddc63', a: '#1f8f3d',                    // amoeba
  E: '#ffd23f', e: '#5a3a10',                    // exit open / closed
};

const SPR = {
  boulder: ['..kkkk..', '.kGGGGk.', 'kGGGgggk', 'kGgggddk', 'kgggdddk', 'kgdddddk', '.kdddk..', '..kkkk..'],
  diamond: ['...kk...', '..kCCk..', '.kCWWCk.', 'kCWWWWCk', 'kcWWWWck', '.kccCCk.', '..kCCk..', '...kk...'],
  brick:   ['RRRRRRRR', 'RRRMRRRR', 'RRRRRRRR', 'MMMMMMMM', 'RRRRRRRR', 'RRRRRMRR', 'RRRRRRRR', 'MMMMMMMM'],
  steel:   ['DssssssD', 'sSSSSSSs', 'sSssssSs', 'sSsSSsSs', 'sSsSSsSs', 'sSssssSs', 'sSSSSSSs', 'DssssssD'],
  amoeba:  ['.AAAAAA.', 'AAaAAaAA', 'AAAAaAAA', 'aAAAAAAa', 'AAaAAAAA', 'AAAAaAAa', 'AAaAAAAA', '.AAAAAA.'],
  exitOff: ['eeeeeeee', 'e......e', 'e.kkkk.e', 'e.k..k.e', 'e.k..k.e', 'e.kkkk.e', 'e......e', 'eeeeeeee'],
  exitOn:  ['EEEEEEEE', 'E......E', 'E.kkkk.E', 'E.k..k.E', 'E.k..k.E', 'E.kkkk.E', 'E......E', 'EEEEEEEE'],
  playerFront: ['..kYYk..', '.kYYYYk.', '.knnnnk.', 'kBBBBBBk', 'kBbBBbBk', '.kBBBBk.', '..kbbk..', '.kk..kk.'],
  playerBack:  ['..kYYk..', '.kYYYYk.', '.kyyyyk.', 'kBBBBBBk', 'kBbBBbBk', '.kBBBBk.', '..kbbk..', '.kk..kk.'],
  playerFront2:['..kYYk..', '.kYYYYk.', '.knnnnk.', 'kBBBBBBk', 'kBbBBbBk', '.kBBBBk.', '.kbk.kbk', 'kk.....k'],
  firefly: ['..kffk..', '.kfFFfk.', 'kfFFFFfk', 'kFFkkFFk', 'kFFkkFFk', 'kfFFFFfk', '.kfFFfk.', '..kffk..'],
  butterfly:['..kppk..', '.kpPPpk.', 'kpPPPPpk', 'kPPkkPPk', 'kPPkkPPk', 'kpPPPPpk', '.kpPPpk.', '..kppk..'],
};

function drawSprite(matrix, px, py, ts, overrides) {
  const n = matrix.length;
  const bw = ts / n, bh = ts / n;
  for (let ry = 0; ry < n; ry++) {
    const row = matrix[ry];
    for (let rx = 0; rx < n; rx++) {
      const ch = row[rx];
      if (ch === '.') continue;
      activeCtx.fillStyle = (overrides && overrides[ch]) || PALETTE[ch];
      activeCtx.fillRect(px + rx * bw - 0.5, py + ry * bh - 0.5, bw + 1, bh + 1);
    }
  }
}

const DIRT_FLECKS = [
  [[2, 1], [5, 3], [1, 5], [6, 6]],
  [[4, 0], [0, 3], [6, 2], [3, 6], [5, 7]],
  [[1, 1], [6, 1], [3, 4], [1, 6], [5, 5]],
];
function drawDirt(px, py, ts, gx, gy) {
  activeCtx.fillStyle = PALETTE.o1;
  activeCtx.fillRect(px, py, ts, ts);
  const variant = DIRT_FLECKS[Math.abs(gx * 7 + gy * 13) % DIRT_FLECKS.length];
  const b = ts / 8;
  activeCtx.fillStyle = PALETTE.o2;
  for (const [fx, fy] of variant) activeCtx.fillRect(px + fx * b, py + fy * b, b * 1.3, b * 1.3);
}

const DIAMOND_SHIMMER = [
  { C: '#3be2ff', c: '#0f8fb0', W: '#f2ffff' },
  { C: '#5cf0d0', c: '#0fb08f', W: '#ffffff' },
  { C: '#8fd9ff', c: '#2f7fcf', W: '#f2ffff' },
];

function drawTile(t, px, py, ts, frame, gx, gy) {
  if (t === T.EMPTY) return;
  if (t === T.DIRT) { drawDirt(px, py, ts, gx, gy); return; }
  if (t === T.STEEL) { drawSprite(SPR.steel, px, py, ts); return; }
  if (t === T.BRICK) { drawSprite(SPR.brick, px, py, ts); return; }
  if (t === T.BOULDER) { drawSprite(SPR.boulder, px, py, ts); return; }
  if (t === T.DIAMOND) {
    const shimmer = DIAMOND_SHIMMER[Math.floor(frame / 200 + gx + gy) % DIAMOND_SHIMMER.length];
    drawSprite(SPR.diamond, px, py, ts, shimmer);
    return;
  }
  if (t === T.EXIT_CLOSED) { drawSprite(SPR.exitOff, px, py, ts); return; }
  if (t === T.EXIT_OPEN) {
    activeCtx.globalAlpha = 0.55 + 0.45 * Math.sin(frame / 150);
    drawSprite(SPR.exitOn, px, py, ts);
    activeCtx.globalAlpha = 1;
    return;
  }
  if (t === T.AMOEBA) {
    activeCtx.globalAlpha = 0.8 + 0.2 * Math.sin(frame / 180 + (gx + gy) * 0.6);
    drawSprite(SPR.amoeba, px, py, ts);
    activeCtx.globalAlpha = 1;
    return;
  }
}

function drawPlayer(px, py, ts, frame) {
  const walkFrame = Math.floor(frame / 260) % 2;
  let matrix = player.facing === 'up' ? SPR.playerBack : (walkFrame ? SPR.playerFront2 : SPR.playerFront);
  activeCtx.save();
  if (player.facing === 'left') {
    activeCtx.translate(px + ts, py); activeCtx.scale(-1, 1);
    drawSprite(matrix, 0, 0, ts);
  } else {
    drawSprite(matrix, px, py, ts);
  }
  activeCtx.restore();
}

function drawEnemy(e, px, py, ts, frame) {
  const cx = px + ts / 2, cy = py + ts / 2;
  activeCtx.save();
  activeCtx.translate(cx, cy);
  if (e.type === 'firefly') {
    activeCtx.rotate(frame / 220);
    drawSprite(SPR.firefly, -ts / 2, -ts / 2, ts);
  } else {
    const flap = 0.75 + 0.25 * Math.sin(frame / 90 + e.x);
    activeCtx.scale(flap, 1);
    drawSprite(SPR.butterfly, -ts / 2, -ts / 2, ts);
  }
  activeCtx.restore();
}

function render(now) {
  activeCtx = ctx;
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
      drawTile(grid[idxOf(gx, gy)], rx * ts + offX, ry * ts + offY, ts, frame, gx, gy);
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
    drawPlayer(rx, ry, ts, frame);
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
  renderTitleArt(now);
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
