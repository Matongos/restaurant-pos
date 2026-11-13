import { useState } from 'react';
import { LuClock, LuX } from 'react-icons/lu';
import { trialDaysLeft, useOnline } from '../cloud/online';
import { useSyncStatus } from '../cloud/sync';
import { useCurrentUser } from '../store/store';
import { SUPPORT_WHATSAPP } from '../cloudConfig';

/** Reminds the owner when the free trial is nearly over (the till keeps working either way for now). */
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
  if (!sync.link || !info || hidden || !user || (user.role !== 'super_admin' && user.role !== 'manager')) return null;
  const left = trialDaysLeft(info);
  const closed = info.plan === 'closed';
  if (!closed && (left === null || left > 7)) return null;
  const text = closed
    ? 'This restaurant’s online account is closed. Sales still work on this device but no longer sync. Contact TechPlug to reopen it.'
    : left! > 1
      ? `Your free trial ends in ${left} days. Contact TechPlug to keep your online account, web page and online orders.`
      : left === 1
        ? 'Your free trial ends tomorrow. Contact TechPlug to keep your online account.'
        : 'Your free trial has ended. Contact TechPlug to keep your online account, web page and online orders.';
  return (
    <div className={`trial-bar ${closed || (left ?? 1) <= 0 ? 'over' : ''}`} role="status">
      <LuClock aria-hidden="true" />
      <span>{text}</span>
      {SUPPORT_WHATSAPP && (
        <a className="btn small" href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`TechPlug POS subscription — ${info.name} (${info.slug})`)}`} target="_blank" rel="noreferrer">
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
