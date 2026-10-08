import { useEffect, useMemo, useState } from 'react';
import type { RunStates, RunSummary } from '../api/types';
import { Panel } from './Panel';
import { fmtNum } from '../lib/vars';

// 預設值（可在畫面上修改）：
// 電價：台電 2025 年工業用電平均電價約 4.27 元/度（2025 上、下半年皆凍漲）
// 排碳係數：經濟部能源署 2026/6 公布 114 年度「產業電力排碳係數」0.466 kgCO2e/度
const DEFAULTS = { price: 4.27, ef: 0.466 };
const KEY = 'wt.savings.v1';

function loadPrefs(): { price: number; ef: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.price === 'number' && typeof v.ef === 'number') return v;
  } catch { /* 無痕視窗等情況 */ }
  return DEFAULTS;
}

const mean = (a: (number | null)[] | undefined) => {
  const v = (a ?? []).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
};

interface Props { names: string[]; summaries: RunSummary[]; states: RunStates[] }

export default function SavingsPanel({ names, summaries, states }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const simQ = useMemo(() => mean(states[0]?.series['INF.Q']), [states]);
  const [flow, setFlow] = useState<number>(Math.round(simQ));
  useEffect(() => { setFlow(Math.round(simQ)); }, [simQ]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  const eA = summaries[0]?.kpis.total_energy_kWh_d ?? NaN;
  const eB = summaries[1]?.kpis.total_energy_kWh_d ?? NaN;
  const ratio = simQ > 0 && flow > 0 ? flow / simQ : 1;          // 換算到業主處理量（能耗與處理量成正比）
  const dDay = (eA - eB) * ratio;                                  // 正值 = B（AI）較省
  const dYear = dDay * 365;
  const money = dYear * prefs.price;
  const co2 = dYear * prefs.ef / 1000;                              // tCO2e
  const pct = eA > 0 ? (eA - eB) / eA * 100 : NaN;
  const perM3 = flow > 0 ? dDay / flow : NaN;
  const saving = dDay >= 0;
  const cls = saving ? 'good' : 'bad';
  const eqiA = summaries[0]?.kpis.EQI, eqiB = summaries[1]?.kpis.EQI;
  const eqiPct = typeof eqiA === 'number' && typeof eqiB === 'number' && eqiA > 0 ? (eqiB - eqiA) / eqiA * 100 : null;

  const num = (v: number, set: (n: number) => void, step: number) => (
    <input className="input num" type="number" step={step} min={0} value={v} style={{ width: 92 }}
      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) set(n); }} />
  );

  return (
    <Panel
      title={`AI 量化效益估算（${names[1]} 相對於 ${names[0]}）`}
      style={{ flex: 'none' }}
      extra={<span title="以模擬期間的平均日能耗外推一年；能耗依處理量等比例換算">年化估算 · 可調整參數</span>}
    >
      <div className="savings">
        <div className="savings-inputs">
          <label>電價（元/度）{num(prefs.price, (price) => setPrefs((p) => ({ ...p, price })), 0.01)}</label>
          <label>電力排碳係數（kgCO₂e/度）{num(prefs.ef, (ef) => setPrefs((p) => ({ ...p, ef })), 0.001)}</label>
          <label>換算處理量（m³/d）{num(flow, setFlow, 100)}</label>
          <button className="btn small" onClick={() => { setPrefs(DEFAULTS); setFlow(Math.round(simQ)); }}>還原預設</button>
          <span className="savings-src">預設：台電 2025 工業平均電價 4.27 元/度；能源署 114 年度產業電力排碳係數 0.466 kgCO₂e/度</span>
        </div>
        <div className="savings-grid">
          <div className={`saving-card ${cls}`}>
            <div className="k">每年{saving ? '節省' : '增加'}電費</div>
            <div className="v">NT$ {fmtNum(Math.abs(money) / 10000, 1)}<small>萬元</small></div>
            <div className="sub">每日 NT$ {fmtNum(Math.abs(dDay * prefs.price), 0)}</div>
          </div>
          <div className={`saving-card ${cls}`}>
            <div className="k">每年{saving ? '減少' : '增加'}碳排放</div>
            <div className="v">{fmtNum(Math.abs(co2), 1)}<small>tCO₂e</small></div>
            <div className="sub">每日 {fmtNum(Math.abs(dDay * prefs.ef), 0)} kgCO₂e</div>
          </div>
          <div className={`saving-card ${cls}`}>
            <div className="k">每年{saving ? '節省' : '增加'}用電</div>
            <div className="v">{fmtNum(Math.abs(dYear) / 1000, 1)}<small>MWh</small></div>
            <div className="sub">總能耗 {saving ? '−' : '+'}{fmtNum(Math.abs(pct), 1)}% · {fmtNum(Math.abs(perM3) * 1000, 2)} Wh/m³</div>
          </div>
          <div className={`saving-card ${eqiPct === null ? '' : eqiPct <= 0 ? 'good' : 'bad'}`}>
            <div className="k">出水品質指標 EQI</div>
            <div className="v">{eqiPct === null ? '—' : `${eqiPct > 0 ? '+' : ''}${fmtNum(eqiPct, 1)}`}<small>%</small></div>
            <div className="sub">{eqiPct === null ? '' : eqiPct <= 0 ? '放流汙染負荷降低（未計入金額）' : '放流汙染負荷增加（未計入金額）'}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
