# Console Data Runtime update requested an invalid deployment override

Date: 2026-07-23

## Symptom

After the managed Platform bootstrap JWT was correctly exchanged instead of
being sent directly to Data Runtime, manually triggering a Runtime update
returned HTTP 403:

`deploymentCodeOverride is not bound to the authenticated Runtime`

The upstream code was
`console_service_token_deployment_override_invalid`.

## Root Cause

The Console management client builds its service-token candidates before it
starts calling `/runtime/update`.

The update call supplied the Runtime health deployment identifier, for example
`c000001-prod-tenant-runtime`, as `runtimeDeployment`. The client eagerly asked
the Console service-token issuer to use that value as
`deploymentCodeOverride`, even when the current Runtime was `0.3.137`.

The authenticated caller is the Console application Runtime, whose trusted
deployment is the Console application deployment. The Runtime instance
identifier is deliberately not interchangeable with that application
deployment, so the issuer correctly rejected the override before the valid
non-override token candidate could be attempted.

Git history and the existing call-site flag show that this deployment-bound
token path is a compatibility workaround only for Runtime `0.3.103`. The
client had the `preferRuntimeDeployment` version gate, but did not use it to
control whether the override token was created.

## Fix

`fetchRuntimeManagement` now creates a deployment-override token candidate only
when all of the following are true:

- no explicit static Runtime token is configured;
- a Runtime deployment identifier is available;
- the caller explicitly sets `preferRuntimeDeployment`.

The existing update and status call sites set that flag only for Runtime
version `0.3.103`. Modern versions therefore use the normal Console service
token bound to the authenticated Console deployment. The legacy compatibility
path remains available for `0.3.103`.

## Regression Test

`console/test/dataRuntimeAuthFallback.test.ts` now freezes both sides of the
contract:

- deployment override creation is gated by `input.preferRuntimeDeployment`;
- the call site enables that flag only for Runtime `0.3.103`.

The focused test failed before the implementation change and passed after it.

## Verification

- Focused regression: 4/4 passed.
- Console full test suite: 389/389 passed.
- Console ESLint: passed.
- Console Nuxt typecheck: passed.
- Console Cloudflare build: passed.
- Wrangler 4.110.0 deployment dry-run: passed.
- Root and Console `git diff --check`: passed.

The local validation used Node 25.8.1 while the repository declares Node
`>=24.18.0 <25`; pnpm emitted an engine warning, but every check completed
successfully.

## Deployment Note

This is a Console-only change. Data Runtime `0.3.137` does not need to be
republished. Production end-to-end verification requires redeploying Console
with this follow-up fix and triggering the update again.

## Status

DONE_WITH_CONCERNS: root cause is confirmed, the regression failed before the
fix and passes after it, and the full Cloudflare deployment preflight passes.
The newly built Console has not yet been deployed and exercised in production.
