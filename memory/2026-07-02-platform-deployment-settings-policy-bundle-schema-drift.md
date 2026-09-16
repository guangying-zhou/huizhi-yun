# Platform Deployment Settings Policy Bundle Schema Drift

## Symptom

After redeploying Platform, `/dashboard/deployments` showed a red `Server Error`. Browser console showed 500 responses from `/api/platform/tenant-admin/deployment-settings?environment=prod`.

## Root Cause

The deployment settings API selects the latest policy bundle and now reads Policy Bundle v2 metadata columns such as `policy_revision`, `policy_hash`, `schema_version`, `issued_at`, and `expires_at`. Existing production databases can lag the code deployment and miss one or more of those `policy_bundles` columns or the `tenant_policy_revisions` table. MySQL then raises an unknown-column or missing-table error and the whole page settings request fails.

## Fix

- `platform/server/api/platform/tenant-admin/deployment-settings.get.ts` now catches missing Policy Bundle v2 metadata columns and falls back to a legacy latest-bundle projection instead of failing the entire page load.
- `platform/server/api/platform/tenant-admin/bundles.post.ts` now maps Policy Bundle v2 schema drift during generation to an actionable 503 that names the repair migration.
- `platform/docs/sql/HZY-Platform-SQL-Migration-v2.24-policy-bundle-v2-repair.sql` adds an idempotent repair migration for `tenant_policy_revisions`, `policy_bundles` v2 columns, and indexes.

## Evidence

- `node --test --experimental-strip-types test/deploymentSettingsPolicyBundleSchemaDrift.test.ts`
- `node --test --experimental-strip-types test/policyBundleSchemaVersion.test.ts`
- `pnpm --dir platform typecheck`
