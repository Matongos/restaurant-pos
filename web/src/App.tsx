import { useEffect, type ComponentType, type ReactElement } from 'react';
import { useRoute } from './router';
import { useCurrentUser, useStore } from './store/store';
import { can, type Permission } from './domain/rules';
import { ToastHost, TopBar } from './components/ui';
import Login from './screens/Login';
import Home from './screens/Home';
import Till from './screens/Till';
import CustomerDisplay from './screens/CustomerDisplay';
import TodaysMenu from './screens/TodaysMenu';
import ActiveOrders from './screens/ActiveOrders';
import Kitchen from './screens/Kitchen';
import ChangeOwedScreen from './screens/ChangeOwed';
import SettingsScreen from './screens/Settings';
import Reports from './screens/Reports';

const ROUTES: Record<string, { perm: Permission; el: ComponentType }> = {
  '/till': { perm: 'take_orders', el: Till },
  '/todays-menu': { perm: 'todays_menu', el: TodaysMenu },
  '/orders': { perm: 'active_orders', el: ActiveOrders },
  '/kitchen': { perm: 'kitchen', el: Kitchen },
  '/change-owed': { perm: 'change_owed', el: ChangeOwedScreen },
  '/settings': { perm: 'settings', el: SettingsScreen },
  '/reports': { perm: 'reports', el: Reports },
};

export default function App() {
  const { path } = useRoute();
  const user = useCurrentUser();
  const brand = useStore((s) => s.settings.brandColor);

  useEffect(() => {
    document.documentElement.style.setProperty('--brand', brand);
  }, [brand]);

  // The customer display is view-only and needs no login.
  if (path === '/display') return <CustomerDisplay />;

  let body: ReactElement;
  if (!user) body = <Login />;
  else if (path === '/' || path === '') body = <Home />;
  else {
    const r = ROUTES[path];
    if (!r) body = <Home />;
    else if (!can(user.role, r.perm))
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
      <ToastHost />
    </>
  );
}
