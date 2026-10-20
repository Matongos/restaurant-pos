import { useState } from 'react';
import { LuArrowDown, LuArrowUp, LuPencil, LuPlus, LuStar, LuTrash2 } from 'react-icons/lu';
import { deleteCategory, moveCategory, updateSettings, upsertCategory, useStore } from '../store/store';
import { uid } from '../domain/rules';
import type { Category } from '../domain/types';
import { Dialog, toast } from './ui';

/** Colours that stay distinct from each other and readable as initials on a light tile. */
const COLOURS = ['#c2410c', '#ca8a04', '#15803d', '#0369a1', '#7c3aed', '#be185d', '#0f766e', '#475569'];

/**
 * The buttons along the top of the till: rename, recolour, reorder, hide, add or delete.
 * Hiding keeps the meals for sale (search and Favourites still find them); deleting moves them.
 */
export default function CategoryEditor() {
  const categories = useStore((s) => s.categories);
  const menu = useStore((s) => s.menu);
  const showFav = useStore((s) => s.settings.showFavourites !== false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const sorted = categories.slice().sort((a, b) => a.sort - b.sort);
  const count = (id: string) => menu.filter((m) => m.categoryId === id).length;
  const favCount = menu.filter((m) => m.favourite).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <p className="muted grow" style={{ margin: 0 }}>
          The buttons along the top of the Sell screen. Switch off the ones you don't use.
        </p>
        <button
          className="btn"
          onClick={() => setEditing({ id: uid('cat-'), name: '', color: COLOURS.find((c) => !categories.some((x) => x.color === c)) ?? COLOURS[0], sort: 0 })}
        >
          <LuPlus aria-hidden="true" />
          Add category
        </button>
      </div>
      <div className="cat-list">
        <div className={`cat-edit-row ${showFav ? '' : 'off'}`}>
          <LuStar aria-hidden="true" className="cat-star" />
          <div className="grow">
            <b>Favourites</b>
            <div className="muted cat-sub">{favCount} meals marked favourite</div>
          </div>
          <button className={`switch ${showFav ? 'on' : ''}`} onClick={() => updateSettings({ showFavourites: !showFav })} aria-label="Show Favourites on the till" aria-pressed={showFav}>
            <span />
          </button>
        </div>
        {sorted.map((c, i) => {
          const n = count(c.id);
          return (
            <div key={c.id} className={`cat-edit-row ${c.hidden ? 'off' : ''}`}>
              <span className="cat-dot" style={{ background: c.color }} aria-hidden="true" />
              <div className="grow">
                <b>{c.name}</b>
                <div className="muted cat-sub">
                  {n} {n === 1 ? 'meal' : 'meals'}
                  {c.hidden ? ' · hidden on the till' : ''}
                </div>
              </div>
              <div className="cat-tools">
                <button className="btn icon-only" onClick={() => moveCategory(c.id, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>
                  <LuArrowUp aria-hidden="true" />
                </button>
                <button className="btn icon-only" onClick={() => moveCategory(c.id, 1)} disabled={i === sorted.length - 1} aria-label={`Move ${c.name} down`}>
                  <LuArrowDown aria-hidden="true" />
                </button>
                <button className="btn icon-only" onClick={() => setEditing(c)} aria-label={`Rename ${c.name}`}>
                  <LuPencil aria-hidden="true" />
                </button>
                <button className="btn icon-only" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`} disabled={categories.length <= 1}>
                  <LuTrash2 aria-hidden="true" />
                </button>
              </div>
              <button className={`switch ${c.hidden ? '' : 'on'}`} onClick={() => upsertCategory({ ...c, hidden: !c.hidden })} aria-label={`Show ${c.name} on the till`} aria-pressed={!c.hidden}>
                <span />
              </button>
            </div>
          );
        })}
      </div>
      {editing && <CategoryDialog cat={editing} isNew={!categories.some((c) => c.id === editing.id)} onClose={() => setEditing(null)} />}
      {deleting && <DeleteCategoryDialog cat={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function CategoryDialog({ cat, isNew, onClose }: { cat: Category; isNew: boolean; onClose: () => void }) {
  const categories = useStore((s) => s.categories);
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);
  const clash = categories.some((c) => c.id !== cat.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const blocker = !name.trim() ? 'Type a name' : clash ? 'That name is already used' : '';
  const save = () => {
    if (blocker) return;
    upsertCategory({ ...cat, name, color });
    toast(isNew ? `${name.trim()} added to the till` : 'Saved');
    onClose();
  };
  return (
    <Dialog
      title={isNew ? 'Add a category' : `Edit ${cat.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'primary'}`} aria-disabled={!!blocker} onClick={save}>
            {blocker || 'Save'}
          </button>
        </>
      }
    >
      <label className="field" style={{ marginTop: 0 }}>
        Name
        <input id="cat-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Specials" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <div className="step-label" style={{ marginTop: 14 }}>
        Colour
      </div>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {COLOURS.map((c) => (
          <button key={c} role="radio" aria-checked={color === c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
    </Dialog>
  );
}

function DeleteCategoryDialog({ cat, onClose }: { cat: Category; onClose: () => void }) {
  const categories = useStore((s) => s.categories);
  const menu = useStore((s) => s.menu);
  const meals = menu.filter((m) => m.categoryId === cat.id);
  const others = categories.filter((c) => c.id !== cat.id).sort((a, b) => a.sort - b.sort);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState('');
  const blocker = meals.length && !moveTo ? 'Choose where its meals go' : '';
  const go = () => {
    if (blocker) return;
    const r = deleteCategory(cat.id, moveTo || undefined);
    if (!r.ok) return setError(r.error);
    toast(`${cat.name} deleted${meals.length ? ` — its meals moved to ${others.find((c) => c.id === moveTo)?.name}` : ''}`);
    onClose();
  };
  return (
    <Dialog
      title={`Delete ${cat.name}?`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${blocker ? 'blocked' : 'danger-fill'}`} aria-disabled={!!blocker} onClick={go}>
            {blocker || 'Delete category'}
          </button>
        </>
      }
    >
      {meals.length ? (
        <>
          <p style={{ marginTop: 0 }}>
            {meals.length} {meals.length === 1 ? 'meal is' : 'meals are'} in {cat.name} ({meals.map((m) => m.name).join(', ')}). Move {meals.length === 1 ? 'it' : 'them'} to:
          </p>
          <div className="seg">
            {others.map((c) => (
              <button key={c.id} className={moveTo === c.id ? 'on' : ''} onClick={() => setMoveTo(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <p className="hint">If you only want the button gone but the meals kept together, switch the category off instead.</p>
        </>
      ) : (
        <p style={{ marginTop: 0 }}>No meals are in {cat.name}. Past sales are not affected.</p>
      )}
      {error && <div className="error">{error}</div>}
    </Dialog>
  );
}
