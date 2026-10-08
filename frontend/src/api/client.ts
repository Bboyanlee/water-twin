// 統一 API 呼叫層。?mock=1 時改走 mock.ts；靜態建置（VITE_STATIC=1，GitHub Pages）改讀預先匯出的 JSON；
// 後端連不上時更新全域連線狀態。
import type {
  Plant, Layout, Tag, LatestValues, MeasurementsResponse, Agg, Controller, Scenario,
  CompareRequest, CompareResponse, RunStates, RunKpis, KpiMeta, Limits, ModelInfo, LicenseInfo,
} from './types';
import { mockApi, mockLiveSocket } from './mock';
import { staticApi, staticLiveSocket } from './static';

export const IS_STATIC = import.meta.env.VITE_STATIC === '1';
export const IS_MOCK = !IS_STATIC && new URLSearchParams(window.location.search).get('mock') === '1';
/** 不需後端的資料來源（mock 或 static） */
const local = IS_STATIC ? staticApi : IS_MOCK ? mockApi : null;

// ---------------- 連線狀態 store ----------------
export type BackendStatus = 'checking' | 'online' | 'offline' | 'mock' | 'static';
let status: BackendStatus = IS_STATIC ? 'static' : IS_MOCK ? 'mock' : 'checking';
const listeners = new Set<(s: BackendStatus) => void>();
function setStatus(s: BackendStatus) {
  if (s === status) return;
  status = s;
  listeners.forEach((fn) => fn(s));
}
export const backendStatus = {
  get: () => status,
  subscribe: (fn: (s: BackendStatus) => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

export class ApiError extends Error {
  constructor(message: string, public status?: number, public offline = false) {
    super(message);
  }
}

async function checkHealth(): Promise<boolean> {
  if (local) return true;
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    // 後端未提供 /api/health 時（404）以 /api/plants 判斷
    if (r.ok) return true;
    if (r.status === 404) {
      const r2 = await fetch('/api/plants', { signal: AbortSignal.timeout(4000) });
      return r2.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function refreshHealth(): Promise<BackendStatus> {
  if (IS_STATIC) { setStatus('static'); return 'static'; }
  if (IS_MOCK) { setStatus('mock'); return 'mock'; }
  setStatus('checking');
  const ok = await checkHealth();
  setStatus(ok ? 'online' : 'offline');
  return ok ? 'online' : 'offline';
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    setStatus('offline');
    throw new ApiError(`無法連線後端：${(e as Error).message}`, undefined, true);
  }
  if (!r.ok) {
    // Vite proxy 在後端關閉時回 500/502/504，用 health 確認是否真的離線
    if (r.status >= 500) void refreshHealth();
    let detail = '';
    try {
      detail = await r.text();
      // FastAPI 錯誤格式 {"detail": "..."}（400 時為繁中說明）
      const j = JSON.parse(detail) as { detail?: unknown };
      if (typeof j.detail === 'string') detail = j.detail;
      else if (j.detail) detail = JSON.stringify(j.detail);
    } catch { /* 非 JSON */ }
    throw new ApiError(`HTTP ${r.status}${detail ? `：${detail.slice(0, 200)}` : ` ${path}`}`, r.status);
  }
  if (status !== 'online') setStatus('online');
  return (await r.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  plants: (): Promise<Plant[]> => (local ? local.plants() : request('/api/plants')),
  layout: (plantId: string): Promise<Layout> => (local ? local.layout(plantId) : request(`/api/plants/${enc(plantId)}/layout`)),
  tags: (plantId: string): Promise<Tag[]> => (local ? local.tags(plantId) : request(`/api/plants/${enc(plantId)}/tags`)),
  latest: (plantId: string): Promise<LatestValues> => (local ? local.latest(plantId) : request(`/api/plants/${enc(plantId)}/latest`)),
  measurements: (tagIds: string[], opts: { start?: number; end?: number; agg?: Agg } = {}): Promise<MeasurementsResponse> => {
    if (local) return local.measurements(tagIds, opts.start, opts.end, opts.agg);
    const q = new URLSearchParams({ tag_ids: tagIds.join(','), agg: opts.agg ?? 'raw' });
    if (opts.start !== undefined) q.set('start', String(opts.start));
    if (opts.end !== undefined) q.set('end', String(opts.end));
    return request(`/api/measurements?${q.toString()}`);
  },
  controllers: (): Promise<Controller[]> => (local ? local.controllers() : request('/api/controllers')),
  scenarios: (): Promise<Scenario[]> => (local ? local.scenarios() : request('/api/scenarios')),
  compare: (req: CompareRequest): Promise<CompareResponse> =>
    local ? local.compare(req) : request('/api/sim/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) }, 180000),
  states: (runId: string, step = 1): Promise<RunStates> => (local ? local.states(runId, step) : request(`/api/sim/runs/${enc(runId)}/states?step=${step}`, undefined, 60000)),
  kpis: (runId: string): Promise<RunKpis> => (local ? local.kpis(runId) : request(`/api/sim/runs/${enc(runId)}/kpis`)),
  kpiMeta: (): Promise<KpiMeta[]> => (local ? local.kpiMeta() : request('/api/kpis/meta')),
  limits: (plantId: string): Promise<Limits> => (local ? local.limits(plantId) : request(`/api/limits?plant_id=${enc(plantId)}`)),
  models: (): Promise<ModelInfo[] | Record<string, unknown>> => (local ? local.models() : request('/api/models')),
  licenses: (): Promise<LicenseInfo[]> => (local ? (local.licenses() as Promise<LicenseInfo[]>) : request('/api/assets/licenses')),
};

/** 訂閱即時串流 WS /ws/live/{plant_id}，自動重連。回傳取消函式。 */
export function subscribeLive(
  plantId: string,
  onMessage: (msg: LatestValues) => void,
  onState: (connected: boolean) => void,
): () => void {
  if (local) {
    onState(true);
    const stop = (IS_STATIC ? staticLiveSocket : mockLiveSocket)(plantId, onMessage);
    return () => { stop(); onState(false); };
  }
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${window.location.host}/ws/live/${enc(plantId)}`);
    ws.onopen = () => { retry = 0; onState(true); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as LatestValues;
        if (msg && msg.values) onMessage(msg);
      } catch { /* 忽略格式錯誤 */ }
    };
    ws.onclose = () => {
      onState(false);
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(connect, 1000 * 2 ** (retry - 1));
    };
    ws.onerror = () => { ws?.close(); };
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
