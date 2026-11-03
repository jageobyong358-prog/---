import { h, toast } from './ui/dom.js';
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
  const autoVfx = h('input', { type: 'checkbox', checked: s.autoVfx });
  document.getElementById('tab-settings').replaceChildren(h('div', { class: 'panel' },
    h('h2', {}, '설정'),
    h('h3', {}, 'AI'),
    h('p', { class: CONFIG.aiProxyUrl ? '' : 'hint' }, CONFIG.aiProxyUrl ? `✓ AI 사용 가능 (모델: ${CONFIG.aiModel})` : 'AI 중계 서버가 아직 설정되지 않아 AI 기능을 사용할 수 없습니다.'),
    h('label', { class: 'check' }, autoVfx, ' 전투 시작 시 VFX가 없는 스킬은 VFX AI가 자동 생성'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
      settings.set({ autoVfx: autoVfx.checked });
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
