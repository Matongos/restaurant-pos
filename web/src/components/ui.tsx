import { useEffect, useState, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBookOpenText,
  LuChevronDown,
  LuChartColumn,
  LuCookingPot,
  LuGraduationCap,
  LuHandCoins,
  LuLogOut,
  LuMenu,
  LuMonitor,
  LuReceiptText,
  LuSettings,
  LuShoppingBasket,
  LuSquarePen,
  LuUtensilsCrossed,
  LuX,
  LuEllipsis,
} from 'react-icons/lu';
import { go, useRoute } from '../router';
import { logout, updateSettings, useCurrentUser, useStore } from '../store/store';
import { balances, can, ROLE_LABEL, type Permission } from '../domain/rules';
import type { Role } from '../domain/types';

export function BrandMark({ withName = true }: { withName?: boolean }) {
  const settings = useStore((s) => s.settings);
  return (
    <div className="brand">
      {settings.logo ? (
        <img src={settings.logo} alt={settings.restaurantName} />
      ) : (
        <div className="brand-mark" aria-hidden="true">
          {settings.restaurantName.slice(0, 1).toUpperCase()}
        </div>
      )}
      {withName && <span className="name">{settings.restaurantName}</span>}
    </div>
  );
}

function Clock() {
  const now = useNow(15000);
  return <span className="clock-chip">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

/** Where each role lands after logging in. */
export function homeFor(role: Role): string {
  return role === 'kitchen' ? '/kitchen' : role === 'attendant' ? '/orders' : role === 'super_admin' ? '/reports' : '/till';
}

interface NavDef {
  to: string;
  label: string;
  perm: Permission;
  Icon: IconType;
  badge?: number;
}

/**
 * Persistent navigation: a side rail on tablets and desktops, a bottom bar on phones
 * (first four items + More). Items depend on the person's role.
 */
function NavRail() {
  const user = useCurrentUser();
  const { path } = useRoute();
  const orders = useStore((s) => s.orders);
  const credit = useStore((s) => s.credit);
  const settings = useStore((s) => s.settings);
  const [more, setMore] = useState(false);
  if (!user) return null;

  const openOrders = orders.filter((o) => !o.parentOrderId && !o.example && (o.status === 'in_kitchen' || o.status === 'ready')).length;
  const owed = [...balances(credit).values()].filter((b) => b > 0).length;

  const all: NavDef[] = [
    { to: '/till', label: 'Sell', perm: 'take_orders', Icon: LuShoppingBasket },
    { to: '/orders', label: 'Orders', perm: 'active_orders', Icon: LuReceiptText, badge: openOrders },
    { to: '/kitchen', label: 'Kitchen', perm: 'kitchen', Icon: LuCookingPot },
    { to: '/change-owed', label: 'Change', perm: 'change_owed', Icon: LuHandCoins, badge: owed },
    { to: '/todays-menu', label: 'Sold out', perm: 'todays_menu', Icon: LuUtensilsCrossed },
    { to: '/reports', label: 'Reports', perm: 'reports', Icon: LuChartColumn },
    { to: '/accounts', label: 'Books', perm: 'accounts', Icon: LuBookOpenText },
    { to: '/menu', label: 'Menu', perm: 'menu_edit', Icon: LuSquarePen },
    { to: '/settings', label: 'Settings', perm: 'settings', Icon: LuSettings },
  ];
  // The person's own landing screen comes first on the phone bar.
  const home = homeFor(user.role);
  const items = all.filter((n) => can(user.role, n.perm)).sort((a, b) => (a.to === home ? -1 : b.to === home ? 1 : 0));
  const PHONE_SLOTS = 4;
  const overflow = items.length > PHONE_SLOTS + 1 ? items.slice(PHONE_SLOTS) : [];

  const openDisplay = () => {
    setMore(false);
    const w = window.open('#/display?till=till-1', 'customer-display', 'popup,width=1024,height=640');
    if (w) toast('Customer screen opened — drag it to the second monitor and press F11.');
    else go('/display?till=till-1');
  };
  const signOut = () => {
    logout();
    go('/');
  };

  const item = (n: NavDef, extraClass = '') => (
    <button
      key={n.to}
      className={`nav-item ${path === n.to ? 'on' : ''} ${extraClass}`}
      onClick={() => {
        setMore(false);
        go(n.to);
      }}
      aria-current={path === n.to ? 'page' : undefined}
    >
      <n.Icon aria-hidden="true" />
      {n.label}
      {!!n.badge && <span className="nav-badge">{n.badge}</span>}
    </button>
  );

  const showDisplay = can(user.role, 'take_orders') || can(user.role, 'screens');
  const showTraining = can(user.role, 'reports');

  return (
    <>
      <nav className="rail" aria-label="Main">
        <button className="rail-brand" onClick={() => go(home)} aria-label="Home">
          <BrandMark withName={false} />
        </button>
        {items.map((n, i) => item(n, overflow.length && i >= PHONE_SLOTS ? 'overflow' : ''))}
        {overflow.length > 0 && (
          <button className="nav-item rail-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <LuMenu aria-hidden="true" />
            More
          </button>
        )}
        <div className="rail-spacer" />
      </nav>
      {more && (
        <>
          <div className="more-scrim" onClick={() => setMore(false)} />
          <div className="more-sheet" role="menu">
            {overflow.map((n) => item(n))}
            {showDisplay && (
              <button className="nav-item" onClick={openDisplay}>
                <LuMonitor aria-hidden="true" />
                Customer screen
              </button>
            )}
            {showTraining && (
              <button className={`nav-item ${settings.trainingMode ? 'on' : ''}`} onClick={() => updateSettings({ trainingMode: !settings.trainingMode })}>
                <LuGraduationCap aria-hidden="true" />
                Training {settings.trainingMode ? 'on' : 'off'}
              </button>
            )}
            <button className="nav-item" onClick={signOut}>
              <LuLogOut aria-hidden="true" />
              Log out ({user.name.split(' ')[0]})
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Who is signed in, top-right of every screen: tap to log out (or open the customer screen). */
function UserMenu() {
  const user = useCurrentUser();
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const showDisplay = can(user.role, 'take_orders') || can(user.role, 'screens');
  const showTraining = can(user.role, 'reports');
  const openDisplay = () => {
    setOpen(false);
    const w = window.open('#/display?till=till-1', 'customer-display', 'popup,width=1024,height=640');
    if (w) toast('Customer screen opened — drag it to the second monitor and press F11.');
    else go('/display?till=till-1');
  };
  return (
    <div className="user-wrap">
      <button className="user-btn" onClick={() => setOpen((u) => !u)} aria-haspopup="menu" aria-expanded={open} aria-label={`${user.name}, ${ROLE_LABEL[user.role]} — account menu`}>
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="who">
          <b>{user.name.split(' ')[0]}</b>
          <small>{ROLE_LABEL[user.role]}</small>
        </span>
        <LuChevronDown aria-hidden="true" className="chev" />
      </button>
      {open && (
        <>
          <div className="more-scrim" style={{ background: 'transparent' }} onClick={() => setOpen(false)} />
          <div className="user-pop" role="menu">
            <div className="who-line">
              <b>{user.name}</b>
              <span className="muted">{ROLE_LABEL[user.role]}</span>
            </div>
            {showDisplay && (
              <button role="menuitem" onClick={openDisplay}>
                <LuMonitor aria-hidden="true" />
                Open customer screen
              </button>
            )}
            {showTraining && (
              <button role="menuitemcheckbox" aria-checked={settings.trainingMode} onClick={() => updateSettings({ trainingMode: !settings.trainingMode })}>
                <LuGraduationCap aria-hidden="true" />
                Training mode
                <span className="state">{settings.trainingMode ? 'On' : 'Off'}</span>
              </button>
            )}
            <button role="menuitem" className="danger" onClick={() => { logout(); go('/'); }}>
              <LuLogOut aria-hidden="true" />
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Screen header plus the navigation. Every signed-in screen starts with this. */
export function TopBar({ title, children }: { title?: string; children?: ReactNode }) {
  const training = useStore((s) => s.settings.trainingMode);
  return (
    <>
      <NavRail />
      <header className="topbar">
        {title && <h1 className="title">{title}</h1>}
        {training && <span className="training-pill">TRAINING</span>}
        <div className="spacer" />
        {children}
        <Clock />
        <UserMenu />
      </header>
    </>
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
          <button className="btn ghost icon-only" onClick={onClose} aria-label="Close">
            <LuX aria-hidden="true" />
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

/** Current time, refreshed every `ms` (live timers). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Re-render every `ms` (for timers). */
export function useTick(ms = 10000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** "More" button with a small menu: keeps rare or risky actions away from the main ones. */
export function MoreMenu({ items, label = 'More' }: { items: { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => window.addEventListener('click', close), 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu-wrap">
      <button className="btn icon-only" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <LuEllipsis aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={it.onClick}>
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
