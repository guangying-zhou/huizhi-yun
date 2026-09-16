# Aims simulated default user could access system management

Date: 2026-07-08

## Symptom

When simulating a default-permission user in Aims, the UI could still access system management.

## Root Cause

Aims had two paths that could inherit or reuse admin authority outside the simulated user's effective Aims permissions:

- `/api/auth/permissions` and `server/utils/checkPermission.ts` requested Console runtime snapshots with local `globalAdminExpansion`, which could expand global admin roles into local `aims:admin` resources inside Aims.
- The Aims layout, global route middleware, weekly report page, portfolio management page, and runtime access checks accepted role whitelists such as `aims:admin`, `console:admin`, `console:console-dev-admin`, `system_admin`, `platform:admin`, and `super_admin`.

This violated simulation isolation: simulated mode should evaluate only the simulated role or target user's effective permissions, not the real operator's admin roles.

## Fix

- Removed Aims-local `globalAdminExpansion`; Aims now uses the Console runtime snapshot as-is.
- Changed Aims system-management access from role checks to Aims resource permission checks, primarily `admin:admin`.
- Forced the Aims layout and admin route guard to refresh the current authorization snapshot for sensitive/admin routes, reducing stale pre-simulation snapshot reuse.
- Removed cross-app admin role bypasses from Aims UI and runtime weekly report access paths.
- Added a regression test to prevent reintroducing inherited operator admin access for Aims system management.

## Verification

- `node --test --experimental-strip-types aims/test/aimsRoleSplit.test.ts`
- `node --test --experimental-strip-types aims/test/sensitiveRoutePermissions.test.ts`
- `pnpm --dir aims typecheck`
- `pnpm --dir aims lint`

