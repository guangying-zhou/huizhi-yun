# Codocs open department document preview 403

Date: 2026-07-02

## Symptom

Logged-in users could see documents under an open department folder, but opening a document from `/codocs/api/open-department-docs/{uuid}` returned `403 Forbidden`.

## Root Cause

`server/api/open-department-docs/[uuid].get.ts` first called `requireOpenDepartmentDocument(event, uuid)`, which verified the document belonged to an open department folder. It then called `getCodocsDocumentMetadata(event, uuid, { actorUid, trusted_department_read_dept_code })` again.

That second call re-entered the ordinary department document detail permission path in data-runtime. For logged-in users who were not members/share recipients of the source department document, the ordinary permission check could return 403 even though the open-folder check had already succeeded.

Follow-up investigation found a second path to the same symptom: data-runtime injects the signed login actor into runtime query as `current_user`, so even a plain `/v1/codocs/documents/:uuid` metadata call can trigger ordinary document permission checks. The open-doc detail endpoint must not use the single-document detail runtime route for authorization.

A separate visibility mismatch could also return 403: list visibility was based on a document's `folder_id` being under any open folder, while detail validation fetched folders by `documents.dept_code`. If a document's dept metadata was stale or different from its actual folder's department, the document appeared in the open page but failed detail validation.

## Fix

Use the metadata returned by `requireOpenDepartmentDocument` directly after the open-folder validation. The endpoint still requires login and still checks that the document is under an open department folder before reading OSS content, but it no longer re-applies ordinary department document membership permission.

`requireOpenDepartmentDocument` now reads candidate metadata through the document list runtime route with `uuid`, then authorizes strictly by the document's actual `folder_id` being inside the open department folder tree. The folder tree helper includes open folders and all descendants, so nested open-directory content is handled consistently.

data-runtime's Codocs document list route now supports a `uuid` filter, avoiding broad list scans for open-doc detail reads.

## Evidence

- Added a regression check in `codocs/test/sensitiveRoutePermissions.test.ts`.
- Added `codocs/test/openDepartmentTree.test.ts` for open folder descendants.
- Added `data-runtime/internal/apps/codocs/open_folders_test.go` coverage for document-list `uuid` filtering.
- Ran `node --test test/openDepartmentTree.test.ts test/sensitiveRoutePermissions.test.ts`: 37 passing tests.
- Ran `pnpm exec eslint` for changed Codocs files.
- Ran `go test ./internal/apps/codocs`.
- Ran `git diff --check` in Codocs and data-runtime.

## Status

DONE
