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
Server-side service-token exchanges use the `HZY_CONSOLE_SERVICE` binding
(default target `hzy-console-prod`) so Worker-to-Worker calls do not traverse the
public Cloudflare edge. Override the target only with
`HZY_CONSOLE_WORKER_NAME=<worker-name>` during config generation.

共享 Worker 的 People → Directory lifecycle 不使用单租户 env 或自身 cron。Platform scheduler
registry 只枚举 active People deployment，Tenant Gateway 通过
`POST /api/internal/integration-operations/drain` 注入并签名 tenant、People deployment、
Runtime endpoint 和 Console target deployment；普通 HTTP 访问该路径必须返回 404。
`HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED` 仅用于专属单租户 Worker。

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

When People runs behind Tenant Gateway, the Worker must still have the same
`HZY_CLOUDFLARE_INTERNAL_TOKEN` secret as Tenant Gateway. People only trusts
Gateway-injected `x-hzy-data-runtime-*` / `x-hzy-tenant-runtime-*` headers after
this token check succeeds. If this secret is missing and `HZY_TENANT_RUNTIME_URL`
is not configured, `/api/v1/**` will return `503 People tenant-runtime is
required for /api/v1 data access`.

```bash
pnpm run cloudflare:config
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config .wrangler.generated.jsonc
pnpm dlx wrangler@4 secret list --config .wrangler.generated.jsonc
```

Managed Cloud scheduled notifications use a dedicated Console service client;
they must not use a static tenant-runtime token. Keep delivery disabled until
the People runtime migration and Console grant are ready. To enable the cron,
provide the explicit runtime binding and client identity, then deploy by the
versioned command:

```bash
export HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED=true
export HZY_TENANT_RUNTIME_URL='https://<tenant-runtime-host>'
export HZY_TENANT_RUNTIME_TENANT='<tenant-code>'
export HZY_TENANT_RUNTIME_DEPLOYMENT='<deployment-code>'
export HZY_PEOPLE_SERVICE_CLIENT_ID='<console-service-client-id>'
pnpm run deploy:cloudflare
```

Store `HZY_PEOPLE_SERVICE_CLIENT_SECRET` as a Worker secret, never in generated
config. If the flag is false, no cron is rendered. If it is true but a required
binding is missing, config generation fails closed. GitLab Runner is not part
of this deployment path.

People → Assets 离职事实投影使用独立开关，迁移与 Console v1.41 grant 未就绪前保持关闭：

```bash
export HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED=true
export HZY_TENANT_RUNTIME_URL='https://<tenant-runtime-host>'
export HZY_TENANT_RUNTIME_TENANT='<tenant-code>'
export HZY_TENANT_RUNTIME_DEPLOYMENT='<deployment-code>'
export HZY_PEOPLE_SERVICE_CLIENT_ID='<console-service-client-id>'
pnpm run cloudflare:config
pnpm run deploy:cloudflare
```

`HZY_PEOPLE_SERVICE_CLIENT_SECRET` 仍只保存为 Worker secret。通知或 Assets 投影任一开关启用时会渲染 15 分钟 cron，两个 task 在运行时分别执行自己的 default-off gate。

People caller-owned integration-operation dead-letter actionable 使用独立 default-off 开关；它不参与 Directory 或 Assets 的业务 claim drain。每轮最多发布/关闭一个冻结 generation，Console 或 runtime 临时不可用时保留 pending 并在后续 cron 重试：

```bash
export HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED=true
export HZY_TENANT_RUNTIME_URL='https://<tenant-runtime-host>'
export HZY_TENANT_RUNTIME_TENANT='<tenant-code>'
export HZY_TENANT_RUNTIME_DEPLOYMENT='<deployment-code>'
export HZY_PEOPLE_SERVICE_CLIENT_ID='<console-service-client-id>'
pnpm run cloudflare:config
pnpm run deploy:cloudflare
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
