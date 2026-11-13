import { useEffect, type ComponentType, type ReactElement } from 'react';
import { useRoute } from './router';
import { useCurrentUser, useStore } from './store/store';
import { can, type Permission } from './domain/rules';
import { homeFor, ToastHost, TopBar } from './components/ui';
import Login from './screens/Login';
import Till from './screens/Till';
import CustomerDisplay from './screens/CustomerDisplay';
import TodaysMenu from './screens/TodaysMenu';
import ActiveOrders from './screens/ActiveOrders';
import Kitchen from './screens/Kitchen';
import ChangeOwedScreen from './screens/ChangeOwed';
import SettingsScreen, { MenuScreen } from './screens/Settings';
import Analytics from './screens/Analytics';
import Accounts from './screens/Accounts';
import StaffScreen from './screens/StaffScreen';
import StockScreen from './screens/Stock';
import TablesScreen from './screens/Tables';
import { UpdateBar } from './components/AppInstall';
import { LinkNotice } from './components/CloudAccount';
import OnlineOrders, { OnlineOrderAlert } from './screens/OnlineOrders';
import { PostersScreen } from './components/WebsiteSettings';
import { OrderStatusPage, RestaurantPage } from './screens/PublicPages';
import Console from './screens/Console';
import Setup from './screens/Setup';
import { TrialBar } from './components/TrialBar';

const ROUTES: Record<string, { perm: Permission; el: ComponentType }> = {
  '/till': { perm: 'take_orders', el: Till },
  '/todays-menu': { perm: 'todays_menu', el: TodaysMenu },
  '/orders': { perm: 'active_orders', el: ActiveOrders },
  '/kitchen': { perm: 'kitchen', el: Kitchen },
  '/change-owed': { perm: 'change_owed', el: ChangeOwedScreen },
  '/settings': { perm: 'till_settings', el: SettingsScreen },
  '/menu': { perm: 'menu_edit', el: MenuScreen },
  '/reports': { perm: 'reports', el: Analytics },
  '/accounts': { perm: 'accounts', el: Accounts },
  '/staff': { perm: 'staff', el: StaffScreen },
  '/stock': { perm: 'stock', el: StockScreen },
  '/tables': { perm: 'tables', el: TablesScreen },
  '/online': { perm: 'take_orders', el: OnlineOrders },
  '/posters': { perm: 'settings', el: PostersScreen },
};

export default function App() {
  const { path, query } = useRoute();
  const user = useCurrentUser();
  const mode = useStore((s) => s.settings.serviceMode ?? 'counter');
  const brand = useStore((s) => s.settings.brandColor);

  useEffect(() => {
    document.documentElement.style.setProperty('--brand', brand);
  }, [brand]);

  // Which permission an address needs. Selling at a table only needs 'tables' (waiters can do it).
  const permFor = (p: string): Permission | undefined => {
    if (p === '/tables' && mode === 'counter') return undefined; // table service switched off
    if (p === '/till' && query.get('table')) return mode === 'counter' ? undefined : 'tables';
    if (p === '/till' && mode === 'tables') return undefined; // tables only: no counter till
    return ROUTES[p]?.perm;
  };
  const perm = permFor(path);

  // After login (or on an unknown address) each role goes straight to its own screen.
  const needsLanding = !!user && path !== '/display' && !/^\/(r\/|o\/|console|setup)/.test(path) && (!perm || !can(user.role, perm));
  useEffect(() => {
    if (needsLanding && user) window.location.replace(`#${homeFor(user.role, mode)}`);
  }, [needsLanding, user, mode]);

  // The customer display is view-only and needs no login.
  if (path === '/display') return <CustomerDisplay />;
  // Customers' pages (restaurant page, QR menu, their order), the TechPlug console and first-time setup need no PIN.
  if (path.startsWith('/r/')) return <RestaurantPage slug={decodeURIComponent(path.slice(3))} table={query.get('t') ?? undefined} />;
  if (path.startsWith('/o/')) return <OrderStatusPage token={path.slice(3)} />;
  if (path === '/console') return <Console />;
  if (path === '/setup') return <><Setup connect={query.get('connect') === '1'} /><ToastHost /></>;

  let body: ReactElement;
  if (!user) body = <Login />;
  else {
    const r = ROUTES[path];
    if (!r || !perm) body = <div className="app solo" />;
    else if (!can(user.role, perm))
      body = (
        <div className="app">
          <TopBar />
          <div className="page">
            <div className="empty">You don't have access to this screen.</div>
          </div>
        </div>
      );
    else {
      const El = r.el;
      body = <El />;
    }
  }

  return (
    <>
      {body}
      <UpdateBar />
      <LinkNotice />
      <OnlineOrderAlert />
      {user && <TrialBar />}
      <ToastHost />
    </>
  );
}
