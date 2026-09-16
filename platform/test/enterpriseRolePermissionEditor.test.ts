import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('EnterpriseRolePermissionEditor boundary', () => {
  test('keeps role selection, data loading, and persistence in the enterprise roles page', () => {
    const page = source('app/pages/admin/enterprise-roles.vue')

    assert.match(page, /async function selectRole\(role: EnterpriseRoleItem\)[\s\S]*?\/api\/platform\/ops\/enterprise-roles\/\$\{encodeURIComponent\(role\.roleCode\)\}/)
    assert.match(page, /async function saveAppRoleMaps\(\)[\s\S]*?\/api\/platform\/ops\/enterprise-roles\/\$\{encodeURIComponent\(selectedCode\.value\)\}\/app-roles/)
    assert.match(page, /<EnterpriseRolePermissionEditor[\s\S]*?v-model:selected-app-role-codes="selectedAppRoleCodes"[\s\S]*?:role-code="selectedCode"[\s\S]*?:role-name="selectedRole\?\.roleName \|\| form\.roleName"[\s\S]*?:app-roles="appRoles"[\s\S]*?:baseline-permissions="baselinePermissions"[\s\S]*?:saving="savingMaps"[\s\S]*?@save="saveAppRoleMaps"/)
  })

  test('keeps the extracted editor presentation-only with explicit models and events', () => {
    const component = source('app/components/admin/EnterpriseRolePermissionEditor.vue')

    assert.match(component, /const props = defineProps<\{[\s\S]*?roleCode: string \| null[\s\S]*?roleName: string[\s\S]*?appRoles: AppRoleItem\[\][\s\S]*?baselinePermissions: BaselinePermissionItem\[\][\s\S]*?saving: boolean/)
    assert.match(component, /defineModel<string\[\]>\('selectedAppRoleCodes'/)
    assert.match(component, /const emit = defineEmits<[\s\S]*?save: \[\]/)
    assert.match(component, /@click="emit\('save'\)"/)
    assert.match(component, /watch\(\(\) => props\.roleCode, \(\) => \{[\s\S]*?expandedPermissionCards\.value = \[\]/)
    assert.doesNotMatch(component, /platformFetchJson|\$fetch\(/)
  })

  test('does not overlap the dedicated baseline permissions editor', () => {
    const component = source('app/components/admin/EnterpriseRolePermissionEditor.vue')
    const baselineEditor = source('app/components/admin/BaselinePermissionEditor.vue')

    assert.doesNotMatch(component, /excludedSubjects|availableExcludedSubjects|availablePermissions/)
    assert.match(baselineEditor, /defineModel<BaselinePermissionItem\[\]>\('permissions'/)
    assert.match(baselineEditor, /defineModel<BaselineExcludedSubjectItem\[\]>\('excludedSubjects'/)
  })
})
