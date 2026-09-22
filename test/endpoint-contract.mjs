/* Contract test for the endpoint this site's forms depend on.
 *
 *   node test/endpoint-contract.mjs
 *   exit 0 = the form can submit;  exit 1 = the form is dead, go and look
 *
 * WHY THIS EXISTS
 * ---------------
 * The public application forms save by POSTing cross-origin to the main app's
 * write proxy. That proxy lives in a different repo, on a different site, and
 * is repeatedly re-hardened for the authenticated app. This site is its only
 * anonymous caller, and has been broken by that hardening three times:
 *
 *   2026-06-03  anon insert policy dropped by the RLS lockdown   -> 42501
 *   2026-07-15  proxy had no CORS, so the preflight was refused  -> "Failed to fetch"
 *   2026-07-30  notifier's mail key went stale                   -> saved, nobody told
 *
 * The 2026-07-15 outage is the important lesson, and it is the reason this
 * file tests what it tests. Every diagnosis at the time was done with curl,
 * and curl reported a perfectly healthy 201. curl does not enforce CORS: it
 * sends no preflight and ignores the response headers a browser requires. So
 * the endpoint was "verified working" while it was refusing every real
 * applicant in every real browser.
 *
 * This test therefore asserts the BROWSER contract — the preflight and the
 * response headers — not merely that the server is up.
 *
 * It creates no data: it deliberately names a table that is not on the
 * proxy's allowlist, so a healthy proxy rejects the write on its own terms.
 * Reaching that rejection, with CORS headers attached, is the proof that a
 * real browser's request would have gone through.
 */

const ORIGIN   = process.env.GL_ORIGIN   || 'https://partners.golucky.co.za';
const ENDPOINT = process.env.GL_ENDPOINT || 'https://orders.golucky.co.za/.netlify/functions/api-write';

let failures = 0;
const pass = (m) => console.log('  ok   ' + m);
const fail = (m, d) => { failures++; console.log('  FAIL ' + m + (d ? '\n       ' + d : '')); };

console.log('\napi-write browser contract\n  origin:   ' + ORIGIN + '\n  endpoint: ' + ENDPOINT + '\n');

/* ── 1. The preflight ──────────────────────────────────────────────────────
 * A browser sends this before any cross-origin POST carrying a JSON
 * Content-Type. If it does not succeed with the right headers, the real POST
 * is never sent and the form reports "Failed to fetch". This is the exact
 * check that was missing in July. */
let pre;
try {
  pre = await fetch(ENDPOINT, {
    method: 'OPTIONS',
    headers: {
      'Origin': ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
} catch (e) {
  fail('preflight could not be sent', e.message);
}

if (pre) {
  if (pre.status === 200 || pre.status === 204) pass('preflight answers ' + pre.status);
  else fail('preflight answers ' + pre.status + ' — a browser will refuse to send the POST',
            pre.status === 405 ? 'This is the 2026-07-15 failure exactly: no OPTIONS handler.' : '');

  const acao = pre.headers.get('access-control-allow-origin');
  if (acao === ORIGIN || acao === '*') pass('preflight allows this origin (' + acao + ')');
  else fail('preflight Access-Control-Allow-Origin is ' + (acao || 'absent'),
            'The origin allowlist in api-write.js no longer covers ' + ORIGIN + '.');

  const acah = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  if (acah.includes('content-type')) pass('preflight allows the Content-Type header');
  else fail('preflight Access-Control-Allow-Headers omits content-type (' + (acah || 'absent') + ')',
            'The browser strips the header and the JSON body arrives unparsed.');
}

/* ── 2. The real round trip ────────────────────────────────────────────────
 * Proves the POST itself is accepted from this origin and that CORS headers
 * are present on the ACTUAL response, not only on the preflight — the July
 * outage was missing them on every response. */
let res, text = '';
try {
  res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
    body: JSON.stringify({ table: '__contract_check__', op: 'insert', payload: {} })
  });
  text = await res.text();
} catch (e) {
  fail('POST could not be sent', e.message);
}

if (res) {
  const acao = res.headers.get('access-control-allow-origin');
  if (acao === ORIGIN || acao === '*') pass('POST response carries Access-Control-Allow-Origin');
  else fail('POST response has no Access-Control-Allow-Origin (' + (acao || 'absent') + ')',
            'The browser discards the response even when the server accepted the write.');

  if (res.status === 403 && /origin/i.test(text)) {
    fail('proxy rejects this origin outright (403)',
         'ALLOWED_ORIGIN_SUFFIXES in api-write.js must include ' + ORIGIN + '.');
  } else if (res.status >= 500) {
    fail('proxy returned ' + res.status, text.slice(0, 300));
  } else {
    pass('proxy reached and answered on its own terms (' + res.status + ')');
  }

  /* A healthy proxy refuses an unknown table. If it ACCEPTED one, the table
   * allowlist is not being enforced, which is its own problem. */
  if (res.status >= 200 && res.status < 300) {
    fail('proxy accepted a write to an unknown table',
         'The table allowlist is not being enforced. That is a security issue, not a form issue.');
  }
}

console.log('\n' + (failures
  ? failures + ' failure(s) — the public application form is very likely broken RIGHT NOW.\n'
  : 'Contract holds: a real browser on ' + ORIGIN + ' can submit.\n'));

process.exit(failures ? 1 : 0);
