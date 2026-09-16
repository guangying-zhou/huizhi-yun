# Console Data Runtime update sent bootstrap JWT to management endpoint

Date: 2026-07-23

## Symptom

The Console Data Runtime page could read Runtime health and detect release
`0.3.138`, but manually triggering the update returned HTTP 401:

`token is unverifiable: error while executing keyfunc: unknown kid`

The running Runtime was healthy on `0.3.137`.

## Root Cause

Tenant Gateway injects a short-lived Platform Runtime bootstrap JWT through the
legacy-compatible `x-hzy-data-runtime-token` header. This token has:

- `token_use=platform_runtime_bootstrap`
- `aud=data-runtime-bootstrap`
- Platform signing `kid`
- scope `console:service-token:issue`

Its only purpose is to let Console exchange for an exactly scoped short-lived
Console service token.

`console/server/utils/dataRuntimeManagement.ts` treated every trusted
`x-hzy-data-runtime-token` value as a direct static Runtime credential. It sent
the Platform bootstrap JWT directly to `/runtime/update`. The general Runtime
JWT verifier trusts Console OIDC keys for this endpoint, not Platform bootstrap
keys, so the Platform `kid` correctly failed as unknown.

This also made the UI incorrectly display `已配置静态凭证` for the managed
Tenant Gateway bootstrap flow.

## Evidence

- The released `0.3.137` binary contains the unknown-`kid` JWKS refresh fix, so
  this was not caused by an older Runtime binary.
- Public Runtime health reported `0.3.137` and all adapters healthy.
- Public Console JWKS was reachable and included the current Console signing
  keys.
- The managed Tenant Gateway source injects the Platform bootstrap token into
  `x-hzy-data-runtime-token`.
- The Console management source preferred that header over
  `requestServiceAccessToken`, bypassing the intended token exchange.
- The production page reported a configured static credential even though the
  tenant uses managed Gateway bootstrap.

## Fix

- Explicit offline/dedicated Runtime token environment values remain supported
  and take precedence.
- A trusted Gateway token is classified with the existing Foundation
  `isPlatformRuntimeBootstrapToken` helper.
- Platform bootstrap JWTs are excluded from direct Runtime management calls.
- Console then follows the existing `requestServiceAccessToken` path, which
  exchanges the bootstrap credential for a Console service token scoped to
  `runtime.update`.
- Genuine legacy opaque Gateway static tokens remain compatible.

## Regression Test

`console/test/dataRuntimeAuthFallback.test.ts` verifies that the management
client imports the shared bootstrap-token classifier and refuses to return the
bootstrap JWT as a static update credential.

The regression test failed before the fix and passed afterward.

## Verification

- Focused regression: 4/4 passed.
- Console full test suite: 389/389 passed.
- Console ESLint: passed.
- Console Nuxt typecheck: passed.
- Console Cloudflare build: passed.
- Wrangler 4.110.0 deployment dry-run: passed.
- Root and Console `git diff --check`: passed.

The local validation used Node 25.8.1 while the repository declares Node
`>=24.18.0 <25`; pnpm emitted an engine warning, but all checks completed
successfully.

## Deployment Note

The fix is in Console, not Data Runtime. Console must be deployed before the
production button can be re-tested.

After this fix was deployed, the original unknown-`kid` failure was resolved,
but the exchange exposed a second, independent Console bug: the management
client eagerly requested a legacy deployment-bound fallback token even for
modern Runtime versions. The service-token issuer correctly rejected that
invalid override with
`console_service_token_deployment_override_invalid`. See
`memory/2026-07-23-console-data-runtime-update-deployment-override.md`.

## Status

DONE_WITH_CONCERNS: this root cause is fixed and was confirmed by the changed
production error. End-to-end success also requires the follow-up deployment
override fix.
