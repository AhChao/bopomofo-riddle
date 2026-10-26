// 教育部辭典連結：結算頁的詞點進去查詞義。純函式，不碰 DOM。
const IDIOM_URL = 'https://dict.idioms.moe.edu.tw/idiomList.jsp?idi_page=1&idiom=';
const WORD_URL = 'https://dict.revised.moe.edu.tw/search.jsp?md=1&word=';

export function dictUrl(word, isIdiom) {
  const w = encodeURIComponent(word);
  return isIdiom ? `${IDIOM_URL}${w}` : `${WORD_URL}${w}&qMd=0&qCol=1`;
}
