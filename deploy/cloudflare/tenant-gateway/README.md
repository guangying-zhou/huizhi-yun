# Tenant Gateway Worker

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
        "staticToken": "platform-generated-token"
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
