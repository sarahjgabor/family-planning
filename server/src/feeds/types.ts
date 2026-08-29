/** A single calendar event parsed from a feed (iCal or Google API), ready to
 * be cached in feed_events. */
export interface ParsedEvent {
  uid: string;
  // The base UID shared by every occurrence of a series (equal to uid for
  // non-recurring events). Per-event child assignments are keyed on this.
  seriesUid: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
}
