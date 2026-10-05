# Codocs OSS preview and title corruption debug report

Date: 2026-07-12

## Symptom

- `GET /codocs/api/documents/{uuid}` failed because Console returned 404 for
  `/api/v1/console/integrations/oss.default`.
- Opening the editor after that failure could persist the placeholder title
  `未命名文档`, replacing the real document title.

## Root cause

The production `oss.default` integration existed and was active, but the active
`codocs.runtime` grants for `integration_config:view` and
`credential_vault:resolve` only contained `{"source":"env"}`. Console's
executable integration authorization requires an explicit
`integrationCodes` allowlist, so the configuration read was intentionally
hidden as 404 and secret resolution would also have been rejected.

Independently, the document editor initialized its model with `未命名文档`.
When metadata/content loading failed, the editor could still become ready;
page-hide or navigation flushing then treated the placeholder as an unsaved
title and wrote it through the document update API.

## Fix

- Added and applied Console seed v1.55, binding both Codocs service grants to
  `integrationCodes=["oss.default"]` and the vault grant to
  `usageTypes=["integration"]`.
- Added a document-loaded state gate. Save, navigation flush, page-hide flush,
  editor-ready state and unmount flush now remain disabled until a successful
  document response has initialized both the model and saved state.
- Restored document `11d4828d-6e2e-4ee3-a461-ae22b4c92eae` to
  `Huizhi-yun Altoc 商业合同与履约中枢 P0–P3 实施方案`, using its OSS path and
  first Markdown heading as corroborating sources.

## Evidence

- Production grant query shows active `integration_config:view` and
  `credential_vault:resolve` scopes containing `oss.default`.
- Codocs lint and typecheck passed; all 129 tests passed, including the new
  load-failure write guard.
- The Console integration authorization test passed with the v1.55 seed
  contract.
- Codocs deployed to Cloudflare as Worker version
  `b0f1fdaa-771c-40db-b416-95249e554adf`.
- Fresh authenticated reload rendered the restored title and Markdown headings;
  no `oss.default` or `Failed to fetch document` browser errors were emitted.

## Regression tests

- `codocs/test/documentLoadFailureWriteGuard.test.ts`
- `console/test/integrationSecretResolveAuthorization.test.ts`

## Status

DONE
