// Battle setup + arena + event playback.
import { h, toast } from './dom.js';
import { lib, getChar, getSkill, saveItem, onLibChange } from '../library.js';
import { sandbox } from '../sandbox.js';
import { settings } from '../store.js';
import { playVfx, defaultVfx, shoutText, popNumber, shake, SIN_COLORS } from '../vfx.js';
import { generateVfx, aiAvailable } from '../ai.js';
import { portrait } from './editors.js';
import { startRecording, stopRecording, isRecording, recorderSupported, recorderMode, downloadVideo, onRecorderChange } from '../recorder.js';

const MAX_TEAM = 5;
const pick = { ally: [], enemy: [] };
let B = null; // { view, plan, skillsMap, effectsMap, playing, selected }
const vfxCache = loadVfxCache();
let lastVideo = null; // Blob of the most recent recording

// keep the setup screen in sync with the library (new / edited characters)
onLibChange(() => { if (!B && document.getElementById('tab-battle')) renderSetup(); });

onRecorderChange((recording, blob) => {
  if (blob) { lastVideo = blob; if (B) B.video = blob; }
  renderRecCtl();
  if (blob && B && B.view.result) renderArena();
  if (blob && !B) renderSetup();
});

function loadVfxCache() { try { return JSON.parse(localStorage.getItem('lbs.vfxcache') || '{}'); } catch { return {}; } }
function saveVfxCache() { try { localStorage.setItem('lbs.vfxcache', JSON.stringify(vfxCache)); } catch { /* full */ } }

const root = () => document.getElementById('tab-battle');
const wait = (ms) => new Promise((r) => setTimeout(r, ms / (settings.get().speed || 1)));
const statusName = (id) => (sandbox.builtins || []).find((b) => b.id === id)?.name || lib.effects.find((e) => e.id === id)?.name || id;
const statusColor = (id) => (sandbox.builtins || []).find((b) => b.id === id)?.color || lib.effects.find((e) => e.id === id)?.color || '#999';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function renderSetup() {
  if (B && isRecording()) stopRecording();
  B = null;
  if (!pick.ally.length) pick.ally = lib.characters.filter((c) => !c.id.startsWith('en_')).slice(0, 3).map((c) => c.id);
  if (!pick.enemy.length) pick.enemy = lib.characters.filter((c) => c.id.startsWith('en_')).slice(0, 2).map((c) => c.id);
  pick.ally = pick.ally.filter(getChar); pick.enemy = pick.enemy.filter(getChar);
  const col = (team, title) => h('div', { class: `setup-col ${team}` },
    h('h3', {}, `${title} (${pick[team].length}/${MAX_TEAM})`),
    h('div', { class: 'picked' }, pick[team].map((id, i) => {
      const c = getChar(id);
      return h('button', { class: 'pick-chip', title: '빼기', onclick: () => { pick[team].splice(i, 1); renderSetup(); } }, portrait(c, 'portrait tiny'), c.name, ' ✕');
    })),
    h('div', { class: 'card-grid compact' }, lib.characters.map((c) => h('button', {
      class: 'item-card', onclick: () => { if (pick[team].length < MAX_TEAM) { pick[team].push(c.id); renderSetup(); } else toast(`최대 ${MAX_TEAM}명까지 가능합니다.`); },
    }, portrait(c), h('div', { class: 'item-info' }, h('div', { class: 'item-title' }, h('small', {}, c.title || ''), ' ', c.name), h('div', { class: 'item-sub' }, `HP ${c.maxHp}`))))));
  root().replaceChildren(
    h('div', { class: 'list-head' }, h('h2', {}, '전투 준비'),
      h('div', { class: 'row' },
        lastVideo ? h('button', { class: 'btn', onclick: () => downloadVideo(lastVideo) }, '🎬 직전 전투 영상 다운로드') : null,
        h('label', { class: 'check rec-check', title: '대상 지정과 스킬 선택을 자동으로 하고, 끝날 때까지 턴을 진행합니다.' },
          autoCheck(), ' 자동 전투'),
        h('label', { class: 'check rec-check', title: recorderSupported() ? '전투 화면을 녹화해 끝난 뒤 영상으로 받을 수 있습니다.' : '이 브라우저는 녹화를 지원하지 않습니다.' },
          recCheck(), ' 전투를 영상으로 녹화'),
        h('button', { class: 'btn primary big', disabled: !pick.ally.length || !pick.enemy.length, onclick: startBattle }, '전투 시작 ▶'))),
    h('div', { class: 'setup' }, col('ally', '아군'), col('enemy', '적군')));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function autoCheck() {
  const cb = h('input', { type: 'checkbox', checked: !!settings.get().autoBattle });
  cb.addEventListener('change', () => settings.set({ autoBattle: cb.checked }));
  return cb;
}

function recCheck() {
  const cb = h('input', { type: 'checkbox', checked: !!settings.get().recordBattle && recorderSupported(), disabled: !recorderSupported() });
  cb.addEventListener('change', () => settings.set({ recordBattle: cb.checked }));
  return cb;
}

/** Start recording (must run inside the click handler, before other awaits). */
async function beginRecording() {
  try {
    await startRecording(root());
    toast('녹화를 시작했습니다. 전투가 끝나면 영상을 다운로드할 수 있습니다.', 'ok');
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? '녹화가 취소되었습니다.' : `녹화를 시작할 수 없습니다: ${e.message}`, 'error');
  }
}

function renderRecCtl() {
  const el = document.getElementById('rec-ctl');
  if (!el || !B) return;
  const kids = [];
  if (isRecording()) {
    kids.push(h('span', { class: 'rec-dot' }, 'REC'),
      h('button', { class: 'btn small', onclick: () => stopRecording() }, '■ 녹화 중지'));
  } else if (recorderSupported() && !B.view.result) {
    kids.push(h('button', { class: 'btn small', onclick: beginRecording }, '● 녹화'));
  }
  if (!isRecording() && B.video) kids.push(h('button', { class: 'btn small primary', onclick: () => downloadVideo(B.video) }, '🎬 영상 다운로드'));
  el.replaceChildren(...kids);
}

async function startBattle() {
  const wantRec = settings.get().recordBattle && recorderSupported() && !isRecording();
  // tab capture must start inside the click; canvas recording starts once the arena exists
  if (wantRec && recorderMode() === 'screen') await beginRecording();
  const allies = pick.ally.map(getChar).map((c) => structuredClone(c));
  const enemies = pick.enemy.map(getChar).map((c) => structuredClone(c));
  const skillsMap = {}; for (const s of lib.skills) skillsMap[s.id] = s;
  const effectsMap = {}; for (const e of lib.effects) effectsMap[e.id] = { id: e.id, name: e.name, color: e.color, kind: e.kind, turnOnly: !!e.turnOnly, desc: e.desc, hooks: e.hooks || {} };
  const strip = (c) => { const o = { ...c }; delete o.image; delete o.source; return o; };
  const skillsForEngine = {}; for (const [k, s] of Object.entries(skillsMap)) { const o = { ...s }; delete o.image; delete o.vfx; delete o.source; skillsForEngine[k] = o; }
  const r = await sandbox.call('create', { allies: allies.map(strip), enemies: enemies.map(strip), skills: skillsForEngine, effects: effectsMap, seed: (Math.random() * 2 ** 31) | 0 });
  B = { view: r.view, plan: {}, chars: Object.fromEntries([...allies, ...enemies].map((c) => [c.id, c])), selected: null, playing: false, log: [], video: null, auto: !!settings.get().autoBattle };
  renderArena();
  if (wantRec && recorderMode() === 'canvas') await beginRecording();
  prefetchVfx([...allies, ...enemies]);
  await playEvents(r.events);
  await nextTurn();
}

/** VFX AI: generate VFX for skills in this battle that have none (background). */
function prefetchVfx(chars) {
  const s = settings.get();
  if (!s.autoVfx || !aiAvailable()) return;
  const ids = new Set();
  for (const c of chars) { for (const x of c.skills || []) ids.add(x.id); if (c.defense) ids.add(c.defense); }
  const todo = [...ids].map(getSkill).filter((sk) => sk && !sk.vfx && !vfxCache[sk.id]);
  if (!todo.length) return;
  addLog(`✦ VFX AI가 ${todo.length}개 스킬의 연출을 생성합니다…`, 'sys');
  let active = 0; let i = 0;
  const run = () => {
    while (active < 1 && i < todo.length) {
      const sk = todo[i++]; active++;
      generateVfx({ skill: sk }).then(async (spec) => {
        vfxCache[sk.id] = spec; saveVfxCache();
        if (sk.source === 'user') { try { await saveItem('skill', { ...sk, vfx: spec }); } catch { /* ignore */ } }
        addLog(`✦ VFX 생성 완료: ${sk.name}`, 'sys');
      }).catch((e) => addLog(`VFX 생성 실패 (${sk.name}): ${e.message}`, 'sys')).finally(() => { active--; run(); });
    }
  };
  run();
}

// ---------------------------------------------------------------------------
// Arena rendering
// ---------------------------------------------------------------------------
function unitEl(uid) { return document.querySelector(`.unit[data-uid="${uid}"]`); }
function unitView(uid) { return B.view.units.find((u) => u.uid === uid); }
function charOf(u) { return B.chars[u.charId] || getChar(u.charId) || {}; }

function renderArena() {
  const v = B.view;
  root().replaceChildren(
    h('div', { id: 'arena', class: B.selected ? 'targeting' : '' },
      h('div', { class: 'arena-top' },
        h('div', { class: 'turn-label' }, `TURN ${v.turn}`),
        h('button', { class: `btn small auto-btn ${B.auto ? 'active' : ''}`, 'aria-pressed': B.auto ? 'true' : 'false', disabled: !!v.result, onclick: toggleAuto }, B.auto ? '⏸ 자동 전투 중' : '▶ 자동 전투'),
        h('div', { id: 'rec-ctl', class: 'rec-ctl' }),
        h('div', { class: 'speed-ctl' }, '속도 ', [1, 2, 4].map((sp) => h('button', { class: `btn small ${settings.get().speed === sp ? 'active' : ''}`, onclick: () => { settings.set({ speed: sp }); renderArena(); } }, `x${sp}`))),
        h('button', { class: 'btn small', onclick: () => { if (!B.playing || confirm('전투를 포기하고 나갈까요?')) renderSetup(); } }, '나가기')),
      h('div', { class: 'row-units enemy' }, v.units.filter((u) => u.team === 'enemy').map(renderUnit)),
      h('div', { id: 'clash-stage', class: 'hidden' }),
      h('div', { class: 'row-units ally' }, v.units.filter((u) => u.team === 'ally').map(renderUnit)),
      h('div', { class: 'arena-actions' },
        h('button', { class: 'btn', disabled: B.playing || B.auto || !!v.result, onclick: autoPlan }, '자동 지정'),
        h('button', { class: 'btn primary big', disabled: B.playing || B.auto || !!v.result, onclick: resolve }, B.auto ? '자동 진행 중…' : '전투 개시 ⚔'))),
    h('div', { id: 'battle-log' }, (logQueue = [], B.log.map((l) => h('div', { class: `log ${l.cls}` }, l.text)))),
    v.result ? h('div', { class: `result-banner ${v.result}` }, v.result === 'win' ? '승리' : '패배',
      h('div', { class: 'row' },
        isRecording() ? h('button', { class: 'btn', disabled: true }, '영상 마무리 중…') : null,
        B.video ? h('button', { class: 'btn', onclick: () => downloadVideo(B.video) }, '🎬 전투 영상 다운로드') : null,
        h('button', { class: 'btn primary', onclick: renderSetup }, '다시 하기'))) : null);
  const logEl = document.getElementById('battle-log'); logEl.scrollTop = logEl.scrollHeight;
  renderRecCtl();
}

function renderUnit(u) {
  const c = charOf(u);
  const hpPct = Math.max(0, (u.hp / u.maxHp) * 100);
  const marks = (u.thresholds || []).map((t) => h('i', { class: 'stg-mark', style: { left: `${(t / u.maxHp) * 100}%` } }));
  const intent = u.team === 'enemy' ? B.view.enemyActions.find((a) => a.uid === u.uid) : null;
  const plan = B.plan[u.uid];
  const el = h('div', {
    class: `unit ${u.team} ${u.dead ? 'dead' : ''} ${u.staggered ? 'staggered' : ''} ${B.selected === u.uid ? 'selected' : ''}`,
    'data-uid': u.uid,
    onclick: () => onUnitClick(u),
  },
  h('div', { class: 'speed-die', title: '속도' }, u.dead ? '✝' : u.staggered ? '—' : u.speed),
  portrait(c, 'portrait unit-img'),
  h('div', { class: 'unit-name' }, h('small', {}, c.title || ''), ' ', u.name),
  (c.passives || []).length ? h('div', { class: 'passives' }, c.passives.map((pid) => {
    const pv = lib.effects.find((e) => e.id === pid);
    return pv ? h('span', { class: 'passive-chip', style: { '--c': pv.color || '#ffb347' }, title: pv.desc || '' }, '◆ ', pv.name) : null;
  })) : null,
  h('div', { class: 'hpbar' }, h('div', { class: 'hpfill', style: { width: `${hpPct}%` } }), marks, h('span', { class: 'hptext' }, `${u.hp} / ${u.maxHp}`)),
  h('div', { class: 'spbar', title: '정신력' }, h('div', { class: `spfill ${u.sp < 0 ? 'neg' : ''}`, style: { width: `${Math.abs(u.sp) / 45 * 50}%`, left: u.sp < 0 ? `${50 - Math.abs(u.sp) / 45 * 50}%` : '50%' } }), h('span', { class: 'sptext' }, `SP ${u.sp}`)),
  h('div', { class: 'statuses' }, Object.entries(u.statuses).map(([id, s]) => statusChip(id, s.potency, s.count))),
  u.staggered ? h('div', { class: 'stg-label' }, ['', '흐트러짐', '흐트러짐+', '흐트러짐++'][u.staggered]) : null,
  intent ? h('div', { class: 'intent' }, skillBadge(getSkill(intent.skillId)), ' → ', targetText(u, getSkill(intent.skillId), intent.targetUid)) : null,
  u.team === 'ally' && !u.dead && !u.staggered && !B.view.result ? handEl(u) : null,
  plan ? h('div', { class: 'intent mine' }, skillBadge(getSkill(plan.skillId)), plan.targetUid ? ` → ${targetText(u, getSkill(plan.skillId), plan.targetUid)}` : ' (방어)') : null);
  return el;
}

/** Same rule as the engine: main target + the next (weight-1) living enemies in row order. */
function weightTargetsView(attacker, skill, targetUid) {
  const w = Math.max(1, Math.min(10, Math.round(skill?.weight || 1)));
  const foes = B.view.units.filter((x) => x.team !== attacker.team && !x.dead);
  const i = foes.findIndex((x) => x.uid === targetUid);
  if (i < 0) return [];
  const out = [];
  for (let k = 1; out.length < w - 1 && k < foes.length; k++) out.push(foes[(i + k) % foes.length]);
  return out;
}

function targetText(attacker, skill, targetUid) {
  const main = unitView(targetUid)?.name || '?';
  const extra = weightTargetsView(attacker, skill, targetUid);
  return extra.length ? `${main} 외 ${extra.length}명 (${extra.map((x) => x.name).join(', ')})` : main;
}

function statusChip(id, potency, count) {
  return h('span', { class: 'status-chip', style: { '--c': statusColor(id) }, title: statusName(id) }, statusName(id), h('b', {}, ` ${potency}`), count ? h('i', {}, `/${count}`) : null);
}

function skillBadge(s) {
  if (!s) return h('span', {}, '?');
  return h('span', { class: 'skill-badge', style: { '--c': SIN_COLORS[s.sin] || '#888' } }, s.name);
}

function handEl(u) {
  const opts = [...new Set(u.hand)];
  if (u.defense) opts.push(u.defense);
  return h('div', { class: 'hand' }, opts.map((id) => {
    const s = getSkill(id);
    if (!s) return null;
    const chosen = B.plan[u.uid]?.skillId === id;
    return h('button', {
      class: `skill-card ${chosen ? 'chosen' : ''} ${s.type !== 'attack' ? 'def' : ''}`,
      style: { '--c': SIN_COLORS[s.sin] || '#888' },
      title: s.desc || '',
      disabled: B.playing,
      onclick: (e) => { e.stopPropagation(); chooseSkill(u, s); },
    },
    s.image ? h('img', { src: s.image, alt: '' }) : null,
    h('span', { class: 'sc-name' }, s.name),
    h('span', { class: 'sc-pow' }, `${s.basePower}${s.coinPower >= 0 ? '+' : ''}${s.coinPower}×${s.coinCount}`,
      (s.weight || 1) > 1 ? h('b', { class: 'sc-weight', title: `공격 가중치 ${s.weight}: 적 ${s.weight}명을 함께 공격` }, ` ⚖${s.weight}`) : null),
    h('span', { class: 'sc-type' }, { attack: '', guard: '🛡', evade: '💨', counter: '↺' }[s.type] || ''));
  }));
}

function chooseSkill(u, s) {
  if (s.type === 'guard' || s.type === 'evade') {
    B.plan[u.uid] = { uid: u.uid, skillId: s.id, targetUid: null };
    B.selected = null;
  } else {
    const prevTarget = B.plan[u.uid]?.targetUid;
    B.plan[u.uid] = { uid: u.uid, skillId: s.id, targetUid: prevTarget || null };
    B.selected = u.uid;
    toast(`${s.name}: 대상으로 삼을 적을 클릭하세요.`);
  }
  renderArena();
}

function onUnitClick(u) {
  if (B.playing || !B.selected || u.team !== 'enemy' || u.dead) return;
  B.plan[B.selected].targetUid = u.uid;
  B.selected = null;
  renderArena();
}

const maxPower = (sk) => (sk ? (sk.basePower || 0) + Math.max(0, sk.coinPower || 0) * (sk.coinCount || 1) : 0);

/**
 * Pick a skill and a target for one ally, Limbus style:
 * clash the enemy that targets this unit with the strongest skill (or defend when
 * nearly dead and clearly outmatched); otherwise focus a staggered / low-HP enemy.
 */
function smartPlan(u, enemies) {
  const hand = [...new Set(u.hand)].map(getSkill).filter((x) => x && x.type !== 'guard' && x.type !== 'evade');
  const threats = B.view.enemyActions.filter((a) => a.targetUid === u.uid && !unitView(a.uid)?.dead);
  const threat = threats.sort((x, y) => maxPower(getSkill(y.skillId)) - maxPower(getSkill(x.skillId)))[0];
  const score = (sk) => maxPower(sk) * Math.min(Math.max(1, sk.weight || 1), enemies.length) + (sk.offLevel || 0);
  const best = hand.sort((x, y) => score(y) - score(x))[0];
  if (threat) {
    const tPow = maxPower(getSkill(threat.skillId));
    const def = u.defense && getSkill(u.defense);
    if (def && u.hp / u.maxHp < 0.3 && tPow > maxPower(best) + 3) return { uid: u.uid, skillId: def.id, targetUid: null };
    if (best) return { uid: u.uid, skillId: hand.sort((x, y) => maxPower(y) - maxPower(x))[0].id, targetUid: threat.uid };
  }
  if (!best) return null;
  const target = [...enemies].sort((x, y) => (y.staggered - x.staggered) || (x.hp - y.hp))[0];
  return target ? { uid: u.uid, skillId: best.id, targetUid: target.uid } : null;
}

function autoPlan() {
  const enemies = B.view.units.filter((u) => u.team === 'enemy' && !u.dead);
  for (const u of B.view.units.filter((x) => x.team === 'ally' && !x.dead && !x.staggered)) {
    const p = B.plan[u.uid];
    if (p && (p.targetUid || ['guard', 'evade'].includes(getSkill(p.skillId)?.type))) continue;
    const plan = smartPlan(u, enemies);
    if (plan) B.plan[u.uid] = plan;
  }
  B.selected = null;
  renderArena();
}

function toggleAuto() {
  if (!B) return;
  B.auto = !B.auto;
  settings.set({ autoBattle: B.auto });
  renderArena();
  if (B.auto) scheduleAuto();
}

/** In auto battle, plan and resolve the turn on its own. */
function scheduleAuto() {
  const cur = B;
  setTimeout(() => {
    if (B !== cur || !B.auto || B.playing || B.view.result) return;
    autoPlan();
    resolve();
  }, 500 / (settings.get().speed || 1));
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
async function nextTurn() {
  if (B.view.result) return;
  const r = await sandbox.call('begin');
  B.view = r.view; B.plan = {}; B.selected = null;
  await playEvents(r.events);
  B.view = r.view;
  renderArena();
  if (B.auto) scheduleAuto();
}

async function resolve() {
  if (B.playing) return;
  const ready = B.view.units.filter((u) => u.team === 'ally' && !u.dead && !u.staggered);
  const missing = ready.filter((u) => !B.plan[u.uid] || (!B.plan[u.uid].targetUid && !['guard', 'evade'].includes(getSkill(B.plan[u.uid].skillId)?.type)));
  if (missing.length) { autoPlan(); if (!B.auto) toast('지정하지 않은 아군은 자동으로 지정했습니다.'); }
  const actions = Object.values(B.plan);
  B.playing = true; renderArena();
  try {
    const r = await sandbox.call('resolve', actions);
    await playEvents(r.events);
    B.view = r.view;
  } catch (e) { toast(`엔진 오류: ${e.message}`, 'error'); }
  B.playing = false;
  renderArena();
  if (!B.view.result) await nextTurn();
  else {
    shoutText(B.view.result === 'win' ? '승리' : '패배', B.view.result === 'win' ? '#ffd166' : '#ff3355', { big: true, ms: 2600 });
    if (isRecording()) {
      // keep the victory/defeat effect in the video, then finish the file
      const cur = B;
      setTimeout(async () => { const blob = await stopRecording(); if (blob && B === cur) { B.video = blob; renderArena(); } }, 3000);
    }
  }
}

// ---------------------------------------------------------------------------
// Event playback
// ---------------------------------------------------------------------------
let logQueue = []; let logRaf = 0;
function addLog(text, cls = '') {
  if (!B) return;
  B.log.push({ text, cls });
  if (B.log.length > 300) B.log.shift();
  // append in one batch per frame: each append + scroll forces a layout
  logQueue.push({ text, cls });
  if (!logRaf) logRaf = requestAnimationFrame(flushLog);
}
function flushLog() {
  logRaf = 0;
  const el = document.getElementById('battle-log');
  const items = logQueue; logQueue = [];
  if (!el || !items.length) return;
  el.append(...items.map((l) => h('div', { class: `log ${l.cls}` }, l.text)));
  while (el.childElementCount > 300) el.firstElementChild.remove();
  el.scrollTop = el.scrollHeight;
}

// Write to the DOM only when a value really changed (each write costs style/layout work,
// and marks the frame dirty for the phone recorder).
function setText(el, v) { const t = String(v); if (el && el.textContent !== t) el.textContent = t; }
function setStyle(el, k, v) { if (el && el.style[k] !== v) el.style[k] = v; }

function applySnapshot(s) {
  if (!s) return;
  for (const [uid, st] of Object.entries(s)) {
    const u = unitView(uid);
    if (!u) continue;
    u.hp = st.hp; u.sp = st.sp; u.staggered = st.stg; u.dead = st.dead; u.speed = st.spd;
    const stKey = JSON.stringify(st.st);
    const statusChanged = u._stKey !== stKey;
    if (statusChanged) {
      u._stKey = stKey;
      u.statuses = Object.fromEntries(Object.entries(st.st).map(([k, [p, c]]) => [k, { potency: p, count: c }]));
    }
    const el = unitEl(uid);
    if (!el) continue;
    if (el.classList.contains('dead') !== !!u.dead) el.classList.toggle('dead', u.dead);
    if (el.classList.contains('staggered') !== !!u.staggered) el.classList.toggle('staggered', !!u.staggered);
    setStyle(el.querySelector('.hpfill'), 'width', `${Math.max(0, (u.hp / u.maxHp) * 100)}%`);
    setText(el.querySelector('.hptext'), `${u.hp} / ${u.maxHp}`);
    const sp = el.querySelector('.spfill');
    if (sp.classList.contains('neg') !== u.sp < 0) sp.classList.toggle('neg', u.sp < 0);
    setStyle(sp, 'width', `${Math.abs(u.sp) / 45 * 50}%`);
    setStyle(sp, 'left', u.sp < 0 ? `${50 - Math.abs(u.sp) / 45 * 50}%` : '50%');
    setText(el.querySelector('.sptext'), `SP ${u.sp}`);
    setText(el.querySelector('.speed-die'), u.dead ? '✝' : u.staggered ? '—' : u.speed);
    const box = el.querySelector('.statuses');
    if (statusChanged || box.dataset.k !== stKey) {
      box.dataset.k = stKey;
      box.replaceChildren(...Object.entries(u.statuses).map(([id, x]) => statusChip(id, x.potency, x.count)));
    }
  }
}

/** Fire user-defined shake messages for a trigger. */
function messagesFor(uid, skillId, trigger) {
  const u = unitView(uid); if (!u) return;
  const c = charOf(u); const s = getSkill(skillId);
  const list = [...(s?.messages || []), ...(c.messages || [])].filter((m) => m.trigger === trigger && m.text);
  if (!list.length) return;
  const m = list[Math.floor(Math.random() * list.length)];
  const el = unitEl(uid);
  const r = el ? el.getBoundingClientRect() : null;
  shoutText(m.text, m.color, r ? { x: r.left + r.width / 2, y: r.top + (u.team === 'enemy' ? r.height + 10 : -20) } : {});
}

function skillVfx(skill, strong) {
  return skill.vfx || vfxCache[skill.id] || defaultVfx(skill, strong);
}

function clashPanel(side, uid, skillId) {
  const u = unitView(uid); const s = getSkill(skillId) || {};
  return h('div', { class: `clash-side ${side}`, style: { '--c': SIN_COLORS[s.sin] || '#888' }, 'data-uid': uid },
    s.image ? h('img', { class: 'clash-img', src: s.image, alt: '' }) : portrait(charOf(u), 'portrait clash-img'),
    h('div', { class: 'clash-skill' }, s.name || '?'),
    h('div', { class: 'clash-meta' }, `${u?.name || ''} · ${s.basePower}${s.coinPower >= 0 ? '+' : ''}${s.coinPower}`),
    h('div', { class: 'clash-power' }, s.basePower ?? 0),
    h('div', { class: 'coins' }, Array.from({ length: s.coinCount || 1 }, () => h('i', { class: 'coin' }))));
}

async function playEvents(events) {
  B.playing = true;
  const stage = () => document.getElementById('clash-stage');
  let lastHitBy = {};
  let clash = null;
  for (const ev of events) {
    switch (ev.type) {
      case 'turnStart':
        applySnapshot(ev.s);
        addLog(`── 턴 ${ev.turn} ──`, 'turn');
        break;
      case 'clashStart': {
        applySnapshot(ev.s);
        const st = stage(); if (!st) break;
        clash = { a: ev.a, b: ev.b, sa: ev.sa, sb: ev.sb };
        st.classList.remove('hidden');
        st.replaceChildren(clashPanel('left', ev.a, ev.sa), h('div', { class: 'vs' }, ev.defense ? { guard: '수비', evade: '회피', counter: '반격' }[ev.defense] : 'VS'), clashPanel('right', ev.b, ev.sb));
        unitEl(ev.a)?.classList.add('clashing'); unitEl(ev.b)?.classList.add('clashing');
        addLog(`⚔ ${unitView(ev.a)?.name}「${getSkill(ev.sa)?.name}」 vs ${unitView(ev.b)?.name}「${getSkill(ev.sb)?.name}」`, 'clash');
        messagesFor(ev.a, ev.sa, 'skillUse'); messagesFor(ev.a, ev.sa, 'clashStart');
        await wait(350);
        messagesFor(ev.b, ev.sb, 'clashStart');
        await wait(550);
        break;
      }
      case 'clashRound': {
        const st = stage(); if (!st) break;
        for (const side of ['a', 'b']) {
          const d = ev[side];
          const panel = st.querySelector(`.clash-side[data-uid="${d.uid}"]`);
          if (!panel) continue;
          const pw = panel.querySelector('.clash-power');
          pw.textContent = d.power; pw.classList.remove('bump'); void pw.offsetWidth; pw.classList.add('bump');
          const coins = panel.querySelectorAll('.coin');
          coins.forEach((c) => { c.className = 'coin'; });
          // mark flips on the remaining coins, broken coins at the end
          const broken = coins.length - d.coins;
          coins.forEach((c, i) => {
            if (i >= coins.length - broken) c.classList.add('broken');
            else if (d.flips[i] != null) c.classList.add(d.flips[i] ? 'heads' : 'tails', 'flip');
          });
          panel.classList.toggle('win', ev.winner === d.uid);
          panel.classList.toggle('lose', ev.winner && ev.winner !== d.uid);
        }
        shake(ev.round > 3 ? 7 : 4, 160);
        playVfx({ layers: [{ type: 'sparks', color: '#ffe9a8', count: 22, speed: 13, life: 300 }, { type: 'ring', color: '#ffffff', radius: 70, width: 4, life: 250 }] }, st.querySelector('.vs'));
        await wait(Math.max(260, 560 - ev.round * 40));
        break;
      }
      case 'clashEnd': {
        const st = stage();
        const w = unitView(ev.winner);
        addLog(`  ▶ ${w?.name} 합 승리 (합 ${ev.count}회)`, 'win');
        st?.querySelector(`.clash-side[data-uid="${ev.winner}"]`)?.classList.add('winner');
        messagesFor(ev.winner, ev.skill, 'clashWin');
        messagesFor(ev.loser, clash ? (ev.loser === clash.a ? clash.sa : clash.sb) : null, 'clashLose');
        await wait(650);
        st?.classList.add('hidden');
        unitEl(ev.winner)?.classList.remove('clashing'); unitEl(ev.loser)?.classList.remove('clashing');
        break;
      }
      case 'oneSided': {
        addLog(`➤ ${unitView(ev.att)?.name}「${getSkill(ev.skill)?.name}」 → ${unitView(ev.def)?.name} (일방 공격)`, 'clash');
        messagesFor(ev.att, ev.skill, 'skillUse');
        unitEl(ev.att)?.classList.add('lunge');
        await wait(380);
        unitEl(ev.att)?.classList.remove('lunge');
        break;
      }
      case 'multiTarget': {
        const names = ev.targets.map((id) => unitView(id)?.name).join(', ');
        addLog(`  ⚖ 가중치 ${ev.targets.length}: ${names} 동시 공격`, 'sys');
        for (const id of ev.targets) unitEl(id)?.classList.add('weight-hit');
        setTimeout(() => ev.targets.forEach((id) => unitEl(id)?.classList.remove('weight-hit')), 900 / (settings.get().speed || 1));
        break;
      }
      case 'redirect':
        addLog(`  ↻ ${unitView(ev.unit)?.name}의 공격이 ${unitView(ev.to)?.name}에게 끌려갔다 (속도 우위)`, 'sys');
        break;
      case 'hit': {
        const sk = getSkill(ev.skill) || {};
        const defEl = unitEl(ev.def); const attEl = unitEl(ev.att);
        lastHitBy[ev.def] = { att: ev.att, skill: ev.skill };
        attEl?.classList.add('lunge');
        const dir = unitView(ev.att)?.team === 'ally' ? -1 : 1;
        playVfx(skillVfx(sk, ev.crit || ev.coin === (sk.coinCount || 1) - 1), defEl, dir);
        applySnapshot(ev.s);
        if (ev.damage > 0) popNumber(defEl, `${ev.damage}${ev.crit ? '!' : ''}`, `${ev.crit ? 'crit' : ''} res-${ev.res}`);
        else popNumber(defEl, ev.absorbed ? `막음 ${ev.absorbed}` : '0', 'blocked');
        if (ev.res !== '보통') popNumber(defEl, ev.res, `res-label res-${ev.res}`);
        addLog(`  · 코인${ev.coin + 1} ${ev.heads ? '앞' : '뒤'} 위력 ${ev.power} → ${ev.damage} 피해 (x${ev.mult}${ev.crit ? ', 치명타' : ''}, ${ev.res})`, 'hit');
        await wait(420);
        attEl?.classList.remove('lunge');
        break;
      }
      case 'damage':
        if (ev.label && ev.src == null) {
          applySnapshot(ev.s);
          popNumber(unitEl(ev.unit), `${ev.amount}`, 'dot');
          addLog(`  ${unitView(ev.unit)?.name}: ${ev.label} 피해 ${ev.amount}`, 'dot');
          await wait(260);
        } else applySnapshot(ev.s);
        break;
      case 'heal':
        applySnapshot(ev.s);
        popNumber(unitEl(ev.unit), `+${ev.amount}`, 'heal');
        break;
      case 'sp':
        applySnapshot(ev.s);
        break;
      case 'status':
        applySnapshot(ev.s);
        addLog(`  ${unitView(ev.unit)?.name}: ${ev.name || statusName(ev.status)} ${ev.potency}${ev.count ? `/${ev.count}` : ''}${ev.next ? ' (다음 턴)' : ''}`, 'status');
        break;
      case 'tremorBurst':
        applySnapshot(ev.s);
        playVfx({ shake: 8, layers: [{ type: 'ring', color: '#e8d27a', radius: 160, width: 10, life: 500 }, { type: 'glyph', text: '진동', color: '#ffe9a8', size: 54, life: 600 }] }, unitEl(ev.unit));
        addLog(`  ${unitView(ev.unit)?.name}: 진동 폭발! (역치 +${ev.amount})`, 'status');
        await wait(350);
        break;
      case 'stagger': {
        applySnapshot(ev.s);
        const el = unitEl(ev.unit);
        playVfx({ shake: 14, flash: '#ffffff', layers: [{ type: 'shards', color: '#ffe066', count: 26, size: 12, speed: 10, life: 900 }, { type: 'glyph', text: '흐트러짐', color: '#ffe066', size: 64, life: 900 }] }, el);
        addLog(`  ★ ${unitView(ev.unit)?.name} 흐트러짐!`, 'stagger');
        const by = lastHitBy[ev.unit]; if (by) messagesFor(by.att, by.skill, 'stagger');
        await wait(600);
        break;
      }
      case 'staggerRecover':
        applySnapshot(ev.s);
        addLog(`  ${unitView(ev.unit)?.name} 흐트러짐 회복`, 'sys');
        break;
      case 'death': {
        applySnapshot(ev.s);
        playVfx({ shake: 12, layers: [{ type: 'burst', color: '#ffffff', count: 80, speed: 9, size: 3, life: 900 }, { type: 'ring', color: '#ff3355', radius: 240, width: 10, life: 700 }] }, unitEl(ev.unit));
        addLog(`  ✝ ${unitView(ev.unit)?.name} 사망`, 'death');
        const by = lastHitBy[ev.unit]; if (by) messagesFor(by.att, by.skill, 'kill');
        await wait(600);
        break;
      }
      case 'message': {
        shoutText(ev.text, ev.color);
        await wait(500);
        break;
      }
      case 'vfx':
        playVfx(ev.spec, ev.at ? unitEl(ev.at) : null);
        await wait(300);
        break;
      case 'log':
        addLog(ev.text, ev.error ? 'error' : '');
        break;
      case 'turnEnd':
        applySnapshot(ev.s);
        addLog(`턴 ${ev.turn} 종료`, 'turn');
        break;
      case 'end':
        addLog(ev.result === 'win' ? '=== 승리 ===' : '=== 패배 ===', 'turn');
        break;
      default:
        if (ev.s) applySnapshot(ev.s);
    }
  }
  B.playing = false;
}
