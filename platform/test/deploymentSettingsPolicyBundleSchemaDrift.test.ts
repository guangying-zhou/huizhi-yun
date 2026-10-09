import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function docsSource(path: string) {
  return readFileSync(new URL(`../docs/sql/${path}`, import.meta.url), 'utf8')
}

describe('deployment settings policy bundle schema drift handling', () => {
  test('deployment settings falls back when policy_bundles v2 metadata columns are missing', () => {
    const content = source('server/api/platform/tenant-admin/deployment-settings.get.ts')

    assert.match(content, /function isMissingPolicyBundleColumnError/)
    assert.match(content, /async function loadLatestPolicyBundle/)
    assert.match(content, /0 AS policy_revision/)
    assert.match(content, /NULL AS policy_hash/)
    assert.match(content, /LEGACY_POLICY_BUNDLE_SCHEMA_VERSION/)
    assert.match(content, /NULL AS expires_at/)
    assert.match(content, /loadLatestPolicyBundle\(tenantCode, environment\)/)
  })

  test('bundle generation reports a migration action instead of a generic 500', () => {
    const content = source('server/api/platform/tenant-admin/bundles.post.ts')

    assert.match(content, /POLICY_BUNDLE_V2_MIGRATION_MESSAGE/)
    assert.match(content, /isPolicyBundleSchemaDriftError/)
    assert.match(content, /statusCode:\s*503/)
    assert.match(content, /HZY-Platform-SQL-Migration-v2\.24-policy-bundle-v2-repair\.sql/)
  })

  test('v2.24 migration repairs all policy bundle v2 schema dependencies', () => {
    const content = docsSource('HZY-Platform-SQL-Migration-v2.24-policy-bundle-v2-repair.sql')

    assert.match(content, /CREATE TABLE IF NOT EXISTS `tenant_policy_revisions`/)
    for (const column of ['environment', 'policy_revision', 'policy_hash', 'signed_at', 'schema_version', 'issued_at', 'expires_at']) {
      assert.match(content, new RegExp(`COLUMN_NAME = '${column}'`))
    }
    for (const indexName of [
      'idx_policy_bundles_policy_revision',
      'idx_policy_bundles_signed_kid',
      'idx_policy_bundles_expires_at'
    ]) {
      assert.match(content, new RegExp(`INDEX_NAME = '${indexName}'`))
    }
  })
})
