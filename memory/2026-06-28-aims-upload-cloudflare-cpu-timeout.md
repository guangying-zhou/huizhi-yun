# Aims other document upload Cloudflare CPU timeout

Date: 2026-06-28

## Symptom

Cloudflare Observability for `hzy-aims` reported `Worker exceeded CPU time limit` around repeated `POST /aims/api/v1/projects/:id/other-documents` requests. Nearby logs showed Aims project cabinet upload failures followed by a legacy `codocs/api/dept-cabinet/upload` fallback.

## Root Cause

The upload path proxied the binary through the Aims Worker:

1. Browser posts multipart data to Aims.
2. Aims runs `readMultipartFormData`, buffering/parsing the file in the Worker.
3. Aims copies the bytes into a new `ArrayBuffer`, `Blob`, and `FormData`.
4. Aims posts that new multipart body to Codocs project cabinet.
5. When the project cabinet path failed, Aims retried by uploading the same binary again to the legacy department cabinet endpoint.

This doubled CPU and memory work in the Aims Worker and also violated the project-cabinet-only behavior expected for project documents. If Codocs project cabinet schema/runtime is not ready, Aims should fail explicitly rather than upload the file to the department cabinet.

## Fix

- Removed Aims project-document upload fallback from Codocs project cabinet to Codocs department cabinet.
- Added Cloudflare Worker CPU limit rendering support via `HZY_<APP>_CPU_MS` / `HZY_WORKER_CPU_MS`; production can temporarily deploy Aims with `HZY_AIMS_CPU_MS=300000` on Workers Paid while the binary upload path is moved out of Aims.
- Documented the Aims deploy-time CPU safety setting.

## Follow-up

The durable fix is to avoid proxying large binaries through Aims Worker. Use a two-step project-cabinet upload flow:

1. Aims validates project access and asks Codocs for a short-lived project-cabinet upload session or signed OSS upload URL.
2. Browser uploads the binary directly to Codocs/OSS.
3. Aims indexes only the returned metadata through data-runtime.

Also ensure `codocs/docs/migration_v1.1_project_cabinet_files.sql` has been applied so project cabinet metadata supports `cabinet_files.project_code`.

## Validation

- `aims`: `pnpm test`
- `aims`: `pnpm lint`
- `aims`: `pnpm typecheck`
- `aims`: `git diff --check`
- root: `git diff --check`
- `HZY_AIMS_CPU_MS=300000 pnpm run cloudflare:config` renders `limits.cpu_ms=300000`

`node scripts/validate-business-cloudflare-config.mjs` still fails on the existing broad Aims Nuxt-only marker guardrail in `server/middleware/tenant-runtime.ts`; that guardrail affects many local orchestration endpoints and was not changed as part of the CPU timeout fix.

## Status

DONE_WITH_CONCERNS. Immediate retry/fallback CPU amplification is removed. Full root-cause elimination requires direct/project-cabinet upload session flow.
