/** Settings → Website & QR menu: the restaurant's page, QR menu, online orders, and posters to print. */
import { useEffect, useState } from 'react';
import { LuCopy, LuExternalLink, LuPrinter, LuGlobe } from 'react-icons/lu';
import { refreshInfo, saveRestaurantInfo, useOnline, type PublicInfo } from '../cloud/online';
import { useSyncStatus } from '../cloud/sync';
import { go } from '../router';
import { useStore } from '../store/store';
import QR, { publicUrl } from './QR';
import { toast } from './ui';

export default function WebsiteSettings() {
  const sync = useSyncStatus();
  const { info } = useOnline();
  const [error, setError] = useState('');
  const [form, setForm] = useState<PublicInfo>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sync.link) refreshInfo(true).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sync.link]);
  useEffect(() => {
    if (info) setForm(info.public_info ?? {});
  }, [info]);

  if (!sync.link)
    return (
      <div className="cloud-intro">
        <LuGlobe aria-hidden="true" />
        <div>
          <b>Your own web page, QR menu and online orders</b>
          <p className="muted">Connect this device to your online account first (Settings → Online account). Then switch on what you want here.</p>
        </div>
      </div>
    );
  if (!info) return <p className="muted">{error || 'Loading…'}</p>;

  const url = publicUrl(info.slug);
  const toggle = async (key: 'web_page' | 'qr_menu' | 'online_orders', value: boolean) => {
    setError('');
    try {
      await saveRestaurantInfo({ [key]: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveInfo = async (p: PublicInfo) => {
    setBusy(true);
    setError('');
    try {
      await saveRestaurantInfo({ public_info: p });
      toast('Saved — your page is updated');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const live = info.web_page || info.qr_menu;

  return (
    <>
      <div className="web-link">
        <QR text={url} size={120} />
        <div className="grow">
          <b>Your page</b>
          <div className="web-url">{url}</div>
          <div className="row wrap">
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
              }}
            >
              <LuCopy aria-hidden="true" /> Copy link
            </button>
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              <LuExternalLink aria-hidden="true" /> Open
            </a>
            <button className="btn" onClick={() => go('/posters')} disabled={!live}>
              <LuPrinter aria-hidden="true" /> Print QR posters
            </button>
          </div>
          <p className="hint">
            When techplugpos.com is set up this becomes <b>{info.slug}.techplugpos.com</b>. {live ? '' : 'Switch on the web page or QR menu to make it live.'}
          </p>
        </div>
      </div>

      <Switch label="Restaurant web page" sub="Your details (address, hours, phone, WhatsApp) and today's menu for anyone with the link." on={info.web_page} set={(v) => toggle('web_page', v)} />
      <Switch label="QR menu" sub="Customers scan a poster and see today's menu with what is sold out. Live only while a till is online." on={info.qr_menu} set={(v) => toggle('qr_menu', v)} />
      <Switch
        label="Online orders (pick-up)"
        sub="Customers order from your page and pay at the counter when they collect. New orders ring on the till under Online orders."
        on={info.online_orders}
        set={(v) => toggle('online_orders', v)}
      />
      {info.online_orders && (
        <Switch
          label="Customers can order from their table"
          sub="Table posters let customers send their order straight to the till. The food goes to their table; they pay before leaving."
          on={!!info.public_info?.tableOrders}
          set={(v) => saveInfo({ ...form, tableOrders: v })}
        />
      )}

      <h3 className="cloud-h">Details on your page</h3>
      <div className="form-grid">
        <label className="field">
          Phone
          <input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 0772 123 456" />
        </label>
        <label className="field">
          WhatsApp number
          <input value={form.whatsapp ?? ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="e.g. 0772 123 456" />
        </label>
        <label className="field">
          Address
          <input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. 12 Main Street" />
        </label>
        <label className="field">
          Opening hours
          <input value={form.hours ?? ''} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="e.g. Mon–Sat 7:00–20:00" />
        </label>
      </div>
      <label className="field">
        About your restaurant (optional)
        <input value={form.about ?? ''} onChange={(e) => setForm({ ...form, about: e.target.value })} maxLength={240} placeholder="e.g. Home-cooked sadza and stews since 2012" />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" style={{ marginTop: 12 }} onClick={() => saveInfo(form)} disabled={busy}>
        {busy ? 'Saving…' : 'Save details'}
      </button>
    </>
  );
}

function Switch({ label, sub, on, set }: { label: string; sub: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <span>
        {label}
        <span className="sub">{sub}</span>
      </span>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)}>
        <span />
      </button>
    </div>
  );
}

/** Printable posters: one for the counter / door, and one per table. */
export function PostersScreen() {
  const { info } = useOnline();
  const tables = useStore((s) => s.settings.tables ?? []);
  const name = useStore((s) => s.settings.restaurantName);
  const mode = useStore((s) => s.settings.serviceMode ?? 'counter');
  const [which, setWhich] = useState<'all' | 'counter' | 'tables'>('all');
  if (!info) return <div className="page"><p className="muted">Open Settings → Website &amp; QR menu first.</p></div>;
  const order = info.online_orders;
  const posters = [
    ...(which !== 'tables' ? [{ key: 'counter', table: undefined as string | undefined, title: order ? 'Scan to see the menu and order' : "Scan for today's menu" }] : []),
    ...(which !== 'counter' && mode !== 'counter'
      ? tables.map((t) => ({ key: t.id, table: t.name, title: order && info.public_info?.tableOrders ? 'Scan to order from your table' : "Scan for today's menu" }))
      : []),
  ];
  return (
    <div className="posters-page">
      <div className="posters-bar no-print">
        <button className="btn" onClick={() => go('/settings')}>
          ← Back
        </button>
        <div className="seg small">
          {(['all', 'counter', 'tables'] as const).map((w) => (
            <button key={w} className={which === w ? 'on' : ''} onClick={() => setWhich(w)} disabled={w === 'tables' && mode === 'counter'}>
              {w === 'all' ? 'All' : w === 'counter' ? 'Counter poster' : 'Table posters'}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => window.print()}>
          <LuPrinter aria-hidden="true" /> Print {posters.length}
        </button>
      </div>
      <div className="posters">
        {posters.map((p) => (
          <div key={p.key} className="poster">
            <div className="poster-name">{name}</div>
            <div className="poster-title">{p.title}</div>
            <QR text={publicUrl(info.slug, p.table)} size={300} />
            {p.table && <div className="poster-table">Table {p.table}</div>}
            <div className="poster-url">{publicUrl(info.slug, p.table).replace(/^https?:\/\//, '')}</div>
            <div className="poster-foot">Open your phone camera and point it at the code</div>
          </div>
        ))}
      </div>
    </div>
  );
}
