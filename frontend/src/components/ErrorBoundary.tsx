import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

/** 避免單一頁面（例如 WebGL 不支援）造成整頁白屏 */
export default class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('[ErrorBoundary]', error); }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="empty">
          <span>畫面發生錯誤</span>
          <span className="error-text">{this.state.error.message}</span>
          <button className="btn small" onClick={() => this.setState({ error: null })}>重試</button>
        </div>
      );
    }
    return this.props.children;
  }
}
