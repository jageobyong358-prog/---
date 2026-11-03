// Merged content library: built-in < live (content/live.json) < test (admin device) < user's own items.
import { DEFAULT_CHARACTERS, DEFAULT_SKILLS, DEFAULT_EFFECTS } from './defaults.js';
import { userStore, testStore, loadLiveContent } from './store.js';
import { currentServer } from './config.js';

const KINDS = { character: 'characters', skill: 'skills', effect: 'effects' };

export const lib = { characters: [], skills: [], effects: [] };
let liveItems = [];
const listeners = new Set();
export function onLibChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(lib); }

// Stored items carry `cat` (character | skill | effect). Effects also have their own
// `kind` (keyword | passive). Older saves put the category into `kind`, which wiped
// the effect kind; catOf/normalize read both shapes.
function catOf(item) {
  if (KINDS[item.cat]) return item.cat;
  if (KINDS[item.kind]) return item.kind;
  return null;
}

function put(map, item, source) {
  const cat = catOf(item);
  const k = KINDS[cat];
  if (!k) return;
  item = { ...item, cat };
  const prev = map[k].get(item.id);
  // base: the layer this item overrides (e.g. a built-in skill the player renamed)
  const base = prev ? (prev.source === 'user' ? prev.base : prev.source) : undefined;
  map[k].set(item.id, Object.assign({}, item, { source, base }));
}

export async function loadLibrary() {
  const map = { characters: new Map(), skills: new Map(), effects: new Map() };
  for (const c of DEFAULT_CHARACTERS) put(map, { ...c, cat: 'character' }, 'builtin');
  for (const s of DEFAULT_SKILLS) put(map, { ...s, cat: 'skill' }, 'builtin');
  for (const e of DEFAULT_EFFECTS) put(map, { ...e, cat: 'effect' }, 'builtin');
  const errors = [];
  const safe = async (p) => { try { return await p; } catch (e) { errors.push(e.message); return []; } };
  liveItems = await safe(loadLiveContent());
  for (const it of liveItems) put(map, it, 'live');
  if (currentServer() === 'test') for (const it of await safe(testStore().list())) put(map, it, 'test');
  for (const it of await safe(userStore().list())) put(map, it, 'user');
  lib.characters = [...map.characters.values()];
  lib.skills = [...map.skills.values()];
  lib.effects = [...map.effects.values()];
  // repair effects saved by older versions (kind was overwritten with 'effect')
  const usedAsPassive = new Set(lib.characters.flatMap((c) => c.passives || []));
  for (const e of lib.effects) {
    if (e.kind !== 'keyword' && e.kind !== 'passive') e.kind = usedAsPassive.has(e.id) || /^pv_/.test(e.id) ? 'passive' : 'keyword';
  }
  emit();
  return errors;
}

export const getChar = (id) => lib.characters.find((c) => c.id === id);
export const getSkill = (id) => lib.skills.find((s) => s.id === id);
export const getEffect = (id) => lib.effects.find((e) => e.id === id);

function strip(item) {
  const o = { ...item };
  delete o.source;
  delete o.base;
  return o;
}

function stored(cat, item) {
  const it = strip({ ...item, cat, updatedAt: Date.now() });
  if (cat !== 'effect' || (it.kind !== 'keyword' && it.kind !== 'passive')) {
    if (cat === 'effect') it.kind = 'keyword'; else delete it.kind;
  }
  return it;
}

export async function saveItem(cat, item) {
  const it = stored(cat, item);
  await userStore().save(it);
  const arr = lib[KINDS[cat]];
  const i = arr.findIndex((x) => x.id === it.id);
  const prev = arr[i];
  const withSrc = { ...it, source: 'user', base: prev ? (prev.source === 'user' ? prev.base : prev.source) : undefined };
  if (i >= 0) arr[i] = withSrc; else arr.push(withSrc);
  emit();
  return withSrc;
}

export async function deleteItem(kind, id) {
  await userStore().remove(id);
  await loadLibrary();
}

// ----- test server (admin device) / live file ---------------------------------
export async function saveTestItem(cat, item) {
  const it = stored(cat, item);
  await testStore().save(it);
  return it;
}
export const listTestItems = () => testStore().list();
export const deleteTestItem = (id) => testStore().remove(id);
export const listLiveItems = () => liveItems.slice();

/** Build the content/live.json file text from a list of items. */
export function liveFileText(items) {
  const clean = items.map(strip).sort((a, b) => (catOf(a) + a.id).localeCompare(catOf(b) + b.id));
  return `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: clean }, null, 2)}\n`;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
