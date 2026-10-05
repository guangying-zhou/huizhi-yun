# 2026-07-09 Platform member-permissions CPU timeout

## Symptom

Cloudflare Worker `hzy-platform` exceeded CPU time on:

`GET /api/platform/tenant-admin/member-permissions?tenantCode=C000001&page=1&pageSize=200`

The request is triggered by `/dashboard/member-permissions`.

## Root Cause

The member list branch in `platform/server/api/platform/tenant-admin/member-permissions.get.ts` called `buildDbAuthorizationGrants()` once per listed member to compute `activeRoleCount`.

That helper is a detail/evaluation path: it looks up the user subject, memberships, direct roles, template roles, template overrides, role permissions, role scopes, and assignment scopes. With a large page this expanded a single list request into hundreds of DB calls plus full grant construction in the Worker.

## Fix

The list branch now uses a batched `loadActiveRoleCounts()` helper for the current page. It fetches the page users' active department/job memberships, direct roles, template roles, and template overrides in bulk, then computes per-member distinct effective role counts in memory. The detail branch still uses `buildDbAuthorizationGrants()` for full permission/source/scope expansion.

The frontend request page size was aligned from `200` to the server cap of `100`.

## Verification

- `node --test --experimental-strip-types test/memberPermissionsApi.test.ts`
- `pnpm exec eslint server/api/platform/tenant-admin/member-permissions.get.ts app/components/console/MemberPermissionsManager.vue test/memberPermissionsApi.test.ts`
- `pnpm typecheck`
- `git diff --check`

`pnpm test` still has an unrelated pre-existing failure in `test/authorizationManagerInstanceConflictUi.test.ts`, where the test expects the UI text `实例职责冲突解释`.
