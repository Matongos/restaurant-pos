import type { Currency } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function toBase(amount: number, currency: Currency): number {
  return round2(amount / currency.rate);
}

export function fromBase(baseAmount: number, currency: Currency): number {
  return round2(baseAmount * currency.rate);
}

export function fmt(amount: number, currency?: Pick<Currency, 'symbol' | 'code'>): string {
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!currency) return n;
  return currency.symbol.length <= 1 ? `${currency.symbol}${n}` : `${currency.symbol} ${n}`;
}
