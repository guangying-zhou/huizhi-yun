# Aims Cloudflare Worker Deployment

## Private scheduler variant for the six-artifact pilot

`deploy/build-pilot-artifacts.mjs` packages the Aims Nuxt Worker as
`aims-worker.tar.gz` with two separate Wrangler configurations generated from
`aims/deploy/cloudflare/scheduler-worker-config.mjs`:

- `wrangler.aims-scheduler.production.jsonc` targets `hzy-aims` for production.
- `wrangler.aims-scheduler.staging.jsonc` targets `hzy-test-aims` for C000001 staging.

Both variants have no public route, `workers_dev=false`, `preview_urls=false`, no static Assets
binding, and no own cron.
Gateway reaches their private drain endpoint through `HZY_AIMS_SERVICE` with
the existing signed scheduler request. This artifact is built with
`HZY_AIMS_SCHEDULER_ONLY=true` so `hzy.schedulerOnly` is baked into Nitro's
runtime config; the deployment config does not try to override it. Its server
middleware returns 404 for pages
and ordinary `/api/v1/**` routes even when called through a Binding, while the
drain handler checks the Gateway signature. The `aims.runtime` credential and
Gateway verification secret are installed as Worker secrets only after the
environment's separate approval; neither is embedded in the artifact. The
existing standalone `.wrangler.generated.jsonc` and deploy command below are
unchanged. Gateway's `HZY_TENANT_GATEWAY_BLOCK_PUBLIC_AIMS` switch is off by
default and must stay off until production's 30-day request analysis confirms
that blocking `/aims` will not remove a real user or API caller. The six-artifact
build itself does not deploy or enable this switch.
The signed wake can be replayed within 60 seconds because the shared Gateway
signature verifier has no nonce; the bounded drain and its target commands
retain their idempotency keys, so this is accepted for the 10/8 window.
Before and after any approved deployment, read back routes and custom domains
for both Worker names. Omitting `route/routes` from this config does not remove
existing Dashboard-managed routes. Removing any remaining public route needs
the separate production approval in the go-live plan §7, followed by another
read-only route check.

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

If production hits `Worker exceeded CPU time limit` while a long-running path is
being split out of the Worker, raise the paid-plan CPU ceiling during deploy:

```bash
export HZY_AIMS_CPU_MS=300000
pnpm run deploy:cloudflare
```

This is only a safety margin. Large binary uploads should not be proxied through
the Aims Worker; keep them on the project file cabinet/Codocs upload path and
move heavier work to Codocs or runtime services.

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
