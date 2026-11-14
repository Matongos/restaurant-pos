import { useState } from 'react';
import { LuClock, LuX } from 'react-icons/lu';
import { LuPause } from 'react-icons/lu';
import { GRACE_DAYS, trialDaysLeft, useOnline } from '../cloud/online';
import { useSyncStatus } from '../cloud/sync';
import { useCurrentUser, useSalesLock } from '../store/store';
import { SUPPORT_WHATSAPP } from '../cloudConfig';
import { TopBar } from './ui';

/** WhatsApp link to TechPlug about this restaurant's plan (when TechPlug's number is set). */
export function contactLink(name: string, slug: string) {
  return SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`TechPlug POS subscription — ${name} (${slug})`)}` : null;
}

/** Selling is paused (trial over or account closed): what the Sell, Tables and Online orders screens show instead. */
export function PausedScreen() {
  const reason = useSalesLock();
  const user = useCurrentUser();
  const { info } = useOnline();
  const link = info ? contactLink(info.name, info.slug) : null;
  const boss = user?.role === 'super_admin' || user?.role === 'manager';
  return (
    <div className="app">
      <TopBar title="Paused" />
      <div className="page">
        <div className="page-narrow">
          <div className="card paused-card" role="alert">
            <LuPause aria-hidden="true" />
            <h2>New sales are paused</h2>
            <p>{reason}</p>
            {boss ? (
              <p className="muted">As soon as TechPlug switches your plan on, this till carries on by itself — no need to restart. Reports, Books, Stock and Staff still open as normal.</p>
            ) : (
              <p className="muted">Please call the owner or manager.</p>
            )}
            {boss && link && (
              <a className="btn primary" href={link} target="_blank" rel="noreferrer">
                Contact TechPlug on WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reminds the owner when the free trial is nearly over; says when selling is paused. */
export function TrialBar() {
  const user = useCurrentUser();
  const sync = useSyncStatus();
  const { info } = useOnline();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('restaurant-pos.trial-hidden') === '1';
    } catch {
      return false;
    }
  });
  const paused = useSalesLock();
  if (!sync.link || !info || !user) return null;
  if (paused) return null; // the selling screens explain it
  if (hidden || (user.role !== 'super_admin' && user.role !== 'manager')) return null;
  const left = trialDaysLeft(info);
  const closed = info.plan === 'closed';
  if (!closed && (left === null || left > 7)) return null;
  const pauseOn = new Date(Date.parse(info.trial_ends_at) + GRACE_DAYS * 86_400_000).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const text = closed
    ? 'This restaurant’s online account is closed. Contact TechPlug to reopen it.'
    : left! > 1
      ? `Your free trial ends in ${left} days. Contact TechPlug to choose a plan and keep selling.`
      : left === 1
        ? 'Your free trial ends tomorrow. Contact TechPlug to choose a plan and keep selling.'
        : `Your free trial has ended. New sales pause on ${pauseOn} unless a plan is chosen — contact TechPlug.`;
  return (
    <div className={`trial-bar ${closed || (left ?? 1) <= 0 ? 'over' : ''}`} role="status">
      <LuClock aria-hidden="true" />
      <span>{text}</span>
      {contactLink(info.name, info.slug) && (
        <a className="btn small" href={contactLink(info.name, info.slug)!} target="_blank" rel="noreferrer">
          Contact
        </a>
      )}
      <button
        className="btn ghost icon-only"
        aria-label="Hide for now"
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem('restaurant-pos.trial-hidden', '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <LuX aria-hidden="true" />
      </button>
    </div>
  );
}
