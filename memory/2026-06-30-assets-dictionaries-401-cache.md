# Assets dictionaries 401 after redeploy

Date: 2026-06-30

Symptom: browser console reported `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401` from old chunk `BbF2n_Qx.js`, with `[Dictionaries] Failed to load`.

Investigation:
- Current `assets/app/composables/useAssetDictionaries.ts` no longer fetches `/api/v1/dictionaries` and no longer contains `[Dictionaries] Failed to load`.
- Current local `.output` has no `[Dictionaries] Failed to load` string.
- Live `https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returns `200`.
- Live `https://assets.huizhi.yun/assets/api/v1/dictionaries` returns `200`.
- The same live endpoint returns `200` even with `Authorization: Bearer invalid-token`.
- Live `/assets/` HTML references current entry chunk `/assets/_nuxt/LcCaHVVd.js`.
- Live old chunk `/assets/_nuxt/BbF2n_Qx.js` returns `404`.
- Current entry chunk does not contain `[Dictionaries] Failed to load`, `/assets/api/v1/dictionaries`, or `/api/v1/dictionaries`.
- No service worker/PWA registration was found in `assets` or `foundation`.

Root cause hypothesis: the user's browser was still executing a cached old Assets JS chunk (`BbF2n_Qx.js`) from before the dictionary fallback change. The deployed server and current entry chunk no longer reproduce the 401.

Resolution: ask the user to hard refresh/clear site data for `wiztek.huizhi.yun` or open a fresh incognito window. If the error persists, confirm the browser Network tab entry chunk is `LcCaHVVd.js` or newer rather than `BbF2n_Qx.js`.

## Follow-up verification

Date: 2026-06-30

User attached the same browser console symptom from chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production probes showed the deployed server path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with `Authorization: Bearer invalid-token` returned `200`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `204`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Live `/assets/_nuxt/BbF2n_Qx.js` returns `404 Build asset not found`.

Root cause hypothesis remains browser-side stale execution state: the user browser is
still showing an error emitted by an old client chunk that is no longer served by the
current production deployment. No additional code change is indicated by the live
server checks.

## 2026-06-30 Recheck

User attached the same browser console symptom again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production probes at 2026-06-30 10:28 UTC still showed the deployed server path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with `Authorization: Bearer invalid-token` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with fake auth cookies returned `200`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Live `/assets/_nuxt/BbF2n_Qx.js` returns `404`.
- Live current entry chunk contains none of `[Dictionaries] Failed to load`, `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, or `BbF2n_Qx`.

Local code and regression tests confirm the same path:

- `useAssetDictionaries()` uses built-in static definitions and no longer calls `$fetch`.
- `assets/server/middleware/tenant-runtime.ts` short-circuits public dictionary reads before Console auth and tenant-runtime proxying.
- `assets/nuxt.config.ts` registers `/api/v1/dictionaries` and `/assets/api/v1/dictionaries` as Console auth bypass paths.
- `pnpm --dir assets test` passed with 28 tests.

Root cause remains browser-side stale execution state, not the current Assets Worker or current source. The browser tab is executing an old chunk that the server no longer serves.

## 2026-06-30 Recheck From `BbF2n_Qx.js`

User attached the same browser stack again:

```text
BbF2n_Qx.js:4 GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production probes at 2026-06-30 10:57-10:58 UTC showed the current deployed
server and tenant gateway are healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- The same `GET` with `Authorization: Bearer invalid-token` returned `200`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `204`.
- `GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returned `404` with `no-store`.
- Current production HTML references `/assets/_nuxt/LcCaHVVd.js`, not `BbF2n_Qx.js`.
- Current entry chunk contains none of `[Dictionaries] Failed to load`,
  `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, or `BbF2n_Qx`.

Focused regression also passed:

```bash
pnpm --dir assets test -- test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
git -C assets diff --check -- nuxt.config.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/api/v1/dictionaries/index.get.ts server/api/v1/dictionaries/index.head.ts server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
```

Status: DONE. The attached console line is not from the current deployed Assets
bundle. Remaining action is client-side: close the old Assets tab, clear site data or
hard reload with DevTools "Disable cache", and confirm the Network tab loads
`/assets/_nuxt/LcCaHVVd.js` or newer rather than `BbF2n_Qx.js`.

## 2026-06-30 11:14 UTC Recheck

User attached the same stale browser stack again from `BbF2n_Qx.js`.

Fresh production checks still show the current deployed Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with `Authorization: Bearer invalid-token` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with fake auth cookies returned `200`.
- `OPTIONS https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `204`.
- Current production HTML references `/assets/_nuxt/LcCaHVVd.js`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `[Dictionaries] Failed to load`,
  `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, or `BbF2n_Qx`.
- Old `/assets/_nuxt/BbF2n_Qx.js` returns `404 Build asset not found`.

Focused regression passed:

```bash
pnpm --dir assets test -- test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
git -C assets diff --check -- nuxt.config.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/api/v1/dictionaries/index.get.ts server/api/v1/dictionaries/index.head.ts server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
```

Status: DONE. No source change is indicated. The observed console stack is from an old
browser execution context, not from the current production bundle or Worker response.

## 2026-06-30 12:01 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 12:01 UTC still show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` returned `200`, `code=0`, and 37 dictionary
  items.
- `GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returned `404` with
  `cache-control: no-store, no-cache, must-revalidate, max-age=0` and body
  `Build asset not found`.
- Current production HTML references `/assets/_nuxt/LcCaHVVd.js`.

Local verification also passed:

```bash
pnpm --dir assets test -- test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
pnpm --dir foundation test -- test/consoleAuthBypass.test.ts
pnpm --dir assets typecheck
pnpm --dir foundation typecheck
pnpm --dir assets build:cloudflare
```

Status: DONE. The attached console line is not produced by the current deployed Assets
bundle or current Worker response. Remaining action is client-side cache/runtime state:
close all old Assets tabs and open a fresh tab, or clear site data for `wiztek.huizhi.yun`
and reload.

## 2026-06-30 13:21 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 13:21 UTC still show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` returned `200`, `code=0`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns `404 Build asset not found`
  with `no-store`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `BbF2n_Qx`, or `assets-dictionaries`.

Focused regression passed:

```bash
pnpm --dir assets test -- test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
git -C assets diff --check -- nuxt.config.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/api/v1/dictionaries/index.get.ts server/api/v1/dictionaries/index.head.ts server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
git diff --check -- foundation/server/middleware/console-auth.ts
```

Status: DONE. No code change is indicated. The observed console stack is from a stale
browser execution context or preserved old console log, not from the current deployed
Assets Worker.

## 2026-06-30 21:18 ADT Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 21:17-21:18 ADT show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`
  with build id `64b09bee-61d1-4b51-abd5-b5cab5c2e136`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns `404` with
  `no-store`.

Focused regression passed:

```bash
pnpm --dir assets test -- test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
git -C assets diff --check -- nuxt.config.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/api/v1/dictionaries/index.get.ts server/api/v1/dictionaries/index.head.ts server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
```

Status: DONE. No source change is indicated by this report. The reported console line
is still from an old browser execution context; the current Worker and current bundle no
longer reproduce the dictionaries 401.

## 2026-06-30 13:53 UTC Recheck

User attached the same stale browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 13:52-13:53 UTC still show the current deployed
Assets path is healthy:

## 2026-06-30 22:07 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 22:06-22:07 UTC still show the current deployed
Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` returned `200`.
- Current production HTML references `/assets/_nuxt/LcCaHVVd.js`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `[Dictionaries] Failed to load`,
  `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, or `BbF2n_Qx`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns `404 Build asset not found`
  with `no-store`.
- `https://wiztek.huizhi.yun/assets/` HTML is served with `cache-control:
  no-store, no-cache, must-revalidate, max-age=0`.

Focused regression passed:

```bash
node --test --experimental-strip-types test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
node --test --experimental-strip-types test/consoleAuthBypass.test.ts
```

Status: DONE. No source change is indicated. The reported stack is from a stale browser
execution context or preserved old console log, not from the current deployed Assets
Worker.

## 2026-06-30 20:19 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 20:19 UTC show the currently deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and the dictionary payload.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and the dictionary payload.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` still returned `200`, proving the dictionary
  endpoint is bypassing Console auth as intended.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Live `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns `404 Build asset
  not found` with no-store headers.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `BbF2n_Qx`, or `assets-dictionaries`.

Focused regression passed:

```bash
node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts
node --test --experimental-strip-types foundation/test/consoleAuthBypass.test.ts
```

Status: DONE. The attached console line is not produced by the current deployed Assets
bundle or current Worker response. The remaining explanation is stale browser execution
state or preserved console output from an old page context.

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- The same `GET` with `Authorization: Bearer invalid-token` returned `200`, `code=0`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `assets/api/v1/dictionaries`, `BbF2n_Qx`, or
  `assets-dictionaries`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with `no-store, no-cache, must-revalidate, max-age=0`.

Status: DONE. No source change is indicated. The observed console stack is from an old
browser execution context or preserved old console log. Re-deploying the Worker cannot
remove a still-open browser tab's already-loaded JavaScript runtime; the tab must be
closed or site data cleared so the browser loads the current entry chunk.

## 2026-06-30 14:12 UTC Recheck

User attached the same browser stack from old chunk `BbF2n_Qx.js`.

Fresh production checks at 2026-06-30 14:12 UTC still show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns `404` with
  `cache-control: no-store, no-cache, must-revalidate, max-age=0`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, or `BbF2n_Qx`.
- Local focused regression passed with `pnpm --dir assets test -- test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts`.

Status: DONE. No source change is indicated. The attached console stack is from a stale
browser execution context or preserved old console log, not from the current deployed
Assets Worker.

## 2026-06-30 16:48 UTC Recheck

User attached the same browser stack from old chunk `BbF2n_Qx.js`.

Fresh production checks at 2026-06-30 16:48 UTC still show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630`
  returned `200`, `code=0`, and dictionary data.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630`
  returned `200`, `code=0`, and dictionary data.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries?codex_check=invalid_token`
  with `Authorization: Bearer invalid-token` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/?codex_check=20260630` references
  `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with `no-store, no-cache, must-revalidate, max-age=0`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `assets-dictionaries`, or `BbF2n_Qx`.

Status: DONE. No code change is indicated. The latest attachment is still from a stale
browser execution context or preserved old console log; the current deployed endpoint
and current entry chunk do not reproduce the reported 401.

## 2026-06-30 17:43 UTC Recheck

User attached the same browser stack from old chunk `BbF2n_Qx.js`.

Fresh production checks at 2026-06-30 17:43 UTC still show the current deployed Assets
path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630Tnow`
  returned `200`, `code=0`, and 37 dictionary items.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630Tnow`
  returned `200`, `code=0`, and 37 dictionary items.
- The same Wiztek gateway request with `Authorization: Bearer invalid-token` returned
  `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with `no-store, no-cache, must-revalidate, max-age=0`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of
  `[Dictionaries] Failed to load`, `/assets/api/v1/dictionaries`,
  `/api/v1/dictionaries`, `assets-dictionaries`, or `BbF2n_Qx`.

Status: DONE. No code change is indicated. The attached error is still from a stale
browser execution context or preserved old console output, not from the current deployed
Assets Worker or tenant gateway response.

## 2026-06-30 20:35 UTC Recheck

User attached the same browser stack from old chunk `BbF2n_Qx.js`, now also showing an
unauthorized `GET /assets/api/v1/dashboard/overview`.

Fresh production checks still separate the two cases:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and dictionary data.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dashboard/overview` without a browser
  session returned `401` with `请先登录`, which is expected for a protected API when no
  valid access token is supplied.
- Live `https://wiztek.huizhi.yun/assets/?codex_check=20260630T2038` returned `200`
  with `cache-control: no-store, no-cache, must-revalidate, max-age=0`.
- The live HTML references `/assets/_nuxt/LcCaHVVd.js`, not `BbF2n_Qx.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with no-store headers.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `assets/api/v1/dictionaries`, `dashboard/overview`, or
  `BbF2n_Qx`.
- Focused regressions passed:

```bash
node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts
node --test --experimental-strip-types foundation/test/consoleAuthBypass.test.ts
pnpm --dir assets typecheck
git -C assets diff --check -- app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/utils/assetsPermissionRoutes.ts test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts nuxt.config.ts
```

Status: DONE. No source change is indicated. The dictionary failure is not produced by
the current Worker or current frontend bundle. The protected dashboard 401 is only
actionable if reproduced from the current `LcCaHVVd.js` runtime with a logged-in session.

## 2026-06-30 21:02 UTC Recheck

User attached the same browser stack from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks at 2026-06-30 21:02 UTC still show the current deployment is
not serving that code path:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630-latest`
  returned `200`, `code=0`, and the dictionary payload.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries?codex_check=20260630-latest`
  returned `200`, `code=0`, and the dictionary payload.
- `GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returned `404 Build asset
  not found` with `no-store, no-cache, must-revalidate, max-age=0`.
- Live `https://wiztek.huizhi.yun/assets/?codex_check=20260630-latest` references only
  `/assets/_nuxt/LcCaHVVd.js`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `[Dictionaries] Failed to load`,
  `/assets/api/v1/dictionaries`, `/api/v1/dictionaries`, `BbF2n_Qx`,
  `assets-dictionaries`, or `dashboard/overview`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dashboard/overview?codex_check=20260630-latest`
  without browser session returned `401` with `请先登录`, which is expected for a
  protected API without a valid user token.

Focused regressions passed:

```bash
node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts foundation/test/consoleAuthBypass.test.ts
```

Status: DONE. No code change is indicated. The attached dictionary 401 is still from a
stale browser execution context or preserved console output. The only actionable
server-side 401 would be a protected API such as `dashboard/overview` failing from the
current `LcCaHVVd.js` runtime while the browser has a valid logged-in session.

## 2026-06-30 21:24 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks still show the deployed Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` with
  `Authorization: Bearer invalid-token` returned `200`, `code=0`.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with `no-store`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `BbF2n_Qx`, or `assets-dictionaries`.

Focused regression passed:

```bash
node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts
node --test --experimental-strip-types foundation/test/consoleAuthBypass.test.ts
git -C assets diff --check -- nuxt.config.ts app/composables/useAssetDictionaries.ts app/plugins/api-auth.client.ts server/middleware/tenant-runtime.ts server/api/v1/dictionaries/index.get.ts server/api/v1/dictionaries/index.head.ts server/api/v1/dictionaries/index.options.ts server/utils/assetsPermissionRoutes.ts test/assetsPermissionRoutes.test.ts test/consoleAuthOrder.test.ts
```

Status: DONE. No source change is indicated. The console line is from a stale browser
execution context or preserved old DevTools log, not from the current deployed Worker.

## 2026-06-30 21:36 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks still show the current deployed Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200` with the
  dictionary payload.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js`,
  `DWLihDRf.js`, and `CUaJvpRx.js` return `404` from the current deployment.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of
  `[Dictionaries] Failed to load`, `/api/v1/dictionaries`, `BbF2n_Qx`,
  `DWLihDRf`, or `CUaJvpRx`.
- Current HTML is served with `cache-control: no-store, no-cache, must-revalidate,
  max-age=0`; current entry JS is served with `max-age=0, must-revalidate`.

Focused regression passed:

```bash
node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts
```

Status: DONE. No source change is indicated. The attached stack is not produced by the
current deployed Assets frontend bundle or Worker response. Treat future reports from
`BbF2n_Qx.js` as stale browser execution or preserved DevTools output unless the
Network tab proves the current entry chunk is also requesting dictionaries and getting
401.

## 2026-06-30 21:43 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks still show the currently deployed Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- The same `GET` with `Authorization: Bearer invalid-token` returned `200`, `code=0`,
  and 37 dictionary items.
- `GET https://assets.huizhi.yun/assets/api/v1/dictionaries` returned `200`, `code=0`,
  and 37 dictionary items.
- Live `https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- Old `https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returns
  `404 Build asset not found` with `no-store`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `Dictionaries`,
  `api/v1/dictionaries`, `BbF2n_Qx`, or `assets-dictionaries`.

Status: DONE. No code change is indicated by this evidence. The attached console line
is not produced by the current deployed Assets bundle or Worker response.

## 2026-06-30 22:36 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks still show the currently deployed Assets path is healthy:

- `GET https://wiztek.huizhi.yun/assets/` returned `200` with `no-store` and references
  `/assets/_nuxt/LcCaHVVd.js`.
- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`,
  `application/json`, and the dictionary payload.
- The same `GET` with `Authorization: Bearer intentionally-invalid` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returned `404` with
  `no-store`.
- Current local build public chunks contain none of `[Dictionaries] Failed`,
  `/api/v1/dictionaries`, or `/assets/api/v1/dictionaries`.

Focused regression passed:

```bash
cd assets && node --test --experimental-strip-types test/consoleAuthOrder.test.ts test/assetsPermissionRoutes.test.ts
```

Status: DONE. The attached console line still does not match the active production
Assets bundle or Worker response. It is stale browser execution state or a retained
historical DevTools entry, not an active Assets dictionary API 401.

## 2026-06-30 23:07 UTC Recheck

User attached the same browser stack again from old chunk `BbF2n_Qx.js`:

```text
GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401
[Dictionaries] Failed to load
```

Fresh production checks still show the active Assets deployment is healthy:

- `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`,
  `application/json`, and the static dictionary payload.
- `HEAD https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returned `200`.
- `GET https://wiztek.huizhi.yun/assets/` references `/assets/_nuxt/LcCaHVVd.js`.
- `GET https://wiztek.huizhi.yun/assets/_nuxt/BbF2n_Qx.js` returned `404` with
  `cache-control: no-store, no-cache, must-revalidate, max-age=0`.
- Current `/assets/_nuxt/LcCaHVVd.js` contains none of `/api/v1/dictionaries`,
  `[Dictionaries] Failed to load`, or `loadDictionaries`.

Focused regression passed:

```bash
pnpm --dir assets test -- --test-name-pattern "Console auth|permission|dictionary"
pnpm --dir foundation test -- --test-name-pattern "Console auth bypass"
```

Status: DONE. No source change is indicated. This report still points to stale browser
execution state or a retained historical DevTools entry, not the current Assets Worker
or current frontend chunk.
