# Aims other document upload 500

## Symptom

Aims project document upload for non-Markdown files returned HTTP 500 from `/api/v1/projects/:id/other-documents`.

## Root cause

The Aims endpoint uploads non-Markdown files through Codocs department cabinet:

1. Aims calls Codocs `/api/dept-cabinet/upload`.
2. Codocs uploads the binary to OSS.
3. Codocs writes cabinet metadata through tenant-runtime/data-runtime.
4. Aims writes the `project_documents` index through Aims data-runtime.

The Codocs department cabinet upload handler still used `createOSSClient()`, which only reads local OSS runtime config and throws `OSS credentials not configured` when credentials are supplied through Console runtime integration.

Follow-up investigation showed a second issue in the first attempted fix: `createRuntimeOSSClient()` did lazy-load Console OSS config, but `loadCodocsOssRuntimeConfigFromConsole()` did not accept/pass the current `H3Event`. In Cloudflare managed runtime the tenant/deployment/gateway context comes from request headers, so per-request lazy loading without `event` still cannot resolve tenant OSS integration config reliably.

## Fix

Changed:

- `codocs/server/api/dept-cabinet/upload.post.ts` to use `await createRuntimeOSSClient({ event, timeout: 300000 })` instead of direct `createOSSClient()`.
- `codocs/server/utils/ossRuntime.ts` so `loadCodocsOssRuntimeConfigFromConsole(integrationCode, event)` passes event to Foundation `getOssIntegrationConfig`.
- `codocs/server/utils/oss.ts` so runtime-backed OSS clients can accept `event` and use it when lazy-loading Console OSS config, while not forwarding `event` to the OSS SDK client options.

## Verification

- `pnpm lint` in `codocs/` passed.
- `git diff --check` in `codocs/` passed.
- `pnpm typecheck` in `codocs/` still fails on existing unrelated Milkdown/Vueuse type resolution and implicit-any errors; no errors pointed at `server/api/dept-cabinet/upload.post.ts`.

## Follow-up

If personal cabinet upload reports the same 500, apply the same `createRuntimeOSSClient` migration to `codocs/server/api/cabinet/upload.post.ts`.
