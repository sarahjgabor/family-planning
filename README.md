# 🪿 The Goose Nest

A shared family calendar for your household — your nanny, parents, and husband — that does
the two things Google Calendar won't:

1. **Merges several Google Calendars into one view.** Subscribe to each calendar using its
   secret iCal link and every event shows up together, color-coded by child.
2. **Lets everyone add events.** Signed-in family members can add, edit, and delete shared
   events right in the app — including **weekly repeating events** (e.g. soccer every Monday
   until the season ends) and **drag-to-reschedule**.
3. **Emails a weekly digest.** Every Sunday morning everyone with an account gets an email
   summarizing the upcoming week, notes and all.

Built with TypeScript + React so it can grow into a real iOS/Android app later (see
[Growing into a native app](#growing-into-a-native-app)).

---

## What it looks like

- A month / week / list calendar everyone can open on their phone or computer.
- Each child gets a color; tap a name to hide or show just their events.
- **+ Add event** for anything you enter by hand. Turn on **Repeat weekly** to make it recur
  until a date you choose. When you open one occurrence of a repeating event, you can apply
  a change (or a delete) to **just that one**, **this and all following**, or **the whole
  series** — so a one-week cancellation or a mid-season change is easy.
- **Drag an event** to a new day or time, or drag its edge to change how long it lasts — it
  saves automatically. (Repeating events and imported Google events aren't draggable; edit a
  repeating series from its form.)
- **⚙ Manage** to add people, subscribe to Google Calendars, and set up the weekly email.
- Imported (Google) events are read-only; events you add here are fully editable.

---

## Quick start (run it on your own computer)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
# 1. Install everything
npm install

# 2. Create your settings file
cp .env.example .env
#    then open .env and set JWT_SECRET to a long random value:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start it in development (auto-reloads as you edit)
npm run dev
```

Then open **http://localhost:5173**. Create an account and you're in.

To run it the way it runs in production (one server, no dev tools):

```bash
npm run build
npm start          # serves the whole app at http://localhost:4000
```

---

## Deploy it so your family can use it

The app is one service (an API server that also serves the website), with a small SQLite
database file. Any host that gives you a **persistent disk** works. The easiest is **Render**:

1. Push this repo to GitHub (your branch is already set up).
2. Go to [render.com](https://render.com) → **New → Blueprint** → connect this repo.
   Render reads [`render.yaml`](./render.yaml) and sets everything up, including a strong
   `JWT_SECRET` and a 1 GB disk for the database.
3. When it's live you'll get a URL like `https://family-calendar.onrender.com`. Share that
   with your family — everyone creates their own account.

> **Tip:** To keep strangers from signing up, set an `INVITE_CODE` in the Render dashboard.
> Then only people who know the code can create an account. Share the code with your nanny,
> parents, and husband.

Other good hosts: **Railway** and **Fly.io** (use the included [`Dockerfile`](./Dockerfile)).
Any of them just needs a mounted volume so the database survives restarts.

### Environment settings

| Variable | What it does |
| --- | --- |
| `JWT_SECRET` | Signs login sessions. **Must** be a long random string in production. |
| `DATABASE_PATH` | Where the SQLite file lives. Point it at your mounted disk (e.g. `/data/family.sqlite`). |
| `INVITE_CODE` | Optional. If set, new accounts require this code. |
| `FEED_REFRESH_MINUTES` | How often subscribed Google Calendars re-sync (default 30). |
| `PORT` | Port to listen on (most hosts set this for you). |
| `TIMEZONE` | Your timezone (e.g. `America/New_York`), for scheduling/formatting the digest. |
| `APP_URL` | Public URL of your app, used for the button in the digest email. |
| `DIGEST_CRON` | When to send the digest (cron format). Default `0 7 * * 0` = Sunday 7 AM. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | Mail server for the weekly digest. Leave `SMTP_HOST` unset to turn email off. |

---

## Setting up the weekly email digest

Every Sunday morning, everyone with an account gets an email listing the upcoming week's
events — with each event's notes and location included. It's **off until you add a mail
server**, so the app runs fine without it.

The easiest option is a Gmail account with an **app password**:

1. On the Google account you'll send from, turn on **2-Step Verification**
   (Google Account → Security).
2. Then go to **Security → App passwords**, create one for "Mail", and copy the 16-character
   code.
3. Set these where the app is hosted (e.g. Render → Environment):

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=you@gmail.com
   SMTP_PASS=your-16-char-app-password
   SMTP_FROM=The Goose Nest <you@gmail.com>
   TIMEZONE=America/New_York
   APP_URL=https://your-app.onrender.com
   ```

4. Restart the app. In **⚙ Manage → Email digest** you can **Preview this week** and
   **Send a test now** to confirm it works before Sunday.

> Prefer not to use Gmail? Any SMTP provider works — services like Resend, SendGrid,
> Mailgun, or Postmark give you the same `SMTP_*` values.

---

## How to subscribe to a Google Calendar

This is the key to getting all your scattered calendars in one place.

1. Open **Google Calendar** on a computer.
2. In the left sidebar, hover the calendar you want → click **⋮ → Settings and sharing**.
3. Scroll to **Integrate calendar**.
4. Copy the **Secret address in iCal format** (it ends in `/basic.ics`).
5. In this app: **⚙ Manage → Subscribed calendars**, give it a name, paste the URL, pick a
   color (or assign it to a child), and **Subscribe**.

Repeat for each calendar. They'll all appear together, refreshing automatically.

> The **secret** address works even for calendars you can only view, which is why this
> succeeds where "sharing" in Google Calendar falls short. Treat that link like a password —
> anyone who has it can see that calendar's events.

---

## Growing into a native app

Everything here is TypeScript, and the web UI is React — the direct on-ramp to
**React Native / Expo**, which builds real iOS and Android apps.

When you're ready:

- The **server** (`server/`) stays exactly as-is — the phone app talks to the same API.
- [`web/src/api.ts`](./web/src/api.ts) — the file that talks to the server — moves over almost
  unchanged (swap `localStorage` for React Native's `AsyncStorage`).
- Your data models, auth, and app logic all carry over. Only the calendar **view** gets
  rebuilt with native components (e.g. `react-native-calendars`).

So nothing you build now is throwaway.

---

## Project layout

```
family-planning/
├─ server/      Express + SQLite API (auth, events, calendar feeds, email digest)
│  └─ src/
│     ├─ routes/        auth, children, events, feeds, calendar, digest
│     ├─ events/query.ts  merges local + feed events, expands weekly series
│     ├─ feeds/sync.ts    fetches & parses Google iCal feeds (incl. recurring events)
│     └─ digest/          builds & schedules the Sunday-morning email
├─ web/         React + Vite calendar app (FullCalendar)
│  └─ src/
│     ├─ pages/         Login, Signup, CalendarPage
│     └─ components/    EventModal, ManageModal
├─ Dockerfile   Container build for Railway/Fly/etc.
└─ render.yaml  One-click Render blueprint
```

## Tech notes

- **Storage:** SQLite (a single file) — no separate database to run or pay for.
- **Auth:** email + password, hashed with bcrypt, sessions via signed JWT.
- **Feeds:** parsed with `node-ical`; recurring events (e.g. weekly practice) are expanded
  into individual occurrences, and cancellations/edits to single occurrences are respected.
- **Recurrence:** locally-added weekly events are stored once and expanded on read, so a
  season of practices is a single row. Single-date changes are kept as lightweight
  "overrides" (a cancelled date or a modified one), and "this and following" edits split the
  series into two — the same model calendar apps use.
- **Email:** sent with `nodemailer` over SMTP; scheduled with `node-cron` in your timezone.
  Recipients are BCC'd so family email addresses stay private from each other.
