# Console workspace menu hijacked by last Console route

- Date: 2026-07-03
- Area: `foundation` app route memory / `console` workspace portal
- Status: DONE

## Symptom

Clicking the application menu item "工作台" highlighted "控制台" and displayed the last Console page. Clicking "工作台" again then showed the workspace correctly.

## Root Cause

Foundation's last-route restore middleware treated `/` as the current app home for every app. Console has two portal entries in the same Nuxt app:

- `workspace` -> `/`
- `console` -> `/admin`

The runtime appCode is still `console`, so a first navigation to `/` could read `hzy:last-route:console` and redirect back to the last Console admin page. After that first redirect, the per-lifecycle `restoreChecked` flag was set, so the second click worked.

## Fix

Added `shouldRestoreLastRouteOnLanding()` in `foundation/app/utils/appLastRoute.ts` and used it from `foundation/app/middleware/app-last-route.global.ts`.

The restore now only runs for initial app-home landing, and explicitly does not restore Console last routes when landing on `/`, because Console `/` is the workspace portal, not the Console admin app entry.

## Validation

From `/Users/gavin/Dev/huizhi-yun`:

- `pnpm --dir foundation exec tsx --test test/appLastRoute.test.ts`
- `pnpm --dir foundation exec eslint app/utils/appLastRoute.ts app/middleware/app-last-route.global.ts test/appLastRoute.test.ts`
- `git diff --check -- foundation/app/utils/appLastRoute.ts foundation/app/middleware/app-last-route.global.ts foundation/test/appLastRoute.test.ts`
- `pnpm --dir foundation test`
- `pnpm --dir foundation typecheck`

All passed.
