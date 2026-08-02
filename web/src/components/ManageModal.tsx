import { useEffect, useState } from 'react';
import { api, type Child, type Feed } from '../api';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

const SWATCHES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

export function ManageModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<'people' | 'calendars'>('people');
  const [children, setChildren] = useState<Child[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);

  async function reload() {
    const [c, f] = await Promise.all([api.get<Child[]>('/children'), api.get<Feed[]>('/feeds')]);
    setChildren(c);
    setFeeds(f);
  }

  useEffect(() => {
    void reload();
  }, []);

  function afterChange() {
    void reload();
    onChanged();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="tabs">
          <button className={tab === 'people' ? 'tab active' : 'tab'} onClick={() => setTab('people')}>
            People
          </button>
          <button className={tab === 'calendars' ? 'tab active' : 'tab'} onClick={() => setTab('calendars')}>
            Subscribed calendars
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        {tab === 'people' ? (
          <PeopleTab children={children} onChanged={afterChange} />
        ) : (
          <CalendarsTab feeds={feeds} children={children} onChanged={afterChange} />
        )}
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={value.toLowerCase() === c ? 'swatch selected' : 'swatch'}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={`Choose color ${c}`}
        />
      ))}
    </div>
  );
}

function PeopleTab({ children, onChanged }: { children: Child[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[5]);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setError(null);
    try {
      await api.post('/children', { name: name.trim(), color });
      setName('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add');
    }
  }

  async function remove(id: number) {
    if (!confirm('Remove this person? Their events will stay but lose the color tag.')) return;
    await api.del(`/children/${id}`);
    onChanged();
  }

  async function recolor(child: Child, c: string) {
    await api.put(`/children/${child.id}`, { name: child.name, color: c });
    onChanged();
  }

  return (
    <div className="tab-body">
      <p className="muted">
        Add each child (or anyone whose schedule you track). Each gets a color so events are easy to tell apart.
      </p>
      {error && <div className="alert">{error}</div>}

      <ul className="list">
        {children.map((c) => (
          <li key={c.id}>
            <span className="dot" style={{ background: c.color }} />
            <span className="grow">{c.name}</span>
            <ColorPicker value={c.color} onChange={(col) => recolor(c, col)} />
            <button className="btn small danger" onClick={() => remove(c.id)}>
              Remove
            </button>
          </li>
        ))}
        {children.length === 0 && <li className="muted">No people added yet.</li>}
      </ul>

      <div className="add-row">
        <input placeholder="Add a name (e.g. Mia)" value={name} onChange={(e) => setName(e.target.value)} />
        <ColorPicker value={color} onChange={setColor} />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

function CalendarsTab({
  feeds,
  children,
  onChanged,
}: {
  feeds: Feed[];
  children: Child[];
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(SWATCHES[4]);
  const [childId, setChildId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!label.trim() || !url.trim()) {
      setError('Enter both a name and the iCal URL');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ sync: { ok: boolean; error?: string; count?: number } }>('/feeds', {
        label: label.trim(),
        url: url.trim(),
        color,
        childId,
      });
      if (!res.sync.ok) {
        setError(`Added, but couldn't read that calendar: ${res.sync.error}`);
      }
      setLabel('');
      setUrl('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add calendar');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Stop subscribing to this calendar? Its imported events will be removed.')) return;
    await api.del(`/feeds/${id}`);
    onChanged();
  }

  async function refresh(id: number) {
    await api.post(`/feeds/${id}/refresh`);
    onChanged();
  }

  return (
    <div className="tab-body">
      <p className="muted">
        Subscribe to any Google Calendar using its <strong>secret iCal address</strong>. In Google Calendar:
        Settings → pick the calendar → “Integrate calendar” → copy <em>Secret address in iCal format</em>, and paste it
        below. All those calendars then show up here together.
      </p>
      {error && <div className="alert">{error}</div>}

      <ul className="list">
        {feeds.map((f) => (
          <li key={f.id}>
            <span className="dot" style={{ background: f.color }} />
            <span className="grow">
              <strong>{f.label}</strong>
              <br />
              <span className="muted small">
                {f.lastError
                  ? `⚠️ ${f.lastError}`
                  : f.lastSynced
                    ? `${f.eventCount} events · updated ${new Date(f.lastSynced).toLocaleString()}`
                    : 'Not synced yet'}
              </span>
            </span>
            <button className="btn small" onClick={() => refresh(f.id)}>
              Refresh
            </button>
            <button className="btn small danger" onClick={() => remove(f.id)}>
              Remove
            </button>
          </li>
        ))}
        {feeds.length === 0 && <li className="muted">No calendars subscribed yet.</li>}
      </ul>

      <div className="add-stack">
        <input placeholder="Name (e.g. Mia's school calendar)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder="Secret iCal URL (https://…/basic.ics)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="row">
          <label className="grow">
            Assign to person <span className="hint">(optional)</span>
            <select value={childId ?? ''} onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— None —</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="hint">Color</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <button className="btn primary" onClick={add} disabled={busy}>
          {busy ? 'Adding…' : 'Subscribe'}
        </button>
      </div>
    </div>
  );
}
