# People dashboard runtime alert

## Symptom

Accessing the People dashboard showed `People data-runtime 暂不可用` with guidance to execute schema and enable the People adapter.

## Root cause

The dashboard alert used one fixed data-runtime message for every `/api/v1/dashboard/overview` fetch error. In local reproduction, the failing upstream was Console authorization (`/api/auth/permissions?appCode=people`) because Console was not running. Direct data-runtime checks showed People was enabled and schema was healthy:

- `/runtime/healthz`: `people.enabled=true`, `people.db=ok`
- `/runtime/schema/status?app=people`: `status=ok`, `missingTables=[]`

So the page was masking permission/Console dependency failures as data-runtime/schema failures.

## Fix

Updated `people/app/pages/index.vue` to classify dashboard load errors:

- `401/403`: People access permission issue
- Console permission endpoint failures: Console authorization service unavailable
- tenant-runtime/data-runtime/adapter errors: People data-runtime unavailable
- fallback: generic dashboard load failure

The alert sanitizes URLs in displayed upstream error messages.

## Evidence

- `node --test --experimental-strip-types people/test/dashboardErrorAlert.test.ts`: passed
- `pnpm --dir people typecheck`: passed
- `node --test --experimental-strip-types people/test/*.test.ts`: 28 tests passed
- Browser render was blocked by the expected unauthenticated Console/OIDC redirect to `localhost:3000` while Console was not running.

## Status

DONE_WITH_CONCERNS: the misleading People page message is fixed. Showing real dashboard data still requires Console auth/permissions to be reachable and the People app to have a valid tenant-runtime token or gateway-injected runtime credentials.
