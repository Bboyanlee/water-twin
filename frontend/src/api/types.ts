// 型別完全對應 docs/api-contract.md（v0.1）

export interface Plant {
  id: string;
  name: string;
  wastewater_type: string;
  process_type: string;
  has_simulator: boolean;
  description: string;
}

export type UnitType =
  | 'influent' | 'screen' | 'equalization' | 'anoxic_tank' | 'aerobic_tank' | 'clarifier'
  | 'effluent' | 'blower' | 'pump' | 'reactor' | 'chem_tank' | 'filter' | 'ro' | 'sludge';

export interface LayoutUnit {
  id: string;
  name: string;
  type: UnitType | string;
  mesh_id: string;
  shape: 'box' | 'cylinder';
  position: [number, number, number];
  size: [number, number, number];
  meta?: Record<string, unknown>;
}

export type LinkKind = 'water' | 'recycle' | 'sludge' | 'air' | 'chemical';

export interface LayoutLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind | string;
  flow_var: string | null;
}

export interface Layout {
  plant_id: string;
  units: LayoutUnit[];
  links: LayoutLink[];
}

export type TagCategory = 'water_quality' | 'operation' | 'control' | 'industrial' | 'event';

export interface Tag {
  tag_id: string;
  plant_id: string;
  unit_id: string;
  name: string;
  category: TagCategory | string;
  param: string;
  eng_unit: string;
  lo: number | null;
  hi: number | null;
  period_s: number;
  is_setpoint: boolean;
  sim_var: string | null;
}

export interface LatestValues {
  ts: number;
  values: Record<string, number | null>;
}

export type Agg = 'raw' | '15m' | '1h';

export interface Series {
  t: number[];
  v: (number | null)[];
}

export interface MeasurementsResponse {
  series: Record<string, Series>;
}

export interface Controller {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  default_days: number;
}

export interface CompareRequest {
  plant_id: string;
  scenario_id: string;
  controller_ids: string[];
  days: number;
}

export interface RunSummary {
  run_id: string;
  controller_id: string;
  scenario_id: string;
  kpis: Record<string, number | null>;
}

export interface CompareResponse {
  group_id?: string;
  runs: RunSummary[];
}

/** GET /api/models：契約未定欄位細節，前端以通用方式顯示 */
export type ModelInfo = Record<string, unknown>;
/** GET /api/assets/licenses */
export type LicenseInfo = Record<string, unknown>;

export interface RunStates {
  run_id: string;
  controller_id: string;
  scenario_id: string;
  dt_min: number;
  t_min: number[];
  series: Record<string, (number | null)[]>;
}

export interface RunKpis {
  run_id: string;
  kpis: Record<string, number | null>;
}

export interface KpiMeta {
  key: string;
  label_zh: string;
  unit: string;
  better: 'lower' | 'higher' | string;
}

export type Limits = Record<string, number>;

/** 3D/2D 場景共用的「變數字典」：鍵為 sim 變數名（如 R5.SO）或 `${unit_id}.${param}` */
export type VarDict = Record<string, number | null | undefined>;
