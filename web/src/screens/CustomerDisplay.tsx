import { go, useRoute } from '../router';
import { useStore } from '../store/store';
import { fmt, fromBase } from '../domain/money';

/** View-only screen for the customer-facing monitor. Open with #/display?till=till-1 */
function BackLink() {
  // Shown only when the display was opened in the same window (no second screen).
  if (window.opener) return null;
  return (
    <button className="display-back" onClick={() => go('/')}>
      ← Back to till
    </button>
  );
}

export default function CustomerDisplay() {
  const { query } = useRoute();
  const tillId = query.get('till') ?? 'till-1';
  const cart = useStore((s) => s.liveCarts[tillId]);
  const settings = useStore((s) => s.settings);
  const currencies = useStore((s) => s.currencies);
  const orderTypes = useStore((s) => s.orderTypes);
  const base = currencies.find((c) => c.code === settings.baseCurrency)!;

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="cdisplay">
        <BackLink />
        <div className="idle">
          <div>
            {settings.logo && <img src={settings.logo} alt="" />}
            <h1>{settings.restaurantName}</h1>
            <p>{settings.tagline}</p>
          </div>
        </div>
      </div>
    );
  }

  const type = orderTypes.find((t) => t.id === cart.orderTypeId);
  const changeCur = currencies.find((c) => c.code === cart.changeCurrency) ?? base;
  const others = currencies.filter((c) => c.enabled && c.code !== base.code);

  return (
    <div className="cdisplay">
      <BackLink />
      <div className="left">
        <h1>Your order</h1>
        {type && <span className="typebadge">{type.name}</span>}
        <div className="clines">
          {cart.lines.map((l) => (
            <div key={l.id}>
              <span>
                {l.qty} × {l.name}
              </span>
              <span>{fmt(l.qty * l.unitPrice, base)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="right">
        <div>
          <div className="k">Total</div>
          <div className="v">{fmt(cart.total, base)}</div>
          <div className="k" style={{ marginTop: 6 }}>
            {others.map((c) => fmt(fromBase(cart.total, c), c)).join('  ·  ')}
          </div>
        </div>
        {cart.paid !== undefined && cart.paid > 0 && (
          <div>
            <div className="k">Paid</div>
            <div className="v" style={{ fontSize: 44 }}>
              {fmt(cart.paid, base)}
            </div>
          </div>
        )}
        {cart.change !== undefined && cart.change > 0 && (
          <div>
            <div className="k">Your change</div>
            <div className="v chg">{fmt(fromBase(cart.change, changeCur), changeCur)}</div>
          </div>
        )}
        {cart.kept !== undefined && cart.kept > 0 && (
          <div>
            <div className="k">Kept for {cart.customerName ?? 'you'}</div>
            <div className="v" style={{ fontSize: 44 }}>
              {fmt(cart.kept, base)}
            </div>
          </div>
        )}
        {cart.message && <div style={{ fontSize: 30, fontWeight: 800 }}>{cart.message}</div>}
      </div>
    </div>
  );
}
