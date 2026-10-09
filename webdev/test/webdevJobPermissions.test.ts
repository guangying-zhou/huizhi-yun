import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { matchRouteRule, menus } from '../app/config/permissions.ts'
import { resolveWebDevJobPermission } from '../server/utils/webdevJobPermissions.ts'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

interface ManifestRole {
  code: string
  suggestedPermissions?: string[]
}

interface AppManifest {
  recommendedRoles?: ManifestRole[]
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function rolePermissions(roleCode: string) {
  const manifest = JSON.parse(source('app.manifest.json')) as AppManifest
  const role = (manifest.recommendedRoles || []).find(item => item.code === roleCode)
  assert.ok(role, `missing recommended role ${roleCode}`)
  return role.suggestedPermissions || []
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

function assertRequiresWorkspaceActionBefore(content: string, action: string, right: string) {
  const guard = `await requireWebDevPermission(event, 'webdev_workspace', '${action}')`
  assert.match(content, new RegExp(`requireWebDevPermission\\(event, 'webdev_workspace', '${action}'\\)`))
  assertBefore(content, guard, right)
}

describe('resolveWebDevJobPermission', () => {
  test('普通 Codex 任务要求 execute', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'codex_task', templateId: 'codex.app-server', prompt: '修复部署页面文案' }),
      { resource: 'webdev_workspace', action: 'execute' }
    )
  })

  test('结构化部署任务要求 deploy', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'deploy_preview', module: 'finance' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
    assert.deepEqual(
      resolveWebDevJobPermission({ templateId: 'release:deploy', target: 'prod' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
    assert.deepEqual(
      resolveWebDevJobPermission({ command: 'pnpm run deploy:cloudflare' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
  })

  test('非结构化文本不触发 deploy 提权', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'codex_task', prompt: '检查 deploy 页面为什么空白' }),
      { resource: 'webdev_workspace', action: 'execute' }
    )
  })
})

describe('WebDev permission implication policy', () => {
  test('Console authorization uses the internal Service Binding and preserves dependency failures', () => {
    const content = source('server/utils/auth.ts')

    assert.match(content, /fetchConsoleServiceJson<ConsoleApplicationsResponse>\(event, url/)
    assert.match(content, /loadAuthorizationSnapshotFromConsoleRuntime\(uid, configuredAppCode\(event\), event\)/)
    assert.match(content, /statusCode: 503/)
    assert.match(content, /statusMessage: 'Authorization Unavailable'/)
    assert.doesNotMatch(content, /await \$fetch<ConsoleApplicationsResponse>/)
    assert.doesNotMatch(content, /Console permission check failed/)
  })

  test('deploy must be explicitly granted and is not implied by admin alone', () => {
    const content = source('server/utils/auth.ts')
    const block = content.slice(
      content.indexOf('export function hasWebDevPermission'),
      content.indexOf('export async function loadWebDevPermissionSnapshot')
    )
    assert.match(content, /import \{ authorizationResourcesAllow \} from '@hzy\/foundation\/shared\/utils\/authorizationActions'/)
    assert.doesNotMatch(content, /webDevActionPolicy/)
    assert.match(block, /snapshot\.actionPolicies\[resource\]/)

    const manifest = JSON.parse(source('app.manifest.json')) as {
      actionImplications?: Array<{ resourceCode: string, action: string, implies: string[] }>
    }
    const implications = Object.fromEntries((manifest.actionImplications || []).map(item => [item.action, item.implies]))
    const policy = { implications }

    assert.equal(authorizationResourcesAllow({ webdev_workspace: ['execute'] }, 'webdev_workspace', 'view', policy), true)
    assert.equal(authorizationResourcesAllow({ webdev_workspace: ['admin'] }, 'webdev_workspace', 'execute', policy), true)
    assert.equal(authorizationResourcesAllow({ webdev_workspace: ['admin'] }, 'webdev_workspace', 'deploy', policy), false)
  })

  test('recommended roles isolate execute, deploy and admin duties', () => {
    const operator = rolePermissions('webdev:operator')
    const deployer = rolePermissions('webdev:deployer')
    const admin = rolePermissions('webdev:admin')

    assert.ok(operator.includes('webdev:webdev_workspace:execute'))
    assert.equal(operator.includes('webdev:webdev_workspace:deploy'), false)
    assert.equal(operator.includes('webdev:webdev_workspace:admin'), false)

    assert.ok(deployer.includes('webdev:webdev_workspace:execute'))
    assert.ok(deployer.includes('webdev:webdev_workspace:deploy'))
    assert.equal(deployer.includes('webdev:webdev_workspace:admin'), false)

    assert.ok(admin.includes('webdev:webdev_workspace:execute'))
    assert.ok(admin.includes('webdev:webdev_workspace:deploy'))
    assert.ok(admin.includes('webdev:webdev_workspace:admin'))
  })
})

describe('WebDev route and navigation permission policy', () => {
  function menuAction(path: string) {
    return menus.flat().find(item => item.to === path)?.action
  }

  test('front-end route guard keeps deploy and admin pages on explicit actions', () => {
    assert.equal(matchRouteRule('/deploy')?.action, 'deploy')
    assert.equal(matchRouteRule('/agents')?.action, 'admin')
    assert.equal(matchRouteRule('/issues')?.action, 'execute')
    assert.equal(matchRouteRule('/review')?.action, 'execute')
    assert.equal(matchRouteRule('/history')?.action, 'view')
    assert.equal(matchRouteRule('/overview')?.action, 'view')
    assert.equal(matchRouteRule('/')?.action, 'execute')
  })

  test('navigation entries mirror the sensitive route actions', () => {
    assert.equal(menuAction('/deploy'), 'deploy')
    assert.equal(menuAction('/agents'), 'admin')
    assert.equal(menuAction('/issues'), 'execute')
    assert.equal(menuAction('/review'), 'execute')
    assert.equal(menuAction('/history'), 'view')
    assert.equal(menuAction('/overview'), 'view')
  })
})

describe('WebDev job creation route permissions', () => {
  test('agent runtime endpoints require WebDev permissions before proxying to Dev Agent', () => {
    const enrollment = source('server/api/webdev/agent/enrollment.get.ts')
    const health = source('server/api/webdev/agent/health.get.ts')

    assert.match(enrollment, /requireWebDevPermission\(event, 'webdev_workspace', 'admin'\)/)
    assertBefore(
      enrollment,
      'await requireWebDevPermission(event, \'webdev_workspace\', \'admin\')',
      'devAgentFetch(event, \'/runtime/enrollment\''
    )

    assert.match(health, /requireWebDevPermission\(event, 'webdev_workspace', 'view'\)/)
    assertBefore(
      health,
      'await requireWebDevPermission(event, \'webdev_workspace\', \'view\')',
      'devAgentFetch(event, \'/runtime/health\''
    )
  })

  test('作业创建入口先解析请求体权限再调用 Dev Agent', () => {
    const content = source('server/api/webdev/jobs/index.post.ts')

    assert.match(content, /const permission = resolveWebDevJobPermission\(body\)/)
    assert.match(content, /requireWebDevPermission\(event, permission\.resource, permission\.action\)/)
    assertBefore(
      content,
      'await requireWebDevPermission(event, permission.resource, permission.action)',
      'devAgentFetch(event, \'/v1/jobs\''
    )
    assertBefore(
      content,
      'await requireWebDevPermission(event, permission.resource, permission.action)',
      'persistJobSnapshot(event'
    )
  })

  test('任务读取、日志、附件上传和取消入口使用页面同级动作守卫', () => {
    const attachments = source('server/api/webdev/attachments.post.ts')
    const list = source('server/api/webdev/jobs/index.get.ts')
    const detail = source('server/api/webdev/jobs/[id]/index.get.ts')
    const events = source('server/api/webdev/jobs/[id]/events.get.ts')
    const cancel = source('server/api/webdev/jobs/[id]/cancel.post.ts')

    assertRequiresWorkspaceActionBefore(attachments, 'execute', 'readMultipartFormData(event)')
    assertRequiresWorkspaceActionBefore(list, 'view', 'dataRuntimeFetch(event, \'/v1/webdev/jobs\'')
    assertRequiresWorkspaceActionBefore(detail, 'view', 'devAgentFetch(event, `/v1/jobs/')
    assertRequiresWorkspaceActionBefore(events, 'view', 'dataRuntimeFetch(event, `/v1/webdev/jobs/')
    assertRequiresWorkspaceActionBefore(events, 'view', 'devAgentFetch(event, `/v1/jobs/')
    assertRequiresWorkspaceActionBefore(cancel, 'execute', 'devAgentFetch(event, `/v1/jobs/')
    assertRequiresWorkspaceActionBefore(cancel, 'execute', 'persistJobSnapshot(event')
  })

  test('Issue 收件箱和自动领取设置 API 对齐 execute/admin 动作', () => {
    const list = source('server/api/webdev/issues/index.get.ts')
    const create = source('server/api/webdev/issues/index.post.ts')
    const detail = source('server/api/webdev/issues/[id]/index.get.ts')
    const update = source('server/api/webdev/issues/[id]/index.patch.ts')
    const settingsGet = source('server/api/webdev/issues/settings.get.ts')
    const settingsPut = source('server/api/webdev/issues/settings.put.ts')

    assertRequiresWorkspaceActionBefore(list, 'execute', 'dataRuntimeFetch(event, \'/v1/webdev/issues\'')
    assertRequiresWorkspaceActionBefore(create, 'execute', 'readBody(event)')
    assertRequiresWorkspaceActionBefore(create, 'execute', 'dataRuntimeFetch(event, \'/v1/webdev/issues\'')
    assertRequiresWorkspaceActionBefore(detail, 'execute', 'dataRuntimeFetch(event, `/v1/webdev/issues/')
    assertRequiresWorkspaceActionBefore(update, 'execute', 'readBody(event)')
    assertRequiresWorkspaceActionBefore(update, 'execute', 'dataRuntimeFetch(event, `/v1/webdev/issues/')
    assertRequiresWorkspaceActionBefore(settingsGet, 'admin', 'dataRuntimeFetch(event, \'/v1/webdev/issues/settings\'')
    assertRequiresWorkspaceActionBefore(settingsPut, 'admin', 'readBody(event)')
    assertRequiresWorkspaceActionBefore(settingsPut, 'admin', 'dataRuntimeFetch(event, \'/v1/webdev/issues/settings\'')
  })

  test('手动领取 Issue 创建 Codex 任务前要求 execute', () => {
    const content = source('server/api/webdev/issues/[id]/claim.post.ts')

    assert.match(content, /requireWebDevPermission\(event, 'webdev_workspace', 'execute'\)/)
    assertBefore(
      content,
      'await requireWebDevPermission(event, \'webdev_workspace\', \'execute\')',
      'claimIssueAndCreateJob(event'
    )
  })
})
