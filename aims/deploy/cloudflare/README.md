# Aims Cloudflare Worker Deployment

Aims can run as a Cloudflare Worker behind the tenant gateway:

```text
https://hzy.wiztek.cn/aims/
```

The Worker does not connect to MySQL directly and no longer uses Hyperdrive.
All `/api/v1/**` Aims business data access must go through tenant-runtime/data-runtime.
The tenant gateway can inject the runtime endpoint, or a single-tenant deployment
can provide `HZY_TENANT_RUNTIME_URL`.

## Deploy

```bash
cd /Users/gavin/Dev/huizhi-yun/aims

export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"

pnpm run deploy:cloudflare
```

Shell environment variables take precedence over values loaded from config files.
For shared Cloudflare app Workers, do not set tenant-specific values such as
`HZY_DEPLOYMENT_PUBLIC_URL=https://hzy.wiztek.cn`; app URLs are derived from the
incoming Gateway request host. `HZY_CONSOLE_URL` defaults to
`https://console.huizhi.yun`.

Then deploy the tenant gateway so `/aims/` is routed:

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

## Verify

```bash
curl -I https://hzy.wiztek.cn/aims/
curl -I https://hzy.wiztek.cn/aims
```

Console OIDC needs an active redirect URI:

```text
https://hzy.wiztek.cn/aims/api/auth/oidc-callback
```
