import { useEffect, useState, type FormEvent } from 'react';
import { api, type Child } from '../api';
import { ReminderPicker } from './ReminderPicker';

export interface EditableEvent {
  id: number; // the master event's id
  title: string;
  childId: number | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  recurrence: 'weekly' | null;
  recurrenceUntil: string | null;
  // Set when a single occurrence of a weekly series was opened (YYYY-MM-DD of
  // its original slot). Enables the "this / following / all" scope choice.
  occurrenceDate?: string | null;
}

type Scope = 'single' | 'following' | 'all';

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
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [scope, setScope] = useState<Scope>('single');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // We're editing one occurrence of a repeating series when an occurrenceDate
  // is present. That's when the scope choice ("this / following / all") applies.
  const isOccurrence = Boolean(event && event.recurrence === 'weekly' && event.occurrenceDate);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setChildId(event.childId);
      setAllDay(event.allDay);
      setStart(toInputValue(event.startAt, event.allDay));
      setEnd(toInputValue(event.endAt, event.allDay));
      setLocation(event.location ?? '');
      setNotes(event.notes ?? '');
      setRepeatWeekly(event.recurrence === 'weekly');
      setRepeatUntil(event.recurrenceUntil ?? '');
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
    if (repeatWeekly && !repeatUntil) {
      setError('Choose the date the weekly repeat should stop');
      return;
    }
    setBusy(true);

    // For all-day events store just the date; otherwise store a full ISO string.
    const startAt = allDay ? start.slice(0, 10) : new Date(start).toISOString();
    const endAt = end ? (allDay ? end.slice(0, 10) : new Date(end).toISOString()) : null;

    const fields = {
      title,
      childId,
      startAt,
      endAt,
      allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      if (isOccurrence && event) {
        if (scope === 'all') {
          // Edit the whole series: update the master, keeping the weekly rule.
          await api.put(`/events/${event.id}`, {
            ...fields,
            recurrence: 'weekly',
            recurrenceUntil: event.recurrenceUntil,
          });
        } else {
          await api.put(`/events/${event.id}/occurrence`, {
            ...fields,
            occurrenceDate: event.occurrenceDate,
            scope,
          });
        }
      } else if (event) {
        await api.put(`/events/${event.id}`, {
          ...fields,
          recurrence: repeatWeekly ? ('weekly' as const) : null,
          recurrenceUntil: repeatWeekly ? repeatUntil : null,
        });
      } else {
        await api.post('/events', {
          ...fields,
          recurrence: repeatWeekly ? ('weekly' as const) : null,
          recurrenceUntil: repeatWeekly ? repeatUntil : null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save event');
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!event) return;
    let message = 'Delete this event?';
    if (isOccurrence) {
      message =
        scope === 'all'
          ? 'Delete the entire repeating series?'
          : scope === 'following'
            ? 'Delete this and all future occurrences?'
            : 'Delete just this one occurrence?';
    }
    if (!confirm(message)) return;
    setBusy(true);
    try {
      if (isOccurrence && event && scope !== 'all') {
        await api.del(
          `/events/${event.id}/occurrence?date=${event.occurrenceDate}&scope=${scope}`,
        );
      } else {
        await api.del(`/events/${event.id}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete event');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2>{isOccurrence ? 'Edit repeating event' : event ? 'Edit event' : 'Add event'}</h2>
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

        {/* Series-level repeat controls: only when creating or editing a one-off. */}
        {!isOccurrence && (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
              Repeat weekly
            </label>
            {repeatWeekly && (
              <label>
                Repeat every week until
                <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} required />
              </label>
            )}
          </>
        )}

        {/* Scope choice when editing one occurrence of a repeating series. */}
        {isOccurrence && (
          <fieldset className="scope">
            <legend>
              Apply changes to
              {event?.recurrenceUntil && (
                <span className="hint"> · repeats weekly until {event.recurrenceUntil}</span>
              )}
            </legend>
            <label className="radio">
              <input type="radio" name="scope" checked={scope === 'single'} onChange={() => setScope('single')} />
              This event only
            </label>
            <label className="radio">
              <input type="radio" name="scope" checked={scope === 'following'} onChange={() => setScope('following')} />
              This and following events
            </label>
            <label className="radio">
              <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
              All events in the series
            </label>
          </fieldset>
        )}

        {event && !allDay && <ReminderPicker seriesKey={`local:${event.id}`} />}

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
