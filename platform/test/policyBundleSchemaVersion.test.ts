import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('policy bundle schema version', () => {
  test('generates policy-bundle.v2 as the primary schema and strips replaced v1 authorization fields', () => {
    const content = source('server/utils/policyBundle.ts')

    assert.match(content, /const POLICY_BUNDLE_SCHEMA_VERSION = POLICY_BUNDLE_V2_SCHEMA_VERSION/)
    assert.match(content, /schemaVersion: POLICY_BUNDLE_SCHEMA_VERSION/)
    assert.match(content, /buildPolicyBundleV2CompatFields/)
    assert.match(content, /stripLegacyPolicyBundleAuthorizationFields/)
    assert.match(source('server/utils/policyBundleV2.ts'), /delete payload\.rolePermissions/)
  })

  test('dev DB verifier expects policy-bundle.v2 and DB-backed policyRevision', () => {
    const content = source('scripts/verify-platform-dev-db.mjs')

    assert.match(content, /policy-bundle\.v2/)
    assert.doesNotMatch(content, /expected policy bundle schemaVersion policy-bundle\.v1/)
    assert.match(content, /pb\.policy_revision AS policyRevision/)
    assert.match(content, /payload policyRevision/)
  })

  test('policy-bundle.v2 includes platform default and tenant conflict rules', () => {
    const content = source('server/utils/policyBundle.ts')
    const conflictSource = source('server/utils/staticRoleConflicts.ts')

    assert.match(content, /STATIC_ROLE_CONFLICT_RULES/)
    assert.match(content, /staticConflictRuleToBundleRule/)
    assert.match(content, /for \(const rule of STATIC_ROLE_CONFLICT_RULES\)[\s\S]{0,180}rulesByCode\.set\(rule\.ruleCode, staticConflictRuleToBundleRule\(rule\)\)/)
    assert.match(content, /FROM tenant_role_conflict_rules/)
    assert.match(content, /collectRoleConflictRules\(tenantCode\)/)
    assert.match(content, /buildPolicyBundleV2CompatFields\(\{[\s\S]{0,260}conflictRules,[\s\S]{0,120}policyRevision/)
    assert.match(conflictSource, /altoc-quotation-operator-approval/)
    assert.match(conflictSource, /aims-work-item-operator-confirmation/)
    assert.match(conflictSource, /workflow-initiator-task-approval/)
  })
})
