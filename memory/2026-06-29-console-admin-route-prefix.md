# 2026-06-29 Console admin route prefix accumulation

## Symptom

On the Console UI, clicking the Console app entry repeatedly changed the URL from `/admin` to `/admin/admin`, then `/admin/admin/admin`, eventually showing:

`Page not found: /admin/admin/admin`

After the first partial fix, returning to a saved Console directory route changed `/directory/departments` into `/admin/directory/departments`, causing:

`Page not found: /admin/directory/departments`

## Root Cause

Console is mounted at the root path. `/admin` is the Console management overview route, not the app base path. The shared app rail restores an app's last visited route by appending the saved route to the app `homeUrl`.

For Console, `homeUrl` is `/admin` but `basePath` is `/`. If the saved last route is `/admin` or a polluted `/admin/admin`, the restore logic can append that route to `/admin` again. If the saved last route is `/directory/departments`, using `homeUrl` as the base incorrectly produces `/admin/directory/departments`.

The last-route plugin could also persist unmatched 404 routes, allowing a polluted route like `/admin/admin` to remain in localStorage.

## Fix

- Current app rail item now links to its home URL directly instead of applying last-route restore.
- Last-route plugin skips routes that do not match the router, preventing 404 paths from being saved.
- App-entry URL resolution now accepts and uses app `basePath`; it only falls back to `homeUrl` path when `basePath` is unavailable.
- Console app entries explicitly set `basePath` to `/`.
- Previously polluted Console last-route values such as `/admin/directory/departments` are normalized back to `/directory/departments`, while real admin child routes such as `/admin/logs` remain unchanged.
- App-entry URL resolution collapses repeated home prefixes and falls back to home when the saved route equals the home route.

## Validation

- `pnpm test` in `foundation` passed.
- `pnpm lint` in `foundation` passed.
- `pnpm typecheck` in `foundation` passed.
- `pnpm lint` in `console` was attempted but is blocked by pre-existing lint errors in unrelated Console files.
- `pnpm typecheck` in `console` was attempted but is blocked by pre-existing missing `ali-oss` declaration errors.
