import type { AppState, CreditEntry, Customer, Order } from '../domain/types';
import { CREDIT_METHOD } from '../domain/types';
import { fmt } from '../domain/money';

/**
 * Ticket layouts for 80 mm thermal printers.
 *
 * Prototype: rendered as HTML and printed through the browser's print dialog.
 * Desktop app: the same content is sent as ESC/POS commands straight to the
 * printer (no dialog) — see docs/ARCHITECTURE.md.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const date = (iso: string) => new Date(iso).toLocaleDateString();

export function kitchenTicketHTML(order: Order, s: AppState): string {
  const type = s.orderTypes.find((t) => t.id === order.orderTypeId);
  const cashier = s.staff.find((u) => u.id === order.cashierId);
  const isAddOn = !!order.parentOrderId;
  const lines = order.lines
    .map(
      (l) =>
        `<div class="line"><b>${l.qty} ×</b> ${esc(l.name)}</div>` +
          (l.without ?? []).map((w) => `<div class="without">» NO ${esc(w.toUpperCase())}</div>`).join('') +
          (l.note ? `<div class="note">» ${esc(l.note)}</div>` : ''),
    )
    .join('');
  return `
    <div class="ticket">
      ${order.training ? '<div class="training">TRAINING — NOT A REAL ORDER</div>' : ''}
      ${isAddOn ? '<div class="addon">ADD-ON TO ORDER</div>' : ''}
      <div class="num">${order.number}</div>
      <div class="type">${esc(type?.ticketLabel ?? '')}</div>
      <div class="pack">${esc(type?.packaging ?? '')}</div>
      <hr/>
      ${lines}
      <hr/>
      <div class="meta">${time(order.createdAt)} · ${esc(cashier?.name ?? '')}</div>
    </div>`;
}

export function customerSlipHTML(order: Order, s: AppState): string {
  const base = s.currencies.find((c) => c.code === s.settings.baseCurrency)!;
  const type = s.orderTypes.find((t) => t.id === order.orderTypeId);
  const rows = order.lines
    .map((l) => `<tr><td>${l.qty} × ${esc(l.name)}</td><td class="r">${fmt(l.qty * l.unitPrice, base)}</td></tr>`)
    .join('');
  const pays = order.payments
    .map((p) => {
      const cur = s.currencies.find((c) => c.code === p.currency);
      const m = p.methodId === CREDIT_METHOD ? { name: 'Your change' } : s.paymentMethods.find((x) => x.id === p.methodId);
      return `<tr><td>${esc(m?.name ?? '')}</td><td class="r">${fmt(p.amount, cur)}</td></tr>`;
    })
    .join('');
  const changeCur = s.currencies.find((c) => c.code === order.changeCurrency) ?? base;
  return `
    <div class="ticket">
      ${s.settings.logo ? `<img class="logo" src="${s.settings.logo}"/>` : ''}
      <div class="name">${esc(s.settings.restaurantName)}</div>
      <div class="small">${esc(s.settings.address)} · ${esc(s.settings.phone)}</div>
      ${order.training ? '<div class="training">TRAINING</div>' : ''}
      <div class="label">YOUR NUMBER</div>
      <div class="num">${order.number}</div>
      <div class="type">${esc(type?.name ?? '')}</div>
      <hr/>
      <table>${rows}<tr class="tot"><td>Total</td><td class="r">${fmt(order.total, base)}</td></tr>${pays}
      <tr><td>Change</td><td class="r">${fmt(order.changeGiven * changeCur.rate, changeCur)}</td></tr></table>
      <hr/>
      <div class="small">${date(order.createdAt)} ${time(order.createdAt)}</div>
      <div class="small">${esc(s.settings.receiptFooter)}</div>
    </div>`;
}

/** Slip for the customer when change is kept for them: shows this change and their total balance. */
export function changeVoucherHTML(entry: CreditEntry, customer: Customer, balance: number, s: AppState): string {
  const base = s.currencies.find((x) => x.code === s.settings.baseCurrency)!;
  return `
    <div class="ticket">
      <div class="name">${esc(s.settings.restaurantName)}</div>
      <div class="label">CHANGE KEPT FOR YOU</div>
      <div class="num">${fmt(entry.amount, base)}</div>
      <div class="type">Code: ${entry.code ?? ''}</div>
      <hr/>
      <div>Name: <b>${esc(customer.name)}</b></div>
      ${customer.phone ? `<div>Phone: ${esc(customer.phone)}</div>` : ''}
      ${customer.note ? `<div>Note: ${esc(customer.note)}</div>` : ''}
      <div>Order #${entry.orderNumber ?? ''} · ${date(entry.at)} ${time(entry.at)}</div>
      <hr/>
      <div class="line"><b>Your total change: ${fmt(balance, base)}</b></div>
      <div class="small">Collect it any day, or use it to pay for food. Just give your name.</div>
    </div>`;
}

export const TICKET_CSS = `
  .ticket{width:72mm;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#000;padding:2mm 0;}
  .ticket hr{border:0;border-top:1px dashed #000;margin:6px 0}
  .num{font-size:56px;font-weight:800;text-align:center;line-height:1}
  .type{font-size:24px;font-weight:800;text-align:center;letter-spacing:1px;margin-top:4px}
  .pack{text-align:center;font-size:12px}
  .label{text-align:center;font-size:11px;letter-spacing:2px;margin-top:6px}
  .name{text-align:center;font-weight:800;font-size:16px}
  .small{text-align:center;font-size:11px}
  .line{font-size:16px;margin:3px 0}
  .note{font-size:13px;margin-left:16px}
  .without{font-size:15px;font-weight:900;margin-left:16px;letter-spacing:.02em}
  .meta{font-size:11px;text-align:center}
  .training,.addon{text-align:center;font-weight:800;border:2px solid #000;padding:2px;margin-bottom:4px}
  .logo{display:block;margin:0 auto 4px;max-width:40mm;max-height:20mm;filter:grayscale(1)}
  table{width:100%;border-collapse:collapse} td{padding:1px 0} .r{text-align:right} .tot td{font-weight:800;border-top:1px solid #000}
`;

/** Prints one or more tickets via a hidden iframe (prototype). */
export function printTickets(htmlParts: string[]) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><style>
    @page{size:80mm auto;margin:2mm}
    body{margin:0}
    .ticket{page-break-after:always}
    ${TICKET_CSS}
  </style></head><body>${htmlParts.join('')}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 100);
}
