import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('AuthorizationsManager behavior safety baseline', () => {
  test('explicitly imports extracted console components without relying on path-prefixed auto-import names', () => {
    const content = source('app/components/console/AuthorizationsManager.vue')
    const componentNames = [
      'AuthorizationConflictRulesPanel',
      'AuthorizationInstanceConflictDiagnostics',
      'AuthorizationPermissionDiagnostics',
      'AuthorizationRoleAssignmentsModal',
      'AuthorizationRoleCatalog',
      'AuthorizationRoleDiffCard',
      'AuthorizationRolePermissionModal'
    ]

    for (const componentName of componentNames) {
      assert.match(
        content,
        new RegExp(`import ${componentName} from './${componentName}\\.vue'`)
      )
    }
  })

  test('keeps project containers out of the employee role assignment picker', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const modal = source('app/components/console/AuthorizationRoleAssignmentsModal.vue')

    assert.match(manager, /const departments = subjects\.value\.filter\(item => item\.subjectType === 'department'\)/)
    assert.match(manager, /const container = departmentNodeMap\.get\(membership\.containerSubjectId\)/)
    assert.match(manager, /if \(item\.subject\.subjectType === 'user'\) \{\s+nextIds\.add/)
    assert.doesNotMatch(manager, /const nonUsers = subjects\.value\.filter\(item => item\.subjectType !== 'user'\)/)
    assert.doesNotMatch(manager, /subjectType: subjectTypeFilter/)
    assert.doesNotMatch(modal, /subjectTypeFilter|subjectTypeItems|selectedSubjectIds/)
    assert.match(modal, /placeholder="搜索员工或部门"/)
    assert.match(modal, /item\.subject\.subjectType === 'department' \? '部门' : '员工'/)
    assert.match(modal, /当前搜索下没有可选员工。/)
  })

  test('assignment only materializes and grants inside the selected tenant boundary', () => {
    const content = source('app/components/console/AuthorizationsManager.vue')

    assert.match(content, /async function ensureAssignmentRoleId\(role: SystemRoleItem\)/)
    assert.match(content, /\/system-roles\/\$\{encodeURIComponent\(role\.roleCode\)\}\/enable/)
    assert.match(content, /tenantCode: tenantCode\.value/)
    assert.match(content, /async function assignRole\(\)/)
    assert.match(content, /\/api\/platform\/tenant-admin\/subject-roles/)
    assert.match(content, /subjectType: subject\.subjectType/)
    assert.match(content, /subjectId: subject\.id/)
    assert.match(content, /roleId,/)
    assert.match(content, /systemRoleCode: role\.roleCode/)
  })

  test('assignment distinguishes server warnings from rejected enforce conflicts', () => {
    const content = source('app/components/console/AuthorizationsManager.vue')

    assert.match(content, /Promise\.allSettled\(selectedSubjects\.value\.map/)
    assert.match(content, /const failed = results\.filter\(item => item\.status === 'rejected'\)/)
    assert.match(content, /item\.value\.data\.roleConflictWarnings/)
    assert.match(content, /if \(failed\.length > 0\) \{[\s\S]*已授予 \$\{succeeded\} 个员工，\$\{failed\.length\} 个失败/)
    assert.match(content, /else if \(warningMessages\.length > 0\) \{[\s\S]*已授予 \$\{succeeded\} 个员工；/)
  })

  test('keeps assignment presentation separate from tenant-bound authorization mutations', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const modal = source('app/components/console/AuthorizationRoleAssignmentsModal.vue')

    assert.match(manager, /<AuthorizationRoleAssignmentsModal/)
    assert.match(manager, /@assign="assignRole"/)
    assert.match(manager, /@revoke="revokeAssignment"/)
    assert.match(manager, /async function ensureAssignmentRoleId\(role: SystemRoleItem\)/)
    assert.match(manager, /async function assignRole\(\)/)
    assert.match(manager, /async function revokeAssignment\(item: SubjectRoleItem\)/)
    assert.match(modal, /const emit = defineEmits/)
    assert.match(modal, /'clearSelectedSubjects': \[\]/)
    assert.match(modal, /'revoke': \[assignment: SubjectRoleAssignment\]/)
    assert.doesNotMatch(modal, /platformFetchJson|\$fetch|\/api\/platform/)
  })

  test('keeps role catalog presentation separate from authorization requests and handlers', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const catalog = source('app/components/console/AuthorizationRoleCatalog.vue')

    assert.match(manager, /<AuthorizationRoleCatalog/)
    assert.match(manager, /:roles="visibleSystemRoles"/)
    assert.match(manager, /:role-authorized-users="roleAuthorizedUsers"/)
    assert.match(manager, /@select="selectSystemRole"/)
    assert.match(manager, /@assign="openAssignmentModal"/)
    assert.match(manager, /@show-permissions="showRolePermissions"/)
    assert.match(manager, /@show-diff="showDiff"/)
    assert.match(manager, /@sync="enableSystemRole"/)
    assert.match(manager, /async function enableSystemRole\(role: SystemRoleItem, force = false\)/)
    assert.match(manager, /async function showDiff\(role: SystemRoleItem\)/)
    assert.match(manager, /async function showRolePermissions\(role: SystemRoleItem\)/)
    assert.match(manager, /platformFetchJson/)
    assert.match(catalog, /const emit = defineEmits/)
    assert.match(catalog, /select: \[role: SystemRoleItem\]/)
    assert.match(catalog, /assign: \[role: SystemRoleItem\]/)
    assert.match(catalog, /showPermissions: \[role: SystemRoleItem\]/)
    assert.match(catalog, /showDiff: \[role: SystemRoleItem\]/)
    assert.match(catalog, /sync: \[role: SystemRoleItem, force\?: boolean\]/)
    assert.match(catalog, /emit\('sync', row\.original, true\)/)
    assert.doesNotMatch(catalog, /platformFetchJson|\$fetch|\/api\/platform/)
  })

  test('keeps role permission modal presentation separate from tenant-bound permission loading', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const modal = source('app/components/console/AuthorizationRolePermissionModal.vue')

    assert.match(manager, /<AuthorizationRolePermissionModal/)
    assert.match(manager, /:open="rolePermissionOpen"/)
    assert.match(manager, /:title="rolePermissionTitle"/)
    assert.match(manager, /:source-text="rolePermissionSourceText"/)
    assert.match(manager, /:source="rolePermissionSource"/)
    assert.match(manager, /:role="rolePermissionRole"/)
    assert.match(manager, /:error="rolePermissionError"/)
    assert.match(manager, /:loading="pending\.permissions"/)
    assert.match(manager, /:groups="rolePermissionGroups"/)
    assert.match(manager, /@update:open="rolePermissionOpen = \$event"/)
    assert.match(manager, /async function showRolePermissions\(role: SystemRoleItem\)/)
    assert.match(manager, /\/assignable-roles\/\$\{role\.tenantRoleId\}\/permissions/)
    assert.match(manager, /\/system-roles\/\$\{encodeURIComponent\(role\.roleCode\)\}\/permissions/)
    assert.match(manager, /tenantCode: tenantCode\.value/)
    assert.match(modal, /const emit = defineEmits/)
    assert.match(modal, /'update:open': \[value: boolean\]/)
    assert.match(modal, /v-if="props\.error"/)
    assert.match(modal, /v-if="props\.loading"/)
    assert.match(modal, /v-else-if="props\.groups\.length > 0"/)
    assert.match(modal, /v-else-if="!props\.error"/)
    assert.doesNotMatch(modal, /platformFetchJson|\$fetch|\/api\/platform|tenantCode/)
  })

  test('keeps the role diff card presentation separate from tenant-bound diff loading', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const card = source('app/components/console/AuthorizationRoleDiffCard.vue')

    assert.match(manager, /<AuthorizationRoleDiffCard/)
    assert.match(manager, /v-if="activeDiff"/)
    assert.match(manager, /:diff="activeDiff"/)
    assert.match(manager, /async function showDiff\(role: SystemRoleItem\)/)
    assert.match(manager, /\/system-roles\/\$\{encodeURIComponent\(role\.roleCode\)\}\/diff/)
    assert.match(manager, /tenantCode: tenantCode\.value/)
    assert.match(card, /diff: SystemRoleDiff \| null/)
    assert.match(card, /v-if="props\.diff"/)
    assert.match(card, /permissionMissingCount/)
    assert.match(card, /permissionExtraCount/)
    assert.match(card, /permissionChangedCount/)
    assert.match(card, /scopeMissingCount/)
    assert.match(card, /scopeExtraCount/)
    assert.match(card, /scopeChangedCount/)
    assert.match(card, /已覆盖/)
    assert.match(card, /标准/)
    assert.doesNotMatch(card, /platformFetchJson|\$fetch|\/api\/platform|tenantCode|defineEmits/)
  })

  test('diagnostic requests trim optional scope and actor inputs before rendering conflict severity', () => {
    const content = source('app/components/console/AuthorizationsManager.vue')
    const diagnostics = source('app/components/console/AuthorizationInstanceConflictDiagnostics.vue')

    assert.match(content, /ownerUid: instanceConflictForm\.ownerUid\.trim\(\) \|\| undefined/)
    assert.match(content, /includeBaseline: instanceConflictForm\.includeBaseline \? 'true' : 'false'/)
    assert.match(content, /applicantUid: instanceConflictForm\.applicantUid\.trim\(\) \|\| undefined/)
    assert.match(content, /handlerUid: instanceConflictForm\.handlerUid\.trim\(\) \|\| undefined/)
    assert.match(content, /makerUid: instanceConflictForm\.makerUid\.trim\(\) \|\| undefined/)
    assert.match(diagnostics, /if \(props\.result\.hasBlockingViolation\) return 'error'/)
    assert.match(diagnostics, /if \(props\.result\.hasWarningViolation \|\| props\.result\.hasViolation\) return 'warning'/)
    assert.match(diagnostics, /if \(props\.result\.hasBlockingViolation\) return '已拦截'/)
    assert.match(diagnostics, /if \(props\.result\.hasWarningViolation \|\| props\.result\.hasViolation\) return '需关注'/)
  })

  test('keeps permission diagnostic request ownership in the manager and presentation in its own component', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const diagnostics = source('app/components/console/AuthorizationPermissionDiagnostics.vue')

    assert.match(manager, /\/api\/platform\/tenant-admin\/authorization-explain/)
    assert.match(manager, /ownerUid: authorizationExplainForm\.ownerUid\.trim\(\) \|\| undefined/)
    assert.match(manager, /<AuthorizationPermissionDiagnostics/)
    assert.match(manager, /:form="authorizationExplainForm"/)
    assert.match(manager, /:result="authorizationExplainResult"/)
    assert.match(manager, /:pending="pending\.authorizationExplain"/)
    assert.match(manager, /@run="runAuthorizationExplain"/)
    assert.match(manager, /@use-selected-subject="useFirstSelectedSubjectForExplain"/)
    assert.match(diagnostics, /v-model="form\.uid"/)
    assert.match(diagnostics, /@click="emit\('run'\)"/)
    assert.match(diagnostics, /@click="emit\('useSelectedSubject'\)"/)
    assert.match(diagnostics, /return props\.result\.allowed \? 'success' : 'error'/)
    assert.match(diagnostics, /v-for="grant in result\.candidateGrants"/)
  })
})
