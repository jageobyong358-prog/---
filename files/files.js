// 게임 파일 둘러보기 — files/data/*.json (tools/drive_index.py 로 생성) 을 읽어
// 폴더 트리 · 검색 · 종류 필터 · 미리보기를 제공한다. 파일 자체는 Google Drive 에서 바로 불러온다.

const DATA = 'data/';
const PAGE = 240; // 한 번에 그리는 카드 수

const KINDS = [
  ['all', '전체', ''],
  ['image', '이미지', '🖼️'],
  ['audio', '오디오', '🎵'],
  ['video', '영상', '🎬'],
  ['font', '폰트', '🔤'],
  ['text', '텍스트', '📄'],
  ['other', '기타', '📦'],
];
const KIND_ICON = Object.fromEntries(KINDS.map(([k, , i]) => [k, i]));
KIND_ICON.folder = '📁';

const EXT = {
  image: 'png jpg jpeg gif webp bmp tga psd svg dds ktx',
  audio: 'wav mp3 ogg flac m4a aac opus wem bank',
  video: 'mp4 webm mov avi mkv usm',
  font: 'ttf otf woff woff2 fnt',
  text: 'txt json csv xml yaml yml md html lua cs ini log tsv',
};
const EXT_KIND = {};
for (const [k, list] of Object.entries(EXT)) for (const e of list.split(' ')) EXT_KIND[e] = k;

function kindOf(name, mime) {
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.includes('font')) return 'font';
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('google-apps.document') || mime.includes('google-apps.spreadsheet')) return 'text';
  }
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_KIND[ext] || 'other';
}

// ---------- 데이터 ----------
const state = {
  manifest: null,
  root: null,          // 루트 폴더 노드
  byId: new Map(),     // id -> 노드
  all: [],             // 모든 파일 (검색용)
  allFolders: [],
  loaded: 0,
  folder: null,
  kind: 'all',
  sort: 'name',
  view: 'grid',
  query: '',
  list: [],            // 현재 화면에 보이는 항목
  shown: 0,
  viewing: -1,
  expanded: new Set(),
};

function mkFolder(name, id, date, parent) {
  const f = { type: 'folder', name, id, date, parent, children: null, files: 0 };
  state.byId.set(id, f);
  return f;
}

function ingest(items, parent) {
  const m = state.manifest;
  const children = [];
  let files = 0;
  for (const it of items) {
    if (Array.isArray(it[3])) {
      const f = mkFolder(it[0], it[1], m.dates[it[2]], parent);
      f.children = ingest(it[3], f);
      files += f.files;
      children.push(f);
      state.allFolders.push(f);
    } else {
      const mime = m.mimes[it[2]] || '';
      const file = { type: 'file', name: it[0], id: it[1], mime, date: m.dates[it[3]], parent, kind: kindOf(it[0], mime) };
      state.byId.set(file.id, file);
      state.all.push(file);
      children.push(file);
      files++;
    }
  }
  parent.files = files;
  return children;
}

async function load() {
  const res = await fetch(DATA + 'manifest.json');
  if (!res.ok) throw new Error('manifest.json 을 불러오지 못했습니다');
  const m = state.manifest = await res.json();
  document.getElementById('src-title').textContent = `· ${m.title}`;
  document.title = `${m.title} · 게임 파일 둘러보기`;

  const root = state.root = mkFolder(m.title, m.root, '', null);
  root.children = [];
  for (const [name, id, date, count] of m.top) {
    const f = mkFolder(name, id, m.dates[date], root);
    f.files = count;
    f.pending = true;
    root.children.push(f);
    state.allFolders.push(f);
  }
  const rootFiles = ingest(m.files, { files: 0 });
  for (const f of rootFiles) f.parent = root;
  root.children.push(...rootFiles);
  root.files = m.top.reduce((s, t) => s + t[3], 0) + rootFiles.length;

  route();
  renderTree();

  // 최상위 폴더별 shard 를 병렬로 불러온다
  await Promise.all(m.top.map(async ([, id, , , shard]) => {
    try {
      const items = await (await fetch(DATA + shard)).json();
      const f = state.byId.get(id);
      f.children = ingest(items, f);
      f.pending = false;
    } catch (e) {
      console.error(e);
      state.byId.get(id).error = true;
    }
    state.loaded++;
    status();
    renderTree();
    const [want, vid] = decodeURIComponent(location.hash.slice(1)).split('/');
    if (want && state.folder.id !== want && state.byId.has(want)) route();
    else if (vid && $viewer.hidden && state.byId.has(vid)) route();
    else if (state.query || state.folder.id === id || state.folder === state.root) render();
  }));
}

function pathOf(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) parts.unshift(n);
  return parts;
}

// ---------- 라우팅 (#폴더ID 또는 #폴더ID/파일ID) ----------
function route() {
  const [fid, vid] = decodeURIComponent(location.hash.slice(1)).split('/');
  const node = state.byId.get(fid);
  const folder = node && node.type === 'folder' ? node : state.root;
  if (state.folder !== folder || !state.list.length) {
    state.folder = folder;
    let n = folder.parent;
    while (n) { state.expanded.add(n.id); n = n.parent; }
    render();
    renderTree();
  }
  if (vid) {
    const i = state.list.findIndex((x) => x.id === vid);
    if (i >= 0) openViewer(i, false);
    else if (state.byId.get(vid)?.type === 'file') {
      state.list = [state.byId.get(vid)];
      openViewer(0, false);
    }
  } else if (!document.getElementById('viewer').hidden) closeViewer(false);
}
addEventListener('hashchange', route);

function go(folder) {
  state.query = '';
  document.getElementById('q').value = '';
  document.getElementById('tree').classList.remove('open');
  if (location.hash.slice(1) === folder.id) route();
  else location.hash = folder.id;
  document.querySelector('.main').scrollTop = 0;
}

// ---------- 렌더링 ----------
const $items = document.getElementById('items');
const $more = document.getElementById('more');

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}

function currentItems() {
  let items;
  if (state.query) {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (x) => { const n = x.name.toLowerCase(); return terms.every((t) => n.includes(t)); };
    items = [...state.allFolders.filter(match), ...state.all.filter(match)];
  } else {
    items = state.folder.children || [];
  }
  const counts = { all: 0 };
  for (const x of items) if (x.type === 'file') { counts[x.kind] = (counts[x.kind] || 0) + 1; counts.all++; }
  if (state.kind !== 'all') items = items.filter((x) => x.type === 'file' && x.kind === state.kind);
  if (state.sort === 'kind') {
    const order = KINDS.map((k) => k[0]);
    items = [...items].sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1)
      || order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
  }
  return { items, counts };
}

function render() {
  if (!state.folder) return;
  const { items, counts } = currentItems();
  state.list = items;
  state.shown = 0;
  $items.replaceChildren();
  renderCrumbs();
  renderChips(counts);
  status();
  if (!items.length) {
    const loading = state.query ? state.loaded < state.manifest.top.length : state.folder.pending;
    $items.append(h('div', { class: 'empty' }, loading ? '불러오는 중…' : state.query ? '검색 결과가 없습니다' : '비어 있는 폴더입니다'));
  }
  more();
}

function more() {
  const end = Math.min(state.list.length, state.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (let i = state.shown; i < end; i++) frag.append(card(state.list[i], i));
  $items.append(frag);
  state.shown = end;
  $more.textContent = end < state.list.length ? `${end.toLocaleString()} / ${state.list.length.toLocaleString()} · 스크롤하면 더 불러옵니다` : '';
}

new IntersectionObserver((es) => {
  if (es.some((e) => e.isIntersecting) && state.shown < state.list.length) more();
}, { root: document.querySelector('.main'), rootMargin: '600px' }).observe($more);

function thumbUrl(id, w) { return `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`; }

function card(x, i) {
  const isFolder = x.type === 'folder';
  const thumb = h('div', { class: 'thumb' });
  if (!isFolder && (x.kind === 'image' || x.kind === 'video')) {
    const img = h('img', { loading: 'lazy', alt: '', src: thumbUrl(x.id, 320) });
    img.onerror = () => img.replaceWith(h('span', { class: 'ico' }, KIND_ICON[x.kind]));
    thumb.append(img);
  } else {
    thumb.append(h('span', { class: 'ico' }, isFolder ? '📁' : KIND_ICON[x.kind]));
  }
  let sub;
  if (state.query) sub = pathOf(x.parent).slice(1).map((n) => n.name).join(' / ') || state.root.name;
  else sub = isFolder ? `${x.pending ? '…' : x.files.toLocaleString()}개 파일` : (x.date || '');
  return h('button', {
    class: `card ${isFolder ? 'folder' : x.kind}`,
    title: x.name,
    onclick: () => (isFolder ? go(x) : openViewer(i)),
  }, thumb, h('div', { class: 'meta' }, h('div', { class: 'nm' }, x.name), h('div', { class: 'sub' }, sub)));
}

function renderCrumbs() {
  const el = document.getElementById('crumbs');
  if (state.query) {
    el.replaceChildren(h('button', { onclick: () => go(state.folder) }, '← 폴더로'), h('span', { class: 'sep' }, '›'), h('button', {}, `"${state.query}" 검색 결과`));
    return;
  }
  const parts = pathOf(state.folder);
  el.replaceChildren(...parts.flatMap((n, i) => [
    i ? h('span', { class: 'sep' }, '›') : null,
    h('button', { onclick: () => go(n) }, i ? n.name : '🏠 ' + n.name),
  ].filter(Boolean)));
}

function renderChips(counts) {
  const el = document.getElementById('kinds');
  el.replaceChildren(...KINDS.filter(([k]) => k === 'all' || counts[k] || state.kind === k).map(([k, label, ico]) =>
    h('button', { class: `chip ${state.kind === k ? 'active' : ''}`, onclick: () => { state.kind = k; render(); } },
      `${ico} ${label}`.trim(), h('span', { class: 'n' }, (counts[k] || 0).toLocaleString()))));
}

function status() {
  const m = state.manifest;
  if (!m) return;
  const total = state.root.files.toLocaleString();
  const loading = state.loaded < m.top.length ? ` · 색인 불러오는 중 ${state.loaded}/${m.top.length}` : '';
  const here = state.query ? `검색 결과 ${state.list.length.toLocaleString()}개` : `이 폴더 ${state.list.length.toLocaleString()}개 항목`;
  document.getElementById('status').textContent = `${here} · 전체 ${total}개 파일 · 색인 ${m.built}${loading}`;
}

// ---------- 폴더 트리 ----------
const $tree = document.getElementById('tree');
function renderTree() {
  const rows = [];
  const walk = (n, depth) => {
    const sub = (n.children || []).filter((c) => c.type === 'folder');
    const open = n === state.root || state.expanded.has(n.id);
    const canOpen = sub.length > 0 || n.pending;
    rows.push(h('div', {
      class: `t-row ${n === state.folder && !state.query ? 'active' : ''}`,
      style: `padding-left:${8 + depth * 14}px`,
      onclick: () => go(n),
    },
    h('span', {
      class: 't-caret',
      onclick: (e) => {
        if (!canOpen || n === state.root) return;
        e.stopPropagation();
        state.expanded[open ? 'delete' : 'add'](n.id);
        renderTree();
      },
    }, canOpen && n !== state.root ? (open ? '▾' : '▸') : ''),
    h('span', { class: 't-name' }, n === state.root ? '🏠 ' + n.name : n.name),
    h('span', { class: 't-count' }, n.pending ? '…' : n.files.toLocaleString())));
    if (open) for (const c of sub) walk(c, depth + 1);
  };
  walk(state.root, 0);
  $tree.replaceChildren(...rows);
}
document.getElementById('tree-toggle').onclick = () => $tree.classList.toggle('open');

// ---------- 검색 / 보기 ----------
let qTimer;
document.getElementById('q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
    renderTree();
    document.querySelector('.main').scrollTop = 0;
  }, 200);
});
document.getElementById('sort').onchange = (e) => { state.sort = e.target.value; render(); };
for (const b of document.querySelectorAll('.seg button')) {
  b.onclick = () => {
    state.view = b.dataset.view;
    for (const o of document.querySelectorAll('.seg button')) o.classList.toggle('active', o === b);
    $items.className = `items ${state.view}`;
    try { localStorage.setItem('files.view', state.view); } catch {}
  };
}
try { const v = localStorage.getItem('files.view'); if (v) document.querySelector(`.seg [data-view="${v}"]`)?.click(); } catch {}

// ---------- 미리보기 ----------
const $viewer = document.getElementById('viewer');
const $vbody = document.getElementById('v-body');

function driveUrls(x) {
  if (x.mime.includes('google-apps.document')) return { open: `https://docs.google.com/document/d/${x.id}/edit`, preview: `https://docs.google.com/document/d/${x.id}/preview`, dl: `https://docs.google.com/document/d/${x.id}/export?format=pdf` };
  if (x.mime.includes('google-apps.spreadsheet')) return { open: `https://docs.google.com/spreadsheets/d/${x.id}/edit`, preview: `https://docs.google.com/spreadsheets/d/${x.id}/preview`, dl: `https://docs.google.com/spreadsheets/d/${x.id}/export?format=xlsx` };
  return {
    open: `https://drive.google.com/file/d/${x.id}/view`,
    preview: `https://drive.google.com/file/d/${x.id}/preview`,
    dl: `https://drive.google.com/uc?export=download&id=${x.id}`,
  };
}

function iframe(src) { return h('iframe', { src, allow: 'autoplay; fullscreen', allowfullscreen: '' }); }

function openViewer(i, push = true) {
  const x = state.list[i];
  if (!x) return;
  if (x.type === 'folder') { go(x); return; }
  state.viewing = i;
  const u = driveUrls(x);
  document.getElementById('v-icon').textContent = KIND_ICON[x.kind];
  document.getElementById('v-name').textContent = x.name;
  document.getElementById('v-path').textContent = pathOf(x.parent).map((n) => n.name).join(' / ');
  document.getElementById('v-open').href = u.open;
  document.getElementById('v-dl').href = u.dl;
  document.getElementById('v-prev').disabled = !nextFile(-1);
  document.getElementById('v-next').disabled = !nextFile(1);

  let body;
  if (x.kind === 'image') {
    body = h('img', { src: thumbUrl(x.id, 2000), alt: x.name });
    body.onerror = () => body.replaceWith(iframe(u.preview));
  } else if (x.kind === 'audio') {
    const audio = h('audio', { controls: '', autoplay: '', preload: 'auto', src: u.dl });
    const box = h('div', { class: 'v-audio' }, h('div', { class: 'big' }, '🎵'), audio,
      h('div', { class: 'v-note' }, '재생이 안 되면 Drive 미리보기로 전환됩니다.'));
    audio.onerror = () => box.replaceWith(iframe(u.preview));
    body = box;
  } else if (x.kind === 'font') {
    body = fontPreview(x, u);
  } else {
    body = iframe(u.preview);
  }
  $vbody.replaceChildren(body);
  $viewer.hidden = false;
  if (push) history.replaceState(null, '', `#${state.folder.id}/${x.id}`);
}

function fontPreview(x, u) {
  const sample = h('div', { style: 'font-size:40px;line-height:1.4;text-align:center;word-break:break-all' },
    'ABCDEFGHIJKLM nopqrstuvwxyz 0123456789', h('br'), '가나다라마바사 あいうえお 林巴斯');
  const note = h('div', { class: 'v-note' }, '폰트를 불러오는 중…');
  const family = `f_${x.id.replace(/[^a-z0-9]/gi, '')}`;
  new FontFace(family, `url(${u.dl})`).load().then((ff) => {
    document.fonts.add(ff);
    sample.style.fontFamily = `"${family}"`;
    note.textContent = x.name;
  }).catch(() => {
    note.textContent = 'Drive 는 브라우저에서 폰트를 직접 불러오는 것을 막습니다. 다운로드해서 확인하세요.';
    sample.style.opacity = 0.35;
  });
  return h('div', { class: 'v-audio' }, sample, note);
}

function nextFile(dir) {
  for (let j = state.viewing + dir; j >= 0 && j < state.list.length; j += dir) {
    if (state.list[j].type === 'file') return j;
  }
  return null;
}
function step(dir) {
  const j = nextFile(dir);
  if (j == null) return;
  while (j >= state.shown) more();
  openViewer(j);
}

function closeViewer(push = true) {
  $viewer.hidden = true;
  $vbody.replaceChildren();
  state.viewing = -1;
  if (push) history.replaceState(null, '', `#${state.folder.id}`);
}

document.getElementById('v-close').onclick = () => closeViewer();
document.getElementById('v-prev').onclick = () => step(-1);
document.getElementById('v-next').onclick = () => step(1);
addEventListener('keydown', (e) => {
  if ($viewer.hidden) {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('q').focus(); }
    return;
  }
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

load().catch((e) => {
  document.getElementById('status').textContent = '';
  $items.replaceChildren(h('div', { class: 'empty' }, `색인을 불러오지 못했습니다: ${e.message}`));
});
