# Assets Cloudflare Worker Deployment

Assets can run as a Cloudflare Worker behind the tenant gateway:

```text
https://wiztek.huizhi.yun/assets/
```

The Worker does not connect to MySQL directly. `/api/v1/**` data access is
proxied to tenant-runtime/data-runtime by the Assets Nitro middleware. When the
tenant gateway is in front of the Worker, it can provide tenant-runtime routing
headers; otherwise set `HZY_TENANT_RUNTIME_URL` for the Worker environment.

## Deploy

```bash
cd /Users/gavin/Dev/huizhi-yun/assets
HZY_TENANT_RUNTIME_URL=https://<tenant-runtime-host> \
HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3 \
pnpm run deploy:cloudflare
```

Shared Cloudflare app Workers are tenant-neutral. Do not set
`HZY_DEPLOYMENT_PUBLIC_URL` to a tenant domain here; Gateway request headers are
used to derive app URLs at runtime. `HZY_CONSOLE_URL` defaults to
`https://console.huizhi.yun`.

Then deploy the tenant gateway so `/assets/` is routed:

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

## Verify

```bash
curl -I https://hzy-assets.zhouguangying.workers.dev/assets/
curl -I https://wiztek.huizhi.yun/assets/
curl -I https://wiztek.huizhi.yun/assets
```

Console OIDC needs an active redirect URI:

```text
https://wiztek.huizhi.yun/assets/api/auth/oidc-callback
```
