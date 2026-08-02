import { useEffect, useState, type FormEvent } from 'react';
import { api, type Child } from '../api';

export interface EditableEvent {
  id: number;
  title: string;
  childId: number | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
}

interface Props {
  children: Child[];
  // When editing, the existing event; when creating, null.
  event: EditableEvent | null;
  // Prefill start when creating by clicking a day (YYYY-MM-DD or ISO).
  initialStart?: string;
  onClose: () => void;
  onSaved: () => void;
}

// Convert a stored value into what a datetime-local / date input expects.
function toInputValue(value: string | null, allDay: boolean): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return allDay ? value.slice(0, 10) : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (allDay) return base;
  return `${base}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventModal({ children, event, initialStart, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [childId, setChildId] = useState<number | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setChildId(event.childId);
      setAllDay(event.allDay);
      setStart(toInputValue(event.startAt, event.allDay));
      setEnd(toInputValue(event.endAt, event.allDay));
      setLocation(event.location ?? '');
      setNotes(event.notes ?? '');
    } else if (initialStart) {
      const isDateOnly = initialStart.length <= 10;
      setAllDay(isDateOnly);
      setStart(toInputValue(initialStart, isDateOnly));
    }
  }, [event, initialStart]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!start) {
      setError('Please pick a start date/time');
      return;
    }
    setBusy(true);

    // For all-day events store just the date; otherwise store a full ISO string.
    const startAt = allDay ? start.slice(0, 10) : new Date(start).toISOString();
    const endAt = end ? (allDay ? end.slice(0, 10) : new Date(end).toISOString()) : null;

    const payload = {
      title,
      childId,
      startAt,
      endAt,
      allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      if (event) {
        await api.put(`/events/${event.id}`, payload);
      } else {
        await api.post('/events', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save event');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!event) return;
    if (!confirm('Delete this event?')) return;
    setBusy(true);
    try {
      await api.del(`/events/${event.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete event');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2>{event ? 'Edit event' : 'Add event'}</h2>
        {error && <div className="alert">{error}</div>}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="Soccer practice" />
        </label>

        <label>
          Who is it for?
          <select value={childId ?? ''} onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Nobody in particular —</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day
        </label>

        <div className="row">
          <label>
            Starts
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label>
            Ends <span className="hint">(optional)</span>
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        <label>
          Location <span className="hint">(optional)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="123 Field Rd" />
        </label>

        <label>
          Notes <span className="hint">(optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        <div className="modal-actions">
          {event && (
            <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
