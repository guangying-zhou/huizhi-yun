# People HR director scoped authorization

## Symptom

After switching to `hr_director`, the Console shell showed role simulation active, but:

- `/people/` showed `People 访问权限不足` with upstream message `only authorized users can access this employee record`.
- `/people/employees` showed the old generic employee data unavailable alert.

The user confirmed the simulated HR role has `people:admin`.

## Root cause

Final production root cause after logged-in Chrome verification:

People BFF's runtime proxy depended on `event.context.consoleAuth` for `currentUser`, but `people/server/middleware/tenant-runtime.ts` did not explicitly resolve Console auth with the session bridge before permission checks and data-runtime forwarding. The flat permission guard still passed because `assertPeoplePermission()` independently forwarded browser cookies to Console. The row-level scoped query then saw an empty current user, injected `current_user_employee_access=none`, and data-runtime returned `403 people_employee_access_denied`.

Earlier contributing mismatch:

People BFF has two authorization layers:

- `assertPeoplePermission()` checks the flat Console permission snapshot and treats `people admin/admin` as an application-level fallback admin permission.
- `resolvePeopleEmployeeAccessQuery()` resolves row-level data scope for data-runtime, but only matched the requested resource, such as `employees/view`, and did not treat `admin/admin` as the same application-level fallback.

That mismatch could allow navigation and the BFF permission guard to pass while injecting `current_user_employee_access=none` into data-runtime.

The same scoped query also did not inject trusted `current_user` / `operator_uid`, while data-runtime needs `current_user` to evaluate `self` / `dept` scopes. Browser-supplied `current_user` query parameters were not stripped before forwarding.

## Fix

- `people/server/utils/peopleScopedAuthorization.ts`
  - Treat `people admin/admin` as matching scoped access for People resources.
  - Inject trusted `current_user` and `operator_uid` from the authenticated Console user into runtime scope query.
- `people/server/middleware/tenant-runtime.ts`
  - Resolve `event.context.consoleAuth` with `resolveConsoleAuthWithSessionBridge(event)` before service/user permission checks and tenant-runtime forwarding.
  - Strip browser-supplied `current_user`, `currentUser`, `operator_uid`, and `operatorUid` before merging BFF-generated scope query.
- `people/test/peopleRoleSplit.test.ts`
  - Added regression coverage for app-admin scoped access, trusted actor query injection, and the required session bridge call before forwarding.

## Verification

- `node --test --experimental-strip-types people/test/peopleRoleSplit.test.ts`: passed.
- `node --test --experimental-strip-types people/test/*.test.ts`: 30 tests passed.
- `pnpm --dir people typecheck`: passed.
- `pnpm --dir people run deploy:cloudflare`: deployed `hzy-people` version `c949dc18-7c84-4f57-b246-55a97072a2fc`.
- `wrangler secret list --config people/.wrangler.generated.jsonc`: `HZY_CLOUDFLARE_INTERNAL_TOKEN` present.
- Logged-in Chrome production verification:
  - `/people/` renders People 工作台 with real metrics: 在职员工 83, 当前任职 91, 进行中周期 2, 快捷入口 4.
  - `/people/employees` renders the employee table and `91 人`.
  - No new Chrome console error/warn logs for both pages.

## Status

DONE: code is fixed, deployed, and verified in the user's logged-in Chrome session.
