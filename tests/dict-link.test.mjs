import test from 'node:test';
import assert from 'node:assert/strict';
import { dictUrl } from '../web/js/dict-link.js';

test('成語走成語辭典，詞走重編國語辭典', () => {
  assert.equal(
    dictUrl('掩耳盜鈴', true),
    `https://dict.idioms.moe.edu.tw/idiomList.jsp?idi_page=1&idiom=${encodeURIComponent('掩耳盜鈴')}`,
  );
  assert.equal(
    dictUrl('風紀', false),
    `https://dict.revised.moe.edu.tw/search.jsp?md=1&word=${encodeURIComponent('風紀')}&qMd=0&qCol=1`,
  );
});

test('中文詞要 percent-encode，不留裸字', () => {
  const u = dictUrl('放假', false);
  assert.match(u, /word=%E6%94%BE%E5%81%87&/);
  assert.doesNotMatch(u, /放假/);
});
