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
 * Two probes, because one is not enough to tell health from failure.
 *
 * (a) An UNKNOWN table. A healthy proxy refuses it, which proves the table
 *     allowlist is still being enforced.
 *
 * (b) The REAL table, carrying a column that does not exist. This is the
 *     important one. It travels the entire chain a genuine submission
 *     travels — origin gate, table allowlist, whatever authentication is in
 *     force, the service-role forward — and is turned away only at the far
 *     end by PostgREST, which cannot build a row from an unknown column. No
 *     row is created. Reaching THAT specific rejection is the proof that a
 *     real applicant's submission would have been written.
 *
 * Probe (b) exists because (a) alone is ambiguous: a 403 on an unknown table
 * looks identical to a 403 from an authentication layer that has just been
 * switched on and now rejects this form, which is anonymous by design and
 * always will be. Those two are the difference between "fine" and "every
 * applicant is being turned away", so they must not be conflated.
 */
const PROBE_COLUMN = '__gl_contract_probe__';

async function probe(label, body) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
      body: JSON.stringify(body)
    });
    const t = await r.text();
    return { status: r.status, text: t, acao: r.headers.get('access-control-allow-origin') };
  } catch (e) {
    fail(label + ': request could not be sent', e.message);
    return null;
  }
}

const unknown = await probe('unknown-table probe',
  { table: '__contract_check__', op: 'insert', payload: {} });

if (unknown) {
  if (unknown.acao === ORIGIN || unknown.acao === '*') {
    pass('POST response carries Access-Control-Allow-Origin');
  } else {
    fail('POST response has no Access-Control-Allow-Origin (' + (unknown.acao || 'absent') + ')',
         'The browser discards the response even when the server accepted the write.');
  }

  if (unknown.status >= 200 && unknown.status < 300) {
    fail('proxy accepted a write to an unknown table',
         'The table allowlist is not being enforced. A security issue, not a form issue.');
  } else {
    pass('unknown table is refused (' + unknown.status + ')');
  }
}

const real = await probe('real-table probe',
  { table: 'partner_applications', op: 'insert', payload: { [PROBE_COLUMN]: 1 } });

if (real) {
  const body = (real.text || '').toLowerCase();
  const looksLikeAuth =
    /origin/.test(body) || /session/.test(body) || /unauthor/.test(body) ||
    /forbidden/.test(body) || /not allowed/.test(body) || /jwt/.test(body) ||
    /api key/.test(body) || /permission/.test(body) || /42501/.test(body) ||
    /row-level security/.test(body);

  if (real.status === 403 || real.status === 401) {
    fail('the form\'s own table is refused with ' + real.status + ' — APPLICANTS ARE BEING TURNED AWAY',
         'Body: ' + real.text.slice(0, 300) + '\n       ' +
         'This site submits anonymously and always will. Check api-write.js for\n       ' +
         'an origin gate or a session/auth requirement that no longer exempts it.');
  } else if (looksLikeAuth) {
    fail('the form\'s own table returned ' + real.status + ' with an authorisation-shaped error',
         'Body: ' + real.text.slice(0, 300));
  } else if (real.status >= 500) {
    fail('proxy returned ' + real.status + ' for the real table', real.text.slice(0, 300));
  } else if (real.status >= 200 && real.status < 300) {
    fail('an unknown column was ACCEPTED — a junk row may have been created',
         'Check partner_applications for a row containing ' + PROBE_COLUMN + '.');
  } else {
    pass('a real submission reaches the database (rejected at PostgREST, ' +
         real.status + ', as intended — no row written)');
  }

  /* Always show what came back: when this test fails at 03:00 the body is the
   * single most useful thing in the log. */
  console.log('\n  probe detail — unknown table: ' + unknown?.status + ' ' +
              JSON.stringify((unknown?.text || '').slice(0, 160)));
  console.log('  probe detail — real table:    ' + real.status + ' ' +
              JSON.stringify(real.text.slice(0, 160)));
}

console.log('\n' + (failures
  ? failures + ' failure(s) — the public application form is very likely broken RIGHT NOW.\n'
  : 'Contract holds: a real browser on ' + ORIGIN + ' can submit.\n'));

process.exit(failures ? 1 : 0);
