// Canvas VFX renderer + flashy shaking text.
const SIN_COLORS = {
  wrath: '#ff3b2f', lust: '#ff8a1f', sloth: '#ffd52a', gluttony: '#9be33a',
  gloom: '#2fd0f0', pride: '#3d6dff', envy: '#a64dff',
};

let canvas; let ctx; let particles = []; let running = false;
// Phones have 2.5-3x pixel ratios; a full-screen canvas at that size is very slow to clear and draw.
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const DPR = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.25 : 1.5);
const MAX_PARTICLES = IS_MOBILE ? 350 : 700;
let shakeUntil = 0; let shakeMag = 0;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'vfx-canvas';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = Math.round(innerWidth * DPR); canvas.height = Math.round(innerHeight * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); };
  resize();
  addEventListener('resize', resize);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const color = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : d);

function spawnLayer(L, x, y, dir) {
  const now = performance.now() + num(L.delay, 0, 0, 2000);
  const c = color(L.color, '#ffffff');
  switch (L.type) {
    case 'slash': {
      const n = num(L.count, 2, 1, 8);
      for (let i = 0; i < n; i++) {
        const ang = (num(L.angle, -25, -180, 180) + rnd(-1, 1) * num(L.spread, 25, 0, 180)) * Math.PI / 180;
        particles.push({ k: 'slash', t0: now + i * 70, life: 380, x: x + rnd(-30, 30), y: y + rnd(-30, 30), ang: ang * dir, len: num(L.length, 260, 40, 600), w: num(L.width, 6, 1, 30), c, glow: num(L.glow, 24, 0, 60) });
      }
      break;
    }
    case 'burst': {
      const n = num(L.count, 40, 1, 200);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2); const s = rnd(0.3, 1) * num(L.speed, 7, 0, 30);
        particles.push({ k: 'dot', t0: now, life: num(L.life, 700, 100, 3000) * rnd(0.6, 1), x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: num(L.gravity, 0.12, -1, 1), r: num(L.size, 3, 0.5, 14) * rnd(0.5, 1.2), c });
      }
      break;
    }
    case 'ring':
      particles.push({ k: 'ring', t0: now, life: num(L.life, 450, 100, 2000), x, y, R: num(L.radius, 140, 10, 600), w: num(L.width, 6, 1, 40), c });
      break;
    case 'beam':
      particles.push({ k: 'beam', t0: now, life: num(L.life, 400, 100, 2000), x, y, ang: num(L.angle, 0, -180, 180) * Math.PI / 180, w: num(L.width, 24, 2, 120), c, dir });
      break;
    case 'sparks': {
      const n = num(L.count, 24, 1, 120);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2); const s = rnd(0.5, 1) * num(L.speed, 10, 0, 40);
        particles.push({ k: 'spark', t0: now, life: num(L.life, 420, 50, 2000), x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, len: num(L.length, 26, 2, 120), c });
      }
      break;
    }
    case 'shards': {
      const n = num(L.count, 14, 1, 80);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2); const s = rnd(0.4, 1) * num(L.speed, 8, 0, 30);
        particles.push({ k: 'shard', t0: now, life: num(L.life, 800, 100, 3000), x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, rot: rnd(0, 6), vr: rnd(-0.3, 0.3), r: num(L.size, 10, 2, 40) * rnd(0.5, 1.2), c });
      }
      break;
    }
    case 'embers': {
      const n = num(L.count, 30, 1, 160);
      for (let i = 0; i < n; i++) {
        particles.push({ k: 'dot', t0: now + rnd(0, 300), life: num(L.life, 1200, 200, 4000) * rnd(0.6, 1), x: x + rnd(-90, 90), y: y + rnd(-40, 60), vx: rnd(-0.6, 0.6), vy: -num(L.rise, 1.6, 0, 8) * rnd(0.5, 1.3), g: 0, r: rnd(1, 3.5), c });
      }
      break;
    }
    case 'glyph':
      particles.push({ k: 'glyph', t0: now, life: num(L.life, 800, 100, 3000), x, y, text: String(L.text || '!').slice(0, 12), size: num(L.size, 90, 10, 260), c });
      break;
    default: break;
  }
}

function frame() {
  const now = performance.now();
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  // screen shake applied to the arena element
  const arena = document.getElementById('arena');
  if (arena) {
    if (now < shakeUntil) arena.style.transform = `translate(${rnd(-1, 1) * shakeMag}px, ${rnd(-1, 1) * shakeMag}px)`;
    else arena.style.transform = '';
  }
  ctx.globalCompositeOperation = 'lighter';
  particles = particles.filter((p) => now < p.t0 + p.life);
  for (const p of particles) {
    if (now < p.t0) continue;
    const t = (now - p.t0) / p.life; const a = 1 - t;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.strokeStyle = p.c; ctx.fillStyle = p.c;
    switch (p.k) {
      case 'slash': {
        const prog = Math.min(1, t * 2.2);
        const dx = Math.cos(p.ang) * p.len / 2; const dy = Math.sin(p.ang) * p.len / 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x - dx + dx * 2 * prog, p.y - dy + dy * 2 * prog);
        // glow: a wide faint stroke under the blade (much cheaper than shadowBlur)
        const ga = ctx.globalAlpha;
        ctx.globalAlpha = ga * 0.25; ctx.lineWidth = p.w * (1 - t * 0.7) + p.glow * 0.6; ctx.stroke();
        ctx.globalAlpha = ga; ctx.lineWidth = p.w * (1 - t * 0.7);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, p.w * 0.3);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        break;
      }
      case 'dot':
        p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.98;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a), 0, Math.PI * 2); ctx.fill();
        break;
      case 'ring':
        ctx.beginPath(); ctx.arc(p.x, p.y, p.R * (0.15 + t * 0.85), 0, Math.PI * 2);
        { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * 0.25; ctx.lineWidth = p.w * a + 12; ctx.stroke(); ctx.globalAlpha = ga; }
        ctx.lineWidth = p.w * a; ctx.stroke();
        break;
      case 'beam': {
        ctx.translate(p.x, p.y); ctx.rotate(p.ang + (p.dir < 0 ? Math.PI : 0));
        const g = ctx.createLinearGradient(-innerWidth, 0, 0, 0);
        g.addColorStop(0, 'transparent'); g.addColorStop(1, p.c);
        const w = p.w * (1 - t);
        ctx.fillStyle = g;
        { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * 0.3; ctx.fillRect(-innerWidth, -w, innerWidth + 50, w * 2); ctx.globalAlpha = ga; }
        ctx.fillRect(-innerWidth, -w / 2, innerWidth + 40, w);
        ctx.fillStyle = '#fff'; ctx.fillRect(-innerWidth, -w / 6, innerWidth + 30, w / 3);
        break;
      }
      case 'spark':
        p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.len / 10, p.y - p.vy * p.len / 10); ctx.stroke();
        break;
      case 'shard':
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.rot += p.vr;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r * 0.5, 0); ctx.lineTo(0, p.r); ctx.lineTo(-p.r * 0.4, 0); ctx.closePath(); ctx.fill();
        break;
      case 'glyph':
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = `900 ${p.size * (1 + t * 0.3)}px system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        { const jx = p.x + rnd(-3, 3); const jy = p.y - t * 30 + rnd(-3, 3);
          ctx.lineWidth = 10; ctx.lineJoin = 'round'; const ga = ctx.globalAlpha;
          ctx.globalAlpha = ga * 0.35; ctx.strokeText(p.text, jx, jy); ctx.globalAlpha = ga;
          ctx.fillText(p.text, jx, jy); }
        break;
      default: break;
    }
    ctx.restore();
  }
  if (particles.length || now < shakeUntil) requestAnimationFrame(frame);
  else { running = false; if (arena) arena.style.transform = ''; }
}

function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

export function shake(mag, ms) {
  shakeMag = Math.max(shakeMag * (performance.now() < shakeUntil ? 1 : 0), mag);
  shakeUntil = Math.max(shakeUntil, performance.now() + ms);
  ensureCanvas(); kick();
}

function flash(c) {
  const el = document.createElement('div');
  el.className = 'vfx-flash';
  el.style.background = c;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 350);
}

/** Play a VFX spec centered on element `target`. dir = +1 (to the right) / -1. */
export function playVfx(spec, target, dir = 1) {
  ensureCanvas();
  if (!spec || !Array.isArray(spec.layers)) return;
  const r = target ? target.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x = r.left + r.width / 2; const y = r.top + r.height / 2;
  for (const L of spec.layers.slice(0, 12)) spawnLayer(L, x, y, dir);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
  if (spec.shake) shake(num(spec.shake, 6, 0, 30), num(spec.duration, 500, 100, 2000) * 0.5);
  if (spec.flash) flash(color(spec.flash, '#ffffff'));
  kick();
}

/** Procedural default VFX for a skill if it has none. */
export function defaultVfx(skill, strong) {
  const c = SIN_COLORS[skill.sin] || '#ffffff';
  const base = { duration: 700, shake: strong ? 10 : 5, flash: strong ? c : null, layers: [] };
  if (skill.atkType === 'slash') {
    base.layers.push({ type: 'slash', color: c, count: strong ? 3 : 1, width: strong ? 10 : 6, length: 300, angle: -30, spread: 35, glow: 30 });
    base.layers.push({ type: 'sparks', color: '#ffffff', count: 18, speed: 12, life: 300 });
  } else if (skill.atkType === 'pierce') {
    base.layers.push({ type: 'beam', color: c, width: strong ? 36 : 18, angle: 0, life: 300 });
    base.layers.push({ type: 'ring', color: '#ffffff', radius: 90, width: 4, life: 300 });
    base.layers.push({ type: 'sparks', color: c, count: 22, speed: 14, life: 350 });
  } else {
    base.layers.push({ type: 'ring', color: c, radius: strong ? 220 : 140, width: 12, life: 450 });
    base.layers.push({ type: 'shards', color: c, count: strong ? 22 : 12, size: 10, speed: 9, life: 800 });
  }
  base.layers.push({ type: 'burst', color: c, count: strong ? 60 : 25, speed: 7, size: 3, gravity: 0.1, life: 600 });
  return base;
}

/** Flashy, shaking clash message. */
export function shoutText(text, colorHex = '#ffffff', opts = {}) {
  const layer = document.getElementById('fx-text-layer') || document.body;
  const el = document.createElement('div');
  el.className = 'fx-shout' + (opts.big ? ' big' : '');
  const c = color(colorHex, '#ffffff');
  el.style.setProperty('--c', c);
  el.dataset.text = text;
  const inner = document.createElement('span');
  inner.textContent = text;
  el.appendChild(inner);
  if (opts.x != null) { el.style.left = `${opts.x}px`; el.style.top = `${opts.y}px`; el.classList.add('positioned'); }
  layer.appendChild(el);
  // particles around the text
  ensureCanvas();
  const r = el.getBoundingClientRect();
  spawnLayer({ type: 'burst', color: c, count: 30, speed: 5, size: 2.5, gravity: -0.02, life: 900 }, r.left + r.width / 2, r.top + r.height / 2, 1);
  kick();
  setTimeout(() => el.remove(), opts.ms || 1700);
}

/** Floating damage number at element. */
export function popNumber(target, text, cls = '') {
  if (!target) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `pop-num ${cls}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2 + rnd(-24, 24)}px`;
  el.style.top = `${r.top + r.height * 0.3 + rnd(-10, 10)}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/** True while particles or a screen shake are animating (the phone recorder skips idle frames). */
export function vfxActive() { return particles.length > 0 || performance.now() < shakeUntil; }

export { SIN_COLORS };
