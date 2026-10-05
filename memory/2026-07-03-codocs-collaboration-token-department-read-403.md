# Codocs collaboration token 403 for department readonly documents

Date: 2026-07-03

## Symptom

Opening a department document that is viewable in readonly mode showed a toast:

`协同不可用 [GET] /codocs/api/collaboration/token?documentName=doc:{uuid}: 403`

The document detail loaded through `/api/documents/{uuid}` but collaboration token acquisition failed.

## Root Cause

Department document detail access supports a verified `dept_code` route query. The Codocs BFF validates it with `requireDepartmentReadAccess` and passes a trusted department read context to data-runtime document detail.

The collaboration token path did not carry that department read context:

- `app/pages/documents/[uuid].vue` had `documentDeptCode`, and document detail used it.
- `useCollaboration` only requested `/api/collaboration/token?documentName=...`.
- `server/api/collaboration/token.get.ts` only passed `actorUid` / `actorName` to data-runtime.
- data-runtime `collaborationContext` allowed only document owner or explicit `document_shares` rows, so department readonly viewers were rejected with 403.

## Fix

- Pass `deptCode` from the document page into `useCollaboration`.
- Include `dept_code` when requesting the collaboration token.
- In the token BFF, validate `dept_code` with `requireDepartmentReadAccess` before passing trusted department read fields to data-runtime.
- In data-runtime, allow trusted department read context to produce a readonly collaboration context when the actor is not owner and has no share row.

This does not grant write access; no-share department access remains readonly.

## Evidence

- `node --test test/sensitiveRoutePermissions.test.ts`
- `pnpm exec eslint 'app/pages/documents/[uuid].vue' app/composables/useCollaboration.ts server/api/collaboration/token.get.ts server/utils/codocsRuntime.ts test/sensitiveRoutePermissions.test.ts`
- `go test ./internal/apps/codocs`
- `git diff --check` in `codocs` and `data-runtime`

## Status

DONE
