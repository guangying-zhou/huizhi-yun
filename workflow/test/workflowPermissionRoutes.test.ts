import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { matchRouteRule } from '../app/config/permissions.ts'
import {
  resolveWorkflowProxyAuthorizationPurpose,
  resolveWorkflowRoutePermission
} from '../server/utils/workflowPermissionRoutes.ts'

function appManifest() {
  return JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
    recommendedRoles: Array<{
      code: string
      suggestedPermissions: string[]
    }>
  }
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function permissionsFor(roleCode: string) {
  const role = appManifest().recommendedRoles.find(item => item.code === roleCode)
  assert.ok(role, `Missing role ${roleCode}`)
  return role.suggestedPermissions
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) return listFiles(fullPath)
    return [fullPath]
  })
}

describe('resolveWorkflowRoutePermission', () => {
  test('front-end admin route guard covers the admin index page', () => {
    assert.deepEqual(
      matchRouteRule('/admin'),
      { pattern: '/admin', resource: 'flow_schemas', action: 'admin' }
    )
    assert.deepEqual(
      matchRouteRule('/admin/flows'),
      { pattern: '/admin/**', resource: 'flow_schemas', action: 'admin' }
    )
  })

  test('personal task and instance workbench routes rely on runtime actor relation guards', () => {
    const config = readFileSync(new URL('../app/config/permissions.ts', import.meta.url), 'utf8')
    const taskListPage = readFileSync(new URL('../app/pages/tasks/index.vue', import.meta.url), 'utf8')
    const instanceListPage = readFileSync(new URL('../app/pages/instances/index.vue', import.meta.url), 'utf8')
    const middleware = readFileSync(new URL('../server/middleware/data-runtime.ts', import.meta.url), 'utf8')
    const runtime = [
      workspaceSource('data-runtime/internal/apps/workflow/runtime.go'),
      workspaceSource('data-runtime/internal/apps/workflow/runtime_instances.go')
    ].join('\n')

    assert.equal(matchRouteRule('/tasks'), null)
    assert.equal(matchRouteRule('/tasks/42'), null)
    assert.equal(matchRouteRule('/instances'), null)
    assert.equal(matchRouteRule('/instances/88'), null)
    assert.doesNotMatch(config, /pattern:\s*['"]\/(?:tasks|instances)(?:\/\*\*)?['"]/)

    assert.match(taskListPage, /\/api\/v1\/tasks\/pending/)
    assert.match(taskListPage, /\/api\/v1\/tasks\/done/)
    assert.match(instanceListPage, /\/api\/v1\/tasks\/initiated/)

    assert.match(middleware, /\.\.\.\(currentUser \? \{ current_user: currentUser \} : \{\}\)/)
    assert.ok(middleware.includes('suffix === \'/tasks/pending\''))
    assert.ok(middleware.includes('suffix === \'/tasks/done\''))
    assert.ok(middleware.includes('suffix === \'/tasks/initiated\''))
    assert.ok(middleware.includes('/^\\/tasks\\/[^/]+$/.test(suffix)'))
    assert.ok(middleware.includes('/^\\/instances\\/[^/]+$/.test(suffix)'))

    assert.match(runtime, /func \(a \*Adapter\) listTasks\(ctx context\.Context, query url\.Values, listType string\)/)
    assert.match(runtime, /conditions := \[\]string\{"t\.assignee_uid = \?"\}/)
    assert.match(runtime, /func \(a \*Adapter\) listInitiated\(ctx context\.Context, query url\.Values\)/)
    assert.match(runtime, /conditions := \[\]string\{"i\.initiator_uid = \?"\}/)
    assert.match(runtime, /cleanAnyString\(task\["assignee_uid"\]\) != currentUser && cleanAnyString\(instance\["initiator_uid"\]\) != currentUser/)
    assert.match(runtime, /SELECT id FROM flow_tasks WHERE instance_id = \? AND assignee_uid = \? LIMIT 1/)
  })

  test('auth permissions snapshot is sourced from Console runtime without local bundle fallback', () => {
    const permissionsApi = readFileSync(new URL('../server/api/auth/permissions.get.ts', import.meta.url), 'utf8')

    assert.match(permissionsApi, /loadAuthorizationSnapshotFromConsoleRuntime/)
    assert.match(permissionsApi, /业务应用不再读取本地 policy bundle/)
    assert.doesNotMatch(permissionsApi, /优先读取本地 Platform policy bundle/)
    assert.doesNotMatch(permissionsApi, /本地 bundle 不存在时返回空权限/)
    assert.doesNotMatch(permissionsApi, /loadAuthorizationFromCachedPlatformBundle/)
    assert.doesNotMatch(permissionsApi, /loadAuthorizationFromPlatformBundle/)
  })

  test('tenant-runtime middleware does not import legacy DB flow engine', () => {
    const middleware = readFileSync(new URL('../server/middleware/data-runtime.ts', import.meta.url), 'utf8')
    const initiatorContext = readFileSync(new URL('../server/utils/initiatorContext.ts', import.meta.url), 'utf8')

    assert.match(middleware, /server\/utils\/initiatorContext/)
    assert.doesNotMatch(middleware, /server\/utils\/flowEngine/)
    assert.doesNotMatch(middleware, /server\/utils\/db/)
    assert.match(middleware, /collectWorkflowInitiatorContext/)
    assert.doesNotMatch(middleware, /queryRow/)
    assert.doesNotMatch(middleware, /queryRows/)
    assert.doesNotMatch(initiatorContext, /server\/utils\/db/)
    assert.doesNotMatch(initiatorContext, /queryRow/)
    assert.doesNotMatch(initiatorContext, /queryRows/)
  })

  test('管理配置接口不保留 Nuxt 本地 DB fallback handler', () => {
    const adminApiDir = fileURLToPath(new URL('../server/api/v1/admin/', import.meta.url))
    assert.deepEqual(listFiles(adminApiDir), [])
  })

  test('审批实例和任务主路径不保留 Nuxt 本地 DB fallback handler', () => {
    const runtimeOnlyDirs = [
      '../server/api/v1/actions/',
      '../server/api/v1/instances/',
      '../server/api/v1/tasks/'
    ]

    for (const dir of runtimeOnlyDirs) {
      assert.deepEqual(listFiles(fileURLToPath(new URL(dir, import.meta.url))), [])
    }

    const actionSyncHandler = fileURLToPath(new URL('../server/api/v1/action-defs/sync.post.ts', import.meta.url))
    assert.equal(existsSync(actionSyncHandler), true)
  })

  test('旧 Nuxt 本地流程引擎 DB utils 已移除', () => {
    const removedUtils = [
      '../server/utils/callbackService.ts',
      '../server/utils/flowEngine.ts',
      '../server/utils/routeMatcher.ts',
      '../server/utils/systemParameters.ts'
    ]

    for (const file of removedUtils) {
      assert.equal(existsSync(fileURLToPath(new URL(file, import.meta.url))), false)
    }
  })

  test('审批任务动作要求精确权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/approve', 'POST'),
      { resource: 'workflow_tasks', action: 'approve' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/reject', 'POST'),
      { resource: 'workflow_tasks', action: 'reject' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/delegate', 'POST'),
      { resource: 'workflow_tasks', action: 'delegate' }
    )
  })

  test('跨应用代理将敏感动作绑定到固定授权 purpose', () => {
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/tasks/42/approve', 'POST'), 'task_approve')
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/tasks/42/reject', 'POST'), 'task_reject')
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/tasks/42/delegate', 'POST'), 'task_delegate')
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/instances/88/cancel', 'POST'), 'instance_cancel')
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/instances/88/resubmit', 'POST'), 'instance_resubmit')
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/admin/routes', 'POST'), null)
    assert.equal(resolveWorkflowProxyAuthorizationPurpose('/tasks/42/approve', 'GET'), null)
  })

  test('实例状态变更要求精确权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/instances/88/cancel', 'POST'),
      { resource: 'workflow_instances', action: 'cancel' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/instances/88/resubmit', 'POST'),
      { resource: 'workflow_instances', action: 'resubmit' }
    )
  })

  test('管理配置读取要求对应资源 view 权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/action-defs', 'GET'),
      { resource: 'action_defs', action: 'view' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/flow-schemas/templates', 'GET'),
      { resource: 'flow_schemas', action: 'view' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/form-schemas/7', 'GET'),
      { resource: 'form_schemas', action: 'view' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/routes', 'GET'),
      { resource: 'route_rules', action: 'view' }
    )
  })

  test('管理配置写入要求对应资源 edit 权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/action-defs', 'POST'),
      { resource: 'action_defs', action: 'edit' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/flow-schemas/11', 'PATCH'),
      { resource: 'flow_schemas', action: 'edit' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/form-schemas/12', 'DELETE'),
      { resource: 'form_schemas', action: 'edit' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/admin/routes/13', 'PATCH'),
      { resource: 'route_rules', action: 'edit' }
    )
  })

  test('非敏感路径不附加精确权限映射', () => {
    assert.equal(resolveWorkflowRoutePermission('/tasks/42/approve', 'GET'), null)
    assert.equal(resolveWorkflowRoutePermission('/tasks/42', 'POST'), null)
    assert.equal(resolveWorkflowRoutePermission('/instances/88', 'PATCH'), null)
  })
})

describe('Workflow recommended role split', () => {
  test('审批、委托、撤回和重提不混入引擎管理员角色', () => {
    const adminPermissions = permissionsFor('workflow:admin')

    assert.equal(adminPermissions.includes('workflow:workflow_tasks:approve'), false)
    assert.equal(adminPermissions.includes('workflow:workflow_tasks:reject'), false)
    assert.equal(adminPermissions.includes('workflow:workflow_tasks:delegate'), false)
    assert.equal(adminPermissions.includes('workflow:workflow_instances:cancel'), false)
    assert.equal(adminPermissions.includes('workflow:workflow_instances:resubmit'), false)
    assert.equal(adminPermissions.includes('workflow:workflow_tasks:admin'), true)
    assert.equal(adminPermissions.includes('workflow:workflow_instances:admin'), true)
  })

  test('业务动作由审批处理和发起人角色显式承载', () => {
    const approverPermissions = permissionsFor('workflow:approver')
    const initiatorPermissions = permissionsFor('workflow:initiator')

    assert.equal(approverPermissions.includes('workflow:workflow_tasks:approve'), true)
    assert.equal(approverPermissions.includes('workflow:workflow_tasks:reject'), true)
    assert.equal(approverPermissions.includes('workflow:workflow_tasks:delegate'), true)
    assert.equal(initiatorPermissions.includes('workflow:workflow_instances:cancel'), true)
    assert.equal(initiatorPermissions.includes('workflow:workflow_instances:resubmit'), true)
  })
})
