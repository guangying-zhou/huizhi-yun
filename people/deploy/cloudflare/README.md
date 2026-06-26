# People Cloudflare Worker Deployment

People can run as a Cloudflare Worker behind the tenant gateway:

```text
https://<tenant>.huizhi.yun/people/
```

The Worker does not connect to MySQL directly. All `/api/v1/**` People business
data access is proxied to tenant-runtime/data-runtime by the People Nitro
middleware. When Tenant Gateway is in front of the Worker, it can provide
tenant-runtime routing headers; otherwise set `HZY_TENANT_RUNTIME_URL` for the
Worker environment.

## Deploy

```bash
cd /Users/gavin/Dev/huizhi-yun/people
cp .env.cloudflare.example .env.cloudflare.local

# For single-tenant/direct preview only. Shared Gateway deployments may leave
# this blank and rely on Gateway-injected runtime headers.
export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"

pnpm run deploy:cloudflare
```

Shared Cloudflare app Workers are tenant-neutral. Do not set
`HZY_DEPLOYMENT_PUBLIC_URL` to a tenant domain such as
`https://wiztek.huizhi.yun`; Gateway request headers are used to derive app URLs
at runtime. `HZY_CONSOLE_URL` defaults to `https://console.huizhi.yun`.

To deploy People on a dedicated Worker origin or staging route:

```bash
export HZY_PEOPLE_WORKERS_DEV=false
export HZY_PEOPLE_ROUTE_PATTERN="people.huizhi.yun/*"
export HZY_PEOPLE_ZONE_NAME="huizhi.yun"
pnpm run deploy:cloudflare
```

Then deploy the tenant gateway so `/people/` is routed:

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

## Local Preview

```bash
cd /Users/gavin/Dev/huizhi-yun/people
export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"
pnpm run preview:cloudflare
```

## Secrets

People should not store Platform tokens, Console OIDC client secrets, database
passwords, or Data Runtime static tokens in `.env.cloudflare.local` or
`.wrangler.generated.jsonc`.

If a direct single-tenant Worker needs to call tenant-runtime without Tenant
Gateway header injection, write the runtime token as a Worker secret after
generating the config:

```bash
pnpm run cloudflare:config
pnpm dlx wrangler@4 secret put HZY_TENANT_RUNTIME_TOKEN --config .wrangler.generated.jsonc
```

## Verify

```bash
cd /Users/gavin/Dev/huizhi-yun/people
pnpm run cloudflare:config
node -e "const {readFileSync}=require('node:fs'); const c=JSON.parse(readFileSync('./.wrangler.generated.jsonc','utf8')); console.log(c.name, c.vars.HZY_DEPLOYMENT_PROFILE, c.hyperdrive)"
pnpm run build:cloudflare
```

Expected profile:

```text
hzy-people managed-cloud-agent undefined
```

After routing through Tenant Gateway, verify:

```bash
curl -I https://<tenant>.huizhi.yun/people/
curl -I https://<tenant>.huizhi.yun/people
```

People requires the customer-side data-runtime/tenant-runtime People adapter to
be enabled separately, for example:

```env
HZY_PEOPLE_AGENT_ENABLED=true
HZY_PEOPLE_DB_NAME=hzy_people
```
