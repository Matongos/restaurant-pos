/**
 * Settings → Backup (owner): download a copy of everything on this till as one file, and — on a till that
 * is not connected to the online account — put a backup back.
 */
import { useState } from 'react';
import { LuDownload, LuUpload } from 'react-icons/lu';
import { getState, restoreBackup, useStore } from '../store/store';
import { useSyncStatus } from '../cloud/sync';
import { toast } from './ui';

export const BACKUP_KIND = 'techplug-pos-backup';

export function backupFile(): { name: string; text: string } {
  const st = getState();
  const clean = { ...st, orders: st.orders.filter((o) => !o.example), liveCarts: {} };
  const day = new Date().toISOString().slice(0, 10);
  const slug = st.settings.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurant';
  return { name: `techplug-backup-${slug}-${day}.json`, text: JSON.stringify({ kind: BACKUP_KIND, savedAt: new Date().toISOString(), state: clean }) };
}

export default function Backup() {
  const sync = useSyncStatus();
  const counts = useStore((s) => s.orders.length);
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const download = () => {
    const { name, text } = backupFile();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup downloaded — keep it somewhere safe (a USB stick, Google Drive or email it to yourself)');
  };

  const pick = async (f: File | undefined) => {
    setError('');
    setFile(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.kind !== BACKUP_KIND || !j.state?.settings) throw new Error();
      setFile({ name: f.name, data: j.state });
    } catch {
      setError('That is not a TechPlug POS backup file.');
    }
  };

  const restore = () => {
    if (!file) return;
    const r = restoreBackup(file.data);
    if (!r.ok) return setError(r.error);
    toast('Backup put back');
    setFile(null);
    setTyped('');
  };

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        Download a backup
      </div>
      <p className="muted">
        One file with everything on this till: menu, staff, sales ({counts}), customers' change, stock and books. Download one every week and keep it
        somewhere safe.{sync.link ? ' Your online account also keeps a copy of everything.' : ''}
      </p>
      <button className="btn primary" onClick={download}>
        <LuDownload aria-hidden="true" /> Download backup
      </button>

      <div className="section-title">Put a backup back</div>
      {sync.link ? (
        <p className="muted">This till is connected to the online account, which already keeps everything. To bring a till back, connect it to your restaurant again (Settings → Online account).</p>
      ) : (
        <>
          <p className="muted">Replaces everything on this till with the backup — for a new or repaired computer. Sales made since the backup was taken are lost.</p>
          <label className="btn">
            <LuUpload aria-hidden="true" /> Choose backup file
            <input type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {file && (
            <div className="fresh-card" style={{ marginTop: 12 }}>
              <b>{file.name}</b>
              <label className="field">
                Type RESTORE to replace everything on this till
                <input value={typed} onChange={(e) => setTyped(e.target.value)} />
              </label>
              <button className="btn primary" disabled={typed.trim().toUpperCase() !== 'RESTORE'} onClick={restore}>
                Put this backup back
              </button>
            </div>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
    </>
  );
}
