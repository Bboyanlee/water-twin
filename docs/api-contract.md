# API 契約（前後端共用，v0.1）

後端：FastAPI，`http://127.0.0.1:8000`。所有 REST 在 `/api` 下，WebSocket 在 `/ws` 下。
前端開發伺服器（Vite, port 5173）以 proxy 轉發 `/api` 與 `/ws` 到 8000。
時間一律用 **epoch 毫秒（UTC）**；數值缺值用 `null`。介面文字一律繁體中文（後端回傳的 `name`/`label_zh` 已是繁中）。

## 廠區

### `GET /api/plants`
```json
[{"id":"muni","name":"示範市政汙水廠（A/O 前置脫硝，BSM1）","wastewater_type":"municipal","process_type":"AO_BSM1","has_simulator":true,"description":"..."},
 {"id":"semi","name":"示範半導體廢水廠","wastewater_type":"semiconductor","process_type":"SEMI_PHYCHEM","has_simulator":false,"description":"..."},
 {"id":"pcb","name":"示範 PCB 廢水廠","wastewater_type":"pcb","process_type":"PCB_PHYCHEM","has_simulator":false,"description":"..."}]
```

### `GET /api/plants/{plant_id}/layout`
3D/2D 共用的參數化配置。座標單位公尺，y 軸朝上，`position` 為底面中心。
```json
{"plant_id":"muni",
 "units":[{"id":"R3","name":"好氧槽 1","type":"aerobic_tank","mesh_id":"muni_R3",
           "shape":"box","position":[0,0,0],"size":[20,4.5,15],
           "meta":{"volume_m3":1333,"aerated":true}}],
 "links":[{"id":"L_R2_R3","from":"R2","to":"R3","kind":"water","flow_var":"FLOW.Qmain"}]}
```
- `type` 可能值：`influent`、`screen`、`equalization`、`anoxic_tank`、`aerobic_tank`、`clarifier`、`effluent`、`blower`、`pump`、`reactor`（化學反應槽）、`chem_tank`（加藥桶）、`filter`、`ro`、`sludge`、`control_room`（中控室）。
- `shape`：`box` 或 `cylinder`（cylinder 的 `size` = `[直徑, 高, 直徑]`）。
- `links[].kind`：`water`（主流）、`recycle`（內循環）、`sludge`（污泥）、`air`（空氣）、`chemical`（加藥）。
- `links[].flow_var`：控制此管線流動速度的變數名（可能為 `null`）。
  - `muni`（有模擬器）：模擬變數名，如 `FLOW.Qa`、`R3.KLa`；即時模式下以 tags 的 `sim_var` 對應到 tag。
  - `semi` / `pcb`（無模擬器）：`{unit_id}.{param}` 形式，等於 tag_id 去掉 `{plant_id}.` 前綴，如 `EQ_HF.Q` → tag `semi.EQ_HF.Q`。

### `GET /api/plants/{plant_id}/tags`
```json
[{"tag_id":"muni.R5.DO","plant_id":"muni","unit_id":"R5","name":"好氧槽 3 溶氧","category":"water_quality",
  "param":"DO","eng_unit":"mg/L","lo":0,"hi":8,"period_s":60,"is_setpoint":false,"sim_var":"R5.SO"}]
```
`category`：`water_quality` | `operation` | `control` | `industrial` | `event`。

### `GET /api/plants/{plant_id}/latest`
`{"ts": 1791400000000, "values": {"muni.R5.DO": 1.98, ...}}`

## 量測資料

### `GET /api/measurements?tag_ids=a,b&start=<ms>&end=<ms>&agg=raw|15m|1h`
`start`/`end` 省略時取該 tag 最後 24 小時。
```json
{"series":{"muni.R5.DO":{"t":[1791400000000,...],"v":[1.98,...]}}}
```

### `POST /api/ingest/batch`
```json
{"points":[{"tag_id":"muni.R5.DO","ts":1791400000000,"value":2.01,"quality":0}]}
```
`ts` 可為 epoch 毫秒或 ISO 8601 字串。以 `(tag_id, ts)` upsert（重送不會重複）。
回傳 `{"inserted":1,"updated":0,"rejected":[{"index":3,"reason":"unknown tag"}]}`。

## 模擬與比較

### `GET /api/controllers`
```json
[{"id":"manual","name":"傳統定值（人工設定）","type":"manual","description":"..."},
 {"id":"pid","name":"PID 溶氧控制","type":"PID","description":"..."},
 {"id":"ai_mpc","name":"AI 智慧控制（代理模型 MPC）","type":"MPC","description":"..."}]
```

### `GET /api/scenarios`
`[{"id":"dry","name":"晴天日變化","description":"...","default_days":1}, {"id":"storm",...}, {"id":"nh4_shock",...}]`

### `POST /api/sim/compare`
請求：`{"plant_id":"muni","scenario_id":"dry","controller_ids":["pid","ai_mpc"],"days":1}`
同步執行（數秒），回傳：
```json
{"runs":[{"run_id":"r_ab12","controller_id":"pid","scenario_id":"dry","kpis":{"EQI":6100.2,...}}]}
```

### `GET /api/sim/runs/{run_id}/states?step=1`
`step` = 取樣間隔（分鐘），預設 1。欄式回傳：
```json
{"run_id":"r_ab12","controller_id":"pid","scenario_id":"dry","dt_min":1,
 "t_min":[0,1,2,...],
 "series":{"R5.SO":[2.0,...], "...":[]}}
```
變數名清單（固定）：
- 反應槽 `R1`~`R5`：`.SO`(溶氧 mg/L)、`.SNO`(硝酸氮)、`.SNH`(氨氮)、`.SS`(易分解基質 COD)、`.TSS`(懸浮固體 mg/L)、`.KLa`(1/d，R1/R2 為 0)
- 控制：`R3.DO_sp`、`R4.DO_sp`、`R5.DO_sp`（DO 設定值，manual 時為 null）
- 二沉池：`CL.TSS_1`~`CL.TSS_10`（由上到下各層 TSS）、`CL.blanket_m`（污泥界面高度，公尺，自池底起算）
- 進流：`INF.Q`(m³/d)、`INF.COD`、`INF.SNH`、`INF.TSS`
- 放流：`EFF.Q`、`EFF.COD`、`EFF.BOD5`、`EFF.SNH`、`EFF.SNO`、`EFF.TN`、`EFF.TSS`
- 流量：`FLOW.Qmain`(進入 R1 的總流量)、`FLOW.Qa`(內循環)、`FLOW.Qr`(回流污泥)、`FLOW.Qw`(廢棄污泥)
- 能耗：`ENERGY.aeration_kW`、`ENERGY.pumping_kW`

### `GET /api/sim/runs/{run_id}/kpis`
`{"run_id":"...","kpis":{...}}`

### `GET /api/kpis/meta`
```json
[{"key":"EQI","label_zh":"出水品質指標 EQI","unit":"kg 污染單位/d","better":"lower"},
 {"key":"AE_kWh_d","label_zh":"曝氣能耗","unit":"kWh/d","better":"lower"}, ...]
```
KPI 鍵：`EQI`、`AE_kWh_d`、`PE_kWh_d`、`total_energy_kWh_d`、`eff_COD_avg`、`eff_BOD5_avg`、`eff_SNH_avg`、`eff_TN_avg`、`eff_TSS_avg`、`viol_SNH_pct`、`viol_TN_pct`、`viol_COD_pct`、`viol_TSS_pct`、`viol_BOD5_pct`、`setpoint_changes`。

### `GET /api/limits?plant_id=muni`
放流標準：`{"EFF.SNH":4,"EFF.TN":18,"EFF.COD":100,"EFF.TSS":30,"EFF.BOD5":10}`
- muni 的鍵是模擬變數名；semi/pcb 的鍵是 `{unit_id}.{param}`（如 `EFF.F`、`EFF.Cu`），pH 以 `EFF.pH_lo`/`EFF.pH_hi` 表示上下限。semi/pcb 為示範值。
- 即時模式要比對 muni 的放流 tag（如 `muni.EFF.NH4`）與標準時，用 tag 的 `sim_var`（`EFF.SNH`）對應。

### `POST /api/sim/compare` 補充
- 只有 `has_simulator=true` 的廠區可模擬，其他回 400（`detail` 為繁中說明）。`days` 範圍 (0, 3]。
- 回應多一個 `group_id`。每個控制器約需 3–8 秒（1 天），請在前端顯示進度/載入中狀態。

### 其他
- `GET /api/models` → AI 代理模型的訓練資訊（特徵、驗證 R²/MAE）。可做「AI 模型說明」面板。
- `GET /api/assets/licenses` → 第三方 3D 資產授權清單（目前為空陣列），供「關於／致謝」頁使用。

## 即時串流

### `WS /ws/live/{plant_id}`
每秒推送一筆（以 60 倍速重播合成資料，1 秒 = 1 分鐘）：
`{"ts":1791400000000,"values":{"muni.R5.DO":1.98, ...}}`
