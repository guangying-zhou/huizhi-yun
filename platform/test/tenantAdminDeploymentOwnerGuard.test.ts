import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

describe('tenant-admin high-risk owner guards', () => {
  test('shared helper only blocks non-owner tenant-admin requests', () => {
    const content = source('server/utils/tenantAdminAccess.ts')

    assert.match(content, /platformAccessScope !== 'tenant-admin'/)
    assert.match(content, /membership\?\.isOwner/)
    assert.match(content, /statusCode:\s*403/)
  })

  test('tenant runtime token rotation requires owner before issuing token', () => {
    const content = source('server/api/platform/_handlers/tenants/runtime-token.post.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'issueRuntimeToken({')
  })

  test('data runtime static token generation requires owner before token creation', () => {
    const content = source('server/api/platform/ops/deployments/[deploymentCode]/data-runtime-token.post.ts')
    const handlerBlock = content.slice(content.indexOf('export default defineEventHandler'))

    assertBefore(handlerBlock, 'requireTenantOwnerForTenantAdmin(event', 'findDeploymentByCode(')
    assertBefore(handlerBlock, 'requireTenantOwnerForTenantAdmin(event', 'generateDataRuntimeStaticToken()')
  })

  test('tenant-admin deployment create and update require owner before database mutation', () => {
    const createContent = source('server/api/platform/_handlers/deployments.post.ts')
    const updateContent = source('server/api/platform/_handlers/deployments/[id].patch.ts')

    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'execute<ResultSetHeader>(')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'loadDeployment(id)')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'execute<ResultSetHeader>(')
  })

  test('tenant-admin subscription provisioning requires owner before database mutation', () => {
    const content = source('server/api/platform/_handlers/subscriptions.post.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const tenant = await queryRow')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO subscriptions')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'buildSignedLicenseToken(')
  })

  test('tenant-admin plan subscription requires owner before order and activation writes', () => {
    const content = source('server/api/platform/tenant-admin/subscription-plans/subscribe.post.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO platform_orders')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'activateTenantPlanSubscription(tx')
  })

  test('tenant-admin subject-role assignment requires owner before materialization and writes', () => {
    const content = source('server/api/platform/tenant-admin/subject-roles.post.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'loadSubject({')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'materializeSystemRole(')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'evaluateSubjectRoleAssignmentConflicts({')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_subject_roles')
  })

  test('tenant-admin subject-role revocation requires owner before loading and updating assignment', () => {
    const content = source('server/api/platform/tenant-admin/subject-roles/[id].delete.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const result = await withTransaction')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const assignment = await tx.queryRow')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'SET status = \'revoked\'')
  })

  test('tenant-admin tenant role create and update require owner before role writes', () => {
    const createContent = source('server/api/platform/tenant-admin/roles.post.ts')
    const updateContent = source('server/api/platform/tenant-admin/roles/[id].patch.ts')
    const copyContent = source('server/api/platform/tenant-admin/roles/[id]/copy.post.ts')

    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_roles')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'const existing = await loadRole')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'UPDATE tenant_roles')
    assertBefore(copyContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(copyContent, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(copyContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_roles')
  })

  test('tenant-admin role permission and scope boundary changes require owner before replacement writes', () => {
    const permissionContent = source('server/api/platform/tenant-admin/roles/[id]/permissions.put.ts')
    const scopeContent = source('server/api/platform/tenant-admin/roles/[id]/scopes.put.ts')
    const appRoleContent = source('server/api/platform/tenant-admin/roles/[id]/app-roles.put.ts')

    assertBefore(permissionContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(permissionContent, 'requireTenantOwnerForTenantAdmin(event', 'const role = await queryRow')
    assertBefore(permissionContent, 'requireTenantOwnerForTenantAdmin(event', 'DELETE FROM tenant_role_permissions')
    assertBefore(scopeContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(scopeContent, 'requireTenantOwnerForTenantAdmin(event', 'const role = await queryRow')
    assertBefore(scopeContent, 'requireTenantOwnerForTenantAdmin(event', 'DELETE FROM tenant_role_scopes')
    assertBefore(appRoleContent, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(appRoleContent, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(appRoleContent, 'requireTenantOwnerForTenantAdmin(event', 'DELETE FROM tenant_role_app_role_maps')
  })

  test('tenant-admin system role materialization requires owner before syncing role policy', () => {
    const enableContent = source('server/api/platform/tenant-admin/system-roles/[code]/enable.post.ts')
    const syncContent = source('server/api/platform/tenant-admin/system-roles/[code]/sync.post.ts')

    assertBefore(enableContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(enableContent, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(enableContent, 'requireTenantOwnerForTenantAdmin(event', 'materializeSystemRole(tx')
    assert.match(syncContent, /export \{ default \} from '\.\/enable\.post'/)
  })

  test('tenant-admin role conflict rules require owner before replacement writes', () => {
    const content = source('server/api/platform/tenant-admin/role-conflict-rules.put.ts')

    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'DELETE FROM tenant_role_conflict_rules')
    assertBefore(content, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_role_conflict_rules')
  })

  test('tenant-admin permission templates require owner before template writes', () => {
    const createContent = source('server/api/platform/tenant-admin/templates.post.ts')
    const updateContent = source('server/api/platform/tenant-admin/templates/[id].patch.ts')
    const rolesContent = source('server/api/platform/tenant-admin/templates/[id]/roles.put.ts')

    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'await withTransaction')
    assertBefore(createContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_permission_templates')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'const existing = await loadTemplate')
    assertBefore(updateContent, 'requireTenantOwnerForTenantAdmin(event', 'UPDATE tenant_permission_templates')
    assertBefore(rolesContent, 'requireTenantOwnerForTenantAdmin(event', 'const body = await readBody')
    assertBefore(rolesContent, 'requireTenantOwnerForTenantAdmin(event', 'const template = await queryRow')
    assertBefore(rolesContent, 'requireTenantOwnerForTenantAdmin(event', 'DELETE FROM tenant_template_roles')
    assertBefore(rolesContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_template_roles')
  })

  test('tenant-admin template bindings and overrides require owner before authorization source writes', () => {
    const bindingContent = source('server/api/platform/_handlers/template-bindings.post.ts')
    const overrideContent = source('server/api/platform/_handlers/template-overrides.post.ts')

    assertBefore(bindingContent, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(bindingContent, 'requireTenantOwnerForTenantAdmin(event', 'const template = await queryRow')
    assertBefore(bindingContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_template_bindings')
    assertBefore(overrideContent, 'requireTenantOwnerForTenantAdmin(event', 'const tenantCode = requireString')
    assertBefore(overrideContent, 'requireTenantOwnerForTenantAdmin(event', 'const subject = await queryRow')
    assertBefore(overrideContent, 'requireTenantOwnerForTenantAdmin(event', 'INSERT INTO tenant_template_overrides')
  })
})
