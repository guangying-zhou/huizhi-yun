# 2026-06-30 Assets API 401 OIDC refresh recovery

## DEBUG REPORT

- Symptom: Browser console reported `GET https://wiztek.huizhi.yun/assets/api/v1/dictionaries 401` and `GET /assets/api/v1/dashboard/overview 401`.
- Evidence collected: Public curl to `https://wiztek.huizhi.yun/assets/api/v1/dictionaries` returns HTTP 200 with dictionary payload on the current deployed build. The current app shell references build id `64b09bee-61d1-4b51-abd5-b5cab5c2e136` and chunk `LcCaHVVd.js`, while the reported console stack referenced older chunks `BbF2n_Qx.js`, `DWLihDRf.js`, and `CUaJvpRx.js`.
- Root cause hypothesis: The dictionary 401 was from a stale frontend chunk. The remaining protected API 401 is caused by OIDC recovery logic requiring a readable access token before attempting refresh, even though refresh is backed by an httpOnly refresh cookie. If the access-token cookie is missing/expired but refresh cookie is still valid, the route guard/API wrapper can let protected API calls reach the server without a UID and receive 401.
- Fix: `foundation/app/composables/useConsoleOidcAuth.ts` now attempts `refresh()` before login even when `token.value` is empty. `assets/app/plugins/api-auth.client.ts` no longer gates `refreshOnce()` on `auth.token.value`.
- Regression tests: Added `foundation/test/consoleOidcRefreshRecovery.test.ts`; extended `assets/test/consoleAuthOrder.test.ts` to assert the Assets API wrapper refreshes without an access-token precondition.
- Verification: `pnpm --dir foundation test -- consoleOidcRefreshRecovery.test.ts consoleAuthBypass.test.ts`, `node --test --experimental-strip-types assets/test/consoleAuthOrder.test.ts assets/test/assetsPermissionRoutes.test.ts assets/test/assetsLocalDevAuthorization.test.ts`, `pnpm --dir foundation typecheck`, `pnpm --dir assets typecheck`, and `git diff --check` all passed.
- Status: DONE_WITH_CONCERNS. Full logged-in Cloudflare verification still needs a browser session with the user's cookies; the Chrome extension was not available in this Codex session.
