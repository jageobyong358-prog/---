// Tiny DOM helpers.

// replaceChildren()/append() turn null into the text "null"; the UI code passes
// optional children as `cond ? el : null`, so skip empty values everywhere.
for (const name of ['replaceChildren', 'append']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
}
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used with trusted static strings
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(msg, kind = 'info', ms = 3200) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, msg);
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(null); } },
      h('div', { class: 'modal' },
        h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', onclick: () => close(null), 'aria-label': '닫기' }, '✕')),
        h('div', { class: 'modal-body' }, body),
        actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: a.primary ? 'btn primary' : 'btn', onclick: () => close(a.value) }, a.label))) : null));
    document.body.appendChild(wrap);
  });
}

export function busy(btn, p, label = 'AI 작업 중…') {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label; btn.classList.add('loading');
  return p.finally(() => { btn.disabled = false; btn.textContent = old; btn.classList.remove('loading'); });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function num(value, opts = {}) {
  return h('input', { type: 'number', value: value ?? '', step: opts.step || 1, min: opts.min, max: opts.max, class: 'inp' });
}
export function txt(value, placeholder = '') { return h('input', { type: 'text', value: value ?? '', placeholder, class: 'inp' }); }
export function area(value, rows = 4, placeholder = '') { const t = h('textarea', { rows, placeholder, class: 'inp' }); t.value = value ?? ''; return t; }
export function sel(options, value) {
  const s = h('select', { class: 'inp' }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value ?? options[0]?.[0];
  return s;
}

/**
 * Live view of the AI at work: its reasoning (dim) and the code it is writing (bright, with a cursor).
 * Returns { el, update(progress), reset() }. Updates are batched to one paint per frame.
 */
export function aiLivePanel() {
  const head = h('div', { class: 'ai-live-head' });
  const thought = h('div', { class: 'ai-live-thought' });
  const code = h('pre', { class: 'ai-live-code' });
  const body = h('div', { class: 'ai-live-body' }, thought, code);
  const el = h('div', { class: 'ai-live', hidden: true }, head, body);
  let pending = null; let raf = 0;
  const PHASE = { wait: 'AI 서버 대기 중', think: 'AI가 구상 중', write: 'AI가 코드 작성 중', retry: '서버 혼잡 — 다른 모델로 전환 중' };
  const paint = () => {
    raf = 0;
    const p = pending; if (!p) return;
    el.hidden = false;
    el.dataset.phase = p.phase;
    head.textContent = `● ${PHASE[p.phase] || ''} · ${p.secs}초${p.model ? ` · ${p.model.split('/').pop()}` : ''}${p.chars ? ` · ${p.chars}자` : ''}`;
    thought.textContent = p.thought ? p.thought.slice(-600) : (p.phase === 'wait' || p.phase === 'retry' ? '요청을 보내는 중…' : '');
    code.textContent = p.text || '';
    body.scrollTop = body.scrollHeight;
  };
  return {
    el,
    update(p) { pending = p; if (!raf) raf = requestAnimationFrame(paint); },
    reset() { pending = null; el.hidden = true; thought.textContent = ''; code.textContent = ''; },
    finish(ok) { el.dataset.phase = ok ? 'done' : 'fail'; head.textContent = ok ? '✓ 완료' : '✕ 실패'; },
  };
}
