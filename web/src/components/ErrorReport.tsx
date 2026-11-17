import { Component, useEffect, useState, type ReactNode } from 'react';
import { BUILD } from '../version';

/**
 * When something in the app goes wrong, show it on screen (instead of the till silently not reacting),
 * so the cashier can take a photo for TechPlug support.
 */
let push: ((m: string) => void) | null = null;
const pending: string[] = [];
function report(m: string) {
  const line = m.slice(0, 300);
  if (push) push(line);
  else pending.push(line);
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => report(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | string;
    const msg = typeof r === 'string' ? r : r?.message ?? String(r);
    // Network hiccups are handled (sync retries); only real faults are shown.
    if (/fetch|network|load failed|tunnel|offline/i.test(msg)) return;
    report(msg);
  });
}

export function ErrorBar() {
  const [errs, setErrs] = useState<string[]>(pending.splice(0));
  useEffect(() => {
    push = (m) => setErrs((x) => (x.includes(m) ? x : [...x.slice(-2), m]));
    return () => {
      push = null;
    };
  }, []);
  if (!errs.length) return null;
  return (
    <div className="error-bar" role="alert">
      <b>Something went wrong in the app.</b> Take a photo of this and send it to TechPlug. Version {BUILD}
      {errs.map((e) => (
        <div key={e} className="mono-sm">
          {e}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button className="btn small" onClick={() => location.reload()}>
          Reload
        </button>
        <button className="btn small" onClick={() => setErrs([])}>
          Hide
        </button>
      </div>
    </div>
  );
}

/** A screen that crashes while drawing shows the error and a Reload button instead of a blank page. */
export class ScreenGuard extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e) };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="error-bar" role="alert" style={{ position: 'static', transform: 'none', margin: 24 }}>
        <b>This screen could not open.</b> Take a photo of this and send it to TechPlug. Version {BUILD}
        <pre className="mono-sm" style={{ whiteSpace: 'pre-wrap' }}>{this.state.err}</pre>
        <button className="btn small" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
