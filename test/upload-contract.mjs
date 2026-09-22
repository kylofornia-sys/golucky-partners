/* Contract test for the DOCUMENT UPLOAD step of the application form.
 *
 *   node test/upload-contract.mjs
 *   exit 0 = applicants can attach their documents;  exit 1 = they cannot
 *
 * WHY THIS EXISTS
 * ---------------
 * A submission has two independent halves, and only one of them was being
 * watched:
 *
 *   1. the documents  -> Supabase Storage, with the ANON key, governed by
 *                        storage RLS
 *   2. the application -> the orders-site write proxy, governed by that site's
 *                        origin allowlist, CORS and table allowlist
 *
 * Half 2 is covered by endpoint-contract.mjs. Half 1 was not covered by
 * anything, and it is the half that runs FIRST: the form uploads the ID,
 * registration and signature before it saves a single field. If an upload
 * throws, the applicant gets the same unhelpful "something went wrong" and
 * the application is never even attempted.
 *
 * The risk is not hypothetical. The `partner-documents` bucket was switched
 * from public to private on 2026-08-25. That flip governs anonymous READ, and
 * uploads were verified working immediately afterwards — but anonymous INSERT
 * is a separate storage RLS policy on the same bucket, and it is exactly the
 * kind of thing a later hardening pass tightens without anyone thinking about
 * the public form.
 *
 * The probe deliberately uses the SAME credentials and the SAME request shape
 * as the form, read straight out of index.html so the two cannot drift apart.
 * The anon key is public by design and already ships in that page.
 *
 * It writes one ~20-byte file to a fixed path with x-upsert, so it overwrites
 * itself on every run and never accumulates. No applicant data is involved.
 */
import { readFileSync } from 'node:fs';

const PROBE_PATH = '__healthcheck__/probe.txt';

/* Read the form's own constants, so this tests what the form actually does
 * rather than what it did when this file was written. */
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pick = (name) => {
  const m = page.match(new RegExp('const\\s+' + name + '\\s*=\\s*"([^"]+)"'));
  if (!m) { console.log('  FAIL could not read ' + name + ' from index.html'); process.exit(1); }
  return m[1];
};
const SUPABASE_URL   = pick('SUPABASE_URL');
const SUPABASE_KEY   = pick('SUPABASE_KEY');
const STORAGE_BUCKET = pick('STORAGE_BUCKET');
const ORIGIN         = process.env.GL_ORIGIN || 'https://partners.golucky.co.za';

let failures = 0;
const pass = (m) => console.log('  ok   ' + m);
const fail = (m, d) => { failures++; console.log('  FAIL ' + m + (d ? '\n       ' + d : '')); };

const target = SUPABASE_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + PROBE_PATH;
console.log('\ndocument upload contract\n  bucket:   ' + STORAGE_BUCKET + '\n  origin:   ' + ORIGIN + '\n');

/* ── 1. Preflight ─────────────────────────────────────────────────────────
 * The form sends apikey, authorization and x-upsert, so a browser preflights
 * this upload before it happens. */
try {
  const pre = await fetch(target, {
    method: 'OPTIONS',
    headers: {
      'Origin': ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'apikey, authorization, content-type, x-upsert'
    }
  });
  if (pre.status === 200 || pre.status === 204) pass('upload preflight answers ' + pre.status);
  else fail('upload preflight answers ' + pre.status + ' — the browser will not send the upload');

  const acao = pre.headers.get('access-control-allow-origin');
  if (acao) pass('upload preflight allows this origin (' + acao + ')');
  else fail('upload preflight has no Access-Control-Allow-Origin');
} catch (e) {
  fail('upload preflight could not be sent', e.message);
}

/* ── 2. The upload itself ─────────────────────────────────────────────────
 * Byte-for-byte the request uploadFile() makes in the form. */
let res, text = '';
try {
  res = await fetch(target, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'text/plain',
      'x-upsert': 'true',
      'Origin': ORIGIN
    },
    body: 'health probe ' + new Date().toISOString()
  });
  text = await res.text();
} catch (e) {
  fail('upload could not be sent', e.message);
}

if (res) {
  const body = (text || '').toLowerCase();
  if (res.status >= 200 && res.status < 300) {
    pass('an applicant can upload their documents (' + res.status + ')');
  } else if (res.status === 403 || res.status === 401 || /row-level security|policy|unauthor|42501/.test(body)) {
    fail('ANONYMOUS UPLOAD IS BLOCKED (' + res.status + ') — applicants cannot attach documents',
         'Body: ' + text.slice(0, 300) + '\n       ' +
         'The form uploads ID, registration and signature BEFORE it saves anything,\n       ' +
         'so this kills the whole submission. Check the storage RLS INSERT policy on\n       ' +
         'the ' + STORAGE_BUCKET + ' bucket — it must still permit the anon role.');
  } else {
    fail('upload returned ' + res.status, 'Body: ' + text.slice(0, 300));
  }
  console.log('\n  probe detail — upload: ' + res.status + ' ' + JSON.stringify(text.slice(0, 160)));
}

console.log('\n' + (failures
  ? failures + ' failure(s) — applicants very likely CANNOT complete the form.\n'
  : 'Upload contract holds.\n'));

process.exit(failures ? 1 : 0);
