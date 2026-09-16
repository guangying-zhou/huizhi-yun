import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Console audit log permissions', () => {
  test('log read APIs require audit_logs view before calling Tenant Runtime', () => {
    const loginLogs = source('server/api/v1/login-logs/index.get.ts')
    const operationLogs = source('server/api/v1/operation-logs/index.get.ts')
    const onlineUsers = source('server/api/v1/heartbeat/online.get.ts')

    assertBefore(loginLogs, 'requirePermission(event, \'audit_logs\', \'view\'', 'getConsoleLoginLogs(event')
    assertBefore(operationLogs, 'requirePermission(event, \'audit_logs\', \'view\'', 'getConsoleOperationLogs(event')
    assert.doesNotMatch(loginLogs, /queryRow|queryRows|server\/utils\/db/)
    assert.doesNotMatch(operationLogs, /queryRow|queryRows|server\/utils\/db/)
    assertBefore(onlineUsers, 'requirePermission(event, \'audit_logs\', \'view\'', 'listOnlineHeartbeats(event, sourceApp)')
    assert.doesNotMatch(onlineUsers, /queryRow|queryRows|server\/utils\/db/)
  })

  test('logs page and navigation use the dedicated audit_logs resource', () => {
    const content = source('app/config/permissions.ts')

    assert.match(content, /to:\s*'\/admin\/logs'[\s\S]*resource:\s*'audit_logs'/)
    assert.match(content, /\{ pattern: '\/admin\/logs', resource: 'audit_logs', action: 'view' as const \}/)
    assert.doesNotMatch(content, /\{ pattern: '\/admin\/logs', resource: 'system_settings'/)
  })

  test('Console reports its own presence and online-user failures remain visible', () => {
    const layout = source('app/layouts/default.vue')
    const page = source('app/pages/admin/logs.vue')

    assert.match(layout, /useHeartbeat\('console'\)/)
    assert.match(page, /title:\s*'加载在线用户失败'/)
    assert.match(page, /description:\s*error instanceof Error \? error\.message : String\(error\)/)
  })

  test('enterprise login logs distinguish WeCom and DingTalk while retaining historical OAuth records', () => {
    const wecomCallback = source('server/api/auth/wecom-callback.get.ts')
    const dingtalkCallback = source('server/api/auth/dingtalk-callback.get.ts')
    const loginLogs = source('server/api/v1/login-logs/index.get.ts')
    const runtimeAudit = workspaceSource('data-runtime/internal/apps/console/audit.go')
    const page = source('app/pages/admin/logs.vue')

    assert.match(wecomCallback, /authProvider: 'wecom',[\s\S]*loginType: 'wecom'/)
    assert.match(dingtalkCallback, /authProvider: 'dingtalk', loginType: 'dingtalk'/)
    assert.match(loginLogs, /getConsoleLoginLogs/)
    assert.match(runtimeAudit, /case "wecom", "dingtalk":/)
    assert.match(runtimeAudit, /l\.auth_provider=\?/)
    assert.match(runtimeAudit, /COALESCE\(l\.auth_provider,''\) NOT IN \('wecom','dingtalk'\)/)
    assert.match(page, /企业微信登录/)
    assert.match(page, /钉钉登录/)
    assert.match(page, /function loginTypeLabel/)
  })

  test('manifest declares audit_logs and grants it to control-plane operators', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
      recommendedRoles: Array<{ code: string, suggestedPermissions?: string[] }>
    }

    const resource = manifest.resources.find(item => item.code === 'audit_logs')
    assert.ok(resource, 'audit_logs resource must exist')
    assert.deepEqual(resource.actions, ['view'])

    const roles = new Map(manifest.recommendedRoles.map(role => [role.code, role.suggestedPermissions || []]))
    for (const roleCode of ['console:viewer', 'console:operator', 'console:security_admin', 'console:admin']) {
      assert.equal(
        roles.get(roleCode)?.includes('console:audit_logs:view'),
        true,
        `${roleCode} should include audit log view`
      )
    }
    assert.equal(
      roles.get('console:directory_operator')?.includes('console:audit_logs:view'),
      false,
      'directory operator should not receive audit log view by default'
    )
  })
})
