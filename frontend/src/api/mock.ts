// 開發用假資料（網址加 ?mock=1 開啟）。格式嚴格依照 docs/api-contract.md。
import type {
  Plant, Layout, LayoutUnit, LayoutLink, Tag, LatestValues, MeasurementsResponse, Agg,
  Controller, Scenario, CompareRequest, CompareResponse, RunStates, RunKpis, KpiMeta, Limits, RunSummary,
} from './types';

const delay = <T,>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));

// ---------------- 廠區 ----------------
const PLANTS: Plant[] = [
  { id: 'muni', name: '示範市政汙水廠（A/O 前置脫硝，BSM1）', wastewater_type: 'municipal', process_type: 'AO_BSM1', has_simulator: true, description: 'BSM1 標竿廠：2 座缺氧槽 + 3 座好氧槽 + 10 層二沉池。' },
  { id: 'semi', name: '示範半導體廢水廠', wastewater_type: 'semiconductor', process_type: 'SEMI_PHYCHEM', has_simulator: false, description: '含氟廢水化學混凝沉澱 + 過濾 + RO 回收。' },
  { id: 'pcb', name: '示範 PCB 廢水廠', wastewater_type: 'pcb', process_type: 'PCB_PHYCHEM', has_simulator: false, description: '含銅廢水破錯、混凝沉澱與砂濾。' },
];

const u = (id: string, name: string, type: string, shape: 'box' | 'cylinder', position: [number, number, number], size: [number, number, number], meta: Record<string, unknown> = {}): LayoutUnit =>
  ({ id, name, type, mesh_id: `${'%P%'}_${id}`, shape, position, size, meta });
const l = (from: string, to: string, kind: string, flow_var: string | null): LayoutLink => ({ id: `L_${from}_${to}`, from, to, kind, flow_var });

function withPlant(plant: string, units: LayoutUnit[], links: LayoutLink[]): Layout {
  return { plant_id: plant, units: units.map((x) => ({ ...x, mesh_id: x.mesh_id.replace('%P%', plant) })), links };
}

const LAYOUTS: Record<string, Layout> = {
  muni: withPlant('muni', [
    u('INF', '進流井', 'influent', 'box', [-62, 0, 0], [7, 3, 7]),
    u('R1', '缺氧槽 1', 'anoxic_tank', 'box', [-44, 0, 0], [13, 4.5, 15], { volume_m3: 1000, aerated: false }),
    u('R2', '缺氧槽 2', 'anoxic_tank', 'box', [-29, 0, 0], [13, 4.5, 15], { volume_m3: 1000, aerated: false }),
    u('R3', '好氧槽 1', 'aerobic_tank', 'box', [-12, 0, 0], [17, 4.5, 15], { volume_m3: 1333, aerated: true }),
    u('R4', '好氧槽 2', 'aerobic_tank', 'box', [7, 0, 0], [17, 4.5, 15], { volume_m3: 1333, aerated: true }),
    u('R5', '好氧槽 3', 'aerobic_tank', 'box', [26, 0, 0], [17, 4.5, 15], { volume_m3: 1333, aerated: true }),
    u('CL', '二沉池', 'clarifier', 'cylinder', [52, 0, 0], [26, 4, 26], { volume_m3: 6000, layers: 10 }),
    u('EFF', '放流井', 'effluent', 'box', [74, 0, 0], [7, 3, 7]),
    u('BLW', '鼓風機房', 'blower', 'box', [7, 0, -20], [12, 4, 6]),
    u('PA', '內循環泵', 'pump', 'cylinder', [-8, 0, 16], [2.6, 2.4, 2.6]),
    u('PR', '回流污泥泵', 'pump', 'cylinder', [30, 0, 22], [2.6, 2.4, 2.6]),
    u('SLU', '污泥處理', 'sludge', 'cylinder', [60, 0, 26], [8, 5, 8]),
    u('CR', '中控室', 'control_room', 'box', [-40, 0, -22], [14, 5, 8]),
  ], [
    l('INF', 'R1', 'water', 'INF.Q'),
    l('R1', 'R2', 'water', 'FLOW.Qmain'),
    l('R2', 'R3', 'water', 'FLOW.Qmain'),
    l('R3', 'R4', 'water', 'FLOW.Qmain'),
    l('R4', 'R5', 'water', 'FLOW.Qmain'),
    l('R5', 'CL', 'water', 'EFF.Q'),
    l('CL', 'EFF', 'water', 'EFF.Q'),
    l('R5', 'PA', 'recycle', 'FLOW.Qa'),
    l('PA', 'R1', 'recycle', 'FLOW.Qa'),
    l('CL', 'PR', 'sludge', 'FLOW.Qr'),
    l('PR', 'R1', 'sludge', 'FLOW.Qr'),
    l('CL', 'SLU', 'sludge', 'FLOW.Qw'),
    l('BLW', 'R3', 'air', 'R3.KLa'),
    l('BLW', 'R4', 'air', 'R4.KLa'),
    l('BLW', 'R5', 'air', 'R5.KLa'),
  ]),
  semi: withPlant('semi', [
    u('INF', '含氟廢水進流', 'influent', 'box', [-50, 0, 0], [7, 3, 7]),
    u('EQ', '調勻池', 'equalization', 'box', [-34, 0, 0], [16, 4, 14]),
    u('RX1', 'pH 調整槽', 'reactor', 'cylinder', [-16, 0, 0], [8, 5, 8]),
    u('RX2', '混凝槽', 'reactor', 'cylinder', [-3, 0, 0], [8, 5, 8]),
    u('CH1', 'CaCl₂ 加藥桶', 'chem_tank', 'cylinder', [-16, 0, -14], [3.5, 4, 3.5]),
    u('CH2', 'PAC 加藥桶', 'chem_tank', 'cylinder', [-3, 0, -14], [3.5, 4, 3.5]),
    u('CL', '沉澱池', 'clarifier', 'cylinder', [18, 0, 0], [20, 4, 20]),
    u('FT', '砂濾槽', 'filter', 'box', [38, 0, 0], [9, 4, 9]),
    u('RO', 'RO 回收系統', 'ro', 'box', [54, 0, 0], [12, 3, 6]),
    u('EFF', '放流井', 'effluent', 'box', [70, 0, 0], [7, 3, 7]),
    u('P1', '污泥泵', 'pump', 'cylinder', [18, 0, 18], [2.4, 2.2, 2.4]),
    u('SLU', '污泥脫水', 'sludge', 'box', [34, 0, 20], [10, 4, 7]),
  ], [
    l('INF', 'EQ', 'water', 'INF.Q'), l('EQ', 'RX1', 'water', 'INF.Q'), l('RX1', 'RX2', 'water', 'INF.Q'),
    l('RX2', 'CL', 'water', 'INF.Q'), l('CL', 'FT', 'water', 'INF.Q'), l('FT', 'RO', 'water', 'INF.Q'), l('RO', 'EFF', 'water', 'RO.recovery'),
    l('CH1', 'RX1', 'chemical', 'RX1.Ca_dose'), l('CH2', 'RX2', 'chemical', 'RX2.PAC_dose'),
    l('CL', 'P1', 'sludge', null), l('P1', 'SLU', 'sludge', null),
  ]),
  pcb: withPlant('pcb', [
    u('INF', '含銅廢水進流', 'influent', 'box', [-48, 0, 0], [7, 3, 7]),
    u('EQ', '調勻池', 'equalization', 'box', [-32, 0, 0], [14, 4, 12]),
    u('RX1', '破錯反應槽', 'reactor', 'cylinder', [-14, 0, 0], [8, 5, 8]),
    u('RX2', '混凝槽', 'reactor', 'cylinder', [0, 0, 0], [8, 5, 8]),
    u('CH1', 'NaOH 加藥桶', 'chem_tank', 'cylinder', [-14, 0, -13], [3.5, 4, 3.5]),
    u('CL', '沉澱池', 'clarifier', 'cylinder', [20, 0, 0], [20, 4, 20]),
    u('FT', '砂濾槽', 'filter', 'box', [40, 0, 0], [9, 4, 9]),
    u('EFF', '放流井', 'effluent', 'box', [56, 0, 0], [7, 3, 7]),
    u('BLW', '攪拌鼓風機', 'blower', 'box', [-32, 0, -16], [8, 3, 5]),
    u('SLU', '污泥脫水', 'sludge', 'box', [20, 0, 20], [10, 4, 7]),
  ], [
    l('INF', 'EQ', 'water', 'INF.Q'), l('EQ', 'RX1', 'water', 'INF.Q'), l('RX1', 'RX2', 'water', 'INF.Q'),
    l('RX2', 'CL', 'water', 'INF.Q'), l('CL', 'FT', 'water', 'INF.Q'), l('FT', 'EFF', 'water', 'INF.Q'),
    l('CH1', 'RX1', 'chemical', 'RX1.NaOH_dose'), l('BLW', 'EQ', 'air', 'BLW.kW'), l('CL', 'SLU', 'sludge', null),
  ]),
};

// ---------------- 點位 ----------------
type TagDef = [unit: string, param: string, name: string, category: string, eng: string, lo: number | null, hi: number | null, sim: string | null, setpoint?: boolean];
const MUNI_TAGS: TagDef[] = [
  ['INF', 'Q', '進流量', 'operation', 'm³/d', 0, 60000, 'INF.Q'],
  ['INF', 'COD', '進流 COD', 'water_quality', 'mg/L', 0, 800, 'INF.COD'],
  ['INF', 'NH4', '進流氨氮', 'water_quality', 'mg/L', 0, 60, 'INF.SNH'],
  ['INF', 'TSS', '進流懸浮固體', 'water_quality', 'mg/L', 0, 500, 'INF.TSS'],
  ['R1', 'NO3', '缺氧槽 1 硝酸氮', 'water_quality', 'mg/L', 0, 20, 'R1.SNO'],
  ['R2', 'NO3', '缺氧槽 2 硝酸氮', 'water_quality', 'mg/L', 0, 20, 'R2.SNO'],
  ['R2', 'NH4', '缺氧槽 2 氨氮', 'water_quality', 'mg/L', 0, 40, 'R2.SNH'],
  ['R3', 'DO', '好氧槽 1 溶氧', 'water_quality', 'mg/L', 0, 8, 'R3.SO'],
  ['R4', 'DO', '好氧槽 2 溶氧', 'water_quality', 'mg/L', 0, 8, 'R4.SO'],
  ['R5', 'DO', '好氧槽 3 溶氧', 'water_quality', 'mg/L', 0, 8, 'R5.SO'],
  ['R5', 'NH4', '好氧槽 3 氨氮', 'water_quality', 'mg/L', 0, 20, 'R5.SNH'],
  ['R5', 'NO3', '好氧槽 3 硝酸氮', 'water_quality', 'mg/L', 0, 30, 'R5.SNO'],
  ['R5', 'MLSS', '好氧槽 3 懸浮固體', 'water_quality', 'mg/L', 0, 6000, 'R5.TSS'],
  ['R3', 'KLa', '好氧槽 1 曝氣量', 'operation', '1/d', 0, 360, 'R3.KLa'],
  ['R4', 'KLa', '好氧槽 2 曝氣量', 'operation', '1/d', 0, 360, 'R4.KLa'],
  ['R5', 'KLa', '好氧槽 3 曝氣量', 'operation', '1/d', 0, 360, 'R5.KLa'],
  ['R5', 'DO_SP', '好氧槽 3 溶氧設定值', 'control', 'mg/L', 0, 4, 'R5.DO_sp', true],
  ['CL', 'BLANKET', '二沉池污泥界面', 'operation', 'm', 0, 4, 'CL.blanket_m'],
  ['PA', 'Q', '內循環流量', 'operation', 'm³/d', 0, 100000, 'FLOW.Qa'],
  ['PR', 'Q', '回流污泥流量', 'operation', 'm³/d', 0, 40000, 'FLOW.Qr'],
  ['SLU', 'Q', '廢棄污泥流量', 'operation', 'm³/d', 0, 1000, 'FLOW.Qw'],
  ['EFF', 'Q', '放流量', 'operation', 'm³/d', 0, 60000, 'EFF.Q'],
  ['EFF', 'COD', '放流 COD', 'water_quality', 'mg/L', 0, 100, 'EFF.COD'],
  ['EFF', 'BOD5', '放流 BOD5', 'water_quality', 'mg/L', 0, 10, 'EFF.BOD5'],
  ['EFF', 'NH4', '放流氨氮', 'water_quality', 'mg/L', 0, 4, 'EFF.SNH'],
  ['EFF', 'NO3', '放流硝酸氮', 'water_quality', 'mg/L', 0, 20, 'EFF.SNO'],
  ['EFF', 'TN', '放流總氮', 'water_quality', 'mg/L', 0, 18, 'EFF.TN'],
  ['EFF', 'TSS', '放流懸浮固體', 'water_quality', 'mg/L', 0, 30, 'EFF.TSS'],
  ['BLW', 'kW', '鼓風機功率', 'operation', 'kW', 0, 400, 'ENERGY.aeration_kW'],
  ['PA', 'kW', '泵送總功率', 'operation', 'kW', 0, 80, 'ENERGY.pumping_kW'],
];
const SEMI_TAGS: TagDef[] = [
  ['INF', 'Q', '進流量', 'operation', 'CMD', 0, 3000, null],
  ['INF', 'F', '進流氟離子', 'industrial', 'mg/L', 0, 600, null],
  ['EQ', 'pH', '調勻池 pH', 'water_quality', '', 0, 14, null],
  ['RX1', 'pH', 'pH 調整槽 pH', 'control', '', 0, 14, null],
  ['RX1', 'Ca_dose', 'CaCl₂ 加藥量', 'operation', 'L/h', 0, 400, null],
  ['RX2', 'PAC_dose', 'PAC 加藥量', 'operation', 'L/h', 0, 120, null],
  ['CL', 'BLANKET', '沉澱池污泥界面', 'operation', 'm', 0, 4, null],
  ['FT', 'dP', '砂濾壓差', 'operation', 'kPa', 0, 80, null],
  ['RO', 'recovery', 'RO 回收率', 'operation', '%', 0, 100, null],
  ['EFF', 'F', '放流氟離子', 'water_quality', 'mg/L', 0, 15, null],
  ['EFF', 'pH', '放流 pH', 'water_quality', '', 0, 14, null],
  ['EFF', 'SS', '放流懸浮固體', 'water_quality', 'mg/L', 0, 30, null],
  ['EFF', 'COD', '放流 COD', 'water_quality', 'mg/L', 0, 100, null],
];
const PCB_TAGS: TagDef[] = [
  ['INF', 'Q', '進流量', 'operation', 'CMD', 0, 2000, null],
  ['INF', 'Cu', '進流銅', 'industrial', 'mg/L', 0, 200, null],
  ['EQ', 'pH', '調勻池 pH', 'water_quality', '', 0, 14, null],
  ['RX1', 'ORP', '破錯槽 ORP', 'control', 'mV', -400, 600, null],
  ['RX1', 'NaOH_dose', 'NaOH 加藥量', 'operation', 'L/h', 0, 300, null],
  ['RX2', 'pH', '混凝槽 pH', 'control', '', 0, 14, null],
  ['CL', 'BLANKET', '沉澱池污泥界面', 'operation', 'm', 0, 4, null],
  ['BLW', 'kW', '鼓風機功率', 'operation', 'kW', 0, 60, null],
  ['EFF', 'Cu', '放流銅', 'water_quality', 'mg/L', 0, 3, null],
  ['EFF', 'pH', '放流 pH', 'water_quality', '', 0, 14, null],
  ['EFF', 'COD', '放流 COD', 'water_quality', 'mg/L', 0, 100, null],
  ['EFF', 'SS', '放流懸浮固體', 'water_quality', 'mg/L', 0, 30, null],
];
function mkTags(plant: string, defs: TagDef[]): Tag[] {
  return defs.map(([unit_id, param, name, category, eng_unit, lo, hi, sim_var, sp]) => ({
    tag_id: `${plant}.${unit_id}.${param}`, plant_id: plant, unit_id, name, category, param, eng_unit, lo, hi,
    period_s: 60, is_setpoint: !!sp, sim_var,
  }));
}
const TAGS: Record<string, Tag[]> = { muni: mkTags('muni', MUNI_TAGS), semi: mkTags('semi', SEMI_TAGS), pcb: mkTags('pcb', PCB_TAGS) };

const LIMITS: Record<string, Limits> = {
  muni: { 'EFF.SNH': 4, 'EFF.TN': 18, 'EFF.COD': 100, 'EFF.TSS': 30, 'EFF.BOD5': 10 },
  semi: { 'EFF.F': 15, 'EFF.SS': 30, 'EFF.COD': 100, 'EFF.pH_lo': 6, 'EFF.pH_hi': 9 },
  pcb: { 'EFF.Cu': 3, 'EFF.SS': 30, 'EFF.COD': 100, 'EFF.pH_lo': 6, 'EFF.pH_hi': 9 },
};

// ---------------- 合成製程模型（僅供前端展示，非 ASM1） ----------------
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const gauss = (t: number, mu: number, sig: number) => Math.exp(-((t - mu) ** 2) / (2 * sig * sig));
const wobble = (t: number, seed: number) => 0.5 * Math.sin(t * 0.113 + seed) + 0.3 * Math.sin(t * 0.0371 + seed * 2.1) + 0.2 * Math.sin(t * 0.7 + seed * 3.3);

function plantVars(tMin: number, controller: string, scenario: string): Record<string, number | null> {
  const day = (((tMin / 1440) % 1) + 1) % 1;
  const diurnal = 1 + 0.28 * Math.sin(TAU * (day - 0.3)) + 0.08 * Math.sin(2 * TAU * day + 1);
  const conc = 1 + 0.22 * Math.sin(TAU * (day - 0.25));
  let storm = 0;
  let shock = 0;
  if (scenario === 'storm') storm = 1.3 * gauss(tMin % 1440, 720, 140);
  if (scenario === 'nh4_shock') shock = 26 * gauss(tMin % 1440, 760, 90);
  const Qin = 18446 * diurnal * (1 + storm) * (1 + 0.02 * wobble(tMin, 1));
  const dil = 1 / (1 + 0.8 * storm);
  const infSNH = (31.6 * conc + shock) * dil * (1 + 0.03 * wobble(tMin, 2));
  const infCOD = 381 * conc * dil * (1 + 0.04 * wobble(tMin, 3));
  const infTSS = 211 * conc * dil * (1 + 0.05 * wobble(tMin, 4)) * (1 + 0.6 * storm);
  const load = (Qin * infSNH) / (18446 * 31.6); // ~1

  let k3: number, k4: number, k5: number;
  let sp3: number | null = null, sp4: number | null = null, sp5: number | null = null;
  let so3: number, so4: number, so5: number;
  let Qa = 55338;
  if (controller === 'manual') {
    k3 = 240; k4 = 240; k5 = 84;
    so3 = clamp(2.3 - 1.3 * (load - 1), 0.2, 4.5);
    so4 = clamp(2.7 - 1.4 * (load - 1), 0.2, 5);
    so5 = clamp(1.2 - 1.0 * (load - 1), 0.1, 3.5);
  } else if (controller === 'ai_mpc') {
    const target = clamp(0.95 + 1.35 * (load - 0.75), 0.6, 2.6);
    sp3 = +(target * 1.05).toFixed(2); sp4 = +target.toFixed(2); sp5 = +(target * 0.9).toFixed(2);
    so3 = sp3 + 0.05 * wobble(tMin, 5); so4 = sp4 + 0.05 * wobble(tMin, 6); so5 = sp5 + 0.05 * wobble(tMin, 7);
    k3 = clamp(150 * load * (sp3 / 1.5), 30, 360); k4 = clamp(140 * load * (sp4 / 1.5), 30, 360); k5 = clamp(95 * load * (sp5 / 1.5), 10, 360);
    Qa = 55338 * clamp(0.75 + 0.3 * (load - 0.8), 0.6, 1.2);
  } else {
    sp3 = 2; sp4 = 2; sp5 = 2;
    so3 = 2 + 0.12 * wobble(tMin, 8); so4 = 2 + 0.12 * wobble(tMin, 9); so5 = 2 + 0.1 * wobble(tMin, 10);
    k3 = clamp(205 * load, 40, 360); k4 = clamp(190 * load, 40, 360); k5 = clamp(130 * load, 20, 360);
  }
  const doEff = (so5 / (0.6 + so5) + so4 / (0.6 + so4)) / 2;
  const r5SNH = clamp(0.35 + 2.2 * Math.max(0, load - 0.75) ** 1.6 / doEff + shock * 0.12 + 0.6 * storm, 0.1, 30);
  const r5SNO = clamp(13.5 + 4 * (load - 1) + 1.4 * (so5 - 1.5) - 1.5 * (Qa / 55338 - 1) - 3 * storm, 2, 30);
  const Qr = 18446;
  const Qw = 385;
  const Qmain = Qin + Qa + Qr;
  const effQ = Qin - Qw;
  const effSNH = r5SNH * 0.97;
  const effSNO = r5SNO * 0.98;
  const effTN = effSNH + effSNO + 1.6;
  const blanket = clamp(0.75 + 1.1 * storm + 0.12 * wobble(tMin, 11) + 0.15 * (diurnal - 1), 0.3, 3.6);
  const effTSS = clamp(12.5 + 6 * storm + 1.2 * wobble(tMin, 12) + 4 * Math.max(0, blanket - 1.8), 3, 60);
  const effCOD = 47 + 4 * (load - 1) + 0.25 * effTSS + 2 * wobble(tMin, 13);
  const effBOD = 2.6 + 0.08 * effTSS + 0.4 * wobble(tMin, 14);
  const aer = 154 * (k3 + k4 + k5) / (240 + 240 + 84) * 0.75;
  const pump = 21 * (Qa + Qr + Qw) / (55338 + 18446 + 385);

  const v: Record<string, number | null> = {
    'INF.Q': Qin, 'INF.COD': infCOD, 'INF.SNH': infSNH, 'INF.TSS': infTSS,
    'FLOW.Qmain': Qmain, 'FLOW.Qa': Qa, 'FLOW.Qr': Qr, 'FLOW.Qw': Qw,
    'R3.DO_sp': sp3, 'R4.DO_sp': sp4, 'R5.DO_sp': sp5,
    'CL.blanket_m': blanket,
    'EFF.Q': effQ, 'EFF.COD': effCOD, 'EFF.BOD5': effBOD, 'EFF.SNH': effSNH, 'EFF.SNO': effSNO, 'EFF.TN': effTN, 'EFF.TSS': effTSS,
    'ENERGY.aeration_kW': aer, 'ENERGY.pumping_kW': pump,
  };
  const so = [0.004, 0.0, so3, so4, so5];
  const kla = [0, 0, k3, k4, k5];
  const snh = [infSNH * 0.42 + 2, infSNH * 0.38 + 1.5, r5SNH + 3.2 * load, r5SNH + 1.3 * load, r5SNH];
  const sno = [4.5 + 0.2 * (Qa / 55338), 2.8, r5SNO - 3.5, r5SNO - 1.5, r5SNO];
  for (let i = 0; i < 5; i++) {
    const r = `R${i + 1}`;
    v[`${r}.SO`] = clamp(so[i], 0, 8);
    v[`${r}.KLa`] = kla[i];
    v[`${r}.SNH`] = snh[i];
    v[`${r}.SNO`] = clamp(sno[i], 0, 30);
    v[`${r}.SS`] = 2.8 - i * 0.4 + 0.3 * load;
    v[`${r}.TSS`] = 3280 + 40 * i + 120 * wobble(tMin, 20 + i);
  }
  for (let k = 1; k <= 10; k++) {
    const depth = (11 - k) * 0.4; // k=1 頂層
    v[`CL.TSS_${k}`] = depth < blanket ? 3000 + 3500 * (1 - depth / Math.max(blanket, 0.1)) : 12 + 60 * gauss(depth, blanket, 0.4);
  }
  return v;
}

function genericTagValue(tag: Tag, tMin: number): number {
  const lo = tag.lo ?? 0;
  const hi = tag.hi ?? lo + 100;
  let frac = 0.42 + 0.12 * Math.sin(TAU * ((tMin / 1440) % 1)) + 0.05 * wobble(tMin, tag.tag_id.length);
  if (tag.unit_id === 'EFF') frac = 0.4 + 0.1 * Math.sin(TAU * ((tMin / 1440) % 1)) + 0.06 * wobble(tMin, tag.param.length) + 0.55 * gauss(tMin % 1440, 1000, 25);
  if (tag.param === 'pH') return 7 + 0.6 * Math.sin(tMin * 0.01) + 0.1 * wobble(tMin, 1);
  return lo + (hi - lo) * frac;
}

function tagValue(tag: Tag, tMin: number): number | null {
  if (tag.sim_var) return plantVars(tMin, 'pid', 'dry')[tag.sim_var] ?? null;
  return genericTagValue(tag, tMin);
}

// ---------------- 模擬執行 ----------------
const CONTROLLERS: Controller[] = [
  { id: 'manual', name: '傳統定值（人工設定）', type: 'manual', description: '曝氣量依經驗固定，不隨負載調整。' },
  { id: 'pid', name: 'PID 溶氧控制', type: 'PID', description: '好氧槽溶氧固定設定值 2 mg/L，以 PID 調整曝氣。' },
  { id: 'ai_mpc', name: 'AI 智慧控制（代理模型 MPC）', type: 'MPC', description: '以代理模型預測負載，動態最佳化溶氧設定值與內循環。' },
];
const SCENARIOS: Scenario[] = [
  { id: 'dry', name: '晴天日變化', description: 'BSM1 晴天日週期進流。', default_days: 1 },
  { id: 'storm', name: '暴雨事件', description: '午間暴雨造成進流量暴增、濃度稀釋。', default_days: 1 },
  { id: 'nh4_shock', name: '氨氮衝擊負荷', description: '傍晚進流氨氮突增。', default_days: 1 },
];
const KPI_META: KpiMeta[] = [
  { key: 'EQI', label_zh: '出水品質指標 EQI', unit: 'kg 污染單位/d', better: 'lower' },
  { key: 'AE_kWh_d', label_zh: '曝氣能耗', unit: 'kWh/d', better: 'lower' },
  { key: 'PE_kWh_d', label_zh: '泵送能耗', unit: 'kWh/d', better: 'lower' },
  { key: 'total_energy_kWh_d', label_zh: '總能耗', unit: 'kWh/d', better: 'lower' },
  { key: 'eff_COD_avg', label_zh: '放流 COD 平均', unit: 'mg/L', better: 'lower' },
  { key: 'eff_BOD5_avg', label_zh: '放流 BOD5 平均', unit: 'mg/L', better: 'lower' },
  { key: 'eff_SNH_avg', label_zh: '放流氨氮平均', unit: 'mg/L', better: 'lower' },
  { key: 'eff_TN_avg', label_zh: '放流總氮平均', unit: 'mg/L', better: 'lower' },
  { key: 'eff_TSS_avg', label_zh: '放流 SS 平均', unit: 'mg/L', better: 'lower' },
  { key: 'viol_SNH_pct', label_zh: '氨氮超標時間比', unit: '%', better: 'lower' },
  { key: 'viol_TN_pct', label_zh: '總氮超標時間比', unit: '%', better: 'lower' },
  { key: 'viol_COD_pct', label_zh: 'COD 超標時間比', unit: '%', better: 'lower' },
  { key: 'viol_TSS_pct', label_zh: 'SS 超標時間比', unit: '%', better: 'lower' },
  { key: 'viol_BOD5_pct', label_zh: 'BOD5 超標時間比', unit: '%', better: 'lower' },
  { key: 'setpoint_changes', label_zh: '設定值變更次數', unit: '次', better: 'lower' },
];

const RUNS = new Map<string, RunStates & { kpis: Record<string, number | null> }>();

function simulate(controller: string, scenario: string, days: number): RunStates {
  const n = Math.round(days * 1440);
  const t_min: number[] = [];
  const series: Record<string, (number | null)[]> = {};
  for (let i = 0; i <= n; i++) {
    const v = plantVars(i, controller, scenario);
    t_min.push(i);
    for (const k in v) (series[k] ??= []).push(v[k] === null ? null : +(v[k] as number).toFixed(4));
  }
  return { run_id: '', controller_id: controller, scenario_id: scenario, dt_min: 1, t_min, series };
}

function computeKpis(s: RunStates, limits: Limits): Record<string, number | null> {
  const avg = (k: string) => { const a = s.series[k] as number[]; return a.reduce((x, y) => x + y, 0) / a.length; };
  const viol = (k: string) => { const a = s.series[k] as number[]; return (100 * a.filter((x) => x > limits[k]).length) / a.length; };
  const ae = avg('ENERGY.aeration_kW') * 24;
  const pe = avg('ENERGY.pumping_kW') * 24;
  let changes = 0;
  const sp = s.series['R5.DO_sp'];
  for (let i = 1; i < sp.length; i++) if (sp[i] !== null && sp[i] !== sp[i - 1]) changes++;
  const eqi = (avg('EFF.Q') / 1000) * (2 * avg('EFF.TSS') + avg('EFF.COD') + 2 * avg('EFF.BOD5') + 30 * avg('EFF.SNH') + 10 * avg('EFF.SNO'));
  const r = (x: number) => +x.toFixed(3);
  return {
    EQI: r(eqi), AE_kWh_d: r(ae), PE_kWh_d: r(pe), total_energy_kWh_d: r(ae + pe),
    eff_COD_avg: r(avg('EFF.COD')), eff_BOD5_avg: r(avg('EFF.BOD5')), eff_SNH_avg: r(avg('EFF.SNH')), eff_TN_avg: r(avg('EFF.TN')), eff_TSS_avg: r(avg('EFF.TSS')),
    viol_SNH_pct: r(viol('EFF.SNH')), viol_TN_pct: r(viol('EFF.TN')), viol_COD_pct: r(viol('EFF.COD')), viol_TSS_pct: r(viol('EFF.TSS')), viol_BOD5_pct: r(viol('EFF.BOD5')),
    setpoint_changes: changes,
  };
}

let runSeq = 0;

// GET /api/models 示意資料（契約只說明含特徵與驗證 R²/MAE，欄位結構待後端確認；前端以通用方式呈現）
const MODELS = [
  { id: 'surrogate_snh', name: 'ASM1 代理模型（放流氨氮）', target: 'EFF.SNH', features: ['INF.Q', 'INF.SNH', 'R3.SO', 'R4.SO', 'R5.SO', 'FLOW.Qa'], metrics: { R2: 0.962, MAE: 0.21 } },
  { id: 'surrogate_energy', name: '曝氣能耗代理模型', target: 'ENERGY.aeration_kW', features: ['R3.KLa', 'R4.KLa', 'R5.KLa', 'INF.Q'], metrics: { R2: 0.991, MAE: 2.8 } },
];

// ---------------- 對外 API（與 client.ts 同介面） ----------------
export const mockApi = {
  health: () => delay({ status: 'ok', mock: true }),
  plants: () => delay(PLANTS),
  layout: (id: string) => (LAYOUTS[id] ? delay(LAYOUTS[id]) : Promise.reject(new Error('404 plant not found'))),
  tags: (id: string) => delay(TAGS[id] ?? []),
  latest: (id: string): Promise<LatestValues> => {
    const ts = Math.floor(Date.now() / 60000) * 60000;
    const tMin = ts / 60000;
    const values: Record<string, number | null> = {};
    for (const tag of TAGS[id] ?? []) values[tag.tag_id] = tagValue(tag, tMin);
    return delay({ ts, values });
  },
  measurements: (tagIds: string[], start?: number, end?: number, agg: Agg = 'raw'): Promise<MeasurementsResponse> => {
    const e = end ?? Math.floor(Date.now() / 60000) * 60000;
    const s = start ?? e - 24 * 3600_000;
    const step = agg === '1h' ? 60 : agg === '15m' ? 15 : 1;
    const all = Object.values(TAGS).flat();
    const series: MeasurementsResponse['series'] = {};
    for (const id of tagIds) {
      const tag = all.find((x) => x.tag_id === id);
      if (!tag) continue;
      const t: number[] = [];
      const v: (number | null)[] = [];
      for (let ts = Math.ceil(s / 60000 / step) * step * 60000; ts <= e; ts += step * 60000) {
        t.push(ts);
        const val = tagValue(tag, ts / 60000);
        v.push(val === null ? null : +val.toFixed(4));
      }
      series[id] = { t, v };
    }
    return delay(series ? { series } : { series: {} }, 200);
  },
  controllers: () => delay(CONTROLLERS),
  scenarios: () => delay(SCENARIOS),
  kpiMeta: () => delay(KPI_META),
  limits: (plantId: string) => delay(LIMITS[plantId] ?? {}),
  compare: (req: CompareRequest): Promise<CompareResponse> => {
    const plant = PLANTS.find((p) => p.id === req.plant_id);
    if (!plant?.has_simulator) return Promise.reject(new Error('HTTP 400：此廠區沒有模擬器，無法執行比較'));
    if (!(req.days > 0 && req.days <= 3)) return Promise.reject(new Error('HTTP 400：模擬天數需介於 0～3 天'));
    const runs: RunSummary[] = req.controller_ids.map((cid) => {
      const st = simulate(cid, req.scenario_id, req.days);
      const run_id = `r_mock${(++runSeq).toString(16).padStart(3, '0')}`;
      st.run_id = run_id;
      const kpis = computeKpis(st, LIMITS.muni);
      RUNS.set(run_id, { ...st, kpis });
      return { run_id, controller_id: cid, scenario_id: req.scenario_id, kpis };
    });
    return delay({ group_id: `g_mock${runSeq}`, runs }, 1500);
  },
  states: (runId: string, step = 1): Promise<RunStates> => {
    const r = RUNS.get(runId);
    if (!r) return Promise.reject(new Error('404 run not found'));
    const idx = r.t_min.map((_, i) => i).filter((i) => i % step === 0);
    const series: RunStates['series'] = {};
    for (const k in r.series) series[k] = idx.map((i) => r.series[k][i]);
    return delay({ run_id: r.run_id, controller_id: r.controller_id, scenario_id: r.scenario_id, dt_min: step, t_min: idx.map((i) => r.t_min[i]), series }, 250);
  },
  models: () => delay(MODELS),
  licenses: () => delay([] as unknown[]),
  kpis: (runId: string): Promise<RunKpis> => {
    const r = RUNS.get(runId);
    return r ? delay({ run_id: runId, kpis: r.kpis }) : Promise.reject(new Error('404 run not found'));
  },
};

/** 模擬 WS /ws/live/{plant_id}：每秒推一筆（60 倍速重播，1 秒 = 1 分鐘） */
export function mockLiveSocket(plantId: string, onMessage: (msg: LatestValues) => void): () => void {
  let ts = Math.floor(Date.now() / 60000) * 60000;
  const emit = () => {
    ts += 60000;
    const tMin = ts / 60000;
    const values: Record<string, number | null> = {};
    for (const tag of TAGS[plantId] ?? []) {
      const v = tagValue(tag, tMin);
      values[tag.tag_id] = v === null ? null : +v.toFixed(4);
    }
    onMessage({ ts, values });
  };
  emit();
  const h = setInterval(emit, 1000);
  return () => clearInterval(h);
}
