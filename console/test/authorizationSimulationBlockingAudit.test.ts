import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `missing ${left}`)
  assert.notEqual(rightIndex, -1, `missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} should appear before ${right}`)
}

describe('authorization simulation high-risk blocking audit', () => {
  test('requirePermission blocks active simulation before policy authorization expansion', () => {
    const content = source('server/utils/checkPermission.ts')
    const checkPermissionBlock = content.slice(
      content.indexOf('export async function checkPermission'),
      content.indexOf('/**\n * 要求指定权限')
    )
    const requirePermissionBlock = content.slice(content.indexOf('export async function requirePermission'))

    assert.match(content, /readAuthorizationSimulationSession/)
    assert.match(content, /getAuthorizationSimulationPermissionRestriction/)
    assert.match(requirePermissionBlock, /const activeRestriction = getActiveSimulationRestriction\(event, uid, resource, action\)/)
    assertBefore(
      checkPermissionBlock,
      'if (getActiveSimulationRestriction(event, uid, resource, action))',
      'const snapshot = await loadPolicyAuthorizationSnapshot(uid, appCode, event)'
    )
    assertBefore(
      requirePermissionBlock,
      'const activeRestriction = getActiveSimulationRestriction(event, uid, resource, action)',
      'const allowed = await checkPermission(event, resource, action, { uid })'
    )
  })

  test('blocked simulation writes audit details before returning 403', () => {
    const content = source('server/utils/checkPermission.ts')

    assertBefore(
      content,
      'await writeAuthorizationSimulationAudit(event, {',
      'throw createError({ statusCode: 403, message: simulationRestrictionMessage(resource, action) })'
    )
    assert.match(content, /action: 'blocked'/)
    assert.match(content, /result: 'failed'/)
    assert.match(content, /failureReason: simulationRestrictionMessage\(resource, action\)/)
    assert.match(content, /resourceCode: activeRestriction\.restriction\.resourceCode/)
    assert.match(content, /permissionAction: activeRestriction\.restriction\.action/)
    assert.match(content, /restrictionReason: activeRestriction\.restriction\.reason/)
    assert.match(content, /policyBundleVersion: activeRestriction\.simulation\.policyBundleVersion/)
    assert.match(content, /policyBundleHash: activeRestriction\.simulation\.policyBundleHash/)
  })

  test('simulation audits are persisted as operation log records and expose blocked action filters', () => {
    const audit = source('server/utils/authorizationSimulation.ts')
    const logsApi = source('server/api/v1/operation-logs/index.get.ts')
    const runtimeAudit = readFileSync(
      new URL('../../data-runtime/internal/apps/console/audit.go', import.meta.url),
      'utf8'
    )
    const logsPage = source('app/pages/admin/logs.vue')

    assert.match(audit, /appendConsoleHumanOperationLog\(event, \{/)
    assert.match(audit, /sourceApp: 'console'/)
    assert.match(audit, /`simulation\.\$\{input\.action\}`/)
    assert.match(audit, /resourceCode: stringValue\(input\.resourceCode\) \|\| null/)
    assert.match(audit, /permissionAction: stringValue\(input\.permissionAction\) \|\| null/)
    assert.match(audit, /restrictionReason: stringValue\(input\.restrictionReason\) \|\| null/)
    assert.doesNotMatch(audit, /server\/utils\/db|queryRow|execute|withTransaction/)

    assert.match(logsApi, /getConsoleOperationLogs/)
    assert.match(runtimeAudit, /INSERT INTO operation_logs/)
    assert.match(runtimeAudit, /u\.real_name,l\.domain_code,l\.request_id,l\.target_type,l\.target_key,l\.action/)
    assert.match(runtimeAudit, /JSON_PRETTY\(l\.detail_json\)/)

    assert.match(logsPage, /source_app: tab === 'simulation'[\s\S]*\? 'authorization_simulation'/)
    assert.match(logsPage, /label: '高危拦截', value: 'simulation\.blocked'/)
  })
})
