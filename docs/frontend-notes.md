# 前端開發筆記（frontend，2026-10-08）

## 啟動
```
cd water-twin/frontend
npm install
npm run dev          # http://localhost:5173 ，proxy /api、/ws → 127.0.0.1:8000
# 沒有後端時：http://localhost:5173/?mock=1
npm run build        # 會先跑 tsc --noEmit
```
頁面可用 hash 直達：`#overview`、`#flow`、`#compare`、`#data`。

## 結構
- `src/api/types.ts` 契約型別；`client.ts` 統一呼叫＋連線狀態 store＋WS 自動重連；`mock.ts` 假資料（`?mock=1`）
- `src/lib/vars.ts` 變數字典（tag → sim_var / `{unit}.{param}` / tag_id 去前綴）、states 內插、放流標準檢查（支援 `_lo`/`_hi`）、流量正規化
- `src/three/` PlantScene（Canvas、燈光、離線 Lightformer 環境、自動取景）、Units（槽體/水面/氣泡/泵/鼓風機/二沉池污泥界面/中控室/標籤）、Pipes（TubeGeometry＋流動貼圖）
- `src/pages/` Overview / Flow（SVG）/ Compare / Data
- `src/styles/theme.css` design tokens 與所有樣式；`src/charts/theme.ts` ECharts 深色主題 `twin`
- `src/i18n/zh-TW.ts` 繁中字典

## 驗收紀錄
| 項目 | 方法 | 結果 |
|---|---|---|
| `npx tsc --noEmit` | 指令 | 無錯誤 |
| `npm run build` | 指令 | 成功（three、echarts 各約 1 MB，已拆 chunk） |
| 後端未連線 | 不帶 mock、後端未啟動時開啟 | 顯示紅色「後端未連線」橫幅，可重新連線或改用模擬資料，沒有白屏 |
| mock 四頁 | 瀏覽器截圖＋DOM 檢查 | 總覽 3D 有渲染、標籤數值每秒更新；流程圖 15 條管線 CSS 動畫運作；資料頁表格＋趨勢圖；對比頁兩個 3D 場景、15 張 KPI 卡、時間軸播放中時間持續前進 |
| 真實後端 | 127.0.0.1:8000 已啟動 | health ok、WS 即時串流連線；muni／semi 總覽正常；pid vs ai_mpc 對比約 15 秒完成，KPI＋差異曲線＋游標正常；拖曳時間軸＋10x 切換正常；點 3D 單元開啟詳情抽屜（最新值＋24h 趨勢） |
| 1366×768 | 視窗模擬 | 總覽、資料頁、對比頁沒有破版（對比頁內容較高時 main 區可捲動） |

## 已知問題／未完成
- 瀏覽器自動化下 rAF 會被節流，播放速度看起來比設定慢，正常使用不影響。
- 3D 標籤在單元密集的廠區（semi）會互相重疊，可用「標籤」按鈕關閉；之後可做碰撞避讓或只顯示 hover。
- 告警由前端依放流標準、DO 偏低規則即時判斷，沒有後端告警 API，重新整理後會清空。
- 沒有做 code splitting 的 lazy loading（首頁就載入 three＋echarts，gzip 合計約 650 KB）。

## 對契約的觀察／建議
1. **WS 重播時間軸**：`/ws/live` 從資料起點（約 24 小時前）開始重播，`/latest` 卻是資料終點，兩者時間不連續。前端遇到時間倒退會重設曲線歷史。建議契約寫明重播起點，或在訊息裡附上 `replay: true` 和 `sim_ts`。
2. **`/api/models` 結構**：目前回傳 `{model_id: {...}}` 物件，跟其他端點回傳陣列不一致。前端用通用方式呈現。建議固定 schema，例如 `[{id, name, features[], targets[], holdout_metrics{}}]`。
3. **告警 API**：建議新增 `GET /api/alarms?plant_id=`（或在 WS 訊息加 `alarms` 欄位），讓前後端判斷一致。
4. **tag 和 sim_var 的參數名稱**：tag 的 `param` 有 `KLA`／`KW`，sim 用 `KLa`。前端已改成以 `sim_var` 為準，但建議在契約裡註明 `param` 不保證跟 sim 變數同名。
5. **compare 進度**：每個控制器要跑 3–8 秒，目前只能顯示「已經過 N 秒」。若要顯示真實進度，可改成非同步 job（`POST` 回 job_id，再用 `GET /api/sim/jobs/{id}` 輪詢進度）。
6. **pH 標準**：`EFF.pH_lo`／`EFF.pH_hi` 已支援（下限低於標準時判為異常）。
