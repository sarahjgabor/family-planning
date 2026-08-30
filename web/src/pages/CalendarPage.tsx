import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, DateSelectArg, EventInput, EventChangeArg } from '@fullcalendar/core';
import { useAuth } from '../auth';
import { api, type Child, type CalendarEvent } from '../api';
import { EventModal, type EditableEvent } from '../components/EventModal';
import { ManageModal } from '../components/ManageModal';
import { ReminderPicker } from '../components/ReminderPicker';

export function CalendarPage() {
  const { user, logout } = useAuth();
  const calendarRef = useRef<FullCalendar>(null);
  const [childrenList, setChildrenList] = useState<Child[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const [showManage, setShowManage] = useState(false);
  const [editing, setEditing] = useState<EditableEvent | null>(null);
  const [creatingAt, setCreatingAt] = useState<string | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Phones open in the scrolling List (agenda) view — easier to read on a
  // small screen than a dense month grid. Decided once, on load.
  const [initialView] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
      ? 'listWeek'
      : 'dayGridMonth',
  );

  const loadChildren = useCallback(() => {
    api.get<Child[]>('/children').then(setChildrenList).catch(() => {});
  }, []);

  useEffect(() => {
    loadChildren();
  }, [loadChildren]);

  // Returning from the Google consent screen: open Manage so the user can pick
  // calendars, and clean the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'connected') {
      setShowManage(true);
    } else if (g === 'error') {
      alert('Google connection was cancelled or failed. You can try again from Manage.');
    }
    if (g) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  function refetch() {
    calendarRef.current?.getApi().refetchEvents();
  }

  // FullCalendar calls this whenever it needs events for the visible range.
  const fetchEvents = useCallback(
    async (
      info: { startStr: string; endStr: string },
      success: (events: EventInput[]) => void,
      failure: (error: Error) => void,
    ) => {
      try {
        const data = await api.get<CalendarEvent[]>(
          `/calendar?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`,
        );
        const mapped: EventInput[] = data
          .filter((e) => {
            const key = e.extendedProps.childId ? `child-${e.extendedProps.childId}` : 'unassigned';
            return !hiddenRef.current.has(key);
          })
          .map((e) => ({
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end ?? undefined,
            allDay: e.allDay,
            color: e.color,
            // Recurring events aren't draggable — moving one occurrence of a
            // series is ambiguous, so edits go through the form instead.
            editable: e.editable && !e.recurring,
            extendedProps: e.extendedProps,
          }));
        success(mapped);
      } catch (err) {
        failure(err instanceof Error ? err : new Error('Failed to load'));
      }
    },
    [],
  );

  function onEventClick(arg: EventClickArg) {
    const props = arg.event.extendedProps as CalendarEvent['extendedProps'];
    if (props.source === 'local') {
      // Event ids look like `local-<masterId>` or, for a series occurrence,
      // `local-<masterId>-<YYYYMMDD>`. Parse both the master id and, when
      // present, the occurrence's original slot date.
      const parts = arg.event.id.split('-'); // ['local', masterId, maybeDate]
      const masterId = parseInt(parts[1], 10);
      const rawDate = parts[2];
      const occurrenceDate =
        rawDate && /^\d{8}$/.test(rawDate)
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : null;
      setEditing({
        id: masterId,
        title: arg.event.title,
        childId: props.childId,
        startAt: arg.event.startStr,
        endAt: arg.event.endStr || null,
        allDay: arg.event.allDay,
        location: props.location,
        notes: props.notes,
        recurrence: props.recurrence,
        recurrenceUntil: props.recurrenceUntil,
        occurrenceDate,
      });
      setCreatingAt(null);
      setShowEventModal(true);
    } else {
      // Imported events are read-only; show their details.
      setDetail({
        id: arg.event.id,
        title: arg.event.title,
        start: arg.event.startStr,
        end: arg.event.endStr || null,
        allDay: arg.event.allDay,
        color: arg.event.backgroundColor,
        editable: false,
        recurring: false,
        extendedProps: props,
      });
    }
  }

  function onDateSelect(arg: DateSelectArg) {
    setEditing(null);
    setCreatingAt(arg.startStr);
    setShowEventModal(true);
    calendarRef.current?.getApi().unselect();
  }

  // Fired when an event is dragged to a new time or resized. Only local,
  // non-recurring events are draggable, so we just persist the new schedule.
  async function onEventChange(arg: EventChangeArg) {
    const ev = arg.event;
    const props = ev.extendedProps as CalendarEvent['extendedProps'];
    if (props.source !== 'local' || props.recurrence) {
      arg.revert();
      return;
    }
    const id = parseInt(ev.id.slice('local-'.length), 10);
    const startAt = ev.allDay ? ev.startStr.slice(0, 10) : ev.start!.toISOString();
    const endAt = ev.end ? (ev.allDay ? ev.endStr.slice(0, 10) : ev.end.toISOString()) : null;
    try {
      await api.patch(`/events/${id}/move`, { startAt, endAt, allDay: ev.allDay });
    } catch {
      arg.revert();
    }
  }

  function toggleFilter(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Refetch on the next tick once state (and hiddenRef) is updated.
    setTimeout(refetch, 0);
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      await api.post('/feeds/refresh-all');
      refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function onSaved() {
    setShowEventModal(false);
    setEditing(null);
    setCreatingAt(null);
    refetch();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-row">
          <span className="logo">🪿</span>
          <h1>The Goose Nest</h1>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '⟳ Refresh'}
          </button>
          <button className="btn" onClick={() => setShowManage(true)}>
            ⚙ Manage
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setEditing(null);
              setCreatingAt(null);
              setShowEventModal(true);
            }}
          >
            + Add event
          </button>
          <div className="user-menu">
            <span className="muted small">{user?.name}</span>
            <button className="btn small" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {childrenList.length > 0 && (
        <div className="legend">
          {childrenList.map((c) => {
            const key = `child-${c.id}`;
            const off = hidden.has(key);
            return (
              <button
                key={c.id}
                className={off ? 'chip off' : 'chip'}
                onClick={() => toggleFilter(key)}
                title={off ? 'Show' : 'Hide'}
              >
                <span className="dot" style={{ background: c.color }} />
                {c.name}
              </button>
            );
          })}
          <button
            className={hidden.has('unassigned') ? 'chip off' : 'chip'}
            onClick={() => toggleFilter('unassigned')}
          >
            <span className="dot" style={{ background: '#6366f1' }} />
            Other
          </button>
        </div>
      )}

      <main className="calendar-wrap">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={initialView}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listWeek',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'List' }}
          height="auto"
          selectable
          selectMirror
          editable
          eventStartEditable
          eventDurationEditable
          dayMaxEvents={3}
          moreLinkText={(n) => `+${n} more`}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'narrow' }}
          nowIndicator
          events={fetchEvents}
          eventClick={onEventClick}
          select={onDateSelect}
          eventChange={onEventChange}
        />
      </main>

      {showEventModal && (
        <EventModal
          children={childrenList}
          event={editing}
          initialStart={creatingAt ?? undefined}
          onClose={() => setShowEventModal(false)}
          onSaved={onSaved}
        />
      )}

      {showManage && (
        <ManageModal
          onClose={() => setShowManage(false)}
          onChanged={() => {
            loadChildren();
            refetch();
          }}
        />
      )}

      {detail && (
        <DetailModal
          event={detail}
          children={childrenList}
          onClose={() => setDetail(null)}
          onChanged={refetch}
        />
      )}
    </div>
  );
}

function formatWhen(event: CalendarEvent): string {
  const start = new Date(event.start);
  if (event.allDay) {
    return start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  let out = start.toLocaleString(undefined, opts);
  if (event.end) {
    const end = new Date(event.end);
    out += ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return out;
}

function DetailModal({
  event,
  children,
  onClose,
  onChanged,
}: {
  event: CalendarEvent;
  children: Child[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const p = event.extendedProps;
  const [assignedChildId, setAssignedChildId] = useState<number | null>(p.childId);
  const [saving, setSaving] = useState(false);
  const canAssign = p.source === 'feed' && p.feedId != null && p.uid != null;

  async function assign(childId: number | null) {
    setAssignedChildId(childId);
    setSaving(true);
    try {
      await api.put(`/feeds/${p.feedId}/assign`, { uid: p.uid, childId });
      onChanged(); // recolor / refilter the calendar behind the modal
    } catch {
      setAssignedChildId(p.childId); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail-head">
          <span className="dot big" style={{ background: event.color }} />
          <h2>{event.title}</h2>
        </div>
        <p className="detail-when">{formatWhen(event)}</p>
        {p.location && (
          <p>
            <strong>Where:</strong> {p.location}
          </p>
        )}
        {p.notes && <p className="detail-notes">{p.notes}</p>}

        {canAssign ? (
          <label>
            Who is it for?
            <select
              value={assignedChildId ?? ''}
              disabled={saving}
              onChange={(e) => assign(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— No one —</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="hint">
              Colors and filters this imported event. For a repeating event, it applies to the whole series.
            </span>
          </label>
        ) : (
          p.childName && (
            <p>
              <strong>For:</strong> {p.childName}
            </p>
          )
        )}

        {p.feedLabel && <p className="muted small">From “{p.feedLabel}” (imported — details are read-only)</p>}

        {!event.allDay && <ReminderPicker seriesKey={p.seriesKey} />}

        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
