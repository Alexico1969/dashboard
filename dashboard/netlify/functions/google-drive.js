const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
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

function dGet(token, path) {
  return fetch(`${DRIVE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => {
    if (!r.ok) return r.text().then(t => { throw new Error(`Drive ${r.status}: ${t}`); });
    return r.json();
  });
}

function formatSize(bytes) {
  if (bytes == null) return null;
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b === 0) return null;
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  if (b >= 1024)         return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fileUrl(f) {
  if (f.webViewLink) return f.webViewLink;
  const mimeMap = {
    'application/vnd.google-apps.document':     `https://docs.google.com/document/d/${f.id}/edit`,
    'application/vnd.google-apps.spreadsheet':  `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
    'application/vnd.google-apps.presentation': `https://docs.google.com/presentation/d/${f.id}/edit`,
  };
  return mimeMap[f.mimeType] || `https://drive.google.com/file/d/${f.id}/view`;
}

function ownerLabel(f) {
  const owner = (f.owners || [])[0];
  if (!owner) return f.sharingUser?.emailAddress || '';
  return owner.emailAddress || owner.displayName || '';
}

function mimeLabel(mimeType) {
  const map = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.form':         'Google Form',
    'application/pdf':                          'PDF',
  };
  return map[mimeType] || '';
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
    const token  = await getAccessToken();
    const fields  = 'files(id,name,modifiedTime,size,quotaBytesUsed,mimeType,owners,sharingUser,webViewLink)';
    const gdocQ   = encodeURIComponent("mimeType='application/vnd.google-apps.document'");

    const [recentData, largeData] = await Promise.all([
      dGet(token, `/files?orderBy=modifiedTime+desc&pageSize=5&fields=${encodeURIComponent(fields)}`),
      dGet(token, `/files?orderBy=quotaBytesUsed+desc&pageSize=5&q=${gdocQ}&fields=${encodeURIComponent(fields)}`),
    ]);

    const fmt = f => ({
      id:           f.id,
      name:         f.name,
      mimeType:     f.mimeType,
      mimeLabel:    mimeLabel(f.mimeType),
      modifiedTime: formatDate(f.modifiedTime),
      size:         formatSize(f.size || f.quotaBytesUsed),
      owner:        ownerLabel(f),
      url:          fileUrl(f),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        recent:  (recentData.files || []).map(fmt),
        largest: (largeData.files  || []).map(fmt),
        fetched: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return jsonErr(500, e.message);
  }
};
