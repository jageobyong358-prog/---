#!/usr/bin/env python3
"""공개 Google Drive 폴더를 재귀적으로 훑어 files/data/*.json 인덱스를 만든다.

사용법:
    python3 tools/drive_index.py [폴더ID] [출력폴더=files/data]
    python3 tools/drive_index.py --from-tree tree.json [출력경로]   # 이미 크롤링한 원본으로 변환만

로그인 없이 공개(링크가 있는 모든 사용자) 폴더의 embeddedfolderview 페이지만 사용한다.
"""
import concurrent.futures as cf
import html
import json
import os
import re
import ssl
import sys
import time
import urllib.request

DEFAULT_ROOT = '1Nk9WWMxEcovs5Ewku5ICT1PbfByNcV_z'
DEFAULT_OUT = os.path.join(os.path.dirname(__file__), '..', 'files', 'data')


def _ctx():
    ca = os.environ.get('SSL_CERT_FILE') or ('/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None)
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


CTX = _ctx()


def fetch(fid):
    err = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(f'https://drive.google.com/embeddedfolderview?id={fid}',
                                         headers={'User-Agent': 'Mozilla/5.0 drive-index'})
            with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 ** attempt)
    print('FAIL', fid, err, file=sys.stderr)
    return ''


def _g(pattern, s):
    m = re.search(pattern, s, re.S)
    return m.group(1) if m else ''


def parse(page):
    out = []
    for part in page.split('<div class="flip-entry" id="entry-')[1:]:
        fid = part.split('"', 1)[0]
        href = _g(r'<a href="([^"]+)"', part)
        folder = '/folders/' in href
        out.append({
            'id': fid,
            'name': html.unescape(_g(r'flip-entry-title">([^<]*)<', part)),
            'mime': 'folder' if folder else _g(r'/type/([^"]+)"', part),
            'mod': _g(r'flip-entry-last-modified"><div>([^<]*)<', part),
            'folder': folder,
        })
    return out


def crawl(root):
    tree, pending = {}, [root]
    with cf.ThreadPoolExecutor(16) as ex:
        while pending:
            results = list(ex.map(lambda f: (f, parse(fetch(f))), pending))
            pending = []
            for fid, children in results:
                tree[fid] = children
                pending += [c['id'] for c in children if c['folder'] and c['id'] not in tree]
            print(len(tree), 'folders', sum(len(v) for v in tree.values()), 'entries', file=sys.stderr)
    return tree


def title_of(root):
    return html.unescape(_g(r'<title>([^<]*)</title>', fetch(root))) or 'Drive'


def to_index(tree, root, title):
    """압축 형식으로 변환.

    manifest.json: {title, root, built, mimes:[...], dates:[...], top:[[이름, id, 날짜#, 파일수, shard 파일명 또는 null]...]}
    각 shard(최상위 폴더 하나): 하위 항목 배열.
      파일   = [이름, id, mime#, 날짜#]
      폴더   = [이름, id, 날짜#, [하위 항목...]]
    최상위의 파일(폴더가 아닌 것)은 manifest.files 에 같은 파일 형식으로 들어간다.
    """
    mimes, dates = {}, {}

    def mi(v):
        return mimes.setdefault(v, len(mimes))

    def di(v):
        return dates.setdefault(v, len(dates))

    def build(fid, seen):
        items = []
        for c in sorted(tree.get(fid, []), key=lambda c: (not c['folder'], c['name'].lower())):
            if c['folder']:
                if c['id'] in seen:
                    continue
                items.append([c['name'], c['id'], di(c['mod']), build(c['id'], seen | {c['id']})])
            else:
                items.append([c['name'], c['id'], mi(c['mime']), di(c['mod'])])
        return items

    def count(items):
        return sum(count(i[3]) if isinstance(i[3], list) else 1 for i in items)

    top, shards, files = [], {}, []
    for c in sorted(tree.get(root, []), key=lambda c: (not c['folder'], c['name'].lower())):
        if c['folder']:
            items = build(c['id'], {root, c['id']})
            shard = f"{c['id']}.json"
            shards[shard] = items
            top.append([c['name'], c['id'], di(c['mod']), count(items), shard])
        else:
            files.append([c['name'], c['id'], mi(c['mime']), di(c['mod'])])
    manifest = {'title': title, 'root': root, 'built': time.strftime('%Y-%m-%d'),
                'mimes': list(mimes), 'dates': list(dates), 'top': top, 'files': files}
    return manifest, shards


def main(argv):
    if argv and argv[0] == '--from-tree':
        with open(argv[1], encoding='utf-8') as f:
            tree = json.load(f)
        out = argv[2] if len(argv) > 2 else DEFAULT_OUT
        root = next(k for k in tree if not any(k == c['id'] for v in tree.values() for c in v))
    else:
        root = argv[0] if argv else DEFAULT_ROOT
        out = argv[1] if len(argv) > 1 else DEFAULT_OUT
        tree = crawl(root)
    manifest, shards = to_index(tree, root, title_of(root))
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith('.json'):
            os.remove(os.path.join(out, old))
    for name, data in [('manifest.json', manifest), *shards.items()]:
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', out, file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1:])
