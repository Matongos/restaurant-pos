import { useEffect, useState, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBookOpenText,
  LuChevronDown,
  LuChartColumn,
  LuClipboardList,
  LuClock,
  LuHouse,
  LuUtensils,
  LuCookingPot,
  LuGraduationCap,
  LuHandCoins,
  LuLogOut,
  LuMenu,
  LuMonitor,
  LuSettings,
  LuSquarePen,
  LuUsers,
  LuUtensilsCrossed,
  LuX,
  LuEllipsis,
  LuEllipsisVertical,
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

/** Product name shown in the sidebar (the restaurant's own name and logo go on receipts and the customer screen). */
export const PRODUCT_NAME = 'TechPlug';

function SideBrand() {
  const logo = useStore((s) => s.settings.logo);
  return (
    <div className="side-brand">
      <span className="side-logo" aria-hidden="true">
        {logo ? <img src={logo} alt="" /> : <LuUtensils />}
      </span>
      <span className="side-name">
        <b>{PRODUCT_NAME}</b>
        <small>RESTAURANT POS</small>
      </span>
    </div>
  );
}

/** Time and date, top right. */
function Clock() {
  const now = new Date(useNow(15000));
  return (
    <div className="clock-chip" aria-label={`Time ${now.toLocaleTimeString()}`}>
      <LuClock aria-hidden="true" />
      <span>
        <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
        <small>{now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</small>
      </span>
    </div>
  );
}

/** Online / offline dot. Today the till saves on this device either way; later it tells the cashier sales are queued. */
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function OnlineStatus() {
  const online = useOnline();
  const [open, setOpen] = useState(false);
  return (
    <div className="status-wrap">
      <button className={`online-chip ${online ? 'on' : 'off'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className="dot" aria-hidden="true" />
        {online ? 'Online' : 'Offline'}
        <LuChevronDown aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="more-scrim" style={{ background: 'transparent' }} onClick={() => setOpen(false)} />
          <div className="status-pop" role="dialog" aria-label="Connection">
            <b>{online ? 'Connected to the internet' : 'No internet connection'}</b>
            <p>Sales are saved on this device{online ? '' : ' and you can keep selling'}.</p>
          </div>
        </>
      )}
    </div>
  );
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

/** The screens this person may open, their own landing screen first. */
function useNavItems(): NavDef[] {
  const user = useCurrentUser();
  const orders = useStore((s) => s.orders);
  const credit = useStore((s) => s.credit);
  if (!user) return [];
  const openOrders = orders.filter((o) => !o.parentOrderId && !o.example && (o.status === 'in_kitchen' || o.status === 'ready')).length;
  const owed = [...balances(credit).values()].filter((b) => b > 0).length;
  const all: NavDef[] = [
    { to: '/till', label: 'Sell', perm: 'take_orders', Icon: LuHouse },
    { to: '/orders', label: 'Orders', perm: 'active_orders', Icon: LuClipboardList, badge: openOrders },
    { to: '/kitchen', label: 'Kitchen', perm: 'kitchen', Icon: LuCookingPot },
    { to: '/change-owed', label: 'Change', perm: 'change_owed', Icon: LuHandCoins, badge: owed },
    { to: '/todays-menu', label: 'Sold out', perm: 'todays_menu', Icon: LuUtensilsCrossed },
    { to: '/reports', label: 'Reports', perm: 'reports', Icon: LuChartColumn },
    { to: '/accounts', label: 'Books', perm: 'accounts', Icon: LuBookOpenText },
    { to: '/staff', label: 'Staff', perm: 'staff', Icon: LuUsers },
    { to: '/menu', label: 'Menu', perm: 'menu_edit', Icon: LuSquarePen },
    { to: '/settings', label: 'Settings', perm: 'till_settings', Icon: LuSettings },
  ];
  const home = homeFor(user.role);
  return all.filter((n) => can(user.role, n.perm)).sort((a, b) => (a.to === home ? -1 : b.to === home ? 1 : 0));
}

function openCustomerScreen() {
  const w = window.open('#/display?till=till-1', 'customer-display', 'popup,width=1024,height=640');
  if (w) toast('Customer screen opened — drag it to the second monitor and press F11.');
  else go('/display?till=till-1');
}

function NavButton({ n, onGo }: { n: NavDef; onGo?: () => void }) {
  const { path } = useRoute();
  return (
    <button
      className={`nav-item ${path === n.to ? 'on' : ''}`}
      onClick={() => {
        onGo?.();
        go(n.to);
      }}
      aria-current={path === n.to ? 'page' : undefined}
    >
      <span className="nav-ic">
        <n.Icon aria-hidden="true" />
        {!!n.badge && <span className="nav-badge">{n.badge}</span>}
      </span>
      <span className="nav-lbl">{n.label}</span>
      {!!n.badge && <span className="nav-badge-inline">{n.badge}</span>}
    </button>
  );
}

/**
 * Navigation.
 * - Desktop: navy sidebar with names. Tablets: the same, icons only (narrow).
 * - Phones: a bottom bar with the first screens, and the full sidebar as a drawer (☰).
 */
function Navigation({ drawer, setDrawer }: { drawer: boolean; setDrawer: (v: boolean) => void }) {
  const user = useCurrentUser();
  const tagline = useStore((s) => s.settings.tagline);
  const training = useStore((s) => s.settings.trainingMode);
  const items = useNavItems();
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [drawer, setDrawer]);
  if (!user) return null;
  const PHONE_SLOTS = 4;
  const phoneItems = items.length > PHONE_SLOTS + 1 ? items.slice(0, PHONE_SLOTS) : items;
  const close = () => setDrawer(false);
  const canTraining = can(user.role, 'reports');
  const canDisplay = can(user.role, 'take_orders') || can(user.role, 'screens');

  const sideContent = (inDrawer: boolean) => (
    <>
      <div className="side-top">
        <SideBrand />
        {inDrawer && (
          <button className="side-close" onClick={close} aria-label="Close menu">
            <LuX aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="side-items">
        {items.map((n) => (
          <NavButton key={n.to} n={n} onGo={inDrawer ? close : undefined} />
        ))}
      </div>
      {inDrawer && (
        <div className="side-items side-extra">
          {canDisplay && (
            <button className="nav-item" onClick={() => { close(); openCustomerScreen(); }}>
              <span className="nav-ic"><LuMonitor aria-hidden="true" /></span>
              <span className="nav-lbl">Customer screen</span>
            </button>
          )}
          {canTraining && (
            <button className="nav-item" onClick={() => updateSettings({ trainingMode: !training })}>
              <span className="nav-ic"><LuGraduationCap aria-hidden="true" /></span>
              <span className="nav-lbl">Training mode: {training ? 'on' : 'off'}</span>
            </button>
          )}
          <button className="nav-item" onClick={() => { close(); logout(); go('/'); }}>
            <span className="nav-ic"><LuLogOut aria-hidden="true" /></span>
            <span className="nav-lbl">Log out ({user.name.split(' ')[0]})</span>
          </button>
        </div>
      )}
      <div className="side-spacer" />
      {tagline && <div className="side-tagline">{tagline}</div>}
    </>
  );

  return (
    <>
      <nav className="side" aria-label="Main">
        {sideContent(false)}
      </nav>
      <nav className="bottom-nav" aria-label="Main (phone)">
        {phoneItems.map((n) => (
          <NavButton key={n.to} n={n} />
        ))}
        {phoneItems.length < items.length && (
          <button className="nav-item rail-more" onClick={() => setDrawer(true)} aria-expanded={drawer}>
            <span className="nav-ic"><LuMenu aria-hidden="true" /></span>
            <span className="nav-lbl">More</span>
          </button>
        )}
      </nav>
      {drawer && (
        <>
          <div className="drawer-scrim" onClick={close} />
          <nav className="side drawer" aria-label="Menu" role="dialog">
            {sideContent(true)}
          </nav>
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
              <button role="menuitem" onClick={() => { setOpen(false); openCustomerScreen(); }}>
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

/**
 * Header plus navigation. Every signed-in screen starts with this.
 * `bare` hides the title on wide screens (the Sell screen: the sidebar already says where you are).
 */
export function TopBar({ title, children, bare = false }: { title?: string; children?: ReactNode; bare?: boolean }) {
  const training = useStore((s) => s.settings.trainingMode);
  const [drawer, setDrawer] = useState(false);
  return (
    <>
      <Navigation drawer={drawer} setDrawer={setDrawer} />
      <header className="topbar">
        <button className="hamburger" onClick={() => setDrawer(true)} aria-label="Open menu">
          <LuMenu aria-hidden="true" />
        </button>
        {title && <h1 className={`title ${bare ? 'bare' : ''}`}>{title}</h1>}
        {training && <span className="training-pill">Training</span>}
        <div className="spacer" />
        <OnlineStatus />
        <Clock />
        {children && <div className="top-actions">{children}</div>}
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
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${className}`} style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-label={title}>
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
export function MoreMenu({
  items,
  label = 'More',
  down = false,
  vertical = false,
}: {
  items: { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }[];
  label?: string;
  /** Open below the button (for menus near the top of the screen). */
  down?: boolean;
  /** ⋮ instead of … */
  vertical?: boolean;
}) {
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
        {vertical ? <LuEllipsisVertical aria-hidden="true" /> : <LuEllipsis aria-hidden="true" />}
      </button>
      {open && (
        <div className={`menu-pop ${down ? 'down' : ''}`} role="menu">
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
