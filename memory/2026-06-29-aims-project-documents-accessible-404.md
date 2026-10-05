# 2026-06-29 Aims project documents accessible 404

## Symptom

Production page `https://wiztek.huizhi.yun/aims/projects/252/documents` loads the project page, but the browser console reports:

`GET /aims/api/v1/project-documents/accessible?projectId=252 404`

Other projects do not reproduce the issue.

## Root Cause

`/api/v1/project-documents/accessible` is a Nuxt-only local handler. It calls `getProjectContext(event, projectId, uid)`, and that helper calls tenant-runtime `GET /v1/aims/projects/{projectId}` with only `current_user` and `operator_uid`.

For normal proxied project detail calls, `server/middleware/tenant-runtime.ts` injects visibility context such as `current_user_dept_codes`, `current_user_management_dept_codes`, and project-admin scope. The Nuxt-only document aggregation handler bypasses that middleware path, so it does not pass the same visibility context to runtime.

This explains why only project 252 fails: non-member projects visible as `company + L0/L1` or through whitelist can still pass with only `current_user`, but department-visible, management-visible, L2, or scoped-admin-visible projects require the extra runtime visibility query fields. Runtime treats the simplified query as unauthorized/not visible and returns 404.

## Evidence

- `aims/server/api/v1/project-documents/accessible.get.ts` line 411 calls `getProjectContext(...)`.
- `aims/server/utils/projectDocumentAccess.ts` line 173 calls runtime with `{ current_user, operator_uid }` only.
- `aims/server/middleware/tenant-runtime.ts` lines 398-403 inject project visibility context for proxied GET project paths.
- `aims/server/utils/aimsProjectRuntimeAccess.ts` already provides `buildAimsProjectRuntimeAccessQuery(...)` for Nuxt-only handlers that need equivalent runtime context.

## Recommended Fix

Make `getProjectContext(...)` or the `project-documents/accessible` handler use `buildAimsProjectRuntimeAccessQuery(event, { projectId, uid, baseQuery: { operator_uid: uid } })` when calling runtime project detail and members. Centralizing this in `getProjectContext` is safer because preview/download/access-control document endpoints reuse the same helper.

## Fix Applied

- Added `buildAimsProjectListRuntimeAccessQuery(...)` so Nuxt-only handlers can mirror the proxied project list visibility query without incorrectly treating object-level project admin as global list admin.
- Updated `getProjectContext(...)` to use project visibility context for project detail and members, and list visibility context for actor project codes.
- Updated `/api/v1/project-documents/accessible` to pass the same project visibility context to document, work-item, and deliverable runtime reads.

## Validation

- `pnpm lint` in `aims` passed.
- `pnpm typecheck` in `aims` passed.
- `pnpm test` in `aims` passed.
