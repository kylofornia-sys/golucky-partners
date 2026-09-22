/* ─────────────────────────────────────────────────────────────────────────────
 * Go Lucky — lead capture fallback
 *
 * WHY THIS EXISTS
 * ---------------
 * Every public application form on this site (index / apply / boutique) saves
 * by POSTing cross-origin to
 *     https://orders.golucky.co.za/.netlify/functions/api-write
 * That endpoint belongs to the main app, and it sits behind the main app's
 * security perimeter: an RLS policy set, a table allowlist, an Origin
 * allowlist, a CORS layer, and (in progress) signed-session enforcement.
 *
 * This form is the ONLY anonymous caller of that endpoint. Every time that
 * perimeter is tightened for the authenticated app, this caller is the one
 * that gets forgotten, and the form dies for every applicant:
 *
 *   2026-06-03  RLS lockdown dropped the anon insert policy      -> 42501
 *   2026-07-15  proxy had no CORS, so the browser preflight died -> "Failed to fetch"
 *   2026-07-30  notifier's Resend key went stale                 -> saved, nobody told
 *
 * Each of those was fixed. None of them were NOTICED — they were reported by
 * applicants who gave up, days or weeks later. That is the actual defect: the
 * lead capture shares a failure domain with the internal app, and it fails
 * silently.
 *
 * WHAT THIS DOES
 * --------------
 * Gives the form a second, INDEPENDENT way to capture a lead, using Netlify
 * Forms on this site's own origin. It shares nothing with the path above:
 * no Supabase, no service key, no RLS, no cross-origin request, no preflight,
 * no function in the other repo. If the primary path is broken in any way,
 * the applicant's details still reach Go Lucky, and Netlify emails the
 * submission — so a break announces itself on the first applicant instead of
 * being discovered weeks later.
 *
 * It fires on two conditions:
 *   1. the primary save threw or returned non-OK  -> reason "save_failed"
 *   2. the row saved but BOTH notifications failed -> reason "notify_failed"
 *
 * Deliberately dependency-free and never throws: it is the safety net, so it
 * must not be able to introduce a failure of its own.
 * ───────────────────────────────────────────────────────────────────────── */
(function (w) {
  'use strict';

  var FORM_NAME = 'partner-application-fallback';

  /* STRICT allowlist — contact-and-callback data only.
   *
   * This is deliberately minimal, and it is an allowlist rather than a
   * denylist so that a field added to a form in future cannot leak here by
   * default. The primary path stores the full application in Supabase behind
   * RLS, with documents in a private bucket read through a signing function.
   * This fallback is a different class of store: Netlify Forms, emailed to an
   * inbox. Financial and identity data must NOT cross into it.
   *
   * Deliberately EXCLUDED, and they must stay excluded:
   *   bank_account / bank_branch / bank_holder / bank_name / bank_type
   *   director_id / director_address
   *   trade_ref_*            (third parties who never consented to this)
   *   *_document / *_doc_url / signature_*
   *
   * POPIA s19 applies to the identity documents this form handles — see the
   * partner-documents bucket work of 2026-08-25. The goal here is only to be
   * able to phone the applicant back and finish the job properly, never to
   * hold a second copy of their credit file.
   */
  var FIELDS = [
    'business_name', 'business_type', 'contact_name', 'contact_mobile',
    'contact_email', 'delivery_address', 'delivery_day', 'weekly_volume',
    'selected_tier', 'payment_terms', 'payment_terms_other', 'notes'
  ];

  function encode(obj) {
    return Object.keys(obj)
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] == null ? '' : String(obj[k]));
      })
      .join('&');
  }

  /**
   * Capture a lead through the independent path.
   * Never throws. Resolves true if the lead is safely captured.
   *
   * @param {object} data    the application payload built by the form
   * @param {string} reason  "save_failed" | "notify_failed"
   * @param {string} detail  error text, for diagnosing the primary path
   * @returns {Promise<boolean>}
   */
  function capture(data, reason, detail) {
    var body = { 'form-name': FORM_NAME };

    try {
      FIELDS.forEach(function (f) {
        if (data && data[f] != null && data[f] !== '') body[f] = data[f];
      });
    } catch (e) { /* carry on with whatever we did collect */ }

    body.failure_reason = reason || 'unknown';
    body.failure_detail = String(detail || '').slice(0, 900);
    body.source_page = (w.location && w.location.pathname) || '';
    body.captured_at = new Date().toISOString();
    body.user_agent = (w.navigator && w.navigator.userAgent) || '';

    return fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encode(body)
    })
      .then(function (res) { return !!(res && res.ok); })
      .catch(function () { return false; });
  }


  /**
   * Build a payload straight off the <form> and capture it.
   *
   * Used on the error path, because a submit can die BEFORE the payload object
   * exists (a document upload to Supabase Storage throws first), and because
   * `const data` inside the try block is not visible from the catch. Reading
   * the form means whatever the applicant actually typed is what gets saved,
   * at any stage of the failure.
   *
   * Never throws.
   *
   * @param {HTMLFormElement} form
   * @param {string} reason
   * @param {string} detail
   * @returns {Promise<boolean>}
   */
  function captureFromForm(form, reason, detail) {
    var data = {};
    try {
      var fd = new FormData(form);
      fd.forEach(function (v, k) {
        /* Allowlist only. Files cannot ride in a urlencoded body anyway, and
         * everything sensitive is excluded by FIELDS above, by design. */
        if (FIELDS.indexOf(k) === -1) return;
        if (typeof v !== 'string' || v === '') return;
        data[k] = v.length > 500 ? v.slice(0, 500) : v;
      });
    } catch (e) { /* fall through with whatever we have */ }

    return capture(data, reason, detail);
  }

  w.GLLeadFallback = { capture: capture, captureFromForm: captureFromForm, formName: FORM_NAME };
})(window);
