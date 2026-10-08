import type { Layout, LayoutUnit, Limits, RunStates, Tag, VarDict } from '../api/types';

/** 即時 tag 值 → 變數字典：同時以 sim_var 與 `${unit_id}.${param}` 為鍵 */
export function buildVarDict(values: Record<string, number | null>, tags: Tag[]): VarDict {
  const d: VarDict = {};
  for (const tag of tags) {
    const v = values[tag.tag_id];
    if (v === undefined) continue;
    d[`${tag.unit_id}.${tag.param}`] = v;
    // semi/pcb 的 flow_var / limits 鍵 = tag_id 去掉 `{plant_id}.` 前綴
    const prefix = `${tag.plant_id}.`;
    if (tag.tag_id.startsWith(prefix)) d[tag.tag_id.slice(prefix.length)] = v;
    if (tag.sim_var) d[tag.sim_var] = v;
  }
  return d;
}

/** 依序嘗試多個鍵，取第一個有值者 */
export function pick(d: VarDict, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export const unitDO = (d: VarDict, id: string) => pick(d, `${id}.SO`, `${id}.DO`);
export const unitNH4 = (d: VarDict, id: string) => pick(d, `${id}.SNH`, `${id}.NH4`);
export const unitKLa = (d: VarDict, id: string) => pick(d, `${id}.KLa`);
export const unitBlanket = (d: VarDict, id: string) => pick(d, `${id}.blanket_m`, `${id}.BLANKET`);

/** 從 states 取某時刻（分鐘，可為小數 → 線性內插）的變數字典 */
export function sampleStates(run: RunStates, tMin: number): VarDict {
  const out: VarDict = {};
  const n = run.t_min.length;
  if (!n) return out;
  const t0 = run.t_min[0];
  const dt = run.dt_min || 1;
  const f = Math.min(Math.max((tMin - t0) / dt, 0), n - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, n - 1);
  const a = f - i;
  for (const k in run.series) {
    const s = run.series[k];
    const v0 = s[i];
    const v1 = s[j];
    out[k] = v0 === null || v0 === undefined ? null : v1 === null || v1 === undefined ? v0 : v0 + (v1 - v0) * a;
  }
  return out;
}

export interface LimitCheck {
  key: string;
  /** 對應的變數名（`EFF.pH_lo` → `EFF.pH`） */
  varKey: string;
  side: 'max' | 'min';
  limit: number;
  value: number | null;
  /** 0~1 表示在標準內，>1 表示超標（下限型以 limit/value 計） */
  ratio: number;
  bad: boolean;
  near: boolean;
}

/** 依 limits 檢查：一般鍵為上限；`_lo` / `_hi` 後綴為下限 / 上限（例如 EFF.pH_lo） */
export function checkLimits(d: VarDict, limits: Limits): LimitCheck[] {
  return Object.keys(limits).map((key) => {
    const limit = limits[key];
    const m = /^(.*)_(lo|hi)$/.exec(key);
    const varKey = m ? m[1] : key;
    const side: 'max' | 'min' = m && m[2] === 'lo' ? 'min' : 'max';
    const value = pick(d, varKey);
    let ratio = 0;
    if (value !== null) ratio = side === 'max' ? (limit !== 0 ? value / limit : 0) : value > 0 ? limit / value : 2;
    const bad = value !== null && (side === 'max' ? value > limit : value < limit);
    return { key, varKey, side, limit, value, ratio, bad, near: !bad && !m && ratio > 0.85 };
  });
}

/** 放流超標的 limits 鍵清單 */
export function violations(d: VarDict, limits: Limits): string[] {
  return checkLimits(d, limits).filter((c) => c.bad).map((c) => c.key);
}

export interface LabelSpec { label: string; keys: string[]; unit: string; digits: number }

/** 各單元浮動標籤要顯示的關鍵值 */
export function unitLabelSpecs(unit: LayoutUnit, layout: Layout, tags: Tag[]): LabelSpec[] {
  const id = unit.id;
  switch (unit.type) {
    case 'aerobic_tank':
      return [
        { label: 'DO', keys: [`${id}.SO`, `${id}.DO`], unit: 'mg/L', digits: 2 },
        { label: 'NH₄', keys: [`${id}.SNH`, `${id}.NH4`], unit: 'mg/L', digits: 2 },
      ];
    case 'anoxic_tank':
      return [
        { label: 'NO₃', keys: [`${id}.SNO`, `${id}.NO3`], unit: 'mg/L', digits: 2 },
        { label: 'NH₄', keys: [`${id}.SNH`, `${id}.NH4`], unit: 'mg/L', digits: 1 },
      ];
    case 'clarifier':
      return [{ label: '泥面', keys: [`${id}.blanket_m`, `${id}.BLANKET`, 'CL.blanket_m'], unit: 'm', digits: 2 }];
    case 'influent':
      if (id === 'INF' && layout.plant_id === 'muni')
        return [
          { label: 'Q', keys: ['INF.Q'], unit: 'm³/d', digits: 0 },
          { label: 'NH₄', keys: ['INF.SNH'], unit: 'mg/L', digits: 1 },
        ];
      break;
    case 'effluent':
      if (layout.plant_id === 'muni')
        return [
          { label: 'NH₄', keys: ['EFF.SNH'], unit: 'mg/L', digits: 2 },
          { label: 'TN', keys: ['EFF.TN'], unit: 'mg/L', digits: 1 },
        ];
      break;
    case 'blower':
      return [{ label: '功率', keys: ['ENERGY.aeration_kW', `${id}.kW`], unit: 'kW', digits: 0 }];
    case 'pump': {
      const out = layout.links.find((k) => k.from === id && k.flow_var);
      if (out?.flow_var) return [{ label: 'Q', keys: [out.flow_var], unit: 'm³/d', digits: 0 }];
      break;
    }
  }
  // 預設：取該單元前兩個 tag
  return tags
    .filter((t) => t.unit_id === id)
    .slice(0, 2)
    .map((t) => ({ label: t.param, keys: [t.sim_var ?? '', `${id}.${t.param}`].filter(Boolean), unit: t.eng_unit, digits: 2 }));
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10000) return v.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  return v.toFixed(digits);
}

/** 單元附屬於哪個 flow 變數（泵/鼓風機轉速用） */
export function unitDriveVar(unit: LayoutUnit, layout: Layout): string[] {
  if (unit.type === 'blower') {
    const air = layout.links.filter((k) => k.from === unit.id && k.flow_var).map((k) => k.flow_var as string);
    return air.length ? air : [`${unit.id}.kW`];
  }
  const out = layout.links.find((k) => (k.from === unit.id || k.to === unit.id) && k.flow_var);
  return out?.flow_var ? [out.flow_var] : [];
}

/** 流量正規化：記錄每個變數觀察到的最大值 */
export class FlowNormalizer {
  private max = new Map<string, number>();
  constructor(seed?: Record<string, number>) {
    if (seed) for (const k in seed) this.max.set(k, seed[k]);
  }
  seedFromRun(run: RunStates) {
    for (const k in run.series) {
      let m = 0;
      for (const v of run.series[k]) if (typeof v === 'number' && Math.abs(v) > m) m = Math.abs(v);
      if (m > (this.max.get(k) ?? 0)) this.max.set(k, m);
    }
  }
  norm(key: string, v: number | null): number {
    if (v === null) return 0;
    const a = Math.abs(v);
    const m = Math.max(this.max.get(key) ?? 0, a);
    this.max.set(key, m);
    return m > 0 ? a / m : 0;
  }
}

export const KIND_COLOR: Record<string, string> = {
  water: '#00E5FF',
  recycle: '#B57BFF',
  sludge: '#E08A3C',
  air: '#F2F6FF',
  chemical: '#FFD84D',
};
