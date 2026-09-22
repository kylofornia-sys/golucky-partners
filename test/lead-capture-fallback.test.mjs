/* Tests for js/lead-capture-fallback.js — the lead-capture safety net.
 *
 * Run: node test/lead-capture-fallback.test.mjs
 *
 * This net only ever runs when the primary save path is already broken, which
 * means it is the one piece of the form that is NEVER exercised in normal use.
 * Untested, it would rot silently and be discovered broken at exactly the
 * moment it was needed. Hence these tests.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const SRC = readFileSync(new URL('../js/lead-capture-fallback.js', import.meta.url), 'utf8');

/* Minimal DOM stand-ins: the module is deliberately dependency-free, so this
 * is all it touches. */
class FakeFormData {
  constructor(form) { this._e = Object.entries(form._fields || {}); }
  forEach(fn) { this._e.forEach(([k, v]) => fn(v, k)); }
}

function load({ fetchImpl }) {
  const w = {
    location: { pathname: '/apply.html' },
    navigator: { userAgent: 'test-agent' }
  };
  const sandbox = { window: w, fetch: fetchImpl, FormData: FakeFormData, Date, encodeURIComponent, Object, String };
  const fn = new Function('window', 'fetch', 'FormData', SRC + '\n;return window.GLLeadFallback;');
  return fn(w, fetchImpl, FakeFormData);
}

function parseBody(body) {
  return Object.fromEntries(body.split('&').map(p => p.split('=').map(decodeURIComponent)));
}

let sent = null;
const okFetch = async (url, init) => { sent = { url, init }; return { ok: true }; };

let passed = 0, failed = 0;
async function test(name, fn) {
  sent = null;
  try { await fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failed++; }
}

const SENSITIVE = {
  bank_account: '62012345678', bank_branch: '250655', bank_holder: 'K Fornia',
  bank_name: 'FNB', bank_type: 'cheque', director_id: '8001015009087',
  director_address: '2 Valley Rd, Hout Bay', trade_ref_1_name: 'Acme',
  trade_ref_1_contact: '0821234567', trade_ref_2_name: 'Beta',
  trade_ref_2_contact: '0829876543', id_document_url: 'https://x/id.pdf',
  registration_doc_url: 'https://x/reg.pdf', signature_image_url: 'https://x/sig.png',
  credit_limit_requested: '50000', vat_number: '4123456789', reg_number: '2019/123456/07'
};
const CONTACT = {
  business_name: 'Blaauwberg Meat', contact_name: 'Chantal Duncan',
  contact_mobile: '0821112222', contact_email: 'c@example.co.za',
  delivery_address: '1 Main Rd', selected_tier: 'tier_3', notes: 'urgent'
};

console.log('\nlead-capture-fallback\n');

await test('POSTs urlencoded to the site\'s own origin (no cross-origin preflight)', async () => {
  const F = load({ fetchImpl: okFetch });
  await F.capture(CONTACT, 'save_failed', 'boom');
  assert.equal(sent.url, '/', 'must post same-origin');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

await test('carries the contact fields needed to call the applicant back', async () => {
  const F = load({ fetchImpl: okFetch });
  await F.capture(CONTACT, 'save_failed', 'boom');
  const b = parseBody(sent.init.body);
  for (const [k, v] of Object.entries(CONTACT)) assert.equal(b[k], v, 'missing ' + k);
  assert.equal(b['form-name'], 'partner-application-fallback');
  assert.equal(b.failure_reason, 'save_failed');
  assert.equal(b.failure_detail, 'boom');
});

await test('NEVER carries bank, identity, document or third-party data', async () => {
  const F = load({ fetchImpl: okFetch });
  await F.capture({ ...CONTACT, ...SENSITIVE }, 'save_failed', 'boom');
  const b = parseBody(sent.init.body);
  for (const k of Object.keys(SENSITIVE)) {
    assert.ok(!(k in b), 'LEAKED field: ' + k);
  }
  for (const v of Object.values(SENSITIVE)) {
    assert.ok(!sent.init.body.includes(encodeURIComponent(v)), 'LEAKED value: ' + v);
  }
});

await test('captureFromForm enforces the same allowlist', async () => {
  const F = load({ fetchImpl: okFetch });
  await F.captureFromForm({ _fields: { ...CONTACT, ...SENSITIVE } }, 'save_failed', 'boom');
  const b = parseBody(sent.init.body);
  assert.equal(b.business_name, 'Blaauwberg Meat');
  for (const k of Object.keys(SENSITIVE)) assert.ok(!(k in b), 'LEAKED field: ' + k);
});

await test('reports failure (not success) when the network is down', async () => {
  const F = load({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await F.capture(CONTACT, 'save_failed', 'x'), false);
});

await test('reports failure on a non-2xx — a 500 is not a success', async () => {
  const F = load({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(await F.capture(CONTACT, 'save_failed', 'x'), false);
});

await test('reports success only on a 2xx', async () => {
  const F = load({ fetchImpl: okFetch });
  assert.equal(await F.capture(CONTACT, 'save_failed', 'x'), true);
});

await test('never throws, even on a malformed payload', async () => {
  const F = load({ fetchImpl: okFetch });
  assert.equal(await F.capture(null, 'save_failed', null), true);
  assert.equal(await F.captureFromForm({}, 'save_failed', undefined), true);
});

await test('truncates an oversized detail so one blob cannot sink the capture', async () => {
  const F = load({ fetchImpl: okFetch });
  await F.capture(CONTACT, 'save_failed', 'z'.repeat(5000));
  assert.ok(parseBody(sent.init.body).failure_detail.length <= 900);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
