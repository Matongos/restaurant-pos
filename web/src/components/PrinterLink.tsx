import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LuBluetooth, LuPrinter, LuUsb, LuCable, LuCircleCheck, LuCircleAlert } from 'react-icons/lu';
import {
  canUse,
  getPrinter,
  inDesktopApp,
  linkDesktopPrinter,
  listWindowsPrinters,
  getWaiting,
  linkPrinter,
  printDirect,
  printerVersion,
  reconnectPrinter,
  subscribePrinter,
  takeWaiting,
  unlinkPrinter,
  updatePrinter,
} from '../print/printer';
import { defaultCols, testPageHTML, type PaperWidth } from '../print/escpos';
import { printWithBrowser } from '../print/tickets';
import { getState } from '../store/store';
import { toast } from './ui';

export function usePrinter() {
  useSyncExternalStore(subscribePrinter, printerVersion);
  return { ...getPrinter(), waiting: getWaiting() };
}

const STATUS_TEXT = {
  none: 'No printer linked',
  connecting: 'Connecting…',
  ready: 'Connected',
  offline: 'Not connected',
  'needs-tap': 'Tap Reconnect once to wake the link',
} as const;

/** Settings → Numbers & printing: link this device to its receipt printer. */
export function PrinterSettings() {
  const { link, status, error } = usePrinter();
  const [width, setWidth] = useState<PaperWidth>(link?.width ?? 80);
  const [busy, setBusy] = useState(false);
  const ways = [
    canUse.bluetooth() && { kind: 'bluetooth' as const, label: 'Bluetooth printer', icon: <LuBluetooth aria-hidden="true" /> },
    canUse.usb() && { kind: 'usb' as const, label: 'USB cable', icon: <LuUsb aria-hidden="true" /> },
    canUse.serial() && { kind: 'serial' as const, label: 'Paired / serial port', icon: <LuCable aria-hidden="true" /> },
  ].filter(Boolean) as { kind: 'bluetooth' | 'usb' | 'serial'; label: string; icon: ReactNode }[];

  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (r.ok) toast(okMsg);
    else if (r.error) toast(r.error);
  };
  const test = async () => {
    setBusy(true);
    const ok = await printDirect([testPageHTML(getState().settings.restaurantName, link!.width)]);
    setBusy(false);
    toast(ok ? 'Test page sent' : 'Could not reach the printer. Tap Reconnect.');
  };

  return (
    <>
      <div className="section-title">This device's printer</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Link a receipt printer to this phone, tablet or computer and tickets print the moment a payment is confirmed, with no print screen. Each device keeps its own printer.
      </p>

      {link ? (
        <div className={`printer-card ${status}`}>
          <div className="pc-head">
            <span className="pc-icon" aria-hidden="true">
              <LuPrinter />
            </span>
            <div className="grow">
              <b>{link.name}</b>
              <div className="pc-status">
                {status === 'ready' ? <LuCircleCheck aria-hidden="true" /> : <LuCircleAlert aria-hidden="true" />}
                {STATUS_TEXT[status]}
                {({ bluetooth: ' · Bluetooth', usb: ' · USB', serial: ' · Serial', windows: ' · Windows printer', network: ' · Network' } as const)[link.kind]}
              </div>
              {error && status !== 'ready' && <div className="pc-err">{error}</div>}
            </div>
          </div>
          {link.kind === 'windows' && (
            <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
              If the test page comes out as strange symbols or blank, this is not a receipt printer: unlink and pick the receipt printer.
            </p>
          )}
          <div className="pc-row">
            <span>Paper</span>
            <div className="seg small">
              {([58, 80] as PaperWidth[]).map((w) => (
                <button key={w} className={link.width === w ? 'on' : ''} onClick={() => updatePrinter({ width: w, cols: undefined })}>
                  {w} mm
                </button>
              ))}
            </div>
          </div>
          <div className="pc-row">
            <span>
              Letters per line
              <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>If dashed lines or prices break onto a second row, choose a smaller number.</div>
            </span>
            <div className="seg small">
              {[32, 42, 48].map((c) => (
                <button key={c} className={(link.cols ?? defaultCols(link.width)) === c ? 'on' : ''} onClick={() => updatePrinter({ cols: c })}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="pc-row">
            <span>Cut paper after each ticket</span>
            <button className={`switch ${link.cut ? 'on' : ''}`} onClick={() => updatePrinter({ cut: !link.cut })} aria-label="Cut paper" aria-pressed={link.cut}>
              <span />
            </button>
          </div>
          <div className="pc-actions">
            {status === 'ready' ? (
              <button className="btn primary" disabled={busy} onClick={test}>
                Print a test page
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => run(reconnectPrinter, 'Printer connected')}>
                Reconnect
              </button>
            )}
            <button className="btn danger" disabled={busy} onClick={() => unlinkPrinter().then(() => toast('Printer unlinked. Tickets use the print screen again.'))}>
              Unlink
            </button>
          </div>
        </div>
      ) : inDesktopApp() ? (
        <DesktopPrinterPicker width={width} setWidth={setWidth} />
      ) : ways.length ? (
        <>
          <div className="pc-row" style={{ marginBottom: 10 }}>
            <span>Paper width</span>
            <div className="seg small">
              {([58, 80] as PaperWidth[]).map((w) => (
                <button key={w} className={width === w ? 'on' : ''} onClick={() => setWidth(w)}>
                  {w} mm{w === 58 ? ' (small)' : ' (wide)'}
                </button>
              ))}
            </div>
          </div>
          <div className="printer-ways">
            {ways.map((w) => (
              <button key={w.kind} className="btn big" disabled={busy} onClick={() => run(() => linkPrinter(w.kind, width), 'Printer linked. Print a test page to check it.')}>
                {w.icon}
                {w.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Switch the printer on first. For Bluetooth, no need to pair it in the phone's settings: pick it from the list that opens. If it is not in the list, it may only support older Bluetooth; a USB cable works instead.
          </p>
        </>
      ) : (
        <div className="warn-box">This browser cannot talk to printers directly. Open the app in Google Chrome (Android, Windows or Mac) to link a printer. Until then, tickets use the print screen.</div>
      )}
    </>
  );
}

/** Windows app: pick a printer installed in Windows, or type a network printer's address. */
function DesktopPrinterPicker({ width, setWidth }: { width: PaperWidth; setWidth: (w: PaperWidth) => void }) {
  const [list, setList] = useState<string[] | null | undefined>(undefined);
  const [pick, setPick] = useState('');
  const [ip, setIp] = useState('');
  const load = () => listWindowsPrinters().then((l) => {
    setList(l);
    if (l?.length) setPick((p) => p || l.find((n) => /pos|receipt|thermal|xp-|80|58|epson tm|star/i.test(n)) || l[0]);
  });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg: string) => toast(msg);
  if (list === null)
    return (
      <div className="warn-box">
        This copy of the TechPlug POS Windows app is older and cannot print by itself yet. Download the newest TechPlug-POS-Setup.exe and install it over this one (your sales stay). Until then, tickets use the print screen.
      </div>
    );
  return (
    <>
      <div className="pc-row" style={{ marginBottom: 10 }}>
        <span>Paper width</span>
        <div className="seg small">
          {([58, 80] as PaperWidth[]).map((w) => (
            <button key={w} className={width === w ? 'on' : ''} onClick={() => setWidth(w)}>
              {w} mm{w === 58 ? ' (small)' : ' (wide)'}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Receipt printer installed on this computer
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }} disabled={!list?.length}>
            {list === undefined && <option>Looking for printers…</option>}
            {list?.length === 0 && <option value="">No printers installed</option>}
            {list?.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      </label>
      <button className="btn primary big" disabled={!pick} onClick={() => { linkDesktopPrinter('windows', pick, width); done('Printer linked. Print a test page to check it.'); }}>
        <LuPrinter aria-hidden="true" /> Use this printer
      </button>
      <p className="muted" style={{ fontSize: 13 }}>
        Pick the receipt printer (often called POS-80, POS-58, XP-80 or similar), not OneNote, PDF or an office printer. If it is not in the list, install the driver that came with the printer, switch it on and tap Refresh.
      </p>
      <label className="field" style={{ marginTop: 12 }}>
        Or a network (Wi-Fi / cable) receipt printer: its IP address
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={ip} onChange={(e) => setIp(e.target.value.replace(/[^\d.:a-zA-Z-]/g, ''))} placeholder="e.g. 192.168.1.100" inputMode="decimal" style={{ flex: 1 }} />
          <button className="btn" disabled={!ip.trim()} onClick={() => { linkDesktopPrinter('network', ip, width); done('Network printer linked. Print a test page to check it.'); }}>
            Use
          </button>
        </div>
      </label>
    </>
  );
}

/** Shown at the bottom of every screen while tickets are waiting for the printer. */
export function PrinterBar() {
  const { link, status, waiting } = usePrinter();
  const [busy, setBusy] = useState(false);
  if (!link || (!waiting.length && status !== 'needs-tap')) return null;
  const n = waiting.length;
  return (
    <div className="printer-bar" role="alert">
      <LuPrinter aria-hidden="true" />
      <div className="grow">
        <b>{n ? `${n} ticket${n === 1 ? '' : 's'} waiting for the printer` : 'Printer needs one tap to reconnect'}</b>
        <div>{status === 'connecting' ? 'Connecting…' : n ? 'Check it is on and close by, then tap Reconnect.' : 'Tap Reconnect and pick your printer. Then tickets print by themselves again.'}</div>
      </div>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await reconnectPrinter();
          setBusy(false);
          if (!r.ok && r.error) toast(r.error);
        }}
      >
        Reconnect
      </button>
      {n > 0 && (
        <button className="btn" onClick={() => printWithBrowser(takeWaiting().flat())}>
          Print screen
        </button>
      )}
    </div>
  );
}
