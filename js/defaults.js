// Built-in sample content (original characters, not from any existing game).

const S = (o) => Object.assign({
  type: 'attack', atkType: 'slash', sin: 'wrath', basePower: 4, coinPower: 3, coinCount: 2,
  offLevel: 0, defLevelBonus: 0, effects: [], messages: [], vfx: null, image: null, desc: '', source: 'builtin',
}, o);

export const DEFAULT_SKILLS = [
  // --- 붉은 칼날 아린 ---
  S({ id: 'sk_arin1', name: '베어 넘기기', sin: 'wrath', atkType: 'slash', basePower: 4, coinPower: 4, coinCount: 2,
    desc: '[적중 시] 화상 1 부여', effects: [{ when: 'onHit', do: 'inflict', status: 'burn', potency: 1, count: 1, who: 'target' }] }),
  S({ id: 'sk_arin2', name: '홍염 연참', sin: 'lust', atkType: 'slash', basePower: 5, coinPower: 3, coinCount: 3,
    desc: '[앞면 적중 시] 화상 2 부여', effects: [{ when: 'onHeads', do: 'inflict', status: 'burn', potency: 2, count: 1, who: 'target' }],
    messages: [{ trigger: 'clashStart', text: '타올라라!', color: '#ff5522' }] }),
  S({ id: 'sk_arin3', name: '업화 일섬', sin: 'wrath', atkType: 'slash', basePower: 6, coinPower: 5, coinCount: 3, offLevel: 2,
    desc: '[사용 시] 피해량 증가 2 / [적중 시] 화상 3 부여',
    effects: [
      { when: 'onUse', do: 'inflict', status: 'damageUp', potency: 2, count: 1, who: 'self' },
      { when: 'onHit', do: 'inflict', status: 'burn', potency: 3, count: 1, who: 'target' },
    ],
    messages: [{ trigger: 'skillUse', text: '모두 재가 되어라', color: '#ff2a00' }, { trigger: 'clashWin', text: '업화여!!', color: '#ffb000' }] }),
  S({ id: 'sk_arin_g', name: '칼날 막기', type: 'guard', sin: 'pride', atkType: 'slash', basePower: 6, coinPower: 3, coinCount: 1, desc: '수비 스킬' }),

  // --- 쇠망치 도건 ---
  S({ id: 'sk_do1', name: '내려찍기', sin: 'sloth', atkType: 'blunt', basePower: 5, coinPower: 2, coinCount: 2,
    desc: '[적중 시] 진동 2 부여', effects: [{ when: 'onHit', do: 'inflict', status: 'tremor', potency: 2, count: 1, who: 'target' }] }),
  S({ id: 'sk_do2', name: '지면 강타', sin: 'gluttony', atkType: 'blunt', basePower: 5, coinPower: 3, coinCount: 2, weight: 2,
    desc: '가중치 2 / [적중 시] 진동 3 부여 / [2번째 코인 적중] 진동 폭발',
    effects: [
      { when: 'onHit', do: 'inflict', status: 'tremor', potency: 3, count: 1, who: 'target' },
      { when: 'onHit', coin: 2, do: 'tremorBurst', who: 'target' },
    ] }),
  S({ id: 'sk_do3', name: '대지 붕괴', sin: 'sloth', atkType: 'blunt', basePower: 8, coinPower: 4, coinCount: 2, offLevel: 3, unbreakable: [false, true],
    desc: '2번째 코인 파괴 불가 / [적중 시] 진동 폭발 / [합 승리 시] 다음 턴 보호 2',
    effects: [
      { when: 'onHit', do: 'tremorBurst', who: 'target' },
      { when: 'onClashWin', do: 'inflict', status: 'protection', potency: 2, count: 1, who: 'self', nextTurn: true },
    ],
    messages: [{ trigger: 'clashStart', text: '무너져라!', color: '#e8c61e' }] }),
  S({ id: 'sk_do_g', name: '단단한 방패', type: 'guard', sin: 'sloth', atkType: 'blunt', basePower: 8, coinPower: 2, coinCount: 1, desc: '수비 스킬' }),

  // --- 은침 세라 ---
  S({ id: 'sk_se1', name: '찌르기', sin: 'gloom', atkType: 'pierce', basePower: 3, coinPower: 4, coinCount: 2,
    desc: '[사용 시] 호흡 2 획득', effects: [{ when: 'onUse', do: 'inflict', status: 'poise', potency: 2, count: 1, who: 'self' }] }),
  S({ id: 'sk_se2', name: '삼연 관통', sin: 'envy', atkType: 'pierce', basePower: 3, coinPower: 3, coinCount: 3,
    desc: '[앞면 적중 시] 출혈 2 부여', effects: [{ when: 'onHeads', do: 'inflict', status: 'bleed', potency: 2, count: 1, who: 'target' }] }),
  S({ id: 'sk_se3', name: '은빛 섬광', sin: 'gloom', atkType: 'pierce', basePower: 4, coinPower: 6, coinCount: 2, offLevel: 2,
    desc: '[사용 시] 호흡 4 획득 / [치명타 시] 출혈 3 부여',
    effects: [
      { when: 'onUse', do: 'inflict', status: 'poise', potency: 4, count: 2, who: 'self' },
      { when: 'onCrit', do: 'inflict', status: 'bleed', potency: 3, count: 2, who: 'target' },
    ],
    messages: [{ trigger: 'clashWin', text: '보이지 않았지?', color: '#9fe8ff' }] }),
  S({ id: 'sk_se_e', name: '흘려 넘기기', type: 'evade', sin: 'gloom', atkType: 'pierce', basePower: 5, coinPower: 4, coinCount: 1, desc: '회피 스킬' }),

  // --- 적: 녹슨 기계병 ---
  S({ id: 'sk_mech1', name: '드릴 찌르기', sin: 'pride', atkType: 'pierce', basePower: 4, coinPower: 3, coinCount: 2,
    desc: '[적중 시] 파열 1 부여', effects: [{ when: 'onHit', do: 'inflict', status: 'rupture', potency: 1, count: 2, who: 'target' }] }),
  S({ id: 'sk_mech2', name: '증기 분사', sin: 'sloth', atkType: 'blunt', basePower: 5, coinPower: 2, coinCount: 3 }),
  S({ id: 'sk_mech3', name: '과부하 돌진', sin: 'wrath', atkType: 'blunt', basePower: 7, coinPower: 4, coinCount: 2, offLevel: 2,
    messages: [{ trigger: 'skillUse', text: 'ERROR - OVERLOAD', color: '#ff3355' }] }),

  // --- 적: 심연의 사제 ---
  S({ id: 'sk_pr1', name: '침잠의 기도', sin: 'gloom', atkType: 'blunt', basePower: 4, coinPower: 3, coinCount: 2,
    desc: '[적중 시] 침잠 2 부여', effects: [{ when: 'onHit', do: 'inflict', status: 'sinking', potency: 2, count: 2, who: 'target' }] }),
  S({ id: 'sk_pr2', name: '검은 낫', sin: 'envy', atkType: 'slash', basePower: 8, coinPower: -2, coinCount: 2, unbreakable: [true, true],
    desc: '마이너스·파괴 불가 코인 / 깨진 코인 1개당 최종 위력 -2 / [적중 시] 다음 턴 취약 1',
    effects: [
      { when: 'power', do: 'powerPerBroken', value: -2 },
      { when: 'onHit', do: 'inflict', status: 'fragile', potency: 1, count: 1, who: 'target', nextTurn: true },
    ] }),
  S({ id: 'sk_pr3', name: '심연 강림', sin: 'gloom', atkType: 'pierce', basePower: 5, coinPower: 4, coinCount: 3, offLevel: 4, weight: 3,
    desc: '가중치 3 / [사용 시] 모든 적에게 침잠 2 부여', effects: [{ when: 'onUse', do: 'inflict', status: 'sinking', potency: 2, count: 1, who: 'enemies' }],
    messages: [{ trigger: 'skillUse', text: '가라앉아라...', color: '#4a7dff' }] }),
];

const C = (o) => Object.assign({
  maxHp: 120, speed: [3, 6], level: 40, defLevel: 38, stagger: [0.6, 0.3],
  resist: { slash: 1, pierce: 1, blunt: 1 }, sinResist: {}, passives: [], messages: [], image: null, source: 'builtin',
}, o);

export const DEFAULT_CHARACTERS = [
  C({ id: 'ch_arin', name: '아린', title: '붉은 칼날', maxHp: 135, speed: [4, 7], level: 42, defLevel: 40,
    resist: { slash: 0.5, pierce: 1.5, blunt: 1 },
    skills: [{ id: 'sk_arin1', copies: 3 }, { id: 'sk_arin2', copies: 2 }, { id: 'sk_arin3', copies: 1 }], defense: 'sk_arin_g',
    passives: ['pv_ember'] }),
  C({ id: 'ch_dogeon', name: '도건', title: '쇠망치', maxHp: 170, speed: [2, 5], level: 40, defLevel: 43, stagger: [0.55, 0.25],
    resist: { slash: 1, pierce: 0.5, blunt: 1.5 },
    skills: [{ id: 'sk_do1', copies: 3 }, { id: 'sk_do2', copies: 2 }, { id: 'sk_do3', copies: 1 }], defense: 'sk_do_g' }),
  C({ id: 'ch_sera', name: '세라', title: '은침', maxHp: 110, speed: [5, 8], level: 43, defLevel: 37,
    resist: { slash: 1.5, pierce: 1, blunt: 0.5 },
    skills: [{ id: 'sk_se1', copies: 3 }, { id: 'sk_se2', copies: 2 }, { id: 'sk_se3', copies: 1 }], defense: 'sk_se_e' }),
  C({ id: 'en_mech', name: '녹슨 기계병', title: '적', maxHp: 150, speed: [2, 5], level: 39, defLevel: 39,
    resist: { slash: 0.5, pierce: 1, blunt: 1.5 }, sinResist: { wrath: 0.75, gloom: 1.5 },
    skills: [{ id: 'sk_mech1', copies: 3 }, { id: 'sk_mech2', copies: 2 }, { id: 'sk_mech3', copies: 1 }] }),
  C({ id: 'en_priest', name: '심연의 사제', title: '적', maxHp: 130, speed: [3, 6], level: 41, defLevel: 38,
    resist: { slash: 1.5, pierce: 0.5, blunt: 1 }, sinResist: { pride: 1.5, gloom: 0.5 },
    skills: [{ id: 'sk_pr1', copies: 3 }, { id: 'sk_pr2', copies: 2 }, { id: 'sk_pr3', copies: 1 }] }),
];

// A sample AI-style custom passive, written against the effect hook API.
export const DEFAULT_EFFECTS = [
  {
    id: 'pv_ember', kind: 'passive', name: '잔불', color: '#ff7a3a', source: 'builtin',
    desc: '합 승리 시, 합 상대의 화상 위력만큼 피해량 +% (최대 30%). 턴 시작 시 화상 상태의 적이 있으면 정신력 +3.',
    hooks: {
      onClashWin: 'const b = api.getStatus(ctx.opponent, "burn");\nctx.self.vars.emberBonus = b ? Math.min(30, b.potency * 5) : 0;',
      beforeHit: 'if (ctx.self.vars.emberBonus) ctx.addDamagePct(ctx.self.vars.emberBonus);',
      onTurnEnd: 'ctx.self.vars.emberBonus = 0;',
      onTurnStart: 'if (api.enemiesOf(ctx.self).some(e => api.getStatus(e, "burn"))) api.gainSP(ctx.self, 3);',
    },
  },
];
