import { useEffect, useState } from 'react';
import { api, type BackendStatus } from '../api/client';
import InfoModal from './InfoModal';
import type { Plant } from '../api/types';
import { t } from '../i18n';

export type PageKey = 'overview' | 'flow' | 'compare' | 'data' | 'lab';

interface Props {
  page: PageKey;
  onPage: (p: PageKey) => void;
  plants: Plant[];
  plantId: string;
  onPlant: (id: string) => void;
  status: BackendStatus;
  liveConnected: boolean;
  liveTs: number | null;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(h);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function Header({ page, onPage, plants, plantId, onPlant, status, liveConnected, liveTs }: Props) {
  const now = useClock();
  const [about, setAbout] = useState(false);
  const statusBadge =
    status === 'online' ? <span className="badge ok"><span className="dot" />{t.status.online}</span>
      : status === 'mock' ? <span className="badge warn"><span className="dot" />{t.status.mock}</span>
      : status === 'static' ? <span className="badge info" title={t.status.staticHint}><span className="dot" />{t.status.static}</span>
        : status === 'offline' ? <span className="badge danger pulse"><span className="dot" />{t.status.offline}</span>
          : <span className="badge info pulse"><span className="dot" />{t.status.checking}</span>;
  const liveTime = liveTs ? new Date(liveTs) : null;
  return (
    <header className="header">
      <div className="header-left">
        <nav className="nav">
          {(['overview', 'flow', 'compare', 'data', 'lab'] as PageKey[]).map((k) => (
            <button key={k} className={page === k ? 'active' : ''} onClick={() => onPage(k)}>{t.nav[k]}</button>
          ))}
        </nav>
      </div>
      <div className="title-block">
        <h1>{t.app.title}</h1>
        <div className="sub">{t.app.subtitle}</div>
      </div>
      <div className="header-right">
        {plants.length > 0 && (
          <select className="select" style={{ maxWidth: 210 }} value={plantId} onChange={(e) => onPlant(e.target.value)} title={t.overview.plant}>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {statusBadge}
        {page !== 'compare' && status !== 'offline' && (
          <span className={`badge ${liveConnected ? 'ok' : 'warn'}`} title={liveTime ? `資料時間 ${liveTime.toLocaleString('zh-TW')}` : ''}>
            <span className="dot" />{liveConnected ? t.status.liveOn : t.status.liveOff}
          </span>
        )}
        <button className="btn small" onClick={() => setAbout(true)} title="關於／致謝">關於</button>
        {about && (
          <InfoModal
            title="關於／致謝"
            load={() => api.licenses()}
            emptyText="目前沒有使用第三方 3D 資產，場景全部為程式參數化生成。"
            onClose={() => setAbout(false)}
            intro={<p style={{ color: 'var(--text-2)', marginTop: 0 }}>{t.app.title} · 前端：React、three.js、@react-three/fiber、drei、ECharts。以下為第三方 3D 資產授權清單：</p>}
          />
        )}
        <div className="clock">
          {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
          <small>{now.getFullYear()}/{pad(now.getMonth() + 1)}/{pad(now.getDate())} 週{WEEK[now.getDay()]}</small>
        </div>
      </div>
    </header>
  );
}
