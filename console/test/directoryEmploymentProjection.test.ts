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

describe('People directory employment projection service endpoint', () => {
  test('requires the narrow People service capability before forwarding the frozen command to Runtime', () => {
    const content = source('server/api/v1/console/service/directory/users/[uid]/employment.post.ts')

    assertBefore(
      content,
      'requireConsoleServiceActor(event, \'console\', \'console:directory-employment:sync\'',
      'readBody<Record<string, unknown>>(event)'
    )
    assert.match(content, /verifyPeopleDirectorySignature\(event, body, binding\)/)
    assert.match(content, /applyConsoleDirectoryLifecycle\(event, uid, 'employment', body\)/)
    assert.doesNotMatch(content, /withTransaction|server\/utils\/db|applyPeopleDirectoryCommand/)
    assert.match(content, /if \(String\(\(receipt\.result[\s\S]{0,220}setResponseStatus\(event, 202\)/)
    assert.doesNotMatch(content, /orchestrateEmploymentLifecycle|syncPlatformUserEmploymentAuthorization|notifyPlatformAuthorizationLifecycleFailure/)
  })

  test('directory user mutation keeps typed actor audit and receipts inside Runtime', () => {
    const admin = source('server/utils/directoryAdmin.ts')
    const receipt = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_mutation_receipt.go', import.meta.url),
      'utf8'
    )
    const mutation = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_user_mutation.go', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(admin, /server\/utils\/db|queryRow|execute|withTransaction/)
    assert.match(receipt, /ActorType\s+string/)
    assert.match(receipt, /actorType != "human" && actorType != "service" && actorType != "system"/)
    assert.match(mutation, /finishConsoleMutation\(ctx, session, "directory\.user\.create"/)
  })

  test('offboarding disable delegates the atomic receipt and Platform operation to Runtime', () => {
    const content = source('server/api/v1/console/service/directory/users/[uid]/disable.post.ts')

    assertBefore(content, 'requireConsoleServiceActor(event, \'console\', \'console:directory-offboarding:disable\'', 'readBody<Record<string, unknown>>(event)')
    assert.match(content, /verifyPeopleDirectorySignature\(event, body, binding\)/)
    assert.match(content, /applyConsoleDirectoryLifecycle\(event, uid, 'offboarding', body\)/)
    assert.doesNotMatch(content, /withTransaction|server\/utils\/db|applyPeopleDirectoryCommand/)
    assert.match(content, /setResponseStatus\(event, 202\)/)
    assert.doesNotMatch(content, /orchestrateOffboardingLifecycle|reclaimPlatformUserAuthorizationForOffboarding|notifyPlatformAuthorizationLifecycleFailure/)
  })

  test('lifecycle failure notifications deep-link to filtered operation logs with retry context', () => {
    const content = source('server/utils/platformAuthorizationLifecycleNotifications.ts')

    assert.match(content, /function buildLifecycleOperationLogActionUrl/)
    assert.match(content, /tab: 'operation'/)
    assert.match(content, /source_app: 'directory'/)
    assert.match(content, /session_id', idempotencyKey/)
    assert.match(content, /operationAction: 'directory\.user\.employment\.from_people'/)
    assert.match(content, /operationAction: 'directory\.user\.disable\.from_people'/)
    assert.match(content, /operationLog: \{/)
    assert.match(content, /const retry = \{/)
    assert.match(content, /endpoint: '\/api\/v1\/console\/authorization-lifecycle\/retry'/)
    assert.match(content, /method: 'POST'/)
    assert.match(content, /phase: input\.phase/)
    assert.match(content, /metadata: \{[\s\S]*retry/)
    assert.match(content, /authorizationDescriptor: \{[\s\S]{0,120}resource: 'people_lifecycle_authorization'[\s\S]{0,80}id: uid/)
    assert.match(content, /bizType: 'people_lifecycle_authorization'/)
    assert.match(content, /bizId: uid/)
    assert.match(content, /LIFECYCLE_NOTIFICATION_RECIPIENTS_SETTING/)
  })

  test('admin logs page applies notification query filters on first load', () => {
    const content = source('app/pages/admin/logs.vue')

    assert.match(content, /const route = useRoute\(\)/)
    assert.match(content, /type LogTab = 'login' \| 'operation' \| 'simulation' \| 'lifecycle' \| 'online'/)
    assert.match(content, /function applyInitialRouteFilters\(\)/)
    assert.match(content, /activeTab\.value = tab/)
    assert.match(content, /source_app: tab === 'simulation'/)
    assert.match(content, /: tab === 'lifecycle' \? 'directory' : queryText\(route\.query\.source_app\) \|\| 'all'/)
    assert.match(content, /session_id: queryText\(route\.query\.session_id\)/)
    assert.match(content, /action: tab === 'operation' \? queryText\(route\.query\.action\) : queryText\(route\.query\.action\) \|\| ACTION_FILTER_ALL/)
    assert.match(content, /selectedLifecycleRetry/)
    assert.match(content, /const \{ loaded: permissionsLoaded, loadPermissions, hasPermission \} = usePermissions\(\)/)
    assert.match(content, /hasPermission\('authorization_lifecycle', 'admin'\)/)
    assert.match(content, /canRetryLifecycleAuthorization/)
    assert.match(content, /需要授权生命周期管理权限/)
    assert.match(content, /v-if="selectedLifecycleRetry && canRetryLifecycleAuthorization"/)
    assert.match(content, /retryLifecycleAuthorization/)
    assert.match(content, /\/api\/v1\/console\/authorization-lifecycle\/retry/)
    assert.match(content, /重试授权处理/)
    assertBefore(content, 'applyInitialRouteFilters()', 'loadAppOptions()')
    assert.match(content, /activeTab\.value === 'operation' \|\| activeTab\.value === 'simulation' \|\| activeTab\.value === 'lifecycle'/)
  })

  test('operation logs expose target keys for lifecycle retry actions', () => {
    const content = source('server/api/v1/operation-logs/index.get.ts')
    const runtimeAudit = readFileSync(
      new URL('../../data-runtime/internal/apps/console/audit.go', import.meta.url),
      'utf8'
    )

    assert.match(content, /getConsoleOperationLogs/)
    assert.match(runtimeAudit, /TargetType \*string `json:"target_type"`/)
    assert.match(runtimeAudit, /TargetKey\s+\*string `json:"target_key"`/)
    assert.match(runtimeAudit, /operationLogWhere\(query/)
    assert.match(runtimeAudit, /target_key LIKE \?/)
    assert.match(runtimeAudit, /directory\.user\.employment_authorization\.retry/)
    assert.match(runtimeAudit, /directory\.user\.offboarding_authorization\.retry/)
  })

  test('admin logs page has an authorization lifecycle operations view', () => {
    const content = source('app/pages/admin/logs.vue')

    assert.match(content, /label="授权生命周期"/)
    assert.match(content, /activeTab === 'lifecycle'/)
    assert.match(content, /const lifecycleActionOptions = \[/)
    assert.match(content, /action_group: lifecycleAudit \? 'lifecycle_authorization' : undefined/)
    assert.match(content, /const lifecycleStats = computed/)
    assert.match(content, /const lifecycleMetrics = ref<LifecycleMetrics \| null>/)
    assert.match(content, /\/api\/v1\/operation-logs\/lifecycle-metrics/)
    assert.match(content, /lifecycleStats\.failed/)
    assert.match(content, /lifecycleStats\.pendingFailure/)
    assert.match(content, /lifecycleStats\.retrySuccess/)
    assert.match(content, /type LifecycleTrendMetric = \{/)
    assert.match(content, /trend: LifecycleTrendMetric\[\]/)
    assert.match(content, /const lifecycleTrendMax = computed/)
    assert.match(content, /lifecycleTrendBarHeight/)
    assert.match(content, /授权生命周期趋势/)
    assert.match(content, /lifecycleStats\.trend\.length/)
    assert.match(content, /const ACTION_FILTER_ALL = 'all'/)
    assert.match(content, /operationActionQueryValue\(simulationAudit \|\| lifecycleAudit\)/)
    assert.match(content, /operationActionQueryValue\(true\)/)
    assert.doesNotMatch(content, /全部模拟动作', value: ''/)
    assert.doesNotMatch(content, /全部生命周期动作', value: ''/)
    assert.match(content, /loadLifecycleMetrics/)
    assert.match(content, /v-else-if="activeTab === 'operation' \|\| activeTab === 'simulation' \|\| activeTab === 'lifecycle'"/)
  })

  test('lifecycle metrics API aggregates failures, retries, and unresolved retry work', () => {
    const content = source('server/api/v1/operation-logs/lifecycle-metrics.get.ts')

    assertBefore(
      content,
      'requirePermission(event, \'authorization_lifecycle\', \'view\'',
      'getConsoleLifecycleAuditMetrics(event'
    )
    assertBefore(
      content,
      'requirePermission(event, \'audit_logs\', \'view\'',
      'getConsoleLifecycleAuditMetrics(event'
    )
    const runtimeAudit = readFileSync(
      new URL('../../data-runtime/internal/apps/console/audit.go', import.meta.url),
      'utf8'
    )
    assert.match(runtimeAudit, /scoped\.Set\("source_app", firstValue\(scoped\.Get\("source_app"\), "directory"\)\)/)
    assert.match(runtimeAudit, /authorizationSync\.ok/)
    assert.match(runtimeAudit, /authorizationReclaim\.ok/)
    assert.match(runtimeAudit, /"retrySuccess": retrySuccess/)
    assert.match(runtimeAudit, /"pendingFailure": pending/)
    assert.match(runtimeAudit, /NOT EXISTS/)
    assert.match(runtimeAudit, /r\.created_at>=l\.created_at/)
    assert.match(runtimeAudit, /directory\.user\.employment_authorization\.retry/)
    assert.match(runtimeAudit, /directory\.user\.offboarding_authorization\.retry/)
    assert.match(runtimeAudit, /COUNT\(DISTINCT NULLIF\(l\.target_key,''\)\)/)
    assert.match(runtimeAudit, /DATE_FORMAT\(l\.created_at,'%Y-%m-%d'\)/)
    assert.match(runtimeAudit, /DESC LIMIT 14/)
    assert.match(runtimeAudit, /"trend": trend/)
  })

  test('manual lifecycle retry endpoint is admin gated and reuses only trusted dead-letter source facts', () => {
    const content = source('server/api/v1/console/authorization-lifecycle/retry.post.ts')

    assertBefore(
      content,
      'requirePermission(event, \'authorization_lifecycle\', \'admin\'',
      'readBody<unknown>(event)'
    )
    assert.match(content, /parsePlatformLifecycleRetryIdentity\(body\)/)
    assert.match(content, /loadDeadLetterPlatformLifecycleRetrySource\(/)
    assert.match(content, /executePlatformLifecycleRetryCommand\(retrySource\)/)
    assert.match(content, /cancelDeadLetterPlatformLifecycleForRetry\(\{ event, uid, phase, operationId: retrySource\.operationId \}\)/)
    assert.doesNotMatch(content, /getDirectoryUserForAdmin\(uid\)/)
    assert.doesNotMatch(content, /syncPlatformUserEmploymentAuthorization|reclaimPlatformUserAuthorizationForOffboarding/)
    assert.doesNotMatch(content, /body\.(positionCode|positionName|deptCode|reason|idempotencyKey)/)
    assert.match(content, /writeRetryOperationLog\(/)
    assert.match(content, /directory\.user\.employment_authorization\.retry/)
    assert.match(content, /directory\.user\.offboarding_authorization\.retry/)
    assert.match(content, /result: 'failed'/)
  })

  test('authorization lifecycle is a distinct Console permission resource', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
      recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
    }
    const resource = manifest.resources.find(item => item.code === 'authorization_lifecycle')
    assert.deepEqual(resource?.actions, ['view', 'admin'])

    const operator = manifest.recommendedRoles.find(item => item.code === 'console:operator')
    const securityAdmin = manifest.recommendedRoles.find(item => item.code === 'console:security_admin')
    const admin = manifest.recommendedRoles.find(item => item.code === 'console:admin')

    assert.equal(operator?.suggestedPermissions.includes('console:authorization_lifecycle:view'), true)
    assert.equal(operator?.suggestedPermissions.includes('console:authorization_lifecycle:admin'), false)
    assert.equal(securityAdmin?.suggestedPermissions.includes('console:authorization_lifecycle:admin'), true)
    assert.equal(admin?.suggestedPermissions.includes('console:authorization_lifecycle:admin'), true)
  })
})
