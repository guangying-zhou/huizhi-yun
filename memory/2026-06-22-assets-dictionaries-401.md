# 2026-06-22 Assets dictionaries 401

## Symptom

Assets production console showed:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401 (Unauthorized)
[Dictionaries] Failed to load: FetchError: [GET] "/assets/api/v1/dictionaries": 401
```

The frontend bundle was current (`BbF2n_Qx.js`), so this was not stale deployment.

## Root Cause

Nuxt/Nitro bundled Assets local server middleware before Foundation layer server middleware:

1. `assets/server/middleware/assets-permission.ts`
2. `assets/server/middleware/tenant-runtime.ts`
3. `foundation/server/middleware/00-api-base-path.ts`
4. `foundation/server/middleware/console-auth.ts`

`assets-permission` called `requirePermission()` before `foundation` had populated `event.context.consoleAuth`, so valid browser sessions were treated as unauthenticated and `/api/v1/dictionaries` returned 401.

`tenant-runtime` had the same ordering risk for service capability validation and actor context forwarding.

## Fix

- Added `ensureAssetsConsoleAuth(event)` in `assets/server/utils/authIdentity.ts`.
- Called it before reading uid in `assets/server/utils/checkPermission.ts`.
- Called it at the start of `/api/v1/**` handling in `assets/server/middleware/tenant-runtime.ts`.
- Added `assets/test/consoleAuthOrder.test.ts` to lock the order-sensitive guard.

## Evidence

Validation passed:

```bash
pnpm --dir assets test
pnpm --dir assets run typecheck
pnpm --dir assets run build:cloudflare
pnpm --dir assets run cloudflare:config
```

Status: DONE_WITH_CONCERNS. The root cause is fixed and build/tests pass; live confirmation still requires redeploying the updated Assets Worker and rechecking the production request.

## 2026-06-29 Follow-up

The same browser symptom recurred after redeploy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401 (Unauthorized)
[Dictionaries] Failed to load: FetchError: [GET] "/assets/api/v1/dictionaries": 401
```

Root cause for this recurrence: `resolveAssetsApiPermission()` still mapped the ordinary
`GET /api/v1/dictionaries` startup data request to `admin/admin`. That route is used by
most Assets pages through `useAssetDictionaries()` and should not require system-admin
permission; only `/api/v1/admin/dictionaries/:code` maintenance routes should.

Fix:

- `assets/server/utils/assetsPermissionRoutes.ts`: map exact `GET dictionaries` to
  `dashboard/view`; leave all other `dictionaries*` and `admin/*` paths protected by
  `admin/admin`.
- `assets/test/assetsPermissionRoutes.test.ts`: added regression coverage for ordinary
  dictionary reads and admin dictionary maintenance.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
git -C assets diff --check
```

Status: DONE_WITH_CONCERNS. If production still returns 401 after this deployment, the
remaining issue is no longer the dictionary permission mapping and should be investigated
as a Console OIDC cookie/session-bridge problem.

## 2026-06-29 Second Follow-up

The symptom was reported again with the browser stack pointing at `BbF2n_Qx.js`.
Live probing showed the current production HTML references `CdBXK4A_.js`, so the
browser may still have a stale chunk. However, unauthenticated production probing of
`/assets/api/v1/dictionaries` returned the Assets `requirePermission()` error shape:

```text
statusCode: 401
message: 请先登录
```

That proves the request is still blocked by the Assets BFF permission middleware before
tenant-runtime handles the dictionary read.

Root cause for this recurrence: ordinary dictionary reads are bootstrap/reference data
for most Assets pages and should not be gated by the Assets BFF permission middleware.
Requiring even `dashboard/view` still makes startup sensitive to transient Console
OIDC/session-bridge state. Admin dictionary maintenance remains protected under
`/api/v1/admin/dictionaries/:code`.

Fix:

- `assets/server/utils/assetsPermissionRoutes.ts`: exact `GET dictionaries` now returns
  `null`, bypassing the Assets BFF permission guard while still allowing tenant-runtime
  forwarding.
- `assets/test/assetsPermissionRoutes.test.ts`: asserts ordinary dictionary reads bypass
  the BFF guard and admin dictionary updates still require `admin/admin`.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
```

Status: DONE_WITH_CONCERNS. Requires redeploying the Assets Worker and hard-refreshing
the browser tab to clear the stale `BbF2n_Qx.js` chunk.

## 2026-06-29 Third Follow-up

The symptom was reported again after redeploy. Rechecking the server chain showed the
exact `GET /api/v1/dictionaries` request bypassed `assets-permission`, but still flowed
through `assets/server/middleware/tenant-runtime.ts`. That middleware proxies most
`/api/v1/**` reads to tenant-runtime before the local route can return. If the proxy or
its Console-authenticated actor context returns 401, the public dictionary bootstrap
still fails.

Fix:

- `assets/server/middleware/tenant-runtime.ts`: exact `GET /api/v1/dictionaries` is now
  an allowed local API path and is not forwarded to tenant-runtime.
- `assets/server/utils/dictionaryRepository.ts`: `getAllDictionaries()` now returns a
  cloned copy of the shared static dictionary definitions. Write/update APIs still remain
  tenant-runtime/admin-only.
- `assets/test/consoleAuthOrder.test.ts`: added regression coverage that dictionary
  reads stay local and are not proxied.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
```

Status: DONE. The Assets startup dictionary read no longer requires Assets BFF
permissions or tenant-runtime forwarding.

## 2026-06-29 Fourth Follow-up

The symptom was reported again after redeploy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401 (Unauthorized)
[Dictionaries] Failed to load: FetchError: [GET] "/assets/api/v1/dictionaries": 401
```

Live unauthenticated probing of both public entrypoints still returned 401:

```text
https://wiztek.huizhi.yun/assets/api/v1/dictionaries
https://assets.huizhi.yun/assets/api/v1/dictionaries
```

Root cause for this recurrence: the previous local dictionary bypass skipped the Assets
BFF permission guard and tenant-runtime proxy, but the Assets `tenant-runtime`
middleware still resolved Console auth at the top of every `/api/v1/**` request before
checking whether the request was an allowed local API. With Foundation's base-path
middleware, `/assets/api/v1/dictionaries` can already be normalized to
`/api/v1/dictionaries`, so the dictionary bootstrap endpoint still had an auth-sensitive
middleware step before reaching its local handler.

Fix:

- `assets/server/middleware/tenant-runtime.ts`: exact `GET /api/v1/dictionaries` now
  short-circuits before `ensureAssetsConsoleAuth(event)`, tenant-runtime proxying, and
  tenant-runtime-required 503 handling.
- `assets/test/consoleAuthOrder.test.ts`: added regression coverage that the public
  dictionary read short-circuits before Console auth resolution and remains local.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
git -C assets diff --check
pnpm --dir assets build:cloudflare
```

Status: DONE_WITH_CONCERNS. The code path and Cloudflare build are fixed locally; live
production will continue returning 401 until this latest build is deployed to the
Worker route serving both `assets.huizhi.yun` and `wiztek.huizhi.yun/assets`.

## 2026-06-29 Fifth Follow-up

The symptom recurred again after redeploy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401 (Unauthorized)
[Dictionaries] Failed to load: FetchError: [GET] "/assets/api/v1/dictionaries": 401
```

Live probing confirmed both public entrypoints still returned the Assets/Console auth
401 shape:

```text
https://wiztek.huizhi.yun/assets/api/v1/dictionaries
https://assets.huizhi.yun/assets/api/v1/dictionaries
```

Root cause: returning from `assets/server/middleware/tenant-runtime.ts` only exits that
middleware. It does not stop later Nuxt layer middleware from running. Foundation
`server/middleware/console-auth.ts` still applies to `/api/**` and returns `401` when an
access token exists but cannot be authenticated, unless the path is listed in
`hzy.consoleOidc.bypassAuthPaths`.

Fix:

- `assets/nuxt.config.ts`: register the public readonly dictionary endpoint in
  `runtimeConfig.hzy.consoleOidc.bypassAuthPaths`, covering both normalized
  `/api/v1/dictionaries` and base-path `/assets/api/v1/dictionaries`.
- `assets/test/consoleAuthOrder.test.ts`: assert the public dictionary read is registered
  as a Foundation console-auth bypass in addition to staying local and not being proxied.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
pnpm --dir assets build:cloudflare
node -e "... check .output/server/chunks/nitro/nitro.mjs includes bypassAuthPaths and dictionary paths ..."
git -C assets diff --check
```

Status: DONE_WITH_CONCERNS. The build now contains `bypassAuthPaths`,
`/api/v1/dictionaries`, and `/assets/api/v1/dictionaries`. Production will still return
401 until this build is deployed to the Worker serving both Assets routes.

## 2026-06-29 Sixth Follow-up

The symptom was reported again after a redeploy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401 (Unauthorized)
```

Live probing before publishing confirmed all public entrypoints still returned 401:

```text
https://hzy-assets.zhouguangying.workers.dev/assets/api/v1/dictionaries
https://assets.huizhi.yun/assets/api/v1/dictionaries
https://wiztek.huizhi.yun/assets/api/v1/dictionaries
```

The current local source and Cloudflare build already contained the dictionary bypass
and static dictionary fallback, but the production HTML still referenced an older client
entry (`CdBXK4A_.js`) while the freshly built output referenced `Crhk5Ut5.js`. Root
cause for this recurrence was deployment/version drift: the Worker serving production
was not running the freshly built server bundle that includes the public dictionary
bypass.

Action:

- Regenerated Cloudflare config and rebuilt Assets with `pnpm --dir assets run cloudflare:config && pnpm --dir assets run build:cloudflare`.
- Verified the new server bundle contains `bypassAuthPaths:["/api/v1/dictionaries","/assets/api/v1/dictionaries"]`.
- Deployed with `pnpm dlx wrangler@4 deploy --config .wrangler.generated.jsonc` from `assets/`.
- Published Worker version `6283808b-8ec9-4ebd-a384-db71b36b0be2`.

Evidence after deploy:

```text
https://hzy-assets.zhouguangying.workers.dev/assets/api/v1/dictionaries -> 200
https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
https://wiztek.huizhi.yun/assets/ -> references /assets/_nuxt/Crhk5Ut5.js
```

Status: DONE. The original dictionary bootstrap 401 is fixed in production. Users with
old chunks cached should hard-refresh the Assets tab.

## 2026-06-29 Seventh Follow-up

The browser console symptom was reported again with an older stack chunk:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh live probing showed the production API is currently healthy:

```text
https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
https://assets.huizhi.yun/api/v1/dictionaries -> 302 /assets/api/v1/dictionaries
```

The endpoint also returns `200` when called with an invalid bearer token or invalid
Console cookies, which proves the Foundation console-auth bypass is active in the
deployed Worker. The current production HTML references `/assets/_nuxt/Crhk5Ut5.js`,
not `BbF2n_Qx.js`.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets typecheck
pnpm --dir assets build:cloudflare
git -C assets diff --check
node -e "... check .output/server/chunks/nitro/nitro.mjs includes bypassAuthPaths and dictionary paths ..."
```

Status: DONE. Remaining reports with `BbF2n_Qx.js` indicate a stale browser tab/cache
or an old console log entry, not the current server-side dictionary endpoint.

## 2026-06-30 Eighth Follow-up

Goal continuation rechecked the latest report with `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh live probing showed the current production `GET` endpoint is healthy and returns
the static dictionary payload without a browser session:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
```

However, `HEAD` and `OPTIONS` probes still returned `401` because the Assets BFF
permission mapper only bypassed exact `GET dictionaries`; non-mutating `HEAD` and
preflight `OPTIONS` fell through to the broader `dictionaries* -> admin/admin` rule.

Fix:

- `assets/server/utils/assetsPermissionRoutes.ts`: exact `dictionaries` now bypasses
  the BFF permission guard for `GET`, `HEAD`, and `OPTIONS`.
- `assets/server/api/v1/dictionaries/index.options.ts`: explicit local `OPTIONS`
  handler returns `204` with CORS headers instead of falling through to the SPA page.
- `assets/test/assetsPermissionRoutes.test.ts` and `assets/test/consoleAuthOrder.test.ts`:
  regression coverage for HEAD/OPTIONS bypass and the explicit preflight handler.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets run cloudflare:config
pnpm --dir assets run build:cloudflare
git -C assets diff --check -- server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
```

Local dev probe:

```text
GET /assets/api/v1/dictionaries -> 200
HEAD /assets/api/v1/dictionaries -> 200
OPTIONS /assets/api/v1/dictionaries -> 204
```

Status: DONE_WITH_CONCERNS. Production GET is already 200; the HEAD/OPTIONS hardening
will take effect after deploying this Assets Worker build.

## 2026-06-30 Ninth Follow-up

Deployed the current Assets Worker build to Cloudflare after confirming production
was still serving the old dictionary composable chunk (`BKlvIiJ8.js`) where
`loadDictionaries()` always fetched `/api/v1/dictionaries`.

Deploy command:

```bash
pnpm --dir assets run deploy:cloudflare
```

Cloudflare result:

```text
Uploaded hzy-assets
Current Version ID: e8745d9c-800c-4a5f-bcfa-a5366221b858
```

Post-deploy production probes:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization + invalid OIDC cookies -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
```

The current production HTML now references `/assets/_nuxt/DHPjm-8e.js`, and the
dictionary composable chunk contains the expected default local short-circuit:

```text
if (!force) { dictionaries = cloneDefinitions(); loaded = true; return }
```

Status: DONE. If a browser still logs `BbF2n_Qx.js` or the old dictionary chunk,
it is running cached pre-deploy assets; a hard reload or clearing site data should
move it to the deployed version.

## 2026-06-30 Tenth Follow-up

The browser console report recurred again with the old entry chunk:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probing showed the dictionary endpoint itself was healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization/Cookie -> 200
```

The current tenant page HTML referenced `/assets/_nuxt/DHPjm-8e.js`, not
`BbF2n_Qx.js`. But probing the old chunk path exposed the real recurrence:

```text
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js
-> 200 text/html
cache-control: public, max-age=31536000, immutable
```

Root cause: only the Assets Worker had been redeployed. The tenant gateway Worker was
still running the old cache policy that cached app `_nuxt` assets and allowed a missing
hashed build asset to fall back to the SPA HTML response. That made stale browser tabs
continue to run or request old build artifacts after Assets redeploys.

Fix:

- `deploy/cloudflare/tenant-gateway/src/index.js`: remove gateway cache forcing for
  app `_nuxt` assets and app HTML navigations.
- `deploy/cloudflare/tenant-gateway/src/index.js`: detect HTML fallback responses for
  app build asset paths and return `404 Build asset not found` with `no-store`.
- `deploy/cloudflare/tenant-gateway/test/cache-policy.test.mjs`: regression coverage
  for no forced `_nuxt` cache, app HTML `no-store`, and HTML fallback detection.
- Deployed tenant gateway with:

```bash
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

Cloudflare result:

```text
Uploaded hzy-tenant-gateway
Current Version ID: 11561943-33c9-4c6c-9a50-27f97fef4447
```

Post-deploy production probes:

```text
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references DHPjm-8e.js
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
```

Playwright network probe from a clean browser session loaded `DHPjm-8e.js` and did not
load `BbF2n_Qx.js`.

Status: DONE. This recurrence was gateway cache/version drift, not the Assets
dictionary endpoint. If an already-open tab still shows the old console line, hard
reload or clearing site data should move it to the current no-store entry HTML and new
asset graph.

## 2026-06-30 Eleventh Follow-up

The browser console report was attached again with the same old entry chunk:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh live probes showed the deployed endpoint and gateway behavior are still healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references DHPjm-8e.js
```

Playwright loaded a fresh unauthenticated browser session and observed no console
errors. The static request graph loaded `DHPjm-8e.js` and current chunks, then redirected
to SSO; it did not load `BbF2n_Qx.js` and did not request
`/assets/api/v1/dictionaries`.

Status: DONE. The current production server path is fixed. A report that still names
`BbF2n_Qx.js` is an already-open tab, browser cache, or historical console entry. Hard
reload or clearing site data is the remaining user-side action.

## 2026-06-30 Twelfth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probes still show the current server path is healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references DHPjm-8e.js
```

Status: DONE. The attached stack does not match the currently deployed Assets bundle.
It is stale browser state or a historical console entry, not an active server-side
dictionary 401.

## 2026-06-30 Thirteenth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh live probes still do not reproduce an active server-side 401:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries?codex_probe=20260630-0700 -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js?codex_probe=20260630-0700 -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references LcCaHVVd.js
```

The current entry chunk does not contain `/api/v1/dictionaries`, `assets-dictionaries`,
or `BbF2n_Qx`, matching the source change that makes `useAssetDictionaries()` use
built-in static definitions instead of fetching the bootstrap API.

Validation:

```bash
pnpm --dir assets test
pnpm --dir assets lint
pnpm --dir assets typecheck
```

Status: DONE_WITH_CONCERNS. The reported stack is not current production code. One
unrelated hardening note remains: a direct `HEAD` probe currently returns `200` with an
HTML content type on the public gateway, despite local HEAD handler coverage. That does
not explain the reported `GET` 401 and should be treated separately if HEAD semantics
matter.
dictionary endpoint failure.

## 2026-06-30 Thirteenth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probes still show the active server route is healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references LcCaHVVd.js
```

The current Assets frontend no longer fetches `/api/v1/dictionaries` during startup:
`useAssetDictionaries().loadDictionaries()` uses bundled static definitions and has no
`$fetch` or `[Dictionaries] Failed to load` log. The report therefore still points to
stale browser state or a historical console line.

Additional hardening: live `HEAD /assets/api/v1/dictionaries` returned `200` with an
HTML SPA response because only GET and OPTIONS handlers existed. This did not explain
the reported GET 401, but it made health probes ambiguous.

Fix:

- `assets/server/api/v1/dictionaries/index.head.ts`: added an explicit local HEAD
  handler with JSON/CORS headers.
- `assets/test/consoleAuthOrder.test.ts`: added source-level regression coverage for
  the HEAD handler.

Status: DONE_WITH_CONCERNS. Server-side GET remains fixed; deploy the Assets Worker
again only if HEAD probe cleanliness matters. A browser still showing `BbF2n_Qx.js`
must hard reload or clear site data.
dictionary endpoint failure.

## 2026-06-30 Thirteenth Follow-up

The same stale browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probes still show the deployed server path is healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references /assets/_nuxt/DHPjm-8e.js
```

The current entry script does not contain the old dictionary fetch path. This is still
stale browser state or a historical console line, not an active production endpoint
failure.

## 2026-06-30 Fourteenth Follow-up

The same pasted stack was attached again with `BbF2n_Qx.js`.

Fresh probes still show the dictionary endpoint itself is healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
```

Additional finding: the tenant gateway correctly returns `404 no-store` for the old
chunk path, but the direct Assets Worker still served missing base-path build assets as
SPA HTML:

```text
GET https://assets.huizhi.yun/assets/_nuxt/BbF2n_Qx.js
-> 200 text/html, cache-control: public, max-age=31536000, immutable
```

Fix:

- `assets/server/middleware/build-asset-not-found.ts`: missing `/_nuxt/**` and
  `/assets/_nuxt/**` requests that reach Nitro now return `404 Build asset not found`
  with `no-store`.
- `assets/test/buildAssetFallback.test.ts`: regression coverage for the no-store 404
  guard.

Evidence:

```bash
pnpm --dir assets test
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets run cloudflare:config
pnpm --dir assets run build:cloudflare
```

The freshly built server bundle contains `Build asset not found` and
`no-store, no-cache, must-revalidate, max-age=0`; the built client no longer contains
`BbF2n_Qx.js` or `DHPjm-8e.js`.

Deploy:

```text
Uploaded hzy-assets
Current Version ID: 2fd18a56-b782-457f-8373-acbfa97fb59c
```

Post-deploy probes:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200
GET with invalid Authorization and invalid Console cookies -> 200
GET https://assets.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://assets.huizhi.yun/assets/_nuxt/definitely-missing.js?probe=20260630 -> 404 no-store, "Build asset not found"
GET https://wiztek.huizhi.yun/assets/ -> references /assets/_nuxt/LcCaHVVd.js
```

Status: DONE. Production dictionary API is healthy, and both tenant-gateway and direct
Assets Worker paths now reject missing old build chunks with 404/no-store instead of
caching SPA HTML.

## 2026-06-30 Fifteenth Follow-up

The same attached browser stack was reported again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh probes still show the active production GET route is healthy and not sensitive to
stale auth headers:

```text
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, buildId=64b09bee-61d1-4b51-abd5-b5cab5c2e136, references /assets/_nuxt/LcCaHVVd.js
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization and invalid Console cookies -> 200
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://assets.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
```

The current source still has `useAssetDictionaries().loadDictionaries()` backed by local
static definitions and no `$fetch` or `[Dictionaries] Failed to load` branch. This report
therefore still indicates stale browser state or a retained historical console line, not
an active server-side `GET /assets/api/v1/dictionaries` failure.

Related note: a direct `HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries` still
returned `200 text/html` through the SPA fallback. This is not the reported GET 401 and
does not block the Assets page, but it remains a separate HEAD semantics cleanup if
health checks depend on HEAD.

## 2026-06-30 Sixteenth Follow-up

The same attached browser stack was reported again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Root cause hypothesis: the attached stack is stale browser state or a retained console
entry, not an active server-side Assets dictionary failure.

Fresh production probes still show the current deployed routes are healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization and invalid Console cookies -> 200 application/json
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://assets.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://wiztek.huizhi.yun/assets/ -> references /assets/_nuxt/LcCaHVVd.js
```

The current deployed entry chunk does not contain `BbF2n_Qx`,
`/api/v1/dictionaries`, `assets-dictionaries`, `loadDictionaries`, or
`[Dictionaries] Failed to load`. The current source implementation of
`useAssetDictionaries().loadDictionaries()` only loads bundled static definitions and
does not make a network request.

Status: DONE. The active production dictionary GET path is fixed. A browser still
showing `BbF2n_Qx.js` must refresh the page context; use hard reload or clear the
site data for `wiztek.huizhi.yun`.

## 2026-06-30 Seventeenth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Root cause hypothesis remains confirmed: this report is stale browser state or a
retained historical console entry. It does not match the currently deployed Assets
entrypoint or server behavior.

Fresh production probes:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization and invalid Console cookies -> 200 application/json
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references /assets/_nuxt/LcCaHVVd.js
```

The current deployed entry chunk contains no `BbF2n_Qx`, no `/api/v1/dictionaries`
request, no `assets-dictionaries` state key, and no `[Dictionaries] Failed to load`
branch. The source `useAssetDictionaries().loadDictionaries()` still uses bundled
static definitions and does not issue a network request.

Status: DONE. No server-side code change is warranted for this repeated screenshot.
The required user-side action is to close the old tab and hard reload, or clear site
data for `wiztek.huizhi.yun`.

## 2026-06-30 Eighteenth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Root cause hypothesis remains confirmed: this is not an active production
`GET /assets/api/v1/dictionaries` failure. The active production app no longer
references `BbF2n_Qx.js`, and that historical chunk is no longer served.

Fresh production probes:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization -> 200 application/json
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> references /assets/_nuxt/LcCaHVVd.js
```

The current deployed entry chunk has no exact `/api/v1/dictionaries`,
`[Dictionaries] Failed to load`, or `assets-dictionaries` matches. Local focused
regression tests also passed:

```text
cd assets && pnpm test -- test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
tests 28, pass 28
```

Status: DONE. The active server route and current frontend entry are healthy. A browser
still showing `BbF2n_Qx.js` is running stale page state or displaying a retained console
entry.

## 2026-06-30 Nineteenth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probes again confirm the active deployed route is healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization and invalid Console cookies -> 200 application/json
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store, "Build asset not found"
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references /assets/_nuxt/LcCaHVVd.js
```

The current `assets/app/composables/useAssetDictionaries.ts` still loads bundled static
definitions and does not issue a dictionary network request unless future code changes
reintroduce one.

Status: DONE. No active server-side dictionary 401 was reproduced. The attached
`BbF2n_Qx.js` stack is stale browser state or a retained historical console entry.

## 2026-06-30 Twentieth Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probing again returned the active endpoint successfully:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/_nuxt/CUaJvpRx.js -> 404 Build asset not found
GET https://wiztek.huizhi.yun/assets/_nuxt/DWLihDRf.js -> 404 Build asset not found
```

Local source still has `useAssetDictionaries().loadDictionaries()` backed by bundled
static definitions with no `$fetch` and no `[Dictionaries] Failed to load` branch.
Focused local regression also passed:

```text
cd assets && pnpm test -- test/consoleAuthOrder.test.ts
tests 28, pass 28
```

Status: DONE. The attached stack does not match the active deployed Assets server or
current source. It is stale browser state or a retained historical console entry, not
an active server-side dictionary 401.

## 2026-06-30 Twenty-first Follow-up

The same pasted browser stack was attached again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
```

Fresh production probes showed the active deployed endpoint and gateway cache policy are
healthy:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://assets.huizhi.yun/assets/api/v1/dictionaries -> 200 application/json
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries with invalid Authorization -> 200 application/json
OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries -> 204
GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js -> 404 no-store
GET https://wiztek.huizhi.yun/assets/ -> 200 no-store, references /assets/_nuxt/LcCaHVVd.js
```

Focused regressions passed:

```bash
node --test --experimental-strip-types test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
node --test --experimental-strip-types test/consoleAuthBypass.test.ts
pnpm --dir assets lint server/middleware/tenant-runtime.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts test/consoleAuthOrder.test.ts
pnpm --dir foundation lint server/middleware/console-auth.ts test/consoleAuthBypass.test.ts
```

Status: DONE. The active production route no longer reproduces the 401. A report that
still names `BbF2n_Qx.js` is from an already-open/stale browser execution context or an
old console line, not the currently served Assets entry or dictionary endpoint.
