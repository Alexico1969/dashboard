/**
 * get-refresh-token.mjs
 *
 * One-time script to generate a Google OAuth2 refresh token.
 * Run: node get-refresh-token.mjs
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or use an existing one)
 *   3. Enable these APIs:
 *        - Gmail API
 *        - Google Calendar API
 *        - Google Drive API
 *   4. Go to APIs & Services → Credentials → Create Credentials → OAuth client ID
 *        - Application type: Web application
 *        - Add Authorized redirect URI: http://localhost:3000/callback
 *   5. Copy your Client ID and Client Secret into the prompts below
 */

import http    from 'http';
import { URL } from 'url';
import { exec } from 'child_process';
import readline from 'readline';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

// ── Prompt helper ─────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Open browser cross-platform ───────────────────────────
function openBrowser(url) {
  const cmd =
    process.platform === 'win32'  ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log('\nCould not open browser automatically. Open this URL manually:\n' + url); });
}

// ── Main ──────────────────────────────────────────────────
const PORT         = 4242;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const clientId     = await prompt('Paste your Client ID:     ');
const clientSecret = await prompt('Paste your Client Secret: ');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id',     clientId);
authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope',         SCOPES);
authUrl.searchParams.set('access_type',   'offline');
authUrl.searchParams.set('prompt',        'consent');

console.log('\nOpening Google sign-in in your browser…');
openBrowser(authUrl.toString());

// ── Local callback server ──────────────────────────────────
const code = await new Promise((resolve, reject) => {
  let settled = false;

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);

    // Ignore favicon and any other stray requests
    if (parsed.pathname !== '/callback') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only handle the first callback (browser sometimes sends duplicates)
    if (settled) { res.writeHead(204); res.end(); return; }
    settled = true;

    const code  = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (error) {
      res.end(`<h2 style="font-family:sans-serif;color:red">Error: ${error}</h2><p>You can close this tab.</p>`);
      // Defer close so the response is fully sent before we tear down the server
      setImmediate(() => { server.close(); reject(new Error('OAuth error: ' + error)); });
    } else {
      res.end(`<h2 style="font-family:sans-serif;color:green">✓ Authorized!</h2><p>You can close this tab and return to the terminal.</p>`);
      setImmediate(() => { server.close(); resolve(code); });
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for Google callback on ${REDIRECT_URI} …`);
  });

  server.on('error', reject);
});

// ── Exchange code for tokens ───────────────────────────────
console.log('\nExchanging authorization code for tokens…');

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  }).toString(),
});

const tokens = await tokenRes.json();

if (tokens.error) {
  console.error('\nToken exchange failed:', tokens.error_description || tokens.error);
  process.exit(1);
}

// ── Print results ──────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log('SUCCESS! Add these to Netlify → Environment Variables:\n');
console.log(`GOOGLE_CLIENT_ID      = ${clientId}`);
console.log(`GOOGLE_CLIENT_SECRET  = ${clientSecret}`);
console.log(`GOOGLE_REFRESH_TOKEN  = ${tokens.refresh_token}`);
console.log('\n' + '─'.repeat(60));

if (!tokens.refresh_token) {
  console.warn('\n⚠️  No refresh_token returned. This can happen if you already');
  console.warn('   authorized this app before. To force a new one:');
  console.warn('   → Go to https://myaccount.google.com/permissions');
  console.warn('   → Revoke access for your app, then run this script again.');
}
