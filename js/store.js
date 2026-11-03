// Persistence (no accounts): everything is stored on this device.
//  - 'items' : the player's own content (IndexedDB)
//  - 'test'  : test-server content made by the admin on this device (IndexedDB)
//  - live    : content/live.json shipped with the site (read-only at runtime)
import { CONFIG } from './config.js';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('limbus-sim', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('test')) db.createObjectStore('test', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function idbStore(name) {
  const tx = async (mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    list: () => tx('readonly', (s) => s.getAll()),
    save: (item) => tx('readwrite', (s) => s.put(item)),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
  };
}

export const userStore = () => idbStore('items');
export const testStore = () => idbStore('test');

/** Live content shipped with the site: content/live.json */
export async function loadLiveContent() {
  const r = await fetch(new URL('../content/live.json', import.meta.url), { cache: 'no-cache' });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data.items) ? data.items : [];
}

// ---------------------------------------------------------------------------
// Admin (admin code, checked against a SHA-256 hash in config.js; remembered on this device)
// ---------------------------------------------------------------------------
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function isAdmin() {
  try { return !!CONFIG.adminPasswordHash && localStorage.getItem('lbs.admin') === CONFIG.adminPasswordHash; } catch { return false; }
}
export async function adminLogin(password) {
  if (!CONFIG.adminPasswordHash) return false;
  const ok = (await sha256Hex(password)) === CONFIG.adminPasswordHash.toLowerCase();
  if (ok) { try { localStorage.setItem('lbs.admin', CONFIG.adminPasswordHash); } catch { /* ignore */ } }
  return ok;
}
export function adminLogout() { try { localStorage.removeItem('lbs.admin'); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// Settings stay on this device.
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { apiKey: '', effort: 'medium', autoVfx: true, speed: 1 };
export const settings = {
  get() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('lbs.settings') || '{}')); } catch { return { ...DEFAULT_SETTINGS }; }
  },
  set(patch) {
    const s = Object.assign(settings.get(), patch);
    try { localStorage.setItem('lbs.settings', JSON.stringify(s)); } catch { /* ignore */ }
    return s;
  },
};

/** Resize an uploaded image file to a compact data URL. */
export function imageToDataUrl(file, max = 384) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.'));
    img.src = URL.createObjectURL(file);
  });
}
