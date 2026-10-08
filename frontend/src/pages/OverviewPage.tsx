import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { api } from '../api/client';
import type { Layout, Limits, Plant, Tag } from '../api/types';
import type { AsyncState } from '../hooks/useAsync';
import type { LiveState } from '../hooks/useLive';
import { t } from '../i18n';
import { Empty, Loading, Panel } from '../components/Panel';
import Chart, { fmtTime } from '../charts/Chart';
import ErrorBoundary from '../components/ErrorBoundary';
import PlantScene, { type ColorMode } from '../three/PlantScene';
import { DO_STOPS, NH4_STOPS, stopsGradient } from '../three/colors';
import { checkLimits, FlowNormalizer, fmtNum, KIND_COLOR, pick } from '../lib/vars';
import UnitDrawer from '../components/UnitDrawer';

interface Props {
  plant: Plant;
  layout: AsyncState<Layout>;
  tags: Tag[];
  limits: Limits;
  live: LiveState;
}

interface AlarmItem { id: string; ts: number; level: 'danger' | 'warn'; text: string }

/** 放流標準鍵（例如 EFF.SNH）對應的顯示名稱 */
function limitLabel(key: string, tags: Tag[]): string {
  const tag = tags.find((x) => x.sim_var === key || `${x.unit_id}.${x.param}` === key || x.tag_id === `${x.plant_id}.${key}`);
  return t.vars[key] ?? tag?.name ?? key;
}

export default function OverviewPage({ plant, layout, tags, limits, live }: Props) {
  const [colorMode, setColorMode] = useState<ColorMode>('do');
  const [showLabels, setShowLabels] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const normalizer = useMemo(() => new FlowNormalizer(), [plant.id]);
  const getVars = useCallback(() => live.varsRef.current, [live.varsRef]);
  useEffect(() => setSelected(null), [plant.id]);

  const unitType = useMemo(() => new Map((layout.data?.units ?? []).map((u) => [u.id, u.type])), [layout.data]);
  const infTags = useMemo(() => {
    const inf = tags.filter((x) => unitType.get(x.unit_id) === 'influent' || x.sim_var?.startsWith('INF.'));
    if (inf.length) return inf;
    // 工業廢水廠無 influent 單元時，以調勻池的水質點位代表進流
    return tags.filter((x) => unitType.get(x.unit_id) === 'equalization' && x.category !== 'event');
  }, [tags, unitType]);

  // 即時曲線：DO（各好氧槽）+ 氨氮；非市政廠取前兩個水質點位
  const curveTags = useMemo(() => {
    const dos = tags.filter((x) => x.param === 'DO');
    const nh4 = tags.filter((x) => (x.param === 'NH4' || x.sim_var?.endsWith('.SNH')) && x.unit_id !== 'INF' && unitType.get(x.unit_id) !== 'influent');
    const pickNh = nh4.find((x) => x.sim_var === 'R5.SNH') ?? nh4[0];
    const list = [...dos, ...(pickNh ? [pickNh] : [])];
    return list.length ? list : tags.filter((x) => x.category === 'water_quality').slice(0, 3);
  }, [tags, unitType]);

  const [seed, setSeed] = useState<{ t: number[]; v: Record<string, (number | null)[]> }>({ t: [], v: {} });
  // 以即時串流的第一筆時間為錨點，往前抓 3 小時歷史接在曲線前面
  const anchor = live.history.current.t[0] ?? null;
  useEffect(() => {
    setSeed({ t: [], v: {} });
    if (!curveTags.length || anchor === null) return;
    let alive = true;
    api.measurements(curveTags.map((x) => x.tag_id), { start: anchor - 3 * 3600_000, end: anchor - 1 }).then((m) => {
      if (!alive) return;
      const first = m.series[curveTags[0].tag_id];
      if (!first) return;
      const n = first.t.length;
      const from = Math.max(0, n - 180);
      const v: Record<string, (number | null)[]> = {};
      for (const tag of curveTags) v[tag.tag_id] = (m.series[tag.tag_id]?.v ?? []).slice(from);
      setSeed({ t: first.t.slice(from), v });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [curveTags, anchor]);

  const curveOption = useMemo<EChartsOption>(() => {
    const h = live.history.current;
    const firstLive = h.t[0] ?? Infinity;
    // 歷史資料只在「緊接於即時串流之前」時才接上（後端 WS 為重播，時間可能早於歷史資料結尾）
    const seedEnd = seed.t[seed.t.length - 1];
    const seedOk = seed.t.length > 0 && (firstLive === Infinity || (seedEnd <= firstLive && firstLive - seedEnd < 30 * 60000));
    const seedIdx = seedOk ? seed.t.map((x, i) => [x, i] as const).filter(([x]) => x < firstLive) : [];
    const ts = [...seedIdx.map(([x]) => x), ...h.t];
    const series = curveTags.map((tag) => {
      const isNh = tag.param !== 'DO';
      const data = ts.map((tt, i) => {
        const v = i < seedIdx.length ? seed.v[tag.tag_id]?.[seedIdx[i][1]] ?? null : h.v[tag.tag_id]?.[i - seedIdx.length] ?? null;
        return [tt, v];
      });
      return { name: tag.name.replace(/溶氧|氨氮/, (m) => (m === '溶氧' ? 'DO' : 'NH₄')), type: 'line' as const, yAxisIndex: isNh ? 1 : 0, data, showSymbol: false, lineStyle: { width: isNh ? 2.5 : 1.8, type: isNh ? ('solid' as const) : ('solid' as const) }, areaStyle: isNh ? { opacity: 0.08 } : undefined };
    });
    return {
      animation: false,
      grid: { left: 36, right: 36, top: 30, bottom: 22 },
      legend: { top: 0, type: 'scroll' },
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtNum(v as number, 2) },
      xAxis: { type: 'time', axisLabel: { formatter: (v: number) => fmtTime(v) }, splitLine: { show: false } },
      yAxis: [
        { type: 'value', name: 'DO', min: 0, splitNumber: 3 },
        { type: 'value', name: 'NH₄', min: 0, splitNumber: 3, splitLine: { show: false } },
      ],
      series,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.tick, seed, curveTags]);

  // 能耗
  const energy = useMemo(() => {
    const aer = pick(live.vars, 'ENERGY.aeration_kW');
    const pump = pick(live.vars, 'ENERGY.pumping_kW');
    if (aer !== null || pump !== null) return { total: (aer ?? 0) + (pump ?? 0), parts: [[t.overview.aeration, aer], [t.overview.pumping, pump]] as [string, number | null][] };
    const kw = tags.filter((x) => x.eng_unit === 'kW');
    const parts = kw.map((x) => [x.name, live.values[x.tag_id] ?? null] as [string, number | null]);
    return { total: parts.reduce((s, [, v]) => s + (v ?? 0), 0), parts };
  }, [live.vars, live.values, tags]);

  const gaugeOption = useMemo<EChartsOption>(() => {
    const max = Math.max(200, Math.ceil((energy.total * 1.6) / 50) * 50);
    return {
      series: [{
        type: 'gauge', min: 0, max, startAngle: 215, endAngle: -35, radius: '92%', center: ['50%', '58%'],
        progress: { show: true, width: 10, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#19B6FF' }, { offset: 1, color: '#00E5FF' }] }, shadowBlur: 12, shadowColor: '#00E5FF' } },
        axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(0,229,255,0.12)']] } },
        axisTick: { distance: -16, length: 4, lineStyle: { color: 'rgba(0,229,255,0.5)' } },
        splitLine: { distance: -18, length: 8, lineStyle: { color: 'rgba(0,229,255,0.6)' } },
        axisLabel: { distance: 14, color: '#7fa6c8', fontSize: 10 },
        pointer: { width: 4, length: '55%', itemStyle: { color: '#00E5FF' } },
        anchor: { show: true, size: 8, itemStyle: { color: '#00E5FF' } },
        title: { offsetCenter: [0, '72%'], color: '#9fc3e0', fontSize: 12 },
        detail: { offsetCenter: [0, '38%'], formatter: (v: number) => `${v.toFixed(0)} kW`, color: '#e6f7ff', fontSize: 20, fontFamily: 'JetBrains Mono' },
        data: [{ value: +energy.total.toFixed(1), name: t.overview.total }],
      }],
    };
  }, [energy.total]);

  // 告警：放流超標 / 接近標準 / 好氧槽低溶氧，累積成事件清單
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const activeRef = useRef(new Set<string>());
  useEffect(() => { setAlarms([]); activeRef.current.clear(); }, [plant.id]);
  useEffect(() => {
    if (!live.ts) return;
    const now = new Set<string>();
    const fresh: AlarmItem[] = [];
    for (const c of checkLimits(live.vars, limits)) {
      if (c.value === null) continue;
      const key = c.key;
      const label = limitLabel(c.varKey, tags);
      const std = `${c.side === 'min' ? '下限' : '標準'} ${c.limit}`;
      if (c.bad) { now.add(`D:${key}`); if (!activeRef.current.has(`D:${key}`)) fresh.push({ id: `${key}-${live.ts}`, ts: live.ts, level: 'danger', text: `${label} ${c.side === 'min' ? '低於下限' : '超標'} ${fmtNum(c.value)}（${std}）` }); }
      else if (c.near) { now.add(`W:${key}`); if (!activeRef.current.has(`W:${key}`)) fresh.push({ id: `${key}-w-${live.ts}`, ts: live.ts, level: 'warn', text: `${label} 接近標準 ${fmtNum(c.value)} / ${c.limit}` }); }
    }
    for (const u of layout.data?.units ?? []) {
      if (u.type !== 'aerobic_tank') continue;
      const v = pick(live.vars, `${u.id}.SO`, `${u.id}.DO`);
      if (v !== null && v < 0.5) { now.add(`L:${u.id}`); if (!activeRef.current.has(`L:${u.id}`)) fresh.push({ id: `${u.id}-do-${live.ts}`, ts: live.ts, level: 'warn', text: `${u.name} 溶氧偏低 ${fmtNum(v)} mg/L` }); }
    }
    activeRef.current = now;
    if (fresh.length) setAlarms((a) => [...fresh, ...a].slice(0, 40));
  }, [live.ts, live.vars, limits, tags, layout.data]);

  const activeCount = activeRef.current.size;

  return (
    <div className="overview">
      <div className="side">
        <Panel title={t.overview.influent} style={{ flex: 'none' }}>
          {infTags.length ? (
            <div className="metric-grid">
              {infTags.slice(0, 6).map((tag) => (
                <div className="metric" key={tag.tag_id}>
                  <div className="label">{tag.name}</div>
                  <div className="value">{fmtNum(live.values[tag.tag_id], tag.eng_unit.includes('m³') || tag.eng_unit === 'CMD' ? 0 : 1)}<small>{tag.eng_unit}</small></div>
                </div>
              ))}
            </div>
          ) : <Empty />}
        </Panel>
        <Panel title={t.overview.doNh4} style={{ flex: 1 }} bodyClass="nopad">
          {curveTags.length ? <Chart option={curveOption} notMerge /> : <Empty />}
        </Panel>
        <Panel title="管線流量" style={{ flex: 'none' }}>
          <div className="metric-grid">
            {[['FLOW.Qmain', '主流量'], ['FLOW.Qa', '內循環'], ['FLOW.Qr', '回流污泥'], ['FLOW.Qw', '廢棄污泥']]
              .filter(([k]) => pick(live.vars, k) !== null)
              .map(([k, n]) => (
                <div className="metric" key={k}>
                  <div className="label">{n}</div>
                  <div className="value" style={{ fontSize: 17 }}>{fmtNum(pick(live.vars, k), 0)}<small>m³/d</small></div>
                </div>
              ))}
          </div>
          {pick(live.vars, 'FLOW.Qa') === null && <Empty text={plant.has_simulator ? t.status.noData : t.overview.noSim} />}
        </Panel>
      </div>

      <div className="scene-wrap">
        <div className="scene-toolbar">
          <span className="badge info">{plant.name}</span>
          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{t.overview.colorBy}</span>
          <button className={`btn small ${colorMode === 'do' ? 'on' : ''}`} onClick={() => setColorMode('do')}>{t.overview.colorDO}</button>
          <button className={`btn small ${colorMode === 'nh4' ? 'on' : ''}`} onClick={() => setColorMode('nh4')}>{t.overview.colorNH4}</button>
          <button className={`btn small ${showLabels ? 'on' : ''}`} onClick={() => setShowLabels((s) => !s)}>標籤</button>
        </div>
        {layout.loading && !layout.data ? <Loading /> : layout.error ? <Empty error={layout.error} /> : layout.data && (
          <ErrorBoundary>
            <PlantScene
              layout={layout.data}
              tags={tags}
              getVars={getVars}
              normalizer={normalizer}
              limits={limits}
              colorMode={colorMode}
              showLabels={showLabels}
              selectedId={selected}
              onSelect={setSelected}
            />
          </ErrorBoundary>
        )}
        <div className="scene-legend">
          {Object.entries(KIND_COLOR).map(([k, c]) => <span key={k}><i style={{ background: c, boxShadow: `0 0 6px ${c}` }} />{t.linkKind[k]}</span>)}
          <span>
            {colorMode === 'do' ? 'DO 0' : 'NH₄ 0'}
            <i className="color-scale" style={{ background: stopsGradient(colorMode === 'do' ? DO_STOPS : NH4_STOPS), width: 90, height: 6 }} />
            {colorMode === 'do' ? '2+ mg/L' : '7+ mg/L'}
          </span>
          <span style={{ color: 'var(--text-3)' }}>點選單元查看詳情</span>
        </div>
        {selected && layout.data && (
          <UnitDrawer unit={layout.data.units.find((u) => u.id === selected)!} tags={tags.filter((x) => x.unit_id === selected)} live={live} onClose={() => setSelected(null)} />
        )}
      </div>

      <div className="side">
        <Panel title={t.overview.effluent} style={{ flex: 'none' }}>
          {Object.keys(limits).length ? checkLimits(live.vars, limits).map((c) => {
            const color = c.bad ? 'var(--danger)' : c.near ? 'var(--warn)' : 'var(--ok)';
            const label = limitLabel(c.varKey, tags).replace('放流', '') + (c.side === 'min' ? '↓' : c.key.endsWith('_hi') ? '↑' : '');
            // 下限型（例如 pH_lo）：bar 顯示實際值相對下限的位置
            const pos = c.side === 'min' ? (c.value === null ? 0 : Math.min(c.value / (c.limit * 1.3), 1)) : Math.min(c.ratio / 1.3, 1);
            return (
              <div className="limit-row" key={c.key}>
                <span title={c.key}>{label}</span>
                <div className="limit-bar">
                  <div className="fill" style={{ width: `${pos * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
                  <div className="mark" style={{ left: `${100 / 1.3}%` }} title={`${t.overview.limit} ${c.limit}`} />
                </div>
                <span className="val" style={{ color }}>{fmtNum(c.value, 2)}<span style={{ color: 'var(--text-3)' }}> / {c.limit}</span></span>
              </div>
            );
          }) : <Empty />}
        </Panel>
        <Panel title={t.overview.energy} style={{ flex: 'none', height: 230 }} bodyClass="nopad">
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', height: '100%' }}>
            <Chart option={gaugeOption} />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, paddingRight: 10 }}>
              {energy.parts.map(([n, v]) => (
                <div className="metric" key={n}>
                  <div className="label">{n}</div>
                  <div className="value" style={{ fontSize: 18 }}>{fmtNum(v, 1)}<small>kW</small></div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title={t.overview.alarms} style={{ flex: 1 }} extra={<span className={`badge ${activeCount ? 'danger pulse' : 'ok'}`}><span className="dot" />{activeCount ? `${activeCount} 項進行中` : '正常'}</span>}>
          {alarms.length ? (
            <ul className="alarm-list">
              {alarms.map((a) => (
                <li key={a.id} className={a.level}>
                  <span className="time">{fmtTime(a.ts)}</span>
                  <span>{a.text}</span>
                  <span style={{ color: a.level === 'danger' ? 'var(--danger)' : 'var(--warn)' }}>{a.level === 'danger' ? '異常' : '警示'}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text={t.overview.noAlarm} />}
        </Panel>
      </div>
    </div>
  );
}
