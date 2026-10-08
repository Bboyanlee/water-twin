// 靜態展示模式（GitHub Pages，無後端）：讀取 backend/scripts/export_static.py 預先匯出的 data/*.json。
// 對外介面與 mockApi 相同，client.ts 依 IS_STATIC 切換。
import type {
  Plant, Layout, Tag, LatestValues, MeasurementsResponse, Agg, Controller, Scenario,
  CompareRequest, CompareResponse, RunStates, RunKpis, KpiMeta, Limits, Series,
} from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`靜態資料載入失敗：${path}（HTTP ${r.status}）`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path) as Promise<T>;
}

type SimFile = RunStates & { kpis: Record<string, number | null> };
const runFile = (runId: string) => {
  // run_id 格式：static_{scenario}_{controller}；scenario 本身可能含底線（nh4_shock）
  const m = /^static_(.+)_(manual|pid|ai_mpc)$/.exec(runId);
  if (!m) throw new Error(`未知的模擬結果 ${runId}`);
  return load<SimFile>(`sim/${m[1]}__${m[2]}.json`);
};

function slice(s: Series | undefined, start?: number, end?: number): Series {
  if (!s) return { t: [], v: [] };
  const out: Series = { t: [], v: [] };
  s.t.forEach((tt, i) => {
    if ((start === undefined || tt >= start) && (end === undefined || tt <= end)) { out.t.push(tt); out.v.push(s.v[i]); }
  });
  return out;
}

function toHourly(s: Series): Series {
  const buckets = new Map<number, number[]>();
  s.t.forEach((tt, i) => {
    const v = s.v[i];
    if (v === null || v === undefined) return;
    const b = tt - (tt % 3_600_000);
    (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(v);
  });
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return { t: keys, v: keys.map((k) => { const a = buckets.get(k)!; return a.reduce((x, y) => x + y, 0) / a.length; }) };
}

export const staticApi = {
  plants: () => load<Plant[]>('plants.json'),
  layout: (id: string) => load<Layout>(`plants/${id}/layout.json`),
  tags: (id: string) => load<Tag[]>(`plants/${id}/tags.json`),
  latest: (id: string) => load<LatestValues>(`plants/${id}/latest.json`),
  limits: (id: string) => load<Limits>(`plants/${id}/limits.json`),
  controllers: () => load<Controller[]>('controllers.json'),
  scenarios: () => load<Scenario[]>('scenarios.json'),
  kpiMeta: () => load<KpiMeta[]>('kpis_meta.json'),
  models: () => load<Record<string, unknown>>('models.json'),
  licenses: () => load<Record<string, unknown>[]>('licenses.json'),

  async measurements(tagIds: string[], start?: number, end?: number, agg: Agg = 'raw'): Promise<MeasurementsResponse> {
    const plantId = tagIds[0]?.split('.')[0] ?? '';
    const file = agg === 'raw' ? 'history_raw_24h.json' : 'history_15m.json';
    const all = await load<MeasurementsResponse>(`plants/${plantId}/${file}`);
    const series: Record<string, Series> = {};
    for (const id of tagIds) {
      const s = slice(all.series[id], start, end);
      series[id] = agg === '1h' ? toHourly(s) : s;
    }
    return { series };
  },

  async compare(req: CompareRequest): Promise<CompareResponse> {
    const runs = await Promise.all(req.controller_ids.map(async (cid) => {
      const run_id = `static_${req.scenario_id}_${cid}`;
      const f = await runFile(run_id);
      return { run_id, controller_id: cid, scenario_id: req.scenario_id, kpis: f.kpis };
    }));
    return { group_id: 'static', runs };
  },

  async states(runId: string, step = 1): Promise<RunStates> {
    const f = await runFile(runId);
    const k = Math.max(1, Math.round(step / f.dt_min));
    const series: Record<string, (number | null)[]> = {};
    for (const [name, vals] of Object.entries(f.series)) series[name] = vals.filter((_, i) => i % k === 0);
    return { run_id: f.run_id, controller_id: f.controller_id, scenario_id: f.scenario_id,
      dt_min: f.dt_min * k, t_min: f.t_min.filter((_, i) => i % k === 0), series };
  },

  async kpis(runId: string): Promise<RunKpis> {
    const f = await runFile(runId);
    return { run_id: runId, kpis: f.kpis };
  },
};

/** 以最後 24 小時原始資料在瀏覽器端重播（1 秒 = 1 分鐘），取代 WebSocket。 */
export function staticLiveSocket(plantId: string, onMessage: (m: LatestValues) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  void load<MeasurementsResponse>(`plants/${plantId}/history_raw_24h.json`).then((all) => {
    if (stopped) return;
    const times = new Set<number>();
    Object.values(all.series).forEach((s) => s.t.forEach((tt) => times.add(tt)));
    const sorted = [...times].sort((a, b) => a - b);
    const cursor: Record<string, number> = {};
    const current: Record<string, number | null> = {};
    let i = 0;
    const tick = () => {
      if (!sorted.length) return;
      if (i >= sorted.length) { i = 0; Object.keys(cursor).forEach((k) => { cursor[k] = 0; }); }
      const ts = sorted[i++];
      for (const [id, s] of Object.entries(all.series)) {
        let c = cursor[id] ?? 0;
        while (c < s.t.length && s.t[c] <= ts) { current[id] = s.v[c]; c += 1; }
        cursor[id] = c;
      }
      onMessage({ ts, values: { ...current } });
    };
    tick();
    timer = setInterval(tick, 1000);
  }).catch(() => { /* 載入失敗時保持無資料 */ });
  return () => { stopped = true; if (timer) clearInterval(timer); };
}
