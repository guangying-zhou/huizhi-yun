# Cloudflare /cdn-cgi/rum 404

## Symptom

Browser console reports:

```text
POST https://wiztek.huizhi.yun/cdn-cgi/rum? 404 (Not Found)
```

## Root Cause

This request is not issued by Codocs application code. The local codebase has its own Foundation RUM client, which posts to `/api/rum` by default. `/cdn-cgi/rum` is Cloudflare Web Analytics / Browser Insights RUM.

Cloudflare documents `/cdn-cgi/rum` as a Cloudflare-managed endpoint for proxied websites; POST should be handled by Cloudflare edge. If the browser receives 404, the Cloudflare RUM beacon is being injected/enabled for the tenant hostname but the endpoint is not being handled as expected for that hostname/path.

The project tenant gateway already routes `/api/rum`, `/rum`, and `/cdn-cgi/rum` to the Observability Worker when those requests reach the Worker. The tenant gateway README also notes `/cdn-cgi/*` is Cloudflare-reserved and usually does not reach the gateway Worker, and instructs using a Cloudflare Configuration Rule with `disable_rum=true` for tenant hostnames.

## Fix

Operational fix, not Codocs code:

- In Cloudflare zone `huizhi.yun`, add a Configuration Rule matching `http.host eq "wiztek.huizhi.yun"`.
- Set `Disable Real User Monitoring (RUM): On`.

This keeps the platform on Foundation/Observability `/api/rum` and suppresses Cloudflare-injected `/cdn-cgi/rum` beacon noise.

## Evidence

- `foundation/app/plugins/rum.client.ts` defaults to `/api/rum`.
- `foundation/nuxt.config.ts` defaults `NUXT_PUBLIC_RUM_ENDPOINT` to `/api/rum`.
- `deploy/cloudflare/tenant-gateway/src/index.js` recognizes `/cdn-cgi/rum`, but README says `/cdn-cgi/*` is Cloudflare-reserved and recommends `disable_rum=true`.
- Cloudflare docs describe `/cdn-cgi/rum` as the Web Analytics RUM endpoint.

## Status

DONE_WITH_CONCERNS: Root cause identified. No local code change is appropriate unless Cloudflare configuration cannot be changed and an origin-level fallback route is explicitly desired.
