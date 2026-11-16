/**
 * Download reports as spreadsheet files (.csv) that open in Excel, Google Sheets or WPS.
 */
import type { AppState, Order } from '../domain/types';
import { CREDIT_METHOD } from '../domain/types';
import { lineLabel } from '../domain/rules';

type Cell = string | number | undefined | null;

function csv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === undefined || v === null) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Saves the rows as a .csv file (with a marker so Excel reads the letters correctly). */
export function downloadCsv(name: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob(['﻿' + csv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
export const fileDate = (from: string, to: string) => (from === to ? from : `${from}_to_${to}`);

/** Every meal sold in the period: one row per line on each order. */
export function salesRows(orders: Order[], st: AppState): Cell[][] {
  const typeName = (id: string) => st.orderTypes.find((t) => t.id === id)?.name ?? id;
  const staffName = (id?: string) => st.staff.find((u) => u.id === id)?.name ?? '';
  const methodName = (id: string) => (id === CREDIT_METHOD ? 'Customer change' : st.paymentMethods.find((m) => m.id === id)?.name ?? id);
  const rows: Cell[][] = [['Date', 'Time', 'Order', 'Type', 'Item', 'Qty', 'Price', 'Amount', 'Order total', 'Paid with', 'Cashier', 'Status']];
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const o of sorted) {
    const paid = o.payments.map((p) => `${methodName(p.methodId)} ${p.currency} ${Math.round(p.amount * 100) / 100}`).join(' + ');
    const status = o.status === 'cancelled' ? 'Cancelled' : o.training ? 'Training' : 'Sold';
    o.lines.forEach((l, i) =>
      rows.push([day(o.createdAt), clock(o.createdAt), o.number, o.table ? `Table ${o.table.name}` : typeName(o.orderTypeId), lineLabel(l), l.qty, l.unitPrice, l.qty * l.unitPrice, i === 0 ? o.total : '', i === 0 ? paid : '', staffName(o.cashierId), status]),
    );
    if (o.delivery?.fee) rows.push([day(o.createdAt), clock(o.createdAt), o.number, typeName(o.orderTypeId), 'Delivery fee', 1, o.delivery.fee, o.delivery.fee, '', '', staffName(o.cashierId), status]);
  }
  return rows;
}

/** Purchases and expenses in the period (money out). */
export function moneyOutRows(st: AppState, from: string, to: string): Cell[][] {
  const staffName = (id?: string) => st.staff.find((u) => u.id === id)?.name ?? '';
  const paid = (p: string) => ({ cash_drawer: 'Cash drawer', bank: 'Bank', mobile_money: 'Mobile money', owner: "Owner's pocket" } as Record<string, string>)[p] ?? p;
  const rows: Cell[][] = [['Date', 'Kind', 'Supplier / category', 'What', 'Qty', 'Unit', 'Unit cost', 'Currency', 'Amount', 'Amount (base)', 'Paid from', 'Recorded by', 'Note']];
  const inP = (d: string) => d >= from && d <= to;
  for (const x of st.purchases.filter((x) => !x.example && inP(x.date)))
    x.lines.forEach((l, i) =>
      rows.push([x.date, x.reversesId ? 'Purchase (cancelled)' : 'Purchase', x.supplier, l.name, l.qty, l.unit, l.unitCost, x.currency, l.qty * l.unitCost, i === 0 ? x.baseTotal : '', paid(x.paidFrom), staffName(x.by), i === 0 ? x.reason ?? x.note ?? '' : '']),
    );
  for (const x of st.expenses.filter((x) => !x.example && inP(x.date)))
    rows.push([x.date, x.reversesId ? 'Expense (cancelled)' : 'Expense', x.category, x.description, '', '', '', x.currency, x.amount, x.baseAmount, paid(x.paidFrom), staffName(x.by), x.reason ?? '']);
  return [rows[0], ...rows.slice(1).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
}
