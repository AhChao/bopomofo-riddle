// 把 web/ 打包成可部署到靜態主機的 dist/：每個檔名加上整站內容雜湊，並改寫引用。
// 目的：部署後一般重新整理就拿到新版，不必手動清快取（GitHub Pages 不能自訂 Cache-Control，
// 檔名帶雜湊才能讓舊快取自然失效）。純 Node，沒有依賴。
// 用法：node tools/build-pages.mjs [輸出目錄，預設 dist]
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web');
const out = join(root, process.argv[2] || 'dist');

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = walk(src).map((p) => relative(src, p)).sort();
const hash = createHash('sha1');
for (const f of files) hash.update(f).update(readFileSync(join(src, f)));
const H = hash.digest('hex').slice(0, 8);

// index.html 保持原名（入口），其餘都改名：x.ext -> x.<H>.ext
const renamed = (f) => (f === 'index.html' ? f : f.replace(/(\.[^./]+)$/, `.${H}$1`));
const refs = files.filter((f) => f !== 'index.html');

// 把字串字面值裡指向站內檔案的路徑（相對於引用檔所在目錄）加上雜湊
const known = new Set(refs);
function rewrite(text, fromDir) {
  return text.replace(/(['"])([^'"\s]+\.(?:js|css|json))\1/g, (m, q, spec) => {
    if (/^[a-z]+:/i.test(spec)) return m; // 外部網址不動
    // fetch() 的路徑相對於頁面（站台根），import 與 href 才相對於引用檔
    const base = spec.endsWith('.json') || fromDir === '.' ? '' : fromDir;
    const resolved = posix.normalize(posix.join(base, spec));
    if (!known.has(resolved)) return m;
    return `${q}${spec.replace(/(\.[^./]+)$/, `.${H}$1`)}${q}`;
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  const to = join(out, renamed(f));
  mkdirSync(dirname(to), { recursive: true });
  if (/\.(js|html|css)$/.test(f)) {
    let text = readFileSync(from, 'utf8');
    text = rewrite(text, dirname(f).replace(/\\/g, '/'));
    writeFileSync(to, text);
  } else {
    cpSync(from, to);
  }
}
console.log(`built ${files.length} files -> ${relative(root, out)} (hash ${H})`);
