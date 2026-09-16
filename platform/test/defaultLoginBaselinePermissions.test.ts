import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('default login baseline permission governance', () => {
  test('enterprise roles page manages default login permissions from a dedicated login-user row', () => {
    const page = source('app/pages/admin/enterprise-roles.vue')
    const editor = source('app/components/admin/BaselinePermissionEditor.vue')
    const permissionEditor = source('app/components/admin/EnterpriseRolePermissionEditor.vue')

    assert.match(page, /\/api\/platform\/ops\/baseline-permissions/)
    assert.match(page, /activeSection = ref<'login' \| 'role'>\('login'\)/)
    assert.match(page, /selectLoginUsers/)
    assert.match(page, /default-login-user/)
    assert.match(page, /v-model:permissions="baselinePermissions"/)
    assert.match(page, /v-model:excluded-subjects="baselineExcludedSubjects"/)
    assert.match(page, /@save="saveBaselinePermissions"/)
    assert.match(page, /<EnterpriseRolePermissionEditor[\s\S]*?:baseline-permissions="baselinePermissions"/)
    assert.match(permissionEditor, /loginUserPermissionCardKey\(group\.appCode\)/)
    assert.match(permissionEditor, /togglePermissionCard/)
    assert.match(permissionEditor, /所有未排除的登录用户默认获得 \{\{ group\.appCode \}\} 的这些权限/)
    assert.match(permissionEditor, /group\.baselinePermissions/)

    assert.match(editor, /默认登录权限/)
    assert.match(editor, /defineModel<BaselinePermissionItem\[]>\('permissions'/)
    assert.match(editor, /defineModel<BaselineExcludedSubjectItem\[]>\('excludedSubjects'/)
    assert.match(editor, /availableExcludedSubjectItems/)
    assert.match(editor, /selectedExcludedSubjectKey/)
    assert.match(editor, /emit\('invalid', '默认登录权限已存在'\)/)
  })

  test('ops APIs expose baseline permissions and app-role permission details', () => {
    const getContent = source('server/api/platform/ops/baseline-permissions.get.ts')
    const putContent = source('server/api/platform/ops/baseline-permissions.put.ts')
    const appRolesContent = source('server/api/platform/tenant-admin/app-roles.get.ts')

    assert.match(getContent, /collectConfiguredBaselinePermissions/)
    assert.match(getContent, /platform_baseline_excluded_subjects/)
    assert.match(getContent, /availableExcludedSubjects/)
    assert.match(getContent, /FROM tenant_subjects ts/)
    assert.match(putContent, /DELETE FROM platform_baseline_permissions/)
    assert.match(putContent, /DELETE FROM platform_baseline_excluded_subjects/)
    assert.match(putContent, /if \(!manifestAction\)/)
    assert.match(putContent, /must reference an active manifest action/)
    assert.match(putContent, /manifestAction\.id,/)
    assert.doesNotMatch(putContent, /manifestAction\?\.id \|\| null/)
    assert.match(putContent, /HZY-Platform-SQL-Migration-v2\.25-default-login-baseline-permissions\.sql/)
    assert.match(appRolesContent, /platform_app_role_permissions/)
    assert.match(appRolesContent, /permissionsByRoleId/)
    assert.match(appRolesContent, /permissions:/)
  })

  test('migration and runtime carry baseline excluded users', () => {
    const migration = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Migration-v2.25-default-login-baseline-permissions.sql')
    const bundleV2 = source('server/utils/policyBundleV2.ts')
    const foundationAuth = workspaceSource('foundation/server/utils/applicationAuthorization.ts')

    assert.match(migration, /CREATE TABLE IF NOT EXISTS `platform_baseline_permissions`/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS `platform_baseline_excluded_subjects`/)
    assert.match(bundleV2, /excludedSubjectCodes: stringArray\(row\.excludedSubjectCodes\)/)
    assert.match(foundationAuth, /baselineGrantAppliesToSubject/)
  })

  test('default baseline seed never grants sensitive actions implicitly', () => {
    const migration = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Migration-v2.25-default-login-baseline-permissions.sql')
    const seed = migration.match(/INSERT INTO `platform_baseline_permissions`[\s\S]*?ON DUPLICATE KEY UPDATE/)?.[0] || ''

    assert.ok(seed, 'baseline seed block must exist')
    for (const action of ['approve', 'confirm', 'export', 'close', 'deploy']) {
      assert.doesNotMatch(seed, new RegExp(`'${action}'`))
    }
  })
})
