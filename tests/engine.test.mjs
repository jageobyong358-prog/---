// Run: node tests/engine.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { DEFAULT_SKILLS, DEFAULT_CHARACTERS, DEFAULT_EFFECTS } from '../js/defaults.js';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/engine/engine.js', import.meta.url), 'utf8'), ctx);
const E = ctx.LimbusEngine;
const skills = Object.fromEntries(DEFAULT_SKILLS.map((s) => [s.id, s]));
const effects = Object.fromEntries(DEFAULT_EFFECTS.map((e) => [e.id, e]));
const ch = (id) => DEFAULT_CHARACTERS.find((c) => c.id === id);

let wins = 0, losses = 0, errors = 0, clashes = 0, hits = 0;
for (let seed = 1; seed <= 200; seed++) {
  const B = E.createBattle({ allies: [ch('ch_arin'), ch('ch_dogeon'), ch('ch_sera')], enemies: [ch('en_mech'), ch('en_priest')], skills, effects, seed });
  for (let t = 0; t < 40 && !B.result; t++) {
    E.beginTurn(B);
    const v = E.view(B);
    const enemies = v.units.filter((u) => u.team === 'enemy' && !u.dead);
    const acts = v.units.filter((u) => u.team === 'ally' && !u.dead && !u.staggered).map((u, i) => ({
      uid: u.uid, skillId: (seed + t) % 5 === 0 && u.defense ? u.defense : u.hand[0], targetUid: enemies[i % enemies.length]?.uid,
    }));
    const r = E.resolveTurn(B, acts);
    for (const ev of r.events) {
      if (ev.error) { errors++; console.log(ev.text); }
      if (ev.type === 'clashRound') clashes++;
      if (ev.type === 'hit') { hits++; assert.ok(Number.isFinite(ev.damage) && ev.damage >= 0); }
      // structured-clone safe
    }
    structuredClone(r.events);
  }
  if (B.result === 'win') wins++; else if (B.result === 'lose') losses++;
}
console.log({ wins, losses, errors, clashes, hits });
assert.equal(errors, 0);
assert.ok(wins + losses > 150, 'battles should finish');

// validation of custom effect code
assert.deepEqual([...E.validateEffect({ hooks: { onHit: 'api.log(1)' } })], []);
assert.equal(E.validateEffect({ hooks: { onHit: 'this is not js(' } }).length, 1);

// level/clash power: offense diff 6 => +2 clash power
console.log('ok');

// attack weight: a weight-3 skill hits 3 enemies with every coin
{
  const sk = { id: 'sk_w', name: '휩쓸기', type: 'attack', sin: 'wrath', atkType: 'slash', basePower: 5, coinPower: 3, coinCount: 2, weight: 3, effects: [] };
  const sk2 = { ...skills };
  sk2.sk_w = sk;
  const hero = { ...ch('ch_arin'), skills: [{ id: 'sk_w', copies: 3 }], passives: [] };
  const foe = { ...ch('en_mech'), maxHp: 999, skills: [{ id: 'sk_mech1', copies: 1 }] };
  const B = E.createBattle({ allies: [hero], enemies: [foe, foe, foe, foe], skills: sk2, effects, seed: 11 });
  E.beginTurn(B);
  B.enemyActions = []; // let the hero attack unopposed
  const v = E.view(B);
  const enemies = v.units.filter((u) => u.team === 'enemy');
  const r = E.resolveTurn(B, [{ uid: v.units[0].uid, skillId: 'sk_w', targetUid: enemies[1].uid }]);
  const hitTargets = r.events.filter((e) => e.type === 'hit').map((e) => e.def);
  const multi = r.events.find((e) => e.type === 'multiTarget');
  assert.deepEqual([...multi.targets], [enemies[1].uid, enemies[2].uid, enemies[3].uid]);
  assert.equal(hitTargets.length, 6, '2 coins x 3 targets');
  assert.equal(new Set(hitTargets).size, 3);
  console.log('weight ok', multi.targets);
}
