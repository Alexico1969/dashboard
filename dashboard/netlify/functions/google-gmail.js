const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL  = 'https://oauth2.googleapis.com/token';

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

function gGet(token, path) {
  return fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => {
    if (!r.ok) return r.text().then(t => { throw new Error(`Gmail ${r.status}: ${t}`); });
    return r.json();
  });
}

function getHeader(headers, name) {
  const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function friendlyFrom(from) {
  if (!from) return '';
  const m = from.match(/^"?([^"<]+)"?\s*</);
  if (m) return m[1].trim();
  return from.replace(/<[^>]+>/, '').trim() || from;
}

function formatTimestamp(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getLabelBadge(labelIds) {
  const map = {
    CATEGORY_UPDATES:    { name: 'Updates',  color: 'blue'   },
    CATEGORY_PROMOTIONS: { name: 'Promo',    color: 'orange' },
    CATEGORY_PERSONAL:   { name: 'Personal', color: 'green'  },
    CATEGORY_SOCIAL:     { name: 'Social',   color: 'purple' },
    CATEGORY_FORUMS:     { name: 'Forums',   color: 'teal'   },
    STARRED:             { name: 'Starred',  color: 'yellow' },
  };
  for (const id of (labelIds || [])) {
    if (map[id]) return map[id];
  }
  return null;
}

function sumAttachmentSize(payload) {
  let size = 0;
  function walk(parts) {
    if (!parts) return;
    for (const p of parts) {
      if (p.filename && p.body?.size) size += p.body.size;
      if (p.parts) walk(p.parts);
    }
  }
  walk(payload?.parts);
  return size;
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

    const [profile, labelsData, inboxLabel, inboxList, attachList, draftsData] = await Promise.all([
      gGet(token, '/profile'),
      gGet(token, '/labels'),
      gGet(token, '/labels/INBOX'),
      gGet(token, '/messages?labelIds=INBOX&maxResults=5'),
      gGet(token, '/messages?q=has%3Aattachment%20larger%3A5m&maxResults=8'),
      gGet(token, '/drafts?maxResults=8'),
    ]);

    const userLabelCount = (labelsData.labels || []).filter(l => l.type === 'user').length;
    const inboxIds   = (inboxList.messages  || []).map(m => m.id);
    const attachIds  = (attachList.messages || []).map(m => m.id);
    const draftIds   = (draftsData.drafts   || []).map(d => d.id).slice(0, 6);

    const [inboxMessages, attachMessages, draftMessages] = await Promise.all([
      Promise.all(inboxIds.map(id  => gGet(token, `/messages/${id}?format=metadata&metadataHeaders=From,Subject,Date`))),
      Promise.all(attachIds.map(id => gGet(token, `/messages/${id}?format=full`))),
      Promise.all(draftIds.map(id  => gGet(token, `/drafts/${id}?format=metadata&metadataHeaders=Subject,To,Date`))),
    ]);

    const inbox = inboxMessages.map(m => {
      const h = m.payload?.headers || [];
      return {
        id:      m.id,
        threadId: m.threadId,
        subject: getHeader(h, 'Subject') || '(no subject)',
        from:    friendlyFrom(getHeader(h, 'From')),
        date:    formatTimestamp(getHeader(h, 'Date')),
        unread:  (m.labelIds || []).includes('UNREAD'),
        badge:   getLabelBadge(m.labelIds),
      };
    });

    const attachments = attachMessages
      .map(m => {
        const h = m.payload?.headers || [];
        const attachmentSize = sumAttachmentSize(m.payload);
        const inSent = (m.labelIds || []).includes('SENT');
        return {
          id:             m.id,
          threadId:       m.threadId,
          subject:        getHeader(h, 'Subject') || '(no subject)',
          from:           inSent
                            ? 'To: ' + friendlyFrom(getHeader(h, 'To'))
                            : friendlyFrom(getHeader(h, 'From')),
          date:           formatTimestamp(getHeader(h, 'Date')),
          attachmentSize,
          folder:         inSent ? 'sent' : 'inbox',
        };
      })
      .filter(a => a.attachmentSize > 0)
      .sort((a, b) => b.attachmentSize - a.attachmentSize)
      .slice(0, 5);

    const drafts = draftMessages.map(d => {
      const msg = d.message || d;
      const h   = msg.payload?.headers || [];
      return {
        draftId:  d.id,
        threadId: msg.threadId || '',
        subject:  getHeader(h, 'Subject') || '(no subject)',
        to:       getHeader(h, 'To'),
        date:     formatTimestamp(getHeader(h, 'Date')),
        size:     msg.sizeEstimate || 0,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        stats: {
          messagesTotal:  profile.messagesTotal,
          threadsTotal:   profile.threadsTotal,
          inboxCount:     inboxLabel.messagesTotal || 0,
          userLabelCount,
        },
        inbox,
        attachments,
        drafts,
        fetched: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return jsonErr(500, e.message);
  }
};
