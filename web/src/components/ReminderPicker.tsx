import { useEffect, useState } from 'react';
import { api } from '../api';

const OPTIONS = [
  { m: 10, label: '10 min' },
  { m: 30, label: '30 min' },
  { m: 60, label: '1 hour' },
];

/**
 * Per-user reminder choices for one event/series. Each person's selections are
 * their own; they fire as push notifications if that person has enabled them.
 */
export function ReminderPicker({ seriesKey }: { seriesKey: string }) {
  const [minutes, setMinutes] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ minutes: number[] }>(`/reminders?seriesKey=${encodeURIComponent(seriesKey)}`)
      .then((r) => active && setMinutes(r.minutes))
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [seriesKey]);

  async function toggle(m: number) {
    const next = minutes.includes(m) ? minutes.filter((x) => x !== m) : [...minutes, m].sort((a, b) => a - b);
    setMinutes(next);
    setSaving(true);
    try {
      await api.put('/reminders', { seriesKey, minutes: next });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reminder-picker">
      <span className="field-label">
        Remind me before {saving && <span className="hint">saving…</span>}
      </span>
      <div className="reminder-opts">
        {OPTIONS.map((o) => (
          <label key={o.m} className={minutes.includes(o.m) ? 'chip on' : 'chip'}>
            <input
              type="checkbox"
              checked={minutes.includes(o.m)}
              disabled={!loaded}
              onChange={() => toggle(o.m)}
            />
            {o.label}
          </label>
        ))}
      </div>
      <span className="hint">Your reminders only. Turn on notifications in ⚙ Manage → Notifications to receive them.</span>
    </div>
  );
}
