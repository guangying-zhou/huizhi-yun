# AIMS deliverable document binding succeeded but did not update the card

## Symptom

After selecting a work-result document and confirming, AIMS showed a success toast but the execution card could still show `选择文档` instead of the selected file information.

## Root cause

The deliverable PATCH mutation returned only `{ updated: true }`. The page then depended on a full `execution-context` reload to discover the new binding. That broad reload could race with another in-flight context request, allowing an older response to overwrite the newly saved deliverable and leave the UI stale even though persistence succeeded.

Production validation also exposed three independent authorization defects on the document path:

1. AIMS project scope facts were not preserved as a signed delegation to Codocs.
2. Data Runtime classified the structured read-only `POST /v1/codocs/document-access/check` as a write solely from its HTTP method.
3. The credential-backed `aims.runtime` identity lacked the audience-qualified `data-runtime:codocs:read` and `tenant-runtime:codocs:read` grants.

## Fix

- The Runtime PATCH returns the canonical updated `executionDeliverable` row.
- The execution page reloads related context, then atomically replaces the matching deliverable with the mutation response before showing success.
- Codocs project/role facts are accepted only from a valid signed AIMS actor delegation.
- The document access check is explicitly classified as read-only.
- Existing tenants can reconcile only the two fixed AIMS-to-Codocs read grants through an idempotent, audited operation protected by `service_clients:admin`, `console:service-client:grant`, and a signed Console administrator actor. The repair accepts no caller-selected identity, resource, action, or scope.

## Validation

- Data Runtime `go test ./...` passed.
- Console lint, typecheck, and all 407 tests passed.
- AIMS regression coverage verifies that the page consumes the canonical mutation response after context reload.
- Production Data Runtime `0.3.180` (`b3e3bbf0`) is healthy for every adapter.
- The production grant repair returned `aims.runtime：data-runtime:codocs:read、tenant-runtime:codocs:read`.
- AIMS production successfully opened and rendered `Huizhi-yun-PRD.md` through the restored document-access path.
- Existing work result `HZY-1-1` displays the filename, repository path, and frozen commit instead of `选择文档`.

## Evidence

- `.gstack/qa-reports/issue-011-project-document-access-after.png`
- `.gstack/qa-reports/issue-012-deliverable-document-binding-after.png`
- Primary commits: `db8e6198`, `a5d191c1`, `b70d5fbf`, `0c434020`, `b3e3bbf0`
