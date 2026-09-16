# HZY Dev Stack

This folder contains the shared dev-mode runtime for two single-machine
environments:

- `local`: developer workstation, unified entrypoint at `http://localhost:3180`.
- `staging`: team trial server, unified entrypoint at the configured tenant
  domain, for example `https://wiztek.huizhi.yun`.

This stack is for team testing and trial runs. It is not the final production
runtime packaging flow.

## Runtime Model

PM2 starts enabled Nuxt apps in dev mode on `127.0.0.1:3100+`. By default only
Console and Workflow are enabled to keep the single-machine runtime light.
Caddy listens on `127.0.0.1:3180` or `localhost:3180` and routes path prefixes
to each app. In staging, Nginx owns public ports `80/443`, handles TLS, and
proxies all traffic to Caddy on `127.0.0.1:3180`.

```text
local browser
  -> Caddy :3180
     -> Console :3100
     -> Codocs  :3101
     -> AIMS    :3102
     -> Altoc   :3103
     -> Assets  :3104
     -> Workflow:3105
     -> Finance :3106
     -> Collab  :3107

staging browser
  -> Nginx :443
     -> Caddy 127.0.0.1:3180
        -> app ports 3100+
```

PM2 starts Nuxt through the absolute `pnpm` path detected by `dev-stack.sh`, so
it works with pnpm installed by Corepack, npm, or a user package manager.

## Port Plan

| App | Path | Port |
| --- | --- | --- |
| Console | `/` | `3100` |
| Codocs | `/codocs/` | `3101` |
| AIMS | `/aims/` | `3102` |
| Altoc | `/altoc/` | `3103` |
| Assets | `/assets/` | `3104` |
| Workflow | `/workflow/` | `3105` |
| Finance | `/finance/` | `3106` |
| Collab runtime | `/codocs/ws` and `/collab/` | `3107` |
| Caddy router | all paths | `3180` |

## Environment Files

Create one env file per runtime:

```bash
cp deploy/dev-stack/env.local.example deploy/dev-stack/env.local
cp deploy/dev-stack/env.staging.example deploy/dev-stack/env.staging
```

Environment precedence for each PM2 app:

1. The app's own `.env.dev` is loaded as the base.
2. `deploy/dev-stack/env.<env>` overrides non-empty values.
3. Stack-derived values are applied last, including `PORT`,
   `HZY_APP_BASE_PATH`, `NUXT_APP_BASE_URL`, `HZY_APP_HOME_URL`,
   `HZY_DEPLOYMENT_PUBLIC_URL`, HMR settings, and the default app `DB_NAME`.

Empty values in `env.local` and `env.staging` are placeholders. The shell helper
unsets them, and the ecosystem file ignores empty values, so they do not wipe
the app's `.env.dev`.

Nuxt is intentionally started without `--dotenv .env.dev` in this stack. That
prevents stale module-local URLs from overriding the unified local or staging
domain.

### Database Values

For `local`, leave `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`
empty when the module `.env.dev` files already point to the right database.

For `staging`, set `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD`
explicitly in `env.staging`. The PM2 ecosystem intentionally ignores module
`.env.dev` `DB_*` values on staging because those files are often developer
defaults such as `root` or `127.0.0.1`, and leaking them into a shared server can
break Console OIDC token exchange at runtime.

Set global `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD` when the whole
stack should use one database server. Leave global `DB_NAME` empty when apps use
their standard schemas. Use per-app database names only when needed:

```bash
CODOCS_DB_NAME=hzy_codocs
AIMS_DB_NAME=hzy_aims
ALTOC_DB_NAME=hzy_altoc
ASSETS_DB_NAME=hzy_assets
WORKFLOW_DB_NAME=hzy_workflow
FINANCE_DB_NAME=hzy_finance
```

If no per-app override is present, the stack defaults to the standard module
database names.

If the MySQL account requires TLS, set `DB_SSL=true`. For a verified TLS
connection, provide `DB_SSL_CA` as a one-line PEM with escaped `\n`; for a
temporary encrypted-only connection equivalent to `mysql --ssl-mode=REQUIRED`,
set `DB_SSL_REJECT_UNAUTHORIZED=false`.

## Local Environment

Use local mode when developing on your workstation with the same unified paths
as staging.

### Local Setup

```bash
node --version
corepack enable
corepack prepare pnpm@10.32.1 --activate
npm install -g pm2
cp deploy/dev-stack/env.local.example deploy/dev-stack/env.local
```

Most local values can stay empty. `env.local.example` already points the unified
domain to `http://localhost:3180` and lets module `.env.dev` files provide
database and platform activation values.

### Local Start

Start or reload the default PM2 apps (`console,workflow`):

```bash
deploy/dev-stack/dev-stack.sh --env local up
```

Start the local Caddy router in another terminal:

```bash
caddy run --config deploy/dev-stack/Caddyfile.local
```

If Caddy is already running:

```bash
caddy reload --config deploy/dev-stack/Caddyfile.local
```

The helper wrapper does the same reload-or-run flow:

```bash
deploy/dev-stack/dev-stack.sh --env local proxy
```

Open:

```text
http://localhost:3180/
```

### Local Daily Commands

```bash
deploy/dev-stack/dev-stack.sh --env local status
deploy/dev-stack/dev-stack.sh --env local logs
deploy/dev-stack/dev-stack.sh --env local logs codocs
deploy/dev-stack/dev-stack.sh --env local restart
deploy/dev-stack/dev-stack.sh --env local down
deploy/dev-stack/dev-stack.sh --env local doctor
```

After changing `env.local`, reload PM2 with updated env:

```bash
deploy/dev-stack/dev-stack.sh --env local up
```

To run a different app set:

```bash
HZY_DEV_STACK_APPS=console,codocs deploy/dev-stack/dev-stack.sh --env local up
```

`up`, `update`, and `restart` remove PM2 processes outside the selected app set,
so previously started non-default apps do not keep consuming memory and disk I/O.
The Console runtime app page can still start a non-default app on demand; it
adds that app to the PM2 command's runtime app set for that operation.

## Staging Environment

Staging uses the same PM2/Caddy app stack as local, with Nginx in front for the
public domain and TLS.

Staging domain:

```text
https://hzy.wiztek.cn
```

### Staging Setup

Install prerequisites on the server:

```bash
node --version
corepack enable
corepack prepare pnpm@10.32.1 --activate
npm install -g pm2
```

Install Caddy, Nginx, and Certbot through the OS package manager.

Create the staging env file:

```bash
cp deploy/dev-stack/env.staging.example deploy/dev-stack/env.staging
vim deploy/dev-stack/env.staging
```

The minimum staging public URLs are:

```bash
HZY_DEPLOYMENT_PUBLIC_URL=https://wiztek.huizhi.yun
HZY_PLATFORM_URL=https://huizhi.yun
HZY_DEV_STACK_ALLOWED_HOSTS=hzy.wiztek.cn
```

`HZY_DEPLOYMENT_PUBLIC_URL` must be the URL users type in the browser. When
testing the SaaS tenant shape, set it to the tenant domain, not the origin
server domain. Console uses this value for public runtime config and for
derived upstream SSO callback URLs. If it remains `https://hzy.wiztek.cn`,
login will complete on the origin host and redirect users away from
`https://wiztek.huizhi.yun/`.

`HZY_DEV_STACK_ALLOWED_HOSTS` is only for Nuxt dev-server host validation. Keep
the tenant domain in `HZY_DEPLOYMENT_PUBLIC_URL`; add the origin or proxy host
there when Tenant Gateway reaches Console through another host such as
`hzy.wiztek.cn`. Without this, Console can return `403 Blocked request. This
host is not allowed` even though the tenant domain DNS and Worker route are
correct.

Staging also requires explicit database connection settings. Use a dedicated
runtime MySQL user, not `root`:

```bash
DB_HOST=oa.wiztek.cn
DB_PORT=3306
DB_USER=hzy_runtime
DB_PASSWORD=...
DB_CONNECTION_LIMIT=5
# If this user has REQUIRE SSL:
DB_SSL=true
# DB_SSL_CA=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
# Leave DB_NAME empty so each app keeps its own hzy_* schema.
```

Console activation also requires values generated by Platform for this tenant
deployment:

```bash
HZY_PLATFORM_TENANT_CODE=C000001
HZY_PLATFORM_DEPLOYMENT_CODE=C000001-console
HZY_PLATFORM_RUNTIME_TOKEN=...
HZY_PLATFORM_SIGNING_KID=...
HZY_PLATFORM_SIGNING_PUBKEY=...
HZY_CONSOLE_VAULT_MASTER_KEY=...
```

`HZY_PLATFORM_SIGNING_PUBKEY` can be stored on one line with escaped `\n`
characters. Console restores it to PEM format at runtime.

Do not add `-staging` to `HZY_PLATFORM_DEPLOYMENT_CODE` unless Platform created
that exact deployment code. It must match the license and deployment generated
by Platform.

For upstream employee SSO, dev-stack derives these callback URLs from
`HZY_DEPLOYMENT_PUBLIC_URL` unless explicitly overridden:

- `SSO_OIDC_REDIRECT_URI`
- `SSO_OIDC_POST_LOGOUT_REDIRECT_URI`

Make sure the SSO provider registers the generated callback URL:

```text
https://wiztek.huizhi.yun/api/auth/oidc-callback
```

If `SSO_OIDC_REDIRECT_URI` or `SSO_OIDC_POST_LOGOUT_REDIRECT_URI` are set
explicitly in `env.staging`, they override the derived values and must also use
the tenant domain.

### Staging Start

Start or reload the default PM2 apps (`console,workflow`):

```bash
deploy/dev-stack/dev-stack.sh --env staging up
```

Start or reload Caddy:

```bash
sudo caddy reload --config deploy/dev-stack/Caddyfile.staging
```

If Caddy is not already running, start it with:

```bash
sudo caddy run --config deploy/dev-stack/Caddyfile.staging
```

If Caddy is managed by the same user and does not need `sudo`, the helper
wrapper can be used:

```bash
deploy/dev-stack/dev-stack.sh --env staging proxy
```

Install the HTTP-only Nginx config first:

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/dev-stack/nginx.staging.conf /etc/nginx/conf.d/hzy-runtime.conf
sudo nginx -t
sudo systemctl reload nginx
```

Check ACME webroot access before requesting the certificate:

```bash
sudo mkdir -p /var/www/certbot/.well-known/acme-challenge
echo ok | sudo tee /var/www/certbot/.well-known/acme-challenge/ping
curl -i -H 'Host: hzy.wiztek.cn' http://127.0.0.1/.well-known/acme-challenge/ping
curl -i http://hzy.wiztek.cn/.well-known/acme-challenge/ping
```

Issue the certificate:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d hzy.wiztek.cn
```

Then switch Nginx to HTTPS:

```bash
sudo cp deploy/dev-stack/nginx.staging.ssl.conf /etc/nginx/conf.d/hzy-runtime.conf
sudo nginx -t
sudo systemctl reload nginx
```

Open:

```text
https://hzy.wiztek.cn/
```

### Staging Daily Update

On the staging server:

```bash
deploy/dev-stack/dev-stack.sh --env staging update
```

`update` installs dependencies and reloads PM2. It only runs `git pull --ff-only`
when `HZY_DEV_STACK_GIT_PULL=true` is set in `env.staging` or the shell.

Run typechecks during update only when needed:

```bash
HZY_DEV_STACK_RUN_TYPECHECK=true deploy/dev-stack/dev-stack.sh --env staging update
```

To update code and typecheck in one command without changing `env.staging`:

```bash
HZY_DEV_STACK_GIT_PULL=true HZY_DEV_STACK_RUN_TYPECHECK=true \
  deploy/dev-stack/dev-stack.sh --env staging update
```

### Staging Daily Commands

```bash
deploy/dev-stack/dev-stack.sh --env staging status
deploy/dev-stack/dev-stack.sh --env staging logs
deploy/dev-stack/dev-stack.sh --env staging logs altoc
deploy/dev-stack/dev-stack.sh --env staging restart
deploy/dev-stack/dev-stack.sh --env staging down
deploy/dev-stack/dev-stack.sh --env staging doctor
```

After changing `env.staging`, reload PM2 with updated environment:

```bash
deploy/dev-stack/dev-stack.sh --env staging up
```

To enable more apps on staging, either export `HZY_DEV_STACK_APPS` for one
command or set it in `deploy/dev-stack/env.staging`:

```bash
HZY_DEV_STACK_APPS=console,workflow,codocs,aims deploy/dev-stack/dev-stack.sh --env staging up
```

The Console runtime app page can start a non-default app without editing
`env.staging`. That is an on-demand runtime change; the next `up`, `update`, or
`restart` without `HZY_DEV_STACK_APPS` returns to the default `console,workflow`
set.

To reload one non-default app only:

```bash
HZY_DEV_STACK_ENV=staging HZY_DEV_STACK_APPS=altoc \
  pm2 startOrReload deploy/dev-stack/ecosystem.config.cjs --only hzy-altoc --update-env
```

Replace `hzy-altoc` with `hzy-console`, `hzy-codocs`, `hzy-aims`,
`hzy-assets`, `hzy-workflow`, or `hzy-finance` as needed.

Reload Caddy after changing a Caddyfile:

```bash
sudo caddy reload --config deploy/dev-stack/Caddyfile.staging
```

In staging, `/finance/` and `/altoc/` are routed by Caddy to Worker custom
domains:

```text
/finance/ -> https://finance.isme.dev
/altoc/   -> https://altoc.isme.dev
```

Those Worker custom domains must have Cloudflare proxied DNS records before
Caddy can reach them. A route can be bound successfully while DNS is still
missing, so verify with `dig +short altoc.isme.dev` or
`curl -I https://altoc.isme.dev/altoc/` before reloading Caddy.

Keep Nginx as the outer HTTPS entrypoint to `127.0.0.1:3180`; do not add second
competing app locations unless Caddy routing is intentionally bypassed.
The Caddy routes strip browser cookies for non-API Worker pages and assets, but
keep cookies for `/finance/api/*` and `/altoc/api/*`. This avoids large
shared-domain cookies from breaking Worker page loads while preserving API
authentication.

The outer Nginx HTTPS entrypoint caches Cloudflare-hosted app shell and static
assets before forwarding to Caddy:

- `/finance/` and `/altoc/`: 60 seconds.
- `/finance/_nuxt/*` and `/altoc/_nuxt/*`: 30 days.
- favicon/logo/manifest files for Finance and Altoc: 30 days.
- `/finance/api/*` and `/altoc/api/*`: never cached.

This is a staging optimization for the current topology:

```text
Browser -> Nginx -> Caddy -> Cloudflare Worker
```

It avoids pulling hashed Nuxt assets from Cloudflare through the domestic server
on every request while keeping same-origin login, OIDC callback, and API
behavior unchanged. Responses from cached locations include
`X-HZY-Proxy-Cache: MISS|HIT|BYPASS|EXPIRED`. Cached app-shell and asset
locations drop upstream `Set-Cookie` headers; auth/session writes must stay
under the uncached `/api/*` paths.

Before reloading the Nginx SSL config, make sure the cache directories exist:

```bash
sudo mkdir -p /var/cache/nginx/hzy-worker-assets /var/cache/nginx/hzy-worker-pages
sudo chown -R nginx:nginx /var/cache/nginx/hzy-worker-assets /var/cache/nginx/hzy-worker-pages 2>/dev/null || true
```

Reload Nginx after changing an Nginx config:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Effective Staging HMR

For non-local `HZY_DEPLOYMENT_PUBLIC_URL`, the ecosystem file injects public HMR
settings for every app:

```bash
NUXT_VITE_HMR_PROTOCOL=wss
NUXT_VITE_HMR_HOST=wiztek.huizhi.yun
NUXT_VITE_HMR_CLIENT_PORT=443
```

If the browser still tries `ws://localhost:<hmr-port>`, the running PM2 process
has stale env or old code. Reload with:

```bash
HZY_DEV_STACK_ENV=staging \
  pm2 startOrReload deploy/dev-stack/ecosystem.config.cjs --update-env
```

You can inspect the effective PM2 env for one app with:

```bash
pm2 env hzy-altoc | grep -E 'HZY_DEPLOYMENT_PUBLIC_URL|VITE_HMR|NUXT_VITE_HMR'
```

## Troubleshooting

Check process health:

```bash
pm2 status
ss -ltnp | grep -E ':3100|:3101|:3102|:3103|:3104|:3105|:3106|:3107|:3180|:80|:443'
```

Check Caddy directly:

```bash
curl -i -H 'Host: hzy.wiztek.cn' http://127.0.0.1:3180/
curl -i -H 'Host: hzy.wiztek.cn' http://127.0.0.1:3180/codocs/
```

Check Nginx logs:

```bash
sudo tail -n 100 /var/log/nginx/hzy-runtime.error.log
sudo tail -n 100 /var/log/nginx/hzy-runtime.access.log
```

Check app logs:

```bash
deploy/dev-stack/dev-stack.sh --env staging logs console
deploy/dev-stack/dev-stack.sh --env staging logs codocs
deploy/dev-stack/dev-stack.sh --env staging logs altoc
```

Common symptoms:

- `502 Bad Gateway`: Caddy is not listening on `3180`, or the target app port is
  down. Check `pm2 status` and Caddy status first.
- `Blocked request. This host is not allowed`: the app did not receive the
  staging host env. For Tenant Gateway, keep
  `HZY_DEPLOYMENT_PUBLIC_URL=https://wiztek.huizhi.yun` and add the origin host
  with `HZY_DEV_STACK_ALLOWED_HOSTS=hzy.wiztek.cn`, then reload PM2 with
  `--update-env`.
- `Invalid OIDC callback state`: usually mixed localhost/staging sessions or a
  stale cookie. Clear browser cookies for the domain and retry from the unified
  staging URL.
- `invalid_redirect_uri`: the Console OIDC provider does not have the exact
  callback URL registered.
- `Access denied for user 'root'...` from `/oauth/token`: Console is running
  with stale or unsafe DB env. Set `DB_HOST`, `DB_USER`, and `DB_PASSWORD` in
  `env.staging`, then reload PM2 with `deploy/dev-stack/dev-stack.sh --env
  staging up`.
- `license deploymentCode mismatch`: `HZY_PLATFORM_DEPLOYMENT_CODE` does not
  match the Platform-generated license deployment code.
- Browser HMR requests `ws://localhost:*` on staging: PM2 is running stale env or
  old code. Reload the app with `pm2 startOrReload ... --update-env`.

## Notes

- Business apps read Console runtime config through the unified domain.
- Console embeds Collab runtime by default; no separate Collab PM2 process is
  started.
- The stack intentionally avoids ports `3000` and `3001` by using `3100+`.
- Keep staging changes in `env.staging`; avoid editing module `.env.dev` on the
  server unless the value is truly module-local.
