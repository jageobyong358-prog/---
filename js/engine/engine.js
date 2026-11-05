/*
 * Limbus-style battle engine.
 *
 * Plain script (no modules) so it can be loaded as text into the sandboxed
 * iframe (see js/sandbox.js) and into Node for tests. It defines
 * globalThis.LimbusEngine.
 *
 * User / AI written keyword & passive code runs ONLY inside this engine, which
 * itself runs inside an opaque-origin sandbox iframe with a CSP that blocks
 * network access. The code therefore cannot touch the page or its storage.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const SINS = {
    wrath: { name: '분노', color: '#e0312b' },
    lust: { name: '색욕', color: '#f07a1c' },
    sloth: { name: '나태', color: '#e8c61e' },
    gluttony: { name: '탐식', color: '#8ed22e' },
    gloom: { name: '우울', color: '#29b6d6' },
    pride: { name: '오만', color: '#2f5fd6' },
    envy: { name: '질투', color: '#8e3fc9' },
  };
  const ATK_TYPES = { slash: '참격', pierce: '관통', blunt: '타격' };
  const SKILL_TYPES = { attack: '공격', guard: '수비', evade: '회피', counter: '반격' };

  const SP_MIN = -45;
  const SP_MAX = 45;
  const CLASH_WIN_SP = 10;
  const KILL_SP = 10;
  const ALLY_DEATH_SP = -10;
  const CLASH_COUNT_DMG = 0.03; // +3% damage per clash, capped
  const CLASH_COUNT_CAP = 0.3;
  const CRIT_BONUS = 0.2;
  const STAGGER_RES = 2.0; // staggered units take Fatal physical damage
  const MAX_CLASH_ROUNDS = 99;

  function resistLabel(m) {
    if (m >= 2) return '치명';
    if (m >= 1.5) return '취약';
    if (m >= 1) return '보통';
    if (m >= 0.5) return '견딤';
    return '내성';
  }

  // ---------------------------------------------------------------------------
  // RNG (seeded so a battle can be replayed)
  // ---------------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------------------
  // Built-in keywords (statuses). Same hook interface as custom effects.
  // ---------------------------------------------------------------------------
  // kind: 'keyword' statuses live on units with {potency, count}.
  // turnOnly: stack-style status cleared at turn end (potency = stacks).
  const BUILTIN_STATUSES = {
    burn: {
      name: '화상', color: '#ff6a1a', desc: '턴 종료 시 위력만큼 피해를 받고 횟수 1 감소.',
      hooks: {
        onTurnEnd(ctx, api) {
          api.damage(ctx.self, ctx.status.potency, '화상');
          api.consume(ctx.self, 'burn', 1);
        },
      },
    },
    bleed: {
      name: '출혈', color: '#c41e3a', desc: '공격 스킬의 코인을 사용할 때마다 위력만큼 피해를 받고 횟수 1 감소.',
      hooks: {
        onCoinUse(ctx, api) {
          api.damage(ctx.self, ctx.status.potency, '출혈');
          api.consume(ctx.self, 'bleed', 1);
        },
      },
    },
    tremor: {
      name: '진동', color: '#d8c27a', desc: '진동 폭발 시 위력만큼 흐트러짐 역치를 높인다. 턴 종료 시 횟수 1 감소.',
      hooks: {
        onTurnEnd(ctx, api) { api.consume(ctx.self, 'tremor', 1); },
      },
    },
    rupture: {
      name: '파열', color: '#3fe0c5', desc: '피격 시 위력만큼 추가 피해를 받고 횟수 1 감소.',
      hooks: {
        onHitTaken(ctx, api) {
          api.damage(ctx.self, ctx.status.potency, '파열');
          api.consume(ctx.self, 'rupture', 1);
        },
      },
    },
    sinking: {
      name: '침잠', color: '#3a6fd8', desc: '피격 시 위력만큼 정신력이 감소(정신력이 -45면 우울 피해). 횟수 1 감소.',
      hooks: {
        onHitTaken(ctx, api) {
          const p = ctx.status.potency;
          if (ctx.self.sp <= SP_MIN) api.damage(ctx.self, p, '침잠');
          else api.gainSP(ctx.self, -p);
          api.consume(ctx.self, 'sinking', 1);
        },
      },
    },
    poise: {
      name: '호흡', color: '#7fd4ff', desc: '위력 x5% 확률로 치명타(피해 +20%). 치명타 시 횟수 1 감소.',
      hooks: {}, // handled in damage calc
    },
    charge: {
      name: '충전', color: '#7af0ff', desc: '스킬 효과로 소모되는 자원. 턴 종료 시 횟수 1 감소.',
      hooks: { onTurnEnd(ctx, api) { api.consume(ctx.self, 'charge', 1); } },
    },
    protection: { name: '보호', color: '#9fb7c9', turnOnly: true, desc: '받는 피해 -10% x 수치 (이번 턴).', hooks: {} },
    fragile: { name: '취약', color: '#c97b9f', turnOnly: true, desc: '받는 피해 +10% x 수치 (이번 턴).', hooks: {} },
    damageUp: { name: '피해량 증가', color: '#ff9b6b', turnOnly: true, desc: '주는 피해 +10% x 수치 (이번 턴).', hooks: {} },
    damageDown: { name: '피해량 감소', color: '#8a8aa0', turnOnly: true, desc: '주는 피해 -10% x 수치 (이번 턴).', hooks: {} },
    haste: { name: '신속', color: '#a7ff7a', turnOnly: true, desc: '속도 + 수치 (이번 턴).', hooks: {} },
    bind: { name: '속박', color: '#776655', turnOnly: true, desc: '속도 - 수치 (이번 턴).', hooks: {} },
    offenseUp: { name: '공격 레벨 증가', color: '#ffb347', turnOnly: true, desc: '공격 레벨 + 수치 (이번 턴).', hooks: {} },
    offenseDown: { name: '공격 레벨 감소', color: '#806040', turnOnly: true, desc: '공격 레벨 - 수치 (이번 턴).', hooks: {} },
    defenseUp: { name: '방어 레벨 증가', color: '#6bb7ff', turnOnly: true, desc: '방어 레벨 + 수치 (이번 턴).', hooks: {} },
    defenseDown: { name: '방어 레벨 감소', color: '#405880', turnOnly: true, desc: '방어 레벨 - 수치 (이번 턴).', hooks: {} },
    powerUp: { name: '위력 증가', color: '#ffe066', turnOnly: true, desc: '스킬 위력 + 수치 (이번 턴).', hooks: {} },
    powerDown: { name: '위력 감소', color: '#99884a', turnOnly: true, desc: '스킬 위력 - 수치 (이번 턴).', hooks: {} },
    paralysis: { name: '마비', color: '#e8e04a', desc: '다음 코인 횟수만큼 코인 위력이 0이 된다.', hooks: {} },
  };

  // ---------------------------------------------------------------------------
  // Custom code compilation
  // ---------------------------------------------------------------------------
  const compiledCache = new Map();
  function compile(code) {
    if (typeof code === 'function') return code;
    if (!code || typeof code !== 'string') return null;
    if (compiledCache.has(code)) return compiledCache.get(code);
    // eslint-disable-next-line no-new-func
    const fn = new Function('ctx', 'api', '"use strict";\n' + code);
    compiledCache.set(code, fn);
    return fn;
  }

  const HOOK_NAMES = [
    'onBattleStart', 'onTurnStart', 'onTurnEnd', 'onSkillUse', 'modifyPower',
    'onClashWin', 'onClashLose', 'onCoinUse', 'onCoinToss', 'beforeHit', 'beforeHitTaken',
    'onHit', 'onHitTaken', 'onCrit', 'onKill', 'onDeath', 'onStagger',
  ];

  /** Compile-check an effect definition. Returns list of error strings. */
  function validateEffect(effect) {
    const errors = [];
    if (!effect || typeof effect !== 'object') return ['효과 정의가 객체가 아닙니다.'];
    const hooks = effect.hooks || {};
    for (const [name, code] of Object.entries(hooks)) {
      if (!HOOK_NAMES.includes(name)) errors.push(`알 수 없는 훅: ${name}`);
      try { compile(code); } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Battle
  // ---------------------------------------------------------------------------
  function createBattle(opts) {
    const rng = mulberry32((opts.seed >>> 0) || (Date.now() >>> 0));
    const B = {
      turn: 0,
      rng,
      skills: opts.skills || {},
      effects: Object.assign({}, opts.effects || {}),
      units: [],
      events: [],
      pending: [], // statuses to apply next turn
      enemyActions: [],
      result: null,
      sinResources: { ally: {}, enemy: {} },
      seq: 0,
    };
    let n = 0;
    const mk = (def, team) => {
      const maxHp = Math.max(1, Math.round(def.maxHp || 100));
      const u = {
        uid: `${team[0]}${n++}`,
        team,
        name: def.name || '???',
        charId: def.id,
        def,
        maxHp,
        hp: maxHp,
        sp: clamp(def.startSp || 0, SP_MIN, SP_MAX),
        level: def.level ?? 40,
        defLevel: def.defLevel ?? def.level ?? 40,
        speed: 0,
        statuses: {},
        thresholds: (def.stagger || [0.6, 0.3])
          .map((p) => Math.floor(maxHp * p))
          .filter((v) => v > 0 && v < maxHp)
          .sort((a, b) => b - a),
        staggered: 0, // 0 = no, 1 = stagger, 2 = stagger+, 3 = stagger++
        staggerUntil: -1,
        dead: false,
        deck: [],
        hand: [],
        vars: {}, // free storage for custom effects
      };
      return u;
    };
    for (const d of opts.allies || []) B.units.push(mk(d, 'ally'));
    for (const d of opts.enemies || []) B.units.push(mk(d, 'enemy'));
    for (const u of B.units) refillHand(B, u);
    for (const u of B.units) fire(B, 'onBattleStart', u, {});
    return B;
  }

  // ----- events --------------------------------------------------------------
  function snap(B) {
    const o = {};
    for (const u of B.units) {
      const st = {};
      for (const [k, v] of Object.entries(u.statuses)) st[k] = [v.potency, v.count];
      o[u.uid] = { hp: u.hp, sp: u.sp, stg: u.staggered, dead: u.dead, spd: u.speed, st };
    }
    return o;
  }
  function emit(B, ev) {
    ev.i = B.seq++;
    ev.s = snap(B);
    B.events.push(ev);
  }
  function log(B, text, extra) { emit(B, Object.assign({ type: 'log', text }, extra || {})); }

  // ----- helpers -------------------------------------------------------------
  const alive = (B, team) => B.units.filter((u) => !u.dead && (!team || u.team === team));
  const enemiesOf = (B, u) => alive(B, u.team === 'ally' ? 'enemy' : 'ally');
  const alliesOf = (B, u) => alive(B, u.team);
  const pot = (u, id) => (u.statuses[id] ? u.statuses[id].potency : 0);
  const getSkill = (B, id) => B.skills[id];

  function effectDef(B, id) {
    return BUILTIN_STATUSES[id] || B.effects[id] || null;
  }
  function statusName(B, id) {
    const e = effectDef(B, id);
    return (e && e.name) || id;
  }

  function refillHand(B, u) {
    const skills = (u.def.skills || []).filter((s) => B.skills[s.id] && B.skills[s.id].type !== 'guard' && B.skills[s.id].type !== 'evade');
    if (!skills.length) return;
    let guard = 0;
    while (u.hand.length < 2 && guard++ < 20) {
      if (!u.deck.length) {
        for (const s of skills) for (let i = 0; i < Math.max(1, s.copies || 1); i++) u.deck.push(s.id);
        for (let i = u.deck.length - 1; i > 0; i--) {
          const j = Math.floor(B.rng() * (i + 1));
          [u.deck[i], u.deck[j]] = [u.deck[j], u.deck[i]];
        }
      }
      u.hand.push(u.deck.pop());
    }
  }

  // ----- API given to hooks ----------------------------------------------------
  function makeApi(B) {
    const api = {
      rand: () => B.rng(),
      randInt: (a, b) => a + Math.floor(B.rng() * (b - a + 1)),
      log: (t) => log(B, String(t)),
      message: (text, color) => emit(B, { type: 'message', text: String(text), color: color || '#ffffff' }),
      vfx: (spec, unit) => emit(B, { type: 'vfx', spec, at: unit ? unit.uid : null }),
      getStatus: (u, id) => (u && u.statuses[id] ? { potency: u.statuses[id].potency, count: u.statuses[id].count } : null),
      inflict: (u, id, potency, count, nextTurn) => inflict(B, u, id, potency || 0, count || 0, !!nextTurn),
      setStatus: (u, id, potency, count) => {
        if (!u) return;
        if ((potency || 0) <= 0 && (count || 0) <= 0) delete u.statuses[id];
        else u.statuses[id] = { potency: clamp(potency | 0, 0, 99), count: clamp(count | 0, 0, 99) };
      },
      removeStatus: (u, id) => { if (u) delete u.statuses[id]; },
      consume: (u, id, n) => {
        const s = u && u.statuses[id];
        if (!s) return;
        s.count -= n == null ? 1 : n;
        if (s.count <= 0) delete u.statuses[id];
      },
      addPotency: (u, id, n) => {
        const s = u && u.statuses[id];
        if (!s) return;
        s.potency = clamp(s.potency + n, 0, 99);
        if (s.potency <= 0 && !effectDef(B, id)?.countOnly) delete u.statuses[id];
      },
      damage: (u, amount, label) => applyDamage(B, u, Math.round(amount), label || '효과', null),
      heal: (u, amount) => {
        if (!u || u.dead) return;
        const before = u.hp;
        u.hp = Math.min(u.maxHp, u.hp + Math.max(0, Math.round(amount)));
        emit(B, { type: 'heal', unit: u.uid, amount: u.hp - before });
      },
      gainSP: (u, n) => {
        if (!u || u.dead) return;
        u.sp = clamp(u.sp + Math.round(n), SP_MIN, SP_MAX);
        emit(B, { type: 'sp', unit: u.uid, amount: Math.round(n) });
      },
      tremorBurst: (u) => tremorBurst(B, u),
      enemiesOf: (u) => enemiesOf(B, u),
      alliesOf: (u) => alliesOf(B, u),
      units: () => alive(B),
      turn: () => B.turn,
    };
    return api;
  }

  function runHook(B, effect, hookName, ctx, ownerLabel) {
    const code = effect && effect.hooks && effect.hooks[hookName];
    if (!code) return;
    let fn;
    try { fn = compile(code); } catch (e) {
      log(B, `⚠ [${ownerLabel}] ${hookName} 컴파일 오류: ${e.message}`, { error: true });
      return;
    }
    try { fn(ctx, B.api || (B.api = makeApi(B))); } catch (e) {
      log(B, `⚠ [${ownerLabel}] ${hookName} 실행 오류: ${e.message}`, { error: true });
    }
  }

  /** Drop statuses whose count reached 0 (custom code often just does `ctx.status.count -= 1`). */
  function purge(B, u) {
    for (const [id, st] of Object.entries(u.statuses)) {
      const def = effectDef(B, id);
      if (def && def.turnOnly) continue;
      if (!(st.count > 0) || (st.potency <= 0 && st.count <= 0)) delete u.statuses[id];
    }
  }

  /** Fire a hook for every status and passive on unit u. */
  function fire(B, hookName, u, base) {
    if (!u) return;
    try { return fireInner(B, hookName, u, base); } finally { purge(B, u); }
  }

  function fireInner(B, hookName, u, base) {
    // statuses
    for (const id of Object.keys(u.statuses)) {
      const s = u.statuses[id];
      if (!s) continue;
      const def = effectDef(B, id);
      if (!def) continue;
      const ctx = Object.assign({ self: u, status: s, statusId: id }, base);
      runHook(B, def, hookName, ctx, def.name || id);
    }
    // passives
    for (const pid of u.def.passives || []) {
      const def = B.effects[pid];
      if (!def) continue;
      const ctx = Object.assign({ self: u, passiveId: pid }, base);
      runHook(B, def, hookName, ctx, def.name || pid);
    }
  }

  // ----- status ---------------------------------------------------------------
  function inflict(B, u, id, potency, count, nextTurn) {
    if (!u || u.dead) return;
    const def = effectDef(B, id);
    if (!def) { log(B, `⚠ 알 수 없는 키워드: ${id}`, { error: true }); return; }
    if (def.turnOnly) { count = Math.max(1, count); potency = Math.max(potency, 1); }
    if (nextTurn) {
      B.pending.push({ uid: u.uid, id, potency, count });
      emit(B, { type: 'status', unit: u.uid, status: id, name: def.name, potency, count, next: true });
      return;
    }
    const s = u.statuses[id] || { potency: 0, count: 0 };
    s.potency = clamp(s.potency + potency, 0, 99);
    s.count = clamp(s.count + count, 0, 99);
    if (!def.turnOnly && s.count <= 0 && s.potency > 0) s.count = 1;
    u.statuses[id] = s;
    emit(B, { type: 'status', unit: u.uid, status: id, name: def.name, potency, count });
  }

  function tremorBurst(B, u) {
    const s = u && u.statuses.tremor;
    if (!s || u.dead) return;
    // Tremor burst raises the next stagger threshold by Tremor potency.
    if (u.thresholds.length) {
      u.thresholds[0] = Math.min(u.maxHp, u.thresholds[0] + s.potency);
      emit(B, { type: 'tremorBurst', unit: u.uid, amount: s.potency });
      checkStagger(B, u);
    } else {
      emit(B, { type: 'tremorBurst', unit: u.uid, amount: 0 });
    }
    s.count -= 1;
    if (s.count <= 0) delete u.statuses.tremor;
  }

  // ----- damage ---------------------------------------------------------------
  function applyDamage(B, u, amount, label, src) {
    if (!u || u.dead || amount <= 0) return 0;
    u.hp = Math.max(0, u.hp - amount);
    emit(B, { type: 'damage', unit: u.uid, amount, label, src: src ? src.uid : null });
    if (u.hp <= 0) kill(B, u, src);
    else checkStagger(B, u);
    return amount;
  }

  function checkStagger(B, u) {
    if (u.dead) return;
    let crossed = 0;
    while (u.thresholds.length && u.hp <= u.thresholds[0]) {
      u.thresholds.shift();
      crossed++;
    }
    if (!crossed) return;
    u.staggered = clamp(u.staggered + crossed, 1, 3);
    u.staggerUntil = B.turn + 1;
    u.speed = 0;
    emit(B, { type: 'stagger', unit: u.uid, level: u.staggered });
    fire(B, 'onStagger', u, {});
  }

  function kill(B, u, src) {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    emit(B, { type: 'death', unit: u.uid });
    fire(B, 'onDeath', u, { killer: src });
    if (src && !src.dead) {
      src.sp = clamp(src.sp + KILL_SP, SP_MIN, SP_MAX);
      fire(B, 'onKill', src, { target: u });
    }
    for (const a of alliesOf(B, u)) a.sp = clamp(a.sp + ALLY_DEATH_SP, SP_MIN, SP_MAX);
    checkEnd(B);
  }

  function checkEnd(B) {
    if (B.result) return;
    if (!alive(B, 'enemy').length) B.result = 'win';
    else if (!alive(B, 'ally').length) B.result = 'lose';
    if (B.result) emit(B, { type: 'end', result: B.result });
  }

  // ----- skill data effects -----------------------------------------------------
  // skill.effects: [{ when, coin, do, status, potency, count, who, nextTurn, value, code }]
  function runSkillEffects(B, when, user, target, skill, extra) {
    const list = (skill && skill.effects) || [];
    for (const ef of list) {
      if (ef.when !== when) continue;
      if (ef.coin != null && extra && extra.coinIndex != null && ef.coin !== extra.coinIndex + 1) continue;
      if (ef.coin != null && (!extra || extra.coinIndex == null) && when !== 'onUse' && when !== 'onClashWin' && when !== 'onClashLose' && when !== 'onKill') continue;
      const whoList = ef.who === 'self' ? [user]
        : ef.who === 'allies' ? alliesOf(B, user)
          : ef.who === 'enemies' ? enemiesOf(B, user)
            : [target];
      const api = B.api || (B.api = makeApi(B));
      for (const w of whoList) {
        if (!w || w.dead) continue;
        switch (ef.do) {
          case 'inflict': inflict(B, w, ef.status, ef.potency || 0, ef.count || 0, !!ef.nextTurn); break;
          case 'gainSP': api.gainSP(w, ef.value || 0); break;
          case 'heal': api.heal(w, ef.value || 0); break;
          case 'tremorBurst': tremorBurst(B, w); break;
          case 'damage': applyDamage(B, w, ef.value || 0, skill.name, user); break;
          case 'power': if (extra && extra.addPower) extra.addPower(ef.value || 0); break;
          case 'powerPerBroken': if (extra && extra.addPower) extra.addPower((ef.value || 0) * (extra.brokenCoins || 0)); break;
          case 'damagePct': if (extra && extra.addDamagePct) extra.addDamagePct(ef.value || 0); break;
          case 'script': {
            const ctx = Object.assign({ self: user, target: w, skill }, extra || {});
            runHook(B, { hooks: { [when]: ef.code } }, when, ctx, skill.name);
            break;
          }
          default: break;
        }
      }
    }
  }

  // ----- power -------------------------------------------------------------------
  function headsChance(u) { return clamp(0.5 + u.sp / 100, 0, 1); }

  function offLevel(u, skill) { return u.level + (skill.offLevel || 0) + pot(u, 'offenseUp') - pot(u, 'offenseDown'); }
  function defLevelOf(u, skill) { return u.defLevel + ((skill && skill.type !== 'attack') ? (skill.defLevelBonus || 0) : 0) + pot(u, 'defenseUp') - pot(u, 'defenseDown'); }

  /** Extra flat power from statuses / passives / skill effects. */
  function powerMods(B, u, skill, opp, phase, brokenCoins) {
    let add = pot(u, 'powerUp') - pot(u, 'powerDown');
    const ctx = { target: opp, opponent: opp, skill, phase, brokenCoins: brokenCoins || 0, addPower: (n) => { add += Number(n) || 0; } };
    fire(B, 'modifyPower', u, ctx);
    runSkillEffects(B, phase === 'clash' ? 'clash' : 'power', u, opp, skill, ctx);
    return add;
  }

  // ----- coins ----------------------------------------------------------------------
  // A skill's coins: { i, ub (unbreakable), broken, weak }.
  // Losing a clash round breaks the first live coin. An unbreakable coin is not
  // destroyed: it only stops counting for the clash and keeps a value of ±1 (the
  // sign of the coin power) for the attacks that follow.
  function makeCoins(skill) {
    const n = Math.max(1, skill.coinCount || 1);
    const ub = Array.isArray(skill.unbreakable) ? skill.unbreakable : [];
    return Array.from({ length: n }, (_, i) => ({ i, ub: !!ub[i], broken: false, weak: false }));
  }
  const liveCoins = (k) => k.filter((c) => !c.broken);
  const usableCoins = (k) => k.filter((c) => !c.broken || c.ub);
  const brokenCount = (k) => k.filter((c) => c.broken).length;
  function breakCoin(k) {
    const c = k.find((x) => !x.broken);
    if (c) { c.broken = true; if (c.ub) c.weak = true; }
  }
  const coinStates = (k) => k.map((c) => (c.weak ? 'weak' : c.broken ? 'broken' : 'ok'));
  const isAttackSkill = (sk) => sk.type === 'attack' || sk.type === 'counter';

  /** Flip the given coins, returning heads/tails per coin. */
  function tossCoins(B, u, skill, coins) {
    const out = [];
    for (const c of coins) {
      const heads = B.rng() < headsChance(u);
      out.push(heads);
      fire(B, 'onCoinToss', u, { skill, heads, coinIndex: c.i, unbreakable: c.ub });
    }
    return out;
  }

  function coinValue(u, skill, coin) {
    if (u.statuses.paralysis) {
      const s = u.statuses.paralysis;
      s.count -= 1; if (s.count <= 0) delete u.statuses.paralysis;
      return 0;
    }
    if (coin && coin.weak) return Math.sign(skill.coinPower || 0); // unbreakable coin after a lost clash: ±1
    return skill.coinPower || 0;
  }

  /** Clash roll with the coins still standing. Returns power and flips indexed by coin. */
  function rollPower(B, u, skill, coins, opp, phase) {
    const live = liveCoins(coins);
    const flips = tossCoins(B, u, skill, live);
    let p = skill.basePower || 0;
    live.forEach((c, j) => { if (flips[j]) p += coinValue(u, skill, c); });
    p += powerMods(B, u, skill, opp, phase, brokenCount(coins));
    const byIndex = coins.map(() => null);
    live.forEach((c, j) => { byIndex[c.i] = flips[j]; });
    return { power: Math.max(0, p), flips: byIndex };
  }

  /** After a lost clash: an attack skill strikes back with its unbreakable coins. */
  function unbreakableStrike(B, L, SL, kL, W) {
    if (!isAttackSkill(SL) || !kL.some((c) => c.ub)) return;
    if (L.dead || L.staggered || W.dead || B.result) return;
    emit(B, { type: 'unbreakableStrike', att: L.uid, def: W.uid, skill: SL.id, coins: kL.filter((c) => c.ub).length });
    attack(B, L, SL, W, kL.filter((c) => c.ub), 0, null, brokenCount(kL));
  }

  // ----- clash ---------------------------------------------------------------------
  function clash(B, a, sa, b, sb) {
    emit(B, { type: 'clashStart', a: a.uid, b: b.uid, sa: sa.id, sb: sb.id });
    fire(B, 'onSkillUse', a, { target: b, skill: sa, clash: true });
    fire(B, 'onSkillUse', b, { target: a, skill: sb, clash: true });
    runSkillEffects(B, 'onUse', a, b, sa, {});
    runSkillEffects(B, 'onUse', b, a, sb, {});

    const ka = makeCoins(sa);
    const kb = makeCoins(sb);
    let count = 0;
    const lvA = offLevel(a, sa);
    const lvB = offLevel(b, sb);
    const diff = lvA - lvB;
    const lvBonusA = diff > 0 ? Math.floor(diff / 3) : 0;
    const lvBonusB = diff < 0 ? Math.floor(-diff / 3) : 0;

    while (liveCoins(ka).length && liveCoins(kb).length && count < MAX_CLASH_ROUNDS && !a.dead && !b.dead) {
      const ra = rollPower(B, a, sa, ka, b, 'clash');
      const rb = rollPower(B, b, sb, kb, a, 'clash');
      const pa = ra.power + lvBonusA;
      const pb = rb.power + lvBonusB;
      count++;
      let winner = null;
      if (pa > pb) { breakCoin(kb); winner = a.uid; } else if (pb > pa) { breakCoin(ka); winner = b.uid; }
      emit(B, {
        type: 'clashRound', round: count,
        a: { uid: a.uid, power: pa, flips: ra.flips, coins: liveCoins(ka).length, states: coinStates(ka) },
        b: { uid: b.uid, power: pb, flips: rb.flips, coins: liveCoins(kb).length, states: coinStates(kb) },
        winner,
      });
    }
    if (a.dead || b.dead) return;
    if (!liveCoins(ka).length && !liveCoins(kb).length) return;
    const aWon = !liveCoins(kb).length;
    const W = aWon ? a : b; const L = aWon ? b : a;
    const SW = aWon ? sa : sb; const SL = aWon ? sb : sa;
    const kW = aWon ? ka : kb; const kL = aWon ? kb : ka;
    W.sp = clamp(W.sp + CLASH_WIN_SP, SP_MIN, SP_MAX);
    emit(B, { type: 'clashEnd', winner: W.uid, loser: L.uid, count, skill: SW.id });
    addSinResource(B, W, SW);
    fire(B, 'onClashWin', W, { opponent: L, target: L, skill: SW, clashCount: count });
    fire(B, 'onClashLose', L, { opponent: W, target: W, skill: SL, clashCount: count });
    runSkillEffects(B, 'onClashWin', W, L, SW, {});
    runSkillEffects(B, 'onClashLose', L, W, SL, {});

    if (SW.type === 'evade') {
      log(B, `${W.name}이(가) 회피에 성공했다!`);
    } else if (SW.type === 'guard') {
      log(B, `${W.name}이(가) 공격을 막아냈다!`);
    } else {
      attack(B, W, SW, L, usableCoins(kW), count, null, brokenCount(kW));
    }
    unbreakableStrike(B, L, SL, kL, W);
  }

  /**
   * Attack weight (가중치): a weight-N skill hits the main target and up to N-1 more
   * enemies next to it (in row order, wrapping). Extra targets don't clash; every
   * coin hits every target.
   */
  function weightTargets(B, att, skill, def) {
    const w = clamp(Math.round(skill.weight || 1), 1, 10);
    const foes = enemiesOf(B, att);
    const idx = foes.indexOf(def);
    const extra = [];
    if (idx < 0) return extra;
    for (let k = 1; extra.length < w - 1 && k < foes.length; k++) extra.push(foes[(idx + k) % foes.length]);
    return extra;
  }

  function attack(B, att, skill, def, coins, clashCount, shield, broken) {
    if (att.dead || def.dead || !coins.length) return;
    const extra = weightTargets(B, att, skill, def);
    if (extra.length) emit(B, { type: 'multiTarget', att: att.uid, skill: skill.id, targets: [def.uid, ...extra.map((u) => u.uid)] });
    const flips = tossCoins(B, att, skill, coins);
    let power = skill.basePower || 0;
    const shieldBox = { value: shield || 0 };
    for (let k = 0; k < flips.length; k++) {
      const targets = [def, ...extra].filter((t) => !t.dead);
      if (att.dead || !targets.length || B.result) break;
      if (att.staggered && k > 0) break;
      const coinIndex = coins[k].i;
      if (flips[k]) power += coinValue(att, skill, coins[k]);
      const mods = powerMods(B, att, skill, targets[0], 'hit', broken || 0);
      const p = Math.max(0, power + mods);
      fire(B, 'onCoinUse', att, { skill, target: targets[0], coinIndex, heads: flips[k] });
      if (att.dead) break;
      for (const t of targets) {
        if (t.dead || att.dead || B.result) continue;
        // the guard shield only protects the unit that guarded (the main target)
        hit(B, att, skill, t, p, coinIndex, flips[k], clashCount, t === def ? shieldBox : null);
      }
    }
  }


  function hit(B, att, skill, def, power, coinIndex, heads, clashCount, shieldBox) {
    if (def.dead) return;
    const physBase = (def.def.resist && def.def.resist[skill.atkType]) ?? 1;
    const physRes = def.staggered ? Math.max(STAGGER_RES + (def.staggered - 1) * 0.5, physBase) : physBase;
    const sinRes = (def.def.sinResist && def.def.sinResist[skill.sin]) ?? 1;
    const oL = offLevel(att, skill);
    const dL = defLevelOf(def, null);
    const diff = oL - dL;
    const lvMod = diff / (Math.abs(diff) + 25);
    const clashMod = Math.min(CLASH_COUNT_CAP, (clashCount || 0) * CLASH_COUNT_DMG);

    let pct = 0; let flat = 0;
    pct += 0.1 * (pot(att, 'damageUp') - pot(att, 'damageDown'));
    pct += 0.1 * (pot(def, 'fragile') - pot(def, 'protection'));

    // crit (Poise)
    let crit = false;
    const poise = att.statuses.poise;
    if (poise && B.rng() < Math.min(1, poise.potency * 0.05)) {
      crit = true;
      pct += CRIT_BONUS;
      poise.count -= 1; if (poise.count <= 0) delete att.statuses.poise;
    }

    const hitCtx = {
      target: def, attacker: att, skill, coinIndex, heads, power, crit,
      addDamagePct: (p) => { pct += (Number(p) || 0) / 100; },
      addFlatDamage: (n) => { flat += Number(n) || 0; },
    };
    fire(B, 'beforeHit', att, hitCtx);
    fire(B, 'beforeHitTaken', def, Object.assign({}, hitCtx, { target: att, attacker: att }));
    runSkillEffects(B, 'beforeHit', att, def, skill, hitCtx);
    if (heads) runSkillEffects(B, 'beforeHitHeads', att, def, skill, hitCtx);

    const mult = Math.max(0, 1 + (physRes - 1) + (sinRes - 1) + lvMod + clashMod + pct);
    let dmg = Math.max(0, Math.floor(power * mult + flat));
    let absorbed = 0;
    if (shieldBox && shieldBox.value > 0) {
      absorbed = Math.min(shieldBox.value, dmg);
      shieldBox.value -= absorbed;
      dmg -= absorbed;
    }

    emit(B, {
      type: 'hit', att: att.uid, def: def.uid, skill: skill.id, coin: coinIndex, heads, power,
      damage: dmg, absorbed, crit,
      res: resistLabel(physRes), sinResLabel: resistLabel(sinRes), mult: Math.round(mult * 100) / 100,
    });
    if (dmg > 0) {
      def.hp = Math.max(0, def.hp - dmg);
      emit(B, { type: 'damage', unit: def.uid, amount: dmg, label: skill.name, src: att.uid, crit });
    }

    const after = { target: def, attacker: att, skill, coinIndex, heads, damage: dmg, crit };
    if (crit) fire(B, 'onCrit', att, after);
    fire(B, 'onHit', att, after);
    runSkillEffects(B, 'onHit', att, def, skill, after);
    runSkillEffects(B, heads ? 'onHeads' : 'onTails', att, def, skill, after);
    if (crit) runSkillEffects(B, 'onCrit', att, def, skill, after);
    if (!def.dead) fire(B, 'onHitTaken', def, Object.assign({}, after, { target: att }));

    if (def.hp <= 0 && !def.dead) {
      kill(B, def, att);
      runSkillEffects(B, 'onKill', att, def, skill, after);
    } else if (!def.dead) {
      checkStagger(B, def);
    }
  }

  function addSinResource(B, u, skill) {
    if (!skill.sin) return;
    const r = B.sinResources[u.team];
    r[skill.sin] = (r[skill.sin] || 0) + 1;
  }

  // ---------------------------------------------------------------------------
  // Turn flow
  // ---------------------------------------------------------------------------
  function beginTurn(B) {
    B.events = [];
    if (B.result) return { events: B.events };
    B.turn++;
    emit(B, { type: 'turnStart', turn: B.turn });

    // apply pending next-turn statuses
    const pend = B.pending; B.pending = [];
    for (const p of pend) {
      const u = B.units.find((x) => x.uid === p.uid);
      if (u) inflict(B, u, p.id, p.potency, p.count, false);
    }

    for (const u of alive(B)) fire(B, 'onTurnStart', u, {});

    // speed
    for (const u of alive(B)) {
      if (u.staggered) { u.speed = 0; continue; }
      const [lo, hi] = u.def.speed || [3, 6];
      u.speed = Math.max(1, Math.floor(lo + B.rng() * (hi - lo + 1)) + pot(u, 'haste') - pot(u, 'bind'));
    }
    emit(B, { type: 'speed' });

    // enemy intent (shown to player before resolving, like Limbus)
    B.enemyActions = [];
    for (const e of alive(B, 'enemy')) {
      if (e.staggered) continue;
      const allies = alive(B, 'ally');
      if (!allies.length) break;
      refillHand(B, e);
      if (!e.hand.length) continue;
      const pick = e.hand[Math.floor(B.rng() * e.hand.length)];
      const target = allies[Math.floor(B.rng() * allies.length)];
      B.enemyActions.push({ uid: e.uid, skillId: pick, targetUid: target.uid });
    }
    for (const u of alive(B, 'ally')) refillHand(B, u);
    checkEnd(B);
    return { events: B.events };
  }

  /**
   * actions: [{ uid, skillId, targetUid }]
   * Defensive skills (guard / evade) don't need a target.
   */
  function resolveTurn(B, playerActions) {
    B.events = [];
    if (B.result) return { events: B.events, result: B.result };
    const all = [];
    const byUid = (id) => B.units.find((u) => u.uid === id);
    for (const a of playerActions || []) {
      const u = byUid(a.uid);
      const sk = getSkill(B, a.skillId);
      if (!u || u.dead || u.staggered || u.team !== 'ally' || !sk) continue;
      all.push({ u, skill: sk, target: byUid(a.targetUid), done: false, defenseUsed: false });
      // consume from hand
      const hi = u.hand.indexOf(a.skillId);
      if (hi >= 0) u.hand.splice(hi, 1);
    }
    for (const a of B.enemyActions) {
      const u = byUid(a.uid);
      const sk = getSkill(B, a.skillId);
      if (!u || u.dead || u.staggered || !sk) continue;
      all.push({ u, skill: sk, target: byUid(a.targetUid), done: false });
      const hi = u.hand.indexOf(a.skillId);
      if (hi >= 0) u.hand.splice(hi, 1);
    }
    // order by speed desc, random tiebreak
    for (const x of all) x.tb = B.rng();
    all.sort((x, y) => (y.u.speed - x.u.speed) || (x.tb - y.tb));

    const isDefense = (s) => s.type === 'guard' || s.type === 'evade';

    for (const act of all) {
      if (B.result) break;
      if (act.done) continue;
      const u = act.u;
      if (u.dead || u.staggered) { act.done = true; continue; }
      if (isDefense(act.skill)) continue; // defensive skills wait to be attacked

      // retarget if needed
      let t = act.target;
      if (!t || t.dead) {
        const opts = enemiesOf(B, u);
        if (!opts.length) { act.done = true; continue; }
        t = opts[Math.floor(B.rng() * opts.length)];
        act.target = t;
      }
      act.done = true;

      const opp = all.find((o) => o.u === t && !o.done && !t.dead && !t.staggered);
      if (opp && !isDefense(opp.skill) && (opp.target === u || u.speed > t.speed)) {
        if (opp.target !== u) emit(B, { type: 'redirect', unit: t.uid, to: u.uid });
        opp.target = u;
        opp.done = true;
        clash(B, u, act.skill, t, opp.skill);
        continue;
      }
      const defense = all.find((o) => o.u === t && !t.dead && !t.staggered && isDefense(o.skill) && !o.broken);
      if (defense) {
        defenseClash(B, u, act.skill, t, defense);
        continue;
      }
      // unopposed
      emit(B, { type: 'oneSided', att: u.uid, def: t.uid, skill: act.skill.id });
      fire(B, 'onSkillUse', u, { target: t, skill: act.skill, clash: false });
      runSkillEffects(B, 'onUse', u, t, act.skill, {});
      addSinResource(B, u, act.skill);
      attack(B, u, act.skill, t, makeCoins(act.skill), 0, null, 0);
    }

    if (!B.result) endTurn(B);
    return { events: B.events, result: B.result };
  }

  function defenseClash(B, att, sa, def, defAct) {
    const sd = defAct.skill;
    emit(B, { type: 'clashStart', a: att.uid, b: def.uid, sa: sa.id, sb: sd.id, defense: sd.type });
    fire(B, 'onSkillUse', att, { target: def, skill: sa, clash: true });
    if (!defAct.used) { fire(B, 'onSkillUse', def, { target: att, skill: sd, clash: true }); runSkillEffects(B, 'onUse', def, att, sd, {}); defAct.used = true; }
    runSkillEffects(B, 'onUse', att, def, sa, {});
    const ka = makeCoins(sa);
    const kd = makeCoins(sd);
    let count = 0;
    let lastDefPower = 0;
    while (liveCoins(ka).length && liveCoins(kd).length && count < MAX_CLASH_ROUNDS) {
      const ra = rollPower(B, att, sa, ka, def, 'clash');
      const rd = rollPower(B, def, sd, kd, att, 'clash');
      count++;
      lastDefPower = rd.power;
      let winner = null;
      if (ra.power > rd.power) { breakCoin(kd); winner = att.uid; } else if (rd.power > ra.power) { breakCoin(ka); winner = def.uid; }
      emit(B, {
        type: 'clashRound', round: count,
        a: { uid: att.uid, power: ra.power, flips: ra.flips, coins: liveCoins(ka).length, states: coinStates(ka) },
        b: { uid: def.uid, power: rd.power, flips: rd.flips, coins: liveCoins(kd).length, states: coinStates(kd) },
        winner,
      });
    }
    const attWon = !liveCoins(kd).length;
    const W = attWon ? att : def; const L = attWon ? def : att;
    W.sp = clamp(W.sp + CLASH_WIN_SP, SP_MIN, SP_MAX);
    emit(B, { type: 'clashEnd', winner: W.uid, loser: L.uid, count, skill: attWon ? sa.id : sd.id });
    fire(B, 'onClashWin', W, { opponent: L, target: L, skill: attWon ? sa : sd, clashCount: count });
    fire(B, 'onClashLose', L, { opponent: W, target: W, skill: attWon ? sd : sa, clashCount: count });
    runSkillEffects(B, 'onClashWin', W, L, attWon ? sa : sd, {});
    runSkillEffects(B, 'onClashLose', L, W, attWon ? sd : sa, {});
    if (attWon) {
      defAct.broken = true;
      // Guard that lost still absorbs damage equal to its last power.
      const shield = sd.type === 'guard' ? lastDefPower : 0;
      if (shield) log(B, `${def.name}의 수비가 피해 ${shield}을(를) 흡수한다.`);
      attack(B, att, sa, def, usableCoins(ka), count, shield, brokenCount(ka));
      unbreakableStrike(B, def, sd, kd, att);
    } else {
      if (sd.type === 'counter') attack(B, def, sd, att, usableCoins(kd), count, null, brokenCount(kd));
      else if (sd.type === 'evade') log(B, `${def.name}이(가) 회피했다!`);
      else log(B, `${def.name}이(가) 공격을 막아냈다!`);
      // the attacker lost, but its unbreakable coins still strike
      unbreakableStrike(B, att, sa, ka, def);
    }
  }


  function endTurn(B) {
    emit(B, { type: 'turnEnd', turn: B.turn });
    for (const u of alive(B)) {
      fire(B, 'onTurnEnd', u, {});
      if (u.dead) continue;
      for (const id of Object.keys(u.statuses)) {
        const def = effectDef(B, id);
        if (def && def.turnOnly) delete u.statuses[id];
      }
      if (u.staggered && B.turn >= u.staggerUntil) {
        u.staggered = 0;
        emit(B, { type: 'staggerRecover', unit: u.uid });
      }
    }
    checkEnd(B);
  }

  // ---------------------------------------------------------------------------
  // Public view (structured-clone friendly)
  // ---------------------------------------------------------------------------
  function view(B) {
    return {
      turn: B.turn,
      result: B.result,
      sinResources: B.sinResources,
      enemyActions: B.enemyActions.slice(),
      units: B.units.map((u) => ({
        uid: u.uid, team: u.team, name: u.name, charId: u.charId, hp: u.hp, maxHp: u.maxHp, sp: u.sp,
        speed: u.speed, staggered: u.staggered, dead: u.dead, level: u.level, defLevel: u.defLevel,
        thresholds: u.thresholds.slice(), hand: u.hand.slice(), defense: u.def.defense || null,
        statuses: Object.fromEntries(Object.entries(u.statuses).map(([k, v]) => [k, { potency: v.potency, count: v.count }])),
      })),
    };
  }

  function builtinStatusList() {
    return Object.entries(BUILTIN_STATUSES).map(([id, s]) => ({ id, name: s.name, color: s.color, desc: s.desc, turnOnly: !!s.turnOnly, builtin: true }));
  }

  /** Quick power preview (no RNG): min / max of a skill for a unit. */
  function powerRange(skill) {
    const b = skill.basePower || 0; const c = (skill.coinPower || 0) * (skill.coinCount || 1);
    return c >= 0 ? [b, b + c] : [Math.max(0, b + c), b];
  }

  global.LimbusEngine = {
    SINS, ATK_TYPES, SKILL_TYPES, HOOK_NAMES, BUILTIN_STATUSES: builtinStatusList(),
    createBattle, beginTurn, resolveTurn, view, validateEffect, powerRange, resistLabel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
