// Canvas recorder: works where screen capture is unavailable (phones).
// Every frame it paints the battle arena (DOM boxes, text, images), the VFX canvas,
// damage numbers and shout texts onto one canvas, and records that canvas with
// MediaRecorder. No permission prompt is needed.

const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
import { vfxActive } from './vfx.js';

const MAX_W = IS_MOBILE ? 540 : 1280;
const FPS = IS_MOBILE ? 24 : 30;
const SETTLE_MS = 450; // CSS transitions (hp bars, lunges) finish within this after a DOM change

// ---------------------------------------------------------------------------
// Color / style helpers
// ---------------------------------------------------------------------------
const COLOR_RE = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;
function isTransparent(c) {
  return !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
}
function setFill(ctx, c) {
  const before = ctx.fillStyle;
  ctx.fillStyle = '#000';
  ctx.fillStyle = c;
  if (ctx.fillStyle === '#000000' && !/^(#000|#000000|black|rgb\(0, 0, 0\))$/i.test(c)) { ctx.fillStyle = before; return false; }
  return true;
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// DOM painter
// ---------------------------------------------------------------------------
function paintTree(ctx, el, map, alpha) {
  if (!(el instanceof Element) || el.hidden) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const a = alpha * (parseFloat(cs.opacity) || 0);
  if (a <= 0.01) return;
  const r = el.getBoundingClientRect();
  const { x, y } = map(r.left, r.top);
  const w = r.width * map.k; const h = r.height * map.k;
  const rad = (parseFloat(cs.borderTopLeftRadius) || 0) * map.k;
  ctx.save();
  ctx.globalAlpha = a;

  // background (solid or the colors of a gradient)
  let filled = false;
  if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
    const cols = cs.backgroundImage.match(COLOR_RE) || [];
    if (cols.length) {
      const g = cs.backgroundImage.startsWith('radial')
        ? ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 1.4)
        : (cs.backgroundImage.includes('90deg') ? ctx.createLinearGradient(x, y, x + w, y) : ctx.createLinearGradient(x, y, x, y + h));
      cols.forEach((c, i) => { try { g.addColorStop(cols.length === 1 ? 0 : i / (cols.length - 1), c); } catch { /* unsupported color */ } });
      ctx.fillStyle = g; roundRect(ctx, x, y, w, h, rad); ctx.fill(); filled = true;
    }
  }
  if (!filled && !isTransparent(cs.backgroundColor) && setFill(ctx, cs.backgroundColor)) { roundRect(ctx, x, y, w, h, rad); ctx.fill(); }

  // border
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && !isTransparent(cs.borderTopColor)) {
    ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = bw * map.k;
    roundRect(ctx, x + bw * map.k / 2, y + bw * map.k / 2, w - bw * map.k, h - bw * map.k, rad); ctx.stroke();
  }

  // the speed die's diamond is a ::before pseudo element
  if (el.classList.contains('speed-die')) {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(Math.PI / 4);
    const s = w * 0.62; ctx.fillStyle = '#0d0c0f'; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = '#d9b56a'; ctx.lineWidth = 2 * map.k; ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore();
  }

  if (el.tagName === 'IMG' && el.complete && el.naturalWidth) {
    ctx.save(); roundRect(ctx, x, y, w, h, rad); ctx.clip();
    const ir = el.naturalWidth / el.naturalHeight; const br = w / h;
    let sw = el.naturalWidth; let sh = el.naturalHeight; let sx = 0; let sy = 0;
    if (ir > br) { sw = sh * br; sx = (el.naturalWidth - sw) / 2; } else { sh = sw / br; sy = (el.naturalHeight - sh) / 2; }
    ctx.drawImage(el, sx, sy, sw, sh, x, y, w, h); ctx.restore();
  }

  const clip = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
  if (clip) { roundRect(ctx, x, y, w, h, rad); ctx.clip(); }

  // text nodes
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.textContent.trim()) continue;
    paintText(ctx, n, cs, map);
  }
  for (const c of el.children) paintTree(ctx, c, map, a);
  ctx.restore();
}

function fontOf(cs, k, scale = 1) {
  return `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * k * scale}px ${cs.fontFamily}`;
}

function paintText(ctx, node, cs, map) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()].filter((q) => q.width > 0);
  if (!rects.length) return;
  ctx.font = fontOf(cs, map.k);
  ctx.textBaseline = 'alphabetic';
  if (!setFill(ctx, cs.color)) ctx.fillStyle = '#fff';
  let text = node.textContent.replace(/\s+/g, ' ');
  if (rects.length === 1) text = text.trim();
  for (const q of rects) {
    if (!text) break;
    // take as many characters as fit this line box
    let cut = text.length;
    const maxW = q.width * map.k + 2;
    if (rects.length > 1) { cut = 0; while (cut < text.length && ctx.measureText(text.slice(0, cut + 1)).width <= maxW) cut++; cut = Math.max(cut, 1); }
    const line = text.slice(0, cut); text = text.slice(cut).replace(/^\s/, '');
    const p = map(q.left, q.top);
    const fs = parseFloat(cs.fontSize) * map.k;
    ctx.fillText(line.trim() === line ? line : line.trimStart(), p.x, p.y + (q.height * map.k + fs * 0.72) / 2);
  }
}

/** The flashy shaking clash text (gradient-clipped text in CSS). */
function paintShout(ctx, el, map) {
  const span = el.querySelector('span'); if (!span) return;
  const cs = getComputedStyle(el);
  const r = span.getBoundingClientRect();
  if (!r.width) return;
  const color = cs.getPropertyValue('--c').trim() || '#fff';
  const scale = r.width / Math.max(1, span.offsetWidth);
  const p = map(r.left + r.width / 2, r.top + r.height / 2);
  const fs = parseFloat(cs.fontSize) * map.k * scale;
  ctx.save();
  ctx.globalAlpha = parseFloat(cs.opacity) || 1;
  ctx.font = `900 ${fs}px ${cs.fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const jx = (Math.random() - 0.5) * 6 * map.k; const jy = (Math.random() - 0.5) * 6 * map.k;
  const g = ctx.createLinearGradient(0, p.y - fs / 2, 0, p.y + fs / 2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, color); g.addColorStop(1, color);
  ctx.shadowColor = color; ctx.shadowBlur = 24 * map.k;
  ctx.fillStyle = color; ctx.globalAlpha *= 0.45; ctx.fillText(span.textContent, p.x + jx * 2, p.y); // ghost
  ctx.globalAlpha /= 0.45;
  ctx.lineWidth = 3 * map.k; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(span.textContent, p.x + jx, p.y + jy);
  ctx.fillStyle = g; ctx.fillText(span.textContent, p.x + jx, p.y + jy);
  ctx.restore();
}

/** Screen-shake offset currently applied to the arena (translate(x, y) in its inline style). */
function shakeOffset(target) {
  const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(target.style.transform || '');
  return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
}

function makeMap(target, k) {
  const r = target.getBoundingClientRect();
  const sh = shakeOffset(target);
  const left = r.left - sh.x; const top = r.top - sh.y; // the arena without shake
  const map = (px, py) => ({ x: (px - left) * k, y: (py - top) * k });
  map.k = k; map.left = left; map.top = top; map.width = r.width; map.shake = sh;
  return map;
}

/** Cheap per-frame layers on top: VFX particles, damage numbers, shout texts, banners. */
function paintOverlays(ctx, W, H, map, withVfx) {
  const k = map.k;
  const vfx = document.getElementById('vfx-canvas');
  if (withVfx && vfx && vfx.width) {
    const sx = vfx.width / innerWidth;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    try { ctx.drawImage(vfx, map.left * sx, map.top * sx, map.width * sx, (H / k) * sx, 0, 0, W, H); } catch { /* ignore */ }
    ctx.restore();
  }
  for (const el of document.querySelectorAll('.pop-num, .vfx-flash, .result-banner')) paintTree(ctx, el, map, 1);
  for (const el of document.querySelectorAll('.fx-shout')) paintShout(ctx, el, map);
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------
export function canvasRecordingSupported() {
  return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
}

// Chunks: pieces of the arena painted and cached separately (a unit card, the clash
// panel, the top bar...). A DOM change repaints only the chunk it happened in.
const CHUNK_SEL = '.unit, #clash-stage, .arena-top, .arena-actions';

function chunksOf(target) {
  const out = [];
  for (const el of target.querySelectorAll(CHUNK_SEL)) if (!el.parentElement.closest(CHUNK_SEL)) out.push(el);
  return out;
}

const PAD = 16; // css px around a chunk: things like the speed die stick out of the card

function paintChunk(entry, el, k) {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.ceil((r.width + PAD * 2) * k)); const h = Math.max(1, Math.ceil((r.height + PAD * 2) * k));
  if (!entry.canvas) entry.canvas = document.createElement('canvas');
  const c = entry.canvas;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const cx = c.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, w, h); cx.globalAlpha = 1;
  const map = (px, py) => ({ x: (px - r.left + PAD) * k, y: (py - r.top + PAD) * k });
  map.k = k;
  paintTree(cx, el, map, 1);
}

/** Start recording the element returned by getTarget() (re-queried every frame). */
export function startCanvasRecording(getTarget) {
  const first = getTarget();
  if (!first) throw new Error('녹화할 전투 화면이 없습니다.');
  const r0 = first.getBoundingClientRect();
  const W = Math.round(Math.min(MAX_W, Math.max(IS_MOBILE ? 400 : 540, r0.width * (IS_MOBILE ? 1.25 : 2))) / 2) * 2;
  const H = Math.round((W * Math.max(r0.height, 300) / r0.width) / 2) * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  layer.width = W; layer.height = H;
  const lctx = layer.getContext('2d');
  const bg = lctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#241016'); bg.addColorStop(1, '#0d0b0e');

  const cache = new Map(); // chunk element -> { canvas, dirtyUntil }
  let structureDirtyUntil = Infinity; // something outside a known chunk changed
  const now = () => performance.now();
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!node) continue;
      // the screen shake rewrites the arena's inline transform every frame: applied at compose time
      if (m.type === 'attributes' && m.attributeName === 'style' && node.id === 'arena') continue;
      const chunk = node.closest(CHUNK_SEL);
      if (chunk && cache.has(chunk)) cache.get(chunk).dirtyUntil = now() + SETTLE_MS;
      else structureDirtyUntil = now() + SETTLE_MS;
    }
  });
  const host = document.getElementById('tab-battle') || document.body;
  obs.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });

  let running = true; let last = 0; let n = 0; let wasBusy = true; let lastTarget = null; let lastRects = '';
  const loop = (t) => {
    if (!running) return;
    if (t - last >= 1000 / FPS - 2) {
      last = t; n++;
      const target = getTarget();
      if (target) {
        try {
          const tr = target.getBoundingClientRect();
          const k = W / Math.max(1, tr.width);
          const map = makeMap(target, k);
          if (target !== lastTarget) { cache.clear(); structureDirtyUntil = Infinity; lastTarget = target; }
          const chunks = chunksOf(target);
          let repainted = false;
          const half = n % 2 === 0;
          for (const el of chunks) {
            let e = cache.get(el);
            if (!e) { e = { canvas: null, dirtyUntil: Infinity }; cache.set(el, e); }
            if (!e.canvas || e.dirtyUntil === Infinity || (t < e.dirtyUntil && half) || (t < structureDirtyUntil && half)) {
              paintChunk(e, el, k);
              if (e.dirtyUntil === Infinity) e.dirtyUntil = 0;
              repainted = true;
            }
          }
          for (const el of [...cache.keys()]) if (!el.isConnected) cache.delete(el);
          if (structureDirtyUntil === Infinity) structureDirtyUntil = 0;
          // cards move (lunge / clash zoom): recompose when any rect changed
          const rects = chunks.map((el) => { const r = el.getBoundingClientRect(); return `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`; }).join(';');
          if (repainted || rects !== lastRects) {
            lastRects = rects;
            lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalAlpha = 1;
            lctx.fillStyle = bg; lctx.fillRect(0, 0, W, H);
            for (const el of chunks) {
              const e = cache.get(el); if (!e || !e.canvas) continue;
              const r = el.getBoundingClientRect();
              const p = map(r.left - map.shake.x - PAD, r.top - map.shake.y - PAD);
              lctx.drawImage(e.canvas, p.x, p.y, (r.width + PAD * 2) * k, (r.height + PAD * 2) * k);
            }
            repainted = true;
          }
          const fx = vfxActive();
          const overlays = document.querySelector('.pop-num, .fx-shout, .vfx-flash, .result-banner');
          // nothing moved: skip the frame; the video simply holds the previous picture
          if (repainted || fx || overlays || wasBusy) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (map.shake.x || map.shake.y) { ctx.fillStyle = '#0d0b0e'; ctx.fillRect(0, 0, W, H); }
            ctx.drawImage(layer, map.shake.x * k, map.shake.y * k);
            paintOverlays(ctx, W, H, map, fx);
          }
          wasBusy = repainted || fx || !!overlays; // one clean frame after effects end
        } catch (e) { console.warn('frame', e); }
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const stream = canvas.captureStream(FPS);
  return {
    stream,
    stop() { running = false; obs.disconnect(); for (const tr of stream.getTracks()) tr.stop(); },
    canvas,
  };
}
