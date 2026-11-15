# 卓楓學區探索地圖

花蓮縣卓溪鄉卓楓國小與學區（古楓部落、白端部落）的 3D 互動學習地圖。訪客不用註冊就能進入，在真實地形上走路、騎 ubike、搭卓溪幸福巴士，探索校園與部落裡的 34 個地點。

整個網站只有一個檔案 `index.html`，不需要伺服器程式或資料庫，可以直接放在 GitHub Pages 上。

## 功能

| 功能 | 說明 |
|---|---|
| 真實地形 | 內政部 20 公尺數值地形模型，範圍從中央山脈山腳到秀姑巒溪中線 |
| 卓楓國小 | 三層地基、L 型教學大樓、司令台、升旗台、生態池、大楓樹土丘等 |
| 部落 | 古楓部落 92 棟、白端部落 77 棟房舍，依衛星圖逐棟配置；教會、雜貨店、聚會所 Silupatan 等地標 |
| 交通 | ubike 借還車；卓溪幸福巴士定時小巴與預約轎車（目前皆免費，收費設定已預留） |
| 配置編輯器 | 在平面地圖上移動、旋轉房舍、地標、校園物件，新增或刪除 ubike 站與專車站 |

## 放上 GitHub（用網頁操作，不需要指令）

1. 登入 GitHub，按右上角「＋」→「New repository」。
2. Repository name 填 `zhuofeng-map`，選 **Public**，按「Create repository」。
3. 在新專案頁面點「uploading an existing file」，把這個資料夾裡的**所有檔案和資料夾**拖進去（包含 `.nojekyll`），按「Commit changes」。
4. 進入專案的「Settings」→ 左側「Pages」。
5. Source 選「Deploy from a branch」，Branch 選 `main`、資料夾選 `/ (root)`，按「Save」。
6. 等 1～2 分鐘，網址會是：`https://你的帳號.github.io/zhuofeng-map/`

> 免費帳號的 GitHub Pages 需要專案設為 Public。

## 調整物件位置

1. 開啟網址並在後面加上 `?edit`，例如 `https://你的帳號.github.io/zhuofeng-map/?edit`
2. 按右下角「配置」，在平面地圖上拖曳、旋轉物件，或新增站點。
3. 按「儲存並發布」→「確定」，瀏覽器會下載一個新的 `index.html`。
4. 回到 GitHub 專案，點「Add file」→「Upload files」，上傳這個 `index.html` 取代舊檔，按「Commit changes」。
5. 約 1 分鐘後網站就會更新。

一般訪客的網址沒有 `?edit`，看不到「配置」按鈕。

## 檔案結構

```
index.html          網站本體（直接開啟就能使用）
.nojekyll           讓 GitHub Pages 原樣提供檔案
src/
  shell.html        畫面外框與樣式
  app.js            3D 場景、角色、交通
  editor.js         平面配置編輯器
  data.js           地形高度、道路、房舍資料
  layout.json       物件配置（編輯器產生）
  assets/logo.b64   卓溪幸福巴士標誌
tools/build.py      把 src/ 組合成 index.html
```

只改位置的話，用配置編輯器就好，不需要動 `src/`。要修改程式時，改 `src/` 裡的檔案後執行：

```
python3 tools/build.py
```

注意：如果曾用編輯器上傳過新的 `index.html`，請先把其中 `<script id="zf-layout">` 的內容存回 `src/layout.json`，再執行 `build.py`，否則配置會回到舊版。

## 資料來源與授權

- 地形：內政部 20 公尺網格數值地形模型（2025 版），依「政府資料開放授權條款第 1 版」使用。
- 3D 引擎：three.js（MIT 授權），由 jsDelivr 載入。
- 字型：Google Fonts（霞鶩文楷 TC、Noto Sans TC，SIL Open Font License）。
- 卓溪幸福巴士標誌：屬卓溪鄉所有，僅用於呈現社區交通服務。
- 校園配置、照片參考與地點說明：卓楓國小提供。
