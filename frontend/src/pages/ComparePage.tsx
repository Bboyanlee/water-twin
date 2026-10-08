import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { api, IS_STATIC } from '../api/client';
import type { KpiMeta, Plant, RunStates, RunSummary, VarDict } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { t, fmt } from '../i18n';
import { Empty, Loading, Panel, SectionToggle } from '../components/Panel';
import Chart from '../charts/Chart';
import ErrorBoundary from '../components/ErrorBoundary';
import InfoModal from '../components/InfoModal';
import PlantScene, { type ColorMode } from '../three/PlantScene';
import { FlowNormalizer, fmtNum, sampleStates } from '../lib/vars';
import SavingsPanel from '../components/SavingsPanel';
import { downloadTemplate, parseFile, type FlowUnit, type ParsedUpload } from '../engine/upload';
import type { WorkerMessage, WorkerRequest } from '../engine/worker';
import type { ControllerId } from '../engine/controllers';

const UPLOAD = '__upload';

// 下方三個可收合區塊（狀態記在瀏覽器，下次開啟沿用）
type SectionKey = 'kpi' | 'savings' | 'charts';
type SectionState = Record<SectionKey, boolean>;
const SECTIONS: [SectionKey, string][] = [['kpi', 'KPI 對比'], ['savings', '效益估算'], ['charts', '差異曲線']];
const SECTIONS_KEY = 'wt.compare.sections.v1';
function loadSections(): SectionState {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? 'null');
    if (v && typeof v.kpi === 'boolean') return { kpi: v.kpi, savings: !!v.savings, charts: !!v.charts };
  } catch { /* ignore */ }
  return { kpi: true, savings: true, charts: true };
}

function kpiSummary(s: RunSummary[]) {
  const d = (k: string) => {
    const a = s[0]?.kpis[k], b = s[1]?.kpis[k];
    return typeof a === 'number' && typeof b === 'number' && Math.abs(a) > 1e-9 ? `${b > a ? '+' : ''}${(((b - a) / Math.abs(a)) * 100).toFixed(1)}%` : '—';
  };
  return `EQI ${d('EQI')} · 總能耗 ${d('total_energy_kWh_d')} · 放流氨氮 ${d('eff_SNH_avg')} · 放流總氮 ${d('eff_TN_avg')}`;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** 在 Web Worker 中以瀏覽器模擬引擎執行上傳資料 */
function runUploadSimulation(up: ParsedUpload, unit: FlowUnit, controllers: string[], onProgress: (f: number) => void) {
  return new Promise<Extract<WorkerMessage, { type: 'done' }>>((resolve, reject) => {
    const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.frac);
      else { w.terminate(); if (m.type === 'done') resolve(m); else reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || '模擬引擎載入失敗')); };
    const first = new Date(up.rows[0].t);
    const req: WorkerRequest = {
      rows: up.rows.map((r) => ({ ...r, Q: unit === 'm3h' ? r.Q * 24 : r.Q })),
      controllers: controllers as ControllerId[],
      engineBase: new URL(`${import.meta.env.BASE_URL}data/engine/`, window.location.href).href,
      clockOffsetMin: first.getHours() * 60 + first.getMinutes(),
    };
    w.postMessage(req);
  });
}

interface Props {
  plants: Plant[];
  currentPlant: Plant;
}

interface Result {
  summaries: RunSummary[];
  states: RunStates[];
}

const SPEEDS = [1, 10, 60];
const DIFF_VARS: { key: string; label: string; unit: string }[] = [
  { key: 'EFF.SNH', label: '放流氨氮', unit: 'mg/L' },
  { key: 'EFF.TN', label: '放流總氮', unit: 'mg/L' },
  { key: 'ENERGY.aeration_kW', label: '曝氣功率', unit: 'kW' },
  { key: 'R5.SO', label: '好氧槽 3 溶氧', unit: 'mg/L' },
];
const COLOR_A = '#00E5FF';
const COLOR_B = '#2BD99F';

function fmtSimTime(min: number) {
  const d = Math.floor(min / 1440);
  const m = Math.floor(min % 1440);
  return `${fmt(t.compare.day, { d: d + 1 })} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 以 run 建立快取式 getVars（同一時間點只內插一次） */
function useRunVars(run: RunStates | undefined, tRef: React.MutableRefObject<number>) {
  const cache = useRef<{ t: number; v: VarDict }>({ t: NaN, v: {} });
  useEffect(() => { cache.current = { t: NaN, v: {} }; }, [run]);
  return useCallback(() => {
    if (!run) return {};
    const tm = tRef.current;
    if (cache.current.t !== tm) cache.current = { t: tm, v: sampleStates(run, tm) };
    return cache.current.v;
  }, [run, tRef]);
}

function KpiCards({ meta, a, b }: { meta: KpiMeta[]; a: RunSummary; b: RunSummary }) {
  return (
    <div className="kpi-row">
      {meta.map((m) => {
        const va = a.kpis[m.key];
        const vb = b.kpis[m.key];
        let delta: number | null = null;
        let cls = 'same';
        let text = '—';
        if (typeof va === 'number' && typeof vb === 'number') {
          if (Math.abs(va) > 1e-9) {
            delta = ((vb - va) / Math.abs(va)) * 100;
            text = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
          } else {
            delta = vb - va;
            text = `${delta > 0 ? '+' : ''}${fmtNum(delta, 2)}`;
          }
          const better = m.better === 'higher' ? delta > 0 : delta < 0;
          cls = Math.abs(delta) < 0.05 ? 'same' : better ? 'good' : 'bad';
        }
        return (
          <div className="kpi-card" key={m.key} title={`${m.label_zh}（${m.unit}，${m.better === 'higher' ? '越高越好' : '越低越好'}）`}>
            <div className="k">{m.label_zh} <span style={{ color: 'var(--text-3)' }}>{m.unit}</span></div>
            <div className={`delta ${cls}`}>{text}{cls !== 'same' && <span style={{ fontSize: 11, marginLeft: 6 }}>{cls === 'good' ? `▲ ${t.compare.better}` : `▼ ${t.compare.worse}`}</span>}</div>
            <div className="vals"><span className="a">{fmtNum(va, 2)}</span><span style={{ color: 'var(--text-3)' }}>→</span><span className="b">{fmtNum(vb, 2)}</span></div>
          </div>
        );
      })}
    </div>
  );
}

function DiffChart({ def, runs, names, tRef, tick }: { def: typeof DIFF_VARS[number]; runs: RunStates[]; names: string[]; tRef: React.MutableRefObject<number>; tick: number }) {
  const ref = useRef<ReactECharts>(null);
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    title: { text: `${def.label}（${def.unit}）`, left: 8, top: 4, textStyle: { fontSize: 13, color: '#e6f7ff', fontWeight: 500 } },
    grid: { left: 40, right: 12, top: 34, bottom: 22 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtNum(v as number, 2) },
    xAxis: { type: 'value', min: 0, max: runs[0] ? runs[0].t_min[runs[0].t_min.length - 1] / 60 : 24, axisLabel: { formatter: (v: number) => `${v.toFixed(0)}h` }, splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, splitNumber: 3 },
    series: runs.map((r, i) => ({
      id: `s${i}`,
      name: names[i],
      type: 'line',
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.6, color: i ? COLOR_B : COLOR_A },
      itemStyle: { color: i ? COLOR_B : COLOR_A },
      data: (r.series[def.key] ?? []).map((v, k) => [r.t_min[k] / 60, v]),
      markLine: i === 0 ? { symbol: 'none', silent: true, animation: false, label: { show: false }, lineStyle: { color: '#FF9F1C', width: 1.5, type: 'solid' }, data: [{ xAxis: 0 }] } : undefined,
    })),
  }), [def, runs, names]);
  // 時間游標：直接 setOption 只更新 markLine，避免重繪整個資料
  useEffect(() => {
    const inst = ref.current?.getEchartsInstance();
    if (!inst) return;
    inst.setOption({ series: [{ id: 's0', markLine: { data: [{ xAxis: tRef.current / 60 }] } }] }, { lazyUpdate: true });
  }, [tick, tRef]);
  return <Chart ref={ref} option={option} />;
}

export default function ComparePage({ plants, currentPlant }: Props) {
  const simPlant = currentPlant.has_simulator ? currentPlant : plants.find((p) => p.has_simulator);
  const scenarios = useAsync(() => api.scenarios(), []);
  const controllers = useAsync(() => api.controllers(), []);
  const kpiMeta = useAsync(() => api.kpiMeta(), []);
  const layout = useAsync(() => (simPlant ? api.layout(simPlant.id) : Promise.reject(new Error(t.compare.needSim))), [simPlant?.id]);
  const tags = useAsync(() => (simPlant ? api.tags(simPlant.id) : Promise.resolve([])), [simPlant?.id]);
  const limits = useAsync(() => (simPlant ? api.limits(simPlant.id) : Promise.resolve({})), [simPlant?.id]);

  const [scenario, setScenario] = useState('');
  const [ctrlA, setCtrlA] = useState('pid');
  const [ctrlB, setCtrlB] = useState('ai_mpc');
  const [days, setDays] = useState(1);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('do');
  const [showModels, setShowModels] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState('');
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3d');
  const [uploadInfo, setUploadInfo] = useState<{ scale: number; meanQ: number; minutes: number; clockOffsetMin: number } | null>(null);
  const [open, setOpen] = useState<SectionState>(loadSections);
  const toggle = (k: SectionKey) => setOpen((o) => {
    const n = { ...o, [k]: !o[k] };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(n)); } catch { /* 無痕視窗等情況 */ }
    return n;
  });
  const [source, setSource] = useState<'preset' | 'upload'>('preset');
  const isUpload = source === 'upload';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null); setUpload(null); setParsing(true); setUploadName(file.name);
    try {
      const p = await parseFile(file);
      setUpload(p);
      setFlowUnit(p.flowUnitGuess);
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setParsing(false);
    }
  };
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const h = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(h);
  }, [running]);

  useEffect(() => {
    if (scenarios.data?.length && !scenario) {
      setScenario(scenarios.data[0].id);
      setDays(Math.min(3, scenarios.data[0].default_days || 1));
    }
  }, [scenarios.data, scenario]);

  // 時間軸
  const tRef = useRef(0);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const tMax = result?.states[0] ? result.states[0].t_min[result.states[0].t_min.length - 1] : 0;
  const playRef = useRef({ playing, speed, tMax });
  playRef.current = { playing, speed, tMax };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.5);
      last = now;
      const p = playRef.current;
      if (p.playing && p.tMax > 0) {
        tRef.current += p.speed * dt; // 1x = 1 模擬分鐘 / 秒（與即時串流一致）
        if (tRef.current >= p.tMax) { tRef.current = p.tMax; setPlaying(false); }
        acc += dt;
        if (acc > 0.1) { acc = 0; setTick((x) => x + 1); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const runA = result?.states[0];
  const runB = result?.states[1];
  const getA = useRunVars(runA, tRef);
  const getB = useRunVars(runB, tRef);
  const normalizer = useMemo(() => {
    const n = new FlowNormalizer();
    result?.states.forEach((s) => n.seedFromRun(s));
    return n;
  }, [result]);

  const start = async () => {
    if (!simPlant || !scenario) return;
    setRunning(true);
    setErr(null);
    setPlaying(false);
    if (isUpload) {
      try {
        if (!upload) throw new Error('請先上傳進流資料檔');
        setPhase('在瀏覽器中模擬您的進流資料…');
        const res = await runUploadSimulation(upload, flowUnit, [ctrlA, ctrlB], (f) => setPhase(`在瀏覽器中模擬您的進流資料… ${Math.round(f * 100)}%`));
        const summaries: RunSummary[] = res.runs.map((r, i) => ({ run_id: `upload_${i}`, controller_id: r.controller_id, scenario_id: UPLOAD, kpis: r.kpis }));
        const states: RunStates[] = res.runs.map((r, i) => ({ run_id: `upload_${i}`, controller_id: r.controller_id, scenario_id: UPLOAD, dt_min: r.dt_min, t_min: r.t_min, series: r.series }));
        const first = new Date(upload.rows[0].t);
        setUploadInfo({ scale: res.scale, meanQ: res.meanQ, minutes: res.minutes, clockOffsetMin: first.getHours() * 60 + first.getMinutes() });
        tRef.current = 0;
        setResult({ summaries, states });
        setTick((x) => x + 1);
        setPlaying(true);
      } catch (e) {
        setErr(e as Error);
      } finally {
        setRunning(false);
      }
      return;
    }
    try {
      setPhase(IS_STATIC ? '載入預先運算的模擬結果…' : `執行模擬中（2 個控制器 × ${days} 天，每個約 3–8 秒/天）`);
      const res = await api.compare({ plant_id: simPlant.id, scenario_id: scenario, controller_ids: [ctrlA, ctrlB], days });
      setPhase('下載模擬狀態序列…');
      // 依 controller_ids 順序對齊（A 在左、B 在右）
      const runs = [ctrlA, ctrlB].map((c) => res.runs.find((r) => r.controller_id === c)).filter(Boolean) as RunSummary[];
      if (runs.length < 2) throw new Error('後端回傳的 runs 不足兩筆');
      res.runs = runs;
      const states = await Promise.all(res.runs.map((r) => api.states(r.run_id, 1)));
      tRef.current = 0;
      setResult({ summaries: res.runs, states });
      setTick((x) => x + 1);
      setPlaying(true);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setRunning(false);
    }
  };

  const ctrlName = (id: string) => controllers.data?.find((c) => c.id === id)?.name ?? id;
  const names = result ? result.summaries.map((s) => ctrlName(s.controller_id)) : [];

  if (!simPlant) return <Empty text={t.compare.needSim} />;

  const sceneProps = layout.data && result ? { layout: layout.data, tags: tags.data ?? [], normalizer, limits: limits.data ?? {}, colorMode, showLabels: true } : null;
  const varsA = result ? getA() : {};
  const varsB = result ? getB() : {};
  void tick;

  return (
    <div className="compare">
      {showModels && (
        <InfoModal
          title="AI 代理模型說明"
          load={() => api.models()}
          emptyText="後端尚未提供模型資訊"
          onClose={() => setShowModels(false)}
          intro={<p style={{ color: 'var(--text-2)', marginTop: 0 }}>AI 智慧控制以代理模型（surrogate）預測未來 2 小時好氧槽末端的氨氮、硝酸氮與曝氣能耗，再以 MPC 每 15 分鐘最佳化溶氧設定值與內循環流量。以下為模型特徵與驗證指標：</p>}
        />
      )}
      <Panel bodyClass="compare-ctrl" style={{ flex: 'none' }}>
        <div className="source-switch" role="tablist" aria-label="模擬資料來源">
          <button role="tab" aria-selected={!isUpload} className={!isUpload ? 'on' : ''} onClick={() => setSource('preset')}>📊 預設情境</button>
          <button role="tab" aria-selected={isUpload} className={isUpload ? 'on' : ''} onClick={() => setSource('upload')}>📂 上傳我的資料（Excel）</button>
        </div>
        {!isUpload && (
          <label>{t.compare.scenario}
            <select className="select" value={scenario} onChange={(e) => {
              setScenario(e.target.value);
              const sc = scenarios.data?.find((s) => s.id === e.target.value);
              if (sc) setDays(Math.min(3, sc.default_days || 1));
            }}>
              {scenarios.data?.map((s) => <option key={s.id} value={s.id} title={s.description}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label><span style={{ color: COLOR_A }}>■</span> {t.compare.controllerA}
          <select className="select" value={ctrlA} onChange={(e) => setCtrlA(e.target.value)}>
            {controllers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span style={{ color: COLOR_B }}>■</span> {t.compare.controllerB}
          <select className="select" value={ctrlB} onChange={(e) => setCtrlB(e.target.value)}>
            {controllers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {isUpload ? null : IS_STATIC ? (
          <span className="badge info" title="靜態展示版無後端，顯示預先運算的 1 天模擬結果">預先運算結果 · 1 天</span>
        ) : (
          <label>{t.compare.days}
            <input className="input num" type="number" min={0.5} max={3} step={0.5} value={days} style={{ width: 64 }} onChange={(e) => setDays(Math.max(0.5, Math.min(3, Number(e.target.value) || 1)))} />
          </label>
        )}
        <button className="btn primary" disabled={running || ctrlA === ctrlB || (isUpload ? !upload : !scenario)} onClick={start}>{running ? `${t.compare.running} ${elapsed}s` : t.compare.start}</button>
        <button className="btn" onClick={() => setShowModels(true)}>AI 模型說明</button>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{simPlant.name}</span>
        {ctrlA === ctrlB && <span className="badge warn">兩個控制器需不同</span>}
        {err && <span className="error-text">{err.message}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{t.overview.colorBy}</span>
          <button className={`btn small ${colorMode === 'do' ? 'on' : ''}`} onClick={() => setColorMode('do')}>{t.overview.colorDO}</button>
          <button className={`btn small ${colorMode === 'nh4' ? 'on' : ''}`} onClick={() => setColorMode('nh4')}>{t.overview.colorNH4}</button>
        </span>
        {isUpload && (
          <div className="upload-row">
            <button className="btn small" onClick={() => void downloadTemplate().catch((e) => setUploadErr(`範本產生失敗：${(e as Error).message}`))}>⬇ 下載 Excel 範本</button>
            <span className="btn small primary file-btn">
              {parsing ? '解析中…' : '📂 選擇 Excel / CSV 檔'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </span>
            {uploadName && <span className="upload-summary">{uploadName}</span>}
            {upload && (
              <>
                <label className="upload-summary">流量單位
                  <select className="select" value={flowUnit} onChange={(e) => setFlowUnit(e.target.value as FlowUnit)}>
                    <option value="m3d">m³/d（CMD）</option>
                    <option value="m3h">m³/h</option>
                  </select>
                </label>
                <span className="upload-summary">
                  共 <b>{upload.rows.length}</b> 筆 · {fmtDate(upload.start)} ～ {fmtDate(upload.end)}（<b>{fmtNum((upload.end - upload.start) / 3_600_000, 1)}</b> 小時）
                  · 平均流量 <b>{fmtNum(upload.rows.reduce((s, r) => s + r.Q, 0) / upload.rows.length * (flowUnit === 'm3h' ? 24 : 1), 0)}</b> m³/d
                  · 欄位：{[upload.columns.time, upload.columns.Q, upload.columns.COD, upload.columns.NH4, upload.columns.TSS].filter(Boolean).join('、')}
                </span>
              </>
            )}
            {uploadInfo && result?.summaries[0]?.scenario_id === UPLOAD && (
              <span className="upload-summary">模擬廠規模 = BSM1 × <b>{fmtNum(uploadInfo.scale, 3)}</b>（依您的平均流量等比例縮放，停留時間與汙泥齡不變）</span>
            )}
            <span className="upload-summary" style={{ color: 'var(--text-3)' }}>檔案只在您的瀏覽器中處理，不會上傳到伺服器。</span>
            {uploadErr && <span className="upload-warn" style={{ color: 'var(--danger)' }}>⚠ {uploadErr}</span>}
            {upload?.warnings.map((w) => <span key={w} className="upload-warn">⚠ {w}</span>)}
          </div>
        )}
      </Panel>

      <div className="split">
        {[0, 1].map((i) => {
          const run = i ? runB : runA;
          const vars = i ? varsB : varsA;
          return (
            <div className="scene-wrap" key={i}>
              {result && <div className={`split-tag ${i ? 'b' : 'a'}`}>{names[i]}</div>}
              {running ? <Loading text={`${phase}　已經過 ${elapsed} 秒`} /> : !result ? <Empty text={isUpload ? '① 下載 Excel 範本並填入您的進流資料　② 選擇檔案　③ 按「開始模擬」' : `${t.compare.hint}；也可點左上「📂 上傳我的資料」用自己的進流資料模擬`} /> : layout.error ? <Empty error={layout.error} /> : sceneProps && run && (
                <ErrorBoundary>
                  <PlantScene {...sceneProps} getVars={i ? getB : getA} />
                </ErrorBoundary>
              )}
              {result && (
                <div className="scene-legend">
                  <span>DO₃ <b className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(vars['R5.SO'] as number, 2)}</b></span>
                  <span>NH₄ <b className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(vars['EFF.SNH'] as number, 2)}</b></span>
                  <span>TN <b className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(vars['EFF.TN'] as number, 1)}</b></span>
                  <span>曝氣 <b className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(vars['ENERGY.aeration_kW'] as number, 0)} kW</b></span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Panel className="timeline-bar" bodyClass="timeline" style={{ flex: 'none' }}>
        <button className="btn" disabled={!result} onClick={() => {
          if (tRef.current >= tMax) tRef.current = 0;
          setPlaying((p) => !p);
        }}>{playing ? `❚❚ ${t.compare.pause}` : `▶ ${t.compare.play}`}</button>
        <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{t.compare.speed}</span>
        {SPEEDS.map((s) => <button key={s} className={`btn small ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}x</button>)}
        <input
          type="range" min={0} max={tMax || 1} step={1} disabled={!result}
          value={Math.round(tRef.current)}
          onChange={(e) => { tRef.current = Number(e.target.value); setTick((x) => x + 1); }}
        />
        <span className="time">{result ? fmtSimTime(tRef.current + (result.summaries[0]?.scenario_id === UPLOAD ? uploadInfo?.clockOffsetMin ?? 0 : 0)) : '--'}</span>
        {result && (
          <span className="section-chips" title="展開／收合下方區塊，搭配上方 3D 畫面一起看">
            {SECTIONS.map(([k, label]) => (
              <button key={k} className={`btn small ${open[k] ? 'on' : ''}`} aria-pressed={open[k]} onClick={() => toggle(k)}>{open[k] ? '▾' : '▸'} {label}</button>
            ))}
          </span>
        )}
      </Panel>

      <div className="compare-bottom">
        {result && kpiMeta.data ? (
          <>
            <Panel
              className={open.kpi ? '' : 'collapsed'}
              style={{ flex: 'none' }}
              title={<SectionToggle open={open.kpi} onToggle={() => toggle('kpi')}>{t.compare.kpi}（{names[0]} → {names[1]}）</SectionToggle>}
              extra={!open.kpi && <span className="collapsed-summary">{kpiSummary(result.summaries)}</span>}
            >
              {open.kpi && <KpiCards meta={kpiMeta.data} a={result.summaries[0]} b={result.summaries[1]} />}
            </Panel>
            <SavingsPanel names={names} summaries={result.summaries} states={result.states} open={open.savings} onToggle={() => toggle('savings')} />
            <Panel
              className={open.charts ? '' : 'collapsed'}
              style={{ flex: 'none' }}
              bodyClass="nopad"
              title={<SectionToggle open={open.charts} onToggle={() => toggle('charts')}>差異曲線（<span style={{ color: COLOR_A }}>{names[0]}</span> vs <span style={{ color: COLOR_B }}>{names[1]}</span>，橘線為目前播放時間）</SectionToggle>}
              extra={!open.charts && <span className="collapsed-summary">{DIFF_VARS.map((d) => d.label).join('、')}</span>}
            >
              {open.charts && (
                <div className="diff-charts">
                  {DIFF_VARS.map((d) => (
                    <Panel key={d.key} bodyClass="nopad">
                      <DiffChart def={d} runs={result.states} names={names} tRef={tRef} tick={tick} />
                    </Panel>
                  ))}
                </div>
              )}
            </Panel>
          </>
        ) : kpiMeta.loading ? <Loading /> : null}
      </div>
    </div>
  );
}
