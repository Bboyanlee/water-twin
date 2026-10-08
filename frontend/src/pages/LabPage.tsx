import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EChartsOption } from 'echarts';
import type { Layout, Plant, Tag } from '../api/types';
import type { AsyncState } from '../hooks/useAsync';
import { Empty, Loading, Panel } from '../components/Panel';
import Chart from '../charts/Chart';
import { fmtNum } from '../lib/vars';
import { addLabSample, listLabSamples, type LabSample } from '../lib/supabase';

interface Props {
  plant: Plant;
  layout: AsyncState<Layout>;
  tags: Tag[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDT = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LabPage({ plant, layout, tags }: Props) {
  const [rows, setRows] = useState<LabSample[] | null>(null);
  const [loadErr, setLoadErr] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ unit_id: 'EFF', param: '', value: '', eng_unit: '', sampled_at: localInput(new Date()), note: '' });
  const [sel, setSel] = useState<string | null>(null);

  const reload = async () => {
    setLoadErr(null);
    try { setRows(await listLabSamples(plant.id)); } catch (e) { setLoadErr(e as Error); }
  };
  useEffect(() => { setRows(null); setSel(null); void reload(); }, [plant.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = layout.data?.units ?? [];
  const unitTags = useMemo(() => tags.filter((x) => x.unit_id === form.unit_id), [tags, form.unit_id]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pickParam = (param: string) => {
    const tg = unitTags.find((x) => x.param === param);
    setForm((f) => ({ ...f, param, eng_unit: tg?.eng_unit ?? f.eng_unit }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const value = form.value.trim() === '' ? null : Number(form.value);
    if (!form.param.trim()) { setMsg({ ok: false, text: '請填寫參數' }); return; }
    if (value !== null && !Number.isFinite(value)) { setMsg({ ok: false, text: '數值格式不正確' }); return; }
    setSaving(true);
    try {
      await addLabSample({
        plant_id: plant.id, unit_id: form.unit_id, param: form.param.trim().slice(0, 32), value,
        eng_unit: form.eng_unit.trim().slice(0, 16) || null, note: form.note.trim().slice(0, 200) || null,
        sampled_at: new Date(form.sampled_at).toISOString(),
      });
      setMsg({ ok: true, text: '已新增，資料已存到 Supabase' });
      setForm((f) => ({ ...f, value: '', note: '' }));
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: `新增失敗：${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  // 選取的「單元.參數」歷次化驗趨勢
  const series = useMemo(() => {
    if (!sel || !rows) return [];
    return rows.filter((r) => `${r.unit_id}.${r.param}` === sel && r.value !== null)
      .map((r) => [new Date(r.sampled_at).getTime(), r.value] as [number, number]).sort((a, b) => a[0] - b[0]);
  }, [rows, sel]);
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    grid: { left: 54, right: 20, top: 24, bottom: 36 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true },
    series: [{ type: 'line', data: series, symbolSize: 7, lineStyle: { width: 2 } }],
  }), [series]);

  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? id;

  return (
    <div className="data-page">
      <Panel
        title={`化驗紀錄（${rows?.length ?? 0} 筆）· ${plant.name}`}
        extra={<><span className="badge ok" title="資料存於 Supabase 雲端資料庫，重新整理後仍在"><span className="dot" />Supabase 雲端資料</span><button className="btn small" onClick={() => void reload()}>重新載入</button></>}
      >
        {loadErr ? <Empty error={loadErr} /> : !rows ? <Loading /> : rows.length === 0 ? <Empty text="此廠區尚無化驗紀錄，請由右側表單新增" /> : (
          <table className="table">
            <thead>
              <tr><th>採樣時間</th><th>單元</th><th>參數</th><th style={{ textAlign: 'right' }}>數值</th><th>單位</th><th>備註</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.unit_id}.${r.param}`;
                return (
                  <tr key={r.id} className={`clickable ${sel === key ? 'selected' : ''}`} onClick={() => setSel(key)}>
                    <td className="num" style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDT(r.sampled_at)}</td>
                    <td>{unitName(r.unit_id)}</td>
                    <td>{r.param}</td>
                    <td className="num" style={{ color: 'var(--cyan)' }}>{fmtNum(r.value ?? undefined, 3)}</td>
                    <td style={{ color: 'var(--text-3)' }}>{r.eng_unit ?? ''}</td>
                    <td style={{ color: 'var(--text-2)', fontSize: 12 }}>{r.note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="side">
        <Panel title="新增化驗紀錄" style={{ flex: 'none' }}>
          <form className="lab-form" onSubmit={submit}>
            <label>單元
              <select className="select" value={form.unit_id} onChange={(e) => { set('unit_id', e.target.value); set('param', ''); }}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.id}）</option>)}
              </select>
            </label>
            <label>參數
              <input className="input" list="lab-params" value={form.param} maxLength={32} placeholder="如 COD、NH4、Cu" onChange={(e) => pickParam(e.target.value)} />
              <datalist id="lab-params">{unitTags.map((x) => <option key={x.tag_id} value={x.param}>{x.name}</option>)}</datalist>
            </label>
            <label>數值
              <input className="input num" type="number" step="any" value={form.value} onChange={(e) => set('value', e.target.value)} />
            </label>
            <label>單位
              <input className="input" value={form.eng_unit} maxLength={16} placeholder="mg/L" onChange={(e) => set('eng_unit', e.target.value)} />
            </label>
            <label>採樣時間
              <input className="input" type="datetime-local" value={form.sampled_at} onChange={(e) => set('sampled_at', e.target.value)} />
            </label>
            <label className="wide">備註
              <input className="input" value={form.note} maxLength={200} placeholder="採樣人、方法、異常說明…" onChange={(e) => set('note', e.target.value)} />
            </label>
            <div className="wide" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '新增'}</button>
              {msg && <span className={msg.ok ? '' : 'error-text'} style={msg.ok ? { color: 'var(--ok)' } : undefined}>{msg.text}</span>}
            </div>
          </form>
        </Panel>
        <Panel title={sel ? `趨勢：${sel}` : '趨勢'} style={{ flex: 1 }} bodyClass="nopad">
          {!sel ? <Empty text="點選左側任一筆紀錄，查看同參數的歷次化驗趨勢" /> : series.length ? <Chart option={option} notMerge /> : <Empty />}
        </Panel>
      </div>
    </div>
  );
}
