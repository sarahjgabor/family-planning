import { useEffect, useState, type ReactNode } from 'react';
import { api, type Child, type Feed } from '../api';

/** A small "?" icon that reveals more detail on hover or keyboard focus. */
function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="infotip" tabIndex={0} role="button" aria-label="How to find this">
      <span className="infotip-icon" aria-hidden="true">
        ?
      </span>
      <span className="infotip-bubble" role="tooltip">
        {children}
      </span>
    </span>
  );
}

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

const SWATCHES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

export function ManageModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<'people' | 'calendars' | 'digest'>('people');
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
          <button className={tab === 'digest' ? 'tab active' : 'tab'} onClick={() => setTab('digest')}>
            Email digest
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        {tab === 'people' && <PeopleTab children={children} onChanged={afterChange} />}
        {tab === 'calendars' && <CalendarsTab feeds={feeds} children={children} onChanged={afterChange} />}
        {tab === 'digest' && <DigestTab />}
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
      } else if (res.sync.count === 0) {
        setError(
          'Added, but that calendar returned 0 events. Make sure you used the secret iCal address (ending in /basic.ics), not the “?cid=” link.',
        );
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
        Subscribe to any Google Calendar to see its events here — they'll all show up together.
      </p>
      {error && <div className="alert">{error}</div>}

      <ul className="list">
        {feeds.map((f) => (
          <li key={f.id}>
            <span className="dot" style={{ background: f.color }} />
            <span className="grow">
              <strong>{f.label}</strong>
              <br />
              {f.lastError ? (
                <span className="feed-warn small">⚠️ {f.lastError}</span>
              ) : f.lastSynced && f.eventCount === 0 ? (
                <span className="feed-warn small">
                  ⚠️ Synced, but found 0 events — check you used the <em>secret iCal address</em>, not the “?cid=” link.
                </span>
              ) : f.lastSynced ? (
                <span className="muted small">
                  {f.eventCount} events · updated {new Date(f.lastSynced).toLocaleString()}
                </span>
              ) : (
                <span className="muted small">Not synced yet</span>
              )}
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
        <div className="field-label">
          <span>
            Paste the calendar's <strong>secret iCal address</strong> below
          </span>
          <InfoTip>
            <strong>Where to find it</strong>
            <ol>
              <li>Open Google Calendar on a computer.</li>
              <li>
                Hover the calendar in the left sidebar → <strong>⋮</strong> → <em>Settings and sharing</em>.
              </li>
              <li>
                Scroll to <em>Integrate calendar</em>.
              </li>
              <li>
                Copy <em>Secret address in iCal format</em> (it ends in <code>/basic.ics</code>).
              </li>
            </ol>
            Don't use the “<code>?cid=</code>” link — that one just adds a calendar to your own Google account and
            won't import here.
          </InfoTip>
        </div>
        <input
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
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

interface DigestStatus {
  emailConfigured: boolean;
  timezone: string;
  schedule: string;
}

function DigestTab() {
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<DigestStatus>('/digest/status').then(setStatus).catch(() => {});
  }, []);

  async function showPreview() {
    setError(null);
    try {
      const res = await api.get<{ html: string }>('/digest/preview');
      setPreview(res.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build preview');
    }
  }

  async function sendTest() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.post<{ sent: number }>('/digest/send-test');
      setMessage(`Sent to ${res.sent} recipient(s). Check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send email');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-body">
      <p className="muted">
        A summary of the upcoming week — including any notes on each event — goes out to everyone with an account,
        every <strong>Sunday morning</strong>.
      </p>

      {status && !status.emailConfigured && (
        <div className="alert">
          Email isn't set up yet. Add these settings where the app is hosted, then restart it:
          <code className="env-block">
            SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
            <br />
            TIMEZONE (e.g. America/New_York)
          </code>
          A Gmail account with an “app password” works well. See the README for step-by-step help.
        </div>
      )}

      {status?.emailConfigured && (
        <p className="muted small">
          ✅ Email is set up. Sending on schedule <code>{status.schedule}</code> in <strong>{status.timezone}</strong>.
        </p>
      )}

      {message && <div className="notice">{message}</div>}
      {error && <div className="alert">{error}</div>}

      <div className="add-row">
        <button className="btn" onClick={showPreview}>
          Preview this week
        </button>
        <button className="btn primary" onClick={sendTest} disabled={busy || !status?.emailConfigured}>
          {busy ? 'Sending…' : 'Send a test now'}
        </button>
      </div>

      {preview && <iframe className="digest-preview" title="Digest preview" srcDoc={preview} />}
    </div>
  );
}
