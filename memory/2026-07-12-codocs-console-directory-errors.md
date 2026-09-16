# Codocs Console directory errors — 2026-07-12

## Symptom

Opening an authenticated Codocs document produced repeated browser console errors:

- `GET /codocs/api/account/users` → 401
- `GET /codocs/api/account/users?search=<uid>` → 401
- `GET /codocs/api/account/user?uid=<uid>` → 401
- `GET /codocs/api/issues/pending-count?project_code=<code>` → 401

The global Vue handler logged the user-picker failure a second time, so the visible error count was higher than the number of failing requests.

## Root cause

1. The new Console directory service route accepted an `aud=console` service token in its handler, but Foundation's generic Console auth middleware first tried to validate that token as a Console user-client audience. The request was rejected before the handler could verify its exact service capability.
2. The current-user compatibility route and Issue project-scope resolver still used legacy anonymous calls to Console's administrative Directory endpoints. Production correctly rejects those calls.

## Fix

- Route `/api/v1/console/service/directory/**` around generic user-audience middleware; every handler still performs active-token, target-app, tenant and exact-scope verification.
- Add a sanitized `console:directory-project-access:read` endpoint for one project and one actor.
- Route Codocs user lookup, current-user compatibility lookup and Issue project-scope facts through retry-aware Console service-token calls.
- Forward only a cryptographically trusted tenant-gateway context with the downstream Console service request, so Console can bind the service actor to the same tenant/deployment.
- Keep employee email/mobile and project member lists outside the service responses.
- Grant only `console:directory-users:read` and `console:directory-project-access:read` to the Codocs service client.

## Regression coverage

- Console contract tests assert auth-before-read, tenant binding, sanitized fields, exact grants and middleware routing.
- Codocs contract tests assert verified browser session before user lookup, retry-aware service-token use, and absence of anonymous administrative Directory calls.
- Console and Codocs lint, typecheck and full test suites are required before deployment.

## Status

Implementation and production deployment complete.

- Console Worker: `35312c73-e5e4-439d-b284-c8e1af4fef77`
- Codocs Worker after trusted gateway forwarding fix: `3e60cb04-26f2-4119-a312-65604fc7730c`
- Production grants verified active for `codocs.runtime`.
- Console: lint/typecheck passed; 278 tests passed, 1 existing environment-dependent MySQL test skipped.
- Codocs: lint/typecheck passed; 131 tests passed.

The first post-deploy browser pass exposed the missing downstream gateway headers and led to the final Codocs Worker above. A fresh authenticated browser reload is still needed to confirm the final Worker has no new console errors; the user's active Chrome tab was not interrupted further.
