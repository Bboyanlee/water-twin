import { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { api } from '../api/client';
import type { Agg, MeasurementsResponse, Plant, Tag } from '../api/types';
import { useAsync, type AsyncState } from '../hooks/useAsync';
import type { LiveState } from '../hooks/useLive';
import { t } from '../i18n';
import { Empty, Loading, Panel } from '../components/Panel';
import Chart from '../charts/Chart';
import { fmtNum } from '../lib/vars';

interface Props {
  plant: Plant;
  tags: AsyncState<Tag[]>;
  live: LiveState;
}

const AGGS: Agg[] = ['raw', '15m', '1h'];
const fmtDT = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function DataPage({ plant, tags, live }: Props) {
  const [cat, setCat] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [agg, setAgg] = useState<Agg>('15m');
  const [q, setQ] = useState('');
  const all = tags.data ?? [];
  const cats = useMemo(() => Array.from(new Set(all.map((x) => x.category))), [all]);
  const list = useMemo(() => all.filter((x) => (cat === 'all' || x.category === cat) && (!q || `${x.tag_id}${x.name}`.toLowerCase().includes(q.toLowerCase()))), [all, cat, q]);
  useEffect(() => { setSel(null); }, [plant.id]);
  useEffect(() => { if (!sel && list.length) setSel(list[0].tag_id); }, [list, sel]);
  const tag = all.find((x) => x.tag_id === sel);

  const m = useAsync<MeasurementsResponse>(() => (sel ? api.measurements([sel], { agg }) : Promise.resolve({ series: {} })), [sel, agg]);
  const s = sel ? m.data?.series[sel] : undefined;
  const stats = useMemo(() => {
    const v = (s?.v ?? []).filter((x): x is number => typeof x === 'number');
    if (!v.length) return null;
    return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length };
  }, [s]);
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    grid: { left: 54, right: 24, top: 30, bottom: 60 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${fmtNum(v as number, 3)} ${tag?.eng_unit ?? ''}` },
    xAxis: { type: 'time', axisLabel: { formatter: (v: number) => fmtDT(v) } },
    yAxis: { type: 'value', scale: true, name: tag?.eng_unit },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 14, borderColor: 'rgba(0,229,255,0.25)', textStyle: { color: '#7fa6c8' }, fillerColor: 'rgba(0,229,255,0.15)' }],
    series: [{
      name: tag?.name, type: 'line', showSymbol: false, sampling: 'lttb',
      data: s ? s.t.map((tt, i) => [tt, s.v[i]]) : [],
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,229,255,0.35)' }, { offset: 1, color: 'rgba(0,229,255,0)' }] } },
      markLine: tag && (tag.lo !== null || tag.hi !== null) ? { symbol: 'none', silent: true, lineStyle: { color: 'rgba(255,159,28,0.5)', type: 'dashed' }, label: { color: '#FF9F1C', formatter: '{b}' }, data: [...(tag.hi !== null ? [{ yAxis: tag.hi, name: '上限' }] : [])] } : undefined,
    }],
  }), [s, tag]);

  return (
    <div className="data-page">
      <Panel
        title={`${t.data.catalog}（${list.length}/${all.length}）`}
        extra={<input className="input" placeholder="搜尋點位…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 150 }} />}
      >
        <div className="filter-bar" style={{ marginBottom: 8 }}>
          <span style={{ color: 'var(--text-2)', fontSize: 12, alignSelf: 'center' }}>{t.data.category}</span>
          <button className={`btn small ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>{t.data.all}</button>
          {cats.map((c) => <button key={c} className={`btn small ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{t.category[c] ?? c}</button>)}
        </div>
        {tags.loading ? <Loading /> : tags.error ? <Empty error={tags.error} /> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t.data.columns.tag}</th><th>{t.data.columns.name}</th><th>{t.data.category}</th><th>{t.data.columns.unit}</th>
                <th style={{ textAlign: 'right' }}>{t.overview.latest}</th><th>{t.data.columns.eng}</th><th>{t.data.columns.sim}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.tag_id} className={`clickable ${sel === x.tag_id ? 'selected' : ''}`} onClick={() => setSel(x.tag_id)}>
                  <td className="num" style={{ color: 'var(--text-2)', fontSize: 12 }}>{x.tag_id}</td>
                  <td>{x.name}{x.is_setpoint && <span className="badge info" style={{ marginLeft: 6, padding: '0 6px' }}>SP</span>}</td>
                  <td><span className="badge info" style={{ padding: '0 8px' }}>{t.category[x.category] ?? x.category}</span></td>
                  <td>{x.unit_id}</td>
                  <td className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(live.values[x.tag_id], 2)}</td>
                  <td style={{ color: 'var(--text-3)' }}>{x.eng_unit}</td>
                  <td className="num" style={{ color: 'var(--text-3)', fontSize: 12 }}>{x.sim_var ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="side">
        <Panel
          title={tag ? `${t.data.trend}：${tag.name}` : t.data.trend}
          style={{ flex: 1 }}
          bodyClass="nopad"
          extra={<>{t.data.agg}{AGGS.map((a) => <button key={a} className={`btn small ${agg === a ? 'on' : ''}`} onClick={() => setAgg(a)}>{t.agg[a]}</button>)}</>}
        >
          {!sel ? <Empty text={t.data.selectTag} /> : m.loading ? <Loading /> : m.error ? <Empty error={m.error} /> : s && s.t.length ? <Chart option={option} notMerge /> : <Empty />}
        </Panel>
        {tag && (
          <Panel title="點位資訊" style={{ flex: 'none' }}>
            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="metric"><div className="label">最新</div><div className="value">{fmtNum(live.values[tag.tag_id], 2)}<small>{tag.eng_unit}</small></div></div>
              <div className="metric"><div className="label">平均</div><div className="value">{fmtNum(stats?.avg, 2)}</div></div>
              <div className="metric"><div className="label">最小</div><div className="value">{fmtNum(stats?.min, 2)}</div></div>
              <div className="metric"><div className="label">最大</div><div className="value">{fmtNum(stats?.max, 2)}</div></div>
            </div>
            <table className="table" style={{ marginTop: 8 }}>
              <tbody>
                <tr><td style={{ color: 'var(--text-2)' }}>{t.data.columns.tag}</td><td className="num">{tag.tag_id}</td><td style={{ color: 'var(--text-2)' }}>{t.data.columns.param}</td><td>{tag.param}</td></tr>
                <tr><td style={{ color: 'var(--text-2)' }}>{t.data.columns.range}</td><td className="num">{tag.lo ?? '—'} ~ {tag.hi ?? '—'} {tag.eng_unit}</td><td style={{ color: 'var(--text-2)' }}>{t.data.columns.period}</td><td className="num">{tag.period_s}</td></tr>
                <tr><td style={{ color: 'var(--text-2)' }}>{t.data.columns.sim}</td><td className="num">{tag.sim_var ?? '—'}</td><td style={{ color: 'var(--text-2)' }}>資料筆數</td><td className="num">{stats?.n ?? 0}</td></tr>
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  );
}
