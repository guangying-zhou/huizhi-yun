# Aims project document download 403 via Codocs department cabinet

Date: 2026-06-28

## Symptom

Aims non-Markdown project document download returned 403 with Codocs message `缺少部门文档导出权限`.

## Root Cause

Aims uploaded non-Markdown project documents through Codocs `dept-cabinet/upload`. The upload path used `codocs/projects/{project_code}/cabinet/...` when `project_code` was present, but metadata was still registered through the department cabinet scope and did not persist `project_code`. Download then redirected the browser to Codocs `/api/dept-cabinet/{uuid}/download`, which requires the user's Codocs department export permission instead of Aims project document access.

## Fix

- Added Codocs/data-runtime `project-cabinet` metadata support backed by `cabinet_files.project_code`.
- Added Codocs service-only APIs:
  - `POST /api/v1/project-cabinet/upload`
  - `GET /api/v1/project-cabinet/{uuid}/download-url`
- Changed Aims non-Markdown upload to use Codocs project cabinet.
- Changed Aims download to validate Aims document access, request a Codocs project-cabinet signed URL with service token, then redirect to OSS.
- Added legacy fallback for files already uploaded to department cabinet when their OSS path and Aims index prove they are project cabinet files.

## Validation

- `data-runtime`: `go test ./...` passed.
- `aims`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `git diff --check` passed.
- `codocs`: `pnpm lint`, `git diff --check` passed.
- `codocs`: full `pnpm typecheck` still fails on existing Milkdown/Vueuse dependency type issues unrelated to project-cabinet; filtered output showed no project-cabinet errors.

## Deployment Note

Run `codocs/docs/migration_v1.1_project_cabinet_files.sql` before relying on project cabinet uploads. Without `cabinet_files.project_code`, new uploads fail explicitly instead of silently becoming department files.
