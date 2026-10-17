// Simple Privacy Policy and Terms of Service pages. Google requires a privacy
// policy, terms, and home page on the authorized domain before an OAuth app can
// be published to production. Served at /privacy and /terms.

const SUPPORT_EMAIL = 'sarahjgabor@gmail.com';
const LAST_UPDATED = 'October 2026';

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — The Goose Nest</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    max-width:720px;margin:0 auto;padding:40px 20px;color:#0f172a;line-height:1.6}
  h1{font-size:24px} h2{font-size:18px;margin-top:28px} a{color:#4f46e5}
  .muted{color:#64748b;font-size:14px} .brand{font-size:20px;font-weight:700}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
</style></head><body>
<p class="brand">🪿 The Goose Nest</p>
<h1>${title}</h1>
<p class="muted">Last updated: ${LAST_UPDATED}</p>
${body}
<hr style="margin:32px 0;border:none;border-top:1px solid #e2e8f0">
<p class="muted">Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</body></html>`;
}

export const privacyHtml = page(
  'Privacy Policy',
  `
<p>The Goose Nest is a private, family-run shared calendar. This policy explains what
information it handles and how.</p>

<h2>Information we store</h2>
<ul>
  <li><strong>Account details</strong> — your name, email, and a securely hashed password, so you can sign in.</li>
  <li><strong>Calendar content</strong> — events you add, the children/people you set up, and the calendars you
      subscribe to, so the app can show them to your household.</li>
</ul>

<h2>Google account data</h2>
<p>If you connect your Google account, the app requests <strong>read-only</strong> access to your Google Calendars
(the <code>calendar.readonly</code> scope). It uses this solely to read your calendar events and display them to you
and the family members you have given accounts. The app does not modify your Google Calendar, and does not use this
data for advertising or sell it to anyone.</p>

<p>The Goose Nest's use and transfer of information received from Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API
Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>How information is used and shared</h2>
<p>Your information is used only to operate the calendar for your household. It is visible only to people you give an
account to. It is not sold, rented, or shared with third parties. The app sends email (weekly digests, alerts) and
push notifications only to the people with accounts, and only if those features are turned on.</p>

<h2>Storage and retention</h2>
<p>Data is stored in the app's own database on the server where the owner hosts it. You can remove your data by
deleting events, removing a subscribed calendar, disconnecting Google, or asking the account owner to remove your
account. Removing an account deletes that person's sign-in, reminders, and notification devices.</p>

<h2>Your choices</h2>
<p>You can disconnect Google at any time from the app's Manage screen, which removes the app's access and the
calendars added from it. You can revoke the app's access directly in your
<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google Account permissions</a>.</p>
`,
);

export const termsHtml = page(
  'Terms of Service',
  `
<p>The Goose Nest is a small, private calendar app provided for personal and family use.</p>

<h2>Use of the app</h2>
<p>You may use the app to organize and share your household's schedule with people you invite. Please use it lawfully
and don't attempt to disrupt it or access accounts that aren't yours.</p>

<h2>Accounts</h2>
<p>You're responsible for keeping your login secure. The account owner may add or remove members.</p>

<h2>No warranty</h2>
<p>The app is provided "as is," without warranties of any kind. It may be unavailable at times, and we don't guarantee
that imported calendars will always sync. Don't rely on it as the sole source for critical, time-sensitive events.</p>

<h2>Limitation of liability</h2>
<p>To the extent permitted by law, the app and its owner are not liable for any damages arising from use of, or
inability to use, the app.</p>

<h2>Changes</h2>
<p>These terms may be updated from time to time; continued use means you accept the current version.</p>
`,
);
