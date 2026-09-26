# Tenant Gateway Worker

Policy bundle sync: configure `HZY_POLICY_SYNC_HOSTS` with exact tenant hosts for the independent minute cron (`* * * * *`, currently not in `wrangler.jsonc`). Empty means disabled. **Do not re-enable** without the capacity acceptance in `docs/Policy-Sync-Cadence-Assessment-20260922.md` §4 阶段 E: the 2026-09-07 production run exceeded the Workers Free 10 ms CPU limit, and a verified-runtime renewal verifies a ~727 KB signed envelope several times. The Console sync endpoint now runs the revision-probe check mode, which avoids the full envelope on most minutes but not on the 15-minute renewal. The existing five-minute integration drain remains separate. Console must have the Runtime policy store schema and exact grants ready and a first successful sync before serving traffic. See [policy storage runbook](../../../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md). Public HTTP cannot invoke `/api/internal/policy-bundle/sync`.

This Worker is the first Cloudflare-side routing layer for the SaaS tenant
domain shape:

```text
https://wiztek.huizhi.yun/
https://wiztek.huizhi.yun/finance/
https://wiztek.huizhi.yun/altoc/
https://wiztek.huizhi.yun/aims/
https://wiztek.huizhi.yun/assets/
https://wiztek.huizhi.yun/codocs/
https://wiztek.huizhi.yun/people/
https://wiztek.huizhi.yun/workflow/
https://wiztek.huizhi.yun/webdev/
```

It routes tenant traffic to independently hosted app origins. Console should
use its own Cloudflare Worker custom domain, not the tenant domain itself, so
the gateway does not recurse:

```text
Browser -> Cloudflare Tenant Gateway
  /          -> console.huizhi.yun
  /api/*     -> console.huizhi.yun
  /oauth/*   -> console.huizhi.yun
  /finance/* -> finance.isme.dev
  /altoc/*   -> altoc.isme.dev
  /aims/*    -> hzy-aims.zhouguangying.workers.dev
  /assets/*  -> hzy-assets.zhouguangying.workers.dev
  /codocs/*  -> codocs.isme.dev
  /people/*  -> people.huizhi.yun
  /workflow/* -> hzy-workflow.zhouguangying.workers.dev
  /webdev/*  -> webdev.huizhi.yun
  /codocs/ws -> hzy-collab-codocs-poc.zhouguangying.workers.dev
  /collab/*  -> hzy-collab-codocs-poc.zhouguangying.workers.dev
  /api/rum   -> hzy-observability.zhouguangying.workers.dev
```

The concrete origins are configured in `wrangler.jsonc` with
`HZY_CONSOLE_ORIGIN`, `HZY_FINANCE_ORIGIN`, `HZY_ALTOC_ORIGIN`,
`HZY_AIMS_ORIGIN`, `HZY_ASSETS_ORIGIN`, `HZY_CODOCS_ORIGIN`,
`HZY_PEOPLE_ORIGIN`, `HZY_WORKFLOW_ORIGIN`, `HZY_WEBDEV_ORIGIN`,
`HZY_COLLAB_ORIGIN`, and `HZY_OBSERVABILITY_ORIGIN`.

For the shared Cloudflare Console, `HZY_CONSOLE_ORIGIN` should be
`https://console.huizhi.yun`. `https://hzy.wiztek.cn` is a private deployment
domain and should not be used as the managed tenant gateway origin.

For the current Codocs migration POC, `HZY_CODOCS_ORIGIN` points to
`codocs.isme.dev`. `HZY_COLLAB_ORIGIN` still points to the workers.dev URL of
`hzy-collab-codocs-poc` because browsers access collaboration through the
tenant domain path `wss://wiztek.huizhi.yun/codocs/ws`; the workers.dev origin
is only used by the gateway as the backend target.

Tenant runtime metadata is stored in Platform, but the tenant-owned fields
such as custom domains and Agent endpoints are maintained from the tenant
Dashboard. The gateway can resolve the effective registry through one of two
inputs:

- `HZY_TENANT_GATEWAY_REGISTRY_URL`: Platform internal API, typically
  `https://platform.example.com/api/platform/internal/tenant-gateway/resolve`.
  Set `HZY_CLOUDFLARE_INTERNAL_TOKEN` as a gateway secret for that call.
- `HZY_TENANT_GATEWAY_REGISTRY_JSON`: exported registry JSON for bootstrap or
  staging.

When the gateway is attached to a wildcard route such as `*.huizhi.yun/*`, it
must ignore platform/application hostnames that are not tenant subdomains. The
gateway has a built-in reserved list for application prefixes and platform
hostnames, and it can be extended with:

```text
HZY_TENANT_GATEWAY_RESERVED_SUBDOMAINS=admin,assets,finance,webdev,workflow,www,...
HZY_TENANT_GATEWAY_RESERVED_SUBDOMAIN_PREFIXES=dev-agent-
HZY_TENANT_GATEWAY_RESERVED_SUBDOMAIN_SUFFIXES=-data-runtime
```

Requests for reserved hosts such as `assets.huizhi.yun`, `webdev.huizhi.yun`,
`dev-agent-1.huizhi.yun`, or `wiztek-data-runtime.huizhi.yun` are passed
through after stripping internal `x-hzy-*` headers, so the application Worker
custom domain or Cloudflare Tunnel hostname can handle them directly.

Registry entries may define `tenantCode`, `deploymentCode`, `dataRuntime`, and
per-app deployment overrides:

```json
{
  "domains": {
    "wiztek.huizhi.yun": {
      "tenantCode": "wiztek",
      "deploymentCode": "wiztek-console",
      "dataRuntime": {
        "endpoint": "https://oa.wiztek.cn:18080",
        "audience": "data-runtime"
      },
      "apps": {
        "finance": { "deploymentCode": "wiztek-finance" },
        "people": { "deploymentCode": "wiztek-people" },
        "workflow": { "deploymentCode": "wiztek-workflow" },
        "webdev": { "deploymentCode": "wiztek-webdev" }
      }
    }
  }
}
```

The shared Platform resolve API does not return bootstrap static tokens. A
business app uses the trusted runtime app identity injected by this gateway to
obtain a short-lived data-runtime token from Console. A `staticToken` remains
accepted only in an explicitly supplied offline/bootstrap registry JSON; it is
not part of the shared scheduler contract.

Successful Platform registry lookups are cached for five minutes in the
gateway and in Cloudflare's Cache API. A cached entry remains available for up
to 24 hours as a stale fallback when Platform or Hyperdrive is temporarily
unavailable. This keeps tenant routing and runtime context available during a
control-plane outage without making configuration changes permanently sticky.

The tenant gateway now acts as a thin routing and header-injection edge. It no
longer shares `HZY_TENANT_GATEWAY_TOKEN` with app Workers; app-to-app trust is
carried by Console-issued service tokens and runtime/app identity. The shared
Console Worker is the exception: configure the same
`HZY_CLOUDFLARE_INTERNAL_TOKEN` secret on Tenant Gateway and Console so Console
can reject forged tenant-context headers. Legacy `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`
is still accepted during migration.

## Deploy

Set secrets before deploying:

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

`HZY_CLOUDFLARE_INTERNAL_TOKEN` is used by the gateway to resolve tenant registry
data from Platform and to prove Tenant Gateway context to the shared Console
Worker. The same value must also be configured on Platform and Console.

## Shared integration-operation scheduler

Tenant Gateway owns the shared `*/5 * * * *` Cloudflare trigger. The producer
calls the internal Platform endpoint
`/api/platform/internal/tenant-gateway/scheduler-page`, derived from the normal
resolve URL unless `HZY_TENANT_GATEWAY_SCHEDULER_REGISTRY_URL` is set. The page
contains only tenant host, tenant code, environment, the Console target
deployment, and enabled `aims`/`altoc`/`assets`/`console`/`finance`/`people`/`workflow`
app codes. Assets is woken only when its persisted scheduler selection is
`unified` or `recovered`. The page uses a
time-rotated bounded window, stable shard and opaque cursor; it never returns a
runtime token or login secret.

Each target is resolved again by host, then the gateway sends an empty POST to
the app-prefixed Worker path `/{app}/api/internal/integration-operations/drain`;
Console uses the root path `/api/internal/integration-operations/drain`. The HMAC canonical path
remains the app-independent `/api/internal/integration-operations/drain`.
Runtime endpoint and binding context are headers only. The wake carries the internal
Gateway token plus a 60-second issued-at/HMAC binding covering path, request ID,
tenant, deployment, app, environment, runtime endpoint and tenant host. Normal
HTTP routing strips scheduler headers (including the Console target deployment)
and returns 404 for the private wake and `/_nitro/tasks/**` paths. People uses
the signed Console target only for its durable employee-lifecycle projection;
it is never accepted from an ordinary browser request.

Before waking a tenant, the gateway obtains the same short-lived Platform
Tenant Runtime bootstrap token used by ordinary business API routing and passes
it only through the trusted Service Binding request. Scheduled Workers must not
fall back to a static runtime token or expose this bootstrap credential in the
registry page, request URL, response body or logs.

Production routing uses same-account Cloudflare Service Bindings for bound
Console and business applications, as well as Platform registry reads and scheduled drain
wakes. Keep
`HZY_PLATFORM_SERVICE`, `HZY_CONSOLE_SERVICE`, `HZY_AIMS_SERVICE`,
`HZY_ASSETS_SERVICE`, `HZY_ALTOC_SERVICE` and `HZY_PEOPLE_SERVICE` bound to the corresponding Workers in `wrangler.jsonc`
(and keep the Workflow binding when Workflow is enabled). A tenant route such
as `/aims/**` must dispatch through its binding when present instead of fetching
the application's reserved public hostname: that hostname is also covered by
the wildcard Gateway route, so a public round trip adds a second Gateway Worker
hop and can be rejected before the target application is reached. Applications
without a binding retain the configured origin fallback.

Default bounds are 4 registry pages, 50 tenants, concurrency 4, 45 seconds and
a 30-second per-wake timeout. The current single-tenant production binding sets
`HZY_TENANT_GATEWAY_SCHEDULER_SHARD_COUNT=1`, so every tenant is considered on
each five-minute trigger; increase the shard count only when scale requires
spreading wakes across intervals and the added lifecycle latency is acceptable.
A failed app wake is logged and counted without starving the same tenant's
remaining apps; other tenants also continue. Database operations remain the
durable queue and make repeated wakes safe.

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

The route `wiztek.huizhi.yun/*` requires `huizhi.yun` to be in the same
Cloudflare account. DNS must also resolve to Cloudflare. If `wiztek.huizhi.yun`
does not resolve, add a proxied DNS record in the `huizhi.yun` zone, for
example:

```text
Type: A
Name: wiztek
Content: 192.0.2.1
Proxy status: Proxied
```

Cloudflare will route matching requests to the Worker before the placeholder
origin is used.

## Verify

```bash
curl -I https://wiztek.huizhi.yun/finance/
curl -I https://wiztek.huizhi.yun/finance/_nuxt/BBp2SSDl.js
curl -I https://wiztek.huizhi.yun/aims/
curl -I https://wiztek.huizhi.yun/assets/
curl -I https://wiztek.huizhi.yun/codocs/
curl -I https://wiztek.huizhi.yun/people/
curl -I https://wiztek.huizhi.yun/workflow/
curl -I https://wiztek.huizhi.yun/
curl -I https://wiztek.huizhi.yun/api/auth/me
```

Expected responses include:

```text
x-hzy-gateway: tenant-gateway
```

For API verification, the gateway forwards internal headers to app Workers:

```text
x-hzy-tenant: wiztek
x-hzy-deployment: wiztek-finance
x-hzy-environment: prod
x-hzy-data-runtime-url: https://oa.wiztek.cn:18080
```

The gateway also sends `x-hzy-gateway-token` when
`HZY_CLOUDFLARE_INTERNAL_TOKEN` or legacy `HZY_TENANT_GATEWAY_INTERNAL_TOKEN` is
configured. Do not expose or log that value in verification output.

## Routing Notes

- Plain HTTP tenant requests are redirected to the HTTPS canonical URL before
  proxying, and HTTPS responses include HSTS.
- `/finance`, `/altoc`, `/aims`, `/assets`, `/codocs`, `/people` and `/workflow` are redirected to trailing-slash paths.
- Client-provided `x-hzy-*` internal runtime headers are stripped before the
  gateway injects its own values.
- Non-API Finance/Altoc/Aims/Assets/Codocs/People/Workflow requests strip `Cookie` and `Authorization` before
  forwarding to app Workers, matching the current Caddy staging behavior and
  avoiding large shared-domain cookies on asset requests.
- `/finance/api/*`, `/altoc/api/*`, `/aims/api/*`, `/assets/api/*`, `/codocs/api/*`, `/people/api/*`, and `/workflow/api/*` keep cookies and authorization headers.
- `/codocs/ws` and `/collab/*` are routed to the Collab origin and preserve
  WebSocket upgrade, cookies, and authorization headers.
- `/api/rum` and `/rum` are routed to the Observability Worker. Cookie and
  Authorization headers are stripped; the gateway injects `x-hzy-tenant`.
- `/cdn-cgi/*` is reserved by Cloudflare and does not reach the gateway Worker.
  To suppress Cloudflare Web Analytics / Browser Insights beacon noise, create
  a Cloudflare Configuration Rule for the tenant hostname with
  `disable_rum=true`.

  Dashboard path:

  ```text
  huizhi.yun zone -> Rules -> Overview -> Create rule -> Configuration Rule
  ```

  Match expression:

  ```text
  http.host eq "wiztek.huizhi.yun"
  ```

  Setting:

  ```text
  Disable Real User Monitoring (RUM): On
  ```
- Redirect `Location` headers from known upstream origins are rewritten back to
  the tenant host.
- Console login redirects from known upstream origins are rewritten at the edge
  so unauthenticated tenant-domain login stays on the tenant host.
- `HZY_CONSOLE_ORIGIN` must point to the shared Console origin
  `https://console.huizhi.yun`. Do not set it to `https://wiztek.huizhi.yun`,
  because that would send the gateway back to itself.

## Business App Deploy

Business app Workers should be deployed as tenant-neutral shared origins with
an explicit deployment profile. Do not set a tenant host such as
`wiztek.huizhi.yun` as `HZY_DEPLOYMENT_PUBLIC_URL` for shared Cloudflare app
Workers. The gateway injects tenant/deployment/Data Runtime headers per request
after resolving the request host through Platform registry data maintained by
the tenant Dashboard `/dashboard/deployments`. App URLs and OIDC callbacks are
derived from the incoming request host. `HZY_DEPLOYMENT_PUBLIC_URL` is reserved
for self-hosted or single-tenant independent deployments.

In `managed-cloud-agent`, app Workers do not receive tenant-level Data Runtime
endpoint/token vars; the tenant-level Agent endpoint is the default for every
app, while deployment-level endpoints are only per-app overrides. Business app
Workers also do not need `HZY_PLATFORM_URL`; `HZY_CONSOLE_URL` defaults to the
managed Console origin `https://console.huizhi.yun`.

Server-side app-to-app calls use tenant-neutral app origins, not tenant
`homeUrl` values from Console. When those calls target reserved app hosts such
as `assets.huizhi.yun`, the gateway strips client-forged internal headers but
preserves `x-hzy-*` tenant/runtime headers if the request carries a valid
`x-hzy-gateway-token`. This lets `Aims -> Assets` and similar service calls keep
tenant context without tenant-specific URL configuration.

```bash
export HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
```

Use the versioned package commands as the release entry points. Before a real
deployment, every supported module runs lint, typecheck, tests, configuration
rendering, the Cloudflare build, and a Wrangler dry run. To stop after the dry
run, use `pnpm run verify:cloudflare-deploy`; use
`pnpm run deploy:cloudflare` only when the same command invocation should
continue to the real deployment. Platform also requires
`HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true` before either command can pass.

From the workspace root, `corepack pnpm run release:check` is the strict
clean-worktree release gate. During development,
`corepack pnpm run release:check -- --allow-dirty` runs the same checks while
reporting dirty repositories. Corepack resolves the pnpm version declared by
the repository. Neither form deploys, runs live probes, or changes secrets.

Tenant Gateway itself is not a workspace package. Use the guarded root command,
which pins Wrangler, runs tests and dry-run, records deployment IDs, and requires
an exact preview digest before real execution:

```bash
corepack pnpm run gateway:release -- \
  --action deploy \
  --operator <operator-uid> \
  --change-id <change-id>
```

Rollback must use the exact pre-deploy version ID recorded in the release
journal. It does not roll back bindings, storage or secrets:

```bash
corepack pnpm run gateway:release -- \
  --action rollback \
  --version-id <exact-version-id> \
  --operator <operator-uid> \
  --change-id <change-id>
```

See `docs/release/G2-6-Release-and-Rollback-Runbook.md` for the fixed release
order, old-path verification matrix and roll-forward requirement.

For the current staging trial:

```bash
cd /Users/gavin/Dev/huizhi-yun/finance
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/altoc
HZY_ALTOC_HYPERDRIVE_ID=<id> \
HZY_ALTOC_ROUTE_PATTERN='altoc.isme.dev/*' \
HZY_ALTOC_ZONE_NAME=isme.dev \
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/codocs
HZY_CODOCS_HYPERDRIVE_ID=<id> \
HZY_CODOCS_ROUTE_PATTERN='codocs.isme.dev/*' \
HZY_CODOCS_ZONE_NAME=isme.dev \
HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3 \
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/aims
HZY_AIMS_HYPERDRIVE_ID=<id> \
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/assets
HZY_ASSETS_HYPERDRIVE_ID=<id> \
HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3 \
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/people
pnpm run deploy:cloudflare

cd /Users/gavin/Dev/huizhi-yun/workflow
pnpm run deploy:cloudflare
```

## Console OIDC Redirects

Console also needs matching active OIDC redirect URIs:

```text
https://wiztek.huizhi.yun/finance/api/auth/oidc-callback
https://wiztek.huizhi.yun/altoc/api/auth/oidc-callback
https://wiztek.huizhi.yun/aims/api/auth/oidc-callback
https://wiztek.huizhi.yun/assets/api/auth/oidc-callback
https://wiztek.huizhi.yun/codocs/api/auth/oidc-callback
https://wiztek.huizhi.yun/people/api/auth/oidc-callback
https://wiztek.huizhi.yun/workflow/api/auth/oidc-callback
```

Use `source='local'` for staging overrides so bundle materialization does not
deactivate them:

```sql
INSERT INTO auth_client_redirect_uris (
  client_id, uri_type, redirect_uri, source, status, created_at, updated_at
)
SELECT id, 'redirect', 'https://wiztek.huizhi.yun/finance/api/auth/oidc-callback',
       'local', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM auth_clients
 WHERE client_id = 'finance'
ON DUPLICATE KEY UPDATE source = 'local', status = 'active', updated_at = UTC_TIMESTAMP();
```

Repeat for `post_logout` using `/api/auth/oidc-post-logout`, and for each
business app path. In the target product this should come from Platform tenant
deployment settings and the generated policy bundle rather than manual SQL.

## Gateway service assertion (default off)

The reviewed exchange uses an ops-registered Ed25519 Gateway key. The Worker signs only an authenticated source whose tenant/environment/deployment exactly matches the resolved registry. It strips incoming proof and Gateway headers, forwards a narrow trusted-header allowlist through the Console Service Binding, and uses the single Foundation fallback contract.

Do not enable the Gateway lane before Runtime keyset sync, Runtime exchange, and the Console flag. Disable the Gateway lane first during rollback. All selected grants need exact tenant/deployment bindings; report gaps rather than repair them implicitly. Provision private JWK material only as a test Worker secret after environment review. See [the code contract and staged rollout](../../../docs/Gateway-Service-Assertion-Rollout.md); no environment was changed by the code batch.
