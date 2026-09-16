# People employees 503 Worker secret

## Symptom

Production browser request failed:

`GET https://wiztek.huizhi.yun/people/api/v1/employees?page=1&page_size=500` -> `503 Service Unavailable`

The page showed `员工数据暂不可用` with the generic schema / People adapter message.

## Root cause

The deployed `hzy-people` Cloudflare Worker has no secrets configured:

```bash
pnpm dlx wrangler@4 secret list --config people/.wrangler.generated.jsonc
# []
```

The generated People Worker config also has no direct `HZY_TENANT_RUNTIME_URL` var. In managed-cloud-agent mode this is expected only if Tenant Gateway injects runtime discovery headers and the app Worker trusts them.

Foundation only trusts Tenant Gateway runtime headers when:

- request has `x-hzy-gateway=tenant-gateway`
- request has `x-hzy-gateway-token`
- `x-hzy-gateway-token` equals the app Worker's `HZY_CLOUDFLARE_INTERNAL_TOKEN` or legacy `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`

With no People Worker internal token secret and no direct runtime endpoint, `maybeProxyCurrentApiToTenantRuntime()` skips proxying and People middleware returns:

`503 People tenant-runtime is required for /api/v1 data access.`

Why this could have worked before:

- `scripts/manage-cloudflare-internal-token.mjs` originally included other business apps in `business-apps` but omitted `people`, so a later token sync, rotation, or Worker recreation could leave People without the shared internal secret while Tenant Gateway and other apps remained configured.
- Older deployments may also have relied on a direct tenant-runtime URL/token or a pre-hardening trust path. The current managed-cloud-agent path requires the People Worker to have the same internal token as Tenant Gateway before it trusts injected runtime headers.

## Fix

Code/docs:

- Added reusable People API error alert helper.
- Updated dashboard and employees pages to show the real upstream/runtime error instead of hardcoding schema / adapter guidance.
- Updated People Cloudflare docs and env example to require `HZY_CLOUDFLARE_INTERNAL_TOKEN` on `hzy-people`.
- Added `people` to the Cloudflare internal token manager's business-app target list.

Operational remediation:

```bash
cd /Users/gavin/Dev/huizhi-yun/people
pnpm run cloudflare:config
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config .wrangler.generated.jsonc
pnpm dlx wrangler@4 secret list --config .wrangler.generated.jsonc
```

The token must be the same value used by Tenant Gateway.

Applied production remediation on 2026-07-08:

- Read the existing shared token from `platform/.env.prod`.
- Uploaded it as `HZY_CLOUDFLARE_INTERNAL_TOKEN` to the `hzy-people` Worker.
- Verified `wrangler secret list --config people/.wrangler.generated.jsonc` returns `HZY_CLOUDFLARE_INTERNAL_TOKEN`.
- Anonymous production API probe still returns `401 Console login required`, so the route remains protected.

## Evidence

- Anonymous curl to production returns expected `401 Console login required`; the user's logged-in browser reaches the People API and gets `503`.
- Production response includes `x-hzy-gateway: tenant-gateway`, proving the request goes through Tenant Gateway.
- `people/.wrangler.generated.jsonc` has no direct runtime endpoint var.
- `wrangler secret list` for `hzy-people` returns `[]`.
- `node --test --experimental-strip-types people/test/dashboardErrorAlert.test.ts`: passed.
- `node --test --experimental-strip-types people/test/*.test.ts`: 29 tests passed.
- `pnpm --dir people typecheck`: passed.

## Status

DONE_WITH_CONCERNS: repository code/docs are updated and the production root cause is identified. The live 503 requires writing the missing Cloudflare Worker secret with the real shared internal token.
