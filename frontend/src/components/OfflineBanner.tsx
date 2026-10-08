import { refreshHealth } from '../api/client';
import { t } from '../i18n';

export function OfflineBanner() {
  const toMock = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('mock', '1');
    window.location.href = u.toString();
  };
  return (
    <div className="offline-banner" role="alert">
      <span className="icon">⚠</span>
      <div>
        <b>{t.status.offline}</b>
        <p>{t.status.offlineHint}</p>
      </div>
      <button className="btn small" onClick={() => void refreshHealth()}>{t.status.retry}</button>
      <button className="btn small" onClick={toMock}>{t.status.useMock}</button>
    </div>
  );
}
