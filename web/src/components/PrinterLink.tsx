import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { LuBluetooth, LuPrinter, LuUsb, LuCable, LuCircleCheck, LuCircleAlert } from 'react-icons/lu';
import {
  canUse,
  getPrinter,
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
import { testPageHTML, type PaperWidth } from '../print/escpos';
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
                {link.kind === 'bluetooth' ? ' · Bluetooth' : link.kind === 'usb' ? ' · USB' : ' · Serial'}
              </div>
              {error && status !== 'ready' && <div className="pc-err">{error}</div>}
            </div>
          </div>
          <div className="pc-row">
            <span>Paper</span>
            <div className="seg small">
              {([58, 80] as PaperWidth[]).map((w) => (
                <button key={w} className={link.width === w ? 'on' : ''} onClick={() => updatePrinter({ width: w })}>
                  {w} mm
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
