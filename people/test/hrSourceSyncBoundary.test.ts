import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { serviceCommandSourceClientId } from '../server/utils/serviceCommandIdentity.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('People DingTalk HR source boundary', () => {
  test('browser entry requires dedicated People permissions', () => {
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/department-mappings.get.ts'), /assertPeoplePermission\(event, 'hr_source_sync', 'view'\)/)
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/department-mappings.post.ts'), /assertPeoplePermission\(event, 'hr_source_sync', 'admin'\)/)
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/department-changes.get.ts'), /assertPeoplePermission\(event, 'hr_source_sync', 'view'\)/)
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/department-changes.post.ts'), /assertPeoplePermission\(event, 'hr_source_sync', 'admin'\)/)
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/jobs/index.post.ts'), /assertPeoplePermission\(event, 'hr_source_sync', 'execute'\)/)
    assert.match(read('server/api/admin/hr-source-sync/dingtalk/jobs/index.post.ts'), /assertDingTalkDepartmentMappingsReady\(event\)/)
    for (const path of [
      'server/api/admin/hr-source-sync/dingtalk/jobs/index.post.ts',
      'server/api/admin/hr-source-sync/dingtalk/jobs/[jobId]/cancel.post.ts',
      'server/api/admin/hr-source-sync/dingtalk/jobs/[jobId]/retry.post.ts'
    ]) {
      assert.match(read(path), /getRequestUid\(event\)/)
    }
  })

  test('cross-app mutation binds capability, command hash and service signature', () => {
    const client = read('server/utils/dingTalkHRSource.ts')
    assert.match(client, /resolveServiceAppBaseUrl\(event, 'console', \{ basePath: '\/', directTarget: true \}\)[\s\S]*resolveConsoleRuntimeBaseUrl\(useRuntimeConfig\(event\), event\)/)
    assert.match(client, /console:hr-source-sync:admin/)
    assert.match(client, /hashServiceCommandPayload\(command\)/)
    assert.match(client, /buildServiceCommandRuntimeHeaders/)
    assert.match(client, /People tenant-runtime is required to finish department migration/)
    assert.match(client, /people\.hr-source-sync\.dingtalk\.department-changes\.apply/)
    assert.match(client, /department-changes/)
    assert.match(client, /objectScopes: \['organization', 'people'\]/)
    assert.doesNotMatch(client, /objectScopes: \[[^\]]*directory_profiles/)
    assert.match(client, /people\.hr-source-sync\.dingtalk\.jobs\.start/)
    assert.match(client, /people\.hr-source-sync\.dingtalk\.jobs\.\$\{action\}/)
    assert.match(client, /people:hr-source-department-remap:execute/)
    assert.match(client, /serviceTokenSourceBinding: 'service-client-policy'/)
    assert.doesNotMatch(client, /scope: 'people\.write'[\s\S]*departments:remap/)
  })

  test('service-command signatures use the same canonical client id as Console verification', () => {
    assert.equal(serviceCommandSourceClientId({
      sub: 'client:people.runtime',
      client_id: 'client:people.runtime',
      hzy: { clientCode: 'people.runtime', appCode: 'people' }
    }), 'people.runtime')
    assert.equal(serviceCommandSourceClientId({ sub: 'client:people.runtime' }), 'people.runtime')
  })

  test('job UI reports only real pipeline stages and durable counts', () => {
    const page = read('app/pages/settings/hr-source-sync.vue')
    for (const label of ['钉钉供应商快照', 'People 人事事实', 'Console 目录状态', 'Platform 策略投影']) {
      assert.match(page, new RegExp(label))
    }
    assert.match(page, /currentJob\.counts\.applied/)
    assert.doesNotMatch(page, /currentJob\.phase|currentJob\.progress|<UProgress/)
    assert.match(page, /Console lifecycle operation 为准/)
    assert.match(page, /重新对账 People 引用/)
    assert.match(page, /reconcileMappedReferences/)
  })

  test('DingTalk job numbers never become People employee numbers', () => {
    const page = read('app/pages/onboarding-cases/index.vue')
    assert.match(page, /由 People 自动递增分配，不使用钉钉工号/)
    assert.doesNotMatch(page, /sourceFieldDisplay\(editing, 'employee_no'/)
    assert.doesNotMatch(page, /body:\s*\{\s*\.\.\.form/)

    const directoryAdapter = read('../data-runtime/internal/apps/directory/adapter.go')
    assert.doesNotMatch(directoryAdapter, /copyDingTalkField\([^\n]*"employee_no"[^\n]*"employeeNumber"/)

    const employeeDetail = read('app/pages/employees/[uid].vue')
    assert.match(employeeDetail, /由 People 自动分配，不支持人工修改/)
    assert.doesNotMatch(employeeDetail, /employee_no:\s*editForm\.employeeNo/)
  })

  test('sync start locks before authorization so repeated clicks cannot submit twice', () => {
    const page = read('app/pages/settings/hr-source-sync.vue')
    const startSyncStart = page.indexOf('async function startSync()')
    const startSyncEnd = page.indexOf('async function mutateJob', startSyncStart)
    const startSync = page.slice(startSyncStart, startSyncEnd)
    const lockIndex = startSync.indexOf('starting.value = true')
    const authorizationIndex = startSync.indexOf('await ensurePeoplePermission(\'hr_source_sync\', \'execute\')')

    assert.ok(startSyncStart >= 0 && startSyncEnd > startSyncStart)
    assert.ok(lockIndex >= 0 && authorizationIndex >= 0 && lockIndex < authorizationIndex)
    assert.match(startSync, /finally \{[\s\S]*starting\.value = false/)
    assert.match(page, /:disabled="startSyncDisabled"/)
  })

  test('an active sync job keeps the start action disabled until it reaches a terminal status', () => {
    const page = read('app/pages/settings/hr-source-sync.vue')
    const startSyncStart = page.indexOf('async function startSync()')
    const startSyncEnd = page.indexOf('async function mutateJob', startSyncStart)
    const startSync = page.slice(startSyncStart, startSyncEnd)

    assert.match(page, /const jobInProgress = computed\(\(\) => Boolean\(currentJob\.value\?\.jobId\) && !jobTerminal\.value\)/)
    assert.match(page, /const startSyncDisabled = computed\(\(\) => starting\.value \|\| jobInProgress\.value \|\| !readyToSync\.value\)/)
    assert.match(startSync, /if \(startSyncDisabled\.value\) return/)
    assert.match(page, /\{\{ jobInProgress \? '同步处理中' : '启动同步' \}\}/)
  })

  test('retry fallback is stable and HR source navigation is independently permissioned', () => {
    const retryRoute = read('server/api/admin/hr-source-sync/dingtalk/jobs/[jobId]/retry.post.ts')
    assert.match(retryRoute, /people-dingtalk-job-retry-\$\{jobId\}/)
    assert.doesNotMatch(retryRoute, /randomUUID/)

    const permissions = read('app/config/permissions.ts')
    assert.ok(permissions.indexOf('label: \'人事事实源\'') < permissions.indexOf('label: \'设置\''))
    assert.match(permissions, /icon: 'i-lucide-refresh-cw'/)
    assert.doesNotMatch(permissions, /i-lucide-refresh-cw-cog/)
  })

  test('only people:admin receives all HR source permissions', () => {
    const manifest = JSON.parse(read('app.manifest.json')) as {
      recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
    }
    const admin = manifest.recommendedRoles.find(role => role.code === 'people:admin')
    const directoryAdmin = manifest.recommendedRoles.find(role => role.code === 'people:directory_admin')
    assert.deepEqual(
      admin?.suggestedPermissions.filter(permission => permission.startsWith('people:hr_source_sync:')).sort(),
      ['people:hr_source_sync:admin', 'people:hr_source_sync:execute', 'people:hr_source_sync:view']
    )
    assert.equal(directoryAdmin?.suggestedPermissions.some(permission => permission.startsWith('people:hr_source_sync:')), false)
  })
})
