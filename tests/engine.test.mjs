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
