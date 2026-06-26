# Workflow Cloudflare Worker Deployment

Workflow can run as a Cloudflare Worker behind the tenant gateway:

```text
https://wiztek.huizhi.yun/workflow/
```

The Worker does not connect to MySQL directly. All `/api/v1/**` Workflow data
access is routed through tenant-runtime/data-runtime. The tenant gateway can
inject the runtime endpoint, or a single-tenant deployment can provide
`HZY_TENANT_RUNTIME_URL`.

## Deploy

```bash
cd /Users/gavin/Dev/huizhi-yun/workflow

export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"

pnpm run deploy:cloudflare
```

Shared Cloudflare app Workers are tenant-neutral. Do not set
`HZY_DEPLOYMENT_PUBLIC_URL` to a tenant domain here; Gateway request headers are
used to derive app URLs at runtime. `HZY_CONSOLE_URL` defaults to
`https://console.huizhi.yun`.

Then deploy the tenant gateway so `/workflow/` is routed:

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

## Verify

```bash
curl -I https://hzy-workflow.zhouguangying.workers.dev/workflow/
curl -I https://wiztek.huizhi.yun/workflow/
```

Console OIDC needs an active redirect URI:

```text
https://wiztek.huizhi.yun/workflow/api/auth/oidc-callback
```
