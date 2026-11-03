// AI integration: keyword / passive code generation, skill effects,
// VFX specs, and admin content generation.
//
// The site calls an OpenAI-compatible chat endpoint through the relay in
// worker/ai-proxy.js (CONFIG.aiProxyUrl), which holds the NVIDIA API key.
import { CONFIG } from './config.js';
import { sandbox } from './sandbox.js';

export function aiAvailable() { return !!CONFIG.aiProxyUrl; }

const FIRST_DATA_TIMEOUT = 20000; // NVIDIA free tier sometimes queues a request for minutes
const STALL_TIMEOUT = 60000;

/** Models to try, starting with the one that answered last time (busy models are skipped). */
function modelOrder() {
  const list = (CONFIG.aiModels && CONFIG.aiModels.length ? CONFIG.aiModels : [CONFIG.aiModel]).filter(Boolean);
  let last = null;
  try { last = sessionStorage.getItem('lbs.aiModel'); } catch { /* ignore */ }
  return last && list.includes(last) ? [last, ...list.filter((m) => m !== last)] : list;
}
function rememberModel(m) { try { sessionStorage.setItem('lbs.aiModel', m); } catch { /* ignore */ } }

class RetryableError extends Error {}

/**
 * Low-level call. Streams the reply (server-sent events) and returns its text.
 * onProgress({ phase: 'wait' | 'think' | 'write' | 'retry', secs, chars, attempt })
 */
export async function callAI({ system, messages, maxTokens = 16000, onProgress }) {
  if (!CONFIG.aiProxyUrl) throw new Error('AI 중계 서버 주소(js/config.js 의 aiProxyUrl)가 설정되지 않았습니다.');
  const started = Date.now();
  let lastErr = null;
  const models = modelOrder();
  for (let attempt = 1; attempt <= models.length; attempt++) {
    const model = models[attempt - 1];
    try {
      const text = await attemptAI({ model, system, messages, maxTokens, onProgress, started, attempt });
      rememberModel(model);
      return text;
    } catch (e) {
      if (!(e instanceof RetryableError)) throw e;
      lastErr = e;
      if (onProgress) onProgress({ phase: 'retry', secs: Math.round((Date.now() - started) / 1000), chars: 0, attempt });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${lastErr.message} AI 서버(NVIDIA 무료)가 혼잡합니다. 잠시 후 다시 시도해 주세요.`);
}

async function attemptAI({ model, system, messages, maxTokens, onProgress, started, attempt }) {
  const ctrl = new AbortController();
  const state = { phase: 'wait', chars: 0 };
  let lastData = Date.now();
  let timedOut = null;
  const tick = setInterval(() => {
    const now = Date.now();
    if (state.phase === 'wait' && now - lastData > FIRST_DATA_TIMEOUT) { timedOut = '응답 대기 시간이 초과됐습니다.'; ctrl.abort(); }
    else if (state.phase !== 'wait' && now - lastData > STALL_TIMEOUT) { timedOut = 'AI 응답이 멈췄습니다.'; ctrl.abort(); }
    if (onProgress) onProgress({ phase: state.phase, secs: Math.round((now - started) / 1000), chars: state.chars, attempt });
  }, 1000);
  try {
    let r;
    try {
      r = await fetch(CONFIG.aiProxyUrl, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          reasoning_effort: CONFIG.aiReasoning || 'low',
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
    } catch {
      if (timedOut) throw new RetryableError(timedOut);
      throw new Error('AI 중계 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
    if (!r.ok) {
      const text = await r.text();
      if (r.status === 429 || r.status >= 500) throw new RetryableError(`AI 오류 (${r.status}).`);
      throw new Error(`AI 오류 (${r.status}): ${text.slice(0, 200)}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let content = ''; let finish = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue; // ": ping" keep-alives from the relay
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch { continue; }
          if (j.error) {
            const st = j.error.status || 0;
            if (st === 429 || st >= 500 || st === 0) throw new RetryableError(`AI 오류 (${st || '연결'}).`);
            throw new Error(`AI 오류 (${st}): ${j.error.message || ''}`);
          }
          const ch = j.choices && j.choices[0];
          if (!ch) continue;
          lastData = Date.now();
          const d = ch.delta || {};
          if (d.content) { content += d.content; state.phase = 'write'; state.chars = content.length; } else if (state.phase === 'wait') state.phase = 'think';
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
    } catch (e) {
      if (e instanceof RetryableError || e.message.startsWith('AI 오류')) throw e;
      if (timedOut) throw new RetryableError(timedOut);
      throw new RetryableError('AI 응답을 받는 중 연결이 끊겼습니다.');
    }
    if (finish === 'length') throw new Error('AI 응답이 너무 길어 중간에 잘렸습니다. 요청을 나눠서 다시 시도해 주세요.');
    // some models wrap reasoning in <think> tags inside the content
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!content) throw new RetryableError('AI 응답이 비어 있습니다.');
    return content;
  } finally {
    clearInterval(tick);
  }
}

/** Button label for a progress update. */
export function progressLabel(p) {
  const t = `${p.secs}초`;
  if (p.phase === 'retry') return `서버 혼잡 — 다른 모델로 전환 중… ${t}`;
  if (p.phase === 'wait') return `AI 서버 대기 중… ${t}`;
  if (p.phase === 'think') return `AI가 구상 중… ${t}`;
  return `AI가 작성 중… ${p.chars}자 · ${t}`;
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  const open = src[start]; const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('AI 응답의 JSON이 완전하지 않습니다.');
}

// ---------------------------------------------------------------------------
// Shared rules text given to the model
// ---------------------------------------------------------------------------
const RULES = `
오래 고민하지 말고 핵심만 빠르게 판단해 바로 답하세요. 설명 없이 요청한 JSON만 출력합니다.
당신은 웹 전투 시뮬레이터의 콘텐츠 엔지니어입니다. 전투 규칙은 림버스 컴퍼니와 동일합니다:
- 스킬: 기본 위력(basePower) + 코인 위력(coinPower, 음수 가능) x 앞면 코인 수. 코인 개수(coinCount).
- 코인 앞면 확률 = 50% + 정신력(SP, -45~45)%.
- 합: 서로 위력을 굴려 낮은 쪽이 코인 1개를 잃음. 한 쪽 코인이 0이 될 때까지 반복. 공격 레벨이 3 높을 때마다 합 위력 +1.
- 합 승리 시 남은 코인으로 공격. 코인마다 위력이 누적되어 타격.
- 피해 배율 = 1 + (물리 내성-1) + (죄악 내성-1) + (공격레벨-방어레벨)/(|차이|+25) + 합 횟수 x3%(최대 30%) + 기타 %.
- 내성 배율: 치명 2.0 / 취약 1.5 / 보통 1.0 / 견딤 0.5 / 내성 0.25. 흐트러짐 상태면 물리 내성이 치명(2.0)이 됨.
- 공격 유형: slash(참격), pierce(관통), blunt(타격). 스킬 유형: attack, guard(수비), evade(회피), counter(반격).
- 죄악 속성: wrath(분노) lust(색욕) sloth(나태) gluttony(탐식) gloom(우울) pride(오만) envy(질투).
- 흐트러짐: 체력이 흐트러짐 역치 아래로 떨어지면 흐트러짐(다음 턴 종료까지 행동 불가).
- 키워드 상태는 {potency(위력), count(횟수)} 를 가짐.
내장 키워드 id: burn(화상: 턴 종료 시 위력 피해, 횟수-1), bleed(출혈: 공격 코인 사용 시 위력 피해, 횟수-1),
tremor(진동: 진동 폭발 시 흐트러짐 역치 +위력), rupture(파열: 피격 시 위력 추가 피해, 횟수-1),
sinking(침잠: 피격 시 위력만큼 SP 감소), poise(호흡: 위력x5% 치명타, 치명타 시 횟수-1), charge(충전),
턴 한정(위력=수치): protection(보호), fragile(취약), damageUp, damageDown, haste(신속), bind(속박),
offenseUp, offenseDown, defenseUp, defenseDown, powerUp(위력 증가), powerDown, paralysis(마비: 횟수만큼 코인 위력 0).
`;

const HOOK_DOC = `
## 효과 코드 API
효과(키워드/패시브)는 훅 이름 -> JavaScript 함수 "본문" 문자열의 객체입니다. 본문은 (ctx, api) 를 인자로 받는
함수 안에서 실행됩니다 (return 값은 쓰이지 않음). 네트워크/DOM 접근은 불가능합니다.
키워드 훅은 그 상태를 가진 유닛에 대해, 패시브 훅은 패시브를 가진 유닛에 대해 실행됩니다.

훅 목록:
- onBattleStart, onTurnStart, onTurnEnd : ctx.self
- onSkillUse : ctx.self, ctx.target, ctx.skill, ctx.clash(bool)
- modifyPower : ctx.self, ctx.target, ctx.skill, ctx.phase('clash'|'hit'), ctx.addPower(n)  // 합/타격 위력 보정
- onClashWin / onClashLose : ctx.self, ctx.opponent, ctx.skill, ctx.clashCount
- onCoinToss : ctx.self, ctx.skill, ctx.heads, ctx.coinIndex   // 코인을 던질 때마다
- onCoinUse : ctx.self, ctx.target, ctx.skill, ctx.coinIndex, ctx.heads  // 공격 코인으로 타격하기 직전
- beforeHit : (공격자) ctx.self, ctx.target, ctx.skill, ctx.power, ctx.crit, ctx.heads, ctx.addDamagePct(퍼센트), ctx.addFlatDamage(n)
- beforeHitTaken : (피격자) ctx.self, ctx.attacker, 동일한 addDamagePct / addFlatDamage (피해 감소는 음수)
- onHit : (공격자) ctx.self, ctx.target, ctx.damage, ctx.crit, ctx.heads, ctx.coinIndex
- onHitTaken : (피격자) ctx.self, ctx.attacker, ctx.damage
- onCrit, onKill(ctx.target), onDeath(ctx.killer), onStagger
키워드 훅에서는 ctx.status = {potency, count} (직접 수정 가능), ctx.statusId 가 제공됩니다.

유닛 객체 필드: name, team('ally'|'enemy'), hp, maxHp, sp, speed, level, defLevel, staggered, statuses, vars(자유 저장 공간 객체).
api:
- api.inflict(unit, statusId, potency, count, nextTurn?)  // 키워드 부여 (커스텀 키워드 id도 가능)
- api.getStatus(unit, id) -> {potency, count} | null
- api.setStatus(unit, id, potency, count), api.removeStatus(unit, id)
- api.consume(unit, id, n=1)  // 횟수 감소
- api.addPotency(unit, id, n)
- api.damage(unit, amount, label)  // 고정 피해
- api.heal(unit, amount), api.gainSP(unit, n)
- api.tremorBurst(unit)
- api.enemiesOf(unit), api.alliesOf(unit), api.units(), api.turn()
- api.rand(), api.randInt(a, b)
- api.log(text), api.message(text, color)  // 화면에 흔들리는 문구
- api.vfx(spec, unit)  // VFX 재생 (아래 VFX 형식)
`;

const VFX_DOC = `
## VFX 형식 (JSON)
{ "duration": 700~1600, "shake": 0~20, "flash": "#rrggbb" | null, "layers": [ ... ] }
layer 타입:
- {"type":"slash","color":"#hex","count":1~6,"width":2~14,"length":120~420,"angle":-90~90,"spread":0~90,"glow":0~40}
- {"type":"burst","color":"#hex","count":10~120,"speed":2~16,"size":1~8,"gravity":-0.3~0.5,"life":300~1200}
- {"type":"ring","color":"#hex","radius":40~320,"width":2~16,"life":200~900}
- {"type":"beam","color":"#hex","width":6~60,"angle":-90~90,"life":200~800}
- {"type":"sparks","color":"#hex","count":5~60,"length":10~60,"speed":4~20,"life":200~700}
- {"type":"shards","color":"#hex","count":4~40,"size":4~22,"speed":3~14,"life":400~1200}
- {"type":"glyph","text":"짧은 글자","color":"#hex","size":40~160,"life":400~1200}
- {"type":"embers","color":"#hex","count":10~80,"rise":0.5~4,"life":600~1600}
"delay": 0~800 (ms) 는 모든 레이어에 선택적으로 넣을 수 있습니다.
`;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
async function validateWithSandbox(effect) {
  return sandbox.call('validate', { hooks: effect.hooks || {} });
}

/** Natural language -> keyword / passive effect with working hook code. */
export async function generateEffect({ kind, name, description, existing = [], onProgress }) {
  const system = RULES + HOOK_DOC + `
## 출력
아래 형식의 JSON 객체 하나만 출력하세요 (설명 문장 금지):
{"name": "...", "kind": "${kind}", "color": "#hex", "desc": "게임 내 툴팁(한국어, 간결)", "turnOnly": false, "hooks": {"훅이름": "JS 본문", ...}}
- 사용자가 설명한 효과가 정확히 그대로 동작하도록 필요한 훅만 구현하세요.
- 키워드라면 이 키워드 자신의 id 는 ctx.statusId 로 참조하세요.
- 수치는 정수로 반올림하세요. 무한 루프 금지.
- 이미 존재하는 커스텀 효과 id: ${existing.map((e) => `${e.id}(${e.name})`).join(', ') || '없음'}`;
  const messages = [{ role: 'user', content: `종류: ${kind === 'keyword' ? '키워드(상태이상)' : '패시브'}\n이름: ${name || '(AI가 정해 주세요)'}\n효과 설명: ${description}` }];
  let effect = extractJson(await callAI({ system, messages, maxTokens: 8000, onProgress }));
  let errors = await validateWithSandbox(effect);
  if (errors.length) {
    // one self-repair round
    messages.push({ role: 'assistant', content: JSON.stringify(effect) });
    messages.push({ role: 'user', content: `코드 검증 오류가 있습니다. 수정한 전체 JSON을 다시 출력하세요:\n${errors.join('\n')}` });
    effect = extractJson(await callAI({ system, messages, maxTokens: 8000, onProgress }));
    errors = await validateWithSandbox(effect);
  }
  return { effect, errors };
}

/** Skill text -> data-driven effects list. */
export async function generateSkillEffects({ skill, customEffects = [], onProgress }) {
  const system = RULES + HOOK_DOC + `
## 스킬 효과 형식
스킬 효과 설명을 아래 effects 배열로 변환하세요. JSON 배열 하나만 출력합니다.
각 항목: {"when": 트리거, "coin": 코인번호(1부터, 생략 가능), "do": 동작, "who": "target"|"self"|"allies"|"enemies", ...}
트리거(when): "onUse"(사용 시), "clash"(합 위력 계산 시), "power"(타격 위력 계산 시), "beforeHit"(피해 계산 직전), "onHit"(적중 시),
"onHeads"(앞면 적중 시), "onTails"(뒷면 적중 시), "onCrit", "onClashWin", "onClashLose", "onKill"
동작(do):
- "inflict": status, potency, count, nextTurn(bool)
- "gainSP" / "heal" / "damage": value
- "tremorBurst"
- "power": value  (when 이 "clash" 또는 "power" 일 때 위력 +value)
- "damagePct": value (when 이 "beforeHit" 일 때 피해량 +value%)
- "script": code (위 효과 코드 API의 JS 본문, ctx.self=사용자, ctx.target=대상. 단순 동작으로 표현할 수 없는 조건부 효과에 사용)
사용 가능한 커스텀 키워드 id: ${customEffects.filter((e) => e.kind === 'keyword').map((e) => `${e.id}(${e.name})`).join(', ') || '없음'}`;
  const messages = [{ role: 'user', content: `스킬: ${skill.name} (죄악 ${skill.sin}, ${skill.atkType}, 위력 ${skill.basePower}+${skill.coinPower}x${skill.coinCount})\n효과 설명: ${skill.desc}` }];
  const effects = extractJson(await callAI({ system, messages, maxTokens: 8000, onProgress }));
  const list = Array.isArray(effects) ? effects : [];
  const scriptErrors = [];
  for (const e of list.filter((x) => x.do === 'script')) {
    scriptErrors.push(...await validateWithSandbox({ hooks: { onHit: e.code || '' } }));
  }
  return { effects: list, errors: scriptErrors };
}

/** Skill -> VFX spec. */
export async function generateVfx({ skill, prompt, onProgress }) {
  const system = RULES + VFX_DOC + `
## 출력
스킬 연출에 어울리는 화려한 VFX JSON 객체 하나만 출력하세요. 죄악 속성 색과 공격 유형(참격=베기 궤적, 관통=빔/찌르기, 타격=충격파/파편)을 반영하세요. 레이어는 3~7개.`;
  const messages = [{ role: 'user', content: `스킬: ${skill.name}\n죄악: ${skill.sin}\n공격 유형: ${skill.atkType}\n스킬 유형: ${skill.type}\n설명: ${skill.desc || ''}\n추가 요청: ${prompt || '없음'}` }];
  return extractJson(await callAI({ system, messages, maxTokens: 4000, onProgress }));
}

const SKILL_OPS = ['inflict', 'gainSP', 'heal', 'damage', 'tremorBurst', 'power', 'damagePct', 'script'];

/** Validate an admin bundle: effect code compiles, skill effects / references are valid. */
async function checkBundle(bundle, library) {
  const errors = [];
  const statusIds = new Set([...(sandbox.builtins || []).map((b) => b.id), ...library.effects.map((e) => e.id), ...(bundle.effects || []).map((e) => e.id)]);
  const skillIds = new Set([...library.skills.map((x) => x.id), ...(bundle.skills || []).map((x) => x.id)]);
  for (const e of bundle.effects || []) {
    const errs = await validateWithSandbox(e);
    if (errs.length) errors.push(`효과 ${e.id}: ${errs.join(', ')}`);
  }
  for (const sk of bundle.skills || []) {
    for (const ef of sk.effects || []) {
      if (!SKILL_OPS.includes(ef.do)) errors.push(`스킬 ${sk.id}: 알 수 없는 동작 do="${ef.do}"`);
      if (ef.do === 'inflict' && !statusIds.has(ef.status)) errors.push(`스킬 ${sk.id}: 없는 키워드 status="${ef.status}"`);
      if (ef.do === 'script') {
        const errs = await validateWithSandbox({ hooks: { onHit: ef.code || '' } });
        if (errs.length) errors.push(`스킬 ${sk.id} script: ${errs.join(', ')}`);
      }
    }
  }
  for (const c of bundle.characters || []) {
    for (const x of c.skills || []) if (!skillIds.has(x.id)) errors.push(`캐릭터 ${c.id}: 없는 스킬 "${x.id}"`);
    if (c.defense && !skillIds.has(c.defense)) errors.push(`캐릭터 ${c.id}: 없는 수비 스킬 "${c.defense}"`);
    for (const pid of c.passives || []) if (!statusIds.has(pid)) errors.push(`캐릭터 ${c.id}: 없는 패시브 "${pid}"`);
  }
  return errors;
}

/** Admin: natural-language request -> bundle of new content. */
export async function generateContent({ request, library, history = [], onProgress }) {
  const system = RULES + HOOK_DOC + VFX_DOC + `
## 관리자 콘텐츠 제작
관리자의 요청에 따라 새 캐릭터/스킬/효과(키워드, 패시브)를 설계하세요.
밸런스 기준 (기존 콘텐츠와 비슷하게, 관리자가 따로 요청하지 않으면 이 범위를 지키세요):
- 체력 100~180, 속도 [2~5, 4~8], 공격 레벨 38~44, 방어 레벨 36~44, 흐트러짐 [0.6, 0.3] 근처
- 스킬1(3장): 기본 3~5, 코인 2~4, 코인 2개 / 스킬2(2장): 기본 4~6, 코인 2~4, 코인 2~3개 / 스킬3(1장): 기본 5~8, 코인 3~6, 코인 2~3개
- 최대 위력(기본+코인위력x코인수)은 25 이하. 수비/회피 스킬: 기본 5~8, 코인 2~4, 코인 1개
- 내성은 0.5 / 1 / 1.5 를 섞어서 약점과 강점을 하나씩
- 키워드 상태를 부여하는 스킬은 effects 에 {"when":"onHit","do":"inflict","status":"키워드 id",...} 로 실제 부여하세요.
JSON 객체 하나만 출력합니다:
{"summary": "만든 내용 요약(한국어)",
 "effects": [{"id":"ef_영문","kind":"keyword|passive","name":"","color":"#hex","desc":"","turnOnly":false,"hooks":{}}],
 "skills": [{"id":"sk_영문","name":"","sin":"wrath..","type":"attack|guard|evade|counter","atkType":"slash|pierce|blunt",
   "basePower":0,"coinPower":0,"coinCount":1,"offLevel":0,"desc":"","effects":[스킬 효과 형식],
   "messages":[{"trigger":"skillUse|clashStart|clashWin|clashLose|kill","text":"","color":"#hex"}],"vfx": VFX 또는 null}],
 "characters": [{"id":"ch_영문","name":"","title":"","maxHp":120,"speed":[3,6],"level":40,"defLevel":38,"stagger":[0.6,0.3],
   "resist":{"slash":1,"pierce":1,"blunt":1},"sinResist":{},"skills":[{"id":"스킬id","copies":3},{"id":"","copies":2},{"id":"","copies":1}],
   "defense":"수비/회피 스킬 id 또는 null","passives":["효과 id"],"messages":[]}]}
스킬 효과 형식은 effects 배열 항목: {"when","coin","do","who",...} (do: inflict/gainSP/heal/damage/tremorBurst/power/damagePct/script).
기존 콘텐츠 id (재사용 가능): 캐릭터 ${library.characters.map((c) => c.id).join(', ')} / 스킬 ${library.skills.map((s) => s.id).join(', ')} / 효과 ${library.effects.map((e) => e.id).join(', ')}
새로 만드는 id 는 기존 id 와 겹치지 않게 하세요.`;
  const messages = [...history, { role: 'user', content: request }];
  let text = await callAI({ system, messages, maxTokens: 32000, onProgress });
  let bundle = extractJson(text);
  let errors = await checkBundle(bundle, library);
  if (errors.length) {
    // one self-repair round
    const repair = [...messages, { role: 'assistant', content: text },
      { role: 'user', content: `검증 오류가 있습니다. 오류를 고친 전체 JSON 객체를 다시 출력하세요:\n${errors.join('\n')}` }];
    text = await callAI({ system, messages: repair, maxTokens: 32000, onProgress });
    bundle = extractJson(text);
    errors = await checkBundle(bundle, library);
  }
  return { bundle, errors, raw: text };
}
