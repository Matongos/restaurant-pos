import { useEffect, useState } from 'react';
import { LuMonitorSmartphone } from 'react-icons/lu';
import { BUILD, buildDate, platformName } from '../version';
import { UpdateStatus, useUpdateCheck } from './AboutDialog';
import { listDevices, type DeviceRow } from '../cloud/devices';
import { useSyncStatus } from '../cloud/sync';
import { useCurrentUser } from '../store/store';

/** "My account": which version this device runs, whether it is the newest, and (owner) every device's version. */
export default function AppVersion() {
  const { check, latest, desktop, run } = useUpdateCheck();
  const user = useCurrentUser();
  const link = useSyncStatus().link;
  const owner = user?.role === 'super_admin' || user?.role === 'manager';
  return (
    <section className="acct-card" aria-labelledby="acct-version">
      <div className="acct-head">
        <span className="acct-avatar" aria-hidden="true">
          <LuMonitorSmartphone />
        </span>
        <div className="grow">
          <h3 id="acct-version">App version</h3>
          <div className="muted">
            Version <b className="mono-sm">{BUILD}</b> · {buildDate()}
            {desktop && (
              <>
                {' '}
                · Windows app <b>{desktop}</b>
              </>
            )}
          </div>
          <div className="muted small">{platformName(desktop)}</div>
        </div>
      </div>
      <UpdateStatus check={check} latest={latest} run={() => void run()} />
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        When asking TechPlug for help, tell them this version number.
      </p>
      {owner && link && <Devices latest={latest} />}
    </section>
  );
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Every device of this restaurant and the version it last reported. */
function Devices({ latest }: { latest: string | null }) {
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    listDevices()
      .then(setRows)
      .catch(() => setError('Could not load the devices (no internet?).'));
  }, []);
  const newest = latest ?? BUILD;
  return (
    <div style={{ marginTop: 12 }}>
      <b className="small">Your restaurant's devices</b>
      {error && <div className="muted small">{error}</div>}
      {rows && rows.length === 0 && <div className="muted small">No device has reported yet. Devices report within a few minutes of being online.</div>}
      {rows && rows.length > 0 && (
        <table className="list small" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Version</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  Till {r.data.tillNo} · {r.data.platform}
                  {r.data.lastUser && <div className="muted">last used by {r.data.lastUser}</div>}
                </td>
                <td>
                  {r.data.build}
                  {r.data.desktop && <div className="muted">Windows app {r.data.desktop}</div>}
                  <div className={r.data.build === newest ? 'good' : 'warn'}>{r.data.build === newest ? 'newest' : 'needs Reload'}</div>
                </td>
                <td>{ago(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
