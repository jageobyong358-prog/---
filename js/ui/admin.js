// Admin (password): ask the in-app AI to create new content on the TEST server
// (stored on this device), test it, then publish to LIVE by exporting
// content/live.json and committing it to the repository.
import { h, toast, busy, area } from './dom.js';
import { isAdmin, adminLogin, adminLogout } from '../store.js';
import { currentServer } from '../config.js';
import { lib, loadLibrary, saveTestItem, listTestItems, deleteTestItem, listLiveItems, liveFileText } from '../library.js';
import { generateContent, aiAvailable } from '../ai.js';

const history = []; // conversation with the content AI (this session)
let lastBundle = null;
let pendingLive = null; // working copy of live items (publish / remove) until exported

const root = () => document.getElementById('tab-admin');
const KIND_OF = { characters: 'character', skills: 'skill', effects: 'effect' };
const KIND_LABEL = { character: '캐릭터', skill: '스킬', effect: '효과' };

function renderLogin(el) {
  const pw = h('input', { type: 'password', class: 'inp', placeholder: '관리자 코드', autocomplete: 'off' });
  const go = async () => {
    if (await adminLogin(pw.value)) { toast('관리자 모드', 'ok'); document.dispatchEvent(new Event('lbs:admin')); renderAdmin(); } else toast('관리자 코드가 올바르지 않습니다.', 'error');
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  el.replaceChildren(h('div', { class: 'panel' }, h('h2', {}, '관리자 코드 입력'), h('p', { class: 'hint' }, '관리자 코드를 입력하면 이 브라우저에서 관리자 기능이 켜집니다.'), h('div', { class: 'row' }, pw, h('button', { class: 'btn primary', onclick: go }, '들어가기'))));
}

export async function renderAdmin() {
  const el = root();
  if (!isAdmin()) return renderLogin(el);
  const head = h('div', { class: 'list-head' }, h('span', { class: 'badge admin' }, 'ADMIN'),
    h('button', { class: 'btn small', onclick: () => { adminLogout(); document.dispatchEvent(new Event('lbs:admin')); renderAdmin(); } }, '관리자 모드 끄기'));

  if (currentServer() !== 'test') {
    el.replaceChildren(head, h('div', { class: 'panel' },
      h('h2', {}, '관리자 — 라이브 서버'),
      h('p', {}, '신규 콘텐츠는 테스트 서버에서 AI로 제작하고 전투로 검증한 뒤 라이브에 배포합니다.'),
      h('a', { class: 'btn primary', href: '?server=test' }, '테스트 서버로 이동 →')),
    liveList());
    return;
  }

  const req = area('', 4, '예: 출혈을 중첩시키다 한 번에 터뜨리는 "혈화" 키워드와, 그걸 쓰는 질투 속성 관통 캐릭터 1명(스킬 3개 + 회피)을 만들어줘. 합 시작 메시지는 붉은색으로.');
  const out = h('div', { class: 'admin-out' });
  const chat = h('div', { class: 'admin-chat' });
  const renderChat = () => chat.replaceChildren(...history.map((m) => h('div', { class: `chat-msg ${m.role}` },
    m.role === 'user' ? m.content : safeSummary(m.content))));
  const sendBtn = h('button', { class: 'btn ai' }, '✦ AI에게 요청');
  sendBtn.addEventListener('click', () => {
    const text = req.value.trim();
    if (!text) return;
    if (!aiAvailable()) return toast('Anthropic API 키가 필요합니다 (설정 탭 또는 js/config.js).', 'error');
    busy(sendBtn, generateContent({ request: text, library: lib, history }).then(({ bundle, errors, raw }) => {
      history.push({ role: 'user', content: text }, { role: 'assistant', content: raw });
      lastBundle = bundle;
      req.value = '';
      renderBundle(out, bundle, errors);
      renderChat();
    }).catch((e) => toast(e.message, 'error')), 'AI가 콘텐츠를 만드는 중…');
  });
  renderChat();

  el.replaceChildren(head,
    h('div', { class: 'panel' },
      h('h2', {}, '관리자 — 테스트 서버 콘텐츠 제작 AI'),
      h('p', { class: 'hint' }, '이 대화로 만든 콘텐츠는 이 기기의 테스트 서버에 추가됩니다. "방금 캐릭터 체력 올려줘"처럼 이어서 수정 요청도 가능합니다.'),
      chat, req, h('div', { class: 'row' }, sendBtn, h('button', { class: 'btn', onclick: () => { history.length = 0; lastBundle = null; out.replaceChildren(); renderChat(); } }, '대화 초기화')),
      out),
    await testList(),
    liveList());
  if (lastBundle) renderBundle(out, lastBundle, []);
}

function safeSummary(raw) {
  try { const m = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/); return m ? JSON.parse(`"${m[1]}"`) : '(콘텐츠 생성됨)'; } catch { return '(콘텐츠 생성됨)'; }
}

function renderBundle(out, bundle, errors) {
  const items = [];
  for (const k of ['effects', 'skills', 'characters']) for (const it of bundle[k] || []) items.push({ kind: KIND_OF[k], item: it });
  const checks = new Map();
  out.replaceChildren(
    h('h3', {}, '생성 결과'),
    bundle.summary ? h('p', {}, bundle.summary) : null,
    errors.length ? h('div', { class: 'warn' }, '코드 검증 경고: ', errors.join(' / ')) : null,
    h('div', { class: 'bundle' }, items.map(({ kind, item }) => {
      const cb = h('input', { type: 'checkbox', checked: true });
      checks.set(item, { cb, kind });
      return h('details', { class: 'bundle-item' },
        h('summary', {}, cb, ` [${KIND_LABEL[kind]}] ${item.name} `, h('code', {}, item.id), lib[`${kind}s`]?.some((x) => x.id === item.id) ? h('span', { class: 'badge' }, '덮어쓰기') : null),
        h('pre', {}, JSON.stringify(item, null, 2)));
    })),
    h('button', { class: 'btn primary', onclick: async (e) => {
      const btn = e.currentTarget;
      const chosen = [...checks.entries()].filter(([, v]) => v.cb.checked);
      await busy(btn, (async () => {
        for (const [item, { kind }] of chosen) await saveTestItem(kind, item);
        await loadLibrary();
        toast(`${chosen.length}개 콘텐츠를 테스트 서버에 추가했습니다. 전투 탭에서 바로 테스트해 보세요.`, 'ok');
        renderAdmin();
      })().catch((err) => toast(`저장 실패: ${err.message}`, 'error')), '저장 중…');
    } }, '선택 항목 테스트 서버에 추가'));
}

function workingLive() {
  if (!pendingLive) pendingLive = listLiveItems();
  return pendingLive;
}
function publish(it) {
  const live = workingLive();
  const i = live.findIndex((x) => x.id === it.id);
  if (i >= 0) live[i] = it; else live.push(it);
}

async function testList() {
  let items = [];
  try { items = await listTestItems(); } catch (e) { return h('div', { class: 'panel' }, `테스트 서버 목록을 불러오지 못했습니다: ${e.message}`); }
  const rows = items.length ? items.map((it) => h('div', { class: 'server-row' },
    h('span', { class: 'badge' }, KIND_LABEL[it.kind] || it.kind), ` ${it.name} `, h('code', {}, it.id),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small primary', onclick: () => { publish(it); toast(`${it.name}: 라이브 배포 목록에 추가 (아래에서 파일 내보내기)`, 'ok'); renderAdmin(); } }, '라이브 배포'),
    h('button', { class: 'btn small', onclick: async () => { if (!confirm(`테스트 서버에서 ${it.name} 을(를) 삭제할까요?`)) return; await deleteTestItem(it.id); await loadLibrary(); renderAdmin(); } }, '삭제'))) : [h('p', { class: 'hint' }, '아직 콘텐츠가 없습니다.')];
  return h('div', { class: 'panel' },
    h('div', { class: 'list-head' }, h('h3', {}, '테스트 서버 콘텐츠 (이 기기)'),
      items.length ? h('button', { class: 'btn primary', onclick: () => { items.forEach(publish); toast('전체를 라이브 배포 목록에 추가했습니다.', 'ok'); renderAdmin(); } }, '전체 라이브 배포') : null),
    rows);
}

function liveList() {
  const live = workingLive();
  const changed = JSON.stringify(live) !== JSON.stringify(listLiveItems());
  return h('div', { class: 'panel' },
    h('div', { class: 'list-head' }, h('h3', {}, `라이브 콘텐츠 (content/live.json)${changed ? ' — 변경됨' : ''}`),
      h('div', { class: 'row' },
        changed ? h('button', { class: 'btn', onclick: () => { pendingLive = null; renderAdmin(); } }, '변경 취소') : null,
        h('button', { class: `btn ${changed ? 'primary' : ''}`, onclick: () => {
          const blob = new Blob([liveFileText(live)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'live.json' });
          document.body.appendChild(a); a.click(); a.remove();
        } }, 'live.json 내보내기'))),
    h('p', { class: 'hint' }, '정적 사이트라 라이브 반영은 파일로 합니다: 내보낸 live.json 을 저장소의 content/live.json 에 덮어쓰고 커밋·배포하면 모든 사용자에게 적용됩니다.'),
    live.length ? live.map((it) => h('div', { class: 'server-row' },
      h('span', { class: 'badge' }, KIND_LABEL[it.kind] || it.kind), ` ${it.name} `, h('code', {}, it.id), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => { pendingLive = live.filter((x) => x.id !== it.id); renderAdmin(); } }, '라이브에서 제외'))) : h('p', { class: 'hint' }, '라이브 콘텐츠가 없습니다 (기본 콘텐츠만 사용 중).'));
}
