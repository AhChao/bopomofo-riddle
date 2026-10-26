# 注音大師

輪流接招的中文拼詞炸彈遊戲，詞庫來自教育部國語辭典。三個模式：注音縮寫、指定開頭、聲調。支援種子碼與分享連結。規劃見 docs/plan.md，實測與設計對照見 docs/reference.md。

## 本地試玩

1. 詞庫已在 web/data/words.json。要重新產生：
   `python3 -I tools/build-data.py <重編本.xlsx> <成語典.xlsx> web/data/words.json`
   xlsx 來源：https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html
2. 啟動：`python3 -m http.server 8765 --directory web --bind 127.0.0.1`
3. 開 http://127.0.0.1:8765/

## 測試

`node --test tests/core.test.mjs tests/game.test.mjs tests/share.test.mjs`；瀏覽器走查 `node tests/e2e.mjs`（需要本地伺服器與 Playwright）

## 結構

- web/js/core.js：提示池、驗證、計分，純函式，之後原封搬進 Durable Object
- web/js/game.js：炸彈回合狀態機，時間由呼叫端傳入
- web/js/rng.js、share.js：種子化亂數、分享碼編解碼
- web/js/share-ui.js：分享連結產生與複製
- web/js/dict-link.js：詞條對應的教育部辭典網址
- web/js/keyboard.js：注音符號鍵盤
- web/js/ui.js、main.js：畫面與輸入
- web/js/ime-safe-submit.js、modal-shell.js 與對應 css：複製自 stv-prefer-ui-template
- tools/build-data.py：xlsx 轉精簡詞表（不含釋義）

## 部署（GitHub Pages）

`.github/workflows/pages.yml` 在推到 master 或 main 時：跑單元測試、用 `tools/build-pages.mjs` 把 web/ 打包到 dist/（每個檔名加整站內容雜湊並改寫引用，部署後一般重新整理就拿到新版）、發布到 Pages。第一次要在 repo 設定 Settings → Pages → Source 選「GitHub Actions」。本機預覽：`node tools/build-pages.mjs dist` 後 `python3 -m http.server 8080 --directory dist`。

已知限制：GitHub Pages 不能自訂 Cache-Control，入口 index.html 最多快取 10 分鐘，剛部署完的 10 分鐘內，開著舊頁面的人重新整理一次即可。

## 授權

詞庫為中華民國教育部《重編國語辭典修訂本》《成語典》，創用CC 姓名標示-禁止改作 3.0 臺灣。詞庫檔（只含詞目與注音，不含釋義）放在 web/data/words.json，隨網站公開；頁面頁尾標示出處。
