#!/usr/bin/env python3
"""把教育部《重編國語辭典修訂本》與《成語典》xlsx 轉成遊戲用的精簡詞表。

用法：python3 -I tools/build-data.py <revised.xlsx> <idioms.xlsx> <out.json>

只保留 2 到 4 個純漢字的詞目與其注音，不輸出釋義。
資料來源與授權：中華民國教育部，創用CC 姓名標示-禁止改作 3.0 臺灣。
輸出檔不進版控（見 .gitignore），遊戲頁面須標示出處。
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
CJK = re.compile(r'^[一-鿿]+$')
SPLIT = re.compile(r'[\s　]+')


def rows(path):
    z = zipfile.ZipFile(path)
    strings = []
    for si in ET.parse(z.open('xl/sharedStrings.xml')).getroot().findall('m:si', NS):
        strings.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    for r in ET.parse(z.open(sheet)).getroot().iter('{%s}row' % NS['m']):
        out = {}
        for c in r.findall('m:c', NS):
            col = re.match(r'[A-Z]+', c.get('r')).group()
            v = c.find('m:v', NS)
            if v is not None:
                out[col] = strings[int(v.text)] if c.get('t') == 's' else v.text
        yield out


def syllables(text, length):
    parts = [p for p in SPLIT.split((text or '').strip()) if p]
    return ' '.join(parts) if len(parts) == length else None


def main(revised, idioms, out):
    words = {}  # 詞 -> {'rs': 有序不重複的讀音, 'idiom': bool}
    for i, r in enumerate(rows(revised)):
        if i == 0:
            continue
        w = (r.get('A') or '').strip()
        if not (2 <= len(w) <= 4 and CJK.match(w)):
            continue
        entry = words.setdefault(w, {'rs': [], 'idiom': False})
        for col in ('I', 'K'):
            s = syllables(r.get(col), len(w))
            if s and s not in entry['rs']:
                entry['rs'].append(s)
    idiom_total = idiom_missing = 0
    for i, r in enumerate(rows(idioms)):
        if i == 0:
            continue
        w = (r.get('B') or '').strip()
        if not (2 <= len(w) <= 4 and CJK.match(w)):
            continue
        idiom_total += 1
        if w in words:
            words[w]['idiom'] = True
            continue
        s = syllables((r.get('C') or '').split('（')[0], len(w))
        if s:
            words[w] = {'rs': [s], 'idiom': True}
        else:
            idiom_missing += 1
    payload = [[w, e['rs'], 1 if e['idiom'] else 0] for w, e in sorted(words.items()) if e['rs']]
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'words': payload}, f, ensure_ascii=False, separators=(',', ':'))
    print('words', len(payload), 'idioms(2-4字)', sum(1 for p in payload if p[2]),
          'idiom rows', idiom_total, 'idiom rows without usable zhuyin', idiom_missing)


if __name__ == '__main__':
    main(*sys.argv[1:4])
