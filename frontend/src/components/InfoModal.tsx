import type { ReactNode } from 'react';
import { useAsync } from '../hooks/useAsync';
import { Empty, Loading } from './Panel';

/** 通用值顯示（契約對 /api/models、/api/assets/licenses 欄位未細定，採通用呈現） */
function Val({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return <span className="num">{Number.isInteger(v) ? v : v.toFixed(4).replace(/0+$/, '')}</span>;
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join('、') : <>{v.map((x, i) => <div key={i}><Val v={x} /></div>)}</>;
  if (typeof v === 'object') {
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {Object.entries(v as Record<string, unknown>).map(([k, x]) => <span key={k}><span style={{ color: 'var(--text-3)' }}>{k}</span> <Val v={x} /></span>)}
      </span>
    );
  }
  return String(v);
}

function Item({ obj }: { obj: Record<string, unknown> }) {
  const title = (obj.name ?? obj.title ?? obj.id ?? '') as string;
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      {title && <div className="panel-title">{title}</div>}
      <div className="panel-body">
        <table className="table"><tbody>
          {Object.entries(obj).filter(([k]) => k !== 'name' && k !== 'title').map(([k, v]) => (
            <tr key={k}><td style={{ color: 'var(--text-2)', width: 140, verticalAlign: 'top' }}>{k}</td><td><Val v={v} /></td></tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

export default function InfoModal({ title, load, emptyText, onClose, intro }: { title: string; load: () => Promise<unknown>; emptyText: string; onClose: () => void; intro?: ReactNode }) {
  const d = useAsync(load, []);
  const data = d.data;
  const items: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : data && typeof data === 'object'
      ? Object.values(data).every((x) => x && typeof x === 'object' && !Array.isArray(x))
        // { model_id: {...} } 形式 → 每個鍵一張卡
        ? Object.entries(data as Record<string, Record<string, unknown>>).map(([k, v]) => ({ name: k, ...v }))
        : [data as Record<string, unknown>]
      : [];
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">{title}<span className="extra"><button className="btn small" onClick={onClose}>關閉 ✕</button></span></div>
        <div className="panel-body">
          {intro}
          {d.loading ? <Loading /> : d.error ? <Empty error={d.error} /> : items.length ? items.map((o, i) => <Item key={i} obj={o} />) : <Empty text={emptyText} />}
        </div>
      </div>
    </div>
  );
}
