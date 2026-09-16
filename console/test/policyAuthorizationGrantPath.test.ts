import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionSatisfies, type ResourceActionPolicy } from '@hzy/authz-core'
import { AUTHORIZATION_ACTION_GOLDEN_CASES } from '@hzy/authz-core/testing'
import {
  buildFlatSnapshotGrants,
  evaluateFlatSnapshotPermission,
  type CollectedFlatPermission
} from '../server/utils/policyAuthorizationGrants.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function collected(overrides: Partial<CollectedFlatPermission> & Pick<CollectedFlatPermission, 'resourceCode' | 'action'>): CollectedFlatPermission {
  return {
    origin: 'role_permission',
    roleCode: 'tenant_admin',
    appCode: 'console',
    ...overrides
  }
}

describe('flat snapshot grants build', () => {
  test('normalizes empty appCode to target app and keeps provenance without scopes', () => {
    const grants = buildFlatSnapshotGrants([
      collected({ appCode: '', resourceCode: 'org_profile', action: 'view' }),
      collected({ origin: 'baseline', roleCode: '', appCode: 'aims', resourceCode: 'projects', action: 'view' })
    ], 'console')

    assert.equal(grants.length, 2)
    const [roleGrant, baselineGrant] = grants

    assert.equal(roleGrant.permission.appCode, 'console')
    assert.equal(roleGrant.roleCode, 'tenant_admin')
    assert.equal(roleGrant.sourceType, 'role_permission')
    assert.equal(roleGrant.subjectType, 'user')
    assert.deepEqual(roleGrant.scopes, [])
    assert.equal(roleGrant.defaultScopes, undefined)
    assert.equal(roleGrant.assignmentScopes, undefined)

    assert.equal(baselineGrant.subjectType, 'baseline')
    assert.equal(baselineGrant.sourceType, 'baseline')
    assert.equal(baselineGrant.roleCode, undefined)
  })

  test('deduplicates identical grant units but keeps per-role provenance', () => {
    const grants = buildFlatSnapshotGrants([
      collected({ resourceCode: 'org_profile', action: 'edit' }),
      collected({ resourceCode: 'org_profile', action: 'edit' }),
      collected({ roleCode: 'auditor', resourceCode: 'org_profile', action: 'edit' })
    ], 'console')

    assert.equal(grants.length, 2)
    assert.deepEqual(grants.map(grant => grant.roleCode).sort(), ['auditor', 'tenant_admin'])
  })

  test('drops records missing resource or action', () => {
    const grants = buildFlatSnapshotGrants([
      collected({ resourceCode: '', action: 'view' }),
      collected({ resourceCode: 'org_profile', action: '' })
    ], 'console')

    assert.equal(grants.length, 0)
  })
})

describe('flat snapshot permission decisions match resources-map semantics', () => {
  const heldActionSets = [
    ['view'],
    ['edit'],
    ['admin'],
    ['export'],
    ['view', 'approve'],
    ['edit', 'admin']
  ]
  const requiredActions = ['view', 'edit', 'admin', 'export', 'approve']

  function grantsFor(heldActions: string[]) {
    return buildFlatSnapshotGrants(
      heldActions.map(action => collected({ resourceCode: 'org_profile', action })),
      'console'
    )
  }

  test('decision equals actionSatisfies over the held action set (default hierarchy)', () => {
    for (const held of heldActionSets) {
      const grants = grantsFor(held)
      for (const action of requiredActions) {
        const viaGrants = evaluateFlatSnapshotPermission(grants, {
          appCode: 'console',
          resourceCode: 'org_profile',
          action
        }).allowed
        const viaResources = held.some(heldAction => actionSatisfies(heldAction, action))

        assert.equal(viaGrants, viaResources, `held=[${held}] action=${action}`)
      }
    }
  })

  test('decision equals actionSatisfies with a manifest action policy', () => {
    const policy: ResourceActionPolicy = { implications: { admin: ['*'] } }
    const grants = grantsFor(['admin'])

    for (const action of requiredActions) {
      const viaGrants = evaluateFlatSnapshotPermission(grants, {
        appCode: 'console',
        resourceCode: 'org_profile',
        action
      }, policy).allowed
      const viaResources = actionSatisfies('admin', action, policy)

      assert.equal(viaGrants, viaResources, `policy admin->* action=${action}`)
    }
  })

  test('Console grant evaluator satisfies the shared Core/Foundation action contract', () => {
    for (const item of AUTHORIZATION_ACTION_GOLDEN_CASES) {
      const decision = evaluateFlatSnapshotPermission(grantsFor(item.grantedActions), {
        appCode: 'console',
        resourceCode: 'org_profile',
        action: item.requiredAction
      }, item.policy)

      assert.equal(decision.allowed, item.expected, item.id)
    }
  })

  test('grants for another app never satisfy the target app requirement', () => {
    const grants = buildFlatSnapshotGrants([
      collected({ appCode: 'aims', resourceCode: 'org_profile', action: 'admin' })
    ], 'console')

    const decision = evaluateFlatSnapshotPermission(grants, {
      appCode: 'console',
      resourceCode: 'org_profile',
      action: 'view'
    })

    assert.equal(decision.allowed, false)
    assert.equal(decision.reasonCode, 'no_permission')
  })

  test('allowed decision reports the matched grant unit', () => {
    const grants = grantsFor(['edit'])
    const decision = evaluateFlatSnapshotPermission(grants, {
      appCode: 'console',
      resourceCode: 'org_profile',
      action: 'view'
    })

    assert.equal(decision.allowed, true)
    assert.equal(decision.reasonCode, 'allowed')
    assert.equal(decision.matchedAction, 'edit')
    assert.match(String(decision.matchedGrantId), /^role_permission:tenant_admin:console:org_profile:edit$/)
  })
})

describe('policyAuthorization flat snapshot is wired to the grant path', () => {
  const policyAuthorization = source('server/utils/policyAuthorization.ts')

  test('snapshot derives resources from grant units', () => {
    assert.match(policyAuthorization, /const grants = buildFlatSnapshotGrants\(collectedPermissions, targetAppCode\)/)
    assert.match(policyAuthorization, /normalizeAuthorizationResources\(\s*grants\.map\(grant => grant\.permission\),\s*targetAppCode\s*\)/)
    assert.match(policyAuthorization, /baselineGrantAppliesToSubject\(permission, effectiveUid\)/)
    assert.match(policyAuthorization, /import \{ normalizeAuthorizationResources \} from '@hzy\/foundation\/server\/utils\/platformBundleAuthorization'/)
    assert.doesNotMatch(policyAuthorization, /(?:export\s+)?function normalizeAuthorizationResources\s*\(/)
    assert.doesNotMatch(policyAuthorization, /interface RuntimePermissionInput\s*\{/)
    assert.match(policyAuthorization, /grants: AuthorizationGrant\[\]/)
    assert.match(policyAuthorization, /appCode: targetAppCode,/)
  })

  test('collected flat permissions keep console-specific filters and provenance', () => {
    assert.match(policyAuthorization, /origin: 'role_permission',/)
    assert.match(policyAuthorization, /origin: 'system_role_permission',/)
    assert.match(policyAuthorization, /origin: 'baseline',/)
    assert.match(policyAuthorization, /isLegacyConsoleViewerPermission\(permission, roleCode, targetAppCode\)/)
    assert.match(policyAuthorization, /isConsoleBaselinePermission\(permission\)/)
  })

  test('hasPermissionInSnapshot decides via evaluate() with resources-map fallback', () => {
    assert.match(policyAuthorization, /evaluateFlatSnapshotPermission\(snapshot\.grants, \{/)
    assert.match(policyAuthorization, /appCode: stringValue\(snapshot\.appCode\) \|\| defaultAppCode,/)
    assert.match(policyAuthorization, /actions\.some\(held => actionSatisfies\(held, action, actionPolicy\)\)/)
  })

  test('flat snapshot grant units never carry scope predicates', () => {
    const grantsSource = source('server/utils/policyAuthorizationGrants.ts')
    assert.match(grantsSource, /scopes: \[\]/)
    assert.doesNotMatch(grantsSource, /defaultScopes:/)
    assert.doesNotMatch(grantsSource, /assignmentScopes:/)
  })
})
