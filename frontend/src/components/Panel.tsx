import type { ReactNode } from 'react';
import { t } from '../i18n';

interface PanelProps {
  title?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bodyClass?: string;
}

export function Panel({ title, extra, children, className = '', style, bodyClass = '' }: PanelProps) {
  return (
    <section className={`panel ${className}`} style={style}>
      {title !== undefined && (
        <div className="panel-title">
          <span>{title}</span>
          {extra && <span className="extra">{extra}</span>}
        </div>
      )}
      <div className={`panel-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** 可收合區塊的標題按鈕（放在 Panel 的 title） */
export function SectionToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="section-toggle" aria-expanded={open} onClick={onToggle} title={open ? '點擊收合' : '點擊展開'}>
      <span className="caret">{open ? '▾' : '▸'}</span>{children}
    </button>
  );
}

export function Loading({ text = t.status.loading }: { text?: string }) {
  return (
    <div className="loading-box">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ text = t.status.noData, error }: { text?: string; error?: Error }) {
  return (
    <div className="empty">
      <span>{error ? t.status.error : text}</span>
      {error && <span className="error-text">{error.message}</span>}
    </div>
  );
}
