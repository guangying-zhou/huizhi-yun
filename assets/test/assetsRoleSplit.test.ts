import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

type ManifestRole = {
  code: string
  suggestedPermissions?: string[]
}

const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
  resources: Array<{ code: string, actions?: string[] }>
  actionImplications?: Array<{ resourceCode: string, action: string, implies: string[] }>
  recommendedRoles: ManifestRole[]
}

function role(code: string) {
  const found = manifest.recommendedRoles.find(item => item.code === code)
  assert.ok(found, `missing recommended role ${code}`)
  return found
}

function permissions(code: string) {
  return role(code).suggestedPermissions || []
}

function assertNoSensitivePermission(roleCode: string) {
  for (const permission of permissions(roleCode)) {
    assert.equal(permission.endsWith(':approve'), false, `${roleCode} should not include ${permission}`)
    assert.equal(permission.endsWith(':admin'), false, `${roleCode} should not include ${permission}`)
  }
}

describe('Assets recommended role split', () => {
  test('asset users can request self-service operations without receiving assignment maintenance', () => {
    const assignmentResource = manifest.resources.find(item => item.code === 'assignments')
    assert.ok(assignmentResource?.actions?.includes('request'))
    assert.deepEqual(
      manifest.actionImplications?.filter(item => item.resourceCode === 'assignments'),
      [
        { resourceCode: 'assignments', action: 'edit', implies: ['view', 'request'] },
        { resourceCode: 'assignments', action: 'admin', implies: ['view', 'edit', 'request'] }
      ]
    )

    assert.equal(permissions('assets:employee').includes('assets:assignments:view'), true)
    assert.equal(permissions('assets:employee').includes('assets:assignments:request'), true)
    assert.equal(permissions('assets:employee').includes('assets:assignments:edit'), false)
    assert.equal(permissions('assets:employee').some(permission => permission.endsWith(':approve')), false)
    assert.equal(permissions('assets:employee').some(permission => permission.endsWith(':admin')), false)

    assert.equal(permissions('assets:requester').includes('assets:assignments:view'), true)
    assert.equal(permissions('assets:requester').includes('assets:assignments:request'), true)
    assert.equal(permissions('assets:requester').includes('assets:assignments:edit'), false)
  })

  test('employee and requester app-role scopes fail closed to related/self assignment records', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.18-assets-self-service-scopes.sql', import.meta.url),
      'utf8'
    )

    for (const permission of ['dashboard:view', 'asset_items:view', 'assignments:view', 'assignments:request', 'alerts:view']) {
      const [resource, action] = permission.split(':')
      assert.match(seed, new RegExp(`assets:employee[\\s\\S]*${resource}['", ]+${action}`))
    }
    assert.match(seed, /assets:employee[\s\S]*asset[\s\S]*user/)
    assert.match(seed, /assets:requester[\s\S]*assignments[\s\S]*request[\s\S]*subject[\s\S]*self/)
    assert.match(seed, /refreshSystemRolePolicySnapshot|policy_hash|policy_revision/)
  })

  test('procurement, inventory, requester, custodian and approval roles remain separated', () => {
    assertNoSensitivePermission('assets:requester')
    assertNoSensitivePermission('assets:custodian')
    assertNoSensitivePermission('assets:procurement')
    assertNoSensitivePermission('assets:inventory_manager')

    assert.equal(permissions('assets:procurement').includes('assets:suppliers:edit'), true)
    assert.equal(permissions('assets:procurement').includes('assets:purchase_orders:edit'), true)
    assert.equal(permissions('assets:procurement').includes('assets:asset_items:edit'), false)
    assert.equal(permissions('assets:procurement').includes('assets:assignments:edit'), false)

    assert.equal(permissions('assets:inventory_manager').includes('assets:asset_items:edit'), true)
    assert.equal(permissions('assets:inventory_manager').includes('assets:assignments:edit'), true)
    assert.equal(permissions('assets:inventory_manager').includes('assets:offboarding_recoveries:edit'), true)
    assert.equal(permissions('assets:inventory_manager').includes('assets:purchase_orders:approve'), false)

    assert.equal(permissions('assets:custodian').includes('assets:offboarding_recoveries:edit'), true)
    assert.equal(permissions('assets:requester').includes('assets:offboarding_recoveries:edit'), false)

    assert.equal(permissions('assets:asset_approver').includes('assets:purchase_orders:approve'), true)
    assert.equal(permissions('assets:asset_approver').includes('assets:assignments:approve'), true)
    assert.equal(permissions('assets:asset_approver').some(permission => permission.endsWith(':edit')), false)

    assert.equal(permissions('assets:admin').includes('assets:admin:admin'), true)
    assert.equal(permissions('assets:admin').includes('assets:offboarding_recoveries:admin'), true)
  })

  test('platform seed no longer grants asset approval to department or procurement managers', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /\('department_manager', 'assets:owner', 10\)/)
    assert.doesNotMatch(seed, /\('department_manager', 'assets:asset_approver',/)

    assert.match(seed, /\('procurement_asset_manager', 'assets:procurement', 10\)/)
    assert.match(seed, /\('procurement_asset_manager', 'assets:inventory_manager', 20\)/)
    assert.doesNotMatch(seed, /\('procurement_asset_manager', 'assets:asset_approver',/)

    assert.match(seed, /\('system_admin', 'assets:admin', 60\)/)
  })
})
