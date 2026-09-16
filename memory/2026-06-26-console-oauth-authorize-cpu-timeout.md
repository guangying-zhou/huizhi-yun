# Console OAuth authorize CPU timeout

Date: 2026-06-26
Status: done with concerns

## Symptom

Cloudflare Worker `hzy-console-prod` intermittently failed `GET /oauth/authorize` with:

- `outcome=exceededCpu`
- `message=Worker exceeded CPU time limit.`
- request path `/oauth/authorize`

This happened during the AIMS OIDC login flow:

`client_id=aims`, `redirect_uri=https://wiztek.huizhi.yun/aims/api/auth/oidc-callback`.

## Root Cause

The `/oauth/authorize` route only needs OIDC client validation, redirect URI validation, PKCE validation, current session lookup, and auth-code creation.

Before the fix it imported the monolithic `server/utils/oidc.ts`, which also handled token signing, token verification, JWKS, and signing key management. That pulled heavier JWT dependencies and related code into the Worker startup/runtime path for a route that does not sign or verify JWTs.

Cloudflare bills CPU to the fetch event, including cold-start module initialization, so this import shape can surface as an `exceededCpu` failure even when the route logic itself is simple.

## Fix

- Added `console/server/utils/oidcAuthorize.ts` as a lightweight helper used only by `/oauth/authorize`.
- Updated `console/server/routes/oauth/authorize.get.ts` to use that lightweight helper instead of importing `server/utils/oidc.ts`.
- Converted runtime `jose` imports in Console server utilities to lazy `import('jose')`:
  - `server/utils/oidc.ts`
  - `server/utils/upstreamOidc.ts`
  - `server/utils/vault.ts`
  - `server/api/activation/diagnostics.get.ts`
- Added `console/test/oauthAuthorizeImports.test.ts` to prevent:
  - `/oauth/authorize` importing the monolithic OIDC utility again.
  - runtime static imports from `jose` in server code.

## Evidence

Validation commands:

- `pnpm test`: pass, 14 tests.
- `pnpm lint`: pass.
- `pnpm run build:cloudflare`: pass.

Build artifact check:

- `.output/server/chunks/routes/oauth/authorize.get.mjs` size: 1599 bytes.
- The authorize route chunk does not contain `jose`, `SignJWT`, `jwtVerify`, `importJWK`, or `createRemoteJWKSet`.

Known unrelated validation issue:

- `pnpm typecheck` still fails on missing `ali-oss` TypeScript declarations in `server/api/oss/avatar.ts` and `server/utils/integrations.ts`.

## Remaining Risk

Nitro still emits a large shared `.output/server/chunks/nitro/nitro.mjs` chunk that contains lazy JWT code after bundling. This fix removes the direct route-level dependency and lazy-loads JWT work, but it cannot prove locally that Cloudflare CPU exhaustion is fully eliminated. The production Worker must be redeployed and observed.

If `/oauth/authorize` still exceeds CPU after deploy, the next likely fix is architectural: split the Console OIDC provider/login path into a smaller dedicated Worker or introduce a Worker-level fast path that bypasses the full Nuxt/Nitro runtime for OAuth endpoints.
