// Canvas recorder: works where screen capture is unavailable (phones).
// Every frame it paints the battle arena (DOM boxes, text, images), the VFX canvas,
// damage numbers and shout texts onto one canvas, and records that canvas with
// MediaRecorder. No permission prompt is needed.

const MAX_W = 1280;
const FPS = 30;

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

function paintFrame(ctx, W, H, target) {
  const region = target.getBoundingClientRect();
  const k = W / Math.max(1, region.width);
  const map = (px, py) => ({ x: (px - region.left) * k, y: (py - region.top) * k });
  map.k = k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#241016'); bg.addColorStop(1, '#0d0b0e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // arena contents (skip its own background: drawn above)
  for (const c of target.children) paintTree(ctx, c, map, 1);
  // VFX particles
  const vfx = document.getElementById('vfx-canvas');
  if (vfx && vfx.width) {
    const sx = vfx.width / innerWidth;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    try { ctx.drawImage(vfx, region.left * sx, region.top * sx, region.width * sx, (H / k) * sx, 0, 0, W, H); } catch { /* ignore */ }
    ctx.restore();
  }
  // overlays that live outside the arena
  for (const el of document.querySelectorAll('.pop-num, .vfx-flash, .result-banner')) paintTree(ctx, el, map, 1);
  for (const el of document.querySelectorAll('.fx-shout')) paintShout(ctx, el, map);
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------
export function canvasRecordingSupported() {
  return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
}

/** Start recording the element returned by getTarget() (re-queried every frame). */
export function startCanvasRecording(getTarget, mime) {
  const first = getTarget();
  if (!first) throw new Error('녹화할 전투 화면이 없습니다.');
  const r0 = first.getBoundingClientRect();
  const W = Math.round(Math.min(MAX_W, Math.max(640, r0.width * 2)) / 2) * 2;
  const H = Math.round((W * Math.max(r0.height, 300) / r0.width) / 2) * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let running = true;
  let last = 0;
  const loop = (t) => {
    if (!running) return;
    if (t - last >= 1000 / FPS - 2) {
      last = t;
      const target = getTarget();
      if (target) { try { paintFrame(ctx, W, H, target); } catch (e) { console.warn('frame', e); } }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const stream = canvas.captureStream(FPS);
  return {
    stream,
    stop() { running = false; for (const tr of stream.getTracks()) tr.stop(); },
    canvas,
  };
}
