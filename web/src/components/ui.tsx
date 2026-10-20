import { useEffect, useState, type ReactNode } from 'react';
import { go } from '../router';
import { logout, useCurrentUser, useStore } from '../store/store';
import { ROLE_LABEL } from '../domain/rules';

export function BrandMark() {
  const settings = useStore((s) => s.settings);
  return (
    <div className="brand">
      {settings.logo ? (
        <img src={settings.logo} alt="" />
      ) : (
        <div className="brand-mark">{settings.restaurantName.slice(0, 1).toUpperCase()}</div>
      )}
      <span>{settings.restaurantName}</span>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

export function TopBar({ title, children }: { title?: string; children?: ReactNode }) {
  const user = useCurrentUser();
  const training = useStore((s) => s.settings.trainingMode);
  return (
    <div className="topbar">
      <button className="btn ghost" onClick={() => go('/')} aria-label="Home">
        <BrandMark />
      </button>
      {title && <strong className="title" style={{ fontSize: 18 }}>{title}</strong>}
      {training && <span className="training-pill">TRAINING MODE</span>}
      <div className="spacer" />
      {children}
      {user && (
        <div className="who">
          <div>
            <b>{user.name}</b>
          </div>
          <div>
            {ROLE_LABEL[user.role]} · <Clock />
          </div>
        </div>
      )}
      {user && (
        <button
          className="btn"
          onClick={() => {
            logout();
            go('/');
          }}
        >
          Log out
        </button>
      )}
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export function toast(message: string) {
  toastSetter?.(message);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast">{msg}</div> : null;
}

/** Re-render every `ms` (for timers). */
export function useTick(ms = 10000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
