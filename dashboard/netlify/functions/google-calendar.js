const CAL_BASE  = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange failed: ' + (data.error_description || data.error || JSON.stringify(data)));
  return data.access_token;
}

function cGet(token, path) {
  return fetch(`${CAL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => {
    if (!r.ok) return r.text().then(t => { throw new Error(`Calendar ${r.status}: ${t}`); });
    return r.json();
  });
}

function jsonErr(status, message) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

export const handler = async () => {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].filter(k => !process.env[k]);
  if (missing.length) return jsonErr(500, `Missing env vars: ${missing.join(', ')}`);

  try {
    const token = await getAccessToken();
    const calListData = await cGet(token, '/users/me/calendarList?maxResults=50');
    const calendars = calListData.items || [];

    const now             = new Date();
    const twoWeeksLater   = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const timeMin         = encodeURIComponent(now.toISOString());
    const timeMax         = encodeURIComponent(twoWeeksLater.toISOString());

    // Fetch events from all selected calendars in parallel
    const activeCals = calendars.filter(c =>
      c.selected !== false &&
      c.accessRole !== 'freeBusyReader'
    ).slice(0, 15);

    const eventArrays = await Promise.all(
      activeCals.map(cal => {
        const calId = encodeURIComponent(cal.id);
        return cGet(token, `/calendars/${calId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=10`)
          .then(d => d.items || [])
          .catch(() => []);
      })
    );

    // Merge, deduplicate by event id, sort by start time
    const seen = new Set();
    let allEvents = eventArrays.flat().filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    allEvents.sort((a, b) => {
      const aStart = a.start?.dateTime || a.start?.date || '';
      const bStart = b.start?.dateTime || b.start?.date || '';
      return aStart.localeCompare(bStart);
    });

    const events = allEvents.slice(0, 10).map(e => {
      const startStr = e.start?.dateTime || e.start?.date || '';
      const endStr   = e.end?.dateTime   || e.end?.date   || '';
      const allDay   = !e.start?.dateTime;

      let day, mon, timeStr;
      if (allDay) {
        // date-only strings like "2026-04-06" — parse as local date
        const [y, mo, d] = startStr.split('-').map(Number);
        const dt = new Date(y, mo - 1, d);
        day    = dt.getDate();
        mon    = dt.toLocaleString('en-US', { month: 'short' });
        timeStr = 'All day';
      } else {
        const dStart = new Date(startStr);
        const dEnd   = new Date(endStr);
        day    = dStart.getDate();
        mon    = dStart.toLocaleString('en-US', { month: 'short' });
        const s = dStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const f = dEnd.toLocaleTimeString('en-US',   { hour: '2-digit', minute: '2-digit', hour12: false });
        timeStr = `${s} – ${f}`;
      }

      const location  = e.location || '';
      const timeLabel = [timeStr, location].filter(Boolean).join(' · ');

      return {
        id:        e.id,
        htmlLink:  e.htmlLink || '',
        title:     e.summary || '(No title)',
        day,
        mon,
        time:      timeLabel,
        recurring: !!e.recurringEventId,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        calendarCount:  calendars.length,
        upcomingCount:  events.length,
        events,
        calendarNames:  calendars.map(c => ({ name: c.summary || c.id, primary: c.primary || false })),
        fetched:        new Date().toISOString(),
      }),
    };
  } catch (e) {
    return jsonErr(500, e.message);
  }
};
