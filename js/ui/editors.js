// Character / Skill / Keyword-Passive editors.
import { h, toast, modal, busy, field, num, txt, area, sel } from './dom.js';
import { lib, saveItem, deleteItem, newId, getSkill, onLibChange } from '../library.js';
import { imageToDataUrl } from '../store.js';
import { generateEffect, generateSkillEffects, generateVfx, aiAvailable } from '../ai.js';
import { playVfx, defaultVfx, shoutText, SIN_COLORS } from '../vfx.js';
import { sandbox } from '../sandbox.js';

export const SIN_LIST = [['wrath', '분노'], ['lust', '색욕'], ['sloth', '나태'], ['gluttony', '탐식'], ['gloom', '우울'], ['pride', '오만'], ['envy', '질투']];
export const ATK_LIST = [['slash', '참격'], ['pierce', '관통'], ['blunt', '타격']];
export const TYPE_LIST = [['attack', '공격'], ['guard', '수비'], ['evade', '회피'], ['counter', '반격']];
const RES_LIST = [['2', '치명 (x2.0)'], ['1.5', '취약 (x1.5)'], ['1', '보통 (x1.0)'], ['0.5', '견딤 (x0.5)'], ['0.25', '내성 (x0.25)']];
const TRIGGERS = [['skillUse', '스킬 사용 시'], ['clashStart', '합 시작'], ['clashWin', '합 승리'], ['clashLose', '합 패배'], ['kill', '처치'], ['stagger', '흐트러짐 유발']];
const SRC_LABEL = { builtin: '기본', live: '서버', test: '테스트', user: '내 것' };

const sinName = (s) => (SIN_LIST.find((x) => x[0] === s) || [s, s])[1];
const atkName = (s) => (ATK_LIST.find((x) => x[0] === s) || [s, s])[1];

export function portrait(item, cls = 'portrait') {
  if (item && item.image) return h('img', { class: cls, src: item.image, alt: item.name || '' });
  const letter = (item && item.name ? item.name[0] : '?');
  return h('div', { class: `${cls} placeholder`, style: { '--c': SIN_COLORS[item?.sin] || '#7a1d1d' } }, letter);
}

function imagePicker(item) {
  const preview = h('div', { class: 'img-preview' }, portrait(item, 'portrait big'));
  const input = h('input', { type: 'file', accept: 'image/*', class: 'inp' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      item.image = await imageToDataUrl(f);
      preview.replaceChildren(portrait(item, 'portrait big'));
    } catch (e) { toast(e.message, 'error'); }
  });
  const clear = h('button', { class: 'btn small', type: 'button', onclick: () => { item.image = null; preview.replaceChildren(portrait(item, 'portrait big')); } }, '이미지 제거');
  return h('div', { class: 'img-picker' }, preview, h('div', {}, input, clear));
}

/** Editable list of clash messages {trigger, text, color}. */
function messagesEditor(list) {
  const box = h('div', { class: 'msg-list' });
  const render = () => {
    box.replaceChildren(
      ...list.map((m, i) => {
        const t = txt(m.text, '문구'); t.addEventListener('input', () => { m.text = t.value; });
        const c = h('input', { type: 'color', value: m.color || '#ffffff', class: 'color-inp' }); c.addEventListener('input', () => { m.color = c.value; });
        const tr = sel(TRIGGERS, m.trigger || 'clashStart'); tr.addEventListener('change', () => { m.trigger = tr.value; });
        return h('div', { class: 'msg-row' }, tr, t, c,
          h('button', { class: 'btn small', type: 'button', onclick: () => shoutText(m.text || '미리보기', m.color) }, '미리보기'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '삭제', onclick: () => { list.splice(i, 1); render(); } }, '✕'));
      }),
      h('button', { class: 'btn small', type: 'button', onclick: () => { list.push({ trigger: 'clashStart', text: '', color: '#ff3355' }); render(); } }, '+ 합 진행 메시지 추가'));
  };
  render();
  return box;
}

/** Modal buttons: edit in place (overrides built-in/server items on this device), save as copy, delete/revert. */
function editActions(orig) {
  const acts = [];
  if (orig && orig.source === 'user') acts.push({ label: orig.base ? '원래대로 되돌리기' : '삭제', value: 'delete' });
  if (orig) acts.push({ label: '사본으로 저장', value: 'copy' });
  acts.push({ label: '저장', value: 'save', primary: true });
  return acts;
}

function asNewCopy(item, orig, prefix) {
  item.id = newId(prefix);
  if (orig && item.name === orig.name) item.name = `${item.name} (사본)`;
}

function overrideNote(orig) {
  if (!orig) return null;
  if (orig.source !== 'user') return h('p', { class: 'hint' }, `${SRC_LABEL[orig.source] || ''} 콘텐츠입니다. 저장하면 이 기기에서 바로 바뀌고(이 항목을 쓰는 캐릭터에도 적용), 「원래대로 되돌리기」로 복구할 수 있습니다.`);
  if (orig.base) return h('p', { class: 'hint' }, `${SRC_LABEL[orig.base] || ''} 콘텐츠를 수정한 상태입니다.`);
  return null;
}

function sourceBadge(item) { return h('span', { class: `badge src-${item.source}` }, item.base ? '수정함' : (SRC_LABEL[item.source] || item.source)); }

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
export function mountLists() {
  const render = () => {
    renderCharList(document.getElementById('tab-characters'));
    renderSkillList(document.getElementById('tab-skills'));
    renderEffectList(document.getElementById('tab-effects'));
  };
  onLibChange(render);
  render();
}

function listShell(title, onNew, items) {
  return [
    h('div', { class: 'list-head' }, h('h2', {}, title), h('button', { class: 'btn primary', onclick: onNew }, '+ 새로 만들기')),
    h('div', { class: 'card-grid' }, items),
  ];
}

function renderCharList(root) {
  root.replaceChildren(...listShell('캐릭터', () => editCharacter(null), lib.characters.map((c) =>
    h('button', { class: 'item-card', onclick: () => editCharacter(c) },
      portrait(c),
      h('div', { class: 'item-info' },
        h('div', { class: 'item-title' }, h('small', {}, c.title || ''), ' ', c.name),
        h('div', { class: 'item-sub' }, `HP ${c.maxHp} · 속도 ${c.speed?.[0]}-${c.speed?.[1]} · Lv ${c.level}/${c.defLevel}`),
        sourceBadge(c))))));
}

function renderSkillList(root) {
  root.replaceChildren(...listShell('스킬', () => editSkill(null), lib.skills.map((s) =>
    h('button', { class: 'item-card', onclick: () => editSkill(s) },
      portrait(s),
      h('div', { class: 'item-info' },
        h('div', { class: 'item-title' }, h('span', { class: 'sin-dot', style: { background: SIN_COLORS[s.sin] } }), s.name),
        h('div', { class: 'item-sub' }, `${sinName(s.sin)} · ${atkName(s.atkType)} · ${s.basePower}${s.coinPower >= 0 ? '+' : ''}${s.coinPower} x${s.coinCount}`),
        sourceBadge(s))))));
}

function renderEffectList(root) {
  const builtins = (sandbox.builtins || []).map((b) => h('div', { class: 'item-card static' },
    h('div', { class: 'portrait placeholder small', style: { '--c': b.color } }, b.name[0]),
    h('div', { class: 'item-info' }, h('div', { class: 'item-title' }, b.name, h('code', {}, ` ${b.id}`)), h('div', { class: 'item-sub' }, b.desc), h('span', { class: 'badge src-builtin' }, '내장 키워드'))));
  root.replaceChildren(
    ...listShell('키워드 · 패시브 (AI 구현)', () => editEffect(null), lib.effects.map((e) =>
      h('button', { class: 'item-card', onclick: () => editEffect(e) },
        h('div', { class: 'portrait placeholder small', style: { '--c': e.color || '#888' } }, (e.name || '?')[0]),
        h('div', { class: 'item-info' },
          h('div', { class: 'item-title' }, e.name, h('code', {}, ` ${e.id}`)),
          h('div', { class: 'item-sub' }, `${e.kind === 'keyword' ? '키워드' : '패시브'} · ${e.desc || ''}`),
          sourceBadge(e))))),
    h('h3', { class: 'sub-head' }, '내장 키워드'),
    h('div', { class: 'card-grid' }, builtins));
}

// ---------------------------------------------------------------------------
// Character editor
// ---------------------------------------------------------------------------
async function editCharacter(orig) {
  const c = structuredClone(orig || {
    id: newId('ch'), name: '', title: '', maxHp: 120, speed: [3, 6], level: 40, defLevel: 38, stagger: [0.6, 0.3],
    resist: { slash: 1, pierce: 1, blunt: 1 }, sinResist: {}, skills: [], defense: null, passives: [], messages: [], image: null,
  });
  const f = {
    name: txt(c.name, '이름'), title: txt(c.title, '수식어 / 인격명'), hp: num(c.maxHp, { min: 1 }),
    spdLo: num(c.speed[0], { min: 1 }), spdHi: num(c.speed[1], { min: 1 }), lv: num(c.level), dlv: num(c.defLevel),
    stagger: txt((c.stagger || []).map((x) => Math.round(x * 100)).join(', '), '예: 60, 30'),
  };
  const res = Object.fromEntries(ATK_LIST.map(([k]) => [k, sel(RES_LIST, String(c.resist?.[k] ?? 1))]));
  const sinRes = Object.fromEntries(SIN_LIST.map(([k]) => [k, num(c.sinResist?.[k] ?? 1, { step: 0.25, min: 0 })]));

  const skillRows = h('div', { class: 'skill-rows' });
  const atkSkills = () => lib.skills.filter((s) => s.type === 'attack' || s.type === 'counter');
  const renderSkills = () => {
    skillRows.replaceChildren(
      ...c.skills.map((s, i) => {
        const sk = sel(atkSkills().map((x) => [x.id, `${x.name} (${sinName(x.sin)})`]), s.id); sk.addEventListener('change', () => { s.id = sk.value; });
        const cp = num(s.copies, { min: 1, max: 6 }); cp.addEventListener('input', () => { s.copies = Math.max(1, +cp.value || 1); });
        const edit = h('button', { class: 'btn small', type: 'button', title: '이 스킬 이름·수치 편집', onclick: async () => { const cur = getSkill(s.id); if (cur) { await editSkill(cur); renderSkills(); } } }, '✎ 편집');
        return h('div', { class: 'msg-row' }, h('span', { class: 'chip' }, `스킬 ${i + 1}`), sk, edit, h('span', {}, '장수'), cp,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '삭제', onclick: () => { c.skills.splice(i, 1); renderSkills(); } }, '✕'));
      }),
      h('button', { class: 'btn small', type: 'button', onclick: () => { const first = atkSkills()[0]; if (first) { c.skills.push({ id: first.id, copies: c.skills.length === 0 ? 3 : c.skills.length === 1 ? 2 : 1 }); renderSkills(); } } }, '+ 스킬 추가'));
  };
  renderSkills();

  const defSel = sel([['', '없음'], ...lib.skills.filter((s) => s.type !== 'attack').map((s) => [s.id, `${s.name} (${TYPE_LIST.find((t) => t[0] === s.type)?.[1]})`])], c.defense || '');
  const passiveBox = h('div', { class: 'check-list' }, lib.effects.filter((e) => e.kind === 'passive').map((e) => {
    const cb = h('input', { type: 'checkbox', checked: c.passives.includes(e.id) });
    cb.addEventListener('change', () => { c.passives = cb.checked ? [...new Set([...c.passives, e.id])] : c.passives.filter((x) => x !== e.id); });
    return h('label', { class: 'check' }, cb, ` ${e.name}`, h('small', {}, ` — ${e.desc || ''}`));
  }));

  const body = h('div', { class: 'editor' },
    overrideNote(orig),
    imagePicker(c),
    h('div', { class: 'grid2' }, field('이름', f.name), field('수식어', f.title)),
    h('div', { class: 'grid4' }, field('최대 체력', f.hp), field('속도 최소', f.spdLo), field('속도 최대', f.spdHi), field('흐트러짐 역치(%)', f.stagger)),
    h('div', { class: 'grid2' }, field('공격 레벨', f.lv, '스킬 공격 레벨 = 이 값 + 스킬 보정'), field('방어 레벨', f.dlv)),
    h('h4', {}, '물리 내성'),
    h('div', { class: 'grid3' }, ATK_LIST.map(([k, l]) => field(l, res[k]))),
    h('h4', {}, '죄악 내성 (배율)'),
    h('div', { class: 'grid4' }, SIN_LIST.map(([k, l]) => field(l, sinRes[k]))),
    h('h4', {}, '스킬 덱 (림버스식: 매 턴 덱에서 2장 제시)'), skillRows,
    h('div', { class: 'row' }, field('수비/회피 스킬', defSel),
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        const cur = getSkill(defSel.value);
        if (!cur) return;
        await editSkill(cur);
        const opt = defSel.querySelector(`option[value="${cur.id}"]`);
        const now = getSkill(cur.id);
        if (opt && now) opt.textContent = `${now.name} (${TYPE_LIST.find((t) => t[0] === now.type)?.[1]})`;
      } }, '✎ 편집')),
    h('h4', {}, '패시브'), passiveBox,
    h('h4', {}, '합 진행 메시지 (캐릭터 공통)'), messagesEditor(c.messages));

  const actions = editActions(orig);
  const r = await modal(orig ? `캐릭터 편집 — ${orig.name}` : '새 캐릭터', body, actions);
  if (r === 'delete') { await deleteItem('character', c.id); toast(orig.base ? '원래대로 되돌렸습니다.' : '삭제했습니다.'); return; }
  if (r !== 'save' && r !== 'copy') return;
  const asCopy = r === 'copy';
  Object.assign(c, {
    name: f.name.value.trim() || '이름 없음', title: f.title.value.trim(), maxHp: +f.hp.value || 100,
    speed: [+f.spdLo.value || 1, Math.max(+f.spdLo.value || 1, +f.spdHi.value || 1)], level: +f.lv.value || 0, defLevel: +f.dlv.value || 0,
    stagger: f.stagger.value.split(',').map((x) => +x.trim() / 100).filter((x) => x > 0 && x < 1),
    resist: Object.fromEntries(ATK_LIST.map(([k]) => [k, +res[k].value])),
    sinResist: Object.fromEntries(SIN_LIST.map(([k]) => [k, +sinRes[k].value || 1])),
    defense: defSel.value || null,
  });
  if (asCopy) asNewCopy(c, orig, 'ch');
  try { await saveItem('character', c); toast('저장했습니다.', 'ok'); } catch (e) { toast(`저장 실패: ${e.message}`, 'error'); }
}

// ---------------------------------------------------------------------------
// Skill editor
// ---------------------------------------------------------------------------
async function editSkill(orig) {
  const s = structuredClone(orig || {
    id: newId('sk'), name: '', sin: 'wrath', type: 'attack', atkType: 'slash', basePower: 4, coinPower: 3, coinCount: 2,
    offLevel: 0, desc: '', effects: [], messages: [], vfx: null, image: null,
  });
  const f = {
    name: txt(s.name, '스킬 이름'), sin: sel(SIN_LIST, s.sin), type: sel(TYPE_LIST, s.type), atk: sel(ATK_LIST, s.atkType),
    base: num(s.basePower), coin: num(s.coinPower), cnt: num(s.coinCount, { min: 1, max: 10 }), off: num(s.offLevel),
    desc: area(s.desc, 3, '예: [적중 시] 화상 2 부여. [합 승리 시] 대상의 화상 위력만큼 피해량 +5%'),
    effects: area(JSON.stringify(s.effects || [], null, 2), 8),
    vfx: area(s.vfx ? JSON.stringify(s.vfx, null, 2) : '', 6, '비워 두면 죄악 속성/공격 유형에 따른 기본 VFX'),
    vfxPrompt: txt('', 'VFX 추가 요청 (예: 검붉은 불꽃이 회오리치게)'),
  };
  const aiEffBtn = h('button', { class: 'btn ai', type: 'button' }, '✦ AI로 효과 구현');
  aiEffBtn.addEventListener('click', () => {
    if (!aiAvailable()) return toast('AI 중계 서버가 설정되지 않아 AI를 사용할 수 없습니다.', 'error');
    const skill = { ...s, name: f.name.value, sin: f.sin.value, atkType: f.atk.value, basePower: +f.base.value, coinPower: +f.coin.value, coinCount: +f.cnt.value, desc: f.desc.value };
    busy(aiEffBtn, generateSkillEffects({ skill, customEffects: lib.effects }).then(({ effects, errors }) => {
      f.effects.value = JSON.stringify(effects, null, 2);
      toast(errors.length ? `생성됨 (검증 경고: ${errors.join(', ')})` : 'AI가 스킬 효과를 구현했습니다.', errors.length ? 'error' : 'ok');
    }).catch((e) => toast(e.message, 'error')));
  });
  const aiVfxBtn = h('button', { class: 'btn ai', type: 'button' }, '✦ AI VFX 생성');
  aiVfxBtn.addEventListener('click', () => {
    if (!aiAvailable()) return toast('AI 중계 서버가 설정되지 않아 AI를 사용할 수 없습니다.', 'error');
    const skill = { ...s, name: f.name.value, sin: f.sin.value, atkType: f.atk.value, type: f.type.value, desc: f.desc.value };
    busy(aiVfxBtn, generateVfx({ skill, prompt: f.vfxPrompt.value }).then((spec) => {
      f.vfx.value = JSON.stringify(spec, null, 2);
      playVfx(spec, null, 1);
    }).catch((e) => toast(e.message, 'error')));
  });
  const previewBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    let spec;
    try { spec = f.vfx.value.trim() ? JSON.parse(f.vfx.value) : defaultVfx({ sin: f.sin.value, atkType: f.atk.value }, true); } catch (e) { return toast(`VFX JSON 오류: ${e.message}`, 'error'); }
    playVfx(spec, null, 1);
  } }, 'VFX 미리보기');

  const body = h('div', { class: 'editor' },
    overrideNote(orig),
    imagePicker(s),
    h('div', { class: 'grid2' }, field('이름', f.name), field('죄악 속성', f.sin)),
    h('div', { class: 'grid2' }, field('스킬 유형', f.type), field('공격 유형', f.atk)),
    h('div', { class: 'grid4' }, field('기본 위력', f.base), field('코인 위력', f.coin, '음수 = 마이너스 코인'), field('코인 개수', f.cnt), field('공격 레벨 보정', f.off)),
    field('효과 설명', f.desc),
    h('div', { class: 'row' }, aiEffBtn, h('small', { class: 'hint' }, '설명을 쓰고 누르면 AI가 실제로 동작하는 효과 데이터를 만듭니다.')),
    field('효과 데이터 (JSON)', f.effects),
    h('h4', {}, 'VFX'),
    h('div', { class: 'row' }, f.vfxPrompt, aiVfxBtn, previewBtn),
    f.vfx,
    h('h4', {}, '합 진행 메시지'), messagesEditor(s.messages));

  const actions = editActions(orig);
  const r = await modal(orig ? `스킬 편집 — ${orig.name}` : '새 스킬', body, actions);
  if (r === 'delete') { await deleteItem('skill', s.id); toast(orig.base ? '원래대로 되돌렸습니다.' : '삭제했습니다.'); return; }
  if (r !== 'save' && r !== 'copy') return;
  const asCopy = r === 'copy';
  try {
    s.effects = f.effects.value.trim() ? JSON.parse(f.effects.value) : [];
    s.vfx = f.vfx.value.trim() ? JSON.parse(f.vfx.value) : null;
  } catch (e) { toast(`JSON 오류: ${e.message}`, 'error'); return; }
  Object.assign(s, {
    name: f.name.value.trim() || '이름 없는 스킬', sin: f.sin.value, type: f.type.value, atkType: f.atk.value,
    basePower: +f.base.value || 0, coinPower: +f.coin.value || 0, coinCount: Math.max(1, +f.cnt.value || 1), offLevel: +f.off.value || 0, desc: f.desc.value.trim(),
  });
  if (asCopy) asNewCopy(s, orig, 'sk');
  try { await saveItem('skill', s); toast('저장했습니다.', 'ok'); } catch (e) { toast(`저장 실패: ${e.message}`, 'error'); }
}

// ---------------------------------------------------------------------------
// Keyword / Passive editor (AI implements the behaviour)
// ---------------------------------------------------------------------------
async function editEffect(orig) {
  const e = structuredClone(orig || { id: newId('ef'), kind: 'keyword', name: '', color: '#ff5577', desc: '', turnOnly: false, hooks: {} });
  const f = {
    kind: sel([['keyword', '키워드 (상태이상)'], ['passive', '패시브']], e.kind), name: txt(e.name, '이름'),
    color: h('input', { type: 'color', value: e.color || '#ff5577', class: 'color-inp' }),
    desc: area(e.desc, 4, '예: 턴 종료 시 위력만큼 피해를 받고, 이 피해로 흐트러지면 다음 턴 속박 2를 얻는다. 횟수 1 감소.'),
    hooks: area(JSON.stringify(e.hooks || {}, null, 2), 12),
  };
  const status = h('div', { class: 'hint' }, `ID: ${e.id}  (스킬 효과에서 status 로 이 ID를 사용)`);
  const aiBtn = h('button', { class: 'btn ai', type: 'button' }, '✦ AI로 구현');
  aiBtn.addEventListener('click', () => {
    if (!f.desc.value.trim()) return toast('효과 설명을 입력하세요.', 'error');
    if (!aiAvailable()) return toast('AI 중계 서버가 설정되지 않아 AI를 사용할 수 없습니다.', 'error');
    busy(aiBtn, generateEffect({ kind: f.kind.value, name: f.name.value, description: f.desc.value, existing: lib.effects }).then(({ effect, errors }) => {
      if (!f.name.value && effect.name) f.name.value = effect.name;
      if (effect.color) f.color.value = effect.color;
      e.turnOnly = !!effect.turnOnly;
      f.hooks.value = JSON.stringify(effect.hooks || {}, null, 2);
      if (effect.desc) e.aiDesc = effect.desc;
      toast(errors.length ? `검증 오류: ${errors.join(' / ')}` : 'AI 구현 완료 — 코드가 검증되었습니다.', errors.length ? 'error' : 'ok');
    }).catch((err) => toast(err.message, 'error')));
  });
  const checkBtn = h('button', { class: 'btn', type: 'button' }, '코드 검증');
  checkBtn.addEventListener('click', async () => {
    try {
      const errs = await sandbox.call('validate', { hooks: JSON.parse(f.hooks.value || '{}') });
      toast(errs.length ? errs.join(' / ') : '문제 없음 ✓', errs.length ? 'error' : 'ok');
    } catch (err) { toast(`JSON 오류: ${err.message}`, 'error'); }
  });
  const body = h('div', { class: 'editor' },
    overrideNote(orig),
    h('div', { class: 'grid3' }, field('종류', f.kind), field('이름', f.name), field('색상', f.color)),
    field('효과 설명 (자연어)', f.desc, '원하는 효과를 자유롭게 적으면 AI가 전투 엔진에서 실제로 동작하는 코드로 구현합니다.'),
    h('div', { class: 'row' }, aiBtn, checkBtn), status,
    field('구현 코드 (훅 → JS 본문)', f.hooks, '고급: 직접 수정할 수 있습니다. 코드는 격리된 샌드박스에서만 실행됩니다.'));
  const actions = editActions(orig);
  const r = await modal(orig ? `효과 편집 — ${orig.name}` : '새 키워드 / 패시브', body, actions);
  if (r === 'delete') { await deleteItem('effect', e.id); toast(orig.base ? '원래대로 되돌렸습니다.' : '삭제했습니다.'); return; }
  if (r !== 'save' && r !== 'copy') return;
  const asCopy = r === 'copy';
  let hooks;
  try { hooks = JSON.parse(f.hooks.value || '{}'); } catch (err) { toast(`JSON 오류: ${err.message}`, 'error'); return; }
  const errs = await sandbox.call('validate', { hooks });
  if (errs.length) { toast(`코드 오류로 저장하지 않았습니다: ${errs.join(' / ')}`, 'error', 6000); return; }
  Object.assign(e, { kind: f.kind.value, name: f.name.value.trim() || '이름 없음', color: f.color.value, desc: f.desc.value.trim(), hooks });
  if (asCopy) asNewCopy(e, orig, 'ef');
  try { await saveItem('effect', e); toast('저장했습니다.', 'ok'); } catch (err) { toast(`저장 실패: ${err.message}`, 'error'); }
}

export { editCharacter, editSkill, editEffect, getSkill };
