/**
 * The printer linked to THIS device (phone, tablet or computer), so tickets print
 * straight away with no print screen.
 *
 * Chrome can talk to a receipt printer three ways:
 *  - Bluetooth (Web Bluetooth): most small Bluetooth thermal printers.
 *  - USB cable (WebUSB): a printer plugged into the tablet/phone (OTG) or computer.
 *  - Serial (Web Serial): computers, incl. "classic" Bluetooth printers paired in Windows.
 * Which ones show depends on the device and browser.
 *
 * The link is saved on this device only (each till has its own printer).
 * With no printer linked, printing falls back to the browser's print screen.
 */
import { ticketsToEscPos, type PaperWidth } from './escpos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kind = 'bluetooth' | 'usb' | 'serial';

export type PrinterLink = {
  kind: Kind;
  name: string;
  width: PaperWidth;
  cut: boolean;
  /** Bluetooth device id, or USB/serial ids, to find it again after the app reopens. */
  btId?: string;
  vendorId?: number;
  productId?: number;
  serial?: string;
};

export type PrinterStatus = 'none' | 'connecting' | 'ready' | 'offline' | 'needs-tap';

const KEY = 'restaurant-pos.printer';
const nav = navigator as any;

/** Bluetooth services used by common receipt printers (Chrome needs them listed up front). */
const BT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];
const SPP = '00001101-0000-1000-8000-00805f9b34fb';

export const canUse = {
  bluetooth: () => !!nav.bluetooth,
  usb: () => !!nav.usb,
  serial: () => !!nav.serial,
};

/* ------------------------------------------------------------------ saved link + live status */

let link: PrinterLink | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
})();
let status: PrinterStatus = link ? 'offline' : 'none';
let lastError = '';
const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
export const printerVersion = () => version;

function save(l: PrinterLink | null) {
  link = l;
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l));
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: works until the app closes */
  }
  emit();
}
function setStatus(s: PrinterStatus, err = '') {
  status = s;
  lastError = err;
  emit();
}

export function getPrinter() {
  return { link, status, error: lastError };
}
export function subscribePrinter(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}
export function updatePrinter(p: Partial<Pick<PrinterLink, 'width' | 'cut' | 'name'>>) {
  if (link) save({ ...link, ...p });
}

/* ------------------------------------------------------------------ connections */

type Conn = { write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> };
let conn: Conn | null = null;
let btDevice: any = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openBluetooth(device: any): Promise<Conn> {
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  let ch: any = null;
  for (const sv of services) {
    let chars: any[] = [];
    try {
      chars = await sv.getCharacteristics();
    } catch {
      continue;
    }
    ch = chars.find((c) => c.properties.write) ?? chars.find((c) => c.properties.writeWithoutResponse);
    if (ch) break;
  }
  if (!ch) {
    device.gatt.disconnect();
    throw new Error('This Bluetooth device has no way to receive print data. Is it a receipt printer?');
  }
  const withResponse = !!ch.properties.write;
  let chunk = 180;
  const send = async (part: Uint8Array) => {
    if (withResponse) await (ch.writeValueWithResponse ? ch.writeValueWithResponse(part) : ch.writeValue(part));
    else {
      await ch.writeValueWithoutResponse(part);
      await sleep(8); // small printers lose data when it comes too fast
    }
  };
  device.addEventListener?.('gattserverdisconnected', () => {
    if (conn && btDevice === device) {
      conn = null;
      if (link) setStatus('offline');
    }
  });
  return {
    async write(data) {
      if (!device.gatt.connected) await device.gatt.connect();
      for (let i = 0; i < data.length; ) {
        const part = data.slice(i, i + chunk);
        try {
          await send(part);
          i += part.length;
        } catch (e) {
          if (chunk > 20) chunk = 20; // printer only takes small pieces: retry smaller
          else throw e;
        }
      }
    },
    async close() {
      device.gatt.disconnect();
    },
  };
}

async function openUsb(dev: any): Promise<Conn> {
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  let ifaceNo = -1;
  let ep = -1;
  for (const iface of dev.configuration.interfaces)
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e: any) => e.direction === 'out' && e.type === 'bulk');
      if (out && ifaceNo < 0) {
        ifaceNo = iface.interfaceNumber;
        ep = out.endpointNumber;
      }
    }
  if (ifaceNo < 0) throw new Error('This USB device cannot receive print data. Is it the printer?');
  await dev.claimInterface(ifaceNo);
  return {
    async write(data) {
      for (let i = 0; i < data.length; i += 4096) await dev.transferOut(ep, data.slice(i, i + 4096));
    },
    async close() {
      try {
        await dev.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function openSerial(port: any): Promise<Conn> {
  if (!port.writable) await port.open({ baudRate: 9600 });
  return {
    async write(data) {
      const w = port.writable.getWriter();
      try {
        await w.write(data);
      } finally {
        w.releaseLock();
      }
    },
    async close() {
      try {
        await port.close();
      } catch {
        /* already closed */
      }
    },
  };
}

const friendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/cancel|chooser|No device selected|No port selected/i.test(m)) return '';
  if (/Access denied|Unable to claim|SecurityError/i.test(m))
    return 'The device would not let this app use the printer. On a computer, another program (the printer driver) may be holding it.';
  if (/GATT|Bluetooth|connect/i.test(m)) return 'Could not reach the printer. Is it switched on and close by? Is another phone connected to it?';
  return m;
};

/** Asks the browser to pick a printer (must be called from a button tap). */
export async function linkPrinter(kind: Kind, width: PaperWidth): Promise<{ ok: boolean; error?: string }> {
  try {
    setStatus('connecting');
    if (conn) await conn.close().catch(() => {});
    conn = null;
    let l: PrinterLink;
    if (kind === 'bluetooth') {
      const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
      btDevice = device;
      conn = await openBluetooth(device);
      l = { kind, name: device.name || 'Bluetooth printer', btId: device.id, width, cut: true };
    } else if (kind === 'usb') {
      const dev = await nav.usb.requestDevice({ filters: [] });
      conn = await openUsb(dev);
      l = { kind, name: dev.productName || 'USB printer', vendorId: dev.vendorId, productId: dev.productId, serial: dev.serialNumber, width, cut: true };
    } else {
      const port = await nav.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
      conn = await openSerial(port);
      const info = port.getInfo?.() ?? {};
      l = { kind, name: info.bluetoothServiceClassId ? 'Bluetooth printer (serial)' : 'Serial printer', vendorId: info.usbVendorId, productId: info.usbProductId, width, cut: true };
    }
    save(l);
    setStatus('ready');
    if (waiting.length) setTimeout(flushWaiting, 0);
    return { ok: true };
  } catch (e) {
    const msg = friendly(e);
    setStatus(link ? 'offline' : 'none', msg);
    return { ok: false, error: msg || undefined };
  }
}

export async function unlinkPrinter() {
  if (conn) await conn.close().catch(() => {});
  conn = null;
  btDevice = null;
  save(null);
  setStatus('none');
}

/** Finds the saved printer again without asking (after the app reopens). */
async function reconnect(): Promise<boolean> {
  if (!link) return false;
  if (conn) return true;
  setStatus('connecting');
  try {
    if (link.kind === 'bluetooth') {
      let device = btDevice;
      if (!device && nav.bluetooth?.getDevices) {
        const list = await nav.bluetooth.getDevices();
        device = list.find((d: any) => d.id === link!.btId) ?? null;
      }
      if (!device) {
        // Chrome on this device does not remember Bluetooth printers between visits: one tap reconnects.
        setStatus('needs-tap');
        return false;
      }
      btDevice = device;
      conn = await openBluetooth(device);
    } else if (link.kind === 'usb') {
      const list = await nav.usb.getDevices();
      const dev =
        list.find((d: any) => d.vendorId === link!.vendorId && d.productId === link!.productId && (!link!.serial || d.serialNumber === link!.serial)) ??
        list.find((d: any) => d.vendorId === link!.vendorId && d.productId === link!.productId);
      if (!dev) throw new Error('USB printer not plugged in');
      conn = await openUsb(dev);
    } else {
      const ports = await nav.serial.getPorts();
      const port =
        ports.find((p: any) => {
          const i = p.getInfo?.() ?? {};
          return link!.vendorId ? i.usbVendorId === link!.vendorId && i.usbProductId === link!.productId : !!i.bluetoothServiceClassId;
        }) ?? (ports.length === 1 ? ports[0] : null);
      if (!port) throw new Error('Printer not found');
      conn = await openSerial(port);
    }
    setStatus('ready');
    if (waiting.length) setTimeout(flushWaiting, 0);
    return true;
  } catch (e) {
    conn = null;
    setStatus('offline', friendly(e));
    return false;
  }
}

/** Reconnect from a button tap (Bluetooth may need to ask once again after the app reopens). */
export async function reconnectPrinter(): Promise<{ ok: boolean; error?: string }> {
  if (!link) return { ok: false };
  const prev = link;
  let r: { ok: boolean; error?: string } = { ok: await reconnect() };
  if (!r.ok && prev.kind === 'bluetooth') {
    r = await linkPrinter('bluetooth', prev.width);
    if (r.ok && link) save({ ...link, cut: prev.cut });
  } else if (!r.ok) r.error = lastError;
  if (r.ok) flushWaiting();
  return r;
}

/* ------------------------------------------------------------------ tickets waiting for the printer */

/** Tickets that could not print yet (printer off or not reconnected). Never silently lost. */
let waiting: string[][] = [];
export const getWaiting = () => waiting;
export function addWaiting(parts: string[]) {
  waiting = [...waiting, parts];
  emit();
}
export function takeWaiting(): string[][] {
  const w = waiting;
  waiting = [];
  emit();
  return w;
}
async function flushWaiting() {
  const jobs = takeWaiting();
  for (const parts of jobs) if (!(await printDirect(parts))) addWaiting(parts);
}

/** Try to get the saved printer back as soon as the app opens. */
export function startPrinter() {
  if (link) reconnect();
  nav.usb?.addEventListener?.('connect', () => {
    if (link?.kind === 'usb' && !conn) reconnect();
  });
  nav.usb?.addEventListener?.('disconnect', () => {
    if (link?.kind === 'usb') {
      conn = null;
      setStatus('offline', 'USB printer unplugged');
    }
  });
}

/** Printing goes one job at a time, so two quick sales do not mix on the paper. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Sends tickets to the linked printer. Resolves false if there is no linked printer
 * or it cannot be reached (the caller then decides what to do).
 */
export function printDirect(htmlParts: string[]): Promise<boolean> {
  const job = queue.then(async () => {
    if (!link) return false;
    const data = await ticketsToEscPos(htmlParts, link.width, link.cut);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!conn && !(await reconnect())) return false;
      try {
        await conn!.write(data);
        if (status !== 'ready') setStatus('ready');
        return true;
      } catch (e) {
        conn = null;
        setStatus('offline', friendly(e));
      }
    }
    return false;
  });
  queue = job.catch(() => false);
  return job;
}

export const hasLinkedPrinter = () => !!link;
