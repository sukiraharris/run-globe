#!/usr/bin/env node
// One-time helper: turns your Strava API app into a refresh token.
//
//   1. node scripts/get-token.mjs <CLIENT_ID>
//      → open the printed link, click Authorize. The browser lands on a
//        "localhost" page that won't load — that's expected. Copy the
//        `code=...` value from its address bar.
//   2. node scripts/get-token.mjs <CLIENT_ID> <CLIENT_SECRET> <CODE>
//      → prints your refresh token. Save it as a GitHub secret.

const [clientId, clientSecret, code] = process.argv.slice(2);

if (!clientId) {
  console.log('Usage: node scripts/get-token.mjs <CLIENT_ID> [<CLIENT_SECRET> <CODE>]');
  process.exit(1);
}

if (!code) {
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: 'http://localhost/exchange_token',
    approval_prompt: 'force',
    scope: 'activity:read_all',
  });
  console.log('Open this link, click Authorize, then copy the code= value from the address bar:\n');
  console.log(url.toString());
  process.exit(0);
}

const res = await fetch('https://www.strava.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
});
const body = await res.json();
if (!res.ok) {
  console.error('Token exchange failed:', body);
  process.exit(1);
}
console.log(`\nAuthorized as ${body.athlete?.firstname ?? 'you'}.`);
console.log(`Refresh token: ${body.refresh_token}`);
console.log('\nAdd it to GitHub: repo → Settings → Secrets and variables → Actions → New secret STRAVA_REFRESH_TOKEN');
