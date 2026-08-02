import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, DateSelectArg, EventInput } from '@fullcalendar/core';
import { useAuth } from '../auth';
import { api, type Child, type CalendarEvent } from '../api';
import { EventModal, type EditableEvent } from '../components/EventModal';
import { ManageModal } from '../components/ManageModal';

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

  const loadChildren = useCallback(() => {
    api.get<Child[]>('/children').then(setChildrenList).catch(() => {});
  }, []);

  useEffect(() => {
    loadChildren();
  }, [loadChildren]);

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
            editable: e.editable,
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
      const numericId = Number(arg.event.id.replace('local-', ''));
      setEditing({
        id: numericId,
        title: arg.event.title,
        childId: props.childId,
        startAt: arg.event.startStr,
        endAt: arg.event.endStr || null,
        allDay: arg.event.allDay,
        location: props.location,
        notes: props.notes,
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
          <span className="logo">📅</span>
          <h1>Family Calendar</h1>
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
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listWeek',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'List' }}
          height="auto"
          selectable
          selectMirror
          dayMaxEvents
          nowIndicator
          events={fetchEvents}
          eventClick={onEventClick}
          select={onDateSelect}
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

      {detail && <DetailModal event={detail} onClose={() => setDetail(null)} />}
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

function DetailModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const p = event.extendedProps;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail-head">
          <span className="dot big" style={{ background: event.color }} />
          <h2>{event.title}</h2>
        </div>
        <p className="detail-when">{formatWhen(event)}</p>
        {p.childName && (
          <p>
            <strong>For:</strong> {p.childName}
          </p>
        )}
        {p.location && (
          <p>
            <strong>Where:</strong> {p.location}
          </p>
        )}
        {p.notes && <p className="detail-notes">{p.notes}</p>}
        {p.feedLabel && <p className="muted small">From “{p.feedLabel}” (imported, read-only)</p>}
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
