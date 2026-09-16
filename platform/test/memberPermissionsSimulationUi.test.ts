import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MemberPermissionsManager Console simulation bridge', () => {
  test('loads the same-origin Console global authorization simulation session', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /type AuthorizationSimulationMode = 'role_simulation' \| 'user_simulation'/)
    assert.match(content, /interface ConsoleAuthorizationSimulationSession/)
    assert.match(content, /function inactiveConsoleSimulation\(\)/)
    assert.match(content, /function normalizeConsoleSimulation\(/)
    assert.match(content, /async function loadConsoleSimulationSession\(\)/)
    assert.match(content, /\/api\/v1\/console\/authorization\/simulation-sessions\/current/)
    assert.match(content, /normalizeConsoleSimulation\(response\.data\)/)
    assert.match(content, /\[401,\s*403,\s*404\]\.includes\(statusCode\(error\)\)/)
    assert.match(content, /\[MemberPermissions\] Failed to load Console authorization simulation session:/)
    assert.match(content, /await Promise\.all\(\[loadConsoleSimulationSession\(\), loadAssignableRoles\(\)\]\)/)
  })

  test('derives effective simulation mode, role and baseline semantics from Console state', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /const localRoleSimulationIncludeBaseline = ref\(true\)/)
    assert.match(content, /const globalSimulationRoleCode = computed\(\(\) =>[\s\S]*consoleSimulation\.value\.mode === 'role_simulation'[\s\S]*consoleSimulation\.value\.roleCode/)
    assert.match(content, /const globalSimulationSubjectCode = computed\(\(\) =>[\s\S]*consoleSimulation\.value\.mode === 'user_simulation'[\s\S]*consoleSimulation\.value\.subjectCode/)
    assert.match(content, /const effectiveSimulationRoleCode = computed\(\(\) => globalSimulationRoleCode\.value \|\| activeSimulationRoleCode\.value\)/)
    assert.match(content, /const effectiveAuthorizationMode = computed\(\(\) => {[\s\S]*return 'user_simulation'[\s\S]*return 'role_simulation'[\s\S]*return 'merged'[\s\S]*}\)/)
    assert.match(content, /const effectiveIncludeBaseline = computed\(\(\) => \{[\s\S]*consoleSimulation\.value\.mode === 'role_simulation'[\s\S]*return consoleSimulation\.value\.includeBaseline[\s\S]*return localRoleSimulationIncludeBaseline\.value[\s\S]*return true[\s\S]*\}\)/)
    assert.match(content, /const roleSelectDisabled = computed\(\(\) => !detail\.value \|\| Boolean\(globalSimulationRoleCode\.value\)\)/)
    assert.match(content, /const baselineToggleDisabled = computed\(\(\) => !detail\.value \|\| Boolean\(globalSimulationRoleCode\.value\) \|\| !activeSimulationRoleCode\.value\)/)
    assert.match(content, /watch\(localRoleSimulationIncludeBaseline/)
  })

  test('renders a page-local baseline toggle for role simulation', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /v-model="localRoleSimulationIncludeBaseline"/)
    assert.match(content, /label="包含 baseline"/)
    assert.match(content, /:disabled="baselineToggleDisabled"/)
  })

  test('passes simulation parameters to member detail and authorization explanation APIs', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /\/api\/platform\/tenant-admin\/member-permissions'[\s\S]*query: {[\s\S]*uid: selectedUid\.value[\s\S]*authorizationMode: effectiveAuthorizationMode\.value !== 'merged' \? effectiveAuthorizationMode\.value : undefined[\s\S]*activeRoleCode: simulatedRoleCode \|\| undefined[\s\S]*includeBaseline: effectiveIncludeBaseline\.value \? undefined : 'false'/)
    assert.match(content, /\/api\/platform\/tenant-admin\/authorization-explain'[\s\S]*query: {[\s\S]*uid: selectedUid\.value[\s\S]*appCode: explainForm\.appCode\.trim\(\)[\s\S]*authorizationMode: effectiveAuthorizationMode\.value !== 'merged' \? effectiveAuthorizationMode\.value : undefined[\s\S]*activeRoleCode: simulatedRoleCode \|\| undefined[\s\S]*includeBaseline: effectiveIncludeBaseline\.value \? undefined : 'false'/)
  })

  test('uses Console user simulation as the selected member and explain target', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /const globalSubjectCode = globalSimulationSubjectCode\.value/)
    assert.match(content, /const nextUid = globalSubjectCode \|\|/)
    assert.match(content, /if \(!explainForm\.ownerUid \|\| consoleSimulation\.value\.mode === 'user_simulation'\) {\n\s+explainForm\.ownerUid = selectedUid\.value/)
  })

  test('renders a visible global simulation banner with baseline status', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /const consoleSimulationTitle = computed/)
    assert.match(content, /Console 全局用户模拟/)
    assert.match(content, /Console 全局角色模拟/)
    assert.match(content, /包含 baseline/)
    assert.match(content, /不包含 baseline/)
    assert.match(content, /v-if="consoleSimulation\.active"/)
    assert.match(content, /同步模拟/)
  })

  test('renders member memberships returned by the detail API', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /function membershipSubjectTypeLabel\(/)
    assert.match(content, /function membershipRelationLabel\(/)
    assert.match(content, /主体关系/)
    assert.match(content, /detail\.memberships\.length/)
    assert.match(content, /v-for="membership in detail\.memberships"/)
    assert.match(content, /membership\.displayName/)
    assert.match(content, /membershipSubjectTypeLabel\(membership\.subjectType\)/)
    assert.match(content, /membershipRelationLabel\(membership\.relationType\)/)
    assert.match(content, /membership\.subjectCode/)
    assert.match(content, /当前成员没有有效主体关系。/)
  })

  test('renders selected member lifecycle authorization audits', () => {
    const content = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(content, /interface PeopleLifecycleAuditItem/)
    assert.match(content, /interface PeopleLifecycleAuditResponse/)
    assert.match(content, /const lifecycleAudits = ref<PeopleLifecycleAuditItem\[\]>\(\[\]\)/)
    assert.match(content, /const lifecycleAuditTotal = ref\(0\)/)
    assert.match(content, /const lifecycleAuditPage = ref\(1\)/)
    assert.match(content, /const lifecycleAuditPageSize = 5/)
    assert.match(content, /const lifecycleAuditTotalPages = computed/)
    assert.match(content, /const lifecycleAuditVisibleRange = computed/)
    assert.match(content, /lifecycleAudits: false/)
    assert.match(content, /async function loadLifecycleAudits\(\)/)
    assert.match(content, /\/api\/platform\/tenant-admin\/lifecycle-audits/)
    assert.match(content, /uid: selectedUid\.value/)
    assert.match(content, /page: requestedPage/)
    assert.match(content, /pageSize: lifecycleAuditPageSize/)
    assert.match(content, /async function pageLifecycleAudits\(delta: number\)/)
    assert.match(content, /lifecycleAuditPage\.value = 1/)
    assert.match(content, /await loadLifecycleAudits\(\)/)
    assert.match(content, /生命周期授权审计/)
    assert.match(content, /lifecycleAuditVisibleRange/)
    assert.match(content, /People 主岗同步/)
    assert.match(content, /People 离职回收/)
    assert.match(content, /lifecycleAuditStatusLabel\(item\.status\)/)
    assert.match(content, /v-for="item in lifecycleAudits"/)
    assert.match(content, /pageLifecycleAudits\(-1\)/)
    assert.match(content, /pageLifecycleAudits\(1\)/)
    assert.match(content, /当前成员暂无 People 主岗同步或离职回收记录。/)
  })
})
