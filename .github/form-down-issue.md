The scheduled browser-contract check against the public application form failed.

**This means people trying to open an account are very likely seeing an error right now.**
Their contact details are still being captured by the fallback path (Netlify Forms on this
site) — open the Netlify **Forms** tab, look for `partner-application-fallback` submissions,
and call those people back today.

To see exactly what broke:

```
node test/endpoint-contract.mjs
```

The failing assertion names the cause and the file to fix. Almost always it is
`netlify/functions/api-write.js` in the `golucky-app` project: either its CORS layer or its
`ALLOWED_ORIGIN_SUFFIXES` origin allowlist, usually as a knock-on from tightening the main
app's security. This site is that endpoint's only anonymous caller, which is why it is the
one that gets forgotten.

See `README.md` in this repo for the full history and runbook.
