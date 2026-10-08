import { useEffect, useState } from 'react';
import { api, IS_MOCK, refreshHealth } from './api/client';
import type { Plant } from './api/types';
import { useAsync } from './hooks/useAsync';
import { useBackendStatus, useLive } from './hooks/useLive';
import { t } from './i18n';
import { Header, type PageKey } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { Loading } from './components/Panel';
import ErrorBoundary from './components/ErrorBoundary';
import OverviewPage from './pages/OverviewPage';
import FlowPage from './pages/FlowPage';
import ComparePage from './pages/ComparePage';
import DataPage from './pages/DataPage';
import LabPage from './pages/LabPage';

const PAGES: PageKey[] = ['overview', 'flow', 'compare', 'data', 'lab'];

function initialPage(): PageKey {
  const h = window.location.hash.replace('#', '') as PageKey;
  return PAGES.includes(h) ? h : 'overview';
}

export default function App() {
  const [page, setPage] = useState<PageKey>(initialPage);
  const [plantId, setPlantId] = useState<string>('muni');
  const status = useBackendStatus();

  useEffect(() => { void refreshHealth(); }, []);
  // 離線時每 10 秒自動重試
  useEffect(() => {
    if (status !== 'offline') return;
    const h = setInterval(() => void refreshHealth(), 10000);
    return () => clearInterval(h);
  }, [status]);
  useEffect(() => { window.location.hash = page; }, [page]);
  useEffect(() => {
    const on = () => setPage(initialPage());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const online = status === 'online' || status === 'mock' || status === 'static';
  const plants = useAsync<Plant[]>(() => api.plants(), [online]);
  const plant = plants.data?.find((p) => p.id === plantId) ?? plants.data?.[0];

  const layout = useAsync(() => (plant ? api.layout(plant.id) : Promise.reject(new Error('no plant'))), [plant?.id, online]);
  const tags = useAsync(() => (plant ? api.tags(plant.id) : Promise.resolve([])), [plant?.id, online]);
  const limits = useAsync(() => (plant ? api.limits(plant.id) : Promise.resolve({})), [plant?.id, online]);

  const liveEnabled = page !== 'compare' && online;
  const live = useLive(liveEnabled ? plant?.id : undefined, tags.data);

  return (
    <div className="app">
      <Header
        page={page}
        onPage={setPage}
        plants={plants.data ?? []}
        plantId={plant?.id ?? plantId}
        onPlant={setPlantId}
        status={status}
        liveConnected={live.connected && liveEnabled}
        liveTs={live.ts}
      />
      <main className="main">
        {status === 'offline' && <OfflineBanner />}
        <ErrorBoundary key={page}>
          {!plant ? (
            plants.loading || status === 'checking' ? <Loading /> : <div className="empty">{t.status.offline}{IS_MOCK ? '' : ' — 可於網址加上 ?mock=1 使用模擬資料'}</div>
          ) : page === 'overview' ? (
            <OverviewPage plant={plant} layout={layout} tags={tags.data ?? []} limits={limits.data ?? {}} live={live} />
          ) : page === 'flow' ? (
            <FlowPage plant={plant} layout={layout} tags={tags.data ?? []} limits={limits.data ?? {}} live={live} />
          ) : page === 'compare' ? (
            <ComparePage plants={plants.data ?? []} currentPlant={plant} />
          ) : page === 'lab' ? (
            <LabPage plant={plant} layout={layout} tags={tags.data ?? []} />
          ) : (
            <DataPage plant={plant} tags={tags} live={live} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
