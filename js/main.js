import { h, toast, field, sel } from './ui/dom.js';
import { isAdmin, settings } from './store.js';
import { CONFIG, currentServer } from './config.js';
import { loadLibrary } from './library.js';
import { sandbox } from './sandbox.js';
import { mountLists } from './ui/editors.js';
import { renderSetup } from './ui/battle.js';
import { renderAdmin } from './ui/admin.js';

const TABS = [
  ['battle', '전투'], ['characters', '캐릭터'], ['skills', '스킬'], ['effects', '키워드 · 패시브'], ['settings', '설정'], ['admin', '관리자'],
];
let started = false;

function showTab(id) {
  for (const [t] of TABS) {
    document.getElementById(`tab-${t}`).hidden = t !== id;
    document.querySelector(`.tab-btn[data-tab="${t}"]`)?.classList.toggle('active', t === id);
  }
  if (id === 'admin') renderAdmin();
  if (id === 'settings') renderSettings();
  try { localStorage.setItem('lbs.tab', id); } catch { /* ignore */ }
}

function renderHeader() {
  const server = currentServer();
  document.getElementById('header-right').replaceChildren(
    h('span', { class: `server-badge ${server}` }, server === 'test' ? 'TEST SERVER' : 'LIVE'),
    isAdmin() ? h('span', { class: 'badge admin' }, 'ADMIN') : null,
    h('span', { class: 'user' }, '이 기기에 저장'));
}

function renderSettings() {
  const s = settings.get();
  const key = h('input', { type: 'password', class: 'inp', value: s.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off' });
  const effort = sel([['low', '낮음 (빠름)'], ['medium', '보통'], ['high', '높음 (정교함)']], s.effort);
  const autoVfx = h('input', { type: 'checkbox', checked: s.autoVfx });
  document.getElementById('tab-settings').replaceChildren(h('div', { class: 'panel' },
    h('h2', {}, '설정'),
    h('h3', {}, 'AI'),
    CONFIG.anthropicApiKey ? h('p', { class: 'hint' }, '✓ 사이트 공용 API 키가 설정되어 있습니다. 아래에 키를 넣으면 이 기기에서는 그 키를 대신 사용합니다.') : null,
    field('Anthropic API 키 (sk-ant-…, 이 기기에만 저장)', key, '키는 이 브라우저에만 저장됩니다.'),
    field('AI 생각 깊이', effort),
    h('label', { class: 'check' }, autoVfx, ' 전투 시작 시 VFX가 없는 스킬은 VFX AI가 자동 생성'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
      const k = key.value.trim();
      if (k && !k.startsWith('sk-ant-')) return toast('Anthropic API 키는 sk-ant- 로 시작합니다.', 'error');
      settings.set({ apiKey: k, effort: effort.value, autoVfx: autoVfx.checked });
      toast('저장했습니다.', 'ok');
    } }, '저장')),
    h('h3', {}, '저장 위치'),
    h('p', {}, '만든 캐릭터·스킬·키워드는 이 기기의 브라우저(IndexedDB)에 저장됩니다. 브라우저 데이터를 지우면 함께 지워집니다.'),
    h('h3', {}, '서버'),
    h('p', {}, `현재: ${currentServer() === 'test' ? '테스트 서버' : '라이브 서버'} `,
      h('a', { href: currentServer() === 'test' ? '?' : '?server=test' }, currentServer() === 'test' ? '라이브로 이동' : '테스트 서버로 이동'))));
}

async function enter() {
  renderHeader();
  const errs = await loadLibrary();
  if (errs.length) toast(`일부 데이터를 불러오지 못했습니다: ${errs[0]}`, 'error', 6000);
  if (!started) {
    started = true;
    await sandbox.ready;
    mountLists();
  }
  renderSetup();
  let tab = 'battle';
  try { tab = localStorage.getItem('lbs.tab') || 'battle'; } catch { /* ignore */ }
  if (!TABS.some(([t]) => t === tab)) tab = 'battle';
  showTab(tab);
}

function boot() {
  document.getElementById('tabs').replaceChildren(...TABS.map(([id, label]) => h('button', { class: 'tab-btn', 'data-tab': id, onclick: () => showTab(id) }, label)));
  if (currentServer() === 'test') document.body.classList.add('test-server');
  document.addEventListener('lbs:admin', renderHeader);
  enter();
}

boot();
