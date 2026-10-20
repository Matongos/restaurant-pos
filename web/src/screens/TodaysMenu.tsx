import { useMemo } from 'react';
import { setComponentAvailable, setItemAvailable, useCurrentUser, useStore } from '../store/store';
import { TopBar } from '../components/ui';

/** Phone-friendly screen: switch ingredients or whole meals sold out. */
export default function TodaysMenu() {
  const user = useCurrentUser()!;
  const components = useStore((s) => s.components);
  const menu = useStore((s) => s.menu);
  const categories = useStore((s) => s.categories);

  const blockedBy = useMemo(() => {
    const off = new Set(components.filter((c) => !c.available).map((c) => c.id));
    const map: Record<string, string[]> = {};
    for (const m of menu) {
      const names = m.componentIds.filter((id) => off.has(id)).map((id) => components.find((c) => c.id === id)!.name);
      if (names.length) map[m.id] = names;
    }
    return map;
  }, [components, menu]);

  return (
    <div className="app">
      <TopBar title="Today's Menu" />
      <div className="page">
        <div className="page-narrow">
          <div className="section-title" style={{ marginTop: 0 }}>
            Ingredients — switching one off hides every meal that uses it
          </div>
          <div className="toggle-list">
            {components.map((c) => (
              <button key={c.id} className={`toggle ${c.available ? '' : 'off'}`} onClick={() => setComponentAvailable(c.id, !c.available, user.id)}>
                <span>
                  {c.name}
                  {c.changedAt && (
                    <span className="sub">changed {new Date(c.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </span>
                <span className="st">{c.available ? 'AVAILABLE' : 'SOLD OUT'}</span>
              </button>
            ))}
          </div>

          {categories
            .slice()
            .sort((a, b) => a.sort - b.sort)
            .map((cat) => (
              <div key={cat.id}>
                <div className="section-title">{cat.name}</div>
                <div className="toggle-list">
                  {menu
                    .filter((m) => m.categoryId === cat.id)
                    .map((m) => {
                      const blocked = blockedBy[m.id];
                      const on = m.available && !blocked;
                      return (
                        <button key={m.id} className={`toggle ${on ? '' : 'off'}`} onClick={() => setItemAvailable(m.id, !m.available)}>
                          <span>
                            {m.name}
                            {blocked && <span className="sub">No {blocked.join(', ')}</span>}
                            {!m.available && <span className="sub">Switched off</span>}
                          </span>
                          <span className="st">{on ? 'ON SALE' : 'HIDDEN'}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
