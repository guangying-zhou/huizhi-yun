import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('tenant role copy to custom role', () => {
  test('copy endpoint creates a custom role from platform inherited roles', () => {
    const content = source('server/api/platform/tenant-admin/roles/[id]/copy.post.ts')

    assert.match(content, /requireTenantOwnerForTenantAdmin\(event, 'only tenant owner can copy tenant roles'\)/)
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assert.match(content, /sourceRole\.source !== 'system' && sourceRole\.role_type !== 'system'/)
    assert.match(content, /only platform inherited roles can be copied to custom roles/)
    assert.match(content, /INSERT INTO tenant_roles[\s\S]*parent_id, source, source_role_code[\s\S]*'custom'/)
    assert.match(content, /sourceRole\.id/)
    assert.match(content, /sourceRole\.role_code/)
  })

  test('copy endpoint clones app-role maps, direct permissions and scopes before refreshing policy snapshot', () => {
    const content = source('server/api/platform/tenant-admin/roles/[id]/copy.post.ts')

    assertBefore(content, 'FROM tenant_role_app_role_maps', 'INSERT INTO tenant_role_app_role_maps')
    assertBefore(content, 'FROM tenant_role_permissions', 'INSERT INTO tenant_role_permissions')
    assertBefore(content, 'FROM tenant_role_scopes', 'INSERT INTO tenant_role_scopes')
    assertBefore(content, 'INSERT INTO tenant_role_app_role_maps', 'refreshTenantRolePolicySnapshot(tx, tenantCode, newRoleId)')
    assertBefore(content, 'INSERT INTO tenant_role_permissions', 'refreshTenantRolePolicySnapshot(tx, tenantCode, newRoleId)')
    assertBefore(content, 'INSERT INTO tenant_role_scopes', 'refreshTenantRolePolicySnapshot(tx, tenantCode, newRoleId)')
    assert.match(content, /copied: \{[\s\S]*appRoles: appRoleMaps\.length[\s\S]*permissions: permissions\.length[\s\S]*scopes: scopes\.length/)
  })

  test('dashboard roles UI exposes copy only for inherited system roles and selects the copied role', () => {
    const content = source('app/components/console/RolesManager.vue')

    assert.match(content, /interface RoleCopyResponse/)
    assert.match(content, /function copyRoleCodeFor\(sourceRole: RoleItem\)/)
    assert.match(content, /async function copySelectedRoleToCustom\(\)/)
    assert.match(content, /!selectedRole\.value\.isSystem/)
    assert.match(content, /`\$\{apiPrefix\.value\}\/roles\/\$\{sourceRole\.id\}\/copy`/)
    assert.match(content, /loadRoleAppRoles\(response\.data\.role\.id\)/)
    assert.match(content, /loadRolePermissions\(response\.data\.role\.id\)/)
    assert.match(content, /loadRoleScopes\(response\.data\.role\.id\)/)
    assert.match(content, /v-if="selectedRole\?\.isSystem"/)
    assert.match(content, /复制为自定义角色/)
  })
})
