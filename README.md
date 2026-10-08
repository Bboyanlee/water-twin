# 智慧水務平台（water-twin）

汙水廠數位孿生：匯入 1 分鐘 IoT 水質資料，在 BSM1/ASM1 機理模擬器中比較
「傳統控制（人工定值 / PID）」與「AI 智慧控制（代理模型 MPC）」，並以 3D 廠區動畫呈現。

## 目錄
```
backend/   FastAPI + SQLAlchemy + 模擬器（Python 3.10）
  app/sim/        ASM1 動力學、BSM1 廠（5 槽 + 10 層 Takács 二沉池）、進流情境、模擬執行與 KPI
  app/control/    控制器（manual / pid / ai_mpc）與 AI 代理模型
  app/catalog/    示範廠區（市政 / 半導體 / PCB）的 3D 配置與點位目錄
  app/synth/      合成 1 分鐘 IoT 資料（雜訊、漂移、斷線、尖峰）
  app/db/         資料表、TimescaleDB 設定（雲端用）、種子資料
  scripts/        驗證與訓練腳本
  tests/          pytest
frontend/  Vite + React + Three.js（react-three-fiber）+ ECharts 深色大屏
docs/      API 契約與說明
```

## 本機啟動（不需 Docker）
後端（第一次啟動會產生 3 天合成資料，約 10–20 秒）：
```bash
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```
前端：
```bash
cd frontend
npm run dev
```
瀏覽 http://localhost:5173 。

重新訓練 AI 代理模型並比較三種控制器：
```bash
cd backend
.venv/Scripts/python.exe scripts/train_surrogate.py
```
測試：
```bash
cd backend
.venv/Scripts/python.exe -m pytest -q tests
```

## 設定（環境變數）
| 變數 | 預設 | 說明 |
|---|---|---|
| `WT_DATABASE_URL` | `sqlite:///backend/data/water_twin.db` | 雲端改為 `postgresql+psycopg://...`（TimescaleDB，啟動時自動套用 `app/db/timescale.sql`） |
| `WT_DATA_DIR` | `backend/data` | 快取、模型檔、SQLite 位置 |
| `WT_CORS_ORIGINS` | `http://localhost:5173,...` | 前端網域 |
| `WT_SYNTH_DAYS` | `3` | 首次啟動產生的合成資料天數 |

## 模型說明與限制
- **模擬器**：BSM1 開環穩態與文獻值誤差約 1–4%（見 `scripts/check_steady_state.py`、`tests/test_sim.py`）。進流不是官方 BSM1 動態檔，而是以 BSM1 平均進流為基礎的日變化合成情境（晴天 / 暴雨 / 氨氮衝擊）。
- **AI 控制**：梯度提升樹代理模型預測好氧槽末端氨氮、硝酸氮與曝氣能耗（未來 2 小時），每 15 分鐘選擇 DO 設定值與內循環流量。模型只在模擬資料上訓練，換到真實廠前必須以現場資料重新校正與驗證，且應先以「影子模式」（只建議不下控）運行。
- **半導體 / PCB**：目前只有點位目錄、3D 配置與統計式合成資料，尚無機理模擬器；放流標準為示範值，須以許可證為準。
- **雲端**：`docker-compose.yml` 與 `timescale.sql` 已備妥但尚未實測（開發機未安裝 Docker）。
