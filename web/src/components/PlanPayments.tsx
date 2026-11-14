/**
 * Settings → Plan & payments (owner): the plan, until when it is paid (or the trial runs), how to pay
 * TechPlug, and the payments TechPlug has recorded. Payments are recorded by TechPlug in the console
 * once the money is received (cash, EcoCash, bank…); the till then carries on by itself.
 */
import { useEffect, useState } from 'react';
import { LuMessageCircle, LuReceipt } from 'react-icons/lu';
import { select } from '../cloud/api';
import { refreshInfo, trialDaysLeft, useOnline } from '../cloud/online';
import { refreshPlatform, usePlatform, whatsappLink } from '../cloud/platform';
import { useSyncStatus } from '../cloud/sync';
import { go } from '../router';

interface Payment { id: string; amount: number; currency: string; method: string; reference: string | null; plan: string; months: number; paid_until: string | null; created_at: string }

const PLAN: Record<string, string> = { trial: 'Free trial', restaurant: 'Restaurant', group: 'Group (up to 5 branches)', free: 'Free (given by TechPlug)', closed: 'Closed' };
const METHOD: Record<string, string> = { cash: 'Cash', ecocash: 'EcoCash', onemoney: 'OneMoney', innbucks: 'InnBucks', bank: 'Bank transfer', card: 'Card', other: 'Other' };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function PlanPayments() {
  const sync = useSyncStatus();
  const { info } = useOnline();
  const platform = usePlatform();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  useEffect(() => {
    if (!sync.link) return;
    void refreshInfo(true);
    void refreshPlatform(true);
    select<Payment[]>('payments', 'select=id,amount,currency,method,reference,plan,months,paid_until,created_at&order=created_at.desc&limit=24')
      .then(setPayments)
      .catch(() => setPayments([]));
  }, [sync.link]);

  if (!sync.link)
    return (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          Plans are for restaurants using the online account. This till works on its own without one.
        </p>
        <button className="btn primary" onClick={() => go('/settings?tab=online')}>
          Set up the online account
        </button>
      </>
    );

  const price = (p: string) => (p === 'group' ? platform.priceGroup ?? 35 : platform.priceRestaurant ?? 15);
  const left = trialDaysLeft(info);
  const paid = info && (info.plan === 'restaurant' || info.plan === 'group');
  const paidLeft = paid && info?.paid_until ? Math.ceil((Date.parse(info.paid_until) - Date.now()) / 86_400_000) : null;
  const wa = info ? whatsappLink(`TechPlug POS — I have paid / want to pay for ${info.name} (${info.slug})`, platform) : null;

  return (
    <>
      <div className="plan-card">
        <div>
          <span className="muted">Your plan</span>
          <b>{info ? PLAN[info.plan] ?? info.plan : '…'}</b>
          {info?.plan === 'trial' && left !== null && <span className={left < 0 ? 'bad' : left <= 7 ? 'warn' : 'muted'}>{left >= 0 ? `${left} days left · ends ${day(info.trial_ends_at)}` : `ended ${day(info.trial_ends_at)}`}</span>}
          {paid && info?.paid_until && <span className={paidLeft! < 0 ? 'bad' : paidLeft! <= 7 ? 'warn' : 'muted'}>Paid until {day(info.paid_until)}</span>}
          {paid && !info?.paid_until && <span className="muted">Active</span>}
        </div>
        {(info?.plan === 'trial' || paid) && (
          <div className="plan-price">
            <span className="muted">Price</span>
            <b>${info?.plan === 'trial' ? price('restaurant') : price(info!.plan)} a month</b>
            <span className="muted small">Group: ${price('group')} a month for up to 5 branches</span>
          </div>
        )}
      </div>

      <div className="section-title">How to pay</div>
      {platform.payInstructions ? <p className="pay-steps">{platform.payInstructions}</p> : <p className="muted">Contact TechPlug for how to pay: cash, EcoCash or bank transfer.</p>}
      <p className="muted">
        Use your restaurant's web address <b>{info?.slug}</b> as the reference. As soon as TechPlug receives the money it is recorded here and your till carries on
        by itself — nothing to install or restart.
      </p>
      {wa && (
        <a className="btn primary" href={wa} target="_blank" rel="noreferrer">
          <LuMessageCircle aria-hidden="true" /> WhatsApp TechPlug
        </a>
      )}

      <div className="section-title">Payments</div>
      {payments === null ? (
        <p className="muted">Loading…</p>
      ) : payments.length === 0 ? (
        <p className="muted">No payments recorded yet.</p>
      ) : (
        <div className="pay-list">
          {payments.map((p) => (
            <div key={p.id} className="pay-row">
              <LuReceipt aria-hidden="true" />
              <div className="grow">
                <b>
                  {p.currency === 'USD' ? '$' : `${p.currency} `}
                  {Number(p.amount).toFixed(2)} · {METHOD[p.method] ?? p.method}
                </b>
                <div className="muted small">
                  {day(p.created_at)} · {PLAN[p.plan] ?? p.plan}
                  {p.months ? ` · ${p.months} month${p.months === 1 ? '' : 's'}` : ''}
                  {p.paid_until ? ` · now paid until ${day(p.paid_until)}` : ''}
                  {p.reference ? ` · ref ${p.reference}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
