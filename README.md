# partners.golucky.co.za

Public account / credit application forms. Static site, no build step, publishes
the repo root. **Pushing to `main` deploys to production** via Netlify's GitHub
integration.

| Page | Status |
|---|---|
| `index.html` | **Live.** The application form (pricing-free since 2026-07-22). |
| `boutique.html` | **Live.** Boutique skin of the same form. |
| `apply.html` | Retired. `netlify.toml` 301s it to `/`. Kept for history only. |

---

## How a submission actually travels

```
  applicant's browser
        │
        ├─ 1. documents ──────────▶ Supabase Storage (anon key, private bucket)
        │
        ├─ 2. the application ────▶ orders.golucky.co.za/.netlify/functions/api-write
        │                            (cross-origin, service-role write proxy,
        │                             lives in the `golucky-app` project)
        │                                   │
        │                                   └─▶ Supabase `partner_applications`
        │
        ├─ 3. notify ─────────────▶ push-send + notify-application
        │
        └─ 4. IF ANY OF THAT FAILS ▶ Netlify Forms on THIS site
                                     (js/lead-capture-fallback.js)
```

Step 4 is the safety net and it is the reason this README exists.

## Why this form keeps breaking

Step 2 crosses into the main app's security perimeter: RLS policies, a table
allowlist, an Origin allowlist, a CORS layer, and signed-session enforcement
that is being phased in. **This site is that endpoint's only anonymous caller.**
Every time the perimeter is tightened for the authenticated app, this caller is
the one that gets overlooked — it is a single row in the caller map, and it is
the row with no credentials.

It has gone down three times:

| Date | Cause | Symptom |
|---|---|---|
| 2026-06-03 | RLS lockdown dropped the anon insert policy | `42501 new row violates row-level security policy` |
| 2026-07-15 | The proxy had no CORS, so the browser preflight was refused | `Failed to fetch` → "Something went wrong" for **every applicant, every browser** |
| 2026-07-30 | The notifier's mail key went stale | Applications saved, nobody was told, for weeks |

Two things made these far worse than they needed to be:

1. **Nothing watched the form.** Each outage was discovered by an applicant who
   had already given up. The 2026-07-15 one surfaced only when Chantal Duncan
   emailed to say she'd been "getting an error message the whole time".
2. **`curl` cannot see the failure.** Every diagnosis in July used curl, which
   sends no CORS preflight and ignores the response headers a browser insists
   on. curl reported a healthy `201` the entire time the form was dead.

Both are now addressed, below.

## What protects it now

**A lead can no longer be lost.** `js/lead-capture-fallback.js` gives the form a
second, independent capture path — Netlify Forms, on this site's own origin. It
shares nothing with step 2: no Supabase, no service key, no RLS, no cross-origin
request, no code from the other repo. If the primary save fails, the applicant's
contact details still arrive and they are told the truth: we have their details
and will call. It also fires when a row saved but *both* notifications failed,
which closes the 2026-07-30 failure mode.

It carries **contact-and-callback fields only**, by strict allowlist. Bank,
identity, document and third-party trade-reference data must never be added to
it — the full application belongs in Supabase behind RLS, with documents in a
private bucket read through a signing function. POPIA s19 applies. This is
enforced by tests.

**A break can no longer be silent.** `.github/workflows/form-health.yml` runs
`test/endpoint-contract.mjs` every 30 minutes. That test asserts the *browser*
contract — the preflight and the response headers — which is the thing that
actually breaks and the thing curl cannot see. On failure it opens a GitHub
issue labelled `form-down`. It writes no data.

## Runbook — "the form is broken"

```bash
node test/endpoint-contract.mjs     # says what broke and which file to fix
node test/lead-capture-fallback.test.mjs
```

1. **Rescue the people first.** Netlify → this site → **Forms** →
   `partner-application-fallback`. Every applicant who hit the outage is in
   there with a phone number. Call them.
2. **Then fix the cause.** It is nearly always
   `netlify/functions/api-write.js` in `golucky-app` — its CORS layer or its
   `ALLOWED_ORIGIN_SUFFIXES`. The failing assertion names which.
3. **Verify in a browser, never only with curl.** Or re-run the contract test,
   which is the browser check in a form you can automate.

## Before you tighten the main app's security again

`partners.golucky.co.za` must keep an **anonymous write** path to
`partner_applications`. When signed-session enforcement is switched on, this
caller needs an explicit carve-out, and the contract test above must be run
against production immediately afterwards.

## Known gap, not fixable from this repo

The endpoint this form depends on, `netlify/functions/api-write.js`, is
effectively **not under version control**. The `golucky-app` repository's last
commit is 2026-07-05, which still contains the *pre-CORS* version — the exact
code that caused the 2026-07-15 outage. Every fix since has been applied to a
working copy on one laptop and deployed straight to production with the Netlify
CLI. The only copy of the working code is on that laptop, and a rebuild from git
would reinstate the broken one.

Until that is committed, this form's dependency has no history, no review and no
backup. Fixing it is the single highest-value thing that can be done for the
reliability of this form.
