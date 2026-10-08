import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { api } from '../api/client';
import type { LayoutUnit, MeasurementsResponse, Tag } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import type { LiveState } from '../hooks/useLive';
import { t } from '../i18n';
import Chart, { fmtTime } from '../charts/Chart';
import { Empty, Loading } from './Panel';
import { fmtNum } from '../lib/vars';

interface Props {
  unit: LayoutUnit;
  tags: Tag[];
  live: LiveState;
  onClose: () => void;
}

const TYPE_ZH: Record<string, string> = {
  influent: '進流', screen: '攔污柵', equalization: '調勻池', anoxic_tank: '缺氧槽', aerobic_tank: '好氧槽', clarifier: '沉澱池',
  effluent: '放流', blower: '鼓風機', pump: '泵', reactor: '反應槽', chem_tank: '加藥桶', filter: '過濾', ro: 'RO', sludge: '污泥處理', control_room: '中控室',
};

export default function UnitDrawer({ unit, tags, live, onClose }: Props) {
  const ids = useMemo(() => tags.map((x) => x.tag_id), [tags]);
  const m = useAsync<MeasurementsResponse>(() => (ids.length ? api.measurements(ids, { agg: "15m" }) : Promise.resolve({ series: {} })), [ids.join(",")]);
  const option = useMemo<EChartsOption | null>(() => {
    if (!m.data) return null;
    return {
      animation: false,
      grid: { left: 44, right: 14, top: 34, bottom: 24 },
      legend: { top: 0, type: 'scroll' },
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtNum(v as number, 2) },
      xAxis: { type: 'time', axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: 'value', scale: true },
      series: tags.map((tag) => {
        const s = m.data!.series[tag.tag_id];
        return { name: tag.name, type: 'line', showSymbol: false, data: s ? s.t.map((tt, i) => [tt, s.v[i]]) : [] };
      }),
    };
  }, [m.data, tags]);

  if (!unit) return null;
  const meta = unit.meta ?? {};
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <h3>{unit.name}</h3>
          <div className="meta">{unit.id} · {TYPE_ZH[unit.type] ?? unit.type} · {unit.size.join(' × ')} m
            {typeof meta.volume_m3 === 'number' && ` · ${meta.volume_m3} m³`}</div>
        </div>
        <button className="btn small" onClick={onClose}>{t.overview.close} ✕</button>
      </div>
      <div className="drawer-body">
        <div className="panel" style={{ flex: 'none' }}>
          <div className="panel-title">{t.overview.latest}</div>
          <div className="panel-body" style={{ maxHeight: 260 }}>
            {tags.length ? (
              <table className="table">
                <tbody>
                  {tags.map((tag) => {
                    const v = live.values[tag.tag_id];
                    return (
                      <tr key={tag.tag_id}>
                        <td>{tag.name}{tag.is_setpoint && <span className="badge info" style={{ marginLeft: 6, padding: '0 6px' }}>設定值</span>}</td>
                        <td className="num" style={{ color: 'var(--cyan)', fontSize: 15 }}>{fmtNum(v, 2)}</td>
                        <td style={{ color: 'var(--text-3)' }}>{tag.eng_unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <Empty text="此單元無量測點位" />}
          </div>
        </div>
        {tags.length > 0 && (
          <div className="panel" style={{ flex: 'none', height: 300 }}>
            <div className="panel-title">{t.overview.trend24h}</div>
            <div className="panel-body nopad">
              {m.loading ? <Loading /> : m.error ? <Empty error={m.error} /> : option && <Chart option={option} notMerge />}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
