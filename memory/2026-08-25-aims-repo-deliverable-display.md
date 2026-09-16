# AIMS repository deliverable stayed visually unlinked after saving

## Symptom

Selecting and confirming a repository Markdown document showed a success toast, but the work result card still displayed `选择文档`, did not show the file, and the completion check still reported the required deliverable as missing.

## Evidence

Production deliverable `206` was correctly persisted with `document_source=repo`, `repo_project_code=huizhi-yun/huizhiyun`, `repo_file_path=docs/Huizhi-yun-PRD.md`, and a frozen `repo_commit_id`. Its `document_uuid` was correctly `NULL` because that column belongs to Codocs documents.

## Root cause

The execution page used `documentUuid` as the only linked-document predicate. Repository bindings intentionally do not have a Codocs UUID, so the button, preview card, and completeness check all treated a valid repository binding as empty.

## Fix

- A Codocs document is linked when `documentUuid` is present.
- A repository document is linked when both `repoProjectCode` and `repoFilePath` are present.
- Reuse that source-aware predicate for the select/change button, preview card, picker initial value, and completion check.
- Display the repository path and short commit snapshot in the work result card.

## Validation

- Added `executionDeliverableDocumentBinding.test.ts`.
- `pnpm --dir aims lint`
- `pnpm --dir aims typecheck`
- `pnpm --dir aims test` (245 passing)
