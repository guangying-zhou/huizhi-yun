# Data Runtime remote update rejected with unknown kid

Date: 2026-07-22

## Symptom

The Enterprise Console Data Runtime page could read runtime health and detect an available version, but `POST /api/v1/console/data-runtime/update` returned 401. The runtime surfaced:

`token is unverifiable: error while executing keyfunc: unknown kid`

## Root Cause

The Data Runtime JWT authenticator cached remote Console JWKS for five minutes. When Console issued a service token with a newly rotated signing `kid`, the verifier looked only in the still-fresh local cache. A cache miss was immediately classified as an invalid JWT; it did not refresh the remote JWKS until the normal five-minute TTL expired or the Agent restarted.

This is a signing-key rotation/cache invalidation bug, not an audience, scope, tenant, deployment, or Console permission failure.

## Evidence

- The tenant Console JWKS endpoint and the Runtime-owned public JWKS endpoint both returned 200 with the same active signing-key list.
- A regression test warmed the authenticator with an old key, rotated the JWKS server to a new key, and then authenticated a token using the new `kid`.
- Before the fix the test reproduced the production error exactly: `token is unverifiable: error while executing keyfunc: unknown kid`.
- After the fix the rotated token verifies immediately and the JWKS server is called exactly twice: initial load plus one forced refresh.

## Fix

- On a cached `kid` miss, remote JWKS is refreshed once before the token is rejected.
- Static `JWKS_JSON` configuration is not refetched.
- Forced refresh has a 30-second global cooldown so arbitrary unknown `kid` values cannot create an unbounded external-fetch loop.
- Updating JWT trust clears both the normal cache and unknown-kid refresh state.

## Regression Test

`data-runtime/internal/auth/auth_contract_test.go` — `TestJWTAuthenticatorRefreshesJWKSOnUnknownKid`

The test also sends repeated unknown kids after the rotation and verifies that the cooldown prevents extra JWKS requests.

## Verification

- `go test ./...` passed.
- `go vet ./...` passed.
- `git diff --check` passed.
- Public runtime health remained 200 on deployed version `0.3.133`; no production mutation was performed during diagnosis.

## Deployment Note

The fix must be included in a version newer than the currently published `0.3.136`. An Agent that still runs the old verifier can usually accept an update after its existing five-minute JWKS cache expires or after a controlled restart; publish the fixed release first, then retry the Console update and confirm `/runtime/healthz` reports the new version.

## Status

DONE_WITH_CONCERNS: root cause is reproduced, fixed, documented, and fully tested locally. The fixed binary has not yet been packaged, published, installed, or re-tested through the production Console button.
