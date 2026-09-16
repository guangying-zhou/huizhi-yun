![RepoInsight Screenshot](https://storage.repoinsight.com/images/www/ismebase_screenshot.png)

# RepoInsight - E-commerce Base for Individuals, Small or Micro Enterprises


- [Live demo](https://repoinsight/)
- [Documentation](https://repoinsight.com/docs/getting-started)


## Setup

Make sure to install the dependencies:

```bash
# pnpm
pnpm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# pnpm
pnpm dev
```

## Production

Build the application for production:

```bash
# pnpm
pnpm run build
```

Locally preview production build:

```bash
pnpm run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Domain Handling (Plan A) & Caddy Reverse Proxy

The platform uses a unified host classification utility (`server/utils/hostClassifier.ts`) to distinguish:

- platform-root (apex / www)
- platform-reserved-subdomain (auth, api, admin, storage, etc.)
- tenant-subdomain (direct single-level, e.g. `tenant.repoinsight.com` or `tenant.lvh.me` in dev)
- custom-domain (anything not matched to configured platform base domains)

For local development we recommend putting Caddy in front of the Nuxt dev server to eliminate port branching and mirror production host semantics (cookies, redirects, OAuth return logic). A complete setup guide (HTTP + internal TLS + wildcard + Cloudflare DNS challenge outline) is in:

`docs/caddy-dev-setup.md`

Quick dev start (HTTP only):
```caddy
(common_dev) {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
http://lvh.me, http://www.lvh.me { import common_dev }
http://*.lvh.me { import common_dev }
```

Debug endpoint (do not expose publicly in prod without a guard):
```
/api/debug/host?headers=1&echo=1
```
Returns classification + tenant context. See `server/api/debug/host.get.ts`.

Reserved subdomains & platform base domains configurable via env (see `.env.example` + validation script):
```
# Core
NUXT_PUBLIC_PLATFORM_ROOT_DOMAINS=repoinsight.com
NUXT_PUBLIC_DEV_ROOT_DOMAINS=lvh.me,localhost,127.0.0.1
NUXT_PUBLIC_PLATFORM_RESERVED_SUBDOMAINS=auth,api,admin,storage
NUXT_PUBLIC_BASE_DOMAIN=repoinsight.com
NUXT_PUBLIC_SITE_URL=https://repoinsight.com   # canonical public URL
```

Validate your configuration quickly:
```
pnpm run check:env
```
This fails fast if required secrets / values are missing (Plan A). Adjust `.env.dev` / `.env.prod` based on `.env.example`.

Custom domains rely on `DomainService.resolveActiveCached()`; OAuth relay handled by `/api/auth/relay` after Google callback.

---

## Unified Proxy Worker (Custom + Subdomain Routing)

The platform now uses a single Cloudflare Worker to handle both platform subdomains (tenant.repoinsight.com) and customer custom domains.

Documentation: `docs/unified-proxy-worker.md`

Key headers injected upstream:
 - `X-Custom-Domain` / `X-Tenant-Subdomain`
 - `X-Business-Name` / `X-Business-Id`
 - `X-Original-Host`
 - `X-Proxy-Worker`

If you recently added a custom domain and still see a 404 page, wait for the negative cache (default 15s) to expire or implement a future cache purge endpoint.

### Dev vs Prod behavior
- The Worker only runs on production routes bound in Cloudflare (e.g., `*.repoinsight.com/*`).
- Dev domains (lvh.me/localhost) are not handled by the Worker; develop against the Nuxt dev server directly.
- The Worker code only recognizes `PLATFORM_ROOT_DOMAIN` for platform detection; no special-casing for dev roots.

## Auth updates (2025-09)

- Dedicated auth host: `www.repoinsight.com` for initiation and callbacks.
- Custom domains use a session relay: callback issues HMAC token → `GET /api/auth/relay` on the target domain sets `user` cookie safely.
- Unified logout endpoint: `GET /api/auth/logout`
  - Clears current-domain cookies and platform cookies (`Domain=.repoinsight.com`).
  - Custom-domain calls cascade to platform then return to the same custom domain.
  - Platform default redirect after logout is `/` (not `/login`).
  - Strong loop prevention and pages.dev block in `next`.

### User settings unification (2025-09)
- Only `/user/profile` and `/user/security` are kept.
- Dashboard pages reuse the same forms via `UserProfileForm` and `UserSecurityForm` components.
- Legacy `/:business/user/*` routes have been removed.

More details: `docs/oauth-multi-tenant-strategy.md`, `docs/CUSTOM_DOMAINS.md`, and `docs/PROJECT.md`.
Additional: `docs/caddy-dev-setup.md` for reverse proxy and TLS in dev; `server/api/debug/host.get.ts` for host classification introspection.

## Nuxt Studio integration

Add `@nuxthq/studio` dependency to your package.json:

```bash
# pnpm
pnpm add -D @nuxthq/studio
```

Add this module to your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  ...
  modules: [
    ...
    '@nuxthq/studio'
  ]
})
```

Read more on [Nuxt Studio docs](https://nuxt.studio/docs/get-started/setup).

## Renovate integration

Install [Renovate GitHub app](https://github.com/apps/renovate/installations/select_target) on your repository and you are good to go.
