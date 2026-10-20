import { useMemo } from 'react';
import { go } from '../router';
import { updateSettings, useCurrentUser, useStore } from '../store/store';
import { can, changeOwedBalance } from '../domain/rules';
import { TopBar, toast } from '../components/ui';

interface Tile {
  key: string;
  icon: string;
  title: string;
  desc: string;
  to?: string;
  onClick?: () => void;
  hero?: boolean;
  badge?: number;
  show: boolean;
}

export default function Home() {
  const user = useCurrentUser()!;
  const settings = useStore((s) => s.settings);
  const orders = useStore((s) => s.orders);
  const changeOwed = useStore((s) => s.changeOwed);
  const components = useStore((s) => s.components);

  const openOrders = useMemo(() => orders.filter((o) => !o.parentOrderId && (o.status === 'in_kitchen' || o.status === 'ready')).length, [orders]);
  const openOwed = useMemo(() => changeOwed.filter((c) => changeOwedBalance(c) > 0).length, [changeOwed]);
  const soldOut = useMemo(() => components.filter((c) => !c.available).length, [components]);

  const openDisplay = () => {
    const w = window.open('#/display?till=till-1', 'customer-display', 'popup,width=1024,height=640');
    if (w) toast('Customer display opened — drag it to the second screen and press F11.');
    else go('/display?till=till-1');
  };

  const tiles: Tile[] = [
    { key: 'till', icon: '🧾', title: 'New Order', desc: 'Take payment and send to the kitchen', to: '/till', hero: true, show: can(user.role, 'take_orders') },
    { key: 'orders', icon: '🔢', title: 'Active Orders', desc: 'Numbers waiting, mark served, add a drink', to: '/orders', badge: openOrders, show: can(user.role, 'active_orders') },
    { key: 'kitchen', icon: '👩‍🍳', title: 'Kitchen Display', desc: 'Tick orders done, timers, recall', to: '/kitchen', show: can(user.role, 'kitchen') },
    { key: 'owed', icon: '💵', title: 'Change Owed', desc: 'Customers waiting for their change', to: '/change-owed', badge: openOwed, show: can(user.role, 'change_owed') },
    { key: 'menu', icon: '🍽️', title: "Today's Menu", desc: soldOut ? `${soldOut} ingredient(s) sold out` : 'Switch meals sold out / available', to: '/todays-menu', show: can(user.role, 'todays_menu') },
    { key: 'display', icon: '🖥️', title: 'Customer Display', desc: 'Open on the second screen', onClick: openDisplay, show: can(user.role, 'screens') || can(user.role, 'take_orders') },
    { key: 'reports', icon: '📊', title: 'Reports', desc: 'Today’s sales, payments, cashiers', to: '/reports', show: can(user.role, 'reports') },
    { key: 'settings', icon: '⚙️', title: 'Settings', desc: 'Logo, menu, currencies, numbers', to: '/settings', show: can(user.role, 'settings') },
  ];

  return (
    <div className="app">
      <TopBar />
      <div className="page">
        <div className="home-head">
          <h1>{settings.restaurantName}</h1>
          <div className="muted">Good to see you, {user.name.split(' ')[0]}.</div>
        </div>
        <div className="tiles">
          {tiles
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.key} className={`tile ${t.hero ? 'hero' : ''}`} onClick={() => (t.onClick ? t.onClick() : go(t.to!))}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="icon">{t.icon}</span>
                  {!!t.badge && <span className="badge">{t.badge}</span>}
                </div>
                <span className="t">{t.title}</span>
                <span className="d">{t.desc}</span>
              </button>
            ))}
        </div>
        {can(user.role, 'reports') && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <label className="row" style={{ justifyContent: 'center', fontWeight: 700, color: '#b45309' }}>
              <input
                type="checkbox"
                checked={settings.trainingMode}
                onChange={(e) => updateSettings({ trainingMode: e.target.checked })}
                style={{ width: 20, height: 20 }}
              />
              Training Mode (practice orders are kept out of reports)
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
