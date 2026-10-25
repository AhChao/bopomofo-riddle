// 分享連結的產生與複製，設定頁、對局中、結算彈窗、結算頁共用。
import { encodeShare, shareUrl, dictSig } from './share.js';

// 設定 + 種子的連結；result 有值時附上成績（結算後才有）
export function linkFor(index, settings, seed, result = null) {
  return shareUrl(encodeShare({ settings, seed, sig: dictSig(index), result }));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const t = document.createElement('textarea');
  t.value = text;
  t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  t.remove();
  return ok;
}

// 複製並讓按鈕短暫顯示結果，不另外佔版面
export async function copyWithLabel(btn, text) {
  const ok = await copyText(text);
  btn.dataset.label ??= btn.textContent;
  btn.textContent = ok ? '已複製' : '複製失敗';
  clearTimeout(btn._labelTimer);
  btn._labelTimer = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1500);
  return ok;
}
