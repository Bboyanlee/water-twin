// 模擬執行與 KPI（對應 backend/app/sim/runner.py）
import { BSM1_INFLUENT, Plant, type Actuators } from './bsm1';
import type { Controller } from './controllers';

export const LIMITS: Record<string, number> = { 'EFF.SNH': 4, 'EFF.TN': 18, 'EFF.COD': 100, 'EFF.TSS': 30, 'EFF.BOD5': 10 };
const DT_MIN = 1;
const DT_DAY = DT_MIN / 1440;

export interface Influent { Q: number[]; C: number[][] }
export interface RunResult { t_min: number[]; dt_min: number; series: Record<string, (number | null)[]>; kpis: Record<string, number> }

export function simulate(plant: Plant, ctrl: Controller, y0: ArrayLike<number>, warmup: Influent | null, main: Influent,
  recordStep = 1, onProgress?: (frac: number) => void): RunResult {
  let y = Float64Array.from(y0);
  ctrl.reset();
  const full: Record<string, (number | null)[]> = {};
  let act: Actuators = { kla: [0, 0, 0, 0, 0], Qa: 0, Qr: 0, Qw: 0 };
  let t = 0;
  const phases: [Influent, boolean][] = warmup ? [[warmup, false], [main, true]] : [[main, true]];
  const total = phases.reduce((s, [p]) => s + p.Q.length, 0);
  let done = 0;
  for (const [inf, keep] of phases) {
    for (let i = 0; i < inf.Q.length; i++) {
      const obs = plant.outputs(y, inf.Q[i], inf.C[i], act);
      act = ctrl.step(obs, t, DT_DAY);
      if (keep) {
        const rec: Record<string, number | null> = { ...obs, ...plant.actuatorOutputs(act), ...ctrl.setpoints() };
        for (const k in rec) (full[k] ??= []).push(rec[k]);
      }
      y = plant.stepRK4(y, DT_DAY, inf.Q[i], inf.C[i], act);
      t += DT_MIN;
      if (onProgress && ++done % 360 === 0) onProgress(done / total);
    }
  }
  const kpis = computeKpis(full);
  const series: Record<string, (number | null)[]> = {};
  for (const k in full) series[k] = recordStep > 1 ? full[k].filter((_, i) => i % recordStep === 0) : full[k];
  const n = series['EFF.Q']?.length ?? 0;
  return { t_min: Array.from({ length: n }, (_, i) => i * DT_MIN * recordStep), dt_min: DT_MIN * recordStep, series, kpis };
}

export function computeKpis(s: Record<string, (number | null)[]>): Record<string, number> {
  const a = (k: string) => (s[k] ?? []).map((v) => (v === null ? NaN : v));
  const Qe = a('EFF.Q');
  const n = Qe.length;
  if (!n) return {};
  const sumQ = Qe.reduce((x, y) => x + y, 0);
  const mean = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length;
  const tss = a('EFF.TSS'), cod = a('EFF.COD'), tkn = a('EFF.TKN'), sno = a('EFF.SNO'), bod = a('EFF.BOD5');
  let eqi = 0;
  for (let i = 0; i < n; i++) eqi += (2 * tss[i] + cod[i] + 30 * tkn[i] + 10 * sno[i] + 2 * bod[i]) * Qe[i];
  const k: Record<string, number> = {
    EQI: eqi * DT_DAY / (n * DT_DAY * 1000),
    AE_kWh_d: mean(a('ENERGY.aeration_kW')) * 24,
    PE_kWh_d: mean(a('ENERGY.pumping_kW')) * 24,
  };
  k.total_energy_kWh_d = k.AE_kWh_d + k.PE_kWh_d;
  for (const [name, key] of [['COD', 'EFF.COD'], ['BOD5', 'EFF.BOD5'], ['SNH', 'EFF.SNH'], ['TN', 'EFF.TN'], ['TSS', 'EFF.TSS']]) {
    const v = a(key);
    let w = 0, viol = 0;
    for (let i = 0; i < n; i++) { w += v[i] * Qe[i] / sumQ; if (v[i] > LIMITS[key]) viol += 1; }
    k[`eff_${name}_avg`] = w;
    k[`viol_${name}_pct`] = viol / n * 100;
  }
  const sp = s['R5.DO_sp'] ?? [];
  let changes = 0;
  for (let i = 1; i < sp.length; i++) {
    const p = sp[i - 1], c = sp[i];
    if (p !== null && c !== null && Math.abs(c - p) > 1e-9) changes += 1;
  }
  k.setpoint_changes = changes;
  return k;
}

// ---------- 業主上傳資料 → ASM1 進流組成 ----------
const BSM1_COD = 30 + 69.5 + 51.2 + 202.32 + 28.17; // 381.19
export interface InfluentRow { t: number; Q: number; COD: number; NH4: number; TSS?: number | null }

/** 依 BSM1 進流分率把 COD/氨氮/SS 轉成 13 個 ASM1 組分。 */
export function toAsm1(r: InfluentRow): number[] {
  const c = [...BSM1_INFLUENT];
  const f = r.COD / BSM1_COD;
  for (const i of [0, 1, 2, 3, 4, 10, 11]) c[i] *= f;          // SI SS XI XS XBH SND XND 隨 COD 縮放
  c[9] = r.NH4;
  if (r.TSS !== undefined && r.TSS !== null && r.TSS > 0) {
    // 依 SS 調整顆粒性 COD（TSS = 0.75 × 顆粒性 COD），並以易分解溶解性 COD 補足總 COD
    const part = c[2] + c[3] + c[4];
    const p = Math.min(Math.max(r.TSS / (0.75 * part), 0.5), 2);
    const total = c[0] + c[1] + part;
    for (const i of [2, 3, 4, 11]) c[i] *= p;
    c[1] = Math.max(total - c[0] - (c[2] + c[3] + c[4]), 5);
  }
  return c;
}

/** 把不等間隔的資料線性內插成每分鐘一筆 */
export function resampleToMinutes(rows: InfluentRow[]): Influent {
  const sorted = [...rows].sort((x, y) => x.t - y.t);
  const t0 = sorted[0].t, t1 = sorted[sorted.length - 1].t;
  const n = Math.floor((t1 - t0) / 60000) + 1;
  const Q: number[] = [], C: number[][] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 60000;
    while (j < sorted.length - 2 && sorted[j + 1].t < t) j++;
    const a = sorted[j], b = sorted[Math.min(j + 1, sorted.length - 1)];
    const w = b.t > a.t ? Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1) : 0;
    const lerp = (x?: number | null, y?: number | null) => (x == null || y == null ? (x ?? y ?? null) : x + (y - x) * w);
    const row: InfluentRow = { t, Q: lerp(a.Q, b.Q)!, COD: lerp(a.COD, b.COD)!, NH4: lerp(a.NH4, b.NH4)!, TSS: lerp(a.TSS, b.TSS) };
    Q.push(row.Q);
    C.push(toAsm1(row));
  }
  return { Q, C };
}
