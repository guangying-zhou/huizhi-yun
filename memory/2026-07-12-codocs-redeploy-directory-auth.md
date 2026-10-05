# Codocs redeploy authentication debug report

Date: 2026-07-12

## Symptom

After redeploying Codocs, authenticated production requests failed:

- current-user directory lookup returned 401/403;
- `/codocs/api/documents/stats/my` returned 403 and then 401;
- the optional Workflow pending-task badge returned 403.

## Root causes

1. The shared UserMenu used an arbitrary-user Directory admin API to resolve
   the currently logged-in user's name/avatar. Once the legacy authorization
   fallback was removed, ordinary users correctly lacked this admin permission.
   The first attempted fix also forwarded the Codocs deployment identifier into
   Console policy authorization, producing `C000001-console !== C000001-codocs`.
2. Console initially lacked the Codocs service-client grants required to mint
   `data-runtime:codocs:read` and `tenant-runtime:codocs:read` tokens.
3. The copied Data Runtime installer configured production Agents with
   `HZY_DATA_RUNTIME_AUTH_MODE=static_token`, while managed Cloudflare apps use
   Console-issued service JWTs. The Agent therefore returned
   `invalid_static_token` (401) for a valid JWT.
4. Workflow proxy resolution used the independent Workflow origin before the
   tenant-gateway route, so the forwarded Codocs runtime app identity conflicted
   with the Workflow token request.

## Fixes and production changes

- Added a current-session `/api/directory/me` BFF backed by Console `/auth/me`;
  UserMenu no longer requires arbitrary-user directory permission.
- Directory forwarding keeps the verified session and tenant gateway trust but
  no longer leaks the caller deployment into Console policy evaluation.
- Applied Console seed v1.54, granting the active Codocs service client read and
  write scopes for both data-runtime and tenant-runtime Codocs resources.
- Changed Platform-generated install commands to set JWT auth, Console issuer,
  and Console JWKS URL. Re-running the command updates an existing Agent's auth
  variables without interactive database reconfiguration.
- Published signed immutable Data Runtime `0.3.97` and promoted it to R2 latest.
- Platform now approves `0.3.97` and exposes the JWT issuer in its Cloudflare
  runtime configuration.
- Managed Workflow proxy resolution now re-enters the trusted tenant domain so
  Tenant Gateway supplies the Workflow target identity. Optional task-list
  reads degrade to an empty list when Cloudflare refuses that Worker-to-domain
  loop with 522, instead of surfacing a page error.

## Verification

- Foundation lint/typecheck passed; all 173 tests passed before the Workflow
  routing follow-up, whose targeted tests, lint, and typecheck also passed.
- Codocs lint/typecheck passed; all 128 tests passed.
- Platform lint/typecheck passed; all 190 tests passed; Cloudflare build and
  deploy completed as Worker version `f47aea2a-38bc-49e7-8719-267d070d0c71`.
- Data Runtime `go test ./...` and `go vet ./...` passed; signed `0.3.97` R2
  fixed/latest artifacts and public downloads were verified.
- Codocs Cloudflare deploy completed as Worker version
  `ef57f22a-99af-4196-9dda-0df19aa50344`.
- Fresh authenticated production reload returns 200 for
  `/codocs/api/directory/me`; the former arbitrary-user request is no longer
  emitted.

## Data Runtime remote-update follow-up

After the tenant owner re-ran the generated installation command, the Agent was
healthy on `0.3.96` with JWT/JWKS configuration. Console still could not trigger
the published `0.3.97` update and returned:

`token has invalid claims: token has invalid audience, token has invalid issuer`

The Console OIDC authority was derived from the current request host whenever
the build-time runtime config did not contain an explicit issuer. Consequently,
the same Worker published and signed tokens with `iss=https://wiztek.huizhi.yun`
when reached through Tenant Gateway, while the Agent correctly required the
canonical `https://console.huizhi.yun`. The first `aud=data-runtime` attempt
failed on issuer; the compatibility retry used `aud=tenant-runtime`, so its final
error reported both invalid issuer and invalid audience.

The fix makes `getOidcIssuer()` read the Cloudflare runtime
`CONSOLE_OIDC_ISSUER` before any request-host fallback. The production config
generator pins and validates that value as `https://console.huizhi.yun`.
Regression coverage is in `console/test/oidcIssuerCanonicalization.test.ts`.

Console lint and typecheck passed; all 272 tests completed with 271 passing and
one existing MySQL integration test skipped. The Cloudflare build, dry run and
production deploy passed as Worker version
`a35ae4fd-3176-4f87-851c-9f5ae305704a`. Fresh public verification now shows
both canonical and tenant-domain discovery endpoints publishing:

- issuer: `https://console.huizhi.yun`
- JWKS: `https://console.huizhi.yun/.well-known/jwks.json`

The Agent remained healthy on `0.3.96` immediately after the Console deploy.

## Remaining operator action

Refresh the existing Enterprise Console Data Runtime page and click “更新版本”
once. The browser session available to the debugger contained only Portal and
Codocs tabs; the Portal's Console launcher also incorrectly pointed back to
`/profile`, so the authenticated update action could not be reproduced from
that session. After the click, verify `/runtime/healthz` reports `0.3.97`, then
recheck Codocs data requests.

## Status

DONE_WITH_CONCERNS: the issuer root cause is fixed, deployed, regression-tested,
and verified through both public discovery paths. The final authenticated update
click and resulting Agent `0.3.97` observation remain an operator verification.

## Deployment binding and automatic downgrade follow-up

The next authenticated Codocs request reached the Agent but failed with
`deployment_mismatch`: Console minted a runtime token with deployment
`C000001-console`, while the enrolled Codocs source deployment was
`C000001-codocs`. Console service-token issuance now binds the deployment claim
to the verified Tenant Gateway source context. Console and Codocs were deployed
as Worker versions `8aa4c598-040f-4651-8b45-775d905ef536` and
`bfeb62e2-f82f-4828-b777-c7160213e16c`, respectively.

Server diagnostics then showed that Data Runtime had repeatedly changed from
`0.3.97` back to `0.3.96`. This was not a startup rollback: the existing
unpinned auto-update policy retained target version `0.3.96` when the installer
was rerun, and the five-minute timer successfully enforced that stale target.

Data Runtime `0.3.98` fixes this by reconciling unpinned policies to the
installer target while preserving explicit pinned policies. Ordinary update
execution now also refuses semantic-version downgrades; rollback remains a
separate guarded operation. Regression tests cover both behaviors. `go test
./...` and `go vet ./...` passed, and the signed immutable `0.3.98` artifacts
were published and promoted to R2 latest.

Platform's exact approved version was updated to `0.3.98` and deployed to
Cloudflare as Worker version `728d264b-626f-4b4a-9db4-940f836f84ff`. Public
latest, pinned version and manifest endpoints all report `0.3.98`. The tenant
must now rerun the copied install command once. That run installs `0.3.98` and
rewrites the tracking policy target to `0.3.98`, preventing the timer from
returning the Agent to `0.3.96`.
