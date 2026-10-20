import { useMemo, useState } from 'react';
import { LuEye, LuEyeOff, LuKeyRound, LuPause, LuPencil, LuPlay, LuTrash2, LuUserPlus } from 'react-icons/lu';
import { addStaff, removeStaff, setStaffPin, setStaffSuspended, updateStaff, useCurrentUser, useStore, type StaffResult } from '../store/store';
import { pinProblem, ROLE_HELP, ROLE_LABEL, rolesAssignable, staffRights } from '../domain/rules';
import type { Role, Staff, StaffAction } from '../domain/types';
import { Dialog, MoreMenu, toast, TopBar } from '../components/ui';

type Tab = 'active' | 'suspended' | 'removed';

const ACTION_LABEL: Record<StaffAction, string> = {
  added: 'Added',
  edited: 'Changed details',
  pin_changed: 'Changed PIN',
  suspended: 'Suspended',
  reactivated: 'Reactivated',
  deleted: 'Removed',
};

const ROLE_ORDER: Role[] = ['super_admin', 'manager', 'cashier', 'kitchen', 'attendant'];

function ago(iso?: string) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; staff: Staff }
  | { kind: 'pin'; staff: Staff }
  | { kind: 'suspend'; staff: Staff }
  | { kind: 'remove'; staff: Staff }
  | null;

/** Managers look after cashiers, kitchen and attendants; the owner looks after everyone. */
export default function StaffScreen() {
  const me = useCurrentUser()!;
  const staff = useStore((s) => s.staff);
  const log = useStore((s) => s.staffLog);
  const [tab, setTab] = useState<Tab>('active');
  const [dialog, setDialog] = useState<DialogState>(null);

  const groups = useMemo(() => {
    const sort = (a: Staff, b: Staff) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name);
    return {
      active: staff.filter((s) => !s.deletedAt && s.active).sort(sort),
      suspended: staff.filter((s) => !s.deletedAt && !s.active).sort(sort),
      removed: staff.filter((s) => s.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
    };
  }, [staff]);
  const list = groups[tab];
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? 'Unknown';
  const recent = useMemo(() => [...log].reverse().slice(0, 30), [log]);

  const reactivate = (s: Staff) => {
    const r = setStaffSuspended(s.id, false, me.id);
    toast(r.ok ? `${s.name} can log in again` : r.error);
  };

  return (
    <div className="app">
      <TopBar title="Staff">
        <button className="btn primary" onClick={() => setDialog({ kind: 'add' })}>
          <LuUserPlus aria-hidden="true" />
          Add person
        </button>
      </TopBar>
      <div className="page">
        <div className="page-narrow">
          <div className="tabs" role="tablist">
            {(['active', 'suspended', 'removed'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'active' ? 'Active' : t === 'suspended' ? 'Suspended' : 'Removed'} ({groups[t].length})
              </button>
            ))}
          </div>

          {me.role === 'manager' && tab === 'active' && (
            <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
              You can add and change cashiers, kitchen staff and attendants. Only the owner can change managers.
            </p>
          )}

          {list.length === 0 && (
            <div className="empty">
              {tab === 'suspended' ? 'Nobody is suspended.' : tab === 'removed' ? 'Nobody has been removed.' : 'No staff yet.'}
            </div>
          )}

          <div className="staff-list">
            {list.map((s) => {
              const r = staffRights(me, s);
              const isMe = s.id === me.id;
              const more = [
                ...(r.suspend && s.active ? [{ label: 'Suspend', icon: <LuPause aria-hidden="true" />, onClick: () => setDialog({ kind: 'suspend', staff: s }) }] : []),
                ...(r.remove ? [{ label: 'Remove', icon: <LuTrash2 aria-hidden="true" />, danger: true, onClick: () => setDialog({ kind: 'remove', staff: s }) }] : []),
              ];
              return (
                <div key={s.id} className={`staff-row ${s.active ? '' : 'off'}`}>
                  <span className="avatar">{s.name.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <div className="staff-name">
                      <b>{s.name}</b>
                      {isMe && <span className="tag">You</span>}
                      <span className={`tag role-${s.role}`}>{ROLE_LABEL[s.role]}</span>
                      {!s.active && !s.deletedAt && <span className="tag void">Suspended</span>}
                    </div>
                    <div className="muted staff-meta">
                      {s.deletedAt
                        ? `Removed ${ago(s.deletedAt)} · their name stays on past sales`
                        : [s.phone, s.pinChangedAt ? `PIN set ${ago(s.pinChangedAt)}` : 'PIN never changed'].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {!s.deletedAt && (
                    <div className="staff-actions">
                      {!s.active && r.suspend && (
                        <button className="btn primary" onClick={() => reactivate(s)}>
                          <LuPlay aria-hidden="true" />
                          Reactivate
                        </button>
                      )}
                      {r.edit && (
                        <button className="btn" onClick={() => setDialog({ kind: 'edit', staff: s })}>
                          <LuPencil aria-hidden="true" />
                          Edit
                        </button>
                      )}
                      {r.pin && (
                        <button className="btn" onClick={() => setDialog({ kind: 'pin', staff: s })}>
                          <LuKeyRound aria-hidden="true" />
                          {isMe ? 'My PIN' : 'PIN'}
                        </button>
                      )}
                      {more.length > 0 && <MoreMenu items={more} label={`More for ${s.name}`} />}
                      {!r.edit && <span className="muted staff-locked">Owner only</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="section-title">Recent changes</div>
          {recent.length === 0 ? (
            <div className="hint">Every change to staff (added, PIN changed, suspended, removed) is recorded here with who did it.</div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Person</th>
                    <th>What</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                      <td>{name(e.staffId)}</td>
                      <td>
                        {ACTION_LABEL[e.action]}
                        {e.detail && <div className="muted" style={{ fontSize: 13 }}>{e.detail}</div>}
                      </td>
                      <td>{name(e.by)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {dialog?.kind === 'add' && <StaffDialog me={me} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <StaffDialog me={me} staff={dialog.staff} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'pin' && <PinDialog me={me} staff={dialog.staff} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'suspend' && <SuspendDialog me={me} staff={dialog.staff} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'remove' && <RemoveDialog me={me} staff={dialog.staff} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */

/** Two PIN boxes (new + repeat) with a show/hide switch. */
function PinFields({ pin, setPin, again, setAgain, problem }: { pin: string; setPin: (v: string) => void; again: string; setAgain: (v: string) => void; problem: string | null }) {
  const [show, setShow] = useState(false);
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  return (
    <>
      <div className="pin-pair">
        <label className="field">
          New PIN (4 digits)
          <input id="staff-pin" type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(clean(e.target.value))} />
        </label>
        <label className="field">
          Type it again
          <input id="staff-pin2" type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(clean(e.target.value))} />
        </label>
        <button type="button" className="btn ghost icon-only pin-show" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide PIN' : 'Show PIN'}>
          {show ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />}
        </button>
      </div>
      {problem && pin.length === 4 && <div className="error" style={{ marginTop: 6 }}>{problem}</div>}
    </>
  );
}

function pinBlocker(pin: string, again: string, problem: string | null) {
  if (pin.length < 4) return 'Type a 4-digit PIN';
  if (problem) return problem;
  if (again !== pin) return again.length < 4 ? 'Type the PIN again' : "The two PINs don't match";
  return '';
}

function StaffDialog({ me, staff, onClose }: { me: Staff; staff?: Staff; onClose: () => void }) {
  const all = useStore((s) => s.staff);
  const editing = !!staff;
  const rights = staff ? staffRights(me, staff) : null;
  const roles = rolesAssignable(me.role);
  const [name, setName] = useState(staff?.name ?? '');
  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [role, setRole] = useState<Role | ''>(staff?.role ?? '');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const problem = editing ? null : pinProblem(pin, all);

  const blocker = !name.trim() ? 'Type their name' : !role ? 'Choose what they do' : !editing ? pinBlocker(pin, again, problem) : '';
  const save = () => {
    if (blocker) return;
    let r: StaffResult;
    if (staff) r = updateStaff(staff.id, { name, phone, role: role as Role }, me.id);
    else r = addStaff({ name, phone, role: role as Role, pin }, me.id);
    if (!r.ok) return setError(r.error);
    toast(editing ? `Saved ${r.staff.name}` : `${r.staff.name} added — they can log in with their PIN now`);
    onClose();
  };
  const canChangeRole = !editing || rights?.role;

  return (
    <Dialog
      title={editing ? `Edit ${staff!.name}` : 'Add a person'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={save}>
            {blocker || (editing ? 'Save changes' : 'Add person')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field" style={{ marginTop: 0 }}>
          Name
          <input id="staff-name" autoFocus={!editing} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chipo" />
        </label>
        <label className="field" style={{ marginTop: 0 }}>
          Phone (optional)
          <input id="staff-phone" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" />
        </label>
      </div>

      <div className="step-label" style={{ marginTop: 16 }}>
        What do they do?
      </div>
      {canChangeRole ? (
        <div className="role-pick">
          {roles.map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)} aria-pressed={role === r}>
              <b>{ROLE_LABEL[r]}</b>
              <span>{ROLE_HELP[r]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="hint" style={{ marginTop: 6 }}>
          {ROLE_LABEL[staff!.role]} — {staff!.id === me.id ? "you can't change your own role." : 'only the owner can change this.'}
        </div>
      )}

      {!editing && (
        <>
          <div className="step-label" style={{ marginTop: 16 }}>
            Their PIN
          </div>
          <PinFields pin={pin} setPin={setPin} again={again} setAgain={setAgain} problem={problem} />
          <div className="hint" style={{ marginTop: 6 }}>Tell them their PIN privately. They use it to log in and it shows on everything they do.</div>
        </>
      )}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  );
}

function PinDialog({ me, staff, onClose }: { me: Staff; staff: Staff; onClose: () => void }) {
  const all = useStore((s) => s.staff);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const problem = pinProblem(pin, all, staff.id);
  const blocker = pinBlocker(pin, again, problem);
  const isMe = staff.id === me.id;
  const save = () => {
    if (blocker) return;
    const r = setStaffPin(staff.id, pin, me.id);
    if (!r.ok) return setError(r.error);
    toast(isMe ? 'Your PIN is changed' : `${staff.name}'s PIN is changed — the old one no longer works`);
    onClose();
  };
  return (
    <Dialog
      title={isMe ? 'Change my PIN' : `New PIN for ${staff.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={save}>
            {blocker || 'Change PIN'}
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {isMe ? 'Use the new PIN next time you log in.' : `The old PIN stops working straight away. Tell ${staff.name.split(' ')[0]} the new one privately.`}
      </p>
      <PinFields pin={pin} setPin={setPin} again={again} setAgain={setAgain} problem={problem} />
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  );
}

function SuspendDialog({ me, staff, onClose }: { me: Staff; staff: Staff; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const go = () => {
    const r = setStaffSuspended(staff.id, true, me.id, reason);
    if (!r.ok) return setError(r.error);
    toast(`${staff.name} is suspended`);
    onClose();
  };
  return (
    <Dialog
      title={`Suspend ${staff.name}?`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger-fill" onClick={go}>
            Suspend
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        They are logged out on every till and can't log in until you reactivate them. Nothing they did is changed.
      </p>
      <label className="field">
        Reason (optional)
        <input id="staff-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. on leave, under investigation" />
      </label>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  );
}

function RemoveDialog({ me, staff, onClose }: { me: Staff; staff: Staff; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const go = () => {
    const r = removeStaff(staff.id, me.id, reason);
    if (!r.ok) return setError(r.error);
    toast(`${staff.name} removed`);
    onClose();
  };
  return (
    <Dialog
      title={`Remove ${staff.name}?`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger-fill" onClick={go}>
            Remove for good
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Use this when someone has left. They can never log in again and their PIN becomes free for someone else.
      </p>
      <p className="hint">
        Their name stays on the sales, cancellations and purchases they made, so the books still add up. If they may come back, choose <b>Suspend</b> instead.
      </p>
      <label className="field">
        Reason (optional)
        <input id="staff-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. resigned" />
      </label>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  );
}
