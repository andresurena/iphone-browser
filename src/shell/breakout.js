'use strict'

/* ============================================================= breakout
   An easter egg: a hidden square in the stage's top-right corner, just under
   the tab strip's "Max 4 tabs", opens Breakout. Drawn the way an iOS game
   would be: rounded light-blue bricks, a rounded bright-blue paddle, and a
   ball in the green of a Mac window's full-screen button.

   ← → move, Space or ↑ launches (and pauses), Esc closes. Classic script,
   loaded before shell.js; it only touches shell.js's globals from inside
   functions, which run after that file has set them up. */

const BREAKOUT_LEVELS = {
  easy:   { rows: 4, speed: 260, paddle: 104, points: 10 },
  medium: { rows: 5, speed: 340, paddle: 86,  points: 15 },
  hard:   { rows: 6, speed: 430, paddle: 68,  points: 25 },
};
const BO = {
  w: 480, h: 360,
  cols: 8, gap: 8, top: 44, side: 16, brickH: 16, radius: 6,
  paddleH: 12, paddleY: 330, paddleSpeed: 460,
  ball: 7,
  lives: 3,
};
const BO_COLOURS = {
  brick: '#9ccaff',       // light blue
  paddle: '#0a84ff',      // iOS system blue
  ball: '#28c840',        // the Mac's full-screen button
};

let bo = null;          // the running game, or null while closed
let boLevel = 'easy';   // remembered between games

function openBreakout() {
  const panel = $('breakout');
  if (!panel.hidden) return;
  panel.hidden = false;
  const canvas = $('breakoutCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = BO.w * dpr;
  canvas.height = BO.h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  bo = { ctx, keys: new Set(), level: boLevel, raf: 0, last: 0 };
  paintBreakoutLevels();
  newBreakoutGame();
  window.addEventListener('keydown', breakoutKeyDown, true);
  window.addEventListener('keyup', breakoutKeyUp, true);
  canvas.focus();
  bo.raf = requestAnimationFrame(breakoutFrame);
  reportPageRects();   // nothing under the panel should get touch input
}

function closeBreakout() {
  if (!bo) return;
  cancelAnimationFrame(bo.raf);
  window.removeEventListener('keydown', breakoutKeyDown, true);
  window.removeEventListener('keyup', breakoutKeyUp, true);
  $('breakout').hidden = true;
  bo = null;
  reportPageRects();
}

function setBreakoutLevel(level) {
  if (!BREAKOUT_LEVELS[level] || !bo) return;
  bo.level = level;
  boLevel = level;
  paintBreakoutLevels();
  newBreakoutGame();
  $('breakoutCanvas').focus();
}

function paintBreakoutLevels() {
  for (const btn of all('#breakout [data-level]')) {
    const on = btn.dataset.level === bo.level;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

function newBreakoutGame() {
  const L = BREAKOUT_LEVELS[bo.level];
  const brickW = (BO.w - BO.side * 2 - BO.gap * (BO.cols - 1)) / BO.cols;
  bo.bricks = [];
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < BO.cols; c++) {
      bo.bricks.push({
        x: BO.side + c * (brickW + BO.gap),
        y: BO.top + r * (BO.brickH + BO.gap),
        w: brickW, h: BO.brickH, alive: true,
      });
    }
  }
  bo.paddle = { w: L.paddle, x: (BO.w - L.paddle) / 2 };
  bo.score = 0;
  bo.lives = BO.lives;
  bo.state = 'ready';   // ready | playing | paused | won | lost
  resetBreakoutBall();
  paintBreakoutStatus();
}

function resetBreakoutBall() {
  bo.ball = { x: bo.paddle.x + bo.paddle.w / 2, y: BO.paddleY - BO.ball - 1, vx: 0, vy: 0 };
}

function launchBreakoutBall() {
  const L = BREAKOUT_LEVELS[bo.level];
  // a little off vertical, so the first bounce isn't straight back down
  const angle = (-Math.PI / 2) + (Math.random() * 0.6 - 0.3);
  bo.ball.vx = Math.cos(angle) * L.speed;
  bo.ball.vy = Math.sin(angle) * L.speed;
  bo.state = 'playing';
  paintBreakoutStatus();
}

function breakoutKeyDown(e) {
  if (!bo) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBreakout(); return; }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    bo.keys.add(k);
  } else if (k === ' ' || k === 'ArrowUp') {
    if (bo.state === 'ready') launchBreakoutBall();
    else if (bo.state === 'playing') { bo.state = 'paused'; paintBreakoutStatus(); }
    else if (bo.state === 'paused') { bo.state = 'playing'; paintBreakoutStatus(); }
    else if (bo.state === 'won' || bo.state === 'lost') newBreakoutGame();
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}

function breakoutKeyUp(e) {
  if (!bo) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    bo.keys.delete(e.key);
    e.preventDefault();
  }
}

function breakoutFrame(now) {
  if (!bo) return;
  const dt = Math.min(0.033, bo.last ? (now - bo.last) / 1000 : 0);
  bo.last = now;
  stepBreakout(dt);
  drawBreakout();
  bo.raf = requestAnimationFrame(breakoutFrame);
}

function stepBreakout(dt) {
  const p = bo.paddle;
  if (bo.state === 'ready' || bo.state === 'playing') {
    const dir = (bo.keys.has('ArrowRight') ? 1 : 0) - (bo.keys.has('ArrowLeft') ? 1 : 0);
    p.x = Math.max(0, Math.min(BO.w - p.w, p.x + dir * BO.paddleSpeed * dt));
  }
  if (bo.state === 'ready') { resetBreakoutBall(); return; }
  if (bo.state !== 'playing') return;

  // small steps, so a fast ball can't pass through a brick in one frame
  const steps = Math.ceil((Math.hypot(bo.ball.vx, bo.ball.vy) * dt) / (BO.ball / 2)) || 1;
  for (let i = 0; i < steps && bo.state === 'playing'; i++) moveBreakoutBall(dt / steps);
}

function moveBreakoutBall(dt) {
  const b = bo.ball;
  const r = BO.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); }
  if (b.x > BO.w - r) { b.x = BO.w - r; b.vx = -Math.abs(b.vx); }
  if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); }

  // the paddle: where it hits sets the angle, like the original
  const p = bo.paddle;
  if (b.vy > 0 && b.y + r >= BO.paddleY && b.y + r <= BO.paddleY + BO.paddleH + 6
      && b.x >= p.x - r && b.x <= p.x + p.w + r) {
    const hit = Math.max(-1, Math.min(1, (b.x - (p.x + p.w / 2)) / (p.w / 2)));
    const angle = hit * (Math.PI / 3);   // up to 60° either side
    const speed = Math.hypot(b.vx, b.vy);
    b.vx = Math.sin(angle) * speed;
    b.vy = -Math.cos(angle) * speed;
    b.y = BO.paddleY - r;
  }

  for (const k of bo.bricks) {
    if (!k.alive) continue;
    const nx = Math.max(k.x, Math.min(b.x, k.x + k.w));
    const ny = Math.max(k.y, Math.min(b.y, k.y + k.h));
    const dx = b.x - nx;
    const dy = b.y - ny;
    if (dx * dx + dy * dy > r * r) continue;
    k.alive = false;
    bo.score += BREAKOUT_LEVELS[bo.level].points;
    // bounce off whichever face it came through
    if (Math.abs(dx) > Math.abs(dy)) b.vx = -b.vx; else b.vy = -b.vy;
    if (!bo.bricks.some((x) => x.alive)) bo.state = 'won';
    paintBreakoutStatus();
    break;
  }

  if (b.y - r > BO.h) {
    bo.lives -= 1;
    if (bo.lives <= 0) bo.state = 'lost';
    else { bo.state = 'ready'; resetBreakoutBall(); }
    paintBreakoutStatus();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawBreakout() {
  const ctx = bo.ctx;
  ctx.clearRect(0, 0, BO.w, BO.h);

  ctx.fillStyle = BO_COLOURS.brick;
  for (const k of bo.bricks) if (k.alive) roundRect(ctx, k.x, k.y, k.w, k.h, BO.radius);

  ctx.fillStyle = BO_COLOURS.paddle;
  roundRect(ctx, bo.paddle.x, BO.paddleY, bo.paddle.w, BO.paddleH, BO.paddleH / 2);

  if (bo.state !== 'lost') {
    ctx.fillStyle = BO_COLOURS.ball;
    ctx.beginPath();
    ctx.arc(bo.ball.x, bo.ball.y, BO.ball, 0, Math.PI * 2);
    ctx.fill();
  }

  const message = {
    ready: 'Press Space to launch',
    paused: 'Paused',
    won: 'Cleared! Press Space to play again',
    lost: 'Game over. Press Space to try again',
  }[bo.state];
  if (message) {
    ctx.fillStyle = getComputedStyle($('breakout')).getPropertyValue('--bo-ink').trim() || '#1c1c1e';
    ctx.font = '600 15px -apple-system, "SF Pro Text", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(message, BO.w / 2, BO.h / 2 + 40);
  }
}

function paintBreakoutStatus() {
  $('breakoutScore').textContent = String(bo.score);
  const lives = $('breakoutLives');
  lives.replaceChildren(...Array.from({ length: BO.lives }, (_, i) => {
    const dot = document.createElement('i');
    dot.classList.toggle('lost', i >= bo.lives);
    return dot;
  }));
  lives.setAttribute('aria-label', `${bo.lives} ${bo.lives === 1 ? 'life' : 'lives'} left`);
}

function wireBreakout() {
  $('eggTrigger').onclick = openBreakout;
  $('breakoutClose').onclick = closeBreakout;
  for (const btn of all('#breakout [data-level]')) btn.onclick = () => setBreakoutLevel(btn.dataset.level);
  // a click on the dimmed backdrop, outside the card, closes it too
  $('breakout').addEventListener('click', (e) => { if (e.target.id === 'breakout') closeBreakout(); });
}
